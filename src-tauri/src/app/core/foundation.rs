/**
 * @file foundation.rs
 * @description 애플리케이션의 공용 기반 코드, 전역 상태 관리, 데이터베이스 연결 유틸리티 및 스키마 무결성 점검 로직을 포함하는 핵심 파일입니다.
 */

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tokio_postgres::{Client, NoTls};

// 앱 전반에서 사용하는 기본 상수값 및 식별자 정의
pub const DEFAULT_SYSTEM_TYPE_CODE: &str = "ALL";                // 기본 시스템 타입 코드
pub const SYSTEM_TYPE_GROUP_ID: &str = "SYSTEM_TYPE";           // 시스템 타입 공통코드 그룹 ID
pub const DEFAULT_STORE_CODE: &str = "HAIR_001";                // 기본 매장 코드
pub const STORE_CODE_GROUP_ID: &str = "STR_CD";                  // 매장 코드 공통코드 그룹 ID
pub const STORE_BINDING_DENIED_MESSAGE: &str = "인증이 거부 되었습니다."; // 보안 인증 거부 메시지
pub const LOCAL_MIGRATION_CACHE_DIR: &str = "GovDataManagement";   // 로컬 캐시 저장 디렉토리명
pub const RESERVATION_STORE_CODE_MIGRATION_ID: &str = "reservation_store_code_migration_v2"; // 예약 마이그레이션 식별자
pub const FULL_DB_INTEGRITY_CHECK_ID: &str = "full_db_integrity_check_v2"; // 전체 무결성 검사 식별자
pub const SALES_COUPON_USAGE_MEMO_PREFIX: &str = "__SETTLEMENT_COUPON_USAGE__"; // 매출 쿠폰 사용 메모 접두사
pub const SALES_BALANCE_USAGE_MEMO_PREFIX: &str = "__SETTLEMENT_BALANCE_USAGE__"; // 매출 잔액 사용 메모 접두사

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000; // 윈도우에서 콘솔 창 없이 명령 실행하기 위한 플래그

// 로컬 마이그레이션 점검 여부를 캐시하는 구조체입니다.
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct LocalMigrationCache {
    pub checked_keys: HashSet<String>,
}

// 런타임에 결정되는 전역 상태 및 캐시 정보
pub static LOCAL_MIGRATION_CACHE: OnceLock<Mutex<LocalMigrationCache>> = OnceLock::new(); // 로컬 마이그레이션 이력 캐시
pub static DB_INTEGRITY_CHECK_MODE: AtomicBool = AtomicBool::new(false);               // DB 무결성 점검 모드 활성화 여부
pub static HOST_NAME_CACHE: OnceLock<String> = OnceLock::new();                        // 호스트명 캐시
pub static CPU_ID_CACHE: OnceLock<String> = OnceLock::new();                           // CPU ID 캐시
pub static HWID_CACHE: OnceLock<String> = OnceLock::new();                              // 하드웨어 고유 ID (HWID) 캐시

// 로컬 캐시 파일 경로를 OS별로 계산합니다.
pub fn migration_cache_file_path() -> PathBuf {
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

pub fn load_local_migration_cache() -> LocalMigrationCache {
    let cache_path = migration_cache_file_path();
    let Ok(raw_json) = fs::read_to_string(cache_path) else {
        return LocalMigrationCache::default();
    };

    serde_json::from_str::<LocalMigrationCache>(&raw_json).unwrap_or_default()
}

pub fn local_migration_cache() -> &'static Mutex<LocalMigrationCache> {
    LOCAL_MIGRATION_CACHE.get_or_init(|| Mutex::new(load_local_migration_cache()))
}

