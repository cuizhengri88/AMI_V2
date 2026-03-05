// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio_postgres::{Client, NoTls};

macro_rules! log_sql {
    ($sql:expr) => {
        println!("[SQL] {}", $sql);
    };
    ($sql:expr, $($param:expr),+) => {
        println!("[SQL] {} | params: {}", $sql, format!("{:?}", ($($param),+)));
    };
}

#[derive(Debug, Deserialize, Clone)]
struct DbConnectionPayload {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    schema: String,
}

#[derive(Debug, Serialize)]
struct DbConnectionResult {
    success: bool,
    message: String,
    current_schema: String,
    server_version: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct MenuNamesPayload {
    ko: String,
    en: String,
    zh: String,
}

#[derive(Debug, Deserialize)]
struct MenuRowPayload {
    id: i64,
    parent_id: Option<i64>,
    menu_type: String,
    path: String,
    order: i32,
    status: String,
    names: MenuNamesPayload,
}

#[derive(Debug, Deserialize)]
struct SyncMenuPayload {
    connection: DbConnectionPayload,
    menus: Vec<MenuRowPayload>,
}

#[derive(Debug, Serialize)]
struct MenuSyncResult {
    success: bool,
    message: String,
    inserted_count: usize,
}

#[derive(Debug, Deserialize)]
struct MenuQueryPayload {
    connection: DbConnectionPayload,
}

#[derive(Debug, Deserialize)]
struct UpsertMenuPayload {
    connection: DbConnectionPayload,
    menu: MenuRowPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteMenuPayload {
    connection: DbConnectionPayload,
    menu_id: i64,
}

#[derive(Debug, Serialize)]
struct MenuDto {
    id: i64,
    parent_id: Option<i64>,
    menu_type: String,
    path: String,
    order: i32,
    status: String,
    names: MenuNamesPayload,
}

#[derive(Debug, Serialize)]
struct MenuDataResult {
    success: bool,
    message: String,
    menus: Vec<MenuDto>,
}

#[derive(Debug, Deserialize)]
struct CodeGroupPayload {
    id: String,
    name: String,
    desc: String,
    display_order: i32,
}

#[derive(Debug, Deserialize)]
struct CodeDetailPayload {
    group_id: String,
    code: String,
    name: String,
    sort_order: i32,
    use_yn: String,
}

#[derive(Debug, Deserialize)]
struct SyncCommonCodePayload {
    connection: DbConnectionPayload,
    groups: Vec<CodeGroupPayload>,
    details: Vec<CodeDetailPayload>,
}

#[derive(Debug, Serialize)]
struct CommonCodeSyncResult {
    success: bool,
    message: String,
    group_count: usize,
    detail_count: usize,
}

#[derive(Debug, Deserialize)]
struct CommonCodeQueryPayload {
    connection: DbConnectionPayload,
}

#[derive(Debug, Deserialize)]
struct UpsertCommonCodeGroupPayload {
    connection: DbConnectionPayload,
    group: CodeGroupPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteCommonCodeGroupPayload {
    connection: DbConnectionPayload,
    group_id: String,
}

#[derive(Debug, Deserialize)]
struct UpsertCommonCodeDetailPayload {
    connection: DbConnectionPayload,
    detail: CodeDetailPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteCommonCodeDetailPayload {
    connection: DbConnectionPayload,
    group_id: String,
    code: String,
}

#[derive(Debug, Serialize)]
struct MutationResult {
    success: bool,
    message: String,
}

#[derive(Debug, Serialize)]
struct CommonCodeGroupDto {
    id: String,
    name: String,
    desc: String,
    count: i32,
    display_order: i32,
}

#[derive(Debug, Serialize)]
struct CommonCodeDetailDto {
    group: String,
    code: String,
    name: String,
    order: i32,
    use_yn: String,
}

#[derive(Debug, Serialize)]
struct CommonCodeDataResult {
    success: bool,
    message: String,
    groups: Vec<CommonCodeGroupDto>,
    details: Vec<CommonCodeDetailDto>,
}

#[derive(Debug, Deserialize)]
struct RoleQueryPayload {
    connection: DbConnectionPayload,
}

#[derive(Debug, Deserialize)]
struct RoleMenuPermissionQueryPayload {
    connection: DbConnectionPayload,
    role_id: String,
}

#[derive(Debug, Deserialize)]
struct RolePayload {
    role_id: String,
    role_name: String,
    role_desc: String,
    user_count: i32,
}

#[derive(Debug, Deserialize)]
struct UpsertRolePayload {
    connection: DbConnectionPayload,
    role: RolePayload,
}

#[derive(Debug, Deserialize)]
struct DeleteRolePayload {
    connection: DbConnectionPayload,
    role_id: String,
}

#[derive(Debug, Serialize)]
struct RoleDto {
    role_id: String,
    role_name: String,
    role_desc: String,
    user_count: i32,
}

#[derive(Debug, Serialize)]
struct RoleDataResult {
    success: bool,
    message: String,
    roles: Vec<RoleDto>,
}

#[derive(Debug, Deserialize)]
struct RoleMenuPermissionPayload {
    role_id: String,
    menu_id: i64,
    can_read: bool,
    can_write: bool,
    can_delete: bool,
}

#[derive(Debug, Deserialize)]
struct UpsertRoleMenuPermissionPayload {
    connection: DbConnectionPayload,
    permission: RoleMenuPermissionPayload,
}

#[derive(Debug, Serialize)]
struct RoleMenuPermissionDto {
    id: i64,
    role_id: String,
    menu_id: i64,
    menu_name_ko: String,
    menu_name_en: String,
    menu_name_zh: String,
    can_read: bool,
    can_write: bool,
    can_delete: bool,
}

#[derive(Debug, Serialize)]
struct RoleMenuPermissionDataResult {
    success: bool,
    message: String,
    permissions: Vec<RoleMenuPermissionDto>,
}

#[derive(Debug, Deserialize)]
struct EmployeePayload {
    employee_id: Option<i64>,
    employee_name: String,
    employee_code: String,
    role_id: Option<String>,
    email: String,
    phone: Option<String>,
    hire_date: Option<String>,
    status: Option<String>,
    remarks: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EmployeeQueryPayload {
    connection: DbConnectionPayload,
}

#[derive(Debug, Deserialize)]
struct UpsertEmployeePayload {
    connection: DbConnectionPayload,
    employee: EmployeePayload,
}

#[derive(Debug, Deserialize)]
struct DeleteEmployeePayload {
    connection: DbConnectionPayload,
    employee_id: i64,
}

#[derive(Debug, Serialize)]
struct EmployeeDto {
    employee_id: i64,
    employee_name: String,
    employee_code: String,
    role_id: Option<String>,
    role_name: Option<String>,
    email: String,
    phone: Option<String>,
    hire_date: Option<String>,
    status: Option<String>,
    remarks: Option<String>,
}

#[derive(Debug, Serialize)]
struct EmployeeDataResult {
    success: bool,
    message: String,
    employees: Vec<EmployeeDto>,
}

#[derive(Debug, Deserialize)]
struct UserPayload {
    user_id: Option<i64>,
    name: String,
    email: String,
    phone: Option<String>,
    address: Option<String>,
    remarks: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserQueryPayload {
    connection: DbConnectionPayload,
}

#[derive(Debug, Deserialize)]
struct UpsertUserPayload {
    connection: DbConnectionPayload,
    user: UserPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteUserPayload {
    connection: DbConnectionPayload,
    user_id: i64,
}

#[derive(Debug, Serialize)]
struct UserDto {
    user_id: i64,
    name: String,
    email: String,
    phone: Option<String>,
    address: Option<String>,
    remarks: Option<String>,
}

#[derive(Debug, Serialize)]
struct UserDataResult {
    success: bool,
    message: String,
    users: Vec<UserDto>,
}

fn get_safe_schema(schema: &str) -> Result<String, String> {
    let trimmed = schema.trim();
    if trimmed.is_empty() {
        return Err("스키마 값이 비어 있습니다.".to_string());
    }
    Ok(trimmed.replace('\"', "\"\""))
}

async fn connect_client(connection: &DbConnectionPayload) -> Result<Client, String> {
    let mut config = tokio_postgres::Config::new();
    config
        .host(&connection.host)
        .port(connection.port)
        .dbname(&connection.database)
        .user(&connection.username)
        .password(&connection.password);

    let (client, connection_task) = config
        .connect(NoTls)
        .await
        .map_err(|e| format!("DB 접속 실패: {e}"))?;

    tauri::async_runtime::spawn(async move {
        if let Err(e) = connection_task.await {
            eprintln!("postgres connection error: {e}");
        }
    });

    Ok(client)
}

async fn prepare_schema(client: &Client, schema: &str) -> Result<(), String> {
    let safe_schema = get_safe_schema(schema)?;
    client
        .batch_execute(&format!(
            r#"
            CREATE SCHEMA IF NOT EXISTS "{safe_schema}";
            SET search_path TO "{safe_schema}";
            "#
        ))
        .await
        .map_err(|e| format!("스키마 준비 실패: {e}"))?;
    Ok(())
}

async fn connect_with_schema(connection: &DbConnectionPayload) -> Result<Client, String> {
    let client = connect_client(connection).await?;
    prepare_schema(&client, &connection.schema).await?;
    Ok(client)
}

async fn ensure_menu_table(client: &Client) -> Result<(), String> {
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS menu_management (
                menu_id BIGINT PRIMARY KEY,
                parent_menu_id BIGINT NULL REFERENCES menu_management(menu_id) ON DELETE CASCADE,
                menu_type VARCHAR(10) NOT NULL CHECK (menu_type IN ('MAIN', 'SUB')),
                menu_path TEXT NOT NULL UNIQUE,
                menu_name_ko TEXT NOT NULL,
                menu_name_en TEXT NOT NULL,
                menu_name_zh TEXT NOT NULL,
                menu_order INTEGER NOT NULL DEFAULT 1,
                menu_status VARCHAR(20) NOT NULL DEFAULT '사용중',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .await
        .map_err(|e| format!("menu_management 테이블 생성 실패: {e}"))
}

async fn get_next_menu_id(client: &Client) -> Result<i64, String> {
    let row = client
        .query_one("SELECT COALESCE(MAX(menu_id), 0) + 1 FROM menu_management", &[])
        .await
        .map_err(|e| format!("next menu_id query failed: {e}"))?;
    Ok(row.get::<_, i64>(0))
}

async fn ensure_common_code_tables(client: &Client) -> Result<(), String> {
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS common_code_group (
                group_code_id VARCHAR(100) PRIMARY KEY,
                group_name TEXT NOT NULL,
                group_description TEXT NULL,
                display_order INTEGER NOT NULL DEFAULT 1,
                detail_count INTEGER NOT NULL DEFAULT 0 CHECK (detail_count >= 0),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS common_code_detail (
                group_code_id VARCHAR(100) NOT NULL REFERENCES common_code_group(group_code_id) ON DELETE CASCADE,
                detail_code VARCHAR(100) NOT NULL,
                detail_name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 1,
                use_yn CHAR(1) NOT NULL DEFAULT 'Y' CHECK (use_yn IN ('Y', 'N')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (group_code_id, detail_code)
            );

            CREATE INDEX IF NOT EXISTS idx_common_code_detail_group_sort
            ON common_code_detail (group_code_id, sort_order);
            "#,
        )
        .await
        .map_err(|e| format!("공통코드 테이블 생성 실패: {e}"))
}

async fn refresh_group_detail_count(client: &Client, group_id: &str) -> Result<(), String> {
    client
        .execute(
            r#"
            UPDATE common_code_group g
               SET detail_count = d.cnt,
                   updated_at = NOW()
              FROM (
                    SELECT COUNT(*)::INTEGER AS cnt
                      FROM common_code_detail
                     WHERE group_code_id = $1
                   ) d
             WHERE g.group_code_id = $1
            "#,
            &[&group_id],
        )
        .await
        .map_err(|e| format!("그룹 상세코드 수 갱신 실패: {e}"))?;
    Ok(())
}

async fn ensure_role_management_tables(client: &Client) -> Result<(), String> {
    ensure_menu_table(client).await?;
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS role_management (
                role_id VARCHAR(50) PRIMARY KEY,
                role_name VARCHAR(100) NOT NULL,
                role_desc TEXT NULL,
                user_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS role_menu_permission (
                id BIGSERIAL PRIMARY KEY,
                role_id VARCHAR(50) NOT NULL REFERENCES role_management(role_id) ON DELETE CASCADE,
                menu_id BIGINT NOT NULL REFERENCES menu_management(menu_id) ON DELETE CASCADE,
                can_read BOOLEAN NOT NULL DEFAULT FALSE,
                can_write BOOLEAN NOT NULL DEFAULT FALSE,
                can_delete BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (role_id, menu_id)
            );

            CREATE INDEX IF NOT EXISTS idx_role_menu_permission_role
            ON role_menu_permission (role_id);
            "#,
        )
        .await
        .map_err(|e| format!("권한 테이블 생성 실패: {e}"))
}

async fn ensure_employee_management_table(client: &Client) -> Result<(), String> {
    ensure_role_management_tables(client).await?;
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS employee_management (
                employee_id BIGSERIAL PRIMARY KEY,
                employee_name VARCHAR(100) NOT NULL,
                employee_code VARCHAR(50) NOT NULL UNIQUE,
                role_id VARCHAR(50) NULL REFERENCES role_management(role_id) ON DELETE SET NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                phone VARCHAR(20) NULL,
                hire_date DATE NULL,
                status VARCHAR(20) NOT NULL DEFAULT '재직중',
                remarks TEXT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_employee_management_role_id
            ON employee_management (role_id);
            "#,
        )
        .await
        .map_err(|e| format!("직원 테이블 생성 실패: {e}"))
}

async fn ensure_user_management_table(client: &Client) -> Result<(), String> {
    let sql = r#"
        CREATE TABLE IF NOT EXISTS user_management (
            user_id BIGSERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(100) NOT NULL UNIQUE,
            phone VARCHAR(20),
            address VARCHAR(255),
            remarks TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    "#;
    log_sql!(sql);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("회원 테이블 생성 실패: {e}"))
}

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

#[tauri::command]
async fn sync_menu_management_to_db(payload: SyncMenuPayload) -> Result<MenuSyncResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("트랜잭션 시작 실패: {e}"))?;

    transaction
        .batch_execute("TRUNCATE TABLE menu_management")
        .await
        .map_err(|e| format!("기존 메뉴 데이터 초기화 실패: {e}"))?;

    let mut menus = payload.menus;
    menus.sort_by_key(|m| m.parent_id.is_some());

    for menu in &menus {
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
                    menu_order,
                    menu_status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                "#,
                &[
                    &menu.id,
                    &menu.parent_id,
                    &menu.menu_type,
                    &menu.path,
                    &menu.names.ko,
                    &menu.names.en,
                    &menu.names.zh,
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

#[tauri::command]
async fn get_menu_management_data(payload: MenuQueryPayload) -> Result<MenuDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;

    let rows = client
        .query(
            r#"
            SELECT menu_id,
                   parent_menu_id,
                   menu_type,
                   menu_path,
                   menu_name_ko,
                   menu_name_en,
                   menu_name_zh,
                   menu_order,
                   menu_status
              FROM menu_management
             ORDER BY (parent_menu_id IS NOT NULL), COALESCE(parent_menu_id, menu_id), menu_order, menu_id
            "#,
            &[],
        )
        .await
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
            order: row.get::<_, i32>(7),
            status: row.get::<_, String>(8),
        })
        .collect::<Vec<_>>();

    Ok(MenuDataResult {
        success: true,
        message: "menu data loaded".to_string(),
        menus,
    })
}

#[tauri::command]
async fn upsert_menu_management(payload: UpsertMenuPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;

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

    let status = {
        let s = menu.status.trim();
        if s.is_empty() {
            "사용중".to_string()
        } else {
            s.to_string()
        }
    };

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
                "SELECT menu_type FROM menu_management WHERE menu_id = $1",
                &[&pid],
            )
            .await
            .map_err(|e| format!("parent menu validation failed: {e}"))?;

