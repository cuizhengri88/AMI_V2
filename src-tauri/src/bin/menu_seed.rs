use tokio_postgres::NoTls;

#[derive(Clone)]
struct MenuSeed {
    id: i64,
    parent_id: Option<i64>,
    menu_type: &'static str,
    path: &'static str,
    order: i32,
    status: &'static str,
    ko: &'static str,
    en: &'static str,
    zh: &'static str,
}

fn menu_seeds() -> Vec<MenuSeed> {
    vec![
        MenuSeed { id: 100, parent_id: None, menu_type: "MAIN", path: "/sales", order: 1, status: "사용중", ko: "매출 관리", en: "Sales Management", zh: "销售管理" },
        MenuSeed { id: 1, parent_id: Some(100), menu_type: "SUB", path: "/sales-stats", order: 1, status: "사용중", ko: "매출 통계", en: "Sales Stats", zh: "销售统计" },
        MenuSeed { id: 4, parent_id: Some(100), menu_type: "SUB", path: "/purchases", order: 2, status: "사용중", ko: "구매 관리", en: "Purchase Management", zh: "购买管理" },
        MenuSeed { id: 200, parent_id: None, menu_type: "MAIN", path: "/product-stock", order: 2, status: "사용중", ko: "상품/재고 관리", en: "Product/Stock Management", zh: "产品/库存管理" },
        MenuSeed { id: 2, parent_id: Some(200), menu_type: "SUB", path: "/products", order: 1, status: "사용중", ko: "상품 관리", en: "Product Management", zh: "产品管理" },
        MenuSeed { id: 31, parent_id: Some(200), menu_type: "SUB", path: "/inventory", order: 2, status: "사용중", ko: "재고 관리", en: "Stock Management", zh: "库存管理" },
        MenuSeed { id: 32, parent_id: Some(200), menu_type: "SUB", path: "/inventory/history", order: 3, status: "사용중", ko: "재고 이력", en: "Stock History", zh: "库存历史" },
        MenuSeed { id: 300, parent_id: None, menu_type: "MAIN", path: "/hr", order: 3, status: "사용중", ko: "인사 관리", en: "HR Management", zh: "人事管理" },
        MenuSeed { id: 5, parent_id: Some(300), menu_type: "SUB", path: "/users", order: 1, status: "사용중", ko: "사용자 관리", en: "User Management", zh: "用户管理" },
        MenuSeed { id: 11, parent_id: Some(300), menu_type: "SUB", path: "/employees", order: 2, status: "사용중", ko: "직원 관리", en: "Employee Management", zh: "员工管理" },
        MenuSeed { id: 12, parent_id: Some(300), menu_type: "SUB", path: "/users/points", order: 3, status: "사용중", ko: "회원 포인트 관리", en: "Point Recharge", zh: "会员积分充值" },
        MenuSeed { id: 13, parent_id: Some(300), menu_type: "SUB", path: "/users/reservations", order: 4, status: "사용중", ko: "예약 캘린더", en: "Reservation Calendar", zh: "预约日历" },
        MenuSeed { id: 14, parent_id: Some(300), menu_type: "SUB", path: "/users/sales", order: 5, status: "사용중", ko: "매출 등록", en: "Sales Entry", zh: "销售登记" },
        MenuSeed { id: 6, parent_id: None, menu_type: "MAIN", path: "/system", order: 4, status: "사용중", ko: "시스템 관리", en: "System Management", zh: "系统管理" },
        MenuSeed { id: 7, parent_id: Some(6), menu_type: "SUB", path: "/system/menu", order: 1, status: "사용중", ko: "메뉴 관리", en: "Menu Management", zh: "菜单管理" },
        MenuSeed { id: 8, parent_id: Some(6), menu_type: "SUB", path: "/system/code", order: 2, status: "사용중", ko: "코드 관리", en: "Code Management", zh: "代码管理" },
        MenuSeed { id: 15, parent_id: Some(6), menu_type: "SUB", path: "/system/service-catalog", order: 3, status: "사용중", ko: "시술 항목 관리", en: "Service Catalog", zh: "服务项目管理" },
        MenuSeed { id: 9, parent_id: Some(6), menu_type: "SUB", path: "/system/role", order: 4, status: "사용중", ko: "권한 관리", en: "Role Management", zh: "权限管理" },
        MenuSeed { id: 10, parent_id: Some(6), menu_type: "SUB", path: "/system/settings", order: 5, status: "사용중", ko: "시스템 설정", en: "System Settings", zh: "系统设置" },
    ]
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (mut client, connection) = tokio_postgres::Config::new()
        .host("103.127.242.233")
        .port(5432)
        .dbname("postgres")
        .user("postgres")
        .password("12qwaszx")
        .connect(NoTls)
        .await?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("postgres connection error: {e}");
        }
    });

    client
        .batch_execute(
            r#"
            CREATE SCHEMA IF NOT EXISTS czr_ami;
            SET search_path TO czr_ami;

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

            ALTER TABLE menu_management
            DROP CONSTRAINT IF EXISTS menu_management_menu_path_key;

            CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_management_store_path
            ON menu_management (store_code, menu_path);
            "#,
        )
        .await?;

    let tx = client.transaction().await?;
    tx.batch_execute("SET search_path TO czr_ami").await?;

    let mut seeds = menu_seeds();
    seeds.sort_by_key(|m| m.parent_id.is_some());

    for menu in &seeds {
        tx.execute(
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
                &menu.id,
                &menu.parent_id,
                &menu.menu_type,
                &menu.path,
                &menu.ko,
                &menu.en,
                &menu.zh,
                &"ALL",
                &"HAIR_001",
                &menu.order,
                &menu.status,
            ],
        )
        .await?;
    }

    tx.commit().await?;
    println!("menu_management seeded rows: {}", seeds.len());
    Ok(())
}
