ALTER TABLE public.funds
ADD COLUMN IF NOT EXISTS project_mission_name TEXT,
ADD COLUMN IF NOT EXISTS notion_base_asset_class TEXT,
ADD COLUMN IF NOT EXISTS notion_asset_nature_class TEXT,
ADD COLUMN IF NOT EXISTS notion_holding_type_class TEXT,
ADD COLUMN IF NOT EXISTS notion_business_stage_class TEXT,
ADD COLUMN IF NOT EXISTS notion_investment_strategy_class TEXT,
ADD COLUMN IF NOT EXISTS notion_vehicle_class TEXT;

COMMENT ON COLUMN public.funds.project_mission_name IS
  'Commonly used project/mission name synced from Project & Mission CSV';
COMMENT ON COLUMN public.funds.notion_base_asset_class IS
  'Legacy column name. Source: [new]투자 자산 조회_20260428.xlsx 기초자산';
COMMENT ON COLUMN public.funds.notion_asset_nature_class IS
  'Legacy column name. Source: [new]투자 자산 조회_20260428.xlsx 자산성격';
COMMENT ON COLUMN public.funds.notion_holding_type_class IS
  'Legacy column name. Source: [new]펀드 관리_20260428.xlsx 모자구분';
COMMENT ON COLUMN public.funds.notion_business_stage_class IS
  'Legacy column name. Source: [new]투자 자산 조회_20260428.xlsx 사업단계';
COMMENT ON COLUMN public.funds.notion_investment_strategy_class IS
  'Legacy column name. Source: [new]펀드 관리_20260428.xlsx 투자전략';
COMMENT ON COLUMN public.funds.notion_vehicle_class IS
  'Legacy column name. Source: [new]펀드 관리_20260428.xlsx Vehicle구분';
