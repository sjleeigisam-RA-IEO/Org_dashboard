ALTER TABLE public.funds
ADD COLUMN IF NOT EXISTS project_mission_name TEXT,
ADD COLUMN IF NOT EXISTS notion_base_asset_class TEXT,
ADD COLUMN IF NOT EXISTS notion_asset_nature_class TEXT,
ADD COLUMN IF NOT EXISTS notion_holding_type_class TEXT,
ADD COLUMN IF NOT EXISTS notion_business_stage_class TEXT,
ADD COLUMN IF NOT EXISTS notion_investment_strategy_class TEXT,
ADD COLUMN IF NOT EXISTS notion_vehicle_class TEXT;

COMMENT ON COLUMN public.funds.project_mission_name IS 'Commonly used project/mission name synced from Notion';
COMMENT ON COLUMN public.funds.notion_base_asset_class IS 'Notion [분류] 기초자산_작업중';
COMMENT ON COLUMN public.funds.notion_asset_nature_class IS 'Notion [분류] 자산성격_작업중';
COMMENT ON COLUMN public.funds.notion_holding_type_class IS 'Notion [분류] 보유형태_작업중';
COMMENT ON COLUMN public.funds.notion_business_stage_class IS 'Notion [분류] 사업단계_작업중';
COMMENT ON COLUMN public.funds.notion_investment_strategy_class IS 'Notion [분류] 투자전략_작업중';
COMMENT ON COLUMN public.funds.notion_vehicle_class IS 'Notion [분류] 비히클_작업중';
