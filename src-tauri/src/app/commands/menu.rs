/**
 * @file menu.rs
 * @description 애플리케이션의 메뉴 구조(대메뉴/소메뉴)를 관리하고, 점포 및 시스템 타입별로 동적 메뉴 정보를 제공하는 백엔드 명령 정의 파일입니다.
 */

/**
 * @function sync_menu_management_to_db
 * @description 메뉴 기초 데이터를 데이터베이스에 일괄 동기화(멱등성 보장)합니다.
 * @param payload SyncMenuPayload: 동기화할 메뉴 배열 및 점포/DB 연결 정보
 * @return MenuSyncResult: 동기화 결과 (성공 여부 및 처리 건수)
 */
#[tauri::command]
async fn sync_menu_management_to_db(payload: SyncMenuPayload) -> Result<MenuSyncResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    ensure_menu_start_menu_column(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    // 데이터 일관성을 위해 트랜잭션 사용
    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("트랜잭션 시작 실패: {e}"))?;

    // [SQL] 현재 점포의 기존 메뉴 데이터를 모두 삭제하여 초기화합니다.
    transaction
        .execute(
            "DELETE FROM menu_management WHERE store_code = $1",
            &[&store_code],
        )
        .await
        .map_err(|e| format!("기존 메뉴 데이터 초기화 실패: {e}"))?;

    let mut menus = payload.menus;
    menus.sort_by_key(|m| m.parent_id.is_some());

    for menu in &menus {
        let system_type_code = normalize_system_type_code(menu.system_type_code.as_deref());
        // 시작 메뉴 설정 가능 여부 확인: 소메뉴(SUB)만 시작 메뉴로 지정될 수 있습니다.
        let is_start_menu = menu.is_start_menu.unwrap_or(false)
            && menu.menu_type.trim().eq_ignore_ascii_case("SUB");

        // [SQL] 새로운 메뉴 데이터를 삽입합니다.
        // 각 언어별 명칭(ko, en, zh)과 해당 메뉴를 볼 수 있는 시스템 타입(ALL/MAIN/SUB 등)을 기록합니다.
        transaction
            .execute(
                r#"
                INSERT INTO menu_management (
                    menu_id,
                    parent_menu_id,
                    menu_type,
                    menu_path,
                    menu_name_ko,
                    menu_name_en,
                    menu_name_zh,
                    system_type_code,
                    store_code,
                    is_start_menu,
                    menu_order,
                    menu_status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                "#,
                &[
                    &menu.id,               // $1: 메뉴 고유 ID
                    &menu.parent_id,        // $2: 부모 메뉴 ID (대메뉴면 NULL)
                    &menu.menu_type,        // $3: 메뉴 타입 (MAIN/SUB)
                    &menu.path,             // $4: 연결 경로
                    &menu.names.ko,         // $5: 한국어 명칭
                    &menu.names.en,         // $6: 영어 명칭
                    &menu.names.zh,         // $7: 중국어 명칭
                    &system_type_code,      // $8: 권한 시스템 타입 코드
                    &store_code,            // $9: 소속 점포 코드
                    &is_start_menu,         // $10: 시작페이지 설정 여부
                    &menu.order,            // $11: 정렬 순서
                    &menu.status,           // $12: 사용 상태 ('사용중' 등)
                ],
            )
            .await
            .map_err(|e| format!("메뉴 데이터 입력 실패(menu_id={}): {e}", menu.id))?;
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("트랜잭션 커밋 실패: {e}"))?;

    Ok(MenuSyncResult {
        success: true,
        message: "menu_management 테이블 생성 및 데이터 반영 완료".to_string(),
        inserted_count: menus.len(),
    })
}

/**
 * @function get_menu_management_data
 * @description 직원 관리 화면에서 사용할 전체 직원 목록을 조회합니다.
 * @param payload MenuQueryPayload: 조회 필터(시스템 타입 등) 및 점포 정보
 */
