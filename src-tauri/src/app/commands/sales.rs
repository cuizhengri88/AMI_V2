// 시술 정산(매출) 조회/저장/취소/삭제 도메인 코드와 보조 함수를 포함합니다.

// 시술 정산(매출) 마스터/라인/결제 데이터를 조회합니다.
#[tauri::command]
async fn get_sales_settlement_data(
    payload: SalesSettlementQueryPayload,
) -> Result<SalesSettlementDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let settlement_rows = client
        .query(
            r#"
            SELECT
                s.settlement_id::BIGINT,
                TO_CHAR(s.settlement_datetime, 'YYYY-MM-DD HH24:MI') AS settlement_datetime,
                s.member_user_id,
                s.manager_employee_id::BIGINT,
                s.total_amount::BIGINT,
                s.total_time_minutes::INTEGER,
                s.status,
                s.reservation_ref,
                s.guest_customer_name,
                s.guest_customer_phone,
                s.cancel_type,
                s.cancel_reason,
                TO_CHAR(s.cancelled_at, 'YYYY-MM-DD HH24:MI') AS cancelled_at
              FROM sales_settlement_management s
             WHERE s.store_code = $1
             ORDER BY s.settlement_datetime DESC, s.settlement_id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("정산 마스터 조회 실패: {e}"))?;

    let service_rows = client
        .query(
            r#"
            SELECT
                l.settlement_id::BIGINT,
                l.line_no::INTEGER,
                l.service_id::BIGINT
              FROM sales_settlement_service_line l
             WHERE l.store_code = $1
             ORDER BY l.settlement_id DESC, l.line_no ASC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("정산 시술 라인 조회 실패: {e}"))?;

    let payment_rows = client
        .query(
            r#"
            SELECT
                p.settlement_id::BIGINT,
                p.line_no::INTEGER,
                p.payment_method_code,
                p.amount::BIGINT,
                p.coupon_service_id::BIGINT
              FROM sales_settlement_payment_line p
             WHERE p.store_code = $1
             ORDER BY p.settlement_id DESC, p.line_no ASC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("정산 결제 라인 조회 실패: {e}"))?;

    let mut service_map: HashMap<i64, Vec<(i32, i64)>> = HashMap::new();
    for row in service_rows {
        let settlement_id = row.get::<_, i64>(0);
        let line_no = row.get::<_, i32>(1);
        let service_id = row.get::<_, i64>(2);
        service_map
            .entry(settlement_id)
            .or_default()
            .push((line_no, service_id));
    }

    let mut payment_map: HashMap<i64, Vec<(i32, SalesSettlementPaymentDto)>> = HashMap::new();
    for row in payment_rows {
        let settlement_id = row.get::<_, i64>(0);
        let line_no = row.get::<_, i32>(1);
        let payment = SalesSettlementPaymentDto {
            payment_method_code: row.get::<_, String>(2),
            amount: row.get::<_, i64>(3),
            coupon_service_id: row.get::<_, Option<i64>>(4),
        };
        payment_map
            .entry(settlement_id)
            .or_default()
            .push((line_no, payment));
    }

    let settlements = settlement_rows
        .into_iter()
        .map(|row| {
            let settlement_id = row.get::<_, i64>(0);
            let mut service_lines = service_map.remove(&settlement_id).unwrap_or_default();
            service_lines.sort_by_key(|line| line.0);
            let service_ids = service_lines
                .into_iter()
                .map(|line| line.1)
                .collect::<Vec<_>>();

            let mut payment_lines = payment_map.remove(&settlement_id).unwrap_or_default();
            payment_lines.sort_by_key(|line| line.0);
            let payments = payment_lines
                .into_iter()
                .map(|line| line.1)
                .collect::<Vec<_>>();

            SalesSettlementDto {
                settlement_id,
                settlement_datetime: row.get::<_, String>(1),
                member_user_id: row.get::<_, Option<String>>(2),
                manager_employee_id: row.get::<_, i64>(3),
                total_amount: row.get::<_, i64>(4),
                total_time_minutes: row.get::<_, i32>(5),
                status: row.get::<_, String>(6),
                reservation_ref: row.get::<_, Option<String>>(7),
                guest_customer_name: row.get::<_, Option<String>>(8),
                guest_customer_phone: row.get::<_, Option<String>>(9),
                cancel_type: row.get::<_, Option<String>>(10),
                cancel_reason: row.get::<_, Option<String>>(11),
                cancelled_at: row.get::<_, Option<String>>(12),
                service_ids,
                payments,
            }
        })
        .collect::<Vec<_>>();

    Ok(SalesSettlementDataResult {
        success: true,
        message: "정산 조회 완료".to_string(),
        settlements,
    })
}