        match parent_row {
            Some(row) => {
                let parent_type: String = row.get(0);
                if parent_type.to_uppercase() != "MAIN" {
                    return Err("SUB menu parent must be MAIN type".to_string());
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
                menu_order,
                menu_status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (menu_id)
            DO UPDATE SET
                parent_menu_id = EXCLUDED.parent_menu_id,
                menu_type = EXCLUDED.menu_type,
                menu_path = EXCLUDED.menu_path,
                menu_name_ko = EXCLUDED.menu_name_ko,
                menu_name_en = EXCLUDED.menu_name_en,
                menu_name_zh = EXCLUDED.menu_name_zh,
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
                &order,
                &status,
            ],
        )
        .await
        .map_err(|e| format!("menu upsert failed: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: format!("menu saved (id={menu_id})"),
    })
}

#[tauri::command]
async fn delete_menu_management(payload: DeleteMenuPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;

    if payload.menu_id <= 0 {
        return Err("valid menu_id is required".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM menu_management WHERE menu_id = $1",
            &[&payload.menu_id],
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

#[tauri::command]
async fn sync_common_code_management_to_db(
    payload: SyncCommonCodePayload,
) -> Result<CommonCodeSyncResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_common_code_tables(&client).await?;

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("트랜잭션 시작 실패: {e}"))?;

    transaction
        .batch_execute("TRUNCATE TABLE common_code_detail, common_code_group")
        .await
        .map_err(|e| format!("기존 공통코드 데이터 초기화 실패: {e}"))?;

    let mut detail_count_map: HashMap<&str, i32> = HashMap::new();
    for detail in &payload.details {
        *detail_count_map.entry(detail.group_id.as_str()).or_insert(0) += 1;
    }

    let mut groups = payload.groups;
    groups.sort_by_key(|g| g.display_order);

    for group in &groups {
        let detail_count = *detail_count_map.get(group.id.as_str()).unwrap_or(&0);
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
                    &group.id,
                    &group.name,
                    &group.desc,
                    &group.display_order,
                    &detail_count,
                ],
            )
            .await
            .map_err(|e| format!("그룹코드 입력 실패(group_id={}): {e}", group.id))?;
    }