#[tauri::command]
async fn get_menu_management_data(payload: MenuQueryPayload) -> Result<MenuDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    ensure_menu_start_menu_column(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let selected_system_type =
        normalize_optional_system_type_code(payload.system_type_code.as_deref());
        
    // [SQL] 시스템 타입 필터링에 의한 메뉴 데이터 조회
    let rows = if let Some(system_type_code) = selected_system_type {
        // 'ALL' 타입이 선택된 경우 전역 메뉴와 현재 점포 메뉴를 모두 조회
        if system_type_code == DEFAULT_SYSTEM_TYPE_CODE {
            client
                .query(
                    r#"
                    SELECT menu_id,
                           parent_menu_id,
                           menu_type,
                           menu_path,
                           menu_name_ko,
                           menu_name_en,
                           menu_name_zh,
                           system_type_code,
                           is_start_menu,
                           menu_order,
                           menu_status
                      FROM menu_management
                     WHERE store_code = $1
                     ORDER BY (parent_menu_id IS NOT NULL), COALESCE(parent_menu_id, menu_id), menu_order, menu_id
                    "#,
                    &[&store_code],
                )
                .await
        } else {
            // 특정 시스템 타입(MAIN/SUB 등)이 선택된 경우 해당 타입 또는 공통(ALL)인 메뉴만 필터링
            client
                .query(
                    r#"
                    SELECT menu_id,
                           parent_menu_id,
                           menu_type,
                           menu_path,
                           menu_name_ko,
                           menu_name_en,
                           menu_name_zh,
                           system_type_code,
                           is_start_menu,
                           menu_order,
                           menu_status
                      FROM menu_management
                     WHERE store_code = $1
                       AND (system_type_code = $2 OR system_type_code = $3)
                     ORDER BY (parent_menu_id IS NOT NULL), COALESCE(parent_menu_id, menu_id), menu_order, menu_id
                    "#,
                    &[&store_code, &system_type_code, &DEFAULT_SYSTEM_TYPE_CODE],
                )
                .await
        }
    } else {
        // 필터링 조건이 없을 경우 점포 기준 전체 조회
        client
            .query(
                r#"
                SELECT menu_id,
                       parent_menu_id,
                       menu_type,
                       menu_path,
                       menu_name_ko,
                       menu_name_en,
                       menu_name_zh,
                       system_type_code,
                       is_start_menu,
                       menu_order,
                       menu_status
                  FROM menu_management
                 WHERE store_code = $1
                 ORDER BY (parent_menu_id IS NOT NULL), COALESCE(parent_menu_id, menu_id), menu_order, menu_id
                "#,
                &[&store_code],
            )
            .await
    }
    .map_err(|e| format!("menu data query failed: {e}"))?;

    // 조회된 DB 로우를 DTO 리스트로 가공합니다.
    let menus = rows
        .into_iter()
        .map(|row| MenuDto {
            id: row.get::<_, i64>(0),                // 메뉴 고유 ID
            parent_id: row.get::<_, Option<i64>>(1), // 부모 ID
            menu_type: row.get::<_, String>(2),      // 타입 (MAIN/SUB)
            path: row.get::<_, String>(3),           // 연결 경로
            names: MenuNamesPayload {                // 다국어 명칭
                ko: row.get::<_, String>(4),
                en: row.get::<_, String>(5),
                zh: row.get::<_, String>(6),
            },
            system_type_code: row.get::<_, String>(7), // 접근 권한 코드
            is_start_menu: row.get::<_, bool>(8),      // 시작 메뉴 여부
            order: row.get::<_, i32>(9),             // 정렬 순서
            status: row.get::<_, String>(10),          // 현재 상태
        })
        .collect::<Vec<_>>();

    Ok(MenuDataResult {
        success: true,
        message: "menu data loaded".to_string(),
        menus,
    })
}

