// 앱 런타임 엔트리 모듈
// - include!를 사용해 기존 대형 main.rs를 기능별 파일로 분리합니다.
// - 각 파일은 동일 모듈 스코프에서 컴파일되므로 기존 함수/타입 의존을 안전하게 유지합니다.

pub mod core;
pub mod commands;

use crate::app::commands::system::*;
use crate::app::commands::menu::*;
use crate::app::commands::common_code::*;
use crate::app::commands::role::*;
use crate::app::commands::employee::*;
use crate::app::commands::service_catalog::*;
use crate::app::commands::reservation::*;
use crate::app::commands::user::*;
use crate::app::commands::point::*;
use crate::app::commands::sales::*;
use crate::app::commands::reset::*;

// Tauri 앱을 실행하는 진입 함수입니다.
// main.rs에서는 이 함수만 호출하도록 단순화해 유지보수성을 높입니다.
pub fn run() {
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
