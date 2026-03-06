-- 시술/결제 정산 관리 테이블
CREATE TABLE IF NOT EXISTS sales_settlement_management (
    settlement_id BIGSERIAL PRIMARY KEY,
    store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
    member_user_id BIGINT NULL REFERENCES user_management(user_id) ON DELETE SET NULL,
    manager_employee_id BIGINT NOT NULL REFERENCES employee_management(employee_id) ON DELETE RESTRICT,
    total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
    total_time_minutes INTEGER NOT NULL CHECK (total_time_minutes >= 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
    reservation_ref VARCHAR(100) NULL,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_code, settlement_id, line_no)
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_code, settlement_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_sales_settlement_store_datetime
ON sales_settlement_management (store_code, settlement_datetime DESC, settlement_id DESC);

CREATE INDEX IF NOT EXISTS idx_sales_settlement_store_member
ON sales_settlement_management (store_code, member_user_id);

CREATE INDEX IF NOT EXISTS idx_sales_settlement_store_manager
ON sales_settlement_management (store_code, manager_employee_id);

CREATE INDEX IF NOT EXISTS idx_sales_settlement_service_line_store_settlement
ON sales_settlement_service_line (store_code, settlement_id);

CREATE INDEX IF NOT EXISTS idx_sales_settlement_payment_line_store_settlement
ON sales_settlement_payment_line (store_code, settlement_id);
