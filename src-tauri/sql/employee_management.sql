CREATE SCHEMA IF NOT EXISTS czr_ami;
SET search_path TO czr_ami;

DROP TABLE IF EXISTS employee_management;

CREATE TABLE employee_management (
  employee_id BIGSERIAL PRIMARY KEY,
  store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
  employee_name VARCHAR(100) NOT NULL,
  employee_code VARCHAR(50) UNIQUE NOT NULL,
  role_id VARCHAR(50) NULL REFERENCES role_management(role_id) ON DELETE SET NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  phone VARCHAR(20),
  hire_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT '재직중',
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_management_role_id
ON employee_management (role_id);
