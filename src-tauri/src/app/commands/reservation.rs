/**
 * @file reservation.rs
 * @description 매장의 예약 캘린더 데이터를 관리하는 백엔드 명령 정의 파일입니다.
 * 예약 기본 정보(헤더)와 예약에 포함된 여러 시술 내역(라인)을 통합하여 처리하며, 트랜잭션을 통한 데이터 정합성을 보장합니다.
 */

/**
 * @function get_reservation_calendar_data
 * @description 예약 캘린더 화면에서 사용할 전체 예약 목록과 각 예약별 시술 상세 정보를 조회합니다.
 * @param payload ReservationCalendarQueryPayload: 조회 조건 및 DB 연결 정보
 * @return ReservationCalendarDataResult: 예약 정보 및 하위 시술 리스트가 결합된 결과
 */
#[tauri::command]
async fn get_reservation_calendar_data(
    payload: ReservationCalendarQueryPayload,
) -> Result<ReservationCalendarDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    // [SQL] 예약 기본 정보(헤더)를 조회합니다.
    // - reservation_date::TEXT: 날짜 형식을 텍스트로 변환하여 클라이언트에 전달합니다.
    // - TO_CHAR: 시작 시간을 HH24:MI 형식으로 포맷팅합니다.
    // - store_code = $1: 현재 점포의 예약 데이터만 필터링합니다.
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

    // [SQL] 각 예약에 연결된 시술 상세 내역(라인)을 전체 조회합니다.
    // - 모든 라인 데이터를 가져온 후 메모리 상에서 각 예약 ID별로 그룹화(HashMap)하여 조립합니다.
    // - unit_price::BIGINT: 가격 정보를 64비트 정수로 변환합니다.
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

    // 조회된 예약 정보와 시술 내역을 결합하여 최종 DTO를 생성합니다.
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

/**
 * @function upsert_reservation_calendar_item
 * @description 신규 예약을 등록하거나 기존 예약을 수정합니다. 서비스 시술 항목들을 함께 저장합니다.
 * @param payload UpsertReservationCalendarPayload: 저장할 예약 데이터 정보
 */
#[tauri::command]
async fn upsert_reservation_calendar_item(
    payload: UpsertReservationCalendarPayload,
) -> Result<ReservationMutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let item = payload.item;
    // 데이터 전처리: 공백 제거 및 대문자 변환
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

    // [SQL] 요청된 예약 상태값이 유효한지 검증합니다.
    // - RESERVATION_STATUS 공통코드 데이터와 비교합니다.
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

    // [SQL] 선택된 시술 항목들이 실제로 데이터베이스에 존재하고 사용 중인지 확인합니다.
    // - service_catalog_management 테이블과 공통 코드 테이블을 JOIN 하여 항목 상세 정보를 가져옵니다.
    // - ANY($2::BIGINT[]) 구문을 사용하여 여러 시술 ID를 한 번에 검찰합니다.
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

        // [SQL] 기존 예약 정보를 업데이트(HEADER UPDATE)합니다.
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

        // [SQL] 기존 시술 라인 내역을 삭제하고 재인서트(Delete-Insert) 방식으로 업데이트 처리합니다.
        tx.execute(
            "DELETE FROM reservation_calendar_service_line WHERE reservation_id = $1 AND store_code = $2",
            &[&reservation_id, &store_code],
        )
        .await
        .map_err(|e| format!("기존 예약 시술 라인 삭제 실패: {e}"))?;

        reservation_id
    } else {
        // [SQL] 신규 예약 정보를 삽입(HEADER INSERT)합니다.
        // - RETURNING reservation_id: 자동 생성된 시퀀스 ID를 반환받습니다.
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

        // [SQL] 예약 시술 라인 정보를 삽입(LINE INSERT)합니다.
        // - 프론트에서 선택한 순서를 보존하기 위해 line_no는 전달 순서(index+1)로 기록합니다.
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

/**
 * @function delete_reservation_calendar_item
 * @description 지정된 예약 정보를 삭제합니다. 이 때 연관된 시술 라인 데이터도 함께 삭제됩니다(DB 제약 조건 또는 직접 삭제).
 * @param payload DeleteReservationCalendarPayload: 삭제할 예약 정보 ID
 */
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

    // [SQL] 특정 예약 ID를 기반으로 예약 정보를 삭제합니다.
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


