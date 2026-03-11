// 시스템/연결/백업/파일 내보내기/매장 바인딩 관련 Tauri 명령입니다.

// 클라이언트가 전달한 DB 접속 정보로 연결/스키마/버전 상태를 즉시 점검합니다.
#[tauri::command]
async fn test_db_connection(payload: DbConnectionPayload) -> Result<DbConnectionResult, String> {
    let client = connect_with_schema(&payload).await?;

    let row = client
        .query_one("SELECT current_schema(), version()", &[])
        .await
        .map_err(|e| format!("DB 확인 쿼리 실패: {e}"))?;

    let current_schema: String = row.get(0);
    let server_version: String = row.get(1);

    Ok(DbConnectionResult {
        success: true,
        message: "DB 연결 성공".to_string(),
        current_schema,
        server_version,
    })
}

// 선택한 스키마의 주요 관리 테이블을 JSON 파일로 백업합니다.
#[tauri::command]
async fn backup_database_to_file(
    payload: DatabaseBackupPayload,
) -> Result<DatabaseBackupResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    let safe_schema = get_safe_schema(&payload.connection.schema)?;

    let raw_target_path = payload
        .target_path
        .trim()
        .trim_matches(|ch| ch == '"' || ch == '\'');
    if raw_target_path.is_empty() {
        return Err("백업 파일 경로가 비어 있습니다.".to_string());
    }

    let mut output_path = PathBuf::from(raw_target_path);
    let looks_like_directory = raw_target_path.ends_with('\\')
        || raw_target_path.ends_with('/')
        || output_path.extension().is_none();

    if looks_like_directory || output_path.is_dir() {
        fs::create_dir_all(&output_path).map_err(|e| format!("백업 폴더 생성 실패: {e}"))?;
        let file_stamp = Utc::now().format("%Y%m%d_%H%M%S");
        output_path = output_path.join(format!("ami_backup_{file_stamp}.json"));
    } else {
        if output_path.extension().is_none() {
            output_path.set_extension("json");
        }
        if let Some(parent) = output_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| format!("백업 폴더 생성 실패: {e}"))?;
            }
        }
    }

    let table_rows = client
        .query(
            r#"
            SELECT table_name
              FROM information_schema.tables
             WHERE table_schema = $1
               AND table_type = 'BASE TABLE'
             ORDER BY table_name
            "#,
            &[&payload.connection.schema],
        )
        .await
        .map_err(|e| format!("백업 대상 테이블 조회 실패: {e}"))?;

    let mut tables_json = serde_json::Map::new();
    for row in table_rows {
        let table_name: String = row.get(0);
        let safe_table = table_name.replace('\"', "\"\"");
        let sql = format!(
            r#"
            SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::TEXT
              FROM "{safe_schema}"."{safe_table}" t
            "#
        );
        let snapshot_text: String = client
            .query_one(&sql, &[])
            .await
            .map_err(|e| format!("{table_name} 테이블 백업 실패: {e}"))?
            .get(0);

        let snapshot_json = serde_json::from_str::<serde_json::Value>(&snapshot_text)
            .map_err(|e| format!("{table_name} 테이블 JSON 변환 실패: {e}"))?;
        tables_json.insert(table_name, snapshot_json);
    }

    let generated_at = Utc::now().to_rfc3339();
    let backup_json = serde_json::json!({
        "metadata": {
            "generated_at": generated_at,
            "host": payload.connection.host,
            "port": payload.connection.port,
            "database": payload.connection.database,
            "schema": payload.connection.schema
        },
        "tables": tables_json
    });

    let serialized = serde_json::to_string_pretty(&backup_json)
        .map_err(|e| format!("백업 JSON 생성 실패: {e}"))?;
    fs::write(&output_path, serialized).map_err(|e| format!("백업 파일 저장 실패: {e}"))?;

    Ok(DatabaseBackupResult {
        success: true,
        message: "DB 백업 파일 생성 완료".to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        table_count: backup_json["tables"]
            .as_object()
            .map(|tables| tables.len())
            .unwrap_or(0),
        generated_at,
    })
}

