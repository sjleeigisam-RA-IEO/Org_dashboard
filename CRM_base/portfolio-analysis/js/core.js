const { createClient } = supabase;
var _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

var searchInput = document.getElementById('searchInput');
var resultsContainer = document.getElementById('results');
var detailPanel = document.getElementById('detailPanel');
var tabBtns = document.querySelectorAll('.tab-btn');

var debounceTimer;
var currentTab = 'all';
// Default AUM basis is the commitment-basis group from the AUM workbook.
var currentAumBasis = 'benchmark_aum';
var currentChartMetric = 'aum';
var currentOrgScope = 'all';
var allResults = { lenders: [], beneficiaries: [], funds: [], assets: [], projects: [] };
var globalSummary = { kpi: {}, lenders: [], beneficiaries: [], sectors: [], maturities: [] };
var fundSearchColumns = ['fund_name', 'fund_id', 'short_name'];
var lastTargetFunds = [];
var allFunds = [];
var allFundAssets = [];
var analysisFilters = {};
var analysisView = 'year';
var analysisMode = 'aum';
var currentView = 'list';
var currentDrawerData = null;

var AUM_METRIC_CONFIG = {
  benchmark_aum: {
    label: '약정액 기준 AUM',
    shortLabel: '약정액',
    aum: 'benchmark_aum',
    equity: 'equity_won',
    loan: 'loan_won',
    deposit: 'deposit_won'
  },
  invested_aum: {
    label: '투입액 기준 AUM',
    shortLabel: '투입액',
    aum: 'invested_aum',
    equity: 'invested_equity_won',
    loan: 'invested_loan_won',
    deposit: 'invested_deposit_won'
  }
};

window._supabase = _supabase;
window.searchInput = searchInput;
window.resultsContainer = resultsContainer;
window.detailPanel = detailPanel;
window.tabBtns = tabBtns;
window.allResults = allResults;
window.globalSummary = globalSummary;
window.fundSearchColumns = fundSearchColumns;
window.lastTargetFunds = lastTargetFunds;
window.allFunds = allFunds;
window.allFundAssets = allFundAssets;
window.analysisFilters = analysisFilters;
window.analysisView = analysisView;
window.analysisMode = analysisMode;
window.currentView = currentView;
window.currentDrawerData = currentDrawerData;
window.AUM_METRIC_CONFIG = AUM_METRIC_CONFIG;
window.currentAumBasis = currentAumBasis;
window.currentChartMetric = currentChartMetric;

var EXCLUDE_DEPTS = window.EXCLUDE_DEPTS || [
  '인프라전략',
  '기업&인프라',
  '헤지펀드운용',
  '대체증권투자',
  '상품솔루션',
  '채권투자',
  '상장리츠',
  '사모리츠',
  'CM그룹',
  '전략리서치'
];

function getFundPrimaryName(fund) {
  return fund.project_mission_name || fund.fund_name || fund.short_name || fund.fund_id;
}

function getFundSecondaryName(fund) {
  if (fund.project_mission_name && fund.fund_name && fund.project_mission_name !== fund.fund_name) {
    return fund.fund_name;
  }
  return '';
}

function isRAFund(f) {
  if (currentOrgScope === 'all') return true;
  var division = f.metadata?.division || '';
  var dept = f.dept || f.metadata?.department || '';
  
  // 리얼에셋부문 키워드가 있으면 RA펀드로 간주
  if (division.includes('리얼에셋') || division.includes('RA') || division.includes('\U000ff87c') || division.includes('󿡼') || division.includes('ºι')) return true;
  
  // 제외 부서 리스트 체크
  return !EXCLUDE_DEPTS.some(function (kw) { return dept.includes(kw); });
}

var isValidKey = function (v) {
  if (!v) return false;
  var s = String(v).trim().toLowerCase();
  var BLACKLIST_PNU = ['4159510100108610017'];
  if (BLACKLIST_PNU.includes(s)) return false;
  return s !== '' && s !== '-' && s !== '0' && s !== 'null' && s !== 'undefined' && s !== 'n/a' && s !== 'none' && s !== 'nan';
};

