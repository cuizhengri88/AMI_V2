CREATE SCHEMA IF NOT EXISTS czr_ami;
SET search_path TO czr_ami;

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

-- Get service items
-- SELECT * FROM service_catalog_management ORDER BY service_id DESC;

-- Insert service item
-- INSERT INTO service_catalog_management (category_code, service_name, unit_price, duration_minutes, use_yn, note)
-- VALUES ($1, $2, $3, $4, $5, $6);

-- Update service item
-- UPDATE service_catalog_management
--    SET category_code = $1,
--        service_name = $2,
--        unit_price = $3,
--        duration_minutes = $4,
--        use_yn = $5,
--        note = $6,
--        updated_at = NOW()
--  WHERE service_id = $7;

-- Delete service item
-- DELETE FROM service_catalog_management WHERE service_id = $1;