fn resolve_downloads_dir() -> PathBuf {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        return PathBuf::from(user_profile).join("Downloads");
    }

    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Downloads");
    }

    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn sanitize_sub_directory(raw: &str) -> Option<PathBuf> {
    let mut path = PathBuf::new();
    for segment in raw.split(&['/', '\\'][..]) {
        let trimmed = segment.trim();
        if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
            continue;
        }

        let safe: String = trimmed
            .chars()
            .map(|ch| match ch {
                '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
                _ => ch,
            })
            .collect();
        let safe_trimmed = safe.trim();
        if safe_trimmed.is_empty() {
            continue;
        }
        path.push(safe_trimmed);
    }

    if path.as_os_str().is_empty() {
        None
    } else {
        Some(path)
    }
}

// 임의 텍스트 콘텐츠를 다운로드 폴더(또는 하위 폴더)에 파일로 저장합니다.
#[tauri::command]
async fn export_text_file(payload: ExportTextFilePayload) -> Result<ExportTextFileResult, String> {
    let raw_file_name = payload.file_name.trim();
    if raw_file_name.is_empty() {
        return Err("저장할 파일명이 비어 있습니다.".to_string());
    }

    let file_name = Path::new(raw_file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "유효한 파일명이 아닙니다.".to_string())?;

    let mut initial_dir = resolve_downloads_dir();
    if let Some(sub_dir) = payload
        .sub_dir
        .as_deref()
        .and_then(|value| sanitize_sub_directory(value))
    {
        initial_dir = initial_dir.join(sub_dir);
    }

    if !initial_dir.exists() {
        fs::create_dir_all(&initial_dir).map_err(|e| format!("저장 폴더 생성 실패: {e}"))?;
    }

    let Some(output_path) = FileDialog::new()
        .set_directory(&initial_dir)
        .set_file_name(&file_name)
        .save_file()
    else {
        return Ok(ExportTextFileResult {
            success: false,
            cancelled: true,
            message: "파일 저장이 취소되었습니다.".to_string(),
            output_path: None,
            bytes: 0,
        });
    };

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("저장 폴더 생성 실패: {e}"))?;
        }
    }

    let bytes = payload.content.as_bytes().len();
    fs::write(&output_path, payload.content.as_bytes())
        .map_err(|e| format!("파일 저장 실패: {e}"))?;

    Ok(ExportTextFileResult {
        success: true,
        cancelled: false,
        message: "파일 저장 완료".to_string(),
        output_path: Some(output_path.to_string_lossy().to_string()),
        bytes,
    })
}

// 운영 전후 점검을 위해 필수 테이블/컬럼/코드값 무결성을 일괄 검사합니다.
#[tauri::command]
async fn run_db_integrity_check(
    payload: DbIntegrityCheckPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    let full_check_key = build_full_db_integrity_check_key(&payload.connection);

    if is_local_migration_checked(&full_check_key) {
        return Ok(MutationResult {
            success: true,
            message: "DB 무결성검사가 이미 완료되어 재검사를 생략했습니다.".to_string(),
        });
    }

    // 무결성 검사 커맨드에서만 ensure_*가 실제 DDL/보정 쿼리를 실행하도록 모드를 켠다.
    let _integrity_mode_guard = enter_db_integrity_check_mode();
    ensure_sales_settlement_management_tables(&client).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;

    mark_local_migration_checked(&full_check_key);

    Ok(MutationResult {
        success: true,
        message: "DB 무결성검사 완료".to_string(),
    })
}

// 현재 단말(HWID)과 매장 코드의 바인딩 상태를 조회합니다.
#[tauri::command]
async fn get_store_binding_status(
    payload: StoreBindingStatusPayload,
) -> Result<StoreBindingStatusResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_store_binding_table(&client).await?;

    let hwid = detect_hwid();
    let cpu_id = detect_cpu_id();

    let denied_exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM security_store_binding
             WHERE hwid = $1
               AND status = 'N'
             ORDER BY id DESC
             LIMIT 1
            "#,
            &[&hwid],
        )
        .await
        .map_err(|e| format!("보안 인증 차단 상태 조회 실패: {e}"))?
        .is_some();

    if denied_exists {
        return Err(STORE_BINDING_DENIED_MESSAGE.to_string());
    }

    let row = client
        .query_opt(
            r#"
            SELECT store_code, registered_at::TEXT
              FROM security_store_binding
             WHERE hwid = $1
               AND status = 'Y'
             ORDER BY registered_at DESC, id DESC
             LIMIT 1
            "#,
            &[&hwid],
        )
        .await
        .map_err(|e| format!("보안 인증 상태 조회 실패: {e}"))?;

    let (bound_store_code, registered_at, message) = if let Some(row) = row {
        (
            Some(row.get::<_, String>(0)),
            Some(row.get::<_, String>(1)),
            "현재 장치에 등록된 점포코드를 확인했습니다.".to_string(),
        )
    } else {
        (
            None,
            None,
            "현재 장치는 아직 점포코드 인증이 완료되지 않았습니다.".to_string(),
        )
    };

    Ok(StoreBindingStatusResult {
        success: true,
        message,
        hwid,
        cpu_id,
        bound_store_code,
        registered_at,
    })
}