function groupItems(list, typeMark, forcedMetric) {
  var groups = {};
  if (!list) return [];
  var metric = forcedMetric || currentChartMetric;
  var amountColumn = getMetricColumn(metric);

  list.forEach(function (f) {
    var aum = metric === 'count' ? 1 : getFundAmountWon(f, amountColumn);
    if (metric !== 'count' && aum <= 0) return;

    var rawName = f.fund_name || f.metadata?.fund_name || '명칭 미상';
    var shortName = f.metadata?.short_name || f.short_name;
    var pnu = window.fundToPnu?.[f.fund_id];

    var cleanName = String(rawName).split('(')[0].trim();
    cleanName = cleanName.replace(/[- ]제?\d+호$/, '호');

    var parentId = isValidKey(f.metadata?.parent_fund_id) ? f.metadata.parent_fund_id : null;
    var validPnu = isValidKey(pnu) ? pnu : null;

    var key = parentId || validPnu || cleanName;
    var displayName = (shortName && shortName.length > 2) ? shortName : cleanName;

    if (!groups[key]) groups[key] = { name: displayName, aum: 0, key: key };
    groups[key].aum += (metric === 'count' ? 1 : aum);
  });

  return Object.entries(groups).map(function (entry) {
    var v = entry[1];
    return { name: v.name, aum: v.aum, type: typeMark, key: v.key };
  });
}

