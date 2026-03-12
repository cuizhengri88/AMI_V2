use crate::app::core::foundation::*;

/**
 * @file reset.rs
 * @description 매장의 도메인별 데이터를 초기화(삭제)하는 백엔드 명령 정의 파일입니다.
 * 매출, 예약, 회원, 직원 등 특정 카테고리의 데이터를 선별적으로 초기화하며, 연관 데이터 간의 참조 무결성을 고려하여 검증 단계를 포함합니다.
 */

/**
 * @function reset_salon_data
 * @description 사용자가 선택한 특정 도메인의 데이터를 트랜잭션 기반으로 안전하게 초기화합니다.
 * @param payload ResetSalonDataPayload: 초기화 대상 도메인 및 DB 연결 정보
 * @return MutationResult: 초기화 성공 여부 및 결과 메시지
 */
#[tauri::command]
pub async fn reset_salon_data(payload: ResetSalonDataPayload) -> Result<MutationResult, String> {
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

    // 선택된 초기화 대상(target)에 따라 분기 처리합니다.
    match target {
        ResetSalonDataTarget::Sales => {
            // [SQL] 해당 점포의 모든 매출 정산 데이터를 삭제합니다.
            tx.execute(
                "DELETE FROM sales_settlement_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("매출데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Reservation => {
            // [SQL] 해당 점포의 모든 예약 캘린더 데이터를 삭제합니다.
            tx.execute(
                "DELETE FROM reservation_calendar_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("예약데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::ServiceCatalog => {
            // [SQL] 시술 항목 삭제 전, 이를 참조하고 있는 매출 라인 데이터가 있는지 확인합니다.
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
            
            // [SQL] 시술 항목 삭제 전, 이를 참조하고 있는 예약 라인 데이터가 있는지 확인합니다.
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

            // 참조 중인 데이터가 있다면 초기화를 차단하여 데이터 정합성을 유지합니다.
            if sales_ref_count > 0 || reservation_ref_count > 0 {
                return Err(format!(
                    "시술항목 초기화 전 연관 데이터를 먼저 정리해야 합니다. 매출건수: {sales_ref_count}, 예약건수: {reservation_ref_count} (매출데이터/예약데이터 초기화 후 다시 시도하세요.)"
                ));
            }

            // [SQL] 참조 데이터가 없는 경우 시술 항목 데이터를 안전하게 삭제합니다.
            tx.execute(
                "DELETE FROM service_catalog_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("시술항목 데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Member => {
            // [SQL] 해당 점포의 회원 정보를 전체 삭제합니다.
            tx.execute(
                "DELETE FROM user_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Employee => {
            // [SQL] 직원 삭제 전, 해당 직원이 등록된 매출 데이터가 있는지 체크합니다.
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

            // [SQL] 참조하는 매출이 없는 경우 직원 데이터를 삭제합니다.
            tx.execute(
                "DELETE FROM employee_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("직원데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::MemberPoint => {
            // [SQL] 회원의 쿠폰 잔액, 포인트 잔액, 충전 이력을 모두 삭제합니다.
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
            // [SQL] 포인트 및 쿠폰의 실제 사용 내역만 별도로 초기화합니다.
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


