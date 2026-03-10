// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{NaiveDate, NaiveTime, Utc};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tokio_postgres::{Client, NoTls};

const DEFAULT_SYSTEM_TYPE_CODE: &str = "ALL";
const SYSTEM_TYPE_GROUP_ID: &str = "SYSTEM_TYPE";
const DEFAULT_STORE_CODE: &str = "HAIR_001";
const STORE_CODE_GROUP_ID: &str = "STR_CD";
const STORE_BINDING_DENIED_MESSAGE: &str = "인증이 거부 되었습니다.";
const LOCAL_MIGRATION_CACHE_DIR: &str = "GovDataManagement";
const RESERVATION_STORE_CODE_MIGRATION_ID: &str = "reservation_store_code_migration_v1";
const FULL_DB_INTEGRITY_CHECK_ID: &str = "full_db_integrity_check_v2";
const SALES_COUPON_USAGE_MEMO_PREFIX: &str = "__SETTLEMENT_COUPON_USAGE__";
const SALES_BALANCE_USAGE_MEMO_PREFIX: &str = "__SETTLEMENT_BALANCE_USAGE__";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Default)]
struct LocalMigrationCache {
    checked_keys: HashSet<String>,
}

static LOCAL_MIGRATION_CACHE: OnceLock<Mutex<LocalMigrationCache>> = OnceLock::new();
static DB_INTEGRITY_CHECK_MODE: AtomicBool = AtomicBool::new(false);
static HOST_NAME_CACHE: OnceLock<String> = OnceLock::new();
static CPU_ID_CACHE: OnceLock<String> = OnceLock::new();
static HWID_CACHE: OnceLock<String> = OnceLock::new();

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

#[derive(Debug, Deserialize)]
struct DatabaseBackupPayload {
    connection: DbConnectionPayload,
    target_path: String,
}

#[derive(Debug, Serialize)]
struct DatabaseBackupResult {
    success: bool,
    message: String,
    output_path: String,
    table_count: usize,
    generated_at: String,
}

