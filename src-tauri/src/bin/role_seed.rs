use tokio_postgres::NoTls;

struct RoleSeed {
    id: &'static str,
    name: &'static str,
    desc: &'static str,
    user_count: i32,
}

struct PermissionSeed {
    role_id: &'static str,
    menu_id: i64,
    can_read: bool,
    can_write: bool,
    can_delete: bool,
}

fn role_seeds() -> Vec<RoleSeed> {
    vec![
        RoleSeed { id: "ROLE_OWNER", name: "사장", desc: "시스템의 모든 권한을 가지며 결제 및 정산 정보를 관리합니다.", user_count: 1 },
        RoleSeed { id: "ROLE_MANAGER", name: "매니저", desc: "매장 운영 및 직원 관리, 재고 관리 권한을 가집니다.", user_count: 2 },
        RoleSeed { id: "ROLE_STAFF", name: "직원", desc: "판매 등록 및 재고 조회 등 일반 업무 권한을 가집니다.", user_count: 5 },
        RoleSeed { id: "ROLE_PARTTIME", name: "알바", desc: "제한된 판매 등록 및 조회 권한만 가집니다.", user_count: 3 },
    ]
}

fn permission_seeds() -> Vec<PermissionSeed> {
    let menu_ids: Vec<i64> = vec![100, 1, 4, 200, 2, 31, 32, 300, 5, 11, 12, 13, 14, 16, 6, 7, 8, 15, 9, 10];
    let mut perms = Vec::new();

    // ROLE_OWNER: 모든 권한
    for &mid in &menu_ids {
        perms.push(PermissionSeed { role_id: "ROLE_OWNER", menu_id: mid, can_read: true, can_write: true, can_delete: true });
    }

    // ROLE_MANAGER: 시스템 관리 제외
    let manager_perms = [
        (100, true, true, false), (1, true, false, false), (4, true, true, false),
        (200, true, true, true), (2, true, true, true), (31, true, true, true), (32, true, true, false),
        (300, true, true, false), (5, true, true, false), (11, true, false, false), (12, false, false, false), (13, false, false, false), (14, false, false, false), (16, true, false, false),
        (6, false, false, false), (7, false, false, false), (8, false, false, false), (15, false, false, false), (9, false, false, false), (10, false, false, false),
    ];
    for (mid, r, w, d) in manager_perms {
        perms.push(PermissionSeed { role_id: "ROLE_MANAGER", menu_id: mid, can_read: r, can_write: w, can_delete: d });
    }

    // ROLE_STAFF: 제한된 권한
    let staff_perms = [
        (100, true, false, false), (1, false, false, false), (4, false, false, false),
        (200, true, true, false), (2, true, false, false), (31, true, true, false), (32, true, false, false),
        (300, true, false, false), (5, true, false, false), (11, false, false, false), (12, false, false, false), (13, false, false, false), (14, false, false, false), (16, true, false, false),
        (6, false, false, false), (7, false, false, false), (8, false, false, false), (15, false, false, false), (9, false, false, false), (10, false, false, false),
    ];
    for (mid, r, w, d) in staff_perms {
        perms.push(PermissionSeed { role_id: "ROLE_STAFF", menu_id: mid, can_read: r, can_write: w, can_delete: d });
    }

    // ROLE_PARTTIME: 최소 권한
    let parttime_perms = [
        (100, true, false, false), (1, false, false, false), (4, false, false, false),
        (200, true, false, false), (2, true, false, false), (31, false, false, false), (32, false, false, false),
        (300, false, false, false), (5, false, false, false), (11, false, false, false), (12, false, false, false), (13, false, false, false), (14, false, false, false), (16, false, false, false),
        (6, false, false, false), (7, false, false, false), (8, false, false, false), (15, false, false, false), (9, false, false, false), (10, false, false, false),
    ];
    for (mid, r, w, d) in parttime_perms {
        perms.push(PermissionSeed { role_id: "ROLE_PARTTIME", menu_id: mid, can_read: r, can_write: w, can_delete: d });
    }

    perms
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

    client.batch_execute(r#"
        CREATE SCHEMA IF NOT EXISTS czr_ami;
        SET search_path TO czr_ami;

        CREATE TABLE IF NOT EXISTS role_management (
            role_id VARCHAR(50) PRIMARY KEY,
            store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
            role_name VARCHAR(100) NOT NULL,
            role_desc TEXT,
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
    "#).await?;

    let tx = client.transaction().await?;
    tx.batch_execute("SET search_path TO czr_ami").await?;
    tx.batch_execute("DELETE FROM role_menu_permission").await?;
    tx.batch_execute("DELETE FROM role_management").await?;

    for role in role_seeds() {
        tx.execute(
            "INSERT INTO role_management (role_id, store_code, role_name, role_desc, user_count) VALUES ($1, $2, $3, $4, $5)",
            &[&role.id, &"HAIR_001", &role.name, &role.desc, &role.user_count],
        ).await?;
    }

    for perm in permission_seeds() {
        tx.execute(
            "INSERT INTO role_menu_permission (role_id, menu_id, store_code, can_read, can_write, can_delete) VALUES ($1, $2, $3, $4, $5, $6)",
            &[&perm.role_id, &perm.menu_id, &"HAIR_001", &perm.can_read, &perm.can_write, &perm.can_delete],
        ).await?;
    }

    tx.commit().await?;
    println!("role_management seeded: {} roles, {} permissions", role_seeds().len(), permission_seeds().len());
    Ok(())
}
