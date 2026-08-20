-- t5t_form_items 테이블에 펀드 매칭용 컬럼 추가
ALTER TABLE public.t5t_form_items 
ADD COLUMN IF NOT EXISTS matched_fund_id TEXT REFERENCES public.funds(fund_id);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS t5t_form_items_fund_idx ON public.t5t_form_items(matched_fund_id);