#[derive(Debug, Deserialize)]
struct ExportTextFilePayload {
    file_name: String,
    content: String,
    sub_dir: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExportTextFileResult {
    success: bool,
    cancelled: bool,
    message: String,
    output_path: Option<String>,
    bytes: usize,
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
    is_start_menu: Option<bool>,
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
    is_start_menu: bool,
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
struct ReservationMutationResult {
    success: bool,
    message: String,
    reservation_id: i64,
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
struct StoreBindingStatusPayload {
    connection: DbConnectionPayload,
}

#[derive(Debug, Serialize)]
struct StoreBindingStatusResult {
    success: bool,
    message: String,
    hwid: String,
    cpu_id: String,
    bound_store_code: Option<String>,
    registered_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VerifyStoreBindingPayload {
    connection: DbConnectionPayload,
    store_code: String,
    cdkey: String,
}

#[derive(Debug, Serialize)]
struct VerifyStoreBindingResult {
    success: bool,
    message: String,
    store_code: String,
    hwid: String,
    cpu_id: String,
    registered_at: String,
    is_new_registration: bool,
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
    email: Option<String>,
    gender: Option<String>,
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
    email: Option<String>,
    gender: Option<String>,
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
    email: Option<String>,
    gender: Option<String>,
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
    email: Option<String>,
    gender: Option<String>,
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
    gender: Option<String>,
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
    gender: Option<String>,
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
    include_histories: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct MemberPointRechargePayload {
    user_id: i64,
    recharge_type: String,
    amount: Option<i64>,
    received_amount: Option<i64>,
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
    received_amount: Option<i64>,
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
    member_user_id: Option<String>,
    manager_employee_id: i64,
    service_ids: Vec<i64>,
    payments: Vec<SalesSettlementPaymentPayload>,
    status: String,
    reservation_ref: Option<String>,
    guest_customer_name: Option<String>,
    guest_customer_phone: Option<String>,
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
struct ResetSalonDataPayload {
    connection: DbConnectionPayload,
    store_code: Option<String>,
    target: String,
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
    member_user_id: Option<String>,
    manager_employee_id: i64,
    service_ids: Vec<i64>,
    total_amount: i64,
    total_time_minutes: i32,
    payments: Vec<SalesSettlementPaymentDto>,
    status: String,
    reservation_ref: Option<String>,
    guest_customer_name: Option<String>,
    guest_customer_phone: Option<String>,
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

#[derive(Debug, Clone, Copy)]
enum ResetSalonDataTarget {
    Sales,
    Reservation,
    ServiceCatalog,
    Member,
    Employee,
    MemberPoint,
    PointUsageHistory,
}

impl ResetSalonDataTarget {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_uppercase().as_str() {
            "SALES" | "SALES_DATA" => Ok(Self::Sales),
            "RESERVATION" | "RESERVATION_DATA" => Ok(Self::Reservation),
            "SERVICE_CATALOG" | "SERVICE_DATA" => Ok(Self::ServiceCatalog),
            "MEMBER" | "MEMBER_DATA" => Ok(Self::Member),
            "EMPLOYEE" | "EMPLOYEE_DATA" => Ok(Self::Employee),
            "MEMBER_POINT" | "MEMBER_POINT_DATA" => Ok(Self::MemberPoint),
            "POINT_USAGE_HISTORY" | "POINT_USAGE_HISTORY_DATA" => Ok(Self::PointUsageHistory),
            _ => Err(format!(
                "지원하지 않는 초기화 대상입니다: {value} (SALES, RESERVATION, SERVICE_CATALOG, MEMBER, EMPLOYEE, MEMBER_POINT, POINT_USAGE_HISTORY)"
            )),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Sales => "매출데이터",
            Self::Reservation => "예약데이터",
            Self::ServiceCatalog => "시술항목 데이터",
            Self::Member => "회원데이터",
            Self::Employee => "직원데이터",
            Self::MemberPoint => "회원포인트 데이터",
            Self::PointUsageHistory => "포인트사용내역 데이터",
        }
    }
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

fn normalize_phone_digits(value: &str) -> String {
    value.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

async fn resolve_member_snapshot_by_identifier(
    client: &Client,
    store_code: &str,
    identifier: &str,
) -> Result<Option<(i64, String, Option<String>)>, String> {
    let trimmed = identifier.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        let member_by_id = client
            .query_opt(
                r#"
                SELECT user_id::BIGINT, name, phone
                  FROM user_management
                 WHERE store_code = $1
                   AND user_id::TEXT = $2
                 LIMIT 1
                "#,
                &[&store_code, &trimmed],
            )
            .await
            .map_err(|e| format!("회원 ID 조회 실패: {e}"))?;

        if let Some(row) = member_by_id {
            return Ok(Some((
                row.get::<_, i64>(0),
                row.get::<_, String>(1),
                row.get::<_, Option<String>>(2),
            )));
        }
    }

    let member_by_phone_or_name = client
        .query_opt(
            r#"
            SELECT user_id::BIGINT, name, phone
              FROM user_management
             WHERE store_code = $1
               AND (
                    LOWER(BTRIM(name)) = LOWER(BTRIM($2))
                    OR BTRIM(COALESCE(phone, '')) = BTRIM($2)
               )
             ORDER BY user_id ASC
             LIMIT 1
            "#,
            &[&store_code, &trimmed],
        )
        .await
        .map_err(|e| format!("회원 식별자 조회 실패: {e}"))?;

    if let Some(row) = member_by_phone_or_name {
        return Ok(Some((
            row.get::<_, i64>(0),
            row.get::<_, String>(1),
            row.get::<_, Option<String>>(2),
        )));
    }

    let digits = normalize_phone_digits(trimmed);
    if digits.len() < 7 {
        return Ok(None);
    }

    let member_by_phone_digits = client
        .query_opt(
            r#"
            SELECT user_id::BIGINT, name, phone
              FROM user_management
             WHERE store_code = $1
               AND REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g') = $2
             ORDER BY user_id ASC
             LIMIT 1
            "#,
            &[&store_code, &digits],
        )
        .await
        .map_err(|e| format!("회원 전화번호 조회 실패: {e}"))?;

    Ok(member_by_phone_digits.map(|row| {
        (
            row.get::<_, i64>(0),
            row.get::<_, String>(1),
            row.get::<_, Option<String>>(2),
        )
    }))
}

fn sanitize_hardware_token(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }
    let sanitized: String = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
        .collect();
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized.to_uppercase())
    }
}

fn extract_non_empty_lines(raw: &str) -> Vec<String> {
    raw.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect()
}

fn run_command_output(command: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(command);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    if stdout.trim().is_empty() {
        return None;
    }
    Some(stdout)
}

fn read_windows_machine_guid() -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    let raw = run_command_output(
        "reg",
        &[
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ],
    )?;

    let lines = extract_non_empty_lines(&raw);
    for line in lines {
        if !line.to_ascii_uppercase().contains("MACHINEGUID") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(last) = parts.last() {
            if let Some(token) = sanitize_hardware_token(last) {
                return Some(token);
            }
        }
    }

    None
}

fn read_windows_wmic_value(alias: &str, column: &str) -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    let output = run_command_output("wmic", &[alias, "get", column])?;
    let lines = extract_non_empty_lines(&output);
    for line in lines {
        if line.eq_ignore_ascii_case(column) {
            continue;
        }
        if let Some(token) = sanitize_hardware_token(&line) {
            return Some(token);
        }
    }
    None
}

fn detect_host_name() -> String {
    HOST_NAME_CACHE
        .get_or_init(|| {
            std::env::var("COMPUTERNAME")
                .ok()
                .and_then(|value| sanitize_hardware_token(&value))
                .or_else(|| {
                    std::env::var("HOSTNAME")
                        .ok()
                        .and_then(|value| sanitize_hardware_token(&value))
                })
                .unwrap_or_else(|| "UNKNOWN_HOST".to_string())
        })
        .clone()
}

fn detect_cpu_id() -> String {
    CPU_ID_CACHE
        .get_or_init(|| {
            read_windows_wmic_value("cpu", "ProcessorId")
                .or_else(|| {
                    std::env::var("PROCESSOR_IDENTIFIER")
                        .ok()
                        .and_then(|value| sanitize_hardware_token(&value))
                })
                .unwrap_or_else(|| "UNKNOWN_CPU".to_string())
        })
        .clone()
}

fn detect_hwid() -> String {
    HWID_CACHE
        .get_or_init(|| {
            let machine_guid = read_windows_machine_guid();
            let uuid = read_windows_wmic_value("csproduct", "UUID");
            let cpu_id = detect_cpu_id();
            let host = detect_host_name();

            let mut parts: Vec<String> = Vec::new();
            if let Some(value) = machine_guid {
                parts.push(format!("MG:{value}"));
            }
            if let Some(value) = uuid {
                parts.push(format!("UUID:{value}"));
            }
            parts.push(format!("CPU:{cpu_id}"));
            parts.push(format!("HOST:{host}"));

            let mut joined = parts.join("|");
            if joined.len() > 500 {
                joined.truncate(500);
            }
            joined
        })
        .clone()
}

async fn ensure_store_binding_table(client: &Client) -> Result<(), String> {
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS security_store_binding (
                id BIGSERIAL PRIMARY KEY,
                store_code VARCHAR(100) NOT NULL,
                hwid VARCHAR(500) NOT NULL,
                cpu_id VARCHAR(255) NOT NULL,
                host_name VARCHAR(255) NOT NULL,
                status CHAR(1) NOT NULL DEFAULT 'Y' CHECK (status IN ('Y', 'N')),
                registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                -- 동일 장치에서 CDKEY 기반 다중 등록을 허용한다.
                -- 무결성은 CDKEY 1회성 사용 정책으로 보장한다.
                CHECK (BTRIM(hwid) <> '')
            );

            ALTER TABLE security_store_binding
            ADD COLUMN IF NOT EXISTS status CHAR(1);

            UPDATE security_store_binding
               SET status = 'Y'
             WHERE status IS NULL
                OR BTRIM(status) = ''
                OR UPPER(BTRIM(status)) NOT IN ('Y', 'N');

            UPDATE security_store_binding
               SET status = UPPER(BTRIM(status))
             WHERE status IS NOT NULL;

            ALTER TABLE security_store_binding
            ALTER COLUMN status SET DEFAULT 'Y';

            ALTER TABLE security_store_binding
            ALTER COLUMN status SET NOT NULL;

            ALTER TABLE security_store_binding
            DROP CONSTRAINT IF EXISTS security_store_binding_status_check;

            ALTER TABLE security_store_binding
            DROP CONSTRAINT IF EXISTS security_store_binding_store_code_key;

            DROP INDEX IF EXISTS security_store_binding_store_code_key;

            DROP INDEX IF EXISTS uq_security_store_binding_store_code;

            ALTER TABLE security_store_binding
            DROP CONSTRAINT IF EXISTS security_store_binding_hwid_key;

            DROP INDEX IF EXISTS security_store_binding_hwid_key;

            DROP INDEX IF EXISTS uq_security_store_binding_hwid;

            ALTER TABLE security_store_binding
            ADD CONSTRAINT security_store_binding_status_check
            CHECK (status IN ('Y', 'N'));

            CREATE INDEX IF NOT EXISTS idx_security_store_binding_verified
            ON security_store_binding (last_verified_at DESC);

            CREATE INDEX IF NOT EXISTS idx_security_store_binding_status
            ON security_store_binding (status);

            CREATE INDEX IF NOT EXISTS idx_security_store_binding_hwid
            ON security_store_binding (hwid);

            CREATE INDEX IF NOT EXISTS idx_security_store_binding_hwid_store
            ON security_store_binding (hwid, store_code, status);
            "#,
        )
        .await
        .map_err(|e| format!("보안 인증 테이블 생성 실패: {e}"))?;

    ensure_cdkey_table(client).await?;
    Ok(())
}

async fn ensure_cdkey_table(client: &Client) -> Result<(), String> {
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS security_cdkey (
                id BIGSERIAL PRIMARY KEY,
                cdkey VARCHAR(64) NOT NULL UNIQUE,
                use_yn CHAR(1) NOT NULL DEFAULT 'N' CHECK (use_yn IN ('Y', 'N')),
                security_store_binding_id BIGINT NULL REFERENCES security_store_binding(id) ON DELETE SET NULL,
                issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                used_at TIMESTAMPTZ NULL
            );

            ALTER TABLE security_cdkey
            ADD COLUMN IF NOT EXISTS use_yn CHAR(1);

            UPDATE security_cdkey
               SET use_yn = 'N'
             WHERE use_yn IS NULL
                OR BTRIM(use_yn) = ''
                OR UPPER(BTRIM(use_yn)) NOT IN ('Y', 'N');

            UPDATE security_cdkey
               SET use_yn = UPPER(BTRIM(use_yn))
             WHERE use_yn IS NOT NULL;

            ALTER TABLE security_cdkey
            ALTER COLUMN use_yn SET DEFAULT 'N';

            ALTER TABLE security_cdkey
            ALTER COLUMN use_yn SET NOT NULL;

            ALTER TABLE security_cdkey
            DROP CONSTRAINT IF EXISTS security_cdkey_use_yn_check;

            ALTER TABLE security_cdkey
            ADD CONSTRAINT security_cdkey_use_yn_check
            CHECK (use_yn IN ('Y', 'N'));

            ALTER TABLE security_cdkey
            ADD COLUMN IF NOT EXISTS security_store_binding_id BIGINT;

            ALTER TABLE security_cdkey
            DROP CONSTRAINT IF EXISTS security_cdkey_security_store_binding_id_fkey;

            ALTER TABLE security_cdkey
            ADD CONSTRAINT security_cdkey_security_store_binding_id_fkey
            FOREIGN KEY (security_store_binding_id) REFERENCES security_store_binding(id) ON DELETE SET NULL;

            ALTER TABLE security_cdkey
            ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

            UPDATE security_cdkey
               SET issued_at = NOW()
             WHERE issued_at IS NULL;

            ALTER TABLE security_cdkey
            ALTER COLUMN issued_at SET DEFAULT NOW();

            ALTER TABLE security_cdkey
            ALTER COLUMN issued_at SET NOT NULL;

            ALTER TABLE security_cdkey
            ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

            UPDATE security_cdkey
               SET used_at = NOW()
             WHERE use_yn = 'Y'
               AND security_store_binding_id IS NOT NULL
               AND used_at IS NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS uq_security_cdkey_binding_id
            ON security_cdkey (security_store_binding_id)
            WHERE security_store_binding_id IS NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_security_cdkey_use_yn
            ON security_cdkey (use_yn, issued_at DESC);
            "#,
        )
        .await
        .map_err(|e| format!("CDKEY 테이블 생성 실패: {e}"))?;