    let mut details = payload.details;
    details.sort_by_key(|d| (d.group_id.clone(), d.sort_order));

    for detail in &details {
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
                    &detail.group_id,
                    &detail.code,
                    &detail.name,
                    &detail.sort_order,
                    &detail.use_yn,
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

#[tauri::command]
async fn get_common_code_management_data(
    payload: CommonCodeQueryPayload,
) -> Result<CommonCodeDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_common_code_tables(&client).await?;

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

#[tauri::command]
async fn get_role_management_data(payload: RoleQueryPayload) -> Result<RoleDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;

    let rows = client
        .query(
            r#"
            SELECT role_id, role_name, COALESCE(role_desc, ''), user_count
              FROM role_management
             ORDER BY role_id
            "#,
            &[],
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

#[tauri::command]
async fn upsert_role_management(payload: UpsertRolePayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;

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
            INSERT INTO role_management (role_id, role_name, role_desc, user_count)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (role_id)
            DO UPDATE SET
                role_name = EXCLUDED.role_name,
                role_desc = EXCLUDED.role_desc,
                user_count = EXCLUDED.user_count,
                updated_at = NOW()
            "#,
            &[&role_id, &role_name, &role_desc, &user_count],
        )
        .await
        .map_err(|e| format!("권한 저장 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "권한 저장 완료".to_string(),
    })
}

#[tauri::command]
async fn delete_role_management(payload: DeleteRolePayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;

    let role_id = payload.role_id.trim().to_uppercase();
    if role_id.is_empty() {
        return Err("삭제할 역할 ID가 비어 있습니다.".to_string());
    }

    let affected = client
        .execute("DELETE FROM role_management WHERE role_id = $1", &[&role_id])
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

#[tauri::command]
async fn get_role_menu_permissions(
    payload: RoleMenuPermissionQueryPayload,
) -> Result<RoleMenuPermissionDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;

    let role_id = payload.role_id.trim().to_uppercase();
    if role_id.is_empty() {
        return Err("role_id는 필수입니다.".to_string());
    }

    let role_exists = client
        .query_opt(
            "SELECT 1 FROM role_management WHERE role_id = $1",
            &[&role_id],
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
             ORDER BY (mm.parent_menu_id IS NOT NULL), COALESCE(mm.parent_menu_id, mm.menu_id), mm.menu_order, mm.menu_id
            "#,
            &[&role_id],
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

#[tauri::command]
async fn upsert_role_menu_permission(
    payload: UpsertRoleMenuPermissionPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_role_management_tables(&client).await?;

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
            "SELECT 1 FROM role_management WHERE role_id = $1",
            &[&role_id],
        )
        .await
        .map_err(|e| format!("역할 확인 실패: {e}"))?;
    if role_exists.is_none() {
        return Err("권한을 저장할 역할이 존재하지 않습니다.".to_string());
    }

    client
        .execute(
            r#"
            INSERT INTO role_menu_permission (role_id, menu_id, can_read, can_write, can_delete)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (role_id, menu_id)
            DO UPDATE SET
                can_read = EXCLUDED.can_read,
                can_write = EXCLUDED.can_write,
                can_delete = EXCLUDED.can_delete,
                updated_at = NOW()
            "#,
            &[
                &role_id,
                &menu_id,
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

#[tauri::command]
async fn get_employee_management_data(
    payload: EmployeeQueryPayload,
) -> Result<EmployeeDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_employee_management_table(&client).await?;

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
                e.phone,
                e.hire_date::TEXT,
                e.status,
                e.remarks
              FROM employee_management e
         LEFT JOIN role_management r ON r.role_id = e.role_id
             ORDER BY e.employee_id DESC
            "#,
            &[],
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
            email: row.get::<_, String>(5),
            phone: row.get::<_, Option<String>>(6),
            hire_date: row.get::<_, Option<String>>(7),
            status: row.get::<_, Option<String>>(8),
            remarks: row.get::<_, Option<String>>(9),
        })
        .collect::<Vec<_>>();

    Ok(EmployeeDataResult {
        success: true,
        message: "직원 조회 완료".to_string(),
        employees,
    })
}

#[tauri::command]
async fn upsert_employee_management(payload: UpsertEmployeePayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_employee_management_table(&client).await?;

    let employee = payload.employee;
    let employee_name = employee.employee_name.trim().to_string();
    let employee_code = employee.employee_code.trim().to_uppercase();
    let email = employee.email.trim().to_lowercase();
    let role_id = employee
        .role_id
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

    if employee_name.is_empty() || employee_code.is_empty() || email.is_empty() {
        return Err("직원명, 직원코드, 이메일은 필수입니다.".to_string());
    }

    if let Some(ref rid) = role_id {
        let role_exists = client
            .query_opt("SELECT 1 FROM role_management WHERE role_id = $1", &[rid])
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
                    employee_id, employee_name, employee_code, role_id, email, phone, hire_date, status, remarks
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                ON CONFLICT (employee_id)
                DO UPDATE SET
                    employee_name = EXCLUDED.employee_name,
                    employee_code = EXCLUDED.employee_code,
                    role_id = EXCLUDED.role_id,
                    email = EXCLUDED.email,
                    phone = EXCLUDED.phone,
                    hire_date = EXCLUDED.hire_date,
                    status = EXCLUDED.status,
                    remarks = EXCLUDED.remarks,
                    updated_at = NOW()
                "#,
                &[
                    &id,
                    &employee_name,
                    &employee_code,
                    &role_id,
                    &email,
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
                    employee_name, employee_code, role_id, email, phone, hire_date, status, remarks
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                "#,
                &[
                    &employee_name,
                    &employee_code,
                    &role_id,
                    &email,
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

#[tauri::command]
async fn delete_employee_management(
    payload: DeleteEmployeePayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_employee_management_table(&client).await?;

    if payload.employee_id <= 0 {
        return Err("삭제할 employee_id가 올바르지 않습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM employee_management WHERE employee_id = $1",
            &[&payload.employee_id],
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

#[tauri::command]
async fn get_user_management_data(payload: UserQueryPayload) -> Result<UserDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;

    let sql = r#"
        SELECT user_id::BIGINT, name, email, phone, address, remarks
          FROM user_management
         ORDER BY user_id DESC
    "#;
    log_sql!(sql);
    let rows = client
        .query(sql, &[])
        .await
        .map_err(|e| format!("회원 조회 실패: {e}"))?;

    let users = rows
        .into_iter()
        .map(|row| UserDto {
            user_id: row.get::<_, i64>(0),
            name: row.get::<_, String>(1),
            email: row.get::<_, String>(2),
            phone: row.get::<_, Option<String>>(3),
            address: row.get::<_, Option<String>>(4),
            remarks: row.get::<_, Option<String>>(5),
        })
        .collect::<Vec<_>>();

    Ok(UserDataResult {
        success: true,
        message: "회원 조회 완료".to_string(),
        users,
    })
}

#[tauri::command]
async fn upsert_user_management(payload: UpsertUserPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;

    let user = payload.user;
    let name = user.name.trim().to_string();
    let email = user.email.trim().to_lowercase();
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

    if name.is_empty() || email.is_empty() {
        return Err("이름, 이메일은 필수입니다.".to_string());
    }

    if let Some(id) = user.user_id {
        if id <= 0 {
            return Err("user_id는 1 이상이어야 합니다.".to_string());
        }
        let sql = r#"
            INSERT INTO user_management (user_id, name, email, phone, address, remarks)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                address = EXCLUDED.address,
                remarks = EXCLUDED.remarks,
                updated_at = NOW()
        "#;
        log_sql!(sql, id, &name, &email, &phone, &address, &remarks);
        client
            .execute(sql, &[&id, &name, &email, &phone, &address, &remarks])
            .await
            .map_err(|e| format!("회원 저장 실패: {e}"))?;
    } else {
        let sql = r#"
            INSERT INTO user_management (name, email, phone, address, remarks)
            VALUES ($1, $2, $3, $4, $5)
        "#;
        log_sql!(sql, &name, &email, &phone, &address, &remarks);
        client
            .execute(sql, &[&name, &email, &phone, &address, &remarks])
            .await
            .map_err(|e| format!("회원 등록 실패: {e}"))?;
    }

    Ok(MutationResult {
        success: true,
        message: "회원 저장 완료".to_string(),
    })
}

#[tauri::command]
async fn delete_user_management(payload: DeleteUserPayload) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;

    if payload.user_id <= 0 {
        return Err("삭제할 user_id가 올바르지 않습니다.".to_string());
    }

    let sql = "DELETE FROM user_management WHERE user_id = $1";
    log_sql!(sql, payload.user_id);
    let affected = client
        .execute(sql, &[&payload.user_id])
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            test_db_connection,
            sync_menu_management_to_db,
            get_menu_management_data,
            upsert_menu_management,
            delete_menu_management,
            sync_common_code_management_to_db,
            get_common_code_management_data,
            upsert_common_code_group,
            delete_common_code_group,
            upsert_common_code_detail,
            delete_common_code_detail,
            get_role_management_data,
            upsert_role_management,
            delete_role_management,
            get_role_menu_permissions,
            upsert_role_menu_permission,
            get_employee_management_data,
            upsert_employee_management,
            delete_employee_management,
            get_user_management_data,
            upsert_user_management,
            delete_user_management
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
