#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (client, connection) = tokio_postgres::connect(
        "host=localhost user=postgres password=postgres dbname=ami_v2",
        tokio_postgres::NoTls,
    )
    .await?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {}", e);
        }
    });

    let client = client;

    // Create table
    client
        .execute(
            "CREATE TABLE IF NOT EXISTS czr_ami.user_management (
                user_id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(20),
                address VARCHAR(255),
                remarks TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
            &[],
        )
        .await?;

    println!("✓ Table created");

    // Sample users
    let users = vec![
        ("김철수", "chulsoo@example.com", "010-1234-5678", "서울시 강남구 테헤란로 123", "우수 고객, 정기 구매자"),
        ("이영희", "younghee@example.com", "010-9876-5432", "경기도 성남시 분당구 판교역로 45", "신규 가입, 환불 이력 1건"),
        ("박민준", "minjun@example.com", "010-5555-4444", "부산시 해운대구 마린시티 78", "VIP 고객, 대량 주문 선호"),
        ("최지우", "jiwoo@example.com", "010-1111-2222", "대구시 수성구 달구벌대로 99", "이벤트 참여 활발"),
    ];

    for (name, email, phone, address, remarks) in users {
        client
            .execute(
                "INSERT INTO czr_ami.user_management (name, email, phone, address, remarks) VALUES ($1, $2, $3, $4, $5)",
                &[&name, &email, &phone, &address, &remarks],
            )
            .await?;
    }

    println!("✓ Inserted 4 sample users");

    // Verify
    let rows = client
        .query("SELECT user_id, name, email FROM czr_ami.user_management ORDER BY user_id", &[])
        .await?;

    println!("\n✓ Users in database:");
    for row in rows {
        let user_id: i32 = row.get(0);
        let name: String = row.get(1);
        let email: String = row.get(2);
        println!("  [{}] {} ({})", user_id, name, email);
    }

    Ok(())
}