    let mut attempt = 0;
    loop {
        let current_count = client
            .query_one("SELECT COUNT(1)::BIGINT FROM security_cdkey", &[])
            .await
            .map_err(|e| format!("CDKEY 개수 조회 실패: {e}"))?
            .get::<_, i64>(0);

        if current_count >= 20 {
            break;
        }

        let missing = (20_i64 - current_count) as i32;
        client
            .execute(
                r#"
                WITH seeds AS (
                    SELECT UPPER(SUBSTRING(md5(random()::TEXT || clock_timestamp()::TEXT || g::TEXT) FROM 1 FOR 16)) AS raw
                      FROM generate_series(1, $1::INT) AS g
                )
                INSERT INTO security_cdkey (cdkey)
                SELECT CONCAT(
                           SUBSTRING(raw FROM 1 FOR 4), '-',
                           SUBSTRING(raw FROM 5 FOR 4), '-',
                           SUBSTRING(raw FROM 9 FOR 4), '-',
                           SUBSTRING(raw FROM 13 FOR 4)
                       )
                  FROM seeds
                ON CONFLICT (cdkey) DO NOTHING
                "#,
                &[&missing],
            )
            .await
            .map_err(|e| format!("CDKEY 자동 생성 실패: {e}"))?;

        attempt += 1;
        if attempt > 10 {
            return Err("CDKEY 20개 자동 생성에 실패했습니다. 다시 시도해 주세요.".to_string());
        }
    }

