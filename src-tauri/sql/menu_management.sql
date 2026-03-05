-- =========================================================
-- Menu Management SQL
-- Schema: czr_ami
-- Table : menu_management
-- =========================================================

-- 1) DDL
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
    menu_order INTEGER NOT NULL DEFAULT 1,
    menu_status VARCHAR(20) NOT NULL DEFAULT '사용중',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) SELECT
SELECT
    menu_id,
    parent_menu_id,
    menu_type,
    menu_path,
    menu_name_ko,
    menu_name_en,
    menu_name_zh,
    menu_order,
    menu_status
FROM menu_management
ORDER BY COALESCE(parent_menu_id, menu_id), menu_order, menu_id;

-- 3) UPSERT
INSERT INTO menu_management (
    menu_id,
    parent_menu_id,
    menu_type,
    menu_path,
    menu_name_ko,
    menu_name_en,
    menu_name_zh,
    menu_order,
    menu_status
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (menu_id)
DO UPDATE SET
    parent_menu_id = EXCLUDED.parent_menu_id,
    menu_type = EXCLUDED.menu_type,
    menu_path = EXCLUDED.menu_path,
    menu_name_ko = EXCLUDED.menu_name_ko,
    menu_name_en = EXCLUDED.menu_name_en,
    menu_name_zh = EXCLUDED.menu_name_zh,
    menu_order = EXCLUDED.menu_order,
    menu_status = EXCLUDED.menu_status,
    updated_at = NOW();

-- 4) DELETE
DELETE FROM menu_management
WHERE menu_id = $1;

-- 5) FULL REFRESH (sync)
TRUNCATE TABLE menu_management;
