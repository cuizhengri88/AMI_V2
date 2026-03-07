// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tokio_postgres::{Client, NoTls};

const DEFAULT_SYSTEM_TYPE_CODE: &str = "ALL";
const SYSTEM_TYPE_GROUP_ID: &str = "SYSTEM_TYPE";
const DEFAULT_STORE_CODE: &str = "HAIR_001";
const STORE_CODE_GROUP_ID: &str = "STR_CD";
const LOCAL_MIGRATION_CACHE_DIR: &str = "GovDataManagement";
const RESERVATION_STORE_CODE_MIGRATION_ID: &str = "reservation_store_code_migration_v1";
const FULL_DB_INTEGRITY_CHECK_ID: &str = "full_db_integrity_check_v1";
const SALES_COUPON_USAGE_MEMO_PREFIX: &str = "__SETTLEMENT_COUPON_USAGE__";

#[derive(Debug, Serialize, Deserialize, Default)]
struct LocalMigrationCache {
    checked_keys: HashSet<String>,
}

static LOCAL_MIGRATION_CACHE: OnceLock<Mutex<LocalMigrationCache>> = OnceLock::new();
static DB_INTEGRITY_CHECK_MODE: AtomicBool = AtomicBool::new(false);

fn migration_cache_file_path() -> PathBuf {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local_app_data)
            .join(LOCAL_MIGRATION_CACHE_DIR)
            .join("migration_cache.json");
    }

    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join(".gov_data_management")
            .join("migration_cache.json");
    }

    PathBuf::from("migration_cache.json")
}

fn load_local_migration_cache() -> LocalMigrationCache {
    let cache_path = migration_cache_file_path();
    let Ok(raw_json) = fs::read_to_string(cache_path) else {
        return LocalMigrationCache::default();
    };

    serde_json::from_str::<LocalMigrationCache>(&raw_json).unwrap_or_default()
}

fn local_migration_cache() -> &'static Mutex<LocalMigrationCache> {
    LOCAL_MIGRATION_CACHE.get_or_init(|| Mutex::new(load_local_migration_cache()))
}

fn persist_local_migration_cache(cache: &LocalMigrationCache) -> Result<(), String> {
    let cache_path = migration_cache_file_path();

    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("로컬 마이그레이션 캐시 폴더 생성 실패: {e}"))?;
    }

    let serialized = serde_json::to_string_pretty(cache)
        .map_err(|e| format!("로컬 마이그레이션 캐시 직렬화 실패: {e}"))?;

    fs::write(&cache_path, serialized)
        .map_err(|e| format!("로컬 마이그레이션 캐시 저장 실패: {e}"))?;

    Ok(())
}

fn build_reservation_store_code_migration_key(connection: &DbConnectionPayload) -> String {
    format!(
        "{}::{}::{}::{}::{}",
        RESERVATION_STORE_CODE_MIGRATION_ID,
        connection.host.trim().to_lowercase(),
        connection.port,
        connection.database.trim().to_lowercase(),
        connection.schema.trim().to_lowercase(),
    )
}

fn is_local_migration_checked(key: &str) -> bool {
    match local_migration_cache().lock() {
        Ok(cache) => cache.checked_keys.contains(key),
        Err(poisoned) => {
            let cache = poisoned.into_inner();
            cache.checked_keys.contains(key)
        }
    }
}

fn mark_local_migration_checked(key: &str) {
    let mut cache = match local_migration_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if !cache.checked_keys.insert(key.to_string()) {
        return;
    }

    if let Err(error) = persist_local_migration_cache(&cache) {
        eprintln!("{error}");
    }
}

fn build_full_db_integrity_check_key(connection: &DbConnectionPayload) -> String {
    format!(
        "{}::{}::{}::{}::{}",
        FULL_DB_INTEGRITY_CHECK_ID,
        connection.host.trim().to_lowercase(),
        connection.port,
        connection.database.trim().to_lowercase(),
        connection.schema.trim().to_lowercase(),
    )
}

fn is_db_integrity_check_mode() -> bool {
    DB_INTEGRITY_CHECK_MODE.load(Ordering::SeqCst)
}

struct DbIntegrityCheckGuard;

impl Drop for DbIntegrityCheckGuard {
    fn drop(&mut self) {
        DB_INTEGRITY_CHECK_MODE.store(false, Ordering::SeqCst);
    }
}

fn enter_db_integrity_check_mode() -> DbIntegrityCheckGuard {
    DB_INTEGRITY_CHECK_MODE.store(true, Ordering::SeqCst);
    DbIntegrityCheckGuard
}

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

#[derive(Debug, Deserialize)]
struct DbIntegrityCheckPayload {
    connection: DbConnectionPayload,
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
    system_type_code: Option<String>,
    order: i32,
    status: String,
    names: MenuNamesPayload,
}

#[derive(Debug, Deserialize)]
struct SyncMenuPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
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
    store_code: Option<String>,
    system_type_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertMenuPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    menu: MenuRowPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteMenuPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    menu_id: i64,
}

#[derive(Debug, Serialize)]
struct MenuDto {
    id: i64,
    parent_id: Option<i64>,
    menu_type: String,
    path: String,
    system_type_code: String,
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
    store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RoleMenuPermissionQueryPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
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
    store_code: Option<String>,
    role: RolePayload,
}

#[derive(Debug, Deserialize)]
struct DeleteRolePayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
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
    store_code: Option<String>,
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
    store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertEmployeePayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    employee: EmployeePayload,
}

#[derive(Debug, Deserialize)]
struct DeleteEmployeePayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
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
    store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertUserPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    user: UserPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteUserPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
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

#[derive(Debug, Deserialize)]
struct ServiceCatalogItemPayload {
    service_id: Option<i64>,
    category_code: String,
    service_name: String,
    unit_price: i64,
    duration_minutes: i32,
    use_yn: String,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServiceCatalogQueryPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertServiceCatalogPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    item: ServiceCatalogItemPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteServiceCatalogPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    service_id: i64,
}

#[derive(Debug, Serialize)]
struct ServiceCatalogItemDto {
    service_id: i64,
    category_code: String,
    category_name: String,
    service_name: String,
    unit_price: i64,
    duration_minutes: i32,
    use_yn: String,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
struct ServiceCatalogDataResult {
    success: bool,
    message: String,
    items: Vec<ServiceCatalogItemDto>,
}

#[derive(Debug, Deserialize)]
struct ReservationCalendarItemPayload {
    reservation_id: Option<i64>,
    reservation_date: String,
    start_time: String,
    customer_name: String,
    designer_name: String,
    status: String,
    note: Option<String>,
    service_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
struct ReservationCalendarQueryPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertReservationCalendarPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    item: ReservationCalendarItemPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteReservationCalendarPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    reservation_id: i64,
}

#[derive(Debug, Serialize)]
struct ReservationCalendarServiceDto {
    line_id: i64,
    service_id: i64,
    category_code: String,
    category_name: String,
    service_name: String,
    unit_price: i64,
    duration_minutes: i32,
}

#[derive(Debug, Serialize)]
struct ReservationCalendarDto {
    reservation_id: i64,
    reservation_date: String,
    start_time: String,
    customer_name: String,
    designer_name: String,
    status: String,
    note: Option<String>,
    services: Vec<ReservationCalendarServiceDto>,
}

#[derive(Debug, Serialize)]
struct ReservationCalendarDataResult {
    success: bool,
    message: String,
    reservations: Vec<ReservationCalendarDto>,
}

#[derive(Debug, Deserialize)]
struct MemberPointQueryPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MemberPointRechargePayload {
    user_id: i64,
    recharge_type: String,
    amount: Option<i64>,
    service_id: Option<i64>,
    coupon_count: Option<i32>,
    payment_method_code: String,
    memo: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RechargeMemberPointPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    recharge: MemberPointRechargePayload,
}

#[derive(Debug, Deserialize)]
struct MemberPointUsePayload {
    user_id: i64,
    use_type: String,
    amount: Option<i64>,
    service_id: Option<i64>,
    coupon_count: Option<i32>,
    memo: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UseMemberPointPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    usage: MemberPointUsePayload,
}

#[derive(Debug, Deserialize)]
struct CancelMemberPointRechargePayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    history_id: i64,
    cancel_reason: String,
}

#[derive(Debug, Serialize)]
struct MemberPointCouponDto {
    service_id: i64,
    service_name: String,
    count: i32,
}

#[derive(Debug, Serialize)]
struct MemberPointMemberDto {
    user_id: i64,
    user_name: String,
    phone: Option<String>,
    point_balance: i64,
    coupons: Vec<MemberPointCouponDto>,
}

#[derive(Debug, Serialize)]
struct MemberPointHistoryDto {
    id: i64,
    action_type: String,
    user_id: i64,
    user_name: String,
    user_phone: Option<String>,
    recharge_type: String,
    amount: Option<i64>,
    service_id: Option<i64>,
    service_name: Option<String>,
    coupon_count: Option<i32>,
    payment_method_code: String,
    payment_method_name: String,
    memo: String,
    created_at: String,
    is_cancelled: bool,
    cancel_reason: Option<String>,
    cancelled_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct MemberPointDataResult {
    success: bool,
    message: String,
    members: Vec<MemberPointMemberDto>,
    histories: Vec<MemberPointHistoryDto>,
}

#[derive(Debug, Deserialize)]
struct SalesSettlementQueryPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SalesSettlementPaymentPayload {
    payment_method_code: String,
    amount: i64,
    coupon_service_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct SalesSettlementPayload {
    settlement_id: Option<i64>,
    member_user_id: Option<i64>,
    manager_employee_id: i64,
    service_ids: Vec<i64>,
    payments: Vec<SalesSettlementPaymentPayload>,
    status: String,
    reservation_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertSalesSettlementPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    settlement: SalesSettlementPayload,
}

#[derive(Debug, Deserialize)]
struct DeleteSalesSettlementPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    settlement_id: i64,
}

#[derive(Debug, Deserialize)]
struct CancelSalesSettlementPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    settlement_id: i64,
    cancel_type: String,
    cancel_reason: String,
}

#[derive(Debug, Serialize, Clone)]
struct SalesSettlementPaymentDto {
    payment_method_code: String,
    amount: i64,
    coupon_service_id: Option<i64>,
}

#[derive(Debug, Serialize)]
struct SalesSettlementDto {
    settlement_id: i64,
    settlement_datetime: String,
    member_user_id: Option<i64>,
    manager_employee_id: i64,
    service_ids: Vec<i64>,
    total_amount: i64,
    total_time_minutes: i32,
    payments: Vec<SalesSettlementPaymentDto>,
    status: String,
    reservation_ref: Option<String>,
    cancel_type: Option<String>,
    cancel_reason: Option<String>,
    cancelled_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct SalesSettlementDataResult {
    success: bool,
    message: String,
    settlements: Vec<SalesSettlementDto>,
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

fn normalize_system_type_code(value: Option<&str>) -> String {
    let normalized = value.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        DEFAULT_SYSTEM_TYPE_CODE.to_string()
    } else {
        normalized
    }
}

fn normalize_optional_system_type_code(value: Option<&str>) -> Option<String> {
    let normalized = value.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_store_code(value: Option<&str>) -> String {
    let normalized = value.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        DEFAULT_STORE_CODE.to_string()
    } else {
        normalized
    }
}

async fn validate_store_code(client: &Client, code: &str) -> Result<(), String> {
    if code == DEFAULT_STORE_CODE {
        return Ok(());
    }

    ensure_common_code_tables(client).await?;

    let exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM common_code_detail
             WHERE group_code_id = $1
               AND detail_code = $2
               AND use_yn = 'Y'
            "#,
            &[&STORE_CODE_GROUP_ID, &code],
        )
        .await
        .map_err(|e| format!("STR_CD 코드 검증 실패: {e}"))?
        .is_some();

    if !exists {
        return Err(format!(
            "STR_CD 그룹에 사용 가능한 점포코드가 없습니다: {code}"
        ));
    }