    Ok(())
}

async fn validate_store_code_in_str_cd(client: &Client, code: &str) -> Result<(), String> {
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

async fn validate_store_code(client: &Client, code: &str) -> Result<(), String> {
    if code == DEFAULT_STORE_CODE {
        return Ok(());
    }

    validate_store_code_in_str_cd(client, code).await
}

async fn assert_store_binding(client: &Client, store_code: &str) -> Result<(), String> {
    ensure_store_binding_table(client).await?;

    let hwid = detect_hwid();
    let cpu_id = detect_cpu_id();
    let host_name = detect_host_name();

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
            SELECT id, status
              FROM security_store_binding
             WHERE hwid = $1
               AND store_code = $2
             ORDER BY id DESC
             LIMIT 1
            "#,
            &[&hwid, &store_code],
        )
        .await
        .map_err(|e| format!("보안 인증 조회 실패: {e}"))?;

    let Some(row) = row else {
        return Err(format!(
            "현재 PC는 점포코드 {store_code} 로 인증이 되어있지 않습니다. 프로그램 시작 시 점포코드와 CDKEY를 등록해 주세요."
        ));
    };

    let binding_id: i64 = row.get(0);
    let status: String = row.get(1);
    if !status.trim().eq_ignore_ascii_case("Y") {
        return Err(STORE_BINDING_DENIED_MESSAGE.to_string());
    }

    client
        .execute(
            r#"
            UPDATE security_store_binding
               SET cpu_id = $2,
                   host_name = $3,
                   last_verified_at = NOW()
             WHERE id = $1
               AND status = 'Y'
            "#,
            &[&binding_id, &cpu_id, &host_name],
        )
        .await
        .map_err(|e| format!("보안 인증 갱신 실패: {e}"))?;

    Ok(())
}

async fn resolve_store_code(client: &Client, value: Option<&str>) -> Result<String, String> {
    let store_code = normalize_store_code(value);
    validate_store_code(client, &store_code).await?;
    assert_store_binding(client, &store_code).await?;
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
                is_start_menu BOOLEAN NOT NULL DEFAULT FALSE,
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
            ADD COLUMN IF NOT EXISTS is_start_menu BOOLEAN;

            UPDATE menu_management
               SET is_start_menu = FALSE
             WHERE is_start_menu IS NULL;

            ALTER TABLE menu_management
            ALTER COLUMN is_start_menu SET DEFAULT FALSE;

            ALTER TABLE menu_management
            ALTER COLUMN is_start_menu SET NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_menu_management_store_system_start
            ON menu_management (store_code, system_type_code, is_start_menu);

            ALTER TABLE menu_management
            DROP CONSTRAINT IF EXISTS menu_management_menu_path_key;

            CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_management_store_path
            ON menu_management (store_code, menu_path);
            "#,
        )
        .await
        .map_err(|e| format!("menu_management 테이블 생성 실패: {e}"))
}

async fn ensure_menu_start_menu_column(client: &Client) -> Result<(), String> {
    client
        .batch_execute(
            r#"
            ALTER TABLE menu_management
            ADD COLUMN IF NOT EXISTS is_start_menu BOOLEAN;

            UPDATE menu_management
               SET is_start_menu = FALSE
             WHERE is_start_menu IS NULL;

            ALTER TABLE menu_management
            ALTER COLUMN is_start_menu SET DEFAULT FALSE;

            ALTER TABLE menu_management
            ALTER COLUMN is_start_menu SET NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_menu_management_store_system_start
            ON menu_management (store_code, system_type_code, is_start_menu);
            "#,
        )
        .await
        .map_err(|e| format!("menu_management 시작메뉴 컬럼 보정 실패: {e}"))
}