pub fn persist_local_migration_cache(cache: &LocalMigrationCache) -> Result<(), String> {
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

// 예약 store_code 마이그레이션 중복 수행 방지 키입니다.
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

pub fn is_local_migration_checked(key: &str) -> bool {
    match local_migration_cache().lock() {
        Ok(cache) => cache.checked_keys.contains(key),
        Err(poisoned) => {
            let cache = poisoned.into_inner();
            cache.checked_keys.contains(key)
        }
    }
}

pub fn mark_local_migration_checked(key: &str) {
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

pub fn build_full_db_integrity_check_key(connection: &DbConnectionPayload) -> String {
    format!(
        "{}::{}::{}::{}::{}",
        FULL_DB_INTEGRITY_CHECK_ID,
        connection.host.trim().to_lowercase(),
        connection.port,
        connection.database.trim().to_lowercase(),
        connection.schema.trim().to_lowercase(),
    )
}

pub fn is_db_integrity_check_mode() -> bool {
    DB_INTEGRITY_CHECK_MODE.load(Ordering::SeqCst)
}

// 무결성 점검 모드를 함수 스코프에서 안전하게 on/off 하기 위한 가드입니다.
pub struct DbIntegrityCheckGuard;

impl Drop for DbIntegrityCheckGuard {
    fn drop(&mut self) {
        DB_INTEGRITY_CHECK_MODE.store(false, Ordering::SeqCst);
    }
}

pub fn enter_db_integrity_check_mode() -> DbIntegrityCheckGuard {
    DB_INTEGRITY_CHECK_MODE.store(true, Ordering::SeqCst);
    DbIntegrityCheckGuard
}

// SQL 로깅을 통일해서 출력하기 위한 헬퍼 함수입니다.
pub fn log_sql_fn(sql: &str, params: Option<String>) {
    if let Some(p) = params {
        println!("[SQL] {} | params: {}", sql, p);
    } else {
        println!("[SQL] {}", sql);
    }
}

// 프론트에서 전달받는 공통 DB 연결 페이로드입니다.
#[derive(Debug, Deserialize, Clone)]
pub struct DbConnectionPayload {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub schema: String,
}

#[derive(Debug, Serialize)]
pub struct DbConnectionResult {
    pub success: bool,
    pub message: String,
    pub current_schema: String,
    pub server_version: String,
}

#[derive(Debug, Deserialize)]
pub struct DbIntegrityCheckPayload {
    pub connection: DbConnectionPayload,
}

#[derive(Debug, Deserialize)]
pub struct DatabaseBackupPayload {
    pub connection: DbConnectionPayload,
    pub target_path: String,
}

#[derive(Debug, Serialize)]
pub struct DatabaseBackupResult {
    pub success: bool,
    pub message: String,
    pub output_path: String,
    pub table_count: usize,
    pub generated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ExportTextFilePayload {
    pub file_name: String,
    pub content: String,
    pub sub_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExportTextFileResult {
    pub success: bool,
    pub cancelled: bool,
    pub message: String,
    pub output_path: Option<String>,
    pub bytes: usize,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MenuNamesPayload {
    pub ko: String,
    pub en: String,
    pub zh: String,
}

#[derive(Debug, Deserialize)]
pub struct MenuRowPayload {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub menu_type: String,
    pub path: String,
    pub system_type_code: Option<String>,
    pub is_start_menu: Option<bool>,
    pub order: i32,
    pub status: String,
    pub names: MenuNamesPayload,
}

#[derive(Debug, Deserialize)]
pub struct SyncMenuPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub menus: Vec<MenuRowPayload>,
}

#[derive(Debug, Serialize)]
pub struct MenuSyncResult {
    pub success: bool,
    pub message: String,
    pub inserted_count: usize,
}

#[derive(Debug, Deserialize)]
pub struct MenuQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub system_type_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertMenuPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub menu: MenuRowPayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteMenuPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub menu_id: i64,
}

#[derive(Debug, Serialize)]
pub struct MenuDto {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub menu_type: String,
    pub path: String,
    pub system_type_code: String,
    pub is_start_menu: bool,
    pub order: i32,
    pub status: String,
    pub names: MenuNamesPayload,
}

#[derive(Debug, Serialize)]
pub struct MenuDataResult {
    pub success: bool,
    pub message: String,
    pub menus: Vec<MenuDto>,
}

#[derive(Debug, Deserialize)]
pub struct CodeGroupPayload {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub display_order: i32,
}

#[derive(Debug, Deserialize)]
pub struct CodeDetailPayload {
    pub group_id: String,
    pub code: String,
    pub name: String,
    pub sort_order: i32,
    pub use_yn: String,
}

#[derive(Debug, Deserialize)]
pub struct SyncCommonCodePayload {
    pub connection: DbConnectionPayload,
    pub groups: Vec<CodeGroupPayload>,
    pub details: Vec<CodeDetailPayload>,
}

#[derive(Debug, Serialize)]
pub struct CommonCodeSyncResult {
    pub success: bool,
    pub message: String,
    pub group_count: usize,
    pub detail_count: usize,
}

#[derive(Debug, Deserialize)]
pub struct CommonCodeQueryPayload {
    pub connection: DbConnectionPayload,
}

#[derive(Debug, Deserialize)]
pub struct UpsertCommonCodeGroupPayload {
    pub connection: DbConnectionPayload,
    pub group: CodeGroupPayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteCommonCodeGroupPayload {
    pub connection: DbConnectionPayload,
    pub group_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UpsertCommonCodeDetailPayload {
    pub connection: DbConnectionPayload,
    pub detail: CodeDetailPayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteCommonCodeDetailPayload {
    pub connection: DbConnectionPayload,
    pub group_id: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct MutationResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ReservationMutationResult {
    pub success: bool,
    pub message: String,
    pub reservation_id: i64,
}

#[derive(Debug, Serialize)]
pub struct CommonCodeGroupDto {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub count: i32,
    pub display_order: i32,
}

#[derive(Debug, Serialize)]
pub struct CommonCodeDetailDto {
    pub group: String,
    pub code: String,
    pub name: String,
    pub order: i32,
    pub use_yn: String,
}

#[derive(Debug, Serialize)]
pub struct CommonCodeDataResult {
    pub success: bool,
    pub message: String,
    pub groups: Vec<CommonCodeGroupDto>,
    pub details: Vec<CommonCodeDetailDto>,
}

#[derive(Debug, Deserialize)]
pub struct StoreBindingStatusPayload {
    pub connection: DbConnectionPayload,
}

#[derive(Debug, Serialize)]
pub struct StoreBindingStatusResult {
    pub success: bool,
    pub message: String,
    pub hwid: String,
    pub cpu_id: String,
    pub bound_store_code: Option<String>,
    pub registered_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyStoreBindingPayload {
    pub connection: DbConnectionPayload,
    pub store_code: String,
    pub cdkey: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyStoreBindingResult {
    pub success: bool,
    pub message: String,
    pub store_code: String,
    pub hwid: String,
    pub cpu_id: String,
    pub registered_at: String,
    pub is_new_registration: bool,
}

#[derive(Debug, Deserialize)]
pub struct RoleQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RoleMenuPermissionQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub role_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RolePayload {
    pub role_id: String,
    pub role_name: String,
    pub role_desc: String,
    pub user_count: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpsertRolePayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub role: RolePayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteRolePayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub role_id: String,
}

#[derive(Debug, Serialize)]
pub struct RoleDto {
    pub role_id: String,
    pub role_name: String,
    pub role_desc: String,
    pub user_count: i32,
}

#[derive(Debug, Serialize)]
pub struct RoleDataResult {
    pub success: bool,
    pub message: String,
    pub roles: Vec<RoleDto>,
}

#[derive(Debug, Deserialize)]
pub struct RoleMenuPermissionPayload {
    pub role_id: String,
    pub menu_id: i64,
    pub can_read: bool,
    pub can_write: bool,
    pub can_delete: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpsertRoleMenuPermissionPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub permission: RoleMenuPermissionPayload,
}

#[derive(Debug, Serialize)]
pub struct RoleMenuPermissionDto {
    pub id: i64,
    pub role_id: String,
    pub menu_id: i64,
    pub menu_name_ko: String,
    pub menu_name_en: String,
    pub menu_name_zh: String,
    pub can_read: bool,
    pub can_write: bool,
    pub can_delete: bool,
}

#[derive(Debug, Serialize)]
pub struct RoleMenuPermissionDataResult {
    pub success: bool,
    pub message: String,
    pub permissions: Vec<RoleMenuPermissionDto>,
}

#[derive(Debug, Deserialize)]
pub struct EmployeePayload {
    pub employee_id: Option<i64>,
    pub employee_name: String,
    pub employee_code: String,
    pub role_id: Option<String>,
    pub email: Option<String>,
    pub gender: Option<String>,
    pub phone: Option<String>,
    pub hire_date: Option<String>,
    pub status: Option<String>,
    pub remarks: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EmployeeQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertEmployeePayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub employee: EmployeePayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteEmployeePayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub employee_id: i64,
}

#[derive(Debug, Serialize)]
pub struct EmployeeDto {
    pub employee_id: i64,
    pub employee_name: String,
    pub employee_code: String,
    pub role_id: Option<String>,
    pub role_name: Option<String>,
    pub email: Option<String>,
    pub gender: Option<String>,
    pub phone: Option<String>,
    pub hire_date: Option<String>,
    pub status: Option<String>,
    pub remarks: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EmployeeDataResult {
    pub success: bool,
    pub message: String,
    pub employees: Vec<EmployeeDto>,
}

#[derive(Debug, Deserialize)]
pub struct UserPayload {
    pub user_id: Option<i64>,
    pub name: String,
    pub email: Option<String>,
    pub gender: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub remarks: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertUserPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub user: UserPayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteUserPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub user_id: i64,
}

#[derive(Debug, Serialize)]
pub struct UserDto {
    pub user_id: i64,
    pub name: String,
    pub email: Option<String>,
    pub gender: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub remarks: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserDataResult {
    pub success: bool,
    pub message: String,
    pub users: Vec<UserDto>,
}

#[derive(Debug, Deserialize)]
pub struct ServiceCatalogItemPayload {
    pub service_id: Option<i64>,
    pub category_code: String,
    pub service_name: String,
    pub unit_price: i64,
    pub duration_minutes: i32,
    pub use_yn: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ServiceCatalogQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertServiceCatalogPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub item: ServiceCatalogItemPayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteServiceCatalogPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub service_id: i64,
}

#[derive(Debug, Serialize)]
pub struct ServiceCatalogItemDto {
    pub service_id: i64,
    pub category_code: String,
    pub category_name: String,
    pub service_name: String,
    pub unit_price: i64,
    pub duration_minutes: i32,
    pub use_yn: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServiceCatalogDataResult {
    pub success: bool,
    pub message: String,
    pub items: Vec<ServiceCatalogItemDto>,
}

#[derive(Debug, Deserialize)]
pub struct ReservationCalendarItemPayload {
    pub reservation_id: Option<i64>,
    pub reservation_date: String,
    pub start_time: String,
    pub customer_name: String,
    pub customer_id: Option<i64>,
    pub customer_phone: Option<String>,
    pub gender: Option<String>,
    pub designer_name: String,
    pub status: String,
    pub note: Option<String>,
    pub service_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ReservationCalendarQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertReservationCalendarPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub item: ReservationCalendarItemPayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteReservationCalendarPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub reservation_id: i64,
}

#[derive(Debug, Serialize)]
pub struct ReservationCalendarServiceDto {
    pub line_id: i64,
    pub service_id: i64,
    pub category_code: String,
    pub category_name: String,
    pub service_name: String,
    pub unit_price: i64,
    pub duration_minutes: i32,
}

#[derive(Debug, Serialize)]
pub struct ReservationCalendarDto {
    pub reservation_id: i64,
    pub reservation_date: String,
    pub start_time: String,
    pub customer_name: String,
    pub customer_id: Option<i64>,
    pub customer_phone: Option<String>,
    pub gender: Option<String>,
    pub designer_name: String,
    pub status: String,
    pub note: Option<String>,
    pub services: Vec<ReservationCalendarServiceDto>,
}

#[derive(Debug, Serialize)]
pub struct ReservationCalendarDataResult {
    pub success: bool,
    pub message: String,
    pub reservations: Vec<ReservationCalendarDto>,
}

#[derive(Debug, Deserialize)]
pub struct MemberPointQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub include_histories: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct MemberPointRechargePayload {
    pub user_id: i64,
    pub recharge_type: String,
    pub amount: Option<i64>,
    pub received_amount: Option<i64>,
    pub service_id: Option<i64>,
    pub coupon_count: Option<i32>,
    pub payment_method_code: String,
    pub memo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RechargeMemberPointPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub recharge: MemberPointRechargePayload,
}

#[derive(Debug, Deserialize)]
pub struct MemberPointUsePayload {
    pub user_id: i64,
    pub use_type: String,
    pub amount: Option<i64>,
    pub service_id: Option<i64>,
    pub coupon_count: Option<i32>,
    pub memo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UseMemberPointPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub usage: MemberPointUsePayload,
}

#[derive(Debug, Deserialize)]
pub struct CancelMemberPointRechargePayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub history_id: i64,
    pub cancel_reason: String,
}

#[derive(Debug, Serialize)]
pub struct MemberPointCouponDto {
    pub service_id: i64,
    pub service_name: String,
    pub count: i32,
}

#[derive(Debug, Serialize)]
pub struct MemberPointMemberDto {
    pub user_id: i64,
    pub user_name: String,
    pub phone: Option<String>,
    pub point_balance: i64,
    pub coupons: Vec<MemberPointCouponDto>,
}

#[derive(Debug, Serialize)]
pub struct MemberPointHistoryDto {
    pub id: i64,
    pub action_type: String,
    pub user_id: i64,
    pub user_name: String,
    pub user_phone: Option<String>,
    pub recharge_type: String,
    pub amount: Option<i64>,
    pub received_amount: Option<i64>,
    pub service_id: Option<i64>,
    pub service_name: Option<String>,
    pub coupon_count: Option<i32>,
    pub payment_method_code: String,
    pub payment_method_name: String,
    pub memo: String,
    pub created_at: String,
    pub is_cancelled: bool,
    pub cancel_reason: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MemberPointDataResult {
    pub success: bool,
    pub message: String,
    pub members: Vec<MemberPointMemberDto>,
    pub histories: Vec<MemberPointHistoryDto>,
}

#[derive(Debug, Deserialize)]
pub struct SalesSettlementQueryPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SalesSettlementPaymentPayload {
    pub payment_method_code: String,
    pub amount: i64,
    pub coupon_service_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SalesSettlementPayload {
    pub settlement_id: Option<i64>,
    pub member_user_id: Option<String>,
    pub manager_employee_id: i64,
    pub service_ids: Vec<i64>,
    pub payments: Vec<SalesSettlementPaymentPayload>,
    pub status: String,
    pub reservation_ref: Option<String>,
    pub guest_customer_name: Option<String>,
    pub guest_customer_phone: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertSalesSettlementPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub settlement: SalesSettlementPayload,
}

#[derive(Debug, Deserialize)]
pub struct DeleteSalesSettlementPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub settlement_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct ResetSalonDataPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub target: String,
}

#[derive(Debug, Deserialize)]
pub struct CancelSalesSettlementPayload {
    pub connection: DbConnectionPayload,
    pub store_code: Option<String>,
    pub settlement_id: i64,
    pub cancel_type: String,
    pub cancel_reason: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SalesSettlementPaymentDto {
    pub payment_method_code: String,
    pub amount: i64,
    pub coupon_service_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SalesSettlementDto {
    pub settlement_id: i64,
    pub settlement_datetime: String,
    pub member_user_id: Option<String>,
    pub manager_employee_id: i64,
    pub service_ids: Vec<i64>,
    pub total_amount: i64,
    pub total_time_minutes: i32,
    pub payments: Vec<SalesSettlementPaymentDto>,
    pub status: String,
    pub reservation_ref: Option<String>,
    pub guest_customer_name: Option<String>,
    pub guest_customer_phone: Option<String>,
    pub cancel_type: Option<String>,
    pub cancel_reason: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SalesSettlementDataResult {
    pub success: bool,
    pub message: String,
    pub settlements: Vec<SalesSettlementDto>,
}

#[derive(Debug, Clone, Copy)]
pub enum ResetSalonDataTarget {
    Sales,
    Reservation,
    ServiceCatalog,
    Member,
    Employee,
    MemberPoint,
    PointUsageHistory,
}

impl ResetSalonDataTarget {
    pub fn parse(value: &str) -> Result<Self, String> {
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

    pub fn label(self) -> &'static str {
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

// SQL 식별자 주입을 막기 위해 스키마명을 이스케이프합니다.
pub fn get_safe_schema(schema: &str) -> Result<String, String> {
    let trimmed = schema.trim();
    if trimmed.is_empty() {
        return Err("스키마 값이 비어 있습니다.".to_string());
    }
    Ok(trimmed.replace('\"', "\"\""))
}

/**
 * @function connect_client
 * @description 데이터베이스 연결 객체를 생성합니다.
 * @param connection DbConnectionPayload: 호스트, 포트, 계정 정보 등 연결 명세
 * @return Result<Client, String>: 성공 시 Postgres 클라이언트 객체 반환
 */
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

/**
 * @function prepare_schema
 * @description 지정된 스키마가 존재하지 않으면 생성하고, 현재 세션의 search_path를 해당 스키마로 변경합니다.
 * @param client &Client: 활성화된 DB 클라이언트
 * @param schema &str: 타겟 스키마명
 */
pub async fn prepare_schema(client: &Client, schema: &str) -> Result<(), String> {
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

/**
 * @function connect_with_schema
 * @description DB 연결과 스키마 준비(Search Path 설정)를 한 번에 수행합니다.
 */
pub async fn connect_with_schema(connection: &DbConnectionPayload) -> Result<Client, String> {
    let client = connect_client(connection).await?;
    prepare_schema(&client, &connection.schema).await?;
    Ok(client)
}

// 입력값 표준화를 통해 도메인 코드/매장코드 검증을 단순화합니다.
/**
 * @function normalize_system_type_code
 * @description 시스템 타입 코드를 대문자로 변환하고 비어있을 경우 기본값(ALL)으로 채워 반환합니다.
 */
pub fn normalize_system_type_code(value: Option<&str>) -> String {
    let normalized = value.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        DEFAULT_SYSTEM_TYPE_CODE.to_string()
    } else {
        normalized
    }
}

pub fn normalize_optional_system_type_code(value: Option<&str>) -> Option<String> {
    let normalized = value.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

/**
 * @function normalize_store_code
 * @description 매장 코드를 대문자로 변환하고 비어있을 경우 기본 매장 코드로 채워 반환합니다.
 */
pub fn normalize_store_code(value: Option<&str>) -> String {
    let normalized = value.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        DEFAULT_STORE_CODE.to_string()
    } else {
        normalized
    }
}

/**
 * @function normalize_phone_digits
 * @description 문자열에서 숫자만 추출하여 반환합니다. (전화번호 비교용 정규화)
 */
pub fn normalize_phone_digits(value: &str) -> String {
    value.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

// 회원 식별자(ID/이름/전화)를 공통 규칙으로 해석합니다.
pub async fn resolve_member_snapshot_by_identifier(
    client: &Client,
    store_code: &str,
    identifier: &str,
) -> Result<Option<(i64, String, Option<String>)>, String> {
    let trimmed = identifier.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    // 1단계: 입력값이 숫자로만 구성된 경우, 회원 고유 ID(user_id)로 직접 조회를 시도합니다.
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

    // 2단계: 입력값이 문자열인 경우, 이름 또는 전화번호(텍스트 일치)로 조회를 시도합니다.
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

    // 3단계: 특수문자가 섞인 경우 숫자만 추출하여(정규화) 전화번호 패턴 매칭을 시도합니다.
    let digits = normalize_phone_digits(trimmed);
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

// HWID 생성에 쓰일 토큰을 안전한 문자만 남기고 정규화합니다.
pub fn sanitize_hardware_token(value: &str) -> Option<String> {
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

pub fn extract_non_empty_lines(raw: &str) -> Vec<String> {
    raw.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect()
}

/**
 * @function run_command_output
 * @description 시스템 명령을 실행하고 그 결과를 문자열로 반환합니다. 윈도우 환경에서는 콘솔 창을 띄우지 않도록 설정합니다.
 */
pub fn run_command_output(command: &str, args: &[&str]) -> Option<String> {
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

/**
 * @function read_windows_machine_guid
 * @description 윈도우 레지스트리(HKLM\SOFTWARE\Microsoft\Cryptography)에서 MachineGuid 값을 읽어옵니다.
 */
pub fn read_windows_machine_guid() -> Option<String> {
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

/**
 * @function read_windows_wmic_value
 * @description wmic 명령을 통해 특정 하드웨어 정보(CPU ID, UUID 등)의 속성값을 읽어옵니다.
 */
pub fn read_windows_wmic_value(alias: &str, column: &str) -> Option<String> {
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

/**
 * @function detect_host_name
 * @description 환경 변수에서 컴퓨터 호스트명을 감지하여 정규화 후 반환합니다. 결과는 캐싱됩니다.
 */
pub fn detect_host_name() -> String {
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

/**
 * @function detect_cpu_id
 * @description wmic 또는 환경 변수에서 CPU 고유 식별자(ID)를 감지합니다. 결과는 캐싱됩니다.
 */
pub fn detect_cpu_id() -> String {
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

/**
 * @function detect_hwid
 * @description 윈도우의 MachineGuid, 제품 UUID, CPU ID, 호스트명을 조합하여 장치 고유 식별자(HWID)를 생성합니다.
 * @return String: 파이프(|)로 연결된 장치 정보 문자열
 */
pub fn detect_hwid() -> String {
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

/**
 * @function ensure_store_binding_table
 * @description 점포 단말 바인딩 정보를 저장하는 보안 테이블(security_store_binding)을 생성하고 컬럼을 보정합니다.
 */
pub async fn ensure_store_binding_table(client: &Client) -> Result<(), String> {
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

/**
 * @function ensure_cdkey_table
 * @description 보안 인증에 사용되는 CDKEY 관리 테이블을 생성하고, 서버 가동 시 최소 20개의 여유 CDKEY가 상시 존재하도록 자동 생성 로직을 수행합니다.
 */
pub async fn ensure_cdkey_table(client: &Client) -> Result<(), String> {
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

/**
 * @function validate_store_code_in_str_cd
 * @description 입력된 점포 코드가 공통 코드(STR_CD) 시스템에 유효하게 등록되어 있는지 검증합니다.
 */
pub async fn validate_store_code_in_str_cd(client: &Client, code: &str) -> Result<(), String> {
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

/**
 * @function validate_store_code
 * @description 기본 점포 코드를 포함하여, 입력된 점포 코드가 전체 시스템 기준에 부합하는지 확인합니다.
 */
pub async fn validate_store_code(client: &Client, code: &str) -> Result<(), String> {
    if code == DEFAULT_STORE_CODE {
        return Ok(());
    }

    validate_store_code_in_str_cd(client, code).await
}

/**
 * @function assert_store_binding
 * @description 현재 장치(HWID)가 해당 점포 코드로 정상적으로 바인딩(인증)되어 있는지 확인합니다.
 * 인증되지 않거나 차단된 장치의 접근을 방지하는 보안 게이트웨이 역할을 합니다.
 */
pub async fn assert_store_binding(client: &Client, store_code: &str) -> Result<(), String> {
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

/**
 * @function resolve_store_code
 * @description 입력받은 점포 코드를 정규화하고, 시스템 유효성 검증 및 장치 바인딩 확인을 일괄 수행하여 신뢰할 수 있는 매장 코드를 반환합니다.
 */
pub async fn resolve_store_code(client: &Client, value: Option<&str>) -> Result<String, String> {
    let store_code = normalize_store_code(value);
    validate_store_code(client, &store_code).await?;
    assert_store_binding(client, &store_code).await?;
    Ok(store_code)
}

/**
 * @function validate_system_type_code
 * @description 시스템 타입(기능 구분) 코드가 공통 코드 정의에 유효한지 검사합니다.
 */
pub async fn validate_system_type_code(client: &Client, code: &str) -> Result<(), String> {
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

/**
 * @function ensure_menu_table
 * @description 메뉴 관리 테이블(menu_management)의 존재 여부를 확인하고, 필요한 컬럼 및 인덱스를 자동 보정합니다.
 */
pub async fn ensure_menu_table(client: &Client) -> Result<(), String> {
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

            -- [SQL] 시스템 타입 코드 컬럼이 없는 경우 추가하고 기본값(ALL)으로 채웁니다.
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

            -- [SQL] 매장 코드 컬럼이 없는 경우 추가하고 기본 매장 코드로 초기화합니다.
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

            -- [SQL] 시작 메뉴 여부(is_start_menu) 컬럼을 추가하고 인덱스를 생성합니다.
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

            -- [SQL] 기존 유니크 제약을 제거하고, 매장별 경로(store_code, menu_path) 유니크 인덱스를 생성합니다.
            ALTER TABLE menu_management
            DROP CONSTRAINT IF EXISTS menu_management_menu_path_key;

            CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_management_store_path
            ON menu_management (store_code, menu_path);
            "#,
        )
        .await
        .map_err(|e| format!("menu_management 테이블 생성 실패: {e}"))
}

pub async fn ensure_menu_start_menu_column(client: &Client) -> Result<(), String> {
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

/**
 * @function get_next_menu_id
 * @description 저장된 메뉴 중 최대 ID값을 조회하여 다음 등록할 메뉴의 ID를 결정합니다.
 */
pub async fn get_next_menu_id(client: &Client) -> Result<i64, String> {
    let row = client
        .query_one(
            "SELECT COALESCE(MAX(menu_id), 0) + 1 FROM menu_management",
            &[],
        )
        .await
        .map_err(|e| format!("next menu_id query failed: {e}"))?;
    Ok(row.get::<_, i64>(0))
}

/**
 * @function ensure_common_code_tables
 * @description 공통 코드 그룹(common_code_group) 및 상세 코드(common_code_detail) 테이블을 생성합니다.
 */
pub async fn ensure_common_code_tables(client: &Client) -> Result<(), String> {
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

/**
 * @function refresh_group_detail_count
 * @description 특정 공통 코드 그룹에 속한 상세 코드의 개수를 집계하여 그룹 테이블의 detail_count 컬럼을 동기화합니다.
 */
pub async fn refresh_group_detail_count(client: &Client, group_id: &str) -> Result<(), String> {
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

/**
 * @function ensure_role_management_tables
 * @description 역할(role_management) 및 역할별 메뉴 권한(role_menu_permission) 테이블을 생성하고 보정합니다.
 */
pub async fn ensure_role_management_tables(client: &Client) -> Result<(), String> {
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

/**
 * @function ensure_employee_management_table
 * @description 직원 관리 테이블(employee_management)을 생성하고, 하위 호환성을 위해 컬럼 타입을 보정합니다.
 */
pub async fn ensure_employee_management_table(client: &Client) -> Result<(), String> {
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

/**
 * @function ensure_user_management_table
 * @description 회원(고객) 관리 테이블(user_management)을 생성하고 컬럼 누락 시 보정합니다.
 */
pub async fn ensure_user_management_table(client: &Client) -> Result<(), String> {
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
    log_sql_fn(sql, None);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("회원 테이블 생성 실패: {e}"))
}

/**
 * @function ensure_service_catalog_management_table
 * @description 시술 항목 카탈로그 테이블(service_catalog_management)을 생성하고 제약 조건 및 인덱스를 설정합니다.
 */
pub async fn ensure_service_catalog_management_table(client: &Client) -> Result<(), String> {
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
    log_sql_fn(sql, None);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("시술 항목 테이블 생성 실패: {e}"))
}

// 예약 헤더/라인 스키마와 store_code 마이그레이션을 준비합니다.
pub async fn ensure_reservation_calendar_management_tables(
    client: &Client,
    connection: &DbConnectionPayload,
) -> Result<(), String> {
    if !is_db_integrity_check_mode() {
        return Ok(());
    }

    // [Logic] 중복 마이그레이션을 방지하기 위해 로컬 캐시를 확인합니다.
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
            customer_id BIGINT NULL,
            customer_phone VARCHAR(30) NULL,
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
    log_sql_fn(create_sql, None);
    client
        .batch_execute(create_sql)
        .await
        .map_err(|e| format!("예약 캘린더 테이블 생성 실패: {e}"))?;

    // [SQL] 기존 예약 데이터에 대해 매장 코드(store_code) 누락 시 마이그레이션을 수행합니다.
    let patch_sql = r#"
        ALTER TABLE reservation_calendar_management
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

        ALTER TABLE reservation_calendar_management
        ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

        ALTER TABLE reservation_calendar_management
        ADD COLUMN IF NOT EXISTS customer_id BIGINT;

        ALTER TABLE reservation_calendar_management
        ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(30);

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
    log_sql_fn(patch_sql, None);
    client
        .batch_execute(patch_sql)
        .await
        .map_err(|e| format!("예약 캘린더 store_code 마이그레이션 실패: {e}"))?;

    mark_local_migration_checked(&migration_key);
    Ok(())
}

/**
 * @function ensure_member_point_management_tables
 * @description 회원 포인트 잔액, 쿠폰 잔액, 충전/사용 이력 테이블들을 일괄 생성 및 보정합니다.
 */
pub async fn ensure_member_point_management_tables(client: &Client) -> Result<(), String> {
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
    log_sql_fn(sql, None);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("회원 포인트 테이블 생성 실패: {e}"))?;

    ensure_member_point_recharge_cancel_log_table(client).await?;
    Ok(())
}

/**
 * @function ensure_member_point_recharge_cancel_log_table
 * @description 포인트 충전 이력에 취소 사유 및 상태값(status_code) 관련 컬럼을 추가합니다.
 */
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

    log_sql_fn(sql, None);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("회원 포인트 충전 취소 상태 컬럼 준비 실패: {e}"))
}

/**
 * @function ensure_sales_settlement_management_tables
 * @description 시술 정산 마스터, 시술 상세 라인, 결제 상세 라인 테이블을 생성하고 연관 관계를 보정합니다.
 */
pub async fn ensure_sales_settlement_management_tables(client: &Client) -> Result<(), String> {
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
    log_sql_fn(sql, None);
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("시술 정산 테이블 생성 실패: {e}"))
}

