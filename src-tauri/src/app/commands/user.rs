// 회원(고객) 관리 도메인 Tauri 명령입니다.

// 회원(고객) 목록을 조회합니다.
#[tauri::command]
async fn get_user_management_data(payload: UserQueryPayload) -> Result<UserDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let sql = r#"
        SELECT user_id::BIGINT, name, email, gender, phone, address, remarks
          FROM user_management
         WHERE store_code = $1
         ORDER BY user_id DESC
    "#;
    log_sql!(sql);
    let rows = client
        .query(sql, &[&store_code])
        .await
        .map_err(|e| format!("회원 조회 실패: {e}"))?;

    let users = rows
        .into_iter()
        .map(|row| UserDto {
            user_id: row.get::<_, i64>(0),
            name: row.get::<_, String>(1),
            email: row.get::<_, Option<String>>(2),
            gender: row.get::<_, Option<String>>(3),
            phone: row.get::<_, Option<String>>(4),
            address: row.get::<_, Option<String>>(5),
            remarks: row.get::<_, Option<String>>(6),
        })
        .collect::<Vec<_>>();

    Ok(UserDataResult {
        success: true,
        message: "회원 조회 완료".to_string(),
        users,
    })
}

// 회원(고객) 정보를 생성/수정합니다.
#[tauri::command]
async fn upsert_user_management(payload: UpsertUserPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let user = payload.user;
    let name = user.name.trim().to_string();
    let email = user
        .email
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty());
    let gender = user
        .gender
        .map(|v| v.trim().to_uppercase())
        .filter(|v| !v.is_empty());
    let phone = user
        .phone
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let address = user
        .address
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let remarks = user
        .remarks
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if name.is_empty() {
        return Err("이름은 필수입니다.".to_string());
    }

    if let Some(id) = user.user_id {
        if id <= 0 {
            return Err("user_id는 1 이상이어야 합니다.".to_string());
        }
        let sql = r#"
            INSERT INTO user_management (user_id, store_code, name, email, gender, phone, address, remarks)
            VALUES ($1::BIGINT, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (user_id)
            DO UPDATE SET
                store_code = EXCLUDED.store_code,
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                gender = EXCLUDED.gender,
                phone = EXCLUDED.phone,
                address = EXCLUDED.address,
                remarks = EXCLUDED.remarks,
                updated_at = NOW()
        "#;
        log_sql!(
            sql,
            id,
            &store_code,
            &name,
            &email,
            &gender,
            &phone,
            &address,
            &remarks
        );
        client
            .execute(
                sql,
                &[&id, &store_code, &name, &email, &gender, &phone, &address, &remarks],
            )
            .await
            .map_err(|e| format!("회원 저장 실패: {e}"))?;
    } else {
        let sql = r#"
            INSERT INTO user_management (store_code, name, email, gender, phone, address, remarks)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#;
        log_sql!(sql, &store_code, &name, &email, &gender, &phone, &address, &remarks);
        client
            .execute(
                sql,
                &[&store_code, &name, &email, &gender, &phone, &address, &remarks],
            )
            .await
            .map_err(|e| format!("회원 등록 실패: {e}"))?;
    }

    Ok(MutationResult {
        success: true,
        message: "회원 저장 완료".to_string(),
    })
}

// 회원(고객) 정보를 삭제합니다.
#[tauri::command]
async fn delete_user_management(payload: DeleteUserPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.user_id <= 0 {
        return Err("삭제할 user_id가 올바르지 않습니다.".to_string());
    }

    let sql = "DELETE FROM user_management WHERE user_id = $1::BIGINT AND store_code = $2";
    log_sql!(sql, payload.user_id, &store_code);
    let affected = client
        .execute(sql, &[&payload.user_id, &store_code])
        .await
        .map_err(|e| format!("회원 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 회원이 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "회원 삭제 완료".to_string(),
    })
}


