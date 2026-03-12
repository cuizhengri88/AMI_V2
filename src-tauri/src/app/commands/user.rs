use crate::app::core::foundation::*;

/**
 * @file user.rs
 * @description 매장의 회원(고객) 기본 정보(이름, 연락처, 성별, 주소 등)를 관리하는 백엔드 명령 정의 파일입니다.
 * 회원별 데이터를 점포 코드로 격리하여 관리하며, 데이터 저장 시 정규화 과정을 포함합니다.
 */

/**
 * @function get_user_management_data
 * @description 등록된 전체 회원 목록을 조회합니다. 최신 등록된 회원이 상단에 노출되도록 정렬합니다.
 * @param payload UserQueryPayload: 조회 조건 및 DB 연결 정보
 * @return UserDataResult: 회원 리스트 결과
 */
#[tauri::command]
pub async fn get_user_management_data(payload: UserQueryPayload) -> Result<UserDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    // [SQL] 해당 점포의 모든 회원 정보를 조회합니다. (ID 역순 정렬)
    let sql = r#"
        SELECT user_id::BIGINT, name, email, gender, phone, address, remarks
          FROM user_management
         WHERE store_code = $1
         ORDER BY user_id DESC
    "#;
    log_sql_fn(sql, None);
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
pub async fn upsert_user_management(payload: UpsertUserPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let user = payload.user;
    let name = user.name.trim().to_string();
    
    // 데이터 정규화: 이메일은 소문자로 변환하고, 각 필드의 불필요한 공백을 제거합니다.
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
        
        // [SQL] ID가 존재하는 경우 회원 정보를 업데이트(Upsert)합니다.
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
        log_sql_fn(sql, Some(format!("{:?}", (id, &store_code, &name, &email, &gender, &phone, &address, &remarks))));
        client
            .execute(
                sql,
                &[&id, &store_code, &name, &email, &gender, &phone, &address, &remarks],
            )
            .await
            .map_err(|e| format!("회원 저장 실패: {e}"))?;
    } else {
        // [SQL] ID가 없는 경우 신규 회원을 등록합니다.
        let sql = r#"
            INSERT INTO user_management (store_code, name, email, gender, phone, address, remarks)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#;
        log_sql_fn(sql, Some(format!("{:?}", (&store_code, &name, &email, &gender, &phone, &address, &remarks))));
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

/**
 * @function delete_user_management
 * @description 등록된 회원 정보를 삭제합니다. 점포 코드를 확인하여 데이터 오삭제를 방지합니다.
 * @param payload DeleteUserPayload: 삭제할 회원 ID 정보
 */
#[tauri::command]
pub async fn delete_user_management(payload: DeleteUserPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.user_id <= 0 {
        return Err("삭제할 user_id가 올바르지 않습니다.".to_string());
    }

    let sql = "DELETE FROM user_management WHERE user_id = $1::BIGINT AND store_code = $2";
    log_sql_fn(sql, Some(format!("{:?}", (payload.user_id, &store_code))));
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