async fn get_next_menu_id(client: &Client) -> Result<i64, String> {
    let row = client
        .query_one(
            "SELECT COALESCE(MAX(menu_id), 0) + 1 FROM menu_management",
            &[],
        )
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
                email VARCHAR(100) UNIQUE,
                gender VARCHAR(20) NULL,
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

            ALTER TABLE employee_management
            ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

            ALTER TABLE employee_management
            ALTER COLUMN email DROP NOT NULL;

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
            email VARCHAR(100) UNIQUE,
            gender VARCHAR(20),
            phone VARCHAR(20),
            address VARCHAR(255),
            remarks TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE user_management
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        ALTER TABLE user_management
        ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

        ALTER TABLE user_management
        ALTER COLUMN email DROP NOT NULL;

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
            gender VARCHAR(20) NULL,
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

        ALTER TABLE reservation_calendar_management
        ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

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
            received_amount BIGINT NULL CHECK (received_amount IS NULL OR received_amount >= 0),
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

        ALTER TABLE member_point_history
        ADD COLUMN IF NOT EXISTS received_amount BIGINT;

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
        .map_err(|e| format!("회원 포인트 테이블 생성 실패: {e}"))?;

    ensure_member_point_recharge_cancel_log_table(client).await?;
    Ok(())
}

async fn ensure_member_point_recharge_cancel_log_table(client: &Client) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    let sql = r#"
        ALTER TABLE member_point_history
        ADD COLUMN IF NOT EXISTS status_code VARCHAR(20);

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
            member_user_id VARCHAR(100) NULL,
            manager_employee_id BIGINT NOT NULL REFERENCES employee_management(employee_id) ON DELETE RESTRICT,
            total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
            total_time_minutes INTEGER NOT NULL CHECK (total_time_minutes >= 0),
            status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'CANCELLED')),
            reservation_ref VARCHAR(100) NULL,
            guest_customer_name VARCHAR(100) NULL,
            guest_customer_phone VARCHAR(30) NULL,
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
        ADD COLUMN IF NOT EXISTS guest_customer_name VARCHAR(100);

        ALTER TABLE sales_settlement_management
        ADD COLUMN IF NOT EXISTS guest_customer_phone VARCHAR(30);

        ALTER TABLE sales_settlement_management
        DROP CONSTRAINT IF EXISTS sales_settlement_management_member_user_id_fkey;

        ALTER TABLE sales_settlement_management
        ALTER COLUMN member_user_id TYPE VARCHAR(100)
        USING member_user_id::TEXT;

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
        *detail_count_map
            .entry(detail.group_id.as_str())
            .or_insert(0) += 1;
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
        return Err(
            "T_CATEGORY 공통코드에 존재하는 사용중 카테고리만 선택할 수 있습니다.".to_string(),
        );
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
                r.gender,
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
                gender: row.get::<_, Option<String>>(4),
                designer_name: row.get::<_, String>(5),
                status: row.get::<_, String>(6),
                note: row.get::<_, Option<String>>(7),
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
) -> Result<ReservationMutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;

    let item = payload.item;
    let reservation_date_text = item.reservation_date.trim().to_string();
    let start_time_text = item.start_time.trim().to_string();
    let customer_name = item.customer_name.trim().to_string();
    let gender = item
        .gender
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| {
            let normalized = value.to_uppercase();
            if normalized == "M" || normalized == "MALE" || normalized == "남" || normalized == "남성" {
                "M".to_string()
            } else if normalized == "F"
                || normalized == "FEMALE"
                || normalized == "여"
                || normalized == "여성"
            {
                "F".to_string()
            } else {
                normalized
            }
        });
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
            return Err(
                "선택한 예약 상태코드가 RESERVATION_STATUS 공통코드에 없습니다.".to_string(),
            );
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
            return Err(
                "예약에 포함된 시술 항목 중 존재하지 않거나 사용중이 아닌 항목이 있습니다."
                    .to_string(),
            );
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
                       gender = $6,
                       designer_name = $7,
                       status_code = $8,
                       note = $9,
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
                    &gender,
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
                gender,
                designer_name,
                status_code,
                note
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING reservation_id::BIGINT
            "#,
            &[
                &store_code,
                &reservation_date,
                &start_time,
                &customer_name,
                &gender,
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

    Ok(ReservationMutationResult {
        success: true,
        message: if is_update {
            "예약 수정 완료".to_string()
        } else {
            "예약 등록 완료".to_string()
        },
        reservation_id,
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

#[tauri::command]
async fn get_member_point_management_data(
    payload: MemberPointQueryPayload,
) -> Result<MemberPointDataResult, String> {
    let client = connect_with_schema(&payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;
    let include_histories = payload.include_histories.unwrap_or(true);

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

    let histories = if include_histories {
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
                    x.received_amount::BIGINT,
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
                            h.received_amount,
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
                            NULL::BIGINT AS received_amount,
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

        history_rows
            .into_iter()
            .map(|row| MemberPointHistoryDto {
                id: row.get::<_, i64>(0),
                action_type: row.get::<_, String>(1),
                user_id: row.get::<_, i64>(2),
                user_name: row.get::<_, String>(3),
                user_phone: row.get::<_, Option<String>>(4),
                recharge_type: row.get::<_, String>(5),
                amount: row.get::<_, Option<i64>>(6),
                received_amount: row.get::<_, Option<i64>>(7),
                service_id: row.get::<_, Option<i64>>(8),
                service_name: row.get::<_, Option<String>>(9),
                coupon_count: row.get::<_, Option<i32>>(10),
                payment_method_code: row.get::<_, String>(11),
                payment_method_name: row.get::<_, String>(12),
                memo: row.get::<_, String>(13),
                created_at: row.get::<_, String>(14),
                is_cancelled: row.get::<_, bool>(15),
                cancel_reason: row.get::<_, Option<String>>(16),
                cancelled_at: row.get::<_, Option<String>>(17),
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

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
        let received_amount = recharge.received_amount.unwrap_or(amount);
        if received_amount < 0 {
            return Err("실수납 금액은 0원 이상이어야 합니다.".to_string());
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
        let received_amount_option: Option<i64> = Some(received_amount);
        let none_service_id: Option<i64> = None;
        let none_coupon_count: Option<i32> = None;
        tx.execute(
            r#"
            INSERT INTO member_point_history (
                store_code, user_id, recharge_type, amount, received_amount, service_id, coupon_count, payment_method_code, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &recharge.user_id,
                &recharge_type,
                &amount_option,
                &received_amount_option,
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
        if amount < 0 {
            return Err("쿠폰 충전 수납 금액은 0원 이상이어야 합니다.".to_string());
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
        let none_received_amount: Option<i64> = None;
        let service_id_option: Option<i64> = Some(service_id);
        let coupon_count_option: Option<i32> = Some(coupon_count);
        tx.execute(
            r#"
            INSERT INTO member_point_history (
                store_code, user_id, recharge_type, amount, received_amount, service_id, coupon_count, payment_method_code, memo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
            &[
                &store_code,
                &recharge.user_id,
                &recharge_type,
                &amount_option,
                &none_received_amount,
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
                s.member_user_id,
                s.manager_employee_id::BIGINT,
                s.total_amount::BIGINT,
                s.total_time_minutes::INTEGER,
                s.status,
                s.reservation_ref,
                s.guest_customer_name,
                s.guest_customer_phone,
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
                member_user_id: row.get::<_, Option<String>>(2),
                manager_employee_id: row.get::<_, i64>(3),
                total_amount: row.get::<_, i64>(4),
                total_time_minutes: row.get::<_, i32>(5),
                status: row.get::<_, String>(6),
                reservation_ref: row.get::<_, Option<String>>(7),
                guest_customer_name: row.get::<_, Option<String>>(8),
                guest_customer_phone: row.get::<_, Option<String>>(9),
                cancel_type: row.get::<_, Option<String>>(10),
                cancel_reason: row.get::<_, Option<String>>(11),
                cancelled_at: row.get::<_, Option<String>>(12),
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

fn build_sales_balance_usage_memo(settlement_id: i64, line_no: i32) -> String {
    format!("{SALES_BALANCE_USAGE_MEMO_PREFIX}{settlement_id}:{line_no}")
}

fn build_sales_balance_usage_memo_pattern(settlement_id: i64) -> String {
    format!("{SALES_BALANCE_USAGE_MEMO_PREFIX}{settlement_id}:%")
}

fn is_sales_balance_payment_code(code: &str) -> bool {
    code == "PREPAID" || code == "MEMBERSHIP"
}

async fn restore_sales_settlement_balance_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
) -> Result<(), String> {
    let memo_pattern = build_sales_balance_usage_memo_pattern(settlement_id);
    let usage_rows = tx
        .query(
            r#"
            SELECT
                id::BIGINT,
                user_id::BIGINT,
                COALESCE(amount, 0)::BIGINT
              FROM member_point_usage_history
             WHERE store_code = $1
               AND use_type = 'BALANCE'
               AND memo LIKE $2
             ORDER BY id
             FOR UPDATE
            "#,
            &[&store_code, &memo_pattern],
        )
        .await
        .map_err(|e| format!("정산 충전금 사용 이력 조회 실패: {e}"))?;

    for row in usage_rows {
        let usage_id = row.get::<_, i64>(0);
        let user_id = row.get::<_, i64>(1);
        let amount = row.get::<_, i64>(2);
        if amount <= 0 {
            return Err(format!(
                "정산 충전금 사용 이력의 금액 정보가 올바르지 않습니다. (usage_id={usage_id})"
            ));
        }

        tx.execute(
            r#"
            INSERT INTO member_point_balance (store_code, user_id, point_balance)
            VALUES ($1,$2,$3)
            ON CONFLICT (store_code, user_id)
            DO UPDATE SET
                point_balance = member_point_balance.point_balance + EXCLUDED.point_balance,
                updated_at = NOW()
            "#,
            &[&store_code, &user_id, &amount],
        )
        .await
        .map_err(|e| format!("정산 충전금 원복 처리 실패: {e}"))?;
    }

    tx.execute(
        r#"
        DELETE FROM member_point_usage_history
         WHERE store_code = $1
           AND use_type = 'BALANCE'
           AND memo LIKE $2
        "#,
        &[&store_code, &memo_pattern],
    )
    .await
    .map_err(|e| format!("정산 충전금 사용 이력 정리 실패: {e}"))?;

    Ok(())
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
        let service_id = row.get::<_, Option<i64>>(2).ok_or_else(|| {
            format!("정산 쿠폰 사용 이력의 시술 정보가 없습니다. (usage_id={usage_id})")
        })?;
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

async fn apply_sales_settlement_balance_usage(
    tx: &tokio_postgres::Transaction<'_>,
    store_code: &str,
    settlement_id: i64,
    member_user_id: i64,
    balance_usage_lines: &[(i32, i64)],
) -> Result<(), String> {
    for (line_no, amount) in balance_usage_lines {
        if *amount <= 0 {
            return Err("충전금 사용 금액은 1원 이상이어야 합니다.".to_string());
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
                &[&store_code, &member_user_id, amount],
            )
            .await
            .map_err(|e| format!("정산 충전금 차감 처리 실패: {e}"))?;

        if affected == 0 {
            return Err("충전 잔액이 부족하여 결제완료 처리할 수 없습니다.".to_string());
        }

        let use_type = "BALANCE".to_string();
        let amount_option: Option<i64> = Some(*amount);
        let none_service_id: Option<i64> = None;
        let none_coupon_count: Option<i32> = None;
        let memo = build_sales_balance_usage_memo(settlement_id, *line_no);

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
                &none_service_id,
                &none_coupon_count,
                &memo,
            ],
        )
        .await
        .map_err(|e| format!("정산 충전금 사용 이력 저장 실패: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn upsert_sales_settlement(
    payload: UpsertSalesSettlementPayload,
) -> Result<MutationResult, String> {
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

    let mut member_identifier = settlement
        .member_user_id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut resolved_member_user_id: Option<i64> = None;
    let mut member_snapshot_name: Option<String> = None;
    let mut member_snapshot_phone: Option<String> = None;

    if let Some(identifier) = member_identifier.as_deref() {
        if let Some((member_user_id, member_name, member_phone)) =
            resolve_member_snapshot_by_identifier(&client, &store_code, identifier).await?
        {
            resolved_member_user_id = Some(member_user_id);
            member_snapshot_name = Some(member_name.trim().to_string()).filter(|value| !value.is_empty());
            member_snapshot_phone = member_phone
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());

            // 회원 정산은 member_user_id 컬럼에 회원 전화번호(없으면 이름)를 저장한다.
            member_identifier = member_snapshot_phone
                .clone()
                .or_else(|| member_snapshot_name.clone());
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
    let mut selected_service_count_map = HashMap::<i64, i32>::new();
    for service_id in &settlement.service_ids {
        *selected_service_count_map.entry(*service_id).or_insert(0) += 1;
    }
    let mut coupon_usage_count_map = HashMap::<i64, i32>::new();

    for payment in &settlement.payments {
        let code = payment.payment_method_code.trim().to_uppercase();
        if code.is_empty() {
            return Err("결제수단 코드는 필수입니다.".to_string());
        }
        let Some(method_name) = payment_method_map.get(&code) else {
            return Err(
                "PAYMENT_METHOD 공통코드에 등록된 사용중 결제수단만 사용할 수 있습니다."
                    .to_string(),
            );
        };

        if payment.amount < 0 {
            return Err("결제 금액은 0 이상이어야 합니다.".to_string());
        }
        if resolved_member_user_id.is_none()
            && (is_sales_balance_payment_code(&code) || code == "COUPON")
        {
            return Err(
                "일반 방문객은 MEMBERSHIP/PREPAID 또는 COUPON 결제를 사용할 수 없습니다."
                    .to_string(),
            );
        }

        let coupon_service_id = if code == "COUPON" {
            let Some(coupon_service_id) = payment.coupon_service_id else {
                return Err("COUPON 결제 시 coupon_service_id는 필수입니다.".to_string());
            };
            if coupon_service_id <= 0 {
                return Err("coupon_service_id는 1 이상이어야 합니다.".to_string());
            }
            let selected_count = selected_service_count_map
                .get(&coupon_service_id)
                .copied()
                .unwrap_or(0);
            if selected_count <= 0 {
                return Err(
                    "쿠폰 결제 시술은 이번 정산의 시술 항목에 포함되어야 합니다.".to_string(),
                );
            }
            let next_coupon_count = coupon_usage_count_map
                .entry(coupon_service_id)
                .and_modify(|count| *count += 1)
                .or_insert(1);
            if *next_coupon_count > selected_count {
                return Err(
                    "동일 시술에 대한 쿠폰 사용 횟수가 시술 건수를 초과했습니다.".to_string(),
                );
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

    let mut guest_customer_name = settlement
        .guest_customer_name
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut guest_customer_phone = settlement
        .guest_customer_phone
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if resolved_member_user_id.is_some() {
        // 회원 정산도 고객명/전화번호 스냅샷을 함께 저장해 이름/전화 기반 조회를 지원한다.
        guest_customer_name = member_snapshot_name;
        guest_customer_phone = member_snapshot_phone;
    }

    if let Some(identifier) = member_identifier.as_ref() {
        if identifier.chars().count() > 100 {
            return Err("member_user_id는 100자 이하여야 합니다.".to_string());
        }
    }

    if let Some(name) = guest_customer_name.as_ref() {
        if name.chars().count() > 100 {
            return Err("guest_customer_name은 100자 이하여야 합니다.".to_string());
        }
    }
    if let Some(phone) = guest_customer_phone.as_ref() {
        if phone.chars().count() > 30 {
            return Err("guest_customer_phone은 30자 이하여야 합니다.".to_string());
        }
    }

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

        restore_sales_settlement_balance_usage(&tx, &store_code, settlement_id).await?;
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
                       guest_customer_name = $9,
                       guest_customer_phone = $10,
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
                    &member_identifier,
                    &settlement.manager_employee_id,
                    &total_amount,
                    &total_time_minutes,
                    &status,
                    &reservation_ref,
                    &guest_customer_name,
                    &guest_customer_phone,
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
                guest_customer_name,
                guest_customer_phone,
                cancel_type,
                cancel_reason,
                cancelled_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)
            RETURNING settlement_id::BIGINT
            "#,
            &[
                &store_code,
                &member_identifier,
                &settlement.manager_employee_id,
                &total_amount,
                &total_time_minutes,
                &status,
                &reservation_ref,
                &guest_customer_name,
                &guest_customer_phone,
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
    let balance_usage_lines = insert_payment_lines
        .iter()
        .enumerate()
        .filter_map(|(index, payment)| {
            if is_sales_balance_payment_code(&payment.payment_method_code) && payment.amount > 0 {
                Some(((index + 1) as i32, payment.amount))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if status == "COMPLETED" && (!coupon_usage_lines.is_empty() || !balance_usage_lines.is_empty())
    {
        let Some(member_user_id) = resolved_member_user_id else {
            return Err("회원 충전금/쿠폰 결제는 회원 지정이 필요합니다.".to_string());
        };

        if !balance_usage_lines.is_empty() {
            apply_sales_settlement_balance_usage(
                &tx,
                &store_code,
                settlement_id,
                member_user_id,
                &balance_usage_lines,
            )
            .await?;
        }

        if !coupon_usage_lines.is_empty() {
            apply_sales_settlement_coupon_usage(
                &tx,
                &store_code,
                settlement_id,
                member_user_id,
                &coupon_usage_lines,
            )
            .await?;
        }
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
            &[
                &payload.settlement_id,
                &store_code,
                &cancel_type,
                &cancel_reason,
            ],
        )
        .await
        .map_err(|e| format!("정산 취소 처리 실패: {e}"))?;

    if affected == 0 {
        return Err("취소 대상 정산 데이터가 없습니다.".to_string());
    }

    if current_status == "COMPLETED" {
        restore_sales_settlement_balance_usage(&tx, &store_code, payload.settlement_id).await?;
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

#[tauri::command]
async fn reset_salon_data(payload: ResetSalonDataPayload) -> Result<MutationResult, String> {
    let mut client = connect_with_schema(&payload.connection).await?;
    ensure_sales_settlement_management_tables(&client).await?;
    ensure_reservation_calendar_management_tables(&client, &payload.connection).await?;
    ensure_member_point_management_tables(&client).await?;
    ensure_employee_management_table(&client).await?;
    ensure_user_management_table(&client).await?;
    ensure_service_catalog_management_table(&client).await?;
    let store_code = resolve_store_code(&client, payload.store_code.as_deref()).await?;
    let target = ResetSalonDataTarget::parse(&payload.target)?;

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("초기화 트랜잭션 시작 실패: {e}"))?;

    match target {
        ResetSalonDataTarget::Sales => {
            tx.execute(
                "DELETE FROM sales_settlement_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("매출데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Reservation => {
            tx.execute(
                "DELETE FROM reservation_calendar_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("예약데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::ServiceCatalog => {
            let sales_ref_count = tx
                .query_one(
                    r#"
                    SELECT COUNT(1)::BIGINT
                      FROM sales_settlement_service_line
                     WHERE store_code = $1
                    "#,
                    &[&store_code],
                )
                .await
                .map_err(|e| format!("시술항목 연관 매출 조회 실패: {e}"))?
                .get::<_, i64>(0);
            let reservation_ref_count = tx
                .query_one(
                    r#"
                    SELECT COUNT(1)::BIGINT
                      FROM reservation_calendar_service_line
                     WHERE store_code = $1
                    "#,
                    &[&store_code],
                )
                .await
                .map_err(|e| format!("시술항목 연관 예약 조회 실패: {e}"))?
                .get::<_, i64>(0);

            if sales_ref_count > 0 || reservation_ref_count > 0 {
                return Err(format!(
                    "시술항목 초기화 전 연관 데이터를 먼저 정리해야 합니다. 매출건수: {sales_ref_count}, 예약건수: {reservation_ref_count} (매출데이터/예약데이터 초기화 후 다시 시도하세요.)"
                ));
            }

            tx.execute(
                "DELETE FROM service_catalog_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("시술항목 데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Member => {
            tx.execute(
                "DELETE FROM user_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::Employee => {
            let sales_ref_count = tx
                .query_one(
                    r#"
                    SELECT COUNT(1)::BIGINT
                      FROM sales_settlement_management
                     WHERE store_code = $1
                    "#,
                    &[&store_code],
                )
                .await
                .map_err(|e| format!("직원 연관 매출 조회 실패: {e}"))?
                .get::<_, i64>(0);

            if sales_ref_count > 0 {
                return Err(format!(
                    "직원데이터 초기화 전 매출데이터를 먼저 초기화해야 합니다. 매출건수: {sales_ref_count}"
                ));
            }

            tx.execute(
                "DELETE FROM employee_management WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("직원데이터 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::MemberPoint => {
            tx.execute(
                "DELETE FROM member_coupon_balance WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원 쿠폰잔액 초기화 실패: {e}"))?;
            tx.execute(
                "DELETE FROM member_point_balance WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원 포인트잔액 초기화 실패: {e}"))?;
            tx.execute(
                "DELETE FROM member_point_history WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("회원 포인트 충전내역 초기화 실패: {e}"))?;
        }
        ResetSalonDataTarget::PointUsageHistory => {
            tx.execute(
                "DELETE FROM member_point_usage_history WHERE store_code = $1",
                &[&store_code],
            )
            .await
            .map_err(|e| format!("포인트사용내역 초기화 실패: {e}"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("데이터 초기화 커밋 실패: {e}"))?;

    Ok(MutationResult {
        success: true,
        message: format!("{} 초기화 완료", target.label()),
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            test_db_connection,
            backup_database_to_file,
            export_text_file,
            run_db_integrity_check,
            get_store_binding_status,
            verify_or_register_store_binding,
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
            delete_user_management,
            reset_salon_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

