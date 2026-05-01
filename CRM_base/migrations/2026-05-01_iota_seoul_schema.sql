-- IOTA Seoul Dedicated Schema Migration
CREATE SCHEMA IF NOT EXISTS iota_seoul;

-- 1. Projects Table
CREATE TABLE IF NOT EXISTS iota_seoul.projects (
    proj_id TEXT PRIMARY KEY, -- P00030, P00037, 112614
    proj_name TEXT NOT NULL,
    proj_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Workspaces Table
CREATE TABLE IF NOT EXISTS iota_seoul.workspaces (
    ws_code TEXT PRIMARY KEY, -- WS_PM, WS_FIN, etc.
    ws_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Master Data Table (Codex)
CREATE TABLE IF NOT EXISTS iota_seoul.master_data (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proj_id TEXT REFERENCES iota_seoul.projects(proj_id),
    ws_code TEXT REFERENCES iota_seoul.workspaces(ws_code),
    classification TEXT,
    item_name TEXT,
    content TEXT,
    raw_metadata JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Initial Seed Data
INSERT INTO iota_seoul.projects (proj_id, proj_name, proj_type) VALUES
('P00030', '와이디427', 'PFV'),
('P00037', '와이드816', 'PFV'),
('112614', '421호 펀드', 'Fund')
ON CONFLICT (proj_id) DO NOTHING;

INSERT INTO iota_seoul.workspaces (ws_code, ws_name) VALUES
('WS_PM', '사업 PM'),
('WS_FIN', '파이낸싱'),
('WS_CON', '개발관리'),
('WS_MKT', '기업마케팅'),
('WS_DIG', '상품·디지털'),
('WS_FND', '펀드 운용'),
('WS_IPR', 'IPR')
ON CONFLICT (ws_code) DO NOTHING;
