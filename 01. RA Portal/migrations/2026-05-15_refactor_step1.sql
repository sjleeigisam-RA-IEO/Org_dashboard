-- Step 1: HR Lifecycle Flexibility & Dashboard Compatibility Layer

-- 1. 신규 채용, 부서 이동, 퇴사 등을 유연하게 기록하는 이력 테이블
CREATE TABLE IF NOT EXISTS public.staff_status_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id TEXT NOT NULL REFERENCES public.staff(staff_id) ON DELETE CASCADE,
    status_code TEXT NOT NULL, -- 'hired', 'transferred', 'left', 'on_leave', 'returned'
    org_id TEXT REFERENCES public.orgs(org_id),
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 기존 대시보드 JS 엔진과의 호환성을 100% 유지해주는 '가상 호환 뷰'
-- 이 뷰는 JS가 기대하는 'dept', 'manager' 명칭을 그대로 제공하면서도
-- 실제 데이터는 정규화된 마스터 테이블(orgs, staff)에서 조인해옵니다.
CREATE OR REPLACE VIEW public.v_funds_enriched AS
SELECT 
    f.*, 
    COALESCE(o.org_name, f.dept) as dept_resolved,    -- ID 기반 부서명이 있으면 우선, 없으면 기존 문자열 사용
    COALESCE(s.name, f.manager) as manager_resolved  -- ID 기반 이름이 있으면 우선, 없으면 기존 문자열 사용
FROM public.funds f
LEFT JOIN public.orgs o ON f.dept_org_id = o.org_id
LEFT JOIN public.staff s ON f.manager_staff_id = s.staff_id;

-- 3. 기존 데이터 기반 초기 이력 생성 (필요 시)
-- 기존 staff 테이블의 join_date, status 정보를 기반으로 최초 이력 로우를 생성하는 로직은 파이썬 스크립트에서 처리 권장

COMMENT ON VIEW public.v_funds_enriched IS '대시보드 호환성을 위해 문자열 부서/담당자명을 실시간 JOIN으로 제공하는 뷰입니다.';