// 정산 건별 쿠폰 사용내역을 식별하기 위한 메모 키를 생성합니다.
fn build_sales_coupon_usage_memo(settlement_id: i64, line_no: i32) -> String {
    format!("{SALES_COUPON_USAGE_MEMO_PREFIX}{settlement_id}:{line_no}")
}

// 특정 정산 건의 쿠폰 사용내역을 일괄 조회/삭제할 때 사용하는 패턴입니다.
fn build_sales_coupon_usage_memo_pattern(settlement_id: i64) -> String {
    format!("{SALES_COUPON_USAGE_MEMO_PREFIX}{settlement_id}:%")
}

// 정산 건별 잔액 사용내역을 식별하기 위한 메모 키를 생성합니다.
fn build_sales_balance_usage_memo(settlement_id: i64, line_no: i32) -> String {
    format!("{SALES_BALANCE_USAGE_MEMO_PREFIX}{settlement_id}:{line_no}")
}

// 특정 정산 건의 잔액 사용내역을 일괄 조회/삭제할 때 사용하는 패턴입니다.
fn build_sales_balance_usage_memo_pattern(settlement_id: i64) -> String {
    format!("{SALES_BALANCE_USAGE_MEMO_PREFIX}{settlement_id}:%")
}

// 결제수단 코드가 회원 잔액 차감 로직 대상인지 판별합니다.
fn is_sales_balance_payment_code(code: &str) -> bool {
    code == "PREPAID" || code == "MEMBERSHIP"
}

// 정산 취소/수정 전에 과거 잔액 사용분을 원복합니다.
async fn restore_sales_settlement_balance_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
) -> Result<(), String> {
    let memo_pattern = build_sales_balance_usage_memo_pattern(settlement_id);
    let usage_rows = tx
        .query(
            r#"
            SELECT
                id::BIGINT,
                user_id::BIGINT,
                COALESCE(amount, 0)::BIGINT
              FROM member_point_usage_history
             WHERE store_code = $1
               AND use_type = 'BALANCE'
               AND memo LIKE $2
             ORDER BY id
             FOR UPDATE
            "#,
            &[&store_code, &memo_pattern],
        )
        .await
        .map_err(|e| format!("정산 충전금 사용 이력 조회 실패: {e}"))?;

    for row in usage_rows {
        let usage_id = row.get::<_, i64>(0);
        let user_id = row.get::<_, i64>(1);
        let amount = row.get::<_, i64>(2);
        if amount <= 0 {
            return Err(format!(
                "정산 충전금 사용 이력의 금액 정보가 올바르지 않습니다. (usage_id={usage_id})"
            ));
        }

        tx.execute(
            r#"
            INSERT INTO member_point_balance (store_code, user_id, point_balance)
            VALUES ($1,$2,$3)
            ON CONFLICT (store_code, user_id)
            DO UPDATE SET
                point_balance = member_point_balance.point_balance + EXCLUDED.point_balance,
                updated_at = NOW()
            "#,
            &[&store_code, &user_id, &amount],
        )
        .await
        .map_err(|e| format!("정산 충전금 원복 처리 실패: {e}"))?;
    }

    tx.execute(
        r#"
        DELETE FROM member_point_usage_history
         WHERE store_code = $1
           AND use_type = 'BALANCE'
           AND memo LIKE $2
        "#,
        &[&store_code, &memo_pattern],
    )
    .await
    .map_err(|e| format!("정산 충전금 사용 이력 정리 실패: {e}"))?;

    Ok(())
}

