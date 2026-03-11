// 메뉴 관리 도메인 Tauri 명령입니다.

// 메뉴 기초 데이터를 DB에 일괄 동기화(멱등)합니다.
#[tauri::command]
async fn sync_menu_management_to_db(payload: SyncMenuPayload) -> Result<MenuSyncResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    ensure_menu_start_menu_column(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("트랜잭션 시작 실패: {e}"))?;

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
        let is_start_menu = menu.is_start_menu.unwrap_or(false)
            && menu.menu_type.trim().eq_ignore_ascii_case("SUB");
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
                    &menu.id,
                    &menu.parent_id,
                    &menu.menu_type,
                    &menu.path,
                    &menu.names.ko,
                    &menu.names.en,
                    &menu.names.zh,
                    &system_type_code,
                    &store_code,
                    &is_start_menu,
                    &menu.order,
                    &menu.status,
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

// 메뉴 관리 화면에서 사용하는 메뉴 목록을 조회합니다.
#[tauri::command]
async fn get_menu_management_data(payload: MenuQueryPayload) -> Result<MenuDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    ensure_menu_start_menu_column(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let selected_system_type =
        normalize_optional_system_type_code(payload.system_type_code.as_deref());
    let rows = if let Some(system_type_code) = selected_system_type {
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

    let menus = rows
        .into_iter()
        .map(|row| MenuDto {
            id: row.get::<_, i64>(0),
            parent_id: row.get::<_, Option<i64>>(1),
            menu_type: row.get::<_, String>(2),
            path: row.get::<_, String>(3),
            names: MenuNamesPayload {
                ko: row.get::<_, String>(4),
                en: row.get::<_, String>(5),
                zh: row.get::<_, String>(6),
            },
            system_type_code: row.get::<_, String>(7),
            is_start_menu: row.get::<_, bool>(8),
            order: row.get::<_, i32>(9),
            status: row.get::<_, String>(10),
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

// 메뉴 ID 기준으로 메뉴를 삭제합니다.
#[tauri::command]
async fn delete_menu_management(payload: DeleteMenuPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.menu_id <= 0 {
        return Err("valid menu_id is required".to_string());
    }

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


