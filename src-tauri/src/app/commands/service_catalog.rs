/**
 * @file service_catalog.rs
 * @description 매장에서 제공하는 시술 항목(항목명, 단가, 소요시간 등) 카탈로그를 관리하는 백엔드 명령 정의 파일입니다.
 * 시술 항목의 대분류(카테고리) 연동 및 기준 데이터를 관리합니다.
 */

/**
 * @function get_service_catalog_data
 * @description 등록된 모든 시술 항목과 각 항목의 카테고리 명칭을 포함하여 조회합니다.
 * @param payload ServiceCatalogQueryPayload: 조회 대상 및 DB 연결 정보
 * @return ServiceCatalogDataResult: 시술 항목 리스트
 */
#[tauri::command]
async fn get_service_catalog_data(
    payload: ServiceCatalogQueryPayload,
) -> Result<ServiceCatalogDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    // [SQL] 시술 항목 테이블과 공통 코드(카테고리) 테이블을 LEFT JOIN 하여 조회합니다.
    // - T_CATEGORY 그룹 코드의 상세 명칭을 가져옵니다.
    log_sql!(sql);
    let rows = client
        .query(sql, &[&store_code])
        .await
        .map_err(|e| format!("시술 항목 조회 실패: {e}"))?;

    let items = rows
        .into_iter()
        .map(|row| ServiceCatalogItemDto {
            service_id: row.get::<_, i64>(0),
            category_code: row.get::<_, String>(1),
            category_name: row.get::<_, String>(2),
            service_name: row.get::<_, String>(3),
            unit_price: row.get::<_, i64>(4),
            duration_minutes: row.get::<_, i32>(5),
            use_yn: row.get::<_, String>(6),
            note: row.get::<_, Option<String>>(7),
        })
        .collect::<Vec<_>>();

    Ok(ServiceCatalogDataResult {
        success: true,
        message: "시술 항목 조회 완료".to_string(),
        items,
    })
}

/**
 * @function upsert_service_catalog_item
 * @description 시술 항목을 신규 등록하거나 기존 정보를 수정합니다.
 * @param payload UpsertServiceCatalogPayload: 저장할 시술 항목 명세
 */
#[tauri::command]
async fn upsert_service_catalog_item(
    payload: UpsertServiceCatalogPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    // 데이터 전처리 및 유효성 검사를 수행합니다.
    let category_code = item.category_code.trim().to_uppercase();
    let service_name = item.service_name.trim().to_string();
    let unit_price = item.unit_price;
    let duration_minutes = item.duration_minutes;
    let use_yn = item.use_yn.trim().to_uppercase();
    let note = item
        .note
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if category_code.is_empty() || service_name.is_empty() {
        return Err("카테고리와 시술명은 필수입니다.".to_string());
    }
    if unit_price <= 0 {
        return Err("단가는 0보다 커야 합니다.".to_string());
    }
    if duration_minutes <= 0 {
        return Err("소요시간은 0보다 커야 합니다.".to_string());
    }
    if use_yn != "Y" && use_yn != "N" {
        return Err("사용여부(use_yn)는 Y 또는 N만 가능합니다.".to_string());
    }

    // [SQL] 선택된 카테고리 코드가 유효한 공통 코드인지 검증합니다.
    let category_exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM common_code_detail
             WHERE group_code_id = 'T_CATEGORY'
               AND detail_code = $1
               AND use_yn = 'Y'
            "#,
            &[&category_code],
        )
        .await
        .map_err(|e| format!("카테고리 코드 확인 실패: {e}"))?;

    if category_exists.is_none() {
        return Err(
            "T_CATEGORY 공통코드에 존재하는 사용중 카테고리만 선택할 수 있습니다.".to_string(),
        );
    }

    if let Some(service_id) = item.service_id {
        if service_id <= 0 {
            return Err("service_id는 1 이상이어야 합니다.".to_string());
        }

        // [SQL] ID가 존재하는 경우 정보를 업데이트(Upsert)합니다.
        let sql = r#"
            INSERT INTO service_catalog_management (
                service_id,
                store_code,
                category_code,
                service_name,
                unit_price,
                duration_minutes,
                use_yn,
                note
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (service_id)
            DO UPDATE SET
                store_code = EXCLUDED.store_code,
                category_code = EXCLUDED.category_code,
                service_name = EXCLUDED.service_name,
                unit_price = EXCLUDED.unit_price,
                duration_minutes = EXCLUDED.duration_minutes,
                use_yn = EXCLUDED.use_yn,
                note = EXCLUDED.note,
                updated_at = NOW()
        "#;
        log_sql!(
            sql,
            service_id,
            &store_code,
            &category_code,
            &service_name,
            unit_price,
            duration_minutes,
            &use_yn,
            &note
        );
        client
            .execute(
                sql,
                &[
                    &service_id,
                    &store_code,
                    &category_code,
                    &service_name,
                    &unit_price,
                    &duration_minutes,
                    &use_yn,
                    &note,
                ],
            )
            .await
            .map_err(|e| format!("시술 항목 저장 실패: {e}"))?;
    } else {
        // [SQL] ID가 없는 경우 신규 시술 항목을 등록합니다.
        let sql = r#"
            INSERT INTO service_catalog_management (
                store_code,
                category_code,
                service_name,
                unit_price,
                duration_minutes,
                use_yn,
                note
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#;
        log_sql!(
            sql,
            &store_code,
            &category_code,
            &service_name,
            unit_price,
            duration_minutes,
            &use_yn,
            &note
        );
        client
            .execute(
                sql,
                &[
                    &store_code,
                    &category_code,
                    &service_name,
                    &unit_price,
                    &duration_minutes,
                    &use_yn,
                    &note,
                ],
            )
            .await
            .map_err(|e| format!("시술 항목 등록 실패: {e}"))?;
    }

    Ok(MutationResult {
        success: true,
        message: "시술 항목 저장 완료".to_string(),
    })
}

/**
 * @function delete_service_catalog_item
 * @description 등록된 시술 항목을 삭제합니다.
 * @param payload DeleteServiceCatalogPayload: 삭제할 시술 ID
 */
#[tauri::command]
async fn delete_service_catalog_item(
    payload: DeleteServiceCatalogPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.service_id <= 0 {
        return Err("삭제할 service_id가 올바르지 않습니다.".to_string());
    }

    let sql = "DELETE FROM service_catalog_management WHERE service_id = $1 AND store_code = $2";
    log_sql!(sql, payload.service_id, &store_code);
    let affected = client
        .execute(sql, &[&payload.service_id, &store_code])
        .await
        .map_err(|e| format!("시술 항목 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 시술 항목이 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "시술 항목 삭제 완료".to_string(),
    })
}