// 정산 취소/수정 전에 과거 쿠폰 사용분을 원복합니다.
async fn restore_sales_settlement_coupon_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
) -> Result<(), String> {
    let memo_pattern = build_sales_coupon_usage_memo_pattern(settlement_id);
    let usage_rows = tx
        .query(
            r#"
            SELECT
                id::BIGINT,
                user_id::BIGINT,
                service_id::BIGINT,
                COALESCE(coupon_count, 0)::INTEGER
              FROM member_point_usage_history
             WHERE store_code = $1
               AND use_type = 'COUPON'
               AND memo LIKE $2
             ORDER BY id
             FOR UPDATE
            "#,
            &[&store_code, &memo_pattern],
        )
        .await
        .map_err(|e| format!("정산 쿠폰 사용 이력 조회 실패: {e}"))?;

    for row in usage_rows {
        let usage_id = row.get::<_, i64>(0);
        let user_id = row.get::<_, i64>(1);
        let service_id = row.get::<_, Option<i64>>(2).ok_or_else(|| {
            format!("정산 쿠폰 사용 이력의 시술 정보가 없습니다. (usage_id={usage_id})")
        })?;
        if service_id <= 0 {
            return Err(format!(
                "정산 쿠폰 사용 이력의 시술 정보가 올바르지 않습니다. (usage_id={usage_id})"
            ));
        }
        let coupon_count = row.get::<_, i32>(3);
        if coupon_count <= 0 {
            return Err(format!(
                "정산 쿠폰 사용 이력의 횟수 정보가 올바르지 않습니다. (usage_id={usage_id})"
            ));
        }

        tx.execute(
            r#"
            INSERT INTO member_coupon_balance (store_code, user_id, service_id, coupon_count)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (store_code, user_id, service_id)
            DO UPDATE SET
                coupon_count = member_coupon_balance.coupon_count + EXCLUDED.coupon_count,
                updated_at = NOW()
            "#,
            &[&store_code, &user_id, &service_id, &coupon_count],
        )
        .await
        .map_err(|e| format!("정산 쿠폰 원복 처리 실패: {e}"))?;
    }

    tx.execute(
        r#"
        DELETE FROM member_point_usage_history
         WHERE store_code = $1
           AND use_type = 'COUPON'
           AND memo LIKE $2
        "#,
        &[&store_code, &memo_pattern],
    )
    .await
    .map_err(|e| format!("정산 쿠폰 사용 이력 정리 실패: {e}"))?;

    Ok(())
}

