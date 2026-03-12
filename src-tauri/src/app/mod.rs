pub mod core;
pub mod commands;

use tauri_plugin_updater::UpdaterExt; // 추가: 업데이트 기능을 사용하기 위해 필요합니다.

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

pub fn run() {
    tauri::Builder::default()
        // 1. 업데이트 플러그인 등록
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 2. 앱 시작 시 업데이트 자동 체크 (필요한 경우)
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // 앱 시작 시 조용히 업데이트를 확인합니다.
                if let Ok(Some(update)) = handle.updater().expect("failed to get updater").check().await {
                    println!("새로운 업데이트 발견: {}", update.version);
                    // 여기서 사용자에게 알림을 띄우거나 다운로드를 시작할 수 있습니다.
                }
            });
            Ok(())
        })
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