/**
 * @file common_code.rs
 * @description 애플리케이션 전반에서 사용되는 공통 코드(그룹/상세)의 CRUD 및 동기화를 담당하는 백엔드 명령 정의 파일입니다.
 */

/**
 * @function sync_common_code_management_to_db
 * @description 공통코드 그룹 및 상세 초기 데이터를 데이터베이스와 동기화합니다.
 * @param payload SyncCommonCodePayload: 동기화할 그룹/상세 데이터 및 DB 연결 정보
 * @return CommonCodeSyncResult: 동기화 결과 (성공 여부 및 처리 건수)
 */
#[tauri::command]
async fn sync_common_code_management_to_db(
    payload: SyncCommonCodePayload,
) -> Result<CommonCodeSyncResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    // 필요한 테이블(common_code_group, common_code_detail)이 없으면 생성
    ensure_common_code_tables(&client).await?;

    // 데이터 일관성을 위해 트랜잭션 사용
    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("트랜잭션 시작 실패: {e}"))?;

    // [SQL] 기존의 모든 공통코드 데이터를 삭제하여 초기화 상태로 만듭니다.
    transaction
        .batch_execute("TRUNCATE TABLE common_code_detail, common_code_group")
        .await
        .map_err(|e| format!("기존 공통코드 데이터 초기화 실패: {e}"))?;

    let mut detail_count_map: HashMap<&str, i32> = HashMap::new();
    for detail in &payload.details {
        *detail_count_map
            .entry(detail.group_id.as_str())
            .or_insert(0) += 1;
    }

    let mut groups = payload.groups;
    groups.sort_by_key(|g| g.display_order);

    for group in &groups {
        let detail_count = *detail_count_map.get(group.id.as_str()).unwrap_or(&0);
        // [SQL] 새로운 공통코드 그룹 데이터를 삽입합니다.
        // 각 그룹의 고유 ID, 명칭, 설명, 정렬 순서 및 하위 상세 코드 개수를 저장합니다.
        transaction
            .execute(
                r#"
                INSERT INTO common_code_group (
                    group_code_id,
                    group_name,
                    group_description,
                    display_order,
                    detail_count
                ) VALUES ($1,$2,$3,$4,$5)
                "#,
                &[
                    &group.id,           // $1: 그룹 코드 ID (예: 'T_CATEGORY')
                    &group.name,         // $2: 그룹 명칭
                    &group.desc,         // $3: 그룹 설명
                    &group.display_order, // $4: 화면 표시 순서
                    &detail_count,       // $5: 해당 그룹에 속한 상세코드 총 개수
                ],
            )
            .await
            .map_err(|e| format!("그룹코드 입력 실패(group_id={}): {e}", group.id))?;
    }

    let mut details = payload.details;
    details.sort_by_key(|d| (d.group_id.clone(), d.sort_order));

    for detail in &details {
        // [SQL] 각 그룹에 속한 상세 코드 데이터를 삽입합니다.
        // 그룹 ID와의 외래키 관계를 가지며, 실제 업무에서 구분이 되는 최소 단위의 데이터를 저장합니다.
        transaction
            .execute(
                r#"
                INSERT INTO common_code_detail (
                    group_code_id,
                    detail_code,
                    detail_name,
                    sort_order,
                    use_yn
                ) VALUES ($1,$2,$3,$4,$5)
                "#,
                &[
                    &detail.group_id,   // $1: 부모 그룹 코드 ID
                    &detail.code,       // $2: 상세 코드값 (예: 'C01')
                    &detail.name,       // $3: 상세 코드명 (예: '헤어커트')
                    &detail.sort_order, // $4: 그룹 내 정렬 순서
                    &detail.use_yn,     // $5: 현재 코드 사용 여부 ('Y'/'N')
                ],
            )
            .await
            .map_err(|e| {
                format!(
                    "상세코드 입력 실패(group_id={}, code={}): {e}",
                    detail.group_id, detail.code
                )
            })?;
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("트랜잭션 커밋 실패: {e}"))?;

    Ok(CommonCodeSyncResult {
        success: true,
        message: "common_code_group/common_code_detail 테이블 생성 및 데이터 반영 완료".to_string(),
        group_count: groups.len(),
        detail_count: details.len(),
    })
}