// 정산 저장 시 쿠폰 결제 라인을 회원 쿠폰 사용 이력/잔액에 반영합니다.
async fn apply_sales_settlement_coupon_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
    member_user_id: i64,
    coupon_usage_lines: &[(i32, i64, i32)],
) -> Result<(), String> {
    for (line_no, service_id, coupon_count) in coupon_usage_lines {
        if *service_id <= 0 {
            return Err("쿠폰 결제 시술 정보가 올바르지 않습니다.".to_string());
        }
        if *coupon_count <= 0 {
            return Err("쿠폰 사용 횟수는 1 이상이어야 합니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE member_coupon_balance
                   SET coupon_count = coupon_count - $4,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND user_id = $2
                   AND service_id = $3
                   AND coupon_count >= $4
                "#,
                &[&store_code, &member_user_id, service_id, coupon_count],
            )
            .await
            .map_err(|e| format!("정산 쿠폰 차감 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("쿠폰 잔여 횟수가 부족하여 결제완료 처리할 수 없습니다.".to_string());
        }

        let use_type = "COUPON".to_string();
        let amount_option: Option<i64> = None;
        let service_id_option: Option<i64> = Some(*service_id);
        let coupon_count_option: Option<i32> = Some(*coupon_count);
        let memo = build_sales_coupon_usage_memo(settlement_id, *line_no);

        tx.execute(
            r#"
            INSERT INTO member_point_usage_history (
                store_code, user_id, use_type, amount, service_id, coupon_count, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            "#,
            &[
                &store_code,
                &member_user_id,
                &use_type,
                &amount_option,
                &service_id_option,
                &coupon_count_option,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("정산 쿠폰 사용 이력 저장 실패: {e}"))?;
    }

    Ok(())
}

// 정산 저장 시 잔액 결제 라인을 회원 포인트 사용 이력/잔액에 반영합니다.
async fn apply_sales_settlement_balance_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
    member_user_id: i64,
    balance_usage_lines: &[(i32, i64)],
) -> Result<(), String> {
    for (line_no, amount) in balance_usage_lines {
        if *amount <= 0 {
            return Err("충전금 사용 금액은 1원 이상이어야 합니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE member_point_balance
                   SET point_balance = point_balance - $3,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND user_id = $2
                   AND point_balance >= $3
                "#,
                &[&store_code, &member_user_id, amount],
            )
            .await
            .map_err(|e| format!("정산 충전금 차감 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("충전 잔액이 부족하여 결제완료 처리할 수 없습니다.".to_string());
        }

        let use_type = "BALANCE".to_string();
        let amount_option: Option<i64> = Some(*amount);
        let none_service_id: Option<i64> = None;
        let none_coupon_count: Option<i32> = None;
        let memo = build_sales_balance_usage_memo(settlement_id, *line_no);

        tx.execute(
            r#"
            INSERT INTO member_point_usage_history (
                store_code, user_id, use_type, amount, service_id, coupon_count, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            "#,
            &[
                &store_code,
                &member_user_id,
                &use_type,
                &amount_option,
                &none_service_id,
                &none_coupon_count,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("정산 충전금 사용 이력 저장 실패: {e}"))?;
    }

    Ok(())
}

// 시술 정산 데이터를 생성/수정하고 포인트/쿠폰 사용 내역을 동기화합니다.
#[tauri::command]
async fn upsert_sales_settlement(
    payload: UpsertSalesSettlementPayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let settlement = payload.settlement;
    let is_update = settlement.settlement_id.is_some();

    if settlement.manager_employee_id <= 0 {
        return Err("manager_employee_id는 1 이상이어야 합니다.".to_string());
    }
    if settlement.service_ids.is_empty() {
        return Err("service_ids는 1건 이상이어야 합니다.".to_string());
    }

    let status = settlement.status.trim().to_uppercase();
    if status != "PROCESSING" && status != "COMPLETED" {
        return Err("status는 PROCESSING 또는 COMPLETED 이어야 합니다.".to_string());
    }

    let mut member_identifier = settlement
        .member_user_id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut resolved_member_user_id: Option<i64> = None;
    let mut member_snapshot_name: Option<String> = None;
    let mut member_snapshot_phone: Option<String> = None;

    if let Some(identifier) = member_identifier.as_deref() {
        if let Some((member_user_id, member_name, member_phone)) =
            resolve_member_snapshot_by_identifier(&client, &store_code, identifier).await?
        {
            resolved_member_user_id = Some(member_user_id);
            member_snapshot_name = Some(member_name.trim().to_string()).filter(|value| !value.is_empty());
            member_snapshot_phone = member_phone
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());

            // 회원 정산은 member_user_id 컬럼에 회원 전화번호(없으면 이름)를 저장한다.
            member_identifier = member_snapshot_phone
                .clone()
                .or_else(|| member_snapshot_name.clone());
        }
    }

    let manager_exists = client
        .query_opt(
            "SELECT 1 FROM employee_management WHERE store_code = $1 AND employee_id::BIGINT = $2",
            &[&store_code, &settlement.manager_employee_id],
        )
        .await
        .map_err(|e| format!("담당자 확인 실패: {e}"))?;
    if manager_exists.is_none() {
        return Err("선택한 점포의 담당자가 존재하지 않습니다.".to_string());
    }

    let mut unique_service_ids = Vec::<i64>::new();
    let mut seen_service_ids = HashSet::<i64>::new();
    for service_id in &settlement.service_ids {
        if *service_id <= 0 {
            return Err("service_ids에는 1 이상의 값만 사용할 수 있습니다.".to_string());
        }
        if seen_service_ids.insert(*service_id) {
            unique_service_ids.push(*service_id);
        }
    }

    let service_rows = client
        .query(
            r#"
            SELECT
                s.service_id::BIGINT,
                s.service_name,
                s.category_code,
                COALESCE(cc.detail_name, s.category_code) AS category_name,
                s.unit_price::BIGINT,
                s.duration_minutes::INTEGER
              FROM service_catalog_management s
         LEFT JOIN common_code_detail cc
                ON cc.group_code_id = 'T_CATEGORY'
               AND cc.detail_code = s.category_code
             WHERE s.store_code = $1
               AND s.use_yn = 'Y'
               AND s.service_id::BIGINT = ANY($2::BIGINT[])
            "#,
            &[&store_code, &unique_service_ids],
        )
        .await
        .map_err(|e| format!("시술 항목 확인 실패: {e}"))?;

    let mut service_map = HashMap::<i64, (String, String, String, i64, i32)>::new();
    for row in service_rows {
        let service_id = row.get::<_, i64>(0);
        service_map.insert(
            service_id,
            (
                row.get::<_, String>(1),
                row.get::<_, String>(2),
                row.get::<_, String>(3),
                row.get::<_, i64>(4),
                row.get::<_, i32>(5),
            ),
        );
    }

    for service_id in &unique_service_ids {
        if !service_map.contains_key(service_id) {
            return Err("선택한 시술 항목이 존재하지 않거나 사용중이 아닙니다.".to_string());
        }
    }

    let mut total_amount: i64 = 0;
    let mut total_time_minutes: i32 = 0;
    for service_id in &settlement.service_ids {
        let Some(snapshot) = service_map.get(service_id) else {
            return Err("시술 항목 계산 중 데이터가 유실되었습니다.".to_string());
        };
        total_amount += snapshot.3;
        total_time_minutes += snapshot.4;
    }

    let payment_method_rows = client
        .query(
            r#"
            SELECT detail_code, detail_name
              FROM common_code_detail
             WHERE group_code_id = 'PAYMENT_METHOD'
               AND use_yn = 'Y'
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("결제수단 확인 실패: {e}"))?;

    let mut payment_method_map = HashMap::<String, String>::new();
    for row in payment_method_rows {
        let code = row.get::<_, String>(0).trim().to_uppercase();
        let name = row.get::<_, String>(1);
        payment_method_map.insert(code, name);
    }

    #[derive(Clone)]
    struct PaymentInsertLine {
        payment_method_code: String,
        payment_method_name: String,
        amount: i64,
        coupon_service_id: Option<i64>,
        coupon_service_name: Option<String>,
    }

    let mut insert_payment_lines = Vec::<PaymentInsertLine>::new();
    let mut paid_total: i64 = 0;
    let mut coupon_service_ids = HashSet::<i64>::new();
    let mut selected_service_count_map = HashMap::<i64, i32>::new();
    for service_id in &settlement.service_ids {
        *selected_service_count_map.entry(*service_id).or_insert(0) += 1;
    }
    let mut coupon_usage_count_map = HashMap::<i64, i32>::new();

    for payment in &settlement.payments {
        let code = payment.payment_method_code.trim().to_uppercase();
        if code.is_empty() {
            return Err("결제수단 코드는 필수입니다.".to_string());
        }
        let Some(method_name) = payment_method_map.get(&code) else {
            return Err(
                "PAYMENT_METHOD 공통코드에 등록된 사용중 결제수단만 사용할 수 있습니다."
                    .to_string(),
            );
        };

        if payment.amount < 0 {
            return Err("결제 금액은 0 이상이어야 합니다.".to_string());
        }
        if resolved_member_user_id.is_none()
            && (is_sales_balance_payment_code(&code) || code == "COUPON")
        {
            return Err(
                "일반 방문객은 MEMBERSHIP/PREPAID 또는 COUPON 결제를 사용할 수 없습니다."
                    .to_string(),
            );
        }

        let coupon_service_id = if code == "COUPON" {
            let Some(coupon_service_id) = payment.coupon_service_id else {
                return Err("COUPON 결제 시 coupon_service_id는 필수입니다.".to_string());
            };
            if coupon_service_id <= 0 {
                return Err("coupon_service_id는 1 이상이어야 합니다.".to_string());
            }
            let selected_count = selected_service_count_map
                .get(&coupon_service_id)
                .copied()
                .unwrap_or(0);
            if selected_count <= 0 {
                return Err(
                    "쿠폰 결제 시술은 이번 정산의 시술 항목에 포함되어야 합니다.".to_string(),
                );
            }
            let next_coupon_count = coupon_usage_count_map
                .entry(coupon_service_id)
                .and_modify(|count| *count += 1)
                .or_insert(1);
            if *next_coupon_count > selected_count {
                return Err(
                    "동일 시술에 대한 쿠폰 사용 횟수가 시술 건수를 초과했습니다.".to_string(),
                );
            }
            coupon_service_ids.insert(coupon_service_id);
            Some(coupon_service_id)
        } else {
            None
        };

        paid_total += payment.amount;
        insert_payment_lines.push(PaymentInsertLine {
            payment_method_code: code,
            payment_method_name: method_name.clone(),
            amount: payment.amount,
            coupon_service_id,
            coupon_service_name: None,
        });
    }

    if status == "COMPLETED" && paid_total > total_amount {
        return Err("결제 완료 시 결제 금액 합계가 총 금액을 초과할 수 없습니다.".to_string());
    }

    if !coupon_service_ids.is_empty() {
        let coupon_service_id_vec = coupon_service_ids.into_iter().collect::<Vec<_>>();
        let coupon_service_rows = client
            .query(
                r#"
                SELECT service_id::BIGINT, service_name
                  FROM service_catalog_management
                 WHERE store_code = $1
                   AND service_id::BIGINT = ANY($2::BIGINT[])
                "#,
                &[&store_code, &coupon_service_id_vec],
            )
            .await
            .map_err(|e| format!("쿠폰 시술 확인 실패: {e}"))?;

        let mut coupon_service_map = HashMap::<i64, String>::new();
        for row in coupon_service_rows {
            coupon_service_map.insert(row.get::<_, i64>(0), row.get::<_, String>(1));
        }

        for payment in insert_payment_lines.iter_mut() {
            if let Some(coupon_service_id) = payment.coupon_service_id {
                let Some(name) = coupon_service_map.get(&coupon_service_id) else {
                    return Err("쿠폰 결제에 연결된 시술이 존재하지 않습니다.".to_string());
                };
                payment.coupon_service_name = Some(name.clone());
            }
        }
    }

    let reservation_ref = settlement
        .reservation_ref
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut guest_customer_name = settlement
        .guest_customer_name
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut guest_customer_phone = settlement
        .guest_customer_phone
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if resolved_member_user_id.is_some() {
        // 회원 정산도 고객명/전화번호 스냅샷을 함께 저장해 이름/전화 기반 조회를 지원한다.
        guest_customer_name = member_snapshot_name;
        guest_customer_phone = member_snapshot_phone;
    }

    if let Some(identifier) = member_identifier.as_ref() {
        if identifier.chars().count() > 100 {
            return Err("member_user_id는 100자 이하여야 합니다.".to_string());
        }
    }

    if let Some(name) = guest_customer_name.as_ref() {
        if name.chars().count() > 100 {
            return Err("guest_customer_name은 100자 이하여야 합니다.".to_string());
        }
    }
    if let Some(phone) = guest_customer_phone.as_ref() {
        if phone.chars().count() > 30 {
            return Err("guest_customer_phone은 30자 이하여야 합니다.".to_string());
        }
    }

    // 정산이 예약건에서 시작된 경우 reservation_ref를 예약 PK로 파싱해 존재 여부를 먼저 검증한다.
    let linked_reservation_id = if let Some(reservation_ref_value) = reservation_ref.as_ref() {
        let parsed_reservation_id = reservation_ref_value
            .parse::<i64>()
            .map_err(|_| "reservation_ref는 예약 ID(숫자)여야 합니다.".to_string())?;
        if parsed_reservation_id <= 0 {
            return Err("reservation_ref는 1 이상의 예약 ID여야 합니다.".to_string());
        }

        let reservation_exists = client
            .query_opt(
                r#"
                SELECT 1
                  FROM reservation_calendar_management
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&parsed_reservation_id, &store_code],
            )
            .await
            .map_err(|e| format!("예약 연동 대상 확인 실패: {e}"))?;

        if reservation_exists.is_none() {
            return Err("연동할 예약 데이터가 존재하지 않습니다.".to_string());
        }

        Some(parsed_reservation_id)
    } else {
        None
    };

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("시술 정산 저장 트랜잭션 시작 실패: {e}"))?;

    let settlement_id = if let Some(settlement_id) = settlement.settlement_id {
        if settlement_id <= 0 {
            return Err("settlement_id는 1 이상이어야 합니다.".to_string());
        }

        restore_sales_settlement_balance_usage(&tx, &store_code, settlement_id).await?;
        restore_sales_settlement_coupon_usage(&tx, &store_code, settlement_id).await?;

        let affected = tx
            .execute(
                r#"
                UPDATE sales_settlement_management
                   SET member_user_id = $3,
                       manager_employee_id = $4,
                       total_amount = $5,
                       total_time_minutes = $6,
                       status = $7,
                       reservation_ref = $8,
                       guest_customer_name = $9,
                       guest_customer_phone = $10,
                       cancel_type = NULL,
                       cancel_reason = NULL,
                       cancelled_at = NULL,
                       updated_at = NOW()
                 WHERE settlement_id = $1
                   AND store_code = $2
                "#,
                &[
                    &settlement_id,
                    &store_code,
                    &member_identifier,
                    &settlement.manager_employee_id,
                    &total_amount,
                    &total_time_minutes,
                    &status,
                    &reservation_ref,
                    &guest_customer_name,
                    &guest_customer_phone,
                ],
            )
            .await
            .map_err(|e| format!("정산 수정 실패: {e}"))?;

        if affected == 0 {
            return Err("수정 대상 정산 데이터가 없습니다.".to_string());
        }

        tx.execute(
            "DELETE FROM sales_settlement_service_line WHERE settlement_id = $1 AND store_code = $2",
            &[&settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("기존 시술 라인 정리 실패: {e}"))?;

        tx.execute(
            "DELETE FROM sales_settlement_payment_line WHERE settlement_id = $1 AND store_code = $2",
            &[&settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("기존 결제 라인 정리 실패: {e}"))?;

        settlement_id
    } else {
        tx.query_one(
            r#"
            INSERT INTO sales_settlement_management (
                store_code,
                member_user_id,
                manager_employee_id,
                total_amount,
                total_time_minutes,
                status,
                reservation_ref,
                guest_customer_name,
                guest_customer_phone,
                cancel_type,
                cancel_reason,
                cancelled_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)
            RETURNING settlement_id::BIGINT
            "#,
            &[
                &store_code,
                &member_identifier,
                &settlement.manager_employee_id,
                &total_amount,
                &total_time_minutes,
                &status,
                &reservation_ref,
                &guest_customer_name,
                &guest_customer_phone,
            ],
        )
        .await
        .map_err(|e| format!("정산 등록 실패: {e}"))?
        .get::<_, i64>(0)
    };

    for (index, service_id) in settlement.service_ids.iter().enumerate() {
        let Some(snapshot) = service_map.get(service_id) else {
            return Err("시술 라인 저장 중 데이터가 유실되었습니다.".to_string());
        };
        let line_no = (index + 1) as i32;
        tx.execute(
            r#"
            INSERT INTO sales_settlement_service_line (
                store_code,
                settlement_id,
                line_no,
                service_id,
                service_name,
                category_code,
                category_name,
                unit_price,
                duration_minutes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &settlement_id,
                &line_no,
                service_id,
                &snapshot.0,
                &snapshot.1,
                &snapshot.2,
                &snapshot.3,
                &snapshot.4,
            ],
        )
        .await
        .map_err(|e| format!("시술 라인 저장 실패: {e}"))?;
    }

    for (index, payment) in insert_payment_lines.iter().enumerate() {
        let line_no = (index + 1) as i32;
        tx.execute(
            r#"
            INSERT INTO sales_settlement_payment_line (
                store_code,
                settlement_id,
                line_no,
                payment_method_code,
                payment_method_name,
                amount,
                coupon_service_id,
                coupon_service_name
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            "#,
            &[
                &store_code,
                &settlement_id,
                &line_no,
                &payment.payment_method_code,
                &payment.payment_method_name,
                &payment.amount,
                &payment.coupon_service_id,
                &payment.coupon_service_name,
            ],
        )
        .await
        .map_err(|e| format!("결제 라인 저장 실패: {e}"))?;
    }

    let coupon_usage_lines = insert_payment_lines
        .iter()
        .enumerate()
        .filter_map(|(index, payment)| {
            payment
                .coupon_service_id
                .map(|service_id| ((index + 1) as i32, service_id, 1_i32))
        })
        .collect::<Vec<_>>();
    let balance_usage_lines = insert_payment_lines
        .iter()
        .enumerate()
        .filter_map(|(index, payment)| {
            if is_sales_balance_payment_code(&payment.payment_method_code) && payment.amount > 0 {
                Some(((index + 1) as i32, payment.amount))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if status == "COMPLETED" && (!coupon_usage_lines.is_empty() || !balance_usage_lines.is_empty())
    {
        let Some(member_user_id) = resolved_member_user_id else {
            return Err("회원 충전금/쿠폰 결제는 회원 지정이 필요합니다.".to_string());
        };

        if !balance_usage_lines.is_empty() {
            apply_sales_settlement_balance_usage(
                &tx,
                &store_code,
                settlement_id,
                member_user_id,
                &balance_usage_lines,
            )
            .await?;
        }

        if !coupon_usage_lines.is_empty() {
            apply_sales_settlement_coupon_usage(
                &tx,
                &store_code,
                settlement_id,
                member_user_id,
                &coupon_usage_lines,
            )
            .await?;
        }
    }

    // 예약 연동 건이면 정산 상태를 예약 상태에도 동기화한다.
    if let Some(reservation_id) = linked_reservation_id {
        let affected = tx
            .execute(
                r#"
                UPDATE reservation_calendar_management
                   SET status_code = $3,
                       updated_at = NOW()
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&reservation_id, &store_code, &status],
            )
            .await
            .map_err(|e| format!("예약 상태 동기화 실패: {e}"))?;

        if affected == 0 {
            return Err("예약 상태를 동기화할 대상 예약이 없습니다.".to_string());
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("시술 정산 저장 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: if is_update {
            "시술 정산 수정 완료".to_string()
        } else {
            "시술 정산 등록 완료".to_string()
        },
    })
}

// 정산 취소 처리 및 연관 포인트/쿠폰 사용 내역을 원복합니다.
#[tauri::command]
async fn cancel_sales_settlement(
    payload: CancelSalesSettlementPayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.settlement_id <= 0 {
        return Err("취소할 settlement_id가 올바르지 않습니다.".to_string());
    }

    let cancel_type = payload.cancel_type.trim().to_uppercase();
    if cancel_type != "PAYMENT" && cancel_type != "PROCEDURE" {
        return Err("cancel_type은 PAYMENT 또는 PROCEDURE 이어야 합니다.".to_string());
    }

    let cancel_reason = payload.cancel_reason.trim().to_string();
    if cancel_reason.is_empty() {
        return Err("취소 사유는 필수입니다.".to_string());
    }

    let settlement_row = client
        .query_opt(
            r#"
            SELECT status, reservation_ref
              FROM sales_settlement_management
             WHERE settlement_id = $1
               AND store_code = $2
            "#,
            &[&payload.settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("취소 대상 정산 조회 실패: {e}"))?;

    let Some(settlement_row) = settlement_row else {
        return Err("취소 대상 정산 데이터가 없습니다.".to_string());
    };

    let current_status = settlement_row.get::<_, String>(0).trim().to_uppercase();
    if current_status == "CANCELLED" {
        return Err("이미 취소된 매출입니다.".to_string());
    }
    if cancel_type == "PAYMENT" && current_status != "COMPLETED" {
        return Err("결제취소는 결제완료 상태에서만 가능합니다.".to_string());
    }

    let reservation_ref = settlement_row
        .get::<_, Option<String>>(1)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let linked_reservation_id = if let Some(reservation_ref_value) = reservation_ref.as_ref() {
        let parsed_reservation_id = reservation_ref_value
            .parse::<i64>()
            .map_err(|_| "reservation_ref는 예약 ID(숫자)여야 합니다.".to_string())?;
        if parsed_reservation_id <= 0 {
            return Err("reservation_ref는 1 이상의 예약 ID여야 합니다.".to_string());
        }

        let reservation_exists = client
            .query_opt(
                r#"
                SELECT 1
                  FROM reservation_calendar_management
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&parsed_reservation_id, &store_code],
            )
            .await
            .map_err(|e| format!("취소 연동 예약 조회 실패: {e}"))?;

        if reservation_exists.is_none() {
            return Err("연동된 예약 데이터가 존재하지 않습니다.".to_string());
        }

        Some(parsed_reservation_id)
    } else {
        None
    };

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("취소 처리 트랜잭션 시작 실패: {e}"))?;

    let affected = tx
        .execute(
            r#"
            UPDATE sales_settlement_management
               SET status = 'CANCELLED',
                   cancel_type = $3,
                   cancel_reason = $4,
                   cancelled_at = NOW(),
                   updated_at = NOW()
             WHERE settlement_id = $1
               AND store_code = $2
            "#,
            &[
                &payload.settlement_id,
                &store_code,
                &cancel_type,
                &cancel_reason,
            ],
        )
        .await
        .map_err(|e| format!("정산 취소 처리 실패: {e}"))?;

    if affected == 0 {
        return Err("취소 대상 정산 데이터가 없습니다.".to_string());
    }

    if current_status == "COMPLETED" {
        restore_sales_settlement_balance_usage(&tx, &store_code, payload.settlement_id).await?;
        restore_sales_settlement_coupon_usage(&tx, &store_code, payload.settlement_id).await?;
    }

    if let Some(reservation_id) = linked_reservation_id {
        let affected = tx
            .execute(
                r#"
                UPDATE reservation_calendar_management
                   SET status_code = 'CANCELLED',
                       updated_at = NOW()
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&reservation_id, &store_code],
            )
            .await
            .map_err(|e| format!("예약 취소 상태 동기화 실패: {e}"))?;

        if affected == 0 {
            return Err("예약 상태를 갱신할 대상 예약이 없습니다.".to_string());
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("취소 처리 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: if cancel_type == "PAYMENT" {
            "결제취소 완료".to_string()
        } else {
            "시술취소 완료".to_string()
        },
    })
}

// 정산 데이터를 영구 삭제합니다.
#[tauri::command]
async fn delete_sales_settlement(
    payload: DeleteSalesSettlementPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.settlement_id <= 0 {
        return Err("삭제할 settlement_id가 올바르지 않습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM sales_settlement_management WHERE settlement_id = $1 AND store_code = $2",
            &[&payload.settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("정산 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 정산 데이터가 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "시술 정산 삭제 완료".to_string(),
    })
}