// 메뉴를 신규 등록하거나 기존 데이터를 수정합니다.
#[tauri::command]
async fn upsert_menu_management(payload: UpsertMenuPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    ensure_menu_start_menu_column(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let menu = payload.menu;
    let menu_type = menu.menu_type.trim().to_uppercase();
    if menu_type != "MAIN" && menu_type != "SUB" {
        return Err("menu_type must be MAIN or SUB".to_string());
    }

    let path = menu.path.trim().to_string();
    if path.is_empty() {
        return Err("menu_path is required".to_string());
    }

    let ko = menu.names.ko.trim().to_string();
    let en = menu.names.en.trim().to_string();
    let zh = menu.names.zh.trim().to_string();
    if ko.is_empty() || en.is_empty() || zh.is_empty() {
        return Err("menu_name_ko/menu_name_en/menu_name_zh are required".to_string());
    }
    let system_type_code = normalize_system_type_code(menu.system_type_code.as_deref());
    validate_system_type_code(&client, &system_type_code).await?;

    let status = {
        let s = menu.status.trim();
        if s.is_empty() {
            "사용중".to_string()
        } else {
            s.to_string()
        }
    };
    let requested_start_menu = menu.is_start_menu.unwrap_or(false);
    if requested_start_menu && menu_type != "SUB" {
        return Err("시작메뉴는 하위 메뉴(SUB)만 지정할 수 있습니다.".to_string());
    }
    if requested_start_menu && status != "사용중" {
        return Err("시작메뉴는 상태가 '사용중'인 메뉴만 지정할 수 있습니다.".to_string());
    }
    let is_start_menu = requested_start_menu && menu_type == "SUB";

    let order = if menu.order <= 0 { 1 } else { menu.order };
    let menu_id = if menu.id <= 0 {
        get_next_menu_id(&client).await?
    } else {
        menu.id
    };

    let parent_id = if menu_type == "MAIN" {
        None
    } else {
        let Some(pid) = menu.parent_id else {
            return Err("SUB menu requires parent_id".to_string());
        };
        if pid == menu_id {
            return Err("parent_id cannot be same as menu_id".to_string());
        }

        let parent_row = client
            .query_opt(
                "SELECT menu_type, system_type_code FROM menu_management WHERE menu_id = $1 AND store_code = $2",
                &[&pid, &store_code],
            )
            .await
            .map_err(|e| format!("parent menu validation failed: {e}"))?;

        match parent_row {
            Some(row) => {
                let parent_type: String = row.get(0);
                let parent_system_type: String = row.get(1);
                if parent_type.to_uppercase() != "MAIN" {
                    return Err("SUB menu parent must be MAIN type".to_string());
                }
                let normalized_parent_system_type = parent_system_type.trim().to_uppercase();
                if normalized_parent_system_type != DEFAULT_SYSTEM_TYPE_CODE
                    && normalized_parent_system_type != system_type_code
                {
                    return Err(
                        "SUB menu system_type_code must match parent menu or parent must be ALL"
                            .to_string(),
                    );
                }
            }
            None => return Err("parent menu does not exist".to_string()),
        }
        Some(pid)
    };

    // [SQL] 메뉴 정보를 삽입하거나 기존 정보를 업데이트(Upsert)합니다.
    // - menu_id가 존재할 경우 최신 데이터로 덮어쓰고 updated_at을 기록합니다.
    client
        .execute(
            r#"
            INSERT INTO menu_management (
                menu_id,
                parent_menu_id,
                menu_type,
                menu_path,
                menu_name_ko,
                menu_name_en,
                menu_name_zh,
                system_type_code,
                store_code,
                is_start_menu,
                menu_order,
                menu_status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (menu_id)
            DO UPDATE SET
                parent_menu_id = EXCLUDED.parent_menu_id,
                menu_type = EXCLUDED.menu_type,
                menu_path = EXCLUDED.menu_path,
                menu_name_ko = EXCLUDED.menu_name_ko,
                menu_name_en = EXCLUDED.menu_name_en,
                menu_name_zh = EXCLUDED.menu_name_zh,
                system_type_code = EXCLUDED.system_type_code,
                store_code = EXCLUDED.store_code,
                is_start_menu = EXCLUDED.is_start_menu,
                menu_order = EXCLUDED.menu_order,
                menu_status = EXCLUDED.menu_status,
                updated_at = NOW()
            "#,
            &[
                &menu_id,
                &parent_id,
                &menu_type,
                &path,
                &ko,
                &en,
                &zh,
                &system_type_code,
                &store_code,
                &is_start_menu,
                &order,
                &status,
            ],
        )
        .await
        .map_err(|e| format!("menu upsert failed: {e}"))?;

    // [SQL] 현재 메뉴가 '시작 메뉴'로 지정된 경우, 동일한 시스템 타입 코드 내의 다른 메뉴들의 시작 메뉴 설정을 해제합니다.
    // 점포당/시스템타입당 단 하나의 시작 메뉴만 존재하도록 관리합니다.
    if is_start_menu {
        client
            .execute(
                r#"
                UPDATE menu_management
                   SET is_start_menu = FALSE,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND system_type_code = $2
                   AND menu_id <> $3
                   AND is_start_menu = TRUE
                "#,
                &[&store_code, &system_type_code, &menu_id],
            )
            .await
            .map_err(|e| format!("기존 시작메뉴 정리 실패: {e}"))?;
    }

    Ok(MutationResult {
        success: true,
        message: format!("menu saved (id={menu_id})"),
    })
}

/**
 * @function delete_menu_management
 * @description 메뉴 ID와 점포 코드를 기준으로 특정 메뉴를 삭제합니다.
 * @param payload DeleteMenuPayload: 삭제할 메뉴의 고유 ID 정보
 */
#[tauri::command]
async fn delete_menu_management(payload: DeleteMenuPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.menu_id <= 0 {
        return Err("valid menu_id is required".to_string());
    }

    // [SQL] 특정 메뉴 ID와 점포 코드를 삭제합니다. 
    // 실제 운영 환경에서는 자식 메뉴가 존재하는 경우 삭제를 금지하거나 하위 메뉴를 함께 연쇄 삭제하는 등의 부가 로직이 필요할 수 있습니다.
    let affected = client
        .execute(
            "DELETE FROM menu_management WHERE menu_id = $1 AND store_code = $2",
            &[&payload.menu_id, &store_code],
        )
        .await
        .map_err(|e| format!("menu delete failed: {e}"))?;

    if affected == 0 {
        return Err("menu not found".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "menu deleted".to_string(),
    })
}


