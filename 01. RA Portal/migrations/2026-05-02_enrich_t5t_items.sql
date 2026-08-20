-- 분석용 필드 추가 (요약, 토큰, 이해관계자 리스트)
ALTER TABLE public.t5t_form_items 
ADD COLUMN IF NOT EXISTS classification_summary TEXT,
ADD COLUMN IF NOT EXISTS classification_tokens JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS task_type TEXT,
ADD COLUMN IF NOT EXISTS stakeholder_ids TEXT[];
