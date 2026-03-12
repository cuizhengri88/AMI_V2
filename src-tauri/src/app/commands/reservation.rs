// 예약 캘린더 관리 도메인 Tauri 명령입니다.

// 예약 캘린더 화면용 예약 목록/연관 정보를 조회합니다.
#[tauri::command]
async fn get_reservation_calendar_data(
    payload: ReservationCalendarQueryPayload,
) -> Result<ReservationCalendarDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    // 예약 헤더(날짜/시간/고객/상태)를 먼저 조회한다.
    let reservation_rows = client
        .query(
            r#"
            SELECT
                r.reservation_id::BIGINT,
                r.reservation_date::TEXT,
                TO_CHAR(r.start_time, 'HH24:MI') AS start_time,
                r.customer_name,
                r.customer_id::BIGINT,
                r.customer_phone,
                r.gender,
                r.designer_name,
                r.status_code,
                r.note
              FROM reservation_calendar_management r
             WHERE r.store_code = $1
             ORDER BY r.reservation_date ASC, r.start_time ASC, r.reservation_id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("예약 목록 조회 실패: {e}"))?;

    // 예약별 시술 라인은 별도 조회 후 HashMap으로 묶어서 조립한다.
    let service_line_rows = client
        .query(
            r#"
            SELECT
                l.line_id::BIGINT,
                l.reservation_id::BIGINT,
                l.service_id::BIGINT,
                l.category_code,
                l.category_name,
                l.service_name,
                l.unit_price::BIGINT,
                l.duration_minutes::INTEGER
              FROM reservation_calendar_service_line l
             WHERE l.store_code = $1
             ORDER BY l.reservation_id DESC, l.line_no ASC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("예약 시술 라인 조회 실패: {e}"))?;

    let mut service_map = HashMap::<i64, Vec<ReservationCalendarServiceDto>>::new();
    for row in service_line_rows {
        let reservation_id = row.get::<_, i64>(1);
        service_map
            .entry(reservation_id)
            .or_default()
            .push(ReservationCalendarServiceDto {
                line_id: row.get::<_, i64>(0),
                service_id: row.get::<_, i64>(2),
                category_code: row.get::<_, String>(3),
                category_name: row.get::<_, String>(4),
                service_name: row.get::<_, String>(5),
                unit_price: row.get::<_, i64>(6),
                duration_minutes: row.get::<_, i32>(7),
            });
    }

    let reservations = reservation_rows
        .into_iter()
        .map(|row| {
            let reservation_id = row.get::<_, i64>(0);
            ReservationCalendarDto {
                reservation_id,
                reservation_date: row.get::<_, String>(1),
                start_time: row.get::<_, String>(2),
                customer_name: row.get::<_, String>(3),
                customer_id: row.get::<_, Option<i64>>(4),
                customer_phone: row.get::<_, Option<String>>(5),
                gender: row.get::<_, Option<String>>(6),
                designer_name: row.get::<_, String>(7),
                status: row.get::<_, String>(8),
                note: row.get::<_, Option<String>>(9),
                services: service_map.remove(&reservation_id).unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();

    Ok(ReservationCalendarDataResult {
        success: true,
        message: "예약 목록 조회 완료".to_string(),
        reservations,
    })
}

// 예약(시술 라인 포함)을 생성/수정합니다.
#[tauri::command]
async fn upsert_reservation_calendar_item(
    payload: UpsertReservationCalendarPayload,
) -> Result<ReservationMutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let item = payload.item;
    let reservation_date_text = item.reservation_date.trim().to_string();
    let start_time_text = item.start_time.trim().to_string();
    let customer_name = item.customer_name.trim().to_string();
    let customer_id = item.customer_id.filter(|value| *value > 0);
    let customer_id_value = customer_id.unwrap_or(0);
    let customer_phone = item
        .customer_phone
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let gender = item
        .gender
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| {
            let normalized = value.to_uppercase();
            if normalized == "M" || normalized == "MALE" || normalized == "남" || normalized == "남성" {
                "M".to_string()
            } else if normalized == "F"
                || normalized == "FEMALE"
                || normalized == "여"
                || normalized == "여성"
            {
                "F".to_string()
            } else {
                normalized
            }
        });
    let designer_name = item.designer_name.trim().to_string();
    let status_code = item.status.trim().to_uppercase();
    let note = item
        .note
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let is_update = item.reservation_id.is_some();

    // 날짜/시간 파싱을 선행해서 프론트가 잘못된 값을 보내도 DB 오류 전에 명확히 차단한다.
    let reservation_date = NaiveDate::parse_from_str(&reservation_date_text, "%Y-%m-%d")
        .map_err(|_| "예약일 형식은 YYYY-MM-DD 이어야 합니다.".to_string())?;
    let start_time = NaiveTime::parse_from_str(&start_time_text, "%H:%M")
        .map_err(|_| "예약 시간 형식은 HH:MM 이어야 합니다.".to_string())?;

    if let Some(raw_customer_id) = item.customer_id {
        if raw_customer_id <= 0 {
            return Err("customer_id는 1 이상이어야 합니다.".to_string());
        }
    }
    if customer_name.is_empty() {
        return Err("고객명은 필수입니다.".to_string());
    }
    if let Some(phone) = customer_phone.as_ref() {
        if phone.chars().count() > 30 {
            return Err("고객 전화번호는 30자 이하여야 합니다.".to_string());
        }
    }
    if designer_name.is_empty() {
        return Err("디자이너명은 필수입니다.".to_string());
    }
    if status_code.is_empty() {
        return Err("예약 상태는 필수입니다.".to_string());
    }
    if item.service_ids.is_empty() {
        return Err("시술 항목은 1건 이상 필요합니다.".to_string());
    }

    // RESERVATION_STATUS 공통코드가 있으면 해당 코드만 허용하고,
    // 아직 코드 세팅 전이면 기본 상태 3종만 허용한다.
    let status_rows = client
        .query(
            r#"
            SELECT detail_code
              FROM common_code_detail
             WHERE group_code_id = 'RESERVATION_STATUS'
               AND use_yn = 'Y'
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("예약 상태코드 확인 실패: {e}"))?;

    if status_rows.is_empty() {
        let allowed = ["RESERVED", "COMPLETED", "CANCELLED"];
        if !allowed.contains(&status_code.as_str()) {
            return Err(
                "RESERVATION_STATUS 공통코드가 없으므로 RESERVED/COMPLETED/CANCELLED만 사용할 수 있습니다."
                    .to_string(),
            );
        }
    } else {
        let status_exists = status_rows.iter().any(|row| {
            row.get::<_, String>(0)
                .trim()
                .eq_ignore_ascii_case(status_code.as_str())
        });
        if !status_exists {
            return Err(
                "선택한 예약 상태코드가 RESERVATION_STATUS 공통코드에 없습니다.".to_string(),
            );
        }
    }

    // 시술 항목은 중복 제거 리스트로 존재 여부를 검증하되,
    // 실제 저장 시에는 사용자가 보낸 순서를 line_no로 유지한다.
    let mut unique_service_ids = Vec::<i64>::new();
    let mut seen_service_ids = HashSet::<i64>::new();
    for service_id in &item.service_ids {
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
                s.category_code,
                COALESCE(c.detail_name, s.category_code) AS category_name,
                s.service_name,
                s.unit_price::BIGINT,
                s.duration_minutes::INTEGER
              FROM service_catalog_management s
         LEFT JOIN common_code_detail c
                ON c.group_code_id = 'T_CATEGORY'
               AND c.detail_code = s.category_code
             WHERE s.store_code = $1
               AND s.use_yn = 'Y'
               AND s.service_id::BIGINT = ANY($2::BIGINT[])
            "#,
            &[&store_code, &unique_service_ids],
        )
        .await
        .map_err(|e| format!("예약 시술 항목 확인 실패: {e}"))?;

    let mut service_snapshot_map = HashMap::<i64, (String, String, String, i64, i32)>::new();
    for row in service_rows {
        let service_id = row.get::<_, i64>(0);
        service_snapshot_map.insert(
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
        if !service_snapshot_map.contains_key(service_id) {
            return Err(
                "예약에 포함된 시술 항목 중 존재하지 않거나 사용중이 아닌 항목이 있습니다."
                    .to_string(),
            );
        }
    }

    // 예약 헤더/라인을 같은 트랜잭션으로 처리해서 데이터 불일치를 방지한다.
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("예약 저장 트랜잭션 시작 실패: {e}"))?;

    let reservation_id = if let Some(reservation_id) = item.reservation_id {
        if reservation_id <= 0 {
            return Err("reservation_id는 1 이상이어야 합니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE reservation_calendar_management
                   SET reservation_date = $3,
                       start_time = $4,
                       customer_name = $5,
                       customer_id = NULLIF($6::BIGINT, 0),
                       customer_phone = $7,
                       gender = $8,
                       designer_name = $9,
                       status_code = $10,
                       note = $11,
                       updated_at = NOW()
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[
                    &reservation_id,
                    &store_code,
                    &reservation_date,
                    &start_time,
                    &customer_name,
                    &customer_id_value,
                    &customer_phone,
                    &gender,
                    &designer_name,
                    &status_code,
                    &note,
                ],
            )
            .await
            .map_err(|e| format!("예약 수정 실패: {e}"))?;

        if affected == 0 {
            return Err("수정 대상 예약이 없습니다.".to_string());
        }

        tx.execute(
            "DELETE FROM reservation_calendar_service_line WHERE reservation_id = $1 AND store_code = $2",
            &[&reservation_id, &store_code],
        )
        .await
        .map_err(|e| format!("기존 예약 시술 라인 삭제 실패: {e}"))?;

        reservation_id
    } else {
        tx.query_one(
            r#"
            INSERT INTO reservation_calendar_management (
                store_code,
                reservation_date,
                start_time,
                customer_name,
                customer_id,
                customer_phone,
                gender,
                designer_name,
                status_code,
                note
            ) VALUES ($1,$2,$3,$4,NULLIF($5::BIGINT, 0),$6,$7,$8,$9,$10)
            RETURNING reservation_id::BIGINT
            "#,
            &[
                &store_code,
                &reservation_date,
                &start_time,
                &customer_name,
                &customer_id_value,
                &customer_phone,
                &gender,
                &designer_name,
                &status_code,
                &note,
            ],
        )
        .await
        .map_err(|e| format!("예약 등록 실패: {e}"))?
        .get::<_, i64>(0)
    };

    for (index, service_id) in item.service_ids.iter().enumerate() {
        let Some(snapshot) = service_snapshot_map.get(service_id) else {
            return Err("예약 저장 중 시술 스냅샷이 유실되었습니다.".to_string());
        };

        // 프론트에서 선택한 순서를 보존하기 위해 line_no는 전달 순서(index+1)로 기록한다.
        let line_no = (index + 1) as i32;
        tx.execute(
            r#"
            INSERT INTO reservation_calendar_service_line (
                store_code,
                reservation_id,
                line_no,
                service_id,
                category_code,
                category_name,
                service_name,
                unit_price,
                duration_minutes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &reservation_id,
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
        .map_err(|e| format!("예약 시술 라인 저장 실패: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("예약 저장 트랜잭션 커밋 실패: {e}"))?;

    Ok(ReservationMutationResult {
        success: true,
        message: if is_update {
            "예약 수정 완료".to_string()
        } else {
            "예약 등록 완료".to_string()
        },
        reservation_id,
    })
}

// 예약 및 연관 시술 라인을 삭제합니다.
#[tauri::command]
async fn delete_reservation_calendar_item(
    payload: DeleteReservationCalendarPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.reservation_id <= 0 {
        return Err("삭제할 reservation_id가 올바르지 않습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM reservation_calendar_management WHERE reservation_id = $1 AND store_code = $2",
            &[&payload.reservation_id, &store_code],
        )
        .await
        .map_err(|e| format!("예약 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 예약이 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "예약 삭제 완료".to_string(),
    })
}


