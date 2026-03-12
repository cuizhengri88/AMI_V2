// 샵 데이터 초기화 도메인 Tauri 명령입니다.

// 선택한 도메인 데이터를 트랜잭션으로 초기화합니다.
#[tauri::command]
async fn reset_salon_data(payload: ResetSalonDataPayload) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_employee_management_table(&client).await?;
    ensure_user_management_table(&client).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;
    let target = ResetSalonDataTarget::parse(&payload.target)?;

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("초기화 트랜잭션 시작 실패: {e}"))?;

    match target {
        ResetSalonDataTarget::Sales => {
            tx.execute(
                "DELETE FROM sales_settlement_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("매출데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Reservation => {
            tx.execute(
                "DELETE FROM reservation_calendar_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("예약데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::ServiceCatalog => {
            let sales_ref_count = tx
                .query_one(
                    r#"
                    SELECT COUNT(1)::BIGINT
                      FROM sales_settlement_service_line
                     WHERE store_code = $1
                    "#,
                    &[&store_code],
                )
                .await
                .map_err(|e| format!("시술항목 연관 매출 조회 실패: {e}"))?
                .get::<_, i64>(0);
            let reservation_ref_count = tx
                .query_one(
                    r#"
                    SELECT COUNT(1)::BIGINT
                      FROM reservation_calendar_service_line
                     WHERE store_code = $1
                    "#,
                    &[&store_code],
                )
                .await
                .map_err(|e| format!("시술항목 연관 예약 조회 실패: {e}"))?
                .get::<_, i64>(0);

            if sales_ref_count > 0 || reservation_ref_count > 0 {
                return Err(format!(
                    "시술항목 초기화 전 연관 데이터를 먼저 정리해야 합니다. 매출건수: {sales_ref_count}, 예약건수: {reservation_ref_count} (매출데이터/예약데이터 초기화 후 다시 시도하세요.)"
                ));
            }

            tx.execute(
                "DELETE FROM service_catalog_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("시술항목 데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Member => {
            tx.execute(
                "DELETE FROM user_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Employee => {
            let sales_ref_count = tx
                .query_one(
                    r#"
                    SELECT COUNT(1)::BIGINT
                      FROM sales_settlement_management
                     WHERE store_code = $1
                    "#,
                    &[&store_code],
                )
                .await
                .map_err(|e| format!("직원 연관 매출 조회 실패: {e}"))?
                .get::<_, i64>(0);

            if sales_ref_count > 0 {
                return Err(format!(
                    "직원데이터 초기화 전 매출데이터를 먼저 초기화해야 합니다. 매출건수: {sales_ref_count}"
                ));
            }

            tx.execute(
                "DELETE FROM employee_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("직원데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::MemberPoint => {
            tx.execute(
                "DELETE FROM member_coupon_balance WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원 쿠폰잔액 초기화 실패: {e}"))?;
            tx.execute(
                "DELETE FROM member_point_balance WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원 포인트잔액 초기화 실패: {e}"))?;
            tx.execute(
                "DELETE FROM member_point_history WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원 포인트 충전내역 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::PointUsageHistory => {
            tx.execute(
                "DELETE FROM member_point_usage_history WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("포인트사용내역 초기화 실패: {e}"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("데이터 초기화 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: format!("{} 초기화 완료", target.label()),
    })
}


