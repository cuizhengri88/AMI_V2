// 회원 포인트/쿠폰 충전·사용·취소 도메인 Tauri 명령입니다.

// 회원 포인트/쿠폰 잔액과 이력 데이터를 조회합니다.
#[tauri::command]
async fn get_member_point_management_data(
    payload: MemberPointQueryPayload,
) -> Result<MemberPointDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;
    let include_histories = payload.include_histories.unwrap_or(true);

    let member_rows = client
        .query(
            r#"
            SELECT
                u.user_id::BIGINT,
                u.name,
                u.phone,
                COALESCE(pb.point_balance, 0)::BIGINT AS point_balance
              FROM user_management u
         LEFT JOIN member_point_balance pb
                ON pb.store_code = $1
               AND pb.user_id = u.user_id
             WHERE u.store_code = $1
             ORDER BY u.user_id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("회원 포인트 회원 조회 실패: {e}"))?;

    let coupon_rows = client
        .query(
            r#"
            SELECT
                cb.user_id::BIGINT,
                cb.service_id::BIGINT,
                s.service_name,
                cb.coupon_count
              FROM member_coupon_balance cb
              JOIN service_catalog_management s
                ON s.service_id = cb.service_id
               AND s.store_code = cb.store_code
             WHERE cb.store_code = $1
               AND cb.coupon_count > 0
             ORDER BY cb.user_id, cb.service_id
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("회원 포인트 쿠폰 조회 실패: {e}"))?;

    let mut coupon_map: HashMap<i64, Vec<MemberPointCouponDto>> = HashMap::new();
    for row in coupon_rows {
        let user_id = row.get::<_, i64>(0);
        let coupon = MemberPointCouponDto {
            service_id: row.get::<_, i64>(1),
            service_name: row.get::<_, String>(2),
            count: row.get::<_, i32>(3),
        };
        coupon_map.entry(user_id).or_default().push(coupon);
    }

    let members = member_rows
        .into_iter()
        .map(|row| {
            let user_id = row.get::<_, i64>(0);
            MemberPointMemberDto {
                user_id,
                user_name: row.get::<_, String>(1),
                phone: row.get::<_, Option<String>>(2),
                point_balance: row.get::<_, i64>(3),
                coupons: coupon_map.remove(&user_id).unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();

    let histories = if include_histories {
        let history_rows = client
            .query(
                r#"
                SELECT
                    x.id::BIGINT,
                    x.action_type,
                    x.user_id::BIGINT,
                    x.user_name,
                    x.user_phone,
                    x.recharge_type,
                    x.amount::BIGINT,
                    x.received_amount::BIGINT,
                    x.service_id::BIGINT,
                    x.service_name,
                    x.coupon_count,
                    x.payment_method_code,
                    x.payment_method_name,
                    x.memo,
                    x.created_at::TEXT,
                    x.is_cancelled,
                    x.cancel_reason,
                    x.cancelled_at
                  FROM (
                        SELECT
                            h.id,
                            'RECHARGE'::TEXT AS action_type,
                            h.user_id,
                            u.name AS user_name,
                            u.phone AS user_phone,
                            h.recharge_type,
                            h.amount,
                            h.received_amount,
                            h.service_id,
                            s.service_name,
                            h.coupon_count,
                            h.payment_method_code,
                            COALESCE(pm.detail_name, h.payment_method_code) AS payment_method_name,
                            COALESCE(h.memo, '') AS memo,
                            h.created_at,
                            (h.status_code = 'CANCELLED') AS is_cancelled,
                            h.cancel_reason,
                            TO_CHAR(h.cancelled_at, 'YYYY-MM-DD HH24:MI:SS') AS cancelled_at
                          FROM member_point_history h
                          JOIN user_management u
                            ON u.user_id = h.user_id
                           AND u.store_code = h.store_code
                     LEFT JOIN service_catalog_management s
                            ON s.service_id = h.service_id
                           AND s.store_code = h.store_code
                     LEFT JOIN common_code_detail pm
                            ON pm.group_code_id = 'PAYMENT_METHOD'
                            AND pm.detail_code = h.payment_method_code
                          WHERE h.store_code = $1

                        UNION ALL

                        SELECT
                            uh.id,
                            'USE'::TEXT AS action_type,
                            uh.user_id,
                            u.name AS user_name,
                            u.phone AS user_phone,
                            uh.use_type AS recharge_type,
                            uh.amount,
                            NULL::BIGINT AS received_amount,
                            uh.service_id,
                            s.service_name,
                            uh.coupon_count,
                            'USE'::TEXT AS payment_method_code,
                            '사용'::TEXT AS payment_method_name,
                            COALESCE(uh.memo, '') AS memo,
                            uh.created_at,
                            FALSE AS is_cancelled,
                            NULL::TEXT AS cancel_reason,
                            NULL::TEXT AS cancelled_at
                          FROM member_point_usage_history uh
                          JOIN user_management u
                            ON u.user_id = uh.user_id
                           AND u.store_code = uh.store_code
                     LEFT JOIN service_catalog_management s
                            ON s.service_id = uh.service_id
                           AND s.store_code = uh.store_code
                         WHERE uh.store_code = $1
                       ) x
                 ORDER BY x.created_at DESC, x.id DESC
                "#,
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원 포인트 이력 조회 실패: {e}"))?;

        history_rows
            .into_iter()
            .map(|row| MemberPointHistoryDto {
                id: row.get::<_, i64>(0),
                action_type: row.get::<_, String>(1),
                user_id: row.get::<_, i64>(2),
                user_name: row.get::<_, String>(3),
                user_phone: row.get::<_, Option<String>>(4),
                recharge_type: row.get::<_, String>(5),
                amount: row.get::<_, Option<i64>>(6),
                received_amount: row.get::<_, Option<i64>>(7),
                service_id: row.get::<_, Option<i64>>(8),
                service_name: row.get::<_, Option<String>>(9),
                coupon_count: row.get::<_, Option<i32>>(10),
                payment_method_code: row.get::<_, String>(11),
                payment_method_name: row.get::<_, String>(12),
                memo: row.get::<_, String>(13),
                created_at: row.get::<_, String>(14),
                is_cancelled: row.get::<_, bool>(15),
                cancel_reason: row.get::<_, Option<String>>(16),
                cancelled_at: row.get::<_, Option<String>>(17),
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    Ok(MemberPointDataResult {
        success: true,
        message: "회원 포인트 조회 완료".to_string(),
        members,
        histories,
    })
}

// 포인트/쿠폰 충전을 기록하고 잔액을 반영합니다.
#[tauri::command]
async fn recharge_member_point(
    payload: RechargeMemberPointPayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let recharge = payload.recharge;
    if recharge.user_id <= 0 {
        return Err("user_id는 1 이상이어야 합니다.".to_string());
    }

    let recharge_type = recharge.recharge_type.trim().to_uppercase();
    if recharge_type != "BALANCE" && recharge_type != "COUPON" {
        return Err("recharge_type은 BALANCE 또는 COUPON 이어야 합니다.".to_string());
    }

    let payment_method_code = recharge.payment_method_code.trim().to_uppercase();
    if payment_method_code.is_empty() {
        return Err("결제수단(payment_method_code)은 필수입니다.".to_string());
    }

    let payment_method_exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM common_code_detail
             WHERE group_code_id = 'PAYMENT_METHOD'
               AND detail_code = $1
               AND use_yn = 'Y'
            "#,
            &[&payment_method_code],
        )
        .await
        .map_err(|e| format!("결제수단 코드 확인 실패: {e}"))?;
    if payment_method_exists.is_none() {
        return Err("PAYMENT_METHOD 공통코드에 등록된 사용중 결제수단만 가능합니다.".to_string());
    }

    let user_exists = client
        .query_opt(
            "SELECT 1 FROM user_management WHERE user_id::BIGINT = $1 AND store_code = $2",
            &[&recharge.user_id, &store_code],
        )
        .await
        .map_err(|e| format!("회원 확인 실패: {e}"))?;
    if user_exists.is_none() {
        return Err("선택한 점포의 회원이 존재하지 않습니다.".to_string());
    }

    let memo = recharge
        .memo
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("포인트 충전 트랜잭션 시작 실패: {e}"))?;

    if recharge_type == "BALANCE" {
        let amount = recharge.amount.unwrap_or(0);
        if amount <= 0 {
            return Err("예치금 충전 금액은 1원 이상이어야 합니다.".to_string());
        }
        let received_amount = recharge.received_amount.unwrap_or(amount);
        if received_amount < 0 {
            return Err("실수납 금액은 0원 이상이어야 합니다.".to_string());
        }

        tx.execute(
            r#"
            INSERT INTO member_point_balance (store_code, user_id, point_balance)
            VALUES ($1, $2, $3)
            ON CONFLICT (store_code, user_id)
            DO UPDATE SET
                point_balance = member_point_balance.point_balance + EXCLUDED.point_balance,
                updated_at = NOW()
            "#,
            &[&store_code, &recharge.user_id, &amount],
        )
        .await
        .map_err(|e| format!("예치금 충전 저장 실패: {e}"))?;

        let amount_option: Option<i64> = Some(amount);
        let received_amount_option: Option<i64> = Some(received_amount);
        let none_service_id: Option<i64> = None;
        let none_coupon_count: Option<i32> = None;
        tx.execute(
            r#"
            INSERT INTO member_point_history (
                store_code, user_id, recharge_type, amount, received_amount, service_id, coupon_count, payment_method_code, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &recharge.user_id,
                &recharge_type,
                &amount_option,
                &received_amount_option,
                &none_service_id,
                &none_coupon_count,
                &payment_method_code,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("예치금 충전 이력 저장 실패: {e}"))?;
    } else {
        let amount = recharge.amount.unwrap_or(0);
        if amount < 0 {
            return Err("쿠폰 충전 수납 금액은 0원 이상이어야 합니다.".to_string());
        }

        let service_id = recharge
            .service_id
            .ok_or_else(|| "쿠폰 충전 시 service_id는 필수입니다.".to_string())?;
        if service_id <= 0 {
            return Err("service_id는 1 이상이어야 합니다.".to_string());
        }

        let coupon_count = recharge.coupon_count.unwrap_or(0);
        if coupon_count <= 0 {
            return Err("쿠폰 충전 횟수는 1 이상이어야 합니다.".to_string());
        }

        let service_exists = tx
            .query_opt(
                r#"
                SELECT 1
                  FROM service_catalog_management
                 WHERE service_id = $1
                   AND store_code = $2
                   AND use_yn = 'Y'
                "#,
                &[&service_id, &store_code],
            )
            .await
            .map_err(|e| format!("시술 항목 확인 실패: {e}"))?;
        if service_exists.is_none() {
            return Err("선택한 점포의 사용중 시술항목만 쿠폰으로 충전할 수 있습니다.".to_string());
        }

        tx.execute(
            r#"
            INSERT INTO member_coupon_balance (store_code, user_id, service_id, coupon_count)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (store_code, user_id, service_id)
            DO UPDATE SET
                coupon_count = member_coupon_balance.coupon_count + EXCLUDED.coupon_count,
                updated_at = NOW()
            "#,
            &[&store_code, &recharge.user_id, &service_id, &coupon_count],
        )
        .await
        .map_err(|e| format!("쿠폰 충전 저장 실패: {e}"))?;

        let amount_option: Option<i64> = Some(amount);
        let none_received_amount: Option<i64> = None;
        let service_id_option: Option<i64> = Some(service_id);
        let coupon_count_option: Option<i32> = Some(coupon_count);
        tx.execute(
            r#"
            INSERT INTO member_point_history (
                store_code, user_id, recharge_type, amount, received_amount, service_id, coupon_count, payment_method_code, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &recharge.user_id,
                &recharge_type,
                &amount_option,
                &none_received_amount,
                &service_id_option,
                &coupon_count_option,
                &payment_method_code,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("쿠폰 충전 이력 저장 실패: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("포인트 충전 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "회원 포인트 충전이 완료되었습니다.".to_string(),
    })
}

// 기존 충전 이력을 취소하고 잔액을 원복합니다.
#[tauri::command]
async fn cancel_member_point_recharge(
    payload: CancelMemberPointRechargePayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.history_id <= 0 {
        return Err("history_id는 1 이상이어야 합니다.".to_string());
    }

    let cancel_reason = payload.cancel_reason.trim().to_string();
    if cancel_reason.is_empty() {
        return Err("취소 사유를 입력해주세요.".to_string());
    }

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("충전 취소 트랜잭션 시작 실패: {e}"))?;

    let recharge_row = tx
        .query_opt(
            r#"
            SELECT
                h.user_id::BIGINT,
                h.recharge_type,
                COALESCE(h.amount, 0)::BIGINT,
                h.service_id::BIGINT,
                COALESCE(h.coupon_count, 0)::INTEGER,
                COALESCE(h.status_code, 'ACTIVE')
              FROM member_point_history h
             WHERE h.id::BIGINT = $1
               AND h.store_code = $2
             FOR UPDATE
            "#,
            &[&payload.history_id, &store_code],
        )
        .await
        .map_err(|e| format!("취소 대상 충전 이력 조회 실패: {e}"))?;

    let Some(recharge_row) = recharge_row else {
        return Err("취소 대상 충전 이력이 없습니다.".to_string());
    };

    let user_id = recharge_row.get::<_, i64>(0);
    let recharge_type = recharge_row.get::<_, String>(1).trim().to_uppercase();
    let amount = recharge_row.get::<_, i64>(2);
    let service_id = recharge_row.get::<_, Option<i64>>(3);
    let coupon_count = recharge_row.get::<_, i32>(4);
    let current_status = recharge_row.get::<_, String>(5).trim().to_uppercase();

    if recharge_type != "BALANCE" && recharge_type != "COUPON" {
        return Err("취소 대상 충전 이력 유형이 올바르지 않습니다.".to_string());
    }

    if current_status == "CANCELLED" {
        return Err("이미 취소된 충전 이력입니다.".to_string());
    }

    if recharge_type == "BALANCE" {
        if amount <= 0 {
            return Err("취소 대상 충전 금액이 올바르지 않습니다.".to_string());
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
                &[&store_code, &user_id, &amount],
            )
            .await
            .map_err(|e| format!("예치금 충전 취소 롤백 실패: {e}"))?;

        if affected == 0 {
            return Err("예치금 잔액이 부족하여 충전을 취소할 수 없습니다.".to_string());
        }
    } else {
        let Some(service_id) = service_id else {
            return Err("취소 대상 시술 정보가 없습니다.".to_string());
        };
        if service_id <= 0 {
            return Err("취소 대상 시술 정보가 올바르지 않습니다.".to_string());
        }
        if coupon_count <= 0 {
            return Err("취소 대상 횟수 정보가 올바르지 않습니다.".to_string());
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
                &[&store_code, &user_id, &service_id, &coupon_count],
            )
            .await
            .map_err(|e| format!("쿠폰 충전 취소 롤백 실패: {e}"))?;

        if affected == 0 {
            return Err("쿠폰 잔여 횟수가 부족하여 충전을 취소할 수 없습니다.".to_string());
        }
    }

    let affected = tx
        .execute(
            r#"
        UPDATE member_point_history
           SET status_code = 'CANCELLED',
               cancel_reason = $3,
               cancelled_at = NOW()
         WHERE id::BIGINT = $1
           AND store_code = $2
           AND (status_code IS NULL OR status_code <> 'CANCELLED')
        "#,
            &[&payload.history_id, &store_code, &cancel_reason],
        )
        .await
        .map_err(|e| format!("충전 이력 상태 취소 처리 실패: {e}"))?;

    if affected == 0 {
        return Err("취소 대상 충전 이력이 없거나 이미 취소되었습니다.".to_string());
    }

    tx.commit()
        .await
        .map_err(|e| format!("충전 취소 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "충전 취소가 완료되었습니다.".to_string(),
    })
}

// 포인트/쿠폰 사용 내역을 기록하고 잔액을 차감합니다.
#[tauri::command]
async fn use_member_point(payload: UseMemberPointPayload) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let usage = payload.usage;
    if usage.user_id <= 0 {
        return Err("user_id는 1 이상이어야 합니다.".to_string());
    }

    let use_type = usage.use_type.trim().to_uppercase();
    if use_type != "BALANCE" && use_type != "COUPON" {
        return Err("use_type은 BALANCE 또는 COUPON 이어야 합니다.".to_string());
    }

    let user_exists = client
        .query_opt(
            "SELECT 1 FROM user_management WHERE user_id::BIGINT = $1 AND store_code = $2",
            &[&usage.user_id, &store_code],
        )
        .await
        .map_err(|e| format!("회원 확인 실패: {e}"))?;
    if user_exists.is_none() {
        return Err("선택한 점포의 회원이 존재하지 않습니다.".to_string());
    }

    let memo = usage
        .memo
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("포인트 사용 트랜잭션 시작 실패: {e}"))?;

    if use_type == "BALANCE" {
        let amount = usage.amount.unwrap_or(0);
        if amount <= 0 {
            return Err("예치금 사용 금액은 1원 이상이어야 합니다.".to_string());
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
                &[&store_code, &usage.user_id, &amount],
            )
            .await
            .map_err(|e| format!("예치금 사용 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("예치금 잔액이 부족합니다.".to_string());
        }

        let amount_option: Option<i64> = Some(amount);
        let none_service_id: Option<i64> = None;
        let none_coupon_count: Option<i32> = None;
        tx.execute(
            r#"
            INSERT INTO member_point_usage_history (
                store_code, user_id, use_type, amount, service_id, coupon_count, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            "#,
            &[
                &store_code,
                &usage.user_id,
                &use_type,
                &amount_option,
                &none_service_id,
                &none_coupon_count,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("예치금 사용 이력 저장 실패: {e}"))?;
    } else {
        let service_id = usage
            .service_id
            .ok_or_else(|| "쿠폰 사용 시 service_id는 필수입니다.".to_string())?;
        if service_id <= 0 {
            return Err("service_id는 1 이상이어야 합니다.".to_string());
        }

        let coupon_count = usage.coupon_count.unwrap_or(0);
        if coupon_count <= 0 {
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
                &[&store_code, &usage.user_id, &service_id, &coupon_count],
            )
            .await
            .map_err(|e| format!("쿠폰 사용 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("쿠폰 잔여 횟수가 부족합니다.".to_string());
        }

        let none_amount: Option<i64> = None;
        let service_id_option: Option<i64> = Some(service_id);
        let coupon_count_option: Option<i32> = Some(coupon_count);
        tx.execute(
            r#"
            INSERT INTO member_point_usage_history (
                store_code, user_id, use_type, amount, service_id, coupon_count, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            "#,
            &[
                &store_code,
                &usage.user_id,
                &use_type,
                &none_amount,
                &service_id_option,
                &coupon_count_option,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("쿠폰 사용 이력 저장 실패: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("포인트 사용 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "회원 포인트 사용 처리가 완료되었습니다.".to_string(),
    })
}


