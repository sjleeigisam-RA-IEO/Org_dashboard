-- 1. 펀드 마스터 테이블 (Funds Master)
CREATE TABLE funds (
    fund_id VARCHAR PRIMARY KEY,       -- 펀드코드
    short_name VARCHAR,                -- 약칭
    fund_name VARCHAR,                 -- 펀드명
    sector VARCHAR,                    -- 투자섹터
    asset_name VARCHAR,                -- 자산
    status VARCHAR,                    -- 운용상태
    location VARCHAR,                  -- 국내해외구분
    setup_date DATE,                   -- 펀드설정일
    maturity_date DATE,                -- 펀드만기일
    dept VARCHAR,                      -- 담당부서
    manager VARCHAR                    -- 담당자
);

-- 2. 대주 익스포저 테이블 (Lender Exposures)
CREATE TABLE lender_exposures (
    id BIGSERIAL PRIMARY KEY,
    fund_id VARCHAR REFERENCES funds(fund_id),
    lender_raw VARCHAR,                -- 원본 대주명
    lender_clean VARCHAR,              -- 정제된 대주명
    committed_amt BIGINT,              -- 대출약정금액
    drawn_amt BIGINT,                  -- 대출인출금액
    remaining_amt BIGINT,              -- 대출잔여금액
    drawdown_date DATE,                -- 대출인출일
    loan_maturity_date DATE,           -- 대출만기일
    trench VARCHAR,                    -- 트렌치
    interest_type VARCHAR,             -- 이자유형
    base_rate NUMERIC,                 -- 기준금리
    spread_rate NUMERIC,               -- 가산금리
    all_in_rate NUMERIC,               -- All-in금리
    remarks TEXT,                      -- 비고
    base_date DATE                     -- 기준일자
);

-- 3. 수익자 익스포저 테이블 (Beneficiary Exposures)
CREATE TABLE beneficiary_exposures (
    id BIGSERIAL PRIMARY KEY,
    fund_id VARCHAR REFERENCES funds(fund_id),
    beneficiary_raw VARCHAR,           -- 원본 수익자명
    beneficiary_clean VARCHAR,         -- 정제된 수익자명
    beneficiary_type VARCHAR,          -- 수익자구분
    beneficiary_cat VARCHAR,           -- 수익자분류
    committed_amt BIGINT,              -- 총약정금액
    invested_amt BIGINT,               -- 투입금액
    remaining_amt BIGINT,              -- 잔여약정금액
    share_ratio NUMERIC,               -- 비율(%)
    setup_units NUMERIC,               -- 설정해지좌수
    setup_amt NUMERIC,                 -- 설정해지금액
    remarks TEXT,                      -- 비고
    base_date DATE                     -- 기준일자
);
