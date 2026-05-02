-- 거래상대방 통합 마스터 테이블
CREATE TABLE IF NOT EXISTS public.counterparties (
    counterparty_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- T5T 이해관계자 테이블에 FK 추가
ALTER TABLE public.t5t_log_stakeholders 
ADD COLUMN IF NOT EXISTS counterparty_id TEXT REFERENCES public.counterparties(counterparty_id);

-- 익스포저 테이블에도 FK 컬럼 추가
ALTER TABLE public.lender_exposures 
ADD COLUMN IF NOT EXISTS counterparty_id TEXT REFERENCES public.counterparties(counterparty_id);

ALTER TABLE public.beneficiary_exposures 
ADD COLUMN IF NOT EXISTS counterparty_id TEXT REFERENCES public.counterparties(counterparty_id);