/**
 * @function get_common_code_management_data
 * @description 공통코드 관리 화면에서 필요한 전체 그룹 목록과 상세 목록을 조회합니다.
 * @param payload CommonCodeQueryPayload: 조회 필터 및 DB 연결 정보
 * @return CommonCodeDataResult: 조회된 그룹 및 상세 리스트 결과
 */
#[tauri::command]
async fn get_common_code_management_data(
    payload: CommonCodeQueryPayload,
) -> Result<CommonCodeDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_common_code_tables(&client).await?;

    // [SQL] 그룹코드 목록을 정렬 순서(display_order)대로 조회합니다.
    // 설명(description)이 NULL인 경우 빈 문자열로 정규화합니다.
    let group_rows = client
        .query(
            r#"
            SELECT group_code_id,
                   group_name,
                   COALESCE(group_description, ''),
                   display_order,
                   detail_count
              FROM common_code_group
             ORDER BY display_order, group_code_id
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("그룹코드 조회 실패: {e}"))?;

    // [SQL] 모든 상세코드 데이터를 조회하며, 부모 그룹 코드와 정렬 순서에 맞춰 나열합니다.
    let detail_rows = client
        .query(
            r#"
            SELECT group_code_id,
                   detail_code,
                   detail_name,
                   sort_order,
                   use_yn
              FROM common_code_detail
             ORDER BY group_code_id, sort_order, detail_code
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("상세코드 조회 실패: {e}"))?;

    let groups = group_rows
        .into_iter()
        .map(|row| CommonCodeGroupDto {
            id: row.get::<_, String>(0),
            name: row.get::<_, String>(1),
            desc: row.get::<_, String>(2),
            display_order: row.get::<_, i32>(3),
            count: row.get::<_, i32>(4),
        })
        .collect::<Vec<_>>();

    let details = detail_rows
        .into_iter()
        .map(|row| CommonCodeDetailDto {
            group: row.get::<_, String>(0),
            code: row.get::<_, String>(1),
            name: row.get::<_, String>(2),
            order: row.get::<_, i32>(3),
            use_yn: row.get::<_, String>(4),
        })
        .collect::<Vec<_>>();

    Ok(CommonCodeDataResult {
        success: true,
        message: "공통코드 조회 완료".to_string(),
        groups,
        details,
    })
}

/**
 * @function upsert_common_code_group
 * @description 새로운 공통코드 그룹을 생성하거나 기존 그룹 정보를 수정(Upsert)합니다.
 * @param payload UpsertCommonCodeGroupPayload: 등록/수정할 그룹 정보
 */
#[tauri::command]
async fn upsert_common_code_group(
    payload: UpsertCommonCodeGroupPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_common_code_tables(&client).await?;

    let group_id = payload.group.id.trim().to_uppercase();
    let group_name = payload.group.name.trim().to_string();
    let group_desc = payload.group.desc.trim().to_string();
    let display_order = if payload.group.display_order <= 0 {
        1
    } else {
        payload.group.display_order
    };

    if group_id.is_empty() || group_name.is_empty() {
        return Err("그룹 ID와 그룹명은 필수입니다.".to_string());
    }

    // [SQL] 그룹 명칭이나 설명 변경 시 'INSERT ... ON CONFLICT' 구문을 사용하여 기존 데이터를 식별하고 업데이트합니다.
    // group_code_id가 중복될 경우 DO UPDATE를 통해 최신 정보로 갱신하고 updated_at을 기록합니다.
    client
        .execute(
            r#"
            INSERT INTO common_code_group (
                group_code_id,
                group_name,
                group_description,
                display_order
            ) VALUES ($1,$2,$3,$4)
            ON CONFLICT (group_code_id)
            DO UPDATE SET
                group_name = EXCLUDED.group_name,
                group_description = EXCLUDED.group_description,
                display_order = EXCLUDED.display_order,
                updated_at = NOW()
            "#,
            &[&group_id, &group_name, &group_desc, &display_order],
        )
        .await
        .map_err(|e| format!("그룹코드 저장 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "그룹코드 저장 완료".to_string(),
    })
}

/**
 * @function delete_common_code_group
 * @description 지정된 공통코드 그룹을 전체 삭제합니다. (하위 상세코드는 DB 제약 조건 또는 별도 로직에 의해 처리됨)
 * @param payload DeleteCommonCodeGroupPayload: 삭제할 그룹 식별 정보
 */
