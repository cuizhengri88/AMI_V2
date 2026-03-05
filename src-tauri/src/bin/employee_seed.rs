use tokio_postgres::NoTls;

struct RoleSeed {
    id: &'static str,
    name: &'static str,
    desc: &'static str,
}

struct EmployeeSeed {
    name: &'static str,
    code: &'static str,
    role_id: Option<&'static str>,
    email: &'static str,
    phone: Option<&'static str>,
    hire_date: Option<&'static str>,
    status: &'static str,
    remarks: Option<&'static str>,
}

fn role_seeds() -> Vec<RoleSeed> {
    vec![
        RoleSeed {
            id: "ROLE_OWNER",
            name: "사장",
            desc: "시스템 전체 권한",
        },
        RoleSeed {
            id: "ROLE_MANAGER",
            name: "매니저",
            desc: "운영/관리 권한",
        },
        RoleSeed {
            id: "ROLE_STAFF",
            name: "직원",
            desc: "일반 업무 권한",
        },
        RoleSeed {
            id: "ROLE_PARTTIME",
            name: "알바",
            desc: "제한된 업무 권한",
        },
    ]
}

fn employee_seeds() -> Vec<EmployeeSeed> {
    vec![
        EmployeeSeed {
            name: "김대표",
            code: "EMP001",
            role_id: Some("ROLE_OWNER"),
            email: "owner@ami.local",
            phone: Some("010-1000-1000"),
            hire_date: Some("2022-01-10"),
            status: "재직중",
            remarks: Some("총괄 책임자"),
        },
        EmployeeSeed {
            name: "박매니저",
            code: "EMP002",
            role_id: Some("ROLE_MANAGER"),
            email: "manager@ami.local",
            phone: Some("010-2000-2000"),
            hire_date: Some("2023-03-01"),
            status: "재직중",
            remarks: Some("매장 운영 담당"),
        },
        EmployeeSeed {
            name: "이직원",
            code: "EMP003",
            role_id: Some("ROLE_STAFF"),
            email: "staff@ami.local",
            phone: Some("010-3000-3000"),
            hire_date: Some("2024-05-15"),
            status: "재직중",
            remarks: None,
        },
        EmployeeSeed {
            name: "최알바",
            code: "EMP004",
            role_id: Some("ROLE_PARTTIME"),
            email: "parttime@ami.local",
            phone: None,
            hire_date: Some("2025-01-03"),
            status: "재직중",
            remarks: Some("주말 근무"),
        },
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

            CREATE TABLE IF NOT EXISTS role_management (
                role_id VARCHAR(50) PRIMARY KEY,
                role_name VARCHAR(100) NOT NULL,
                role_desc TEXT NULL,
                user_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            "#,
        )
        .await?;

    let tx = client.transaction().await?;
    tx.batch_execute("SET search_path TO czr_ami").await?;

    for role in role_seeds() {
        tx.execute(
            r#"
            INSERT INTO role_management (role_id, role_name, role_desc, user_count)
            VALUES ($1, $2, $3, 0)
            ON CONFLICT (role_id)
            DO UPDATE SET
                role_name = EXCLUDED.role_name,
                role_desc = EXCLUDED.role_desc,
                updated_at = NOW()
            "#,
            &[&role.id, &role.name, &role.desc],
        )
        .await?;
    }

    tx.batch_execute("DROP TABLE IF EXISTS employee_management")
        .await?;

    tx.batch_execute(
        r#"
        CREATE TABLE employee_management (
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
    .await?;

    let employees = employee_seeds();
    for emp in &employees {
        tx.execute(
            r#"
            INSERT INTO employee_management (
                employee_name, employee_code, role_id, email, phone, hire_date, status, remarks
            ) VALUES ($1,$2,$3,$4,$5,$6::DATE,$7,$8)
            "#,
            &[
                &emp.name,
                &emp.code,
                &emp.role_id,
                &emp.email,
                &emp.phone,
                &emp.hire_date,
                &emp.status,
                &emp.remarks,
            ],
        )
        .await?;
    }

    tx.execute(
        r#"
        UPDATE role_management rm
           SET user_count = c.cnt,
               updated_at = NOW()
          FROM (
                SELECT role_id, COUNT(*)::INTEGER AS cnt
                  FROM employee_management
                 WHERE role_id IS NOT NULL
                 GROUP BY role_id
               ) c
         WHERE rm.role_id = c.role_id
        "#,
        &[],
    )
    .await?;

    tx.commit().await?;

    println!(
        "employee_management recreated and seeded: {} rows",
        employees.len()
    );
    Ok(())
}
