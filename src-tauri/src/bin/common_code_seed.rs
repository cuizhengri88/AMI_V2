use tokio_postgres::NoTls;

#[derive(Clone)]
struct GroupSeed {
    id: &'static str,
    name: &'static str,
    desc: &'static str,
    order: i32,
}

#[derive(Clone)]
struct DetailSeed {
    group_id: &'static str,
    code: &'static str,
    name: &'static str,
    sort_order: i32,
    use_yn: &'static str,
}

fn group_seeds() -> Vec<GroupSeed> {
    vec![
        GroupSeed { id: "CLOTH_SIZE", name: "의류 사이즈 코드", desc: "의류 제품의 사이즈 구분", order: 1 },
        GroupSeed { id: "ASSET_STATUS", name: "자산 상태 코드", desc: "자산의 현재 상태 구분", order: 2 },
        GroupSeed { id: "DEPT_CODE", name: "부서 코드", desc: "조직 부서 구분", order: 3 },
        GroupSeed { id: "EMP_ROLE", name: "직원 직책 코드", desc: "직원 권한 및 직책 구분", order: 4 },
    ]
}

fn detail_seeds() -> Vec<DetailSeed> {
    vec![
        DetailSeed { group_id: "CLOTH_SIZE", code: "XS", name: "Extra Small", sort_order: 1, use_yn: "Y" },
        DetailSeed { group_id: "CLOTH_SIZE", code: "S", name: "Small", sort_order: 2, use_yn: "Y" },
        DetailSeed { group_id: "CLOTH_SIZE", code: "M", name: "Medium", sort_order: 3, use_yn: "Y" },
        DetailSeed { group_id: "CLOTH_SIZE", code: "L", name: "Large", sort_order: 4, use_yn: "Y" },
        DetailSeed { group_id: "CLOTH_SIZE", code: "XL", name: "Extra Large", sort_order: 5, use_yn: "Y" },
        DetailSeed { group_id: "ASSET_STATUS", code: "ONLINE", name: "정상 가동", sort_order: 1, use_yn: "Y" },
        DetailSeed { group_id: "ASSET_STATUS", code: "MAINTENANCE", name: "유지 보수", sort_order: 2, use_yn: "Y" },
        DetailSeed { group_id: "ASSET_STATUS", code: "CRITICAL", name: "위험 상태", sort_order: 3, use_yn: "Y" },
        DetailSeed { group_id: "ASSET_STATUS", code: "OFFLINE", name: "가동 중지", sort_order: 4, use_yn: "Y" },
        DetailSeed { group_id: "EMP_ROLE", code: "OWNER", name: "사장", sort_order: 1, use_yn: "Y" },
        DetailSeed { group_id: "EMP_ROLE", code: "MANAGER", name: "매니저", sort_order: 2, use_yn: "Y" },
        DetailSeed { group_id: "EMP_ROLE", code: "STAFF", name: "직원", sort_order: 3, use_yn: "Y" },
        DetailSeed { group_id: "EMP_ROLE", code: "PARTTIME", name: "알바", sort_order: 4, use_yn: "Y" },
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
        .await?;

    let tx = client.transaction().await?;
    tx.batch_execute("SET search_path TO czr_ami").await?;
    tx.batch_execute("TRUNCATE TABLE common_code_detail, common_code_group")
        .await?;

    let groups = group_seeds();
    let details = detail_seeds();

    for group in &groups {
        let detail_count = details
            .iter()
            .filter(|d| d.group_id == group.id)
            .count() as i32;

        tx.execute(
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
                &group.order,
                &detail_count,
            ],
        )
        .await?;
    }

    for detail in &details {
        tx.execute(
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
        .await?;
    }

    tx.commit().await?;
    println!(
        "common_code seeded groups: {}, details: {}",
        groups.len(),
        details.len()
    );
    Ok(())
}
