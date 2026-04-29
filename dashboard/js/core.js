const { createClient } = supabase;
var _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

var searchInput = document.getElementById('searchInput');
var resultsContainer = document.getElementById('results');
var detailPanel = document.getElementById('detailPanel');
var tabBtns = document.querySelectorAll('.tab-btn');

var debounceTimer;
var currentTab = 'all';
var currentChartMetric = 'benchmark_aum';
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

var EXCLUDE_DEPTS = window.EXCLUDE_DEPTS || [
  '인프라전략',
  '기업&인프라',
  '헤지펀드운용',
  '대체증권투자',
  '상품솔루션',
  '채권투자',
  '상장리츠',
  '사모리츠',
  'CM\uADF8\uB8F9',
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
  var division = f.metadata?.notion_division_class || '';
  var dept = f.metadata?.notion_dept_class || f.metadata?.department || '';
  
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

  list.forEach(function (f) {
    var aum = getFundAmountWon(f, metric);
    if (metric !== 'count' && aum <= 0) return;

    var rawName = f.fund_name || f.metadata?.fund_name || '\uBA85\uCE6D \uBBF8\uC0C1';
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
    var jo = (absNum / 1000000000000).toFixed(2);
    return (num < 0 ? '-' : '') + jo.toLocaleString() + '\uC870';
  }
  return (num < 0 ? '-' : '') + eok.toLocaleString() + '\uC5B5';
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
  return Math.abs(amount) < 10000000 ? amount * 100000000 : amount;
}

function getFundAmountWon(fund, key) {
  var directKeys = {
    benchmark_aum: 'aum_won',
    committed_equity: 'equity_won',
    committed_debt: 'loan_won',
    lease_deposit: 'deposit_won'
  };
  var directKey = directKeys[key];
  if (directKey && fund?.[directKey] !== undefined) return toNumber(fund[directKey]);
  return metadataAmountToWon(fund?.metadata?.[key]);
}

function getFundStatus(fund) {
  return fund?.status || fund?.metadata?.status || '';
}

function getFundSector(fund) {
  return fund?.sector || fund?.metadata?.sector || '\uBBF8\uBD84\uB958';
}

function getFundRegion(fund) {
  var region = fund?.location || fund?.metadata?.region || '\uBBF8\uBD84\uB958';
  return String(region).trim() || '\uBBF8\uBD84\uB958';
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
        _supabase.from('funds').select('*'),
        _supabase.from('fund_assets').select('*')
      ]);
      var fundRes = responses[0];
      var assetRes = responses[1];

      allFunds = fundRes.data || [];
      
      // Clean garbled organizational data for UI display
      allFunds.forEach(f => {
        if (f.metadata) {
          const div = f.metadata.notion_division_class;
          if (div && (div.includes('\U000ff87c') || div.includes('󿡼') || div.includes('ºι'))) {
            f.metadata.notion_division_class = '리얼에셋부문';
          }
        }
      });

      allFundAssets = assetRes.data || [];
      window.allFunds = allFunds;
      window.allFundAssets = allFundAssets;
    } catch (e) {
      console.error(e);
    }
  }

  return { funds: window.allFunds, assets: window.allFundAssets };
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
window.getFundSector = getFundSector;
window.getFundRegion = getFundRegion;
window.getSearchTerms = getSearchTerms;
window.buildUniversalFilter = buildUniversalFilter;
window.ensureAllDataLoaded = ensureAllDataLoaded;