function formatNumber(num) {
  if (!num) return '0';
  var absNum = Math.abs(num);
  var eok = Math.floor(absNum / 100000000);
  if (eok >= 10000) {
    var jo = Math.floor((absNum / 1000000000000) * 100) / 100;
    return (num < 0 ? '-' : '') + jo.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '조';
  }
  return (num < 0 ? '-' : '') + eok.toLocaleString() + '억';
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  var parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataAmountToWon(value) {
  var amount = toNumber(value);
  if (!amount) return 0;
  return amount;
}

function getFieldValue(fund, key) {
  if (!fund) return null;
  
  // 1. 우선 순위: DB 정규 컬럼 직접 참조 (최고 성능)
  var direct = fund[key];
  if (direct !== undefined && direct !== null && String(direct).trim() !== '') return direct;

  // 2. 차선 순위: 정규화된 필드 매핑 (Alias)
  var fallbacks = {
    division: [fund.division],
    department: [fund.dept],
    vehicle_type: [fund.notion_vehicle_class],
    recruitment_type: [fund.recruitment_type],
    fund_class: [fund.fund_class, fund.notion_fund_class],
    legal_form: [fund.legal_form],
    fund_type: [fund.fund_type],
    investment_strategy: [fund.notion_investment_strategy_class],
    parent_child_type: [fund.notion_holding_type_class],
    domestic_overseas: [fund.location],
    primary_region: [fund.primary_region, fund.location],
    base_asset_class: [fund.notion_base_asset_class],
    asset_nature_class: [fund.notion_asset_nature_class],
    business_stage_class: [fund.is_development, fund.notion_business_stage_class],
    aum_status: [fund.aum_status],
    setup_date: [fund.setup_date]
  };

  var candidates = fallbacks[key] || [];
  for (var i = 0; i < candidates.length; i++) {
    var value = candidates[i];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }

  // 3. 최종 순위: 예외적인 경우에만 metadata 확인 (백업용)
  if (fund.metadata && fund.metadata[key] !== undefined) return fund.metadata[key];

  return null;
}

function getAumMetricConfig(metric) {
  return AUM_METRIC_CONFIG[metric] || AUM_METRIC_CONFIG.benchmark_aum;
}

function getAumBasisMetric() {
  return currentAumBasis === 'invested_aum' ? 'invested_aum' : 'benchmark_aum';
}

function getMetricColumn(metric, basis) {
  if (metric === 'count') return 'count';
  var config = getAumMetricConfig(basis || getAumBasisMetric());
  return config[metric] || config.aum;
}

function getMetricLabel(metric) {
  if (metric === 'count') return '건수';
  var labels = { aum: 'AUM', equity: 'Equity', loan: 'Loan', deposit: '임대보증금' };
  return getAumMetricConfig(getAumBasisMetric()).shortLabel + ' ' + (labels[metric] || 'AUM');
}

function getFundAmountWon(fund, key) {
  // key가 이미 DB 컬럼명이나 메타데이터 키와 일치하도록 매핑
  const val = getFieldValue(fund, key);
  return metadataAmountToWon(val);
}

function getFundStatus(fund) {
  return fund?.status || fund?.metadata?.status || '';
}

function getFundAumStatus(fund) {
  return getFieldValue(fund, 'aum_status') || getFundStatus(fund);
}

function isAumCountedFund(fund) {
  // 모자구분(parent_child_type)이 '자펀드'인 경우 중복 집계 방지를 위해 제외
  var type = getFieldValue(fund, 'parent_child_type') || '';
  if (type.includes('자펀드') || type === '자') return false;
  
  // 펀드명에 '자펀드' 키워드가 명시적으로 포함된 경우도 예외 처리 (필요 시)
  // var name = fund.fund_name || '';
  // if (name.includes('(자)') || name.includes('자펀드')) return false;

  return true;
}

function getFundSector(fund) {
  return getFieldValue(fund, 'investment_sector') || getFieldValue(fund, 'sector') || '미분류';
}

function getFundRegion(fund) {
  var region = getFieldValue(fund, 'domestic_overseas') || getFieldValue(fund, 'primary_region') || '미분류';
  return String(region).trim() || '미분류';
}

function isOverseasFund(fund) {
  var text = [
    getFieldValue(fund, 'domestic_overseas'),
    getFieldValue(fund, 'primary_region'),
    fund?.fund_name,
    fund?.asset_name
  ].filter(Boolean).join(' ');
  return /해외|글로벌|미국|영국|유럽|북미|아시아|일본|베트남|프랑스|이탈리아|스페인|호주/.test(text);
}

function getFundSetupDate(fund) {
  return fund?.setup_date || fund?.metadata?.setup_date || fund?.metadata?.first_setup_date;
}

function getFundEndDate(fund) {
  return fund?.termination_date || fund?.metadata?.termination_date || fund?.maturity_date || fund?.metadata?.maturity_date;
}

function getSearchTerms(query) {
  var parts = String(query).toLowerCase().split(/\s+/).filter(function (p) {
    return p.length > 0;
  });
  var aliases = window.ALIASES || {};
  var expanded = [];
  parts.forEach(function (p) {
    if (aliases[p]) expanded = expanded.concat(aliases[p]);
    else expanded.push(p);
  });
  return Array.from(new Set(expanded));
}

function buildUniversalFilter(cols, terms) {
  return cols.map(function (col) {
    return terms.map(function (term) {
      return col + '.ilike.%' + term + '%';
    }).join(',');
  }).join(',');
}

async function ensureAllDataLoaded() {
  if (window.allFunds?.length === 0 || !window.allFunds) {
    try {
      var responses = await Promise.all([
        fetchAllRows('funds', '*'),
        fetchAllRows('fund_assets', '*')
      ]);

      allFunds = responses[0] || [];
      
      // Clean garbled organizational data for UI display
      allFunds.forEach(f => {
        if (f.metadata) {
          const div = f.metadata.division;
          if (div && (div.includes('\U000ff87c') || div.includes('󿡼') || div.includes('ºι'))) {
            f.metadata.division = '리얼에셋부문';
          }
        }
      });

      allFundAssets = responses[1] || [];
      window.allFunds = allFunds;
      window.allFundAssets = allFundAssets;

      // 데이터 로딩 후 필터 목록 재생성 (리팩토링 후 필터 유실 방지)
      if (typeof window.initAnalysisFilters === 'function') {
        window.initAnalysisFilters();
      }
    } catch (e) {
      console.error(e);
    }
  }

  return { funds: window.allFunds, assets: window.allFundAssets };
}

async function fetchAllRows(tableName, selectClause, pageSize) {
  var size = pageSize || 1000;
  var from = 0;
  var rows = [];

  while (true) {
    var to = from + size - 1;
    var response = await _supabase.from(tableName).select(selectClause).range(from, to);
    if (response.error) throw response.error;

    var page = response.data || [];
    rows = rows.concat(page);
    if (page.length < size) break;
    from += size;
  }

  return rows;
}

window.EXCLUDE_DEPTS = EXCLUDE_DEPTS;
window.getFundPrimaryName = getFundPrimaryName;
window.getFundSecondaryName = getFundSecondaryName;
window.isRAFund = isRAFund;
window.isValidKey = isValidKey;
window.groupItems = groupItems;
window.formatNumber = formatNumber;
window.toNumber = toNumber;
window.metadataAmountToWon = metadataAmountToWon;
window.getFundAmountWon = getFundAmountWon;
window.getFundStatus = getFundStatus;
window.getFundAumStatus = getFundAumStatus;
window.isAumCountedFund = isAumCountedFund;
window.getFundSector = getFundSector;
window.getFundRegion = getFundRegion;
window.getSearchTerms = getSearchTerms;
window.buildUniversalFilter = buildUniversalFilter;
window.ensureAllDataLoaded = ensureAllDataLoaded;
window.fetchAllRows = fetchAllRows;
window.getFieldValue = getFieldValue;
window.getAumMetricConfig = getAumMetricConfig;
window.getAumBasisMetric = getAumBasisMetric;
window.getMetricColumn = getMetricColumn;
window.getMetricLabel = getMetricLabel;
window.isOverseasFund = isOverseasFund;
window.getFundSetupDate = getFundSetupDate;
window.getFundEndDate = getFundEndDate;
