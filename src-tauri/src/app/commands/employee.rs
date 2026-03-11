// 직원 관리 도메인 Tauri 명령입니다.

// 직원 관리 화면에서 사용할 직원 목록을 조회합니다.
#[tauri::command]
async fn get_employee_management_data(
    payload: EmployeeQueryPayload,
) -> Result<EmployeeDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_employee_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let rows = client
        .query(
            r#"
            SELECT
                e.employee_id,
                e.employee_name,
                e.employee_code,
                e.role_id,
                r.role_name,
                e.email,
                e.gender,
                e.phone,
                e.hire_date::TEXT,
                e.status,
                e.remarks
              FROM employee_management e
         LEFT JOIN role_management r ON r.role_id = e.role_id AND r.store_code = $1
             WHERE e.store_code = $1
             ORDER BY e.employee_id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("직원 데이터 조회 실패: {e}"))?;

    let employees = rows
        .into_iter()
        .map(|row| EmployeeDto {
            employee_id: row.get::<_, i64>(0),
            employee_name: row.get::<_, String>(1),
            employee_code: row.get::<_, String>(2),
            role_id: row.get::<_, Option<String>>(3),
            role_name: row.get::<_, Option<String>>(4),
            email: row.get::<_, Option<String>>(5),
            gender: row.get::<_, Option<String>>(6),
            phone: row.get::<_, Option<String>>(7),
            hire_date: row.get::<_, Option<String>>(8),
            status: row.get::<_, Option<String>>(9),
            remarks: row.get::<_, Option<String>>(10),
        })
        .collect::<Vec<_>>();

    Ok(EmployeeDataResult {
        success: true,
        message: "직원 조회 완료".to_string(),
        employees,
    })
}

// 직원 정보를 생성/수정합니다.
#[tauri::command]
async fn upsert_employee_management(
    payload: UpsertEmployeePayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_employee_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let employee = payload.employee;
    let employee_name = employee.employee_name.trim().to_string();
    let employee_code = employee.employee_code.trim().to_uppercase();
    let email = employee
        .email
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty());
    let role_id = employee
        .role_id
        .map(|v| v.trim().to_uppercase())
        .filter(|v| !v.is_empty());
    let gender = employee
        .gender
        .map(|v| v.trim().to_uppercase())
        .filter(|v| !v.is_empty());
    let phone = employee.phone.map(|v| v.trim().to_string());
    let hire_date = match employee
        .hire_date
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        Some(v) => Some(
            NaiveDate::parse_from_str(&v, "%Y-%m-%d")
                .map_err(|_| "입사일 형식은 YYYY-MM-DD 이어야 합니다.".to_string())?,
        ),
        None => None,
    };
    let status = employee
        .status
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "재직중".to_string());
    let remarks = employee.remarks.map(|v| v.trim().to_string());

    if employee_name.is_empty() || employee_code.is_empty() {
        return Err("직원명과 직원코드는 필수입니다.".to_string());
    }

    if let Some(ref rid) = role_id {
        let role_exists = client
            .query_opt(
                "SELECT 1 FROM role_management WHERE role_id = $1 AND store_code = $2",
                &[rid, &store_code],
            )
            .await
            .map_err(|e| format!("역할 확인 실패: {e}"))?;
        if role_exists.is_none() {
            return Err("선택한 역할이 존재하지 않습니다.".to_string());
        }
    }

    if let Some(id) = employee.employee_id {
        if id <= 0 {
            return Err("employee_id는 1 이상이어야 합니다.".to_string());
        }
        client
            .execute(
                r#"
                INSERT INTO employee_management (
                    employee_id, store_code, employee_name, employee_code, role_id, email, gender, phone, hire_date, status, remarks
                ) VALUES ($1::BIGINT,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (employee_id)
                DO UPDATE SET
                    store_code = EXCLUDED.store_code,
                    employee_name = EXCLUDED.employee_name,
                    employee_code = EXCLUDED.employee_code,
                    role_id = EXCLUDED.role_id,
                    email = EXCLUDED.email,
                    gender = EXCLUDED.gender,
                    phone = EXCLUDED.phone,
                    hire_date = EXCLUDED.hire_date,
                    status = EXCLUDED.status,
                    remarks = EXCLUDED.remarks,
                    updated_at = NOW()
                "#,
                &[
                    &id,
                    &store_code,
                    &employee_name,
                    &employee_code,
                    &role_id,
                    &email,
                    &gender,
                    &phone,
                    &hire_date,
                    &status,
                    &remarks,
                ],
            )
            .await
            .map_err(|e| format!("직원 저장 실패: {e}"))?;
    } else {
        client
            .execute(
                r#"
                INSERT INTO employee_management (
                    store_code, employee_name, employee_code, role_id, email, gender, phone, hire_date, status, remarks
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                "#,
                &[
                    &store_code,
                    &employee_name,
                    &employee_code,
                    &role_id,
                    &email,
                    &gender,
                    &phone,
                    &hire_date,
                    &status,
                    &remarks,
                ],
            )
            .await
            .map_err(|e| format!("직원 등록 실패: {e}"))?;
    }

    Ok(MutationResult {
        success: true,
        message: "직원 저장 완료".to_string(),
    })
}

// 직원 정보를 삭제합니다.
#[tauri::command]
async fn delete_employee_management(
    payload: DeleteEmployeePayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_employee_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.employee_id <= 0 {
        return Err("삭제할 employee_id가 올바르지 않습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM employee_management WHERE employee_id = $1::BIGINT AND store_code = $2",
            &[&payload.employee_id, &store_code],
        )
        .await
        .map_err(|e| format!("직원 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 직원이 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "직원 삭제 완료".to_string(),
    })
}