    Ok(())
}

async fn resolve_store_code(client: &Client, value: Option<&str>) -> Result<String, String> {
    let store_code = normalize_store_code(value);
    validate_store_code(client, &store_code).await?;
    Ok(store_code)
}

async fn validate_system_type_code(client: &Client, code: &str) -> Result<(), String> {
    if code == DEFAULT_SYSTEM_TYPE_CODE {
        return Ok(());
    }

    ensure_common_code_tables(client).await?;

    let exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM common_code_detail
             WHERE group_code_id = $1
               AND detail_code = $2
               AND use_yn = 'Y'
            "#,
            &[&SYSTEM_TYPE_GROUP_ID, &code],
        )
        .await
        .map_err(|e| format!("SYSTEM_TYPE 코드 검증 실패: {e}"))?
        .is_some();

    if !exists {
        return Err(format!(
            "SYSTEM_TYPE 그룹에 사용 가능한 코드가 없습니다: {code}"
        ));
    }

    Ok(())
}

async fn ensure_menu_table(client: &Client) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

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
                system_type_code VARCHAR(100) NOT NULL DEFAULT 'ALL',
                store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
                menu_order INTEGER NOT NULL DEFAULT 1,
                menu_status VARCHAR(20) NOT NULL DEFAULT '사용중',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            ALTER TABLE menu_management
            ADD COLUMN IF NOT EXISTS system_type_code VARCHAR(100);

            UPDATE menu_management
               SET system_type_code = 'ALL'
             WHERE system_type_code IS NULL
                OR BTRIM(system_type_code) = '';

            ALTER TABLE menu_management
            ALTER COLUMN system_type_code SET DEFAULT 'ALL';

            ALTER TABLE menu_management
            ALTER COLUMN system_type_code SET NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_menu_management_system_type
            ON menu_management (system_type_code);

            ALTER TABLE menu_management
            ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

            UPDATE menu_management
               SET store_code = 'HAIR_001'
             WHERE store_code IS NULL
                OR BTRIM(store_code) = '';

            ALTER TABLE menu_management
            ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

            ALTER TABLE menu_management
            ALTER COLUMN store_code SET NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_menu_management_store
            ON menu_management (store_code);

            ALTER TABLE menu_management
            DROP CONSTRAINT IF EXISTS menu_management_menu_path_key;

            CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_management_store_path
            ON menu_management (store_code, menu_path);
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
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

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
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    ensure_menu_table(client).await?;
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS role_management (
                role_id VARCHAR(50) PRIMARY KEY,
                store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
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
                store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
                can_read BOOLEAN NOT NULL DEFAULT FALSE,
                can_write BOOLEAN NOT NULL DEFAULT FALSE,
                can_delete BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_role_menu_permission_role
            ON role_menu_permission (role_id);

            ALTER TABLE role_management
            ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

            UPDATE role_management
               SET store_code = 'HAIR_001'
             WHERE store_code IS NULL
                OR BTRIM(store_code) = '';

            ALTER TABLE role_management
            ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

            ALTER TABLE role_management
            ALTER COLUMN store_code SET NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_role_management_store
            ON role_management (store_code);

            ALTER TABLE role_menu_permission
            ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

            UPDATE role_menu_permission
               SET store_code = 'HAIR_001'
             WHERE store_code IS NULL
                OR BTRIM(store_code) = '';

            ALTER TABLE role_menu_permission
            ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

            ALTER TABLE role_menu_permission
            ALTER COLUMN store_code SET NOT NULL;

            ALTER TABLE role_menu_permission
            DROP CONSTRAINT IF EXISTS role_menu_permission_role_id_menu_id_key;

            CREATE UNIQUE INDEX IF NOT EXISTS uq_role_menu_permission_store_role_menu
            ON role_menu_permission (store_code, role_id, menu_id);

            CREATE INDEX IF NOT EXISTS idx_role_menu_permission_store
            ON role_menu_permission (store_code);
            "#,
        )
        .await
        .map_err(|e| format!("권한 테이블 생성 실패: {e}"))
}

async fn ensure_employee_management_table(client: &Client) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    ensure_role_management_tables(client).await?;
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS employee_management (
                employee_id BIGSERIAL PRIMARY KEY,
                store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
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

            ALTER TABLE employee_management
            ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

            UPDATE employee_management
               SET store_code = 'HAIR_001'
             WHERE store_code IS NULL
                OR BTRIM(store_code) = '';

            ALTER TABLE employee_management
            ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

            ALTER TABLE employee_management
            ALTER COLUMN store_code SET NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_employee_management_store
            ON employee_management (store_code);
            "#,
        )
        .await
        .map_err(|e| format!("직원 테이블 생성 실패: {e}"))
}

async fn ensure_user_management_table(client: &Client) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    let sql = r#"
        CREATE TABLE IF NOT EXISTS user_management (
            user_id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            name VARCHAR(100) NOT NULL,
            email VARCHAR(100) NOT NULL UNIQUE,
            phone VARCHAR(20),
            address VARCHAR(255),
            remarks TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE user_management
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE user_management
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE user_management
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE user_management
        ALTER COLUMN store_code SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_user_management_store
        ON user_management (store_code)
    "#;
    log_sql!(sql);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("회원 테이블 생성 실패: {e}"))
}

async fn ensure_service_catalog_management_table(client: &Client) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    ensure_common_code_tables(client).await?;
    let sql = r#"
        CREATE TABLE IF NOT EXISTS service_catalog_management (
            service_id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            category_code VARCHAR(100) NOT NULL,
            service_name VARCHAR(200) NOT NULL,
            unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
            duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
            use_yn CHAR(1) NOT NULL DEFAULT 'Y' CHECK (use_yn IN ('Y', 'N')),
            note TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_service_catalog_management_category
        ON service_catalog_management (category_code);

        CREATE INDEX IF NOT EXISTS idx_service_catalog_management_use_yn
        ON service_catalog_management (use_yn);

        ALTER TABLE service_catalog_management
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE service_catalog_management
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE service_catalog_management
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE service_catalog_management
        ALTER COLUMN store_code SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_service_catalog_management_store
        ON service_catalog_management (store_code);
    "#;
    log_sql!(sql);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("시술 항목 테이블 생성 실패: {e}"))
}

async fn ensure_reservation_calendar_management_tables(
    client: &Client,
    connection: &DbConnectionPayload,
) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    let migration_key = build_reservation_store_code_migration_key(connection);
    if is_local_migration_checked(&migration_key) {
        return Ok(());
    }

    ensure_service_catalog_management_table(client).await?;
    ensure_common_code_tables(client).await?;

    // 예약 헤더 + 예약 시술 라인을 분리해서 저장한다.
    // 헤더 삭제 시 라인은 CASCADE로 함께 삭제되도록 FK를 설정한다.
    let create_sql = r#"
        CREATE TABLE IF NOT EXISTS reservation_calendar_management (
            reservation_id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            reservation_date DATE NOT NULL,
            start_time TIME NOT NULL,
            customer_name VARCHAR(100) NOT NULL,
            designer_name VARCHAR(100) NOT NULL,
            status_code VARCHAR(100) NOT NULL,
            note TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_reservation_calendar_management_schedule
        ON reservation_calendar_management (store_code, reservation_date, start_time);

        CREATE INDEX IF NOT EXISTS idx_reservation_calendar_management_status
        ON reservation_calendar_management (status_code);

        CREATE TABLE IF NOT EXISTS reservation_calendar_service_line (
            line_id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            reservation_id BIGINT NOT NULL REFERENCES reservation_calendar_management(reservation_id) ON DELETE CASCADE,
            line_no INTEGER NOT NULL CHECK (line_no > 0),
            service_id BIGINT NOT NULL REFERENCES service_catalog_management(service_id) ON DELETE RESTRICT,
            category_code VARCHAR(100) NOT NULL,
            category_name VARCHAR(100) NOT NULL,
            service_name VARCHAR(200) NOT NULL,
            unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
            duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (store_code, reservation_id, line_no)
        );

        CREATE INDEX IF NOT EXISTS idx_reservation_calendar_service_line_store_reservation
        ON reservation_calendar_service_line (store_code, reservation_id);

        CREATE INDEX IF NOT EXISTS idx_reservation_calendar_service_line_service
        ON reservation_calendar_service_line (service_id);
    "#;
    log_sql!(create_sql);
    client
        .batch_execute(create_sql)
        .await
        .map_err(|e| format!("예약 캘린더 테이블 생성 실패: {e}"))?;

    let patch_sql = r#"
        ALTER TABLE reservation_calendar_management
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE reservation_calendar_management
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE reservation_calendar_management
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE reservation_calendar_management
        ALTER COLUMN store_code SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_reservation_calendar_management_store
        ON reservation_calendar_management (store_code);

        ALTER TABLE reservation_calendar_service_line
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE reservation_calendar_service_line
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE reservation_calendar_service_line
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE reservation_calendar_service_line
        ALTER COLUMN store_code SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_reservation_calendar_service_line_store
        ON reservation_calendar_service_line (store_code);
    "#;
    log_sql!(patch_sql);
    client
        .batch_execute(patch_sql)
        .await
        .map_err(|e| format!("예약 캘린더 store_code 마이그레이션 실패: {e}"))?;

    mark_local_migration_checked(&migration_key);
    Ok(())
}

