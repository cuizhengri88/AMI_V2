// 역할/권한 관리 도메인 Tauri 명령입니다.

// 역할(권한 그룹) 목록을 조회합니다.
#[tauri::command]
async fn get_role_management_data(payload: RoleQueryPayload) -> Result<RoleDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let rows = client
        .query(
            r#"
            SELECT role_id, role_name, COALESCE(role_desc, ''), user_count
              FROM role_management
             WHERE store_code = $1
             ORDER BY role_id
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("권한 데이터 조회 실패: {e}"))?;

    let roles = rows
        .into_iter()
        .map(|row| RoleDto {
            role_id: row.get::<_, String>(0),
            role_name: row.get::<_, String>(1),
            role_desc: row.get::<_, String>(2),
            user_count: row.get::<_, i32>(3),
        })
        .collect::<Vec<_>>();

    Ok(RoleDataResult {
        success: true,
        message: "권한 조회 완료".to_string(),
        roles,
    })
}

// 역할 정보를 생성/수정합니다.
#[tauri::command]
async fn upsert_role_management(payload: UpsertRolePayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let role_id = payload.role.role_id.trim().to_uppercase();
    let role_name = payload.role.role_name.trim().to_string();
    let role_desc = payload.role.role_desc.trim().to_string();
    let user_count = if payload.role.user_count < 0 {
        0
    } else {
        payload.role.user_count
    };

    if role_id.is_empty() || role_name.is_empty() {
        return Err("역할 ID와 역할명은 필수입니다.".to_string());
    }

    client
        .execute(
            r#"
            INSERT INTO role_management (role_id, store_code, role_name, role_desc, user_count)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (role_id)
            DO UPDATE SET
                store_code = EXCLUDED.store_code,
                role_name = EXCLUDED.role_name,
                role_desc = EXCLUDED.role_desc,
                user_count = EXCLUDED.user_count,
                updated_at = NOW()
            "#,
            &[&role_id, &store_code, &role_name, &role_desc, &user_count],
        )
        .await
        .map_err(|e| format!("권한 저장 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "권한 저장 완료".to_string(),
    })
}

// 역할을 삭제합니다. (연관 권한 정리 포함)
#[tauri::command]
async fn delete_role_management(payload: DeleteRolePayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let role_id = payload.role_id.trim().to_uppercase();
    if role_id.is_empty() {
        return Err("삭제할 역할 ID가 비어 있습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM role_management WHERE role_id = $1 AND store_code = $2",
            &[&role_id, &store_code],
        )
        .await
        .map_err(|e| format!("권한 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 역할이 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "권한 삭제 완료".to_string(),
    })
}

// 특정 역할의 메뉴별 접근 권한을 조회합니다.
#[tauri::command]
async fn get_role_menu_permissions(
    payload: RoleMenuPermissionQueryPayload,
) -> Result<RoleMenuPermissionDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let role_id = payload.role_id.trim().to_uppercase();
    if role_id.is_empty() {
        return Err("role_id는 필수입니다.".to_string());
    }

    let role_exists = client
        .query_opt(
            "SELECT 1 FROM role_management WHERE role_id = $1 AND store_code = $2",
            &[&role_id, &store_code],
        )
        .await
        .map_err(|e| format!("역할 확인 실패: {e}"))?;
    if role_exists.is_none() {
        return Err("선택한 역할이 존재하지 않습니다.".to_string());
    }

    let rows = client
        .query(
            r#"
            SELECT
                COALESCE(rmp.id, 0)::BIGINT AS id,
                $1::VARCHAR AS role_id,
                mm.menu_id,
                mm.menu_name_ko,
                mm.menu_name_en,
                mm.menu_name_zh,
                COALESCE(rmp.can_read, FALSE) AS can_read,
                COALESCE(rmp.can_write, FALSE) AS can_write,
                COALESCE(rmp.can_delete, FALSE) AS can_delete
              FROM menu_management mm
         LEFT JOIN role_menu_permission rmp
                ON rmp.menu_id = mm.menu_id
               AND rmp.role_id = $1
               AND rmp.store_code = $2
             WHERE mm.store_code = $2
             ORDER BY (mm.parent_menu_id IS NOT NULL), COALESCE(mm.parent_menu_id, mm.menu_id), mm.menu_order, mm.menu_id
            "#,
            &[&role_id, &store_code],
        )
        .await
        .map_err(|e| format!("권한별 메뉴 조회 실패: {e}"))?;

    let permissions = rows
        .into_iter()
        .map(|row| RoleMenuPermissionDto {
            id: row.get::<_, i64>(0),
            role_id: row.get::<_, String>(1),
            menu_id: row.get::<_, i64>(2),
            menu_name_ko: row.get::<_, String>(3),
            menu_name_en: row.get::<_, String>(4),
            menu_name_zh: row.get::<_, String>(5),
            can_read: row.get::<_, bool>(6),
            can_write: row.get::<_, bool>(7),
            can_delete: row.get::<_, bool>(8),
        })
        .collect::<Vec<_>>();

    Ok(RoleMenuPermissionDataResult {
        success: true,
        message: "권한별 메뉴 조회 완료".to_string(),
        permissions,
    })
}

// 역할-메뉴 권한 매핑을 생성/수정합니다.
#[tauri::command]
async fn upsert_role_menu_permission(
    payload: UpsertRoleMenuPermissionPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let role_id = payload.permission.role_id.trim().to_uppercase();
    let menu_id = payload.permission.menu_id;
    if role_id.is_empty() {
        return Err("role_id는 필수입니다.".to_string());
    }
    if menu_id <= 0 {
        return Err("menu_id는 1 이상이어야 합니다.".to_string());
    }

    let role_exists = client
        .query_opt(
            "SELECT 1 FROM role_management WHERE role_id = $1 AND store_code = $2",
            &[&role_id, &store_code],
        )
        .await
        .map_err(|e| format!("역할 확인 실패: {e}"))?;
    if role_exists.is_none() {
        return Err("권한을 저장할 역할이 존재하지 않습니다.".to_string());
    }

    let menu_exists = client
        .query_opt(
            "SELECT 1 FROM menu_management WHERE menu_id = $1 AND store_code = $2",
            &[&menu_id, &store_code],
        )
        .await
        .map_err(|e| format!("메뉴 확인 실패: {e}"))?;
    if menu_exists.is_none() {
        return Err("선택한 점포코드 기준으로 메뉴가 존재하지 않습니다.".to_string());
    }

    client
        .execute(
            r#"
            INSERT INTO role_menu_permission (role_id, menu_id, store_code, can_read, can_write, can_delete)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (store_code, role_id, menu_id)
            DO UPDATE SET
                store_code = EXCLUDED.store_code,
                can_read = EXCLUDED.can_read,
                can_write = EXCLUDED.can_write,
                can_delete = EXCLUDED.can_delete,
                updated_at = NOW()
            "#,
            &[
                &role_id,
                &menu_id,
                &store_code,
                &payload.permission.can_read,
                &payload.permission.can_write,
                &payload.permission.can_delete,
            ],
        )
        .await
        .map_err(|e| format!("권한별 메뉴 저장 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "권한별 메뉴 저장 완료".to_string(),
    })
}


