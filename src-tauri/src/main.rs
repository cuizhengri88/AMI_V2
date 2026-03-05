// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio_postgres::{Client, NoTls};

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

fn get_safe_schema(schema: &str) -> Result<String, String> {
    let trimmed = schema.trim();
    if trimmed.is_empty() {
        return Err("?ㅽ궎留?媛믪씠 鍮꾩뼱 ?덉뒿?덈떎.".to_string());
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
        .map_err(|e| format!("DB ?묒냽 ?ㅽ뙣: {e}"))?;

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
        .map_err(|e| format!("?ㅽ궎留?以鍮??ㅽ뙣: {e}"))?;
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
        .map_err(|e| format!("menu_management ?뚯씠釉??앹꽦 ?ㅽ뙣: {e}"))
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
        .map_err(|e| format!("怨듯넻肄붾뱶 ?뚯씠釉??앹꽦 ?ㅽ뙣: {e}"))
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
        .map_err(|e| format!("洹몃９ ?곸꽭肄붾뱶 ??媛깆떊 ?ㅽ뙣: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn test_db_connection(payload: DbConnectionPayload) -> Result<DbConnectionResult, String> {
    let client = connect_with_schema(&payload).await?;

    let row = client
        .query_one("SELECT current_schema(), version()", &[])
        .await
        .map_err(|e| format!("DB ?뺤씤 荑쇰━ ?ㅽ뙣: {e}"))?;

    let current_schema: String = row.get(0);
    let server_version: String = row.get(1);

    Ok(DbConnectionResult {
        success: true,
        message: "DB ?곌껐 ?깃났".to_string(),
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
        .map_err(|e| format!("?몃옖??뀡 ?쒖옉 ?ㅽ뙣: {e}"))?;

    transaction
        .batch_execute("TRUNCATE TABLE menu_management")
        .await
        .map_err(|e| format!("湲곗〈 硫붾돱 ?곗씠??珥덇린???ㅽ뙣: {e}"))?;

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
            .map_err(|e| format!("硫붾돱 ?곗씠???낅젰 ?ㅽ뙣(menu_id={}): {e}", menu.id))?;
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("?몃옖??뀡 而ㅻ컠 ?ㅽ뙣: {e}"))?;

    Ok(MenuSyncResult {
        success: true,
        message: "menu_management ?뚯씠釉??앹꽦 諛??곗씠??諛섏쁺 ?꾨즺".to_string(),
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
        .map_err(|e| format!("?몃옖??뀡 ?쒖옉 ?ㅽ뙣: {e}"))?;

    transaction
        .batch_execute("TRUNCATE TABLE common_code_detail, common_code_group")
        .await
        .map_err(|e| format!("湲곗〈 怨듯넻肄붾뱶 ?곗씠??珥덇린???ㅽ뙣: {e}"))?;

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
            .map_err(|e| format!("洹몃９肄붾뱶 ?낅젰 ?ㅽ뙣(group_id={}): {e}", group.id))?;
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
                    "?곸꽭肄붾뱶 ?낅젰 ?ㅽ뙣(group_id={}, code={}): {e}",
                    detail.group_id, detail.code
                )
            })?;
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("?몃옖??뀡 而ㅻ컠 ?ㅽ뙣: {e}"))?;

    Ok(CommonCodeSyncResult {
        success: true,
        message: "common_code_group/common_code_detail ?뚯씠釉??앹꽦 諛??곗씠??諛섏쁺 ?꾨즺".to_string(),
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
        .map_err(|e| format!("洹몃９肄붾뱶 議고쉶 ?ㅽ뙣: {e}"))?;

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
        .map_err(|e| format!("?곸꽭肄붾뱶 議고쉶 ?ㅽ뙣: {e}"))?;

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
        message: "怨듯넻肄붾뱶 議고쉶 ?꾨즺".to_string(),
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
        return Err("洹몃９ ID? 洹몃９紐낆? ?꾩닔?낅땲??".to_string());
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
        .map_err(|e| format!("洹몃９肄붾뱶 ????ㅽ뙣: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "洹몃９肄붾뱶 ????꾨즺".to_string(),
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
        return Err("??젣??洹몃９ ID媛 鍮꾩뼱 ?덉뒿?덈떎.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM common_code_group WHERE group_code_id = $1",
            &[&group_id],
        )
        .await
        .map_err(|e| format!("洹몃９肄붾뱶 ??젣 ?ㅽ뙣: {e}"))?;

    if affected == 0 {
        return Err("??젣 ???洹몃９肄붾뱶媛 ?놁뒿?덈떎.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "洹몃９肄붾뱶 ??젣 ?꾨즺".to_string(),
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
        return Err("洹몃９ID, ?곸꽭肄붾뱶, ?곸꽭肄붾뱶紐낆? ?꾩닔?낅땲??".to_string());
    }
    if use_yn != "Y" && use_yn != "N" {
        return Err("?ъ슜?щ?(use_yn)??Y ?먮뒗 N留?媛?ν빀?덈떎.".to_string());
    }

    let exists = client
        .query_opt(
            "SELECT 1 FROM common_code_group WHERE group_code_id = $1",
            &[&group_id],
        )
        .await
        .map_err(|e| format!("洹몃９肄붾뱶 ?뺤씤 ?ㅽ뙣: {e}"))?;
    if exists.is_none() {
        return Err("?곸꽭肄붾뱶瑜???ν븷 洹몃９肄붾뱶媛 議댁옱?섏? ?딆뒿?덈떎.".to_string());
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
        .map_err(|e| format!("?곸꽭肄붾뱶 ????ㅽ뙣: {e}"))?;

    refresh_group_detail_count(&client, &group_id).await?;

    Ok(MutationResult {
        success: true,
        message: "?곸꽭肄붾뱶 ????꾨즺".to_string(),
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
        return Err("??젣??洹몃９ID/?곸꽭肄붾뱶 媛믪씠 鍮꾩뼱 ?덉뒿?덈떎.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM common_code_detail WHERE group_code_id = $1 AND detail_code = $2",
            &[&group_id, &detail_code],
        )
        .await
        .map_err(|e| format!("?곸꽭肄붾뱶 ??젣 ?ㅽ뙣: {e}"))?;

    if affected == 0 {
        return Err("??젣 ????곸꽭肄붾뱶媛 ?놁뒿?덈떎.".to_string());
    }

    refresh_group_detail_count(&client, &group_id).await?;

    Ok(MutationResult {
        success: true,
        message: "?곸꽭肄붾뱶 ??젣 ?꾨즺".to_string(),
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
            delete_common_code_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