async fn ensure_member_point_management_tables(client: &Client) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    ensure_user_management_table(client).await?;
    ensure_service_catalog_management_table(client).await?;
    ensure_common_code_tables(client).await?;

    let sql = r#"
        CREATE TABLE IF NOT EXISTS member_point_balance (
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            user_id BIGINT NOT NULL REFERENCES user_management(user_id) ON DELETE CASCADE,
            point_balance BIGINT NOT NULL DEFAULT 0 CHECK (point_balance >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (store_code, user_id)
        );

        CREATE TABLE IF NOT EXISTS member_coupon_balance (
            id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            user_id BIGINT NOT NULL REFERENCES user_management(user_id) ON DELETE CASCADE,
            service_id BIGINT NOT NULL REFERENCES service_catalog_management(service_id) ON DELETE CASCADE,
            coupon_count INTEGER NOT NULL DEFAULT 0 CHECK (coupon_count >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (store_code, user_id, service_id)
        );

        CREATE TABLE IF NOT EXISTS member_point_history (
            id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            user_id BIGINT NOT NULL REFERENCES user_management(user_id) ON DELETE CASCADE,
            recharge_type VARCHAR(20) NOT NULL CHECK (recharge_type IN ('BALANCE', 'COUPON')),
            amount BIGINT NULL CHECK (amount IS NULL OR amount >= 0),
            service_id BIGINT NULL REFERENCES service_catalog_management(service_id) ON DELETE SET NULL,
            coupon_count INTEGER NULL CHECK (coupon_count IS NULL OR coupon_count >= 0),
            payment_method_code VARCHAR(100) NOT NULL,
            memo TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS member_point_usage_history (
            id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            user_id BIGINT NOT NULL REFERENCES user_management(user_id) ON DELETE CASCADE,
            use_type VARCHAR(20) NOT NULL CHECK (use_type IN ('BALANCE', 'COUPON')),
            amount BIGINT NULL CHECK (amount IS NULL OR amount >= 0),
            service_id BIGINT NULL REFERENCES service_catalog_management(service_id) ON DELETE SET NULL,
            coupon_count INTEGER NULL CHECK (coupon_count IS NULL OR coupon_count >= 0),
            memo TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE member_point_balance
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE member_point_balance
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE member_point_balance
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE member_point_balance
        ALTER COLUMN store_code SET NOT NULL;

        ALTER TABLE member_coupon_balance
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE member_coupon_balance
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE member_coupon_balance
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE member_coupon_balance
        ALTER COLUMN store_code SET NOT NULL;

        ALTER TABLE member_point_history
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE member_point_history
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE member_point_history
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE member_point_history
        ALTER COLUMN store_code SET NOT NULL;

        ALTER TABLE member_point_usage_history
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE member_point_usage_history
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE member_point_usage_history
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE member_point_usage_history
        ALTER COLUMN store_code SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_member_point_balance_store
        ON member_point_balance (store_code, user_id);

        CREATE INDEX IF NOT EXISTS idx_member_coupon_balance_store
        ON member_coupon_balance (store_code, user_id);

        CREATE INDEX IF NOT EXISTS idx_member_point_history_store
        ON member_point_history (store_code, user_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_member_point_usage_history_store
        ON member_point_usage_history (store_code, user_id, created_at DESC);
    "#;
    log_sql!(sql);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("회원 포인트 테이블 생성 실패: {e}"))
}

async fn ensure_member_point_recharge_cancel_log_table(client: &Client) -> Result<(), String> {
    let sql = r#"
        ALTER TABLE member_point_history
        ADD COLUMN IF NOT EXISTS status_code VARCHAR(20);

        UPDATE member_point_history
           SET status_code = 'ACTIVE'
         WHERE status_code IS NULL
            OR BTRIM(status_code) = '';

        ALTER TABLE member_point_history
        ALTER COLUMN status_code SET DEFAULT 'ACTIVE';

        ALTER TABLE member_point_history
        ALTER COLUMN status_code SET NOT NULL;

        ALTER TABLE member_point_history
        ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

        ALTER TABLE member_point_history
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

        CREATE INDEX IF NOT EXISTS idx_member_point_history_status_store
        ON member_point_history (store_code, status_code, created_at DESC);
    "#;

    log_sql!(sql);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("회원 포인트 충전 취소 상태 컬럼 준비 실패: {e}"))
}

async fn ensure_sales_settlement_management_tables(client: &Client) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    ensure_member_point_management_tables(client).await?;
    ensure_employee_management_table(client).await?;
    ensure_common_code_tables(client).await?;

    let sql = r#"
        CREATE TABLE IF NOT EXISTS sales_settlement_management (
            settlement_id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            member_user_id BIGINT NULL REFERENCES user_management(user_id) ON DELETE SET NULL,
            manager_employee_id BIGINT NOT NULL REFERENCES employee_management(employee_id) ON DELETE RESTRICT,
            total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
            total_time_minutes INTEGER NOT NULL CHECK (total_time_minutes >= 0),
            status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'CANCELLED')),
            reservation_ref VARCHAR(100) NULL,
            cancel_type VARCHAR(20) NULL CHECK (cancel_type IS NULL OR cancel_type IN ('PAYMENT', 'PROCEDURE')),
            cancel_reason TEXT NULL,
            cancelled_at TIMESTAMPTZ NULL,
            settlement_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sales_settlement_service_line (
            line_id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            settlement_id BIGINT NOT NULL REFERENCES sales_settlement_management(settlement_id) ON DELETE CASCADE,
            line_no INTEGER NOT NULL CHECK (line_no > 0),
            service_id BIGINT NOT NULL REFERENCES service_catalog_management(service_id) ON DELETE RESTRICT,
            service_name VARCHAR(200) NOT NULL,
            category_code VARCHAR(100) NOT NULL,
            category_name VARCHAR(100) NOT NULL,
            unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
            duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sales_settlement_payment_line (
            payment_id BIGSERIAL PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            settlement_id BIGINT NOT NULL REFERENCES sales_settlement_management(settlement_id) ON DELETE CASCADE,
            line_no INTEGER NOT NULL CHECK (line_no > 0),
            payment_method_code VARCHAR(100) NOT NULL,
            payment_method_name VARCHAR(100) NOT NULL,
            amount BIGINT NOT NULL CHECK (amount >= 0),
            coupon_service_id BIGINT NULL REFERENCES service_catalog_management(service_id) ON DELETE SET NULL,
            coupon_service_name VARCHAR(200) NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE sales_settlement_management
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE sales_settlement_management
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE sales_settlement_management
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE sales_settlement_management
        ALTER COLUMN store_code SET NOT NULL;

        ALTER TABLE sales_settlement_management
        ADD COLUMN IF NOT EXISTS cancel_type VARCHAR(20);

        ALTER TABLE sales_settlement_management
        ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

        ALTER TABLE sales_settlement_management
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

        ALTER TABLE sales_settlement_management
        DROP CONSTRAINT IF EXISTS sales_settlement_management_status_check;

        ALTER TABLE sales_settlement_management
        ADD CONSTRAINT sales_settlement_management_status_check
        CHECK (status IN ('PROCESSING', 'COMPLETED', 'CANCELLED'));

        ALTER TABLE sales_settlement_management
        DROP CONSTRAINT IF EXISTS sales_settlement_management_cancel_type_check;

        ALTER TABLE sales_settlement_management
        ADD CONSTRAINT sales_settlement_management_cancel_type_check
        CHECK (cancel_type IS NULL OR cancel_type IN ('PAYMENT', 'PROCEDURE'));

        ALTER TABLE sales_settlement_service_line
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE sales_settlement_service_line
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE sales_settlement_service_line
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE sales_settlement_service_line
        ALTER COLUMN store_code SET NOT NULL;

        ALTER TABLE sales_settlement_payment_line
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        UPDATE sales_settlement_payment_line
           SET store_code = 'HAIR_001'
         WHERE store_code IS NULL
            OR BTRIM(store_code) = '';

        ALTER TABLE sales_settlement_payment_line
        ALTER COLUMN store_code SET DEFAULT 'HAIR_001';

        ALTER TABLE sales_settlement_payment_line
        ALTER COLUMN store_code SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_sales_settlement_store_datetime
        ON sales_settlement_management (store_code, settlement_datetime DESC, settlement_id DESC);

        CREATE INDEX IF NOT EXISTS idx_sales_settlement_store_member
        ON sales_settlement_management (store_code, member_user_id);

        CREATE INDEX IF NOT EXISTS idx_sales_settlement_store_manager
        ON sales_settlement_management (store_code, manager_employee_id);

        CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_settlement_service_line_store_settlement_line
        ON sales_settlement_service_line (store_code, settlement_id, line_no);

        CREATE INDEX IF NOT EXISTS idx_sales_settlement_service_line_store_settlement
        ON sales_settlement_service_line (store_code, settlement_id);

        CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_settlement_payment_line_store_settlement_line
        ON sales_settlement_payment_line (store_code, settlement_id, line_no);

        CREATE INDEX IF NOT EXISTS idx_sales_settlement_payment_line_store_settlement
        ON sales_settlement_payment_line (store_code, settlement_id);
    "#;
    log_sql!(sql);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("시술 정산 테이블 생성 실패: {e}"))
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
async fn run_db_integrity_check(payload: DbIntegrityCheckPayload) -> Result<MutationResult, String> {
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

#[tauri::command]
async fn sync_menu_management_to_db(payload: SyncMenuPayload) -> Result<MenuSyncResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_menu_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("트랜잭션 시작 실패: {e}"))?;

    transaction
        .execute("DELETE FROM menu_management WHERE store_code = $1", &[&store_code])
        .await
        .map_err(|e| format!("기존 메뉴 데이터 초기화 실패: {e}"))?;

    let mut menus = payload.menus;
    menus.sort_by_key(|m| m.parent_id.is_some());

    for menu in &menus {
        let system_type_code = normalize_system_type_code(menu.system_type_code.as_deref());
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
                    menu_order,
                    menu_status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let selected_system_type = normalize_optional_system_type_code(payload.system_type_code.as_deref());
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
            order: row.get::<_, i32>(8),
            status: row.get::<_, String>(9),
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
                menu_order,
                menu_status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

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
                    employee_id, store_code, employee_name, employee_code, role_id, email, phone, hire_date, status, remarks
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (employee_id)
                DO UPDATE SET
                    store_code = EXCLUDED.store_code,
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
                    &store_code,
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
                    store_code, employee_name, employee_code, role_id, email, phone, hire_date, status, remarks
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                "#,
                &[
                    &store_code,
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
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.employee_id <= 0 {
        return Err("삭제할 employee_id가 올바르지 않습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM employee_management WHERE employee_id = $1 AND store_code = $2",
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

#[tauri::command]
async fn get_service_catalog_data(
    payload: ServiceCatalogQueryPayload,
) -> Result<ServiceCatalogDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let sql = r#"
        SELECT
            s.service_id::BIGINT,
            s.category_code,
            COALESCE(c.detail_name, s.category_code) AS category_name,
            s.service_name,
            s.unit_price::BIGINT,
            s.duration_minutes,
            s.use_yn,
            s.note
          FROM service_catalog_management s
     LEFT JOIN common_code_detail c
            ON c.group_code_id = 'T_CATEGORY'
           AND c.detail_code = s.category_code
         WHERE s.store_code = $1
         ORDER BY s.service_id DESC
    "#;
    log_sql!(sql);
    let rows = client
        .query(sql, &[&store_code])
        .await
        .map_err(|e| format!("시술 항목 조회 실패: {e}"))?;

    let items = rows
        .into_iter()
        .map(|row| ServiceCatalogItemDto {
            service_id: row.get::<_, i64>(0),
            category_code: row.get::<_, String>(1),
            category_name: row.get::<_, String>(2),
            service_name: row.get::<_, String>(3),
            unit_price: row.get::<_, i64>(4),
            duration_minutes: row.get::<_, i32>(5),
            use_yn: row.get::<_, String>(6),
            note: row.get::<_, Option<String>>(7),
        })
        .collect::<Vec<_>>();

    Ok(ServiceCatalogDataResult {
        success: true,
        message: "시술 항목 조회 완료".to_string(),
        items,
    })
}

#[tauri::command]
async fn upsert_service_catalog_item(
    payload: UpsertServiceCatalogPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let item = payload.item;
    let category_code = item.category_code.trim().to_uppercase();
    let service_name = item.service_name.trim().to_string();
    let unit_price = item.unit_price;
    let duration_minutes = item.duration_minutes;
    let use_yn = item.use_yn.trim().to_uppercase();
    let note = item
        .note
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if category_code.is_empty() || service_name.is_empty() {
        return Err("카테고리와 시술명은 필수입니다.".to_string());
    }
    if unit_price <= 0 {
        return Err("단가는 0보다 커야 합니다.".to_string());
    }
    if duration_minutes <= 0 {
        return Err("소요시간은 0보다 커야 합니다.".to_string());
    }
    if use_yn != "Y" && use_yn != "N" {
        return Err("사용여부(use_yn)는 Y 또는 N만 가능합니다.".to_string());
    }

    let category_exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM common_code_detail
             WHERE group_code_id = 'T_CATEGORY'
               AND detail_code = $1
               AND use_yn = 'Y'
            "#,
            &[&category_code],
        )
        .await
        .map_err(|e| format!("카테고리 코드 확인 실패: {e}"))?;

    if category_exists.is_none() {
        return Err("T_CATEGORY 공통코드에 존재하는 사용중 카테고리만 선택할 수 있습니다.".to_string());
    }

    if let Some(service_id) = item.service_id {
        if service_id <= 0 {
            return Err("service_id는 1 이상이어야 합니다.".to_string());
        }

        let sql = r#"
            INSERT INTO service_catalog_management (
                service_id,
                store_code,
                category_code,
                service_name,
                unit_price,
                duration_minutes,
                use_yn,
                note
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (service_id)
            DO UPDATE SET
                store_code = EXCLUDED.store_code,
                category_code = EXCLUDED.category_code,
                service_name = EXCLUDED.service_name,
                unit_price = EXCLUDED.unit_price,
                duration_minutes = EXCLUDED.duration_minutes,
                use_yn = EXCLUDED.use_yn,
                note = EXCLUDED.note,
                updated_at = NOW()
        "#;
        log_sql!(
            sql,
            service_id,
            &store_code,
            &category_code,
            &service_name,
            unit_price,
            duration_minutes,
            &use_yn,
            &note
        );
        client
            .execute(
                sql,
                &[
                    &service_id,
                    &store_code,
                    &category_code,
                    &service_name,
                    &unit_price,
                    &duration_minutes,
                    &use_yn,
                    &note,
                ],
            )
            .await
            .map_err(|e| format!("시술 항목 저장 실패: {e}"))?;
    } else {
        let sql = r#"
            INSERT INTO service_catalog_management (
                store_code,
                category_code,
                service_name,
                unit_price,
                duration_minutes,
                use_yn,
                note
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#;
        log_sql!(
            sql,
            &store_code,
            &category_code,
            &service_name,
            unit_price,
            duration_minutes,
            &use_yn,
            &note
        );
        client
            .execute(
                sql,
                &[
                    &store_code,
                    &category_code,
                    &service_name,
                    &unit_price,
                    &duration_minutes,
                    &use_yn,
                    &note,
                ],
            )
            .await
            .map_err(|e| format!("시술 항목 등록 실패: {e}"))?;
    }

    Ok(MutationResult {
        success: true,
        message: "시술 항목 저장 완료".to_string(),
    })
}

#[tauri::command]
async fn delete_service_catalog_item(
    payload: DeleteServiceCatalogPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.service_id <= 0 {
        return Err("삭제할 service_id가 올바르지 않습니다.".to_string());
    }

    let sql = "DELETE FROM service_catalog_management WHERE service_id = $1 AND store_code = $2";
    log_sql!(sql, payload.service_id, &store_code);
    let affected = client
        .execute(sql, &[&payload.service_id, &store_code])
        .await
        .map_err(|e| format!("시술 항목 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 시술 항목이 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "시술 항목 삭제 완료".to_string(),
    })
}

#[tauri::command]
async fn get_reservation_calendar_data(
    payload: ReservationCalendarQueryPayload,
) -> Result<ReservationCalendarDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    // 예약 헤더(날짜/시간/고객/상태)를 먼저 조회한다.
    let reservation_rows = client
        .query(
            r#"
            SELECT
                r.reservation_id::BIGINT,
                r.reservation_date::TEXT,
                TO_CHAR(r.start_time, 'HH24:MI') AS start_time,
                r.customer_name,
                r.designer_name,
                r.status_code,
                r.note
              FROM reservation_calendar_management r
             WHERE r.store_code = $1
             ORDER BY r.reservation_date ASC, r.start_time ASC, r.reservation_id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("예약 목록 조회 실패: {e}"))?;

    // 예약별 시술 라인은 별도 조회 후 HashMap으로 묶어서 조립한다.
    let service_line_rows = client
        .query(
            r#"
            SELECT
                l.line_id::BIGINT,
                l.reservation_id::BIGINT,
                l.service_id::BIGINT,
                l.category_code,
                l.category_name,
                l.service_name,
                l.unit_price::BIGINT,
                l.duration_minutes::INTEGER
              FROM reservation_calendar_service_line l
             WHERE l.store_code = $1
             ORDER BY l.reservation_id DESC, l.line_no ASC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("예약 시술 라인 조회 실패: {e}"))?;

    let mut service_map = HashMap::<i64, Vec<ReservationCalendarServiceDto>>::new();
    for row in service_line_rows {
        let reservation_id = row.get::<_, i64>(1);
        service_map
            .entry(reservation_id)
            .or_default()
            .push(ReservationCalendarServiceDto {
                line_id: row.get::<_, i64>(0),
                service_id: row.get::<_, i64>(2),
                category_code: row.get::<_, String>(3),
                category_name: row.get::<_, String>(4),
                service_name: row.get::<_, String>(5),
                unit_price: row.get::<_, i64>(6),
                duration_minutes: row.get::<_, i32>(7),
            });
    }

    let reservations = reservation_rows
        .into_iter()
        .map(|row| {
            let reservation_id = row.get::<_, i64>(0);
            ReservationCalendarDto {
                reservation_id,
                reservation_date: row.get::<_, String>(1),
                start_time: row.get::<_, String>(2),
                customer_name: row.get::<_, String>(3),
                designer_name: row.get::<_, String>(4),
                status: row.get::<_, String>(5),
                note: row.get::<_, Option<String>>(6),
                services: service_map.remove(&reservation_id).unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();

    Ok(ReservationCalendarDataResult {
        success: true,
        message: "예약 목록 조회 완료".to_string(),
        reservations,
    })
}

#[tauri::command]
async fn upsert_reservation_calendar_item(
    payload: UpsertReservationCalendarPayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let item = payload.item;
    let reservation_date_text = item.reservation_date.trim().to_string();
    let start_time_text = item.start_time.trim().to_string();
    let customer_name = item.customer_name.trim().to_string();
    let designer_name = item.designer_name.trim().to_string();
    let status_code = item.status.trim().to_uppercase();
    let note = item
        .note
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let is_update = item.reservation_id.is_some();

    // 날짜/시간 파싱을 선행해서 프론트가 잘못된 값을 보내도 DB 오류 전에 명확히 차단한다.
    let reservation_date = NaiveDate::parse_from_str(&reservation_date_text, "%Y-%m-%d")
        .map_err(|_| "예약일 형식은 YYYY-MM-DD 이어야 합니다.".to_string())?;
    let start_time = NaiveTime::parse_from_str(&start_time_text, "%H:%M")
        .map_err(|_| "예약 시간 형식은 HH:MM 이어야 합니다.".to_string())?;

    if customer_name.is_empty() {
        return Err("고객명은 필수입니다.".to_string());
    }
    if designer_name.is_empty() {
        return Err("디자이너명은 필수입니다.".to_string());
    }
    if status_code.is_empty() {
        return Err("예약 상태는 필수입니다.".to_string());
    }
    if item.service_ids.is_empty() {
        return Err("시술 항목은 1건 이상 필요합니다.".to_string());
    }

    // RESERVATION_STATUS 공통코드가 있으면 해당 코드만 허용하고,
    // 아직 코드 세팅 전이면 기본 상태 3종만 허용한다.
    let status_rows = client
        .query(
            r#"
            SELECT detail_code
              FROM common_code_detail
             WHERE group_code_id = 'RESERVATION_STATUS'
               AND use_yn = 'Y'
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("예약 상태코드 확인 실패: {e}"))?;

    if status_rows.is_empty() {
        let allowed = ["RESERVED", "COMPLETED", "CANCELLED"];
        if !allowed.contains(&status_code.as_str()) {
            return Err(
                "RESERVATION_STATUS 공통코드가 없으므로 RESERVED/COMPLETED/CANCELLED만 사용할 수 있습니다."
                    .to_string(),
            );
        }
    } else {
        let status_exists = status_rows.iter().any(|row| {
            row.get::<_, String>(0)
                .trim()
                .eq_ignore_ascii_case(status_code.as_str())
        });
        if !status_exists {
            return Err("선택한 예약 상태코드가 RESERVATION_STATUS 공통코드에 없습니다.".to_string());
        }
    }

    // 시술 항목은 중복 제거 리스트로 존재 여부를 검증하되,
    // 실제 저장 시에는 사용자가 보낸 순서를 line_no로 유지한다.
    let mut unique_service_ids = Vec::<i64>::new();
    let mut seen_service_ids = HashSet::<i64>::new();
    for service_id in &item.service_ids {
        if *service_id <= 0 {
            return Err("service_ids에는 1 이상의 값만 사용할 수 있습니다.".to_string());
        }
        if seen_service_ids.insert(*service_id) {
            unique_service_ids.push(*service_id);
        }
    }

    let service_rows = client
        .query(
            r#"
            SELECT
                s.service_id::BIGINT,
                s.category_code,
                COALESCE(c.detail_name, s.category_code) AS category_name,
                s.service_name,
                s.unit_price::BIGINT,
                s.duration_minutes::INTEGER
              FROM service_catalog_management s
         LEFT JOIN common_code_detail c
                ON c.group_code_id = 'T_CATEGORY'
               AND c.detail_code = s.category_code
             WHERE s.store_code = $1
               AND s.use_yn = 'Y'
               AND s.service_id::BIGINT = ANY($2::BIGINT[])
            "#,
            &[&store_code, &unique_service_ids],
        )
        .await
        .map_err(|e| format!("예약 시술 항목 확인 실패: {e}"))?;

    let mut service_snapshot_map = HashMap::<i64, (String, String, String, i64, i32)>::new();
    for row in service_rows {
        let service_id = row.get::<_, i64>(0);
        service_snapshot_map.insert(
            service_id,
            (
                row.get::<_, String>(1),
                row.get::<_, String>(2),
                row.get::<_, String>(3),
                row.get::<_, i64>(4),
                row.get::<_, i32>(5),
            ),
        );
    }

    for service_id in &unique_service_ids {
        if !service_snapshot_map.contains_key(service_id) {
            return Err("예약에 포함된 시술 항목 중 존재하지 않거나 사용중이 아닌 항목이 있습니다.".to_string());
        }
    }

    // 예약 헤더/라인을 같은 트랜잭션으로 처리해서 데이터 불일치를 방지한다.
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("예약 저장 트랜잭션 시작 실패: {e}"))?;

    let reservation_id = if let Some(reservation_id) = item.reservation_id {
        if reservation_id <= 0 {
            return Err("reservation_id는 1 이상이어야 합니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE reservation_calendar_management
                   SET reservation_date = $3,
                       start_time = $4,
                       customer_name = $5,
                       designer_name = $6,
                       status_code = $7,
                       note = $8,
                       updated_at = NOW()
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[
                    &reservation_id,
                    &store_code,
                    &reservation_date,
                    &start_time,
                    &customer_name,
                    &designer_name,
                    &status_code,
                    &note,
                ],
            )
            .await
            .map_err(|e| format!("예약 수정 실패: {e}"))?;

        if affected == 0 {
            return Err("수정 대상 예약이 없습니다.".to_string());
        }

        tx.execute(
            "DELETE FROM reservation_calendar_service_line WHERE reservation_id = $1 AND store_code = $2",
            &[&reservation_id, &store_code],
        )
        .await
        .map_err(|e| format!("기존 예약 시술 라인 삭제 실패: {e}"))?;

        reservation_id
    } else {
        tx.query_one(
            r#"
            INSERT INTO reservation_calendar_management (
                store_code,
                reservation_date,
                start_time,
                customer_name,
                designer_name,
                status_code,
                note
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING reservation_id::BIGINT
            "#,
            &[
                &store_code,
                &reservation_date,
                &start_time,
                &customer_name,
                &designer_name,
                &status_code,
                &note,
            ],
        )
        .await
        .map_err(|e| format!("예약 등록 실패: {e}"))?
        .get::<_, i64>(0)
    };

    for (index, service_id) in item.service_ids.iter().enumerate() {
        let Some(snapshot) = service_snapshot_map.get(service_id) else {
            return Err("예약 저장 중 시술 스냅샷이 유실되었습니다.".to_string());
        };

        // 프론트에서 선택한 순서를 보존하기 위해 line_no는 전달 순서(index+1)로 기록한다.
        let line_no = (index + 1) as i32;
        tx.execute(
            r#"
            INSERT INTO reservation_calendar_service_line (
                store_code,
                reservation_id,
                line_no,
                service_id,
                category_code,
                category_name,
                service_name,
                unit_price,
                duration_minutes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &reservation_id,
                &line_no,
                service_id,
                &snapshot.0,
                &snapshot.1,
                &snapshot.2,
                &snapshot.3,
                &snapshot.4,
            ],
        )
        .await
        .map_err(|e| format!("예약 시술 라인 저장 실패: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("예약 저장 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: if is_update {
            "예약 수정 완료".to_string()
        } else {
            "예약 등록 완료".to_string()
        },
    })
}

#[tauri::command]
async fn delete_reservation_calendar_item(
    payload: DeleteReservationCalendarPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.reservation_id <= 0 {
        return Err("삭제할 reservation_id가 올바르지 않습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM reservation_calendar_management WHERE reservation_id = $1 AND store_code = $2",
            &[&payload.reservation_id, &store_code],
        )
        .await
        .map_err(|e| format!("예약 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 예약이 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "예약 삭제 완료".to_string(),
    })
}

#[tauri::command]
async fn get_user_management_data(payload: UserQueryPayload) -> Result<UserDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_user_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let sql = r#"
        SELECT user_id::BIGINT, name, email, phone, address, remarks
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
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

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
            INSERT INTO user_management (user_id, store_code, name, email, phone, address, remarks)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id)
            DO UPDATE SET
                store_code = EXCLUDED.store_code,
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                address = EXCLUDED.address,
                remarks = EXCLUDED.remarks,
                updated_at = NOW()
        "#;
        log_sql!(sql, id, &store_code, &name, &email, &phone, &address, &remarks);
        client
            .execute(sql, &[&id, &store_code, &name, &email, &phone, &address, &remarks])
            .await
            .map_err(|e| format!("회원 저장 실패: {e}"))?;
    } else {
        let sql = r#"
            INSERT INTO user_management (store_code, name, email, phone, address, remarks)
            VALUES ($1, $2, $3, $4, $5, $6)
        "#;
        log_sql!(sql, &store_code, &name, &email, &phone, &address, &remarks);
        client
            .execute(sql, &[&store_code, &name, &email, &phone, &address, &remarks])
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
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.user_id <= 0 {
        return Err("삭제할 user_id가 올바르지 않습니다.".to_string());
    }

    let sql = "DELETE FROM user_management WHERE user_id = $1 AND store_code = $2";
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

#[tauri::command]
async fn get_member_point_management_data(
    payload: MemberPointQueryPayload,
) -> Result<MemberPointDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_member_point_recharge_cancel_log_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let member_rows = client
        .query(
            r#"
            SELECT
                u.user_id::BIGINT,
                u.name,
                u.phone,
                COALESCE(pb.point_balance, 0)::BIGINT AS point_balance
              FROM user_management u
         LEFT JOIN member_point_balance pb
                ON pb.store_code = $1
               AND pb.user_id = u.user_id
             WHERE u.store_code = $1
             ORDER BY u.user_id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("회원 포인트 회원 조회 실패: {e}"))?;

    let coupon_rows = client
        .query(
            r#"
            SELECT
                cb.user_id::BIGINT,
                cb.service_id::BIGINT,
                s.service_name,
                cb.coupon_count
              FROM member_coupon_balance cb
              JOIN service_catalog_management s
                ON s.service_id = cb.service_id
               AND s.store_code = cb.store_code
             WHERE cb.store_code = $1
               AND cb.coupon_count > 0
             ORDER BY cb.user_id, cb.service_id
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("회원 포인트 쿠폰 조회 실패: {e}"))?;

    let mut coupon_map: HashMap<i64, Vec<MemberPointCouponDto>> = HashMap::new();
    for row in coupon_rows {
        let user_id = row.get::<_, i64>(0);
        let coupon = MemberPointCouponDto {
            service_id: row.get::<_, i64>(1),
            service_name: row.get::<_, String>(2),
            count: row.get::<_, i32>(3),
        };
        coupon_map.entry(user_id).or_default().push(coupon);
    }

    let members = member_rows
        .into_iter()
        .map(|row| {
            let user_id = row.get::<_, i64>(0);
            MemberPointMemberDto {
                user_id,
                user_name: row.get::<_, String>(1),
                phone: row.get::<_, Option<String>>(2),
                point_balance: row.get::<_, i64>(3),
                coupons: coupon_map.remove(&user_id).unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();

    let history_rows = client
        .query(
            r#"
            SELECT
                x.id::BIGINT,
                x.action_type,
                x.user_id::BIGINT,
                x.user_name,
                x.user_phone,
                x.recharge_type,
                x.amount::BIGINT,
                x.service_id::BIGINT,
                x.service_name,
                x.coupon_count,
                x.payment_method_code,
                x.payment_method_name,
                x.memo,
                x.created_at::TEXT,
                x.is_cancelled,
                x.cancel_reason,
                x.cancelled_at
              FROM (
                    SELECT
                        h.id,
                        'RECHARGE'::TEXT AS action_type,
                        h.user_id,
                        u.name AS user_name,
                        u.phone AS user_phone,
                        h.recharge_type,
                        h.amount,
                        h.service_id,
                        s.service_name,
                        h.coupon_count,
                        h.payment_method_code,
                        COALESCE(pm.detail_name, h.payment_method_code) AS payment_method_name,
                        COALESCE(h.memo, '') AS memo,
                        h.created_at,
                        (h.status_code = 'CANCELLED') AS is_cancelled,
                        h.cancel_reason,
                        TO_CHAR(h.cancelled_at, 'YYYY-MM-DD HH24:MI:SS') AS cancelled_at
                      FROM member_point_history h
                      JOIN user_management u
                        ON u.user_id = h.user_id
                       AND u.store_code = h.store_code
                 LEFT JOIN service_catalog_management s
                        ON s.service_id = h.service_id
                       AND s.store_code = h.store_code
                 LEFT JOIN common_code_detail pm
                        ON pm.group_code_id = 'PAYMENT_METHOD'
                        AND pm.detail_code = h.payment_method_code
                      WHERE h.store_code = $1

                    UNION ALL

                    SELECT
                        uh.id,
                        'USE'::TEXT AS action_type,
                        uh.user_id,
                        u.name AS user_name,
                        u.phone AS user_phone,
                        uh.use_type AS recharge_type,
                        uh.amount,
                        uh.service_id,
                        s.service_name,
                        uh.coupon_count,
                        'USE'::TEXT AS payment_method_code,
                        '사용'::TEXT AS payment_method_name,
                        COALESCE(uh.memo, '') AS memo,
                        uh.created_at,
                        FALSE AS is_cancelled,
                        NULL::TEXT AS cancel_reason,
                        NULL::TEXT AS cancelled_at
                      FROM member_point_usage_history uh
                      JOIN user_management u
                        ON u.user_id = uh.user_id
                       AND u.store_code = uh.store_code
                 LEFT JOIN service_catalog_management s
                        ON s.service_id = uh.service_id
                       AND s.store_code = uh.store_code
                     WHERE uh.store_code = $1
                   ) x
             ORDER BY x.created_at DESC, x.id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("회원 포인트 이력 조회 실패: {e}"))?;

    let histories = history_rows
        .into_iter()
        .map(|row| MemberPointHistoryDto {
            id: row.get::<_, i64>(0),
            action_type: row.get::<_, String>(1),
            user_id: row.get::<_, i64>(2),
            user_name: row.get::<_, String>(3),
            user_phone: row.get::<_, Option<String>>(4),
            recharge_type: row.get::<_, String>(5),
            amount: row.get::<_, Option<i64>>(6),
            service_id: row.get::<_, Option<i64>>(7),
            service_name: row.get::<_, Option<String>>(8),
            coupon_count: row.get::<_, Option<i32>>(9),
            payment_method_code: row.get::<_, String>(10),
            payment_method_name: row.get::<_, String>(11),
            memo: row.get::<_, String>(12),
            created_at: row.get::<_, String>(13),
            is_cancelled: row.get::<_, bool>(14),
            cancel_reason: row.get::<_, Option<String>>(15),
            cancelled_at: row.get::<_, Option<String>>(16),
        })
        .collect::<Vec<_>>();

    Ok(MemberPointDataResult {
        success: true,
        message: "회원 포인트 조회 완료".to_string(),
        members,
        histories,
    })
}

#[tauri::command]
async fn recharge_member_point(
    payload: RechargeMemberPointPayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let recharge = payload.recharge;
    if recharge.user_id <= 0 {
        return Err("user_id는 1 이상이어야 합니다.".to_string());
    }

    let recharge_type = recharge.recharge_type.trim().to_uppercase();
    if recharge_type != "BALANCE" && recharge_type != "COUPON" {
        return Err("recharge_type은 BALANCE 또는 COUPON 이어야 합니다.".to_string());
    }

    let payment_method_code = recharge.payment_method_code.trim().to_uppercase();
    if payment_method_code.is_empty() {
        return Err("결제수단(payment_method_code)은 필수입니다.".to_string());
    }

    let payment_method_exists = client
        .query_opt(
            r#"
            SELECT 1
              FROM common_code_detail
             WHERE group_code_id = 'PAYMENT_METHOD'
               AND detail_code = $1
               AND use_yn = 'Y'
            "#,
            &[&payment_method_code],
        )
        .await
        .map_err(|e| format!("결제수단 코드 확인 실패: {e}"))?;
    if payment_method_exists.is_none() {
        return Err("PAYMENT_METHOD 공통코드에 등록된 사용중 결제수단만 가능합니다.".to_string());
    }

    let user_exists = client
        .query_opt(
            "SELECT 1 FROM user_management WHERE user_id::BIGINT = $1 AND store_code = $2",
            &[&recharge.user_id, &store_code],
        )
        .await
        .map_err(|e| format!("회원 확인 실패: {e}"))?;
    if user_exists.is_none() {
        return Err("선택한 점포의 회원이 존재하지 않습니다.".to_string());
    }

    let memo = recharge
        .memo
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("포인트 충전 트랜잭션 시작 실패: {e}"))?;

    if recharge_type == "BALANCE" {
        let amount = recharge.amount.unwrap_or(0);
        if amount <= 0 {
            return Err("예치금 충전 금액은 1원 이상이어야 합니다.".to_string());
        }

        tx.execute(
            r#"
            INSERT INTO member_point_balance (store_code, user_id, point_balance)
            VALUES ($1, $2, $3)
            ON CONFLICT (store_code, user_id)
            DO UPDATE SET
                point_balance = member_point_balance.point_balance + EXCLUDED.point_balance,
                updated_at = NOW()
            "#,
            &[&store_code, &recharge.user_id, &amount],
        )
        .await
        .map_err(|e| format!("예치금 충전 저장 실패: {e}"))?;

        let amount_option: Option<i64> = Some(amount);
        let none_service_id: Option<i64> = None;
        let none_coupon_count: Option<i32> = None;
        tx.execute(
            r#"
            INSERT INTO member_point_history (
                store_code, user_id, recharge_type, amount, service_id, coupon_count, payment_method_code, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            "#,
            &[
                &store_code,
                &recharge.user_id,
                &recharge_type,
                &amount_option,
                &none_service_id,
                &none_coupon_count,
                &payment_method_code,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("예치금 충전 이력 저장 실패: {e}"))?;
    } else {
        let amount = recharge.amount.unwrap_or(0);
        if amount <= 0 {
            return Err("쿠폰 충전 수납 금액은 1원 이상이어야 합니다.".to_string());
        }

        let service_id = recharge
            .service_id
            .ok_or_else(|| "쿠폰 충전 시 service_id는 필수입니다.".to_string())?;
        if service_id <= 0 {
            return Err("service_id는 1 이상이어야 합니다.".to_string());
        }

        let coupon_count = recharge.coupon_count.unwrap_or(0);
        if coupon_count <= 0 {
            return Err("쿠폰 충전 횟수는 1 이상이어야 합니다.".to_string());
        }

        let service_exists = tx
            .query_opt(
                r#"
                SELECT 1
                  FROM service_catalog_management
                 WHERE service_id = $1
                   AND store_code = $2
                   AND use_yn = 'Y'
                "#,
                &[&service_id, &store_code],
            )
            .await
            .map_err(|e| format!("시술 항목 확인 실패: {e}"))?;
        if service_exists.is_none() {
            return Err("선택한 점포의 사용중 시술항목만 쿠폰으로 충전할 수 있습니다.".to_string());
        }

        tx.execute(
            r#"
            INSERT INTO member_coupon_balance (store_code, user_id, service_id, coupon_count)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (store_code, user_id, service_id)
            DO UPDATE SET
                coupon_count = member_coupon_balance.coupon_count + EXCLUDED.coupon_count,
                updated_at = NOW()
            "#,
            &[&store_code, &recharge.user_id, &service_id, &coupon_count],
        )
        .await
        .map_err(|e| format!("쿠폰 충전 저장 실패: {e}"))?;

        let amount_option: Option<i64> = Some(amount);
        let service_id_option: Option<i64> = Some(service_id);
        let coupon_count_option: Option<i32> = Some(coupon_count);
        tx.execute(
            r#"
            INSERT INTO member_point_history (
                store_code, user_id, recharge_type, amount, service_id, coupon_count, payment_method_code, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            "#,
            &[
                &store_code,
                &recharge.user_id,
                &recharge_type,
                &amount_option,
                &service_id_option,
                &coupon_count_option,
                &payment_method_code,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("쿠폰 충전 이력 저장 실패: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("포인트 충전 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "회원 포인트 충전이 완료되었습니다.".to_string(),
    })
}

#[tauri::command]
async fn cancel_member_point_recharge(
    payload: CancelMemberPointRechargePayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_member_point_recharge_cancel_log_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.history_id <= 0 {
        return Err("history_id는 1 이상이어야 합니다.".to_string());
    }

    let cancel_reason = payload.cancel_reason.trim().to_string();
    if cancel_reason.is_empty() {
        return Err("취소 사유를 입력해주세요.".to_string());
    }

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("충전 취소 트랜잭션 시작 실패: {e}"))?;

    let recharge_row = tx
        .query_opt(
            r#"
            SELECT
                h.user_id::BIGINT,
                h.recharge_type,
                COALESCE(h.amount, 0)::BIGINT,
                h.service_id::BIGINT,
                COALESCE(h.coupon_count, 0)::INTEGER,
                COALESCE(h.status_code, 'ACTIVE')
              FROM member_point_history h
             WHERE h.id::BIGINT = $1
               AND h.store_code = $2
             FOR UPDATE
            "#,
            &[&payload.history_id, &store_code],
        )
        .await
        .map_err(|e| format!("취소 대상 충전 이력 조회 실패: {e}"))?;

    let Some(recharge_row) = recharge_row else {
        return Err("취소 대상 충전 이력이 없습니다.".to_string());
    };

    let user_id = recharge_row.get::<_, i64>(0);
    let recharge_type = recharge_row.get::<_, String>(1).trim().to_uppercase();
    let amount = recharge_row.get::<_, i64>(2);
    let service_id = recharge_row.get::<_, Option<i64>>(3);
    let coupon_count = recharge_row.get::<_, i32>(4);
    let current_status = recharge_row.get::<_, String>(5).trim().to_uppercase();

    if recharge_type != "BALANCE" && recharge_type != "COUPON" {
        return Err("취소 대상 충전 이력 유형이 올바르지 않습니다.".to_string());
    }

    if current_status == "CANCELLED" {
        return Err("이미 취소된 충전 이력입니다.".to_string());
    }

    if recharge_type == "BALANCE" {
        if amount <= 0 {
            return Err("취소 대상 충전 금액이 올바르지 않습니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE member_point_balance
                   SET point_balance = point_balance - $3,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND user_id = $2
                   AND point_balance >= $3
                "#,
                &[&store_code, &user_id, &amount],
            )
            .await
            .map_err(|e| format!("예치금 충전 취소 롤백 실패: {e}"))?;

        if affected == 0 {
            return Err("예치금 잔액이 부족하여 충전을 취소할 수 없습니다.".to_string());
        }
    } else {
        let Some(service_id) = service_id else {
            return Err("취소 대상 시술 정보가 없습니다.".to_string());
        };
        if service_id <= 0 {
            return Err("취소 대상 시술 정보가 올바르지 않습니다.".to_string());
        }
        if coupon_count <= 0 {
            return Err("취소 대상 횟수 정보가 올바르지 않습니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE member_coupon_balance
                   SET coupon_count = coupon_count - $4,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND user_id = $2
                   AND service_id = $3
                   AND coupon_count >= $4
                "#,
                &[&store_code, &user_id, &service_id, &coupon_count],
            )
            .await
            .map_err(|e| format!("쿠폰 충전 취소 롤백 실패: {e}"))?;

        if affected == 0 {
            return Err("쿠폰 잔여 횟수가 부족하여 충전을 취소할 수 없습니다.".to_string());
        }
    }

    let affected = tx
        .execute(
        r#"
        UPDATE member_point_history
           SET status_code = 'CANCELLED',
               cancel_reason = $3,
               cancelled_at = NOW()
         WHERE id::BIGINT = $1
           AND store_code = $2
           AND (status_code IS NULL OR status_code <> 'CANCELLED')
        "#,
        &[&payload.history_id, &store_code, &cancel_reason],
    )
    .await
    .map_err(|e| format!("충전 이력 상태 취소 처리 실패: {e}"))?;

    if affected == 0 {
        return Err("취소 대상 충전 이력이 없거나 이미 취소되었습니다.".to_string());
    }

    tx.commit()
        .await
        .map_err(|e| format!("충전 취소 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "충전 취소가 완료되었습니다.".to_string(),
    })
}

#[tauri::command]
async fn use_member_point(payload: UseMemberPointPayload) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let usage = payload.usage;
    if usage.user_id <= 0 {
        return Err("user_id는 1 이상이어야 합니다.".to_string());
    }

    let use_type = usage.use_type.trim().to_uppercase();
    if use_type != "BALANCE" && use_type != "COUPON" {
        return Err("use_type은 BALANCE 또는 COUPON 이어야 합니다.".to_string());
    }

    let user_exists = client
        .query_opt(
            "SELECT 1 FROM user_management WHERE user_id::BIGINT = $1 AND store_code = $2",
            &[&usage.user_id, &store_code],
        )
        .await
        .map_err(|e| format!("회원 확인 실패: {e}"))?;
    if user_exists.is_none() {
        return Err("선택한 점포의 회원이 존재하지 않습니다.".to_string());
    }

    let memo = usage
        .memo
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("포인트 사용 트랜잭션 시작 실패: {e}"))?;

    if use_type == "BALANCE" {
        let amount = usage.amount.unwrap_or(0);
        if amount <= 0 {
            return Err("예치금 사용 금액은 1원 이상이어야 합니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE member_point_balance
                   SET point_balance = point_balance - $3,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND user_id = $2
                   AND point_balance >= $3
                "#,
                &[&store_code, &usage.user_id, &amount],
            )
            .await
            .map_err(|e| format!("예치금 사용 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("예치금 잔액이 부족합니다.".to_string());
        }

        let amount_option: Option<i64> = Some(amount);
        let none_service_id: Option<i64> = None;
        let none_coupon_count: Option<i32> = None;
        tx.execute(
            r#"
            INSERT INTO member_point_usage_history (
                store_code, user_id, use_type, amount, service_id, coupon_count, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            "#,
            &[
                &store_code,
                &usage.user_id,
                &use_type,
                &amount_option,
                &none_service_id,
                &none_coupon_count,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("예치금 사용 이력 저장 실패: {e}"))?;
    } else {
        let service_id = usage
            .service_id
            .ok_or_else(|| "쿠폰 사용 시 service_id는 필수입니다.".to_string())?;
        if service_id <= 0 {
            return Err("service_id는 1 이상이어야 합니다.".to_string());
        }

        let coupon_count = usage.coupon_count.unwrap_or(0);
        if coupon_count <= 0 {
            return Err("쿠폰 사용 횟수는 1 이상이어야 합니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE member_coupon_balance
                   SET coupon_count = coupon_count - $4,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND user_id = $2
                   AND service_id = $3
                   AND coupon_count >= $4
                "#,
                &[&store_code, &usage.user_id, &service_id, &coupon_count],
            )
            .await
            .map_err(|e| format!("쿠폰 사용 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("쿠폰 잔여 횟수가 부족합니다.".to_string());
        }

        let none_amount: Option<i64> = None;
        let service_id_option: Option<i64> = Some(service_id);
        let coupon_count_option: Option<i32> = Some(coupon_count);
        tx.execute(
            r#"
            INSERT INTO member_point_usage_history (
                store_code, user_id, use_type, amount, service_id, coupon_count, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            "#,
            &[
                &store_code,
                &usage.user_id,
                &use_type,
                &none_amount,
                &service_id_option,
                &coupon_count_option,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("쿠폰 사용 이력 저장 실패: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("포인트 사용 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: "회원 포인트 사용 처리가 완료되었습니다.".to_string(),
    })
}

#[tauri::command]
async fn get_sales_settlement_data(
    payload: SalesSettlementQueryPayload,
) -> Result<SalesSettlementDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let settlement_rows = client
        .query(
            r#"
            SELECT
                s.settlement_id::BIGINT,
                TO_CHAR(s.settlement_datetime, 'YYYY-MM-DD HH24:MI') AS settlement_datetime,
                s.member_user_id::BIGINT,
                s.manager_employee_id::BIGINT,
                s.total_amount::BIGINT,
                s.total_time_minutes::INTEGER,
                s.status,
                s.reservation_ref,
                s.cancel_type,
                s.cancel_reason,
                TO_CHAR(s.cancelled_at, 'YYYY-MM-DD HH24:MI') AS cancelled_at
              FROM sales_settlement_management s
             WHERE s.store_code = $1
             ORDER BY s.settlement_datetime DESC, s.settlement_id DESC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("정산 마스터 조회 실패: {e}"))?;

    let service_rows = client
        .query(
            r#"
            SELECT
                l.settlement_id::BIGINT,
                l.line_no::INTEGER,
                l.service_id::BIGINT
              FROM sales_settlement_service_line l
             WHERE l.store_code = $1
             ORDER BY l.settlement_id DESC, l.line_no ASC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("정산 시술 라인 조회 실패: {e}"))?;

    let payment_rows = client
        .query(
            r#"
            SELECT
                p.settlement_id::BIGINT,
                p.line_no::INTEGER,
                p.payment_method_code,
                p.amount::BIGINT,
                p.coupon_service_id::BIGINT
              FROM sales_settlement_payment_line p
             WHERE p.store_code = $1
             ORDER BY p.settlement_id DESC, p.line_no ASC
            "#,
            &[&store_code],
        )
        .await
        .map_err(|e| format!("정산 결제 라인 조회 실패: {e}"))?;

    let mut service_map: HashMap<i64, Vec<(i32, i64)>> = HashMap::new();
    for row in service_rows {
        let settlement_id = row.get::<_, i64>(0);
        let line_no = row.get::<_, i32>(1);
        let service_id = row.get::<_, i64>(2);
        service_map
            .entry(settlement_id)
            .or_default()
            .push((line_no, service_id));
    }

    let mut payment_map: HashMap<i64, Vec<(i32, SalesSettlementPaymentDto)>> = HashMap::new();
    for row in payment_rows {
        let settlement_id = row.get::<_, i64>(0);
        let line_no = row.get::<_, i32>(1);
        let payment = SalesSettlementPaymentDto {
            payment_method_code: row.get::<_, String>(2),
            amount: row.get::<_, i64>(3),
            coupon_service_id: row.get::<_, Option<i64>>(4),
        };
        payment_map
            .entry(settlement_id)
            .or_default()
            .push((line_no, payment));
    }

    let settlements = settlement_rows
        .into_iter()
        .map(|row| {
            let settlement_id = row.get::<_, i64>(0);
            let mut service_lines = service_map.remove(&settlement_id).unwrap_or_default();
            service_lines.sort_by_key(|line| line.0);
            let service_ids = service_lines
                .into_iter()
                .map(|line| line.1)
                .collect::<Vec<_>>();

            let mut payment_lines = payment_map.remove(&settlement_id).unwrap_or_default();
            payment_lines.sort_by_key(|line| line.0);
            let payments = payment_lines
                .into_iter()
                .map(|line| line.1)
                .collect::<Vec<_>>();

            SalesSettlementDto {
                settlement_id,
                settlement_datetime: row.get::<_, String>(1),
                member_user_id: row.get::<_, Option<i64>>(2),
                manager_employee_id: row.get::<_, i64>(3),
                total_amount: row.get::<_, i64>(4),
                total_time_minutes: row.get::<_, i32>(5),
                status: row.get::<_, String>(6),
                reservation_ref: row.get::<_, Option<String>>(7),
                cancel_type: row.get::<_, Option<String>>(8),
                cancel_reason: row.get::<_, Option<String>>(9),
                cancelled_at: row.get::<_, Option<String>>(10),
                service_ids,
                payments,
            }
        })
        .collect::<Vec<_>>();

    Ok(SalesSettlementDataResult {
        success: true,
        message: "정산 조회 완료".to_string(),
        settlements,
    })
}

fn build_sales_coupon_usage_memo(settlement_id: i64, line_no: i32) -> String {
    format!("{SALES_COUPON_USAGE_MEMO_PREFIX}{settlement_id}:{line_no}")
}

fn build_sales_coupon_usage_memo_pattern(settlement_id: i64) -> String {
    format!("{SALES_COUPON_USAGE_MEMO_PREFIX}{settlement_id}:%")
}

async fn restore_sales_settlement_coupon_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
) -> Result<(), String> {
    let memo_pattern = build_sales_coupon_usage_memo_pattern(settlement_id);
    let usage_rows = tx
        .query(
            r#"
            SELECT
                id::BIGINT,
                user_id::BIGINT,
                service_id::BIGINT,
                COALESCE(coupon_count, 0)::INTEGER
              FROM member_point_usage_history
             WHERE store_code = $1
               AND use_type = 'COUPON'
               AND memo LIKE $2
             ORDER BY id
             FOR UPDATE
            "#,
            &[&store_code, &memo_pattern],
        )
        .await
        .map_err(|e| format!("정산 쿠폰 사용 이력 조회 실패: {e}"))?;

    for row in usage_rows {
        let usage_id = row.get::<_, i64>(0);
        let user_id = row.get::<_, i64>(1);
        let service_id = row
            .get::<_, Option<i64>>(2)
            .ok_or_else(|| format!("정산 쿠폰 사용 이력의 시술 정보가 없습니다. (usage_id={usage_id})"))?;
        if service_id <= 0 {
            return Err(format!(
                "정산 쿠폰 사용 이력의 시술 정보가 올바르지 않습니다. (usage_id={usage_id})"
            ));
        }
        let coupon_count = row.get::<_, i32>(3);
        if coupon_count <= 0 {
            return Err(format!(
                "정산 쿠폰 사용 이력의 횟수 정보가 올바르지 않습니다. (usage_id={usage_id})"
            ));
        }

        tx.execute(
            r#"
            INSERT INTO member_coupon_balance (store_code, user_id, service_id, coupon_count)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (store_code, user_id, service_id)
            DO UPDATE SET
                coupon_count = member_coupon_balance.coupon_count + EXCLUDED.coupon_count,
                updated_at = NOW()
            "#,
            &[&store_code, &user_id, &service_id, &coupon_count],
        )
        .await
        .map_err(|e| format!("정산 쿠폰 원복 처리 실패: {e}"))?;
    }

    tx.execute(
        r#"
        DELETE FROM member_point_usage_history
         WHERE store_code = $1
           AND use_type = 'COUPON'
           AND memo LIKE $2
        "#,
        &[&store_code, &memo_pattern],
    )
    .await
    .map_err(|e| format!("정산 쿠폰 사용 이력 정리 실패: {e}"))?;

    Ok(())
}

async fn apply_sales_settlement_coupon_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
    member_user_id: i64,
    coupon_usage_lines: &[(i32, i64, i32)],
) -> Result<(), String> {
    for (line_no, service_id, coupon_count) in coupon_usage_lines {
        if *service_id <= 0 {
            return Err("쿠폰 결제 시술 정보가 올바르지 않습니다.".to_string());
        }
        if *coupon_count <= 0 {
            return Err("쿠폰 사용 횟수는 1 이상이어야 합니다.".to_string());
        }

        let affected = tx
            .execute(
                r#"
                UPDATE member_coupon_balance
                   SET coupon_count = coupon_count - $4,
                       updated_at = NOW()
                 WHERE store_code = $1
                   AND user_id = $2
                   AND service_id = $3
                   AND coupon_count >= $4
                "#,
                &[&store_code, &member_user_id, service_id, coupon_count],
            )
            .await
            .map_err(|e| format!("정산 쿠폰 차감 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("쿠폰 잔여 횟수가 부족하여 결제완료 처리할 수 없습니다.".to_string());
        }

        let use_type = "COUPON".to_string();
        let amount_option: Option<i64> = None;
        let service_id_option: Option<i64> = Some(*service_id);
        let coupon_count_option: Option<i32> = Some(*coupon_count);
        let memo = build_sales_coupon_usage_memo(settlement_id, *line_no);

        tx.execute(
            r#"
            INSERT INTO member_point_usage_history (
                store_code, user_id, use_type, amount, service_id, coupon_count, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            "#,
            &[
                &store_code,
                &member_user_id,
                &use_type,
                &amount_option,
                &service_id_option,
                &coupon_count_option,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("정산 쿠폰 사용 이력 저장 실패: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn upsert_sales_settlement(payload: UpsertSalesSettlementPayload) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let settlement = payload.settlement;
    let is_update = settlement.settlement_id.is_some();

    if settlement.manager_employee_id <= 0 {
        return Err("manager_employee_id는 1 이상이어야 합니다.".to_string());
    }
    if settlement.service_ids.is_empty() {
        return Err("service_ids는 1건 이상이어야 합니다.".to_string());
    }

    let status = settlement.status.trim().to_uppercase();
    if status != "PROCESSING" && status != "COMPLETED" {
        return Err("status는 PROCESSING 또는 COMPLETED 이어야 합니다.".to_string());
    }

    if let Some(member_user_id) = settlement.member_user_id {
        if member_user_id <= 0 {
            return Err("member_user_id는 1 이상이어야 합니다.".to_string());
        }
        let member_exists = client
            .query_opt(
                "SELECT 1 FROM user_management WHERE store_code = $1 AND user_id::BIGINT = $2",
                &[&store_code, &member_user_id],
            )
            .await
            .map_err(|e| format!("회원 확인 실패: {e}"))?;
        if member_exists.is_none() {
            return Err("선택한 점포의 회원이 존재하지 않습니다.".to_string());
        }
    }

    let manager_exists = client
        .query_opt(
            "SELECT 1 FROM employee_management WHERE store_code = $1 AND employee_id::BIGINT = $2",
            &[&store_code, &settlement.manager_employee_id],
        )
        .await
        .map_err(|e| format!("담당자 확인 실패: {e}"))?;
    if manager_exists.is_none() {
        return Err("선택한 점포의 담당자가 존재하지 않습니다.".to_string());
    }

    let mut unique_service_ids = Vec::<i64>::new();
    let mut seen_service_ids = HashSet::<i64>::new();
    for service_id in &settlement.service_ids {
        if *service_id <= 0 {
            return Err("service_ids에는 1 이상의 값만 사용할 수 있습니다.".to_string());
        }
        if seen_service_ids.insert(*service_id) {
            unique_service_ids.push(*service_id);
        }
    }

    let service_rows = client
        .query(
            r#"
            SELECT
                s.service_id::BIGINT,
                s.service_name,
                s.category_code,
                COALESCE(cc.detail_name, s.category_code) AS category_name,
                s.unit_price::BIGINT,
                s.duration_minutes::INTEGER
              FROM service_catalog_management s
         LEFT JOIN common_code_detail cc
                ON cc.group_code_id = 'T_CATEGORY'
               AND cc.detail_code = s.category_code
             WHERE s.store_code = $1
               AND s.use_yn = 'Y'
               AND s.service_id::BIGINT = ANY($2::BIGINT[])
            "#,
            &[&store_code, &unique_service_ids],
        )
        .await
        .map_err(|e| format!("시술 항목 확인 실패: {e}"))?;

    let mut service_map = HashMap::<i64, (String, String, String, i64, i32)>::new();
    for row in service_rows {
        let service_id = row.get::<_, i64>(0);
        service_map.insert(
            service_id,
            (
                row.get::<_, String>(1),
                row.get::<_, String>(2),
                row.get::<_, String>(3),
                row.get::<_, i64>(4),
                row.get::<_, i32>(5),
            ),
        );
    }

    for service_id in &unique_service_ids {
        if !service_map.contains_key(service_id) {
            return Err("선택한 시술 항목이 존재하지 않거나 사용중이 아닙니다.".to_string());
        }
    }

    let mut total_amount: i64 = 0;
    let mut total_time_minutes: i32 = 0;
    for service_id in &settlement.service_ids {
        let Some(snapshot) = service_map.get(service_id) else {
            return Err("시술 항목 계산 중 데이터가 유실되었습니다.".to_string());
        };
        total_amount += snapshot.3;
        total_time_minutes += snapshot.4;
    }

    let payment_method_rows = client
        .query(
            r#"
            SELECT detail_code, detail_name
              FROM common_code_detail
             WHERE group_code_id = 'PAYMENT_METHOD'
               AND use_yn = 'Y'
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("결제수단 확인 실패: {e}"))?;

    let mut payment_method_map = HashMap::<String, String>::new();
    for row in payment_method_rows {
        let code = row.get::<_, String>(0).trim().to_uppercase();
        let name = row.get::<_, String>(1);
        payment_method_map.insert(code, name);
    }

    #[derive(Clone)]
    struct PaymentInsertLine {
        payment_method_code: String,
        payment_method_name: String,
        amount: i64,
        coupon_service_id: Option<i64>,
        coupon_service_name: Option<String>,
    }

    let mut insert_payment_lines = Vec::<PaymentInsertLine>::new();
    let mut paid_total: i64 = 0;
    let mut coupon_service_ids = HashSet::<i64>::new();

    for payment in &settlement.payments {
        let code = payment.payment_method_code.trim().to_uppercase();
        if code.is_empty() {
            return Err("결제수단 코드는 필수입니다.".to_string());
        }
        let Some(method_name) = payment_method_map.get(&code) else {
            return Err("PAYMENT_METHOD 공통코드에 등록된 사용중 결제수단만 사용할 수 있습니다.".to_string());
        };

        if payment.amount < 0 {
            return Err("결제 금액은 0 이상이어야 합니다.".to_string());
        }
        if settlement.member_user_id.is_none() && (code == "PREPAID" || code == "COUPON") {
            return Err("일반 방문객은 PREPAID 또는 COUPON 결제를 사용할 수 없습니다.".to_string());
        }

        let coupon_service_id = if code == "COUPON" {
            let Some(coupon_service_id) = payment.coupon_service_id else {
                return Err("COUPON 결제 시 coupon_service_id는 필수입니다.".to_string());
            };
            if coupon_service_id <= 0 {
                return Err("coupon_service_id는 1 이상이어야 합니다.".to_string());
            }
            coupon_service_ids.insert(coupon_service_id);
            Some(coupon_service_id)
        } else {
            None
        };

        paid_total += payment.amount;
        insert_payment_lines.push(PaymentInsertLine {
            payment_method_code: code,
            payment_method_name: method_name.clone(),
            amount: payment.amount,
            coupon_service_id,
            coupon_service_name: None,
        });
    }

    if status == "COMPLETED" && paid_total > total_amount {
        return Err("결제 완료 시 결제 금액 합계가 총 금액을 초과할 수 없습니다.".to_string());
    }

    if !coupon_service_ids.is_empty() {
        let coupon_service_id_vec = coupon_service_ids.into_iter().collect::<Vec<_>>();
        let coupon_service_rows = client
            .query(
                r#"
                SELECT service_id::BIGINT, service_name
                  FROM service_catalog_management
                 WHERE store_code = $1
                   AND service_id::BIGINT = ANY($2::BIGINT[])
                "#,
                &[&store_code, &coupon_service_id_vec],
            )
            .await
            .map_err(|e| format!("쿠폰 시술 확인 실패: {e}"))?;

        let mut coupon_service_map = HashMap::<i64, String>::new();
        for row in coupon_service_rows {
            coupon_service_map.insert(row.get::<_, i64>(0), row.get::<_, String>(1));
        }

        for payment in insert_payment_lines.iter_mut() {
            if let Some(coupon_service_id) = payment.coupon_service_id {
                let Some(name) = coupon_service_map.get(&coupon_service_id) else {
                    return Err("쿠폰 결제에 연결된 시술이 존재하지 않습니다.".to_string());
                };
                payment.coupon_service_name = Some(name.clone());
            }
        }
    }

    let reservation_ref = settlement
        .reservation_ref
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    // 정산이 예약건에서 시작된 경우 reservation_ref를 예약 PK로 파싱해 존재 여부를 먼저 검증한다.
    let linked_reservation_id = if let Some(reservation_ref_value) = reservation_ref.as_ref() {
        let parsed_reservation_id = reservation_ref_value
            .parse::<i64>()
            .map_err(|_| "reservation_ref는 예약 ID(숫자)여야 합니다.".to_string())?;
        if parsed_reservation_id <= 0 {
            return Err("reservation_ref는 1 이상의 예약 ID여야 합니다.".to_string());
        }

        let reservation_exists = client
            .query_opt(
                r#"
                SELECT 1
                  FROM reservation_calendar_management
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&parsed_reservation_id, &store_code],
            )
            .await
            .map_err(|e| format!("예약 연동 대상 확인 실패: {e}"))?;

        if reservation_exists.is_none() {
            return Err("연동할 예약 데이터가 존재하지 않습니다.".to_string());
        }

        Some(parsed_reservation_id)
    } else {
        None
    };

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("시술 정산 저장 트랜잭션 시작 실패: {e}"))?;

    let settlement_id = if let Some(settlement_id) = settlement.settlement_id {
        if settlement_id <= 0 {
            return Err("settlement_id는 1 이상이어야 합니다.".to_string());
        }

        restore_sales_settlement_coupon_usage(&tx, &store_code, settlement_id).await?;

        let affected = tx
            .execute(
                r#"
                UPDATE sales_settlement_management
                   SET member_user_id = $3,
                       manager_employee_id = $4,
                       total_amount = $5,
                       total_time_minutes = $6,
                       status = $7,
                       reservation_ref = $8,
                       cancel_type = NULL,
                       cancel_reason = NULL,
                       cancelled_at = NULL,
                       updated_at = NOW()
                 WHERE settlement_id = $1
                   AND store_code = $2
                "#,
                &[
                    &settlement_id,
                    &store_code,
                    &settlement.member_user_id,
                    &settlement.manager_employee_id,
                    &total_amount,
                    &total_time_minutes,
                    &status,
                    &reservation_ref,
                ],
            )
            .await
            .map_err(|e| format!("정산 수정 실패: {e}"))?;

        if affected == 0 {
            return Err("수정 대상 정산 데이터가 없습니다.".to_string());
        }

        tx.execute(
            "DELETE FROM sales_settlement_service_line WHERE settlement_id = $1 AND store_code = $2",
            &[&settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("기존 시술 라인 정리 실패: {e}"))?;

        tx.execute(
            "DELETE FROM sales_settlement_payment_line WHERE settlement_id = $1 AND store_code = $2",
            &[&settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("기존 결제 라인 정리 실패: {e}"))?;

        settlement_id
    } else {
        tx.query_one(
            r#"
            INSERT INTO sales_settlement_management (
                store_code,
                member_user_id,
                manager_employee_id,
                total_amount,
                total_time_minutes,
                status,
                reservation_ref,
                cancel_type,
                cancel_reason,
                cancelled_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,NULL)
            RETURNING settlement_id::BIGINT
            "#,
            &[
                &store_code,
                &settlement.member_user_id,
                &settlement.manager_employee_id,
                &total_amount,
                &total_time_minutes,
                &status,
                &reservation_ref,
            ],
        )
        .await
        .map_err(|e| format!("정산 등록 실패: {e}"))?
        .get::<_, i64>(0)
    };

    for (index, service_id) in settlement.service_ids.iter().enumerate() {
        let Some(snapshot) = service_map.get(service_id) else {
            return Err("시술 라인 저장 중 데이터가 유실되었습니다.".to_string());
        };
        let line_no = (index + 1) as i32;
        tx.execute(
            r#"
            INSERT INTO sales_settlement_service_line (
                store_code,
                settlement_id,
                line_no,
                service_id,
                service_name,
                category_code,
                category_name,
                unit_price,
                duration_minutes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &settlement_id,
                &line_no,
                service_id,
                &snapshot.0,
                &snapshot.1,
                &snapshot.2,
                &snapshot.3,
                &snapshot.4,
            ],
        )
        .await
        .map_err(|e| format!("시술 라인 저장 실패: {e}"))?;
    }

    for (index, payment) in insert_payment_lines.iter().enumerate() {
        let line_no = (index + 1) as i32;
        tx.execute(
            r#"
            INSERT INTO sales_settlement_payment_line (
                store_code,
                settlement_id,
                line_no,
                payment_method_code,
                payment_method_name,
                amount,
                coupon_service_id,
                coupon_service_name
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            "#,
            &[
                &store_code,
                &settlement_id,
                &line_no,
                &payment.payment_method_code,
                &payment.payment_method_name,
                &payment.amount,
                &payment.coupon_service_id,
                &payment.coupon_service_name,
            ],
        )
        .await
        .map_err(|e| format!("결제 라인 저장 실패: {e}"))?;
    }

    let coupon_usage_lines = insert_payment_lines
        .iter()
        .enumerate()
        .filter_map(|(index, payment)| {
            payment
                .coupon_service_id
                .map(|service_id| ((index + 1) as i32, service_id, 1_i32))
        })
        .collect::<Vec<_>>();

    if status == "COMPLETED" && !coupon_usage_lines.is_empty() {
        let Some(member_user_id) = settlement.member_user_id else {
            return Err("쿠폰 결제는 회원 지정이 필요합니다.".to_string());
        };

        apply_sales_settlement_coupon_usage(
            &tx,
            &store_code,
            settlement_id,
            member_user_id,
            &coupon_usage_lines,
        )
        .await?;
    }

    // 예약 연동 건이면 정산 상태를 예약 상태에도 동기화한다.
    if let Some(reservation_id) = linked_reservation_id {
        let affected = tx
            .execute(
                r#"
                UPDATE reservation_calendar_management
                   SET status_code = $3,
                       updated_at = NOW()
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&reservation_id, &store_code, &status],
            )
            .await
            .map_err(|e| format!("예약 상태 동기화 실패: {e}"))?;

        if affected == 0 {
            return Err("예약 상태를 동기화할 대상 예약이 없습니다.".to_string());
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("시술 정산 저장 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: if is_update {
            "시술 정산 수정 완료".to_string()
        } else {
            "시술 정산 등록 완료".to_string()
        },
    })
}

#[tauri::command]
async fn cancel_sales_settlement(
    payload: CancelSalesSettlementPayload,
) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.settlement_id <= 0 {
        return Err("취소할 settlement_id가 올바르지 않습니다.".to_string());
    }

    let cancel_type = payload.cancel_type.trim().to_uppercase();
    if cancel_type != "PAYMENT" && cancel_type != "PROCEDURE" {
        return Err("cancel_type은 PAYMENT 또는 PROCEDURE 이어야 합니다.".to_string());
    }

    let cancel_reason = payload.cancel_reason.trim().to_string();
    if cancel_reason.is_empty() {
        return Err("취소 사유는 필수입니다.".to_string());
    }

    let settlement_row = client
        .query_opt(
            r#"
            SELECT status, reservation_ref
              FROM sales_settlement_management
             WHERE settlement_id = $1
               AND store_code = $2
            "#,
            &[&payload.settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("취소 대상 정산 조회 실패: {e}"))?;

    let Some(settlement_row) = settlement_row else {
        return Err("취소 대상 정산 데이터가 없습니다.".to_string());
    };

    let current_status = settlement_row.get::<_, String>(0).trim().to_uppercase();
    if current_status == "CANCELLED" {
        return Err("이미 취소된 매출입니다.".to_string());
    }
    if cancel_type == "PAYMENT" && current_status != "COMPLETED" {
        return Err("결제취소는 결제완료 상태에서만 가능합니다.".to_string());
    }

    let reservation_ref = settlement_row
        .get::<_, Option<String>>(1)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let linked_reservation_id = if let Some(reservation_ref_value) = reservation_ref.as_ref() {
        let parsed_reservation_id = reservation_ref_value
            .parse::<i64>()
            .map_err(|_| "reservation_ref는 예약 ID(숫자)여야 합니다.".to_string())?;
        if parsed_reservation_id <= 0 {
            return Err("reservation_ref는 1 이상의 예약 ID여야 합니다.".to_string());
        }

        let reservation_exists = client
            .query_opt(
                r#"
                SELECT 1
                  FROM reservation_calendar_management
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&parsed_reservation_id, &store_code],
            )
            .await
            .map_err(|e| format!("취소 연동 예약 조회 실패: {e}"))?;

        if reservation_exists.is_none() {
            return Err("연동된 예약 데이터가 존재하지 않습니다.".to_string());
        }

        Some(parsed_reservation_id)
    } else {
        None
    };

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("취소 처리 트랜잭션 시작 실패: {e}"))?;

    let affected = tx
        .execute(
            r#"
            UPDATE sales_settlement_management
               SET status = 'CANCELLED',
                   cancel_type = $3,
                   cancel_reason = $4,
                   cancelled_at = NOW(),
                   updated_at = NOW()
             WHERE settlement_id = $1
               AND store_code = $2
            "#,
            &[&payload.settlement_id, &store_code, &cancel_type, &cancel_reason],
        )
        .await
        .map_err(|e| format!("정산 취소 처리 실패: {e}"))?;

    if affected == 0 {
        return Err("취소 대상 정산 데이터가 없습니다.".to_string());
    }

    if current_status == "COMPLETED" {
        restore_sales_settlement_coupon_usage(&tx, &store_code, payload.settlement_id).await?;
    }

    if let Some(reservation_id) = linked_reservation_id {
        let affected = tx
            .execute(
                r#"
                UPDATE reservation_calendar_management
                   SET status_code = 'CANCELLED',
                       updated_at = NOW()
                 WHERE reservation_id = $1
                   AND store_code = $2
                "#,
                &[&reservation_id, &store_code],
            )
            .await
            .map_err(|e| format!("예약 취소 상태 동기화 실패: {e}"))?;

        if affected == 0 {
            return Err("예약 상태를 갱신할 대상 예약이 없습니다.".to_string());
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("취소 처리 트랜잭션 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: if cancel_type == "PAYMENT" {
            "결제취소 완료".to_string()
        } else {
            "시술취소 완료".to_string()
        },
    })
}

#[tauri::command]
async fn delete_sales_settlement(
    payload: DeleteSalesSettlementPayload,
) -> Result<MutationResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    if payload.settlement_id <= 0 {
        return Err("삭제할 settlement_id가 올바르지 않습니다.".to_string());
    }

    let affected = client
        .execute(
            "DELETE FROM sales_settlement_management WHERE settlement_id = $1 AND store_code = $2",
            &[&payload.settlement_id, &store_code],
        )
        .await
        .map_err(|e| format!("정산 삭제 실패: {e}"))?;

    if affected == 0 {
        return Err("삭제 대상 정산 데이터가 없습니다.".to_string());
    }

    Ok(MutationResult {
        success: true,
        message: "시술 정산 삭제 완료".to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            test_db_connection,
            run_db_integrity_check,
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
            get_service_catalog_data,
            upsert_service_catalog_item,
            delete_service_catalog_item,
            get_reservation_calendar_data,
            upsert_reservation_calendar_item,
            delete_reservation_calendar_item,
            get_member_point_management_data,
            recharge_member_point,
            cancel_member_point_recharge,
            use_member_point,
            get_sales_settlement_data,
            upsert_sales_settlement,
            cancel_sales_settlement,
            delete_sales_settlement,
            get_user_management_data,
            upsert_user_management,
            delete_user_management
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
