CREATE SCHEMA IF NOT EXISTS czr_ami;
SET search_path TO czr_ami;

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