#[tauri::command]
async fn delete_common_code_group(
    payload: DeleteCommonCodeGroupPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_common_code_tables(&client).await?;

    let group_id = payload.group_id.trim().to_uppercase();
    if group_id.is_empty() {
        return Err("삭제할 그룹 ID가 비어 있습니다.".to_string());
    }

    // [SQL] 특정 그룹 코드를 삭제합니다. 관계 설정에 따라 해당 그룹의 상세코드도 함께 정리될 수 있습니다.
    let affected = client
        .execute(
            "DELETE FROM common_code_group WHERE group_code_id = $1",
            &[&group_id],
        )
        .await
        .map_err(|e| format!("그룹코드 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 그룹코드가 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "그룹코드 삭제 완료".to_string(),
    })
}

// 공통코드 상세 항목을 생성하거나 수정합니다.
#[tauri::command]
async fn upsert_common_code_detail(
    payload: UpsertCommonCodeDetailPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_common_code_tables(&client).await?;

    let group_id = payload.detail.group_id.trim().to_uppercase();
    let detail_code = payload.detail.code.trim().to_uppercase();
    let detail_name = payload.detail.name.trim().to_string();
    let sort_order = if payload.detail.sort_order <= 0 {
        1
    } else {
        payload.detail.sort_order
    };
    let use_yn = payload.detail.use_yn.trim().to_uppercase();

    if group_id.is_empty() || detail_code.is_empty() || detail_name.is_empty() {
        return Err("그룹ID, 상세코드, 상세코드명은 필수입니다.".to_string());
    }
    if use_yn != "Y" && use_yn != "N" {
        return Err("사용여부(use_yn)는 Y 또는 N만 가능합니다.".to_string());
    }

    let exists = client
        .query_opt(
            "SELECT 1 FROM common_code_group WHERE group_code_id = $1",
            &[&group_id],
        )
        .await
        .map_err(|e| format!("그룹코드 확인 실패: {e}"))?;
    if exists.is_none() {
        return Err("상세코드를 저장할 그룹코드가 존재하지 않습니다.".to_string());
    }

    // [SQL] 상세 코드를 추가하거나 업데이트합니다.
    // (group_code_id, detail_code) 복합키를 기준으로 충돌 발생 시 명칭, 정렬순서, 사용여부를 덮어씁니다.
    client
        .execute(
            r#"
            INSERT INTO common_code_detail (
                group_code_id,
                detail_code,
                detail_name,
                sort_order,
                use_yn
            ) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (group_code_id, detail_code)
            DO UPDATE SET
                detail_name = EXCLUDED.detail_name,
                sort_order = EXCLUDED.sort_order,
                use_yn = EXCLUDED.use_yn,
                updated_at = NOW()
            "#,
            &[&group_id, &detail_code, &detail_name, &sort_order, &use_yn],
        )
        .await
        .map_err(|e| format!("상세코드 저장 실패: {e}"))?;

    refresh_group_detail_count(&client, &group_id).await?;

    Ok(MutationResult {
        success: true,
        message: "상세코드 저장 완료".to_string(),
    })
}

/**
 * @function delete_common_code_detail
 * @description 특정 그룹에 속한 하나의 상세 코드를 삭제합니다.
 * @param payload DeleteCommonCodeDetailPayload: 그룹ID 및 상세코드 정보
 */
#[tauri::command]
async fn delete_common_code_detail(
    payload: DeleteCommonCodeDetailPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_common_code_tables(&client).await?;

    let group_id = payload.group_id.trim().to_uppercase();
    let detail_code = payload.code.trim().to_uppercase();
    if group_id.is_empty() || detail_code.is_empty() {
        return Err("삭제할 그룹ID/상세코드 값이 비어 있습니다.".to_string());
    }

    // [SQL] 지정된 그룹의 유니크한 상세 코드를 삭제 쿼리입니다.
    let affected = client
        .execute(
            "DELETE FROM common_code_detail WHERE group_code_id = $1 AND detail_code = $2",
            &[&group_id, &detail_code],
        )
        .await
        .map_err(|e| format!("상세코드 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 상세코드가 없습니다.".to_string());
    }

    refresh_group_detail_count(&client, &group_id).await?;

    Ok(MutationResult {
        success: true,
        message: "상세코드 삭제 완료".to_string(),
    })
}