// 바인딩이 없으면 등록하고, 있으면 단말/코드 일치 여부를 검증합니다.
#[tauri::command]
async fn verify_or_register_store_binding(
    payload: VerifyStoreBindingPayload,
) -> Result<VerifyStoreBindingResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_store_binding_table(&client).await?;

    let store_code = payload.store_code.trim().to_uppercase();
    if store_code.is_empty() {
        return Err("점포코드를 입력해 주세요.".to_string());
    }

    validate_store_code_in_str_cd(&client, &store_code).await?;

    let hwid = detect_hwid();
    let cpu_id = detect_cpu_id();
    let host_name = detect_host_name();
    let cdkey = payload.cdkey.trim().to_uppercase();

    if cdkey.is_empty() {
        return Err("CDKEY를 입력해 주세요.".to_string());
    }

    let denied_exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM security_store_binding
             WHERE hwid = $1
               AND status = 'N'
             ORDER BY id DESC
             LIMIT 1
            "#,
            &[&hwid],
        )
        .await
        .map_err(|e| format!("현재 장치 인증 차단 상태 조회 실패: {e}"))?
        .is_some();

    if denied_exists {
        return Err(STORE_BINDING_DENIED_MESSAGE.to_string());
    }

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("점포 인증 트랜잭션 시작 실패: {e}"))?;

    let cdkey_row = transaction
        .query_opt(
            r#"
            SELECT id, use_yn, security_store_binding_id
              FROM security_cdkey
             WHERE cdkey = $1
             FOR UPDATE
            "#,
            &[&cdkey],
        )
        .await
        .map_err(|e| format!("CDKEY 조회 실패: {e}"))?;

    let Some(cdkey_row) = cdkey_row else {
        return Err("유효하지 않은 CDKEY 입니다.".to_string());
    };

    let cdkey_id: i64 = cdkey_row.get(0);
    let use_yn: String = cdkey_row.get(1);
    let mapped_binding_id: Option<i64> = cdkey_row.get(2);
    if !use_yn.trim().eq_ignore_ascii_case("N") || mapped_binding_id.is_some() {
        return Err("이미 사용된 CDKEY 입니다. 다른 CDKEY를 입력해 주세요.".to_string());
    }

    let binding_row = transaction
        .query_one(
            r#"
            INSERT INTO security_store_binding (
                store_code,
                hwid,
                cpu_id,
                host_name
            ) VALUES ($1, $2, $3, $4)
            RETURNING id, registered_at::TEXT
            "#,
            &[&store_code, &hwid, &cpu_id, &host_name],
        )
        .await
        .map_err(|e| format!("점포 인증 등록 실패: {e}"))?;

    let binding_id: i64 = binding_row.get(0);
    let registered_at: String = binding_row.get(1);

    let updated_count = transaction
        .execute(
            r#"
            UPDATE security_cdkey
               SET use_yn = 'Y',
                   security_store_binding_id = $2,
                   used_at = NOW()
             WHERE id = $1
               AND use_yn = 'N'
               AND security_store_binding_id IS NULL
            "#,
            &[&cdkey_id, &binding_id],
        )
        .await
        .map_err(|e| format!("CDKEY 사용처리 실패: {e}"))?;

    if updated_count == 0 {
        return Err("이미 사용된 CDKEY 입니다. 다른 CDKEY를 입력해 주세요.".to_string());
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("점포 인증 등록 커밋 실패: {e}"))?;

    Ok(VerifyStoreBindingResult {
        success: true,
        message: "점포코드 인증이 완료되었습니다.".to_string(),
        store_code,
        hwid,
        cpu_id,
        registered_at,
        is_new_registration: true,
    })
}


