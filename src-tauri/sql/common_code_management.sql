-- =========================================================
-- Common Code Management SQL
-- Schema: czr_ami
-- Tables: common_code_group, common_code_detail
-- =========================================================

-- 1) DDL
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

-- 2) SELECT GROUP
SELECT
    group_code_id,
    group_name,
    COALESCE(group_description, '') AS group_description,
    display_order,
    detail_count
FROM common_code_group
ORDER BY display_order, group_code_id;

-- 3) SELECT DETAIL
SELECT
    group_code_id,
    detail_code,
    detail_name,
    sort_order,
    use_yn
FROM common_code_detail
ORDER BY group_code_id, sort_order, detail_code;

-- 4) UPSERT GROUP
INSERT INTO common_code_group (
    group_code_id,
    group_name,
    group_description,
    display_order
) VALUES ($1,$2,$3,$4)
ON CONFLICT (group_code_id)
DO UPDATE SET
    group_name = EXCLUDED.group_name,
    group_description = EXCLUDED.group_description,
    display_order = EXCLUDED.display_order,
    updated_at = NOW();

-- 5) DELETE GROUP
DELETE FROM common_code_group
WHERE group_code_id = $1;

-- 6) UPSERT DETAIL
INSERT INTO common_code_detail (
    group_code_id,
    detail_code,
    detail_name,
    sort_order,
    use_yn
) VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (group_code_id, detail_code)
DO UPDATE SET
    detail_name = EXCLUDED.detail_name,
    sort_order = EXCLUDED.sort_order,
    use_yn = EXCLUDED.use_yn,
    updated_at = NOW();

-- 7) DELETE DETAIL
DELETE FROM common_code_detail
WHERE group_code_id = $1
  AND detail_code = $2;

-- 8) DETAIL COUNT REFRESH
UPDATE common_code_group g
SET detail_count = d.cnt,
    updated_at = NOW()
FROM (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM common_code_detail
    WHERE group_code_id = $1
) d
WHERE g.group_code_id = $1;

-- 9) FULL REFRESH (sync)
TRUNCATE TABLE common_code_detail, common_code_group;
