-- =========================================================
-- Role Management SQL
-- Schema: czr_ami
-- Tables: role_management, role_menu_permission
-- =========================================================

-- 1) DDL
CREATE SCHEMA IF NOT EXISTS czr_ami;
SET search_path TO czr_ami;

-- 권한(역할) 테이블
CREATE TABLE IF NOT EXISTS role_management (
    role_id VARCHAR(50) PRIMARY KEY,
    store_code VARCHAR(50) NOT NULL DEFAULT 'HAIR_001',
    role_name VARCHAR(100) NOT NULL,
    role_desc TEXT,
    user_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 권한별 메뉴 권한 테이블
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_menu_permission_store_role_menu
ON role_menu_permission (store_code, role_id, menu_id);

-- 2) SELECT - 역할 목록
SELECT
    role_id,
    store_code,
    role_name,
    role_desc,
    user_count,
    created_at,
    updated_at
FROM role_management
ORDER BY created_at;

-- 3) SELECT - 역할별 메뉴 권한
SELECT
    rmp.id,
    rmp.role_id,
    rmp.store_code,
    rmp.menu_id,
    mm.menu_name_ko,
    mm.menu_name_en,
    mm.menu_name_zh,
    rmp.can_read,
    rmp.can_write,
    rmp.can_delete
FROM role_menu_permission rmp
JOIN menu_management mm ON rmp.menu_id = mm.menu_id
WHERE rmp.role_id = $1
ORDER BY mm.menu_order;

-- 4) UPSERT - 역할
INSERT INTO role_management (role_id, store_code, role_name, role_desc, user_count)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (role_id)
DO UPDATE SET
    store_code = EXCLUDED.store_code,
    role_name = EXCLUDED.role_name,
    role_desc = EXCLUDED.role_desc,
    user_count = EXCLUDED.user_count,
    updated_at = NOW();

-- 5) UPSERT - 메뉴 권한
INSERT INTO role_menu_permission (role_id, menu_id, store_code, can_read, can_write, can_delete)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (store_code, role_id, menu_id)
DO UPDATE SET
    store_code = EXCLUDED.store_code,
    can_read = EXCLUDED.can_read,
    can_write = EXCLUDED.can_write,
    can_delete = EXCLUDED.can_delete,
    updated_at = NOW();

-- 6) DELETE - 역할
DELETE FROM role_management WHERE role_id = $1;

-- 7) DELETE - 메뉴 권한
DELETE FROM role_menu_permission WHERE role_id = $1 AND menu_id = $2;
