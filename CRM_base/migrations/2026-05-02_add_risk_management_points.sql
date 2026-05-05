-- 4. 리스크 관리 포인트 테이블 (Risk Management Points)
CREATE TABLE IF NOT EXISTS risk_management_points (
    id BIGSERIAL PRIMARY KEY,
    fund_id VARCHAR REFERENCES funds(fund_id), -- 연계 가능한 펀드코드
    project_name VARCHAR NOT NULL,             -- PDF 상의 프로젝트명
    base_date DATE NOT NULL,                   -- 기준일자 (예: 2026-03-31)
    risk_index NUMERIC,                        -- 위험관리계수
    overall_rating VARCHAR,                    -- 종합평가 (O, △, X)
    land_rating VARCHAR,                       -- 토지확보
    permit_rating VARCHAR,                     -- 인허가
    constructor_rating VARCHAR,                -- 시공사
    progress_rating VARCHAR,                   -- 진행단계
    extension_count INTEGER,                   -- 만기연장 횟수
    risk_summary TEXT,                         -- 핵심 리스크 요약
    details JSONB,                             -- 상세 정보 (브릿지론, 주주구성 등)
    raw_text TEXT,                             -- 해당 프로젝트 추출 텍스트 전문
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_risk_points_fund_id ON risk_management_points(fund_id);
CREATE INDEX IF NOT EXISTS idx_risk_points_base_date ON risk_management_points(base_date);
