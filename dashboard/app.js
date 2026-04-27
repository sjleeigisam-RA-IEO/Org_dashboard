const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const detailPanel = document.getElementById('detailPanel');
const tabBtns = document.querySelectorAll('.tab-btn');

let debounceTimer;
let currentTab = 'all';
let currentChartMetric = 'benchmark_aum';
let currentOrgScope = 'all';
let allResults = { lenders: [], beneficiaries: [], funds: [], assets: [], projects: [] };
let globalSummary = { kpi: {}, lenders: [], beneficiaries: [], sectors: [], maturities: [] };
let fundSearchColumns = ['fund_name', 'fund_id', 'short_name'];
let lastTargetFunds = [];

const EXCLUDE_DEPTS = [
  '인프라전략', '기업&인프라', 
  '헤지펀드운용', '대체증권투자', '상품솔루션', '채권투자',
  '상장리츠', '사모리츠',
  'CM그룹', '전략리서치'
];

function isRAFund(f) {
  if (currentOrgScope === 'all') return true;
  const dept = f.metadata?.department || '';
  return !EXCLUDE_DEPTS.some(kw => dept.includes(kw));
}

// 데이터 유효성 검사 유틸리티 (쓰레기 값 및 공통 더미 지번 필터링)
const isValidKey = (v) => {
    if (!v) return false;
    const s = String(v).trim().toLowerCase();
    // 공통 더미 PNU (본사 주소 등 184개 이상이 공유하는 가짜 키)
    const BLACKLIST_PNU = ['4159510100108610017'];
    if (BLACKLIST_PNU.includes(s)) return false;
    
    return s !== '' && s !== '-' && s !== '0' && s !== 'null' && s !== 'undefined' && s !== 'n/a' && s !== 'none' && s !== 'nan';
};

function groupItems(list, typeMark, forcedMetric = null) {
    const groups = {};
    if (!list) return [];
    const metric = forcedMetric || currentChartMetric;
    
    list.forEach(f => {
        const aum = getFundAmountWon(f, metric);
        if (metric !== 'count' && aum <= 0) return; 

        const rawName = f.fund_name || f.metadata?.fund_name || '명칭 미상';
        const shortName = f.metadata?.short_name || f.short_name;
        const pnu = window.fundToPnu?.[f.fund_id];
        
        let cleanName = String(rawName).split('(')[0].trim();
        cleanName = cleanName.replace(/[- ]제?\d+호$/, '호');
        
        // 고유 키 생성 (쓰레기 값 필터링 적용)
        const parentId = isValidKey(f.metadata?.parent_fund_id) ? f.metadata.parent_fund_id : null;
        const validPnu = isValidKey(pnu) ? pnu : null;
        
        const key = parentId || validPnu || cleanName;
        const displayName = (shortName && shortName.length > 2) ? shortName : cleanName;
        
        if (!groups[key]) groups[key] = { name: displayName, aum: 0, key: key };
        groups[key].aum += (metric === 'count' ? 1 : aum);
    });
    return Object.entries(groups).map(([k, v]) => ({ name: v.name, aum: v.aum, type: typeMark, key: v.key }));
}

window.toggleOrgScope = () => {
    currentOrgScope = (currentOrgScope === 'all' ? 'ra' : 'all');
    
    // UI 업데이트
    const toggleEl = document.getElementById('orgToggle');
    toggleEl.setAttribute('data-active', currentOrgScope);
    
    const segments = toggleEl.querySelectorAll('.segment');
    segments.forEach(s => {
        if (s.getAttribute('data-val') === currentOrgScope) s.classList.add('active');
        else s.classList.remove('active');
    });

    renderAnalytics();
};

window.closeDrawer = () => {
    document.getElementById('sideDrawer').classList.remove('active');
    document.getElementById('sideDrawerOverlay').classList.remove('active');
};

window.openFundDetail = (groupKey, groupName) => {
    if (!groupKey || String(groupKey).trim() === '' || groupKey === 'undefined' || groupKey === 'null') return;

    // 상세 조회는 전사 데이터를 대상으로 함 (부문/상세 필터 제거)
    const allFunds = window.lastTargetFunds || [];

    const filtered = allFunds.filter(f => {
        // 현재 토글 상태(currentOrgScope)가 'ra'일 때만 부문 필터 적용
        if (currentOrgScope === 'ra' && !isRAFund(f)) return false;

        const rawName = f.fund_name || f.metadata?.fund_name || '';
        const pnu = window.fundToPnu?.[f.fund_id];
        
        let cleanName = String(rawName).split('(')[0].trim().replace(/[- ]제?\d+호$/, '호');
        const parentId = isValidKey(f.metadata?.parent_fund_id) ? f.metadata.parent_fund_id : null;
        const validPnu = isValidKey(pnu) ? pnu : null;
        const key = parentId || validPnu || cleanName;
        
        return String(key).trim() === String(groupKey).trim();
    });

    const header = document.getElementById('drawerHeader');
    const content = document.getElementById('drawerContent');
    
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
                <p style="color:var(--accent); font-size:12px; font-weight:800; margin-bottom:8px; letter-spacing:1px;">ASSET DEEP-DIVE</p>
                <h2 style="font-size:24px; font-weight:800; line-height:1.3;">${groupName}</h2>
                <p style="margin-top:12px; color:var(--muted); font-size:14px;">총 ${filtered.length}개의 관련 펀드가 검색되었습니다.</p>
            </div>
            <div style="background:#f1f5f9; padding:8px 12px; border-radius:8px; font-family:monospace; font-size:11px; color:#64748b; border:1px solid #e2e8f0;">
                ID: ${groupKey}
            </div>
        </div>
    `;

    content.innerHTML = filtered.map(f => {
        const aum = getFundAmountWon(f, 'benchmark_aum');
        return `
            <div class="fund-detail-card">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3 style="font-size:16px; font-weight:800; flex:1; margin-right:16px;">${f.fund_name}</h3>
                    <span style="padding:4px 10px; border-radius:8px; font-size:11px; font-weight:800; background:#f1f5f9; color:#475569;">${getFundStatus(f)}</span>
                </div>
                <div class="meta-grid">
                    <div class="meta-item"><span class="meta-label">운용규모(AUM)</span><span class="meta-val">${formatNumber(aum)}</span></div>
                    <div class="meta-item"><span class="meta-label">담당부서</span><span class="meta-val">${f.metadata?.department || '-'}</span></div>
                    <div class="meta-item"><span class="meta-label">설정일</span><span class="meta-val">${f.metadata?.setup_date || '-'}</span></div>
                    <div class="meta-item"><span class="meta-label">만기/청산일</span><span class="meta-val">${f.metadata?.termination_date || f.metadata?.maturity_date || '-'}</span></div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('sideDrawer').classList.add('active');
    document.getElementById('sideDrawerOverlay').classList.add('active');
};

const OPTIONAL_FUND_SEARCH_COLUMNS = [
  'project_mission_name',
  'notion_base_asset_class',
  'notion_asset_nature_class',
  'notion_holding_type_class',
  'notion_business_stage_class',
  'notion_investment_strategy_class',
  'notion_vehicle_class'
];

const ALIASES = {
  "nps": ["국민연금", "nps"], "국민연금": ["국민연금", "nps"],
  "kic": ["한국투자공사", "kic"], "신한": ["신한", "shinhan"],
  "kb": ["국민은행", "kb"], "하나": ["하나", "hana"], "우리": ["우리", "woori"]
};

function formatNumber(num) {
  if (!num) return '0';
  const absNum = Math.abs(num);
  const eok = Math.floor(absNum / 100000000);
  if (eok >= 10000) {
    const jo = (absNum / 1000000000000).toFixed(2);
    return (num < 0 ? '-' : '') + jo.toLocaleString() + '조';
  }
  return (num < 0 ? '-' : '') + eok.toLocaleString() + '억';
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataAmountToWon(value) {
  const amount = toNumber(value);
  if (!amount) return 0;
  // Metadata values are typically in '억원' unless they are already large '원' values
  return Math.abs(amount) < 10000000 ? amount * 100000000 : amount;
}

function getFundAmountWon(fund, key) {
  const directKeys = {
    benchmark_aum: 'aum_won',
    committed_equity: 'equity_won',
    committed_debt: 'loan_won',
    lease_deposit: 'deposit_won'
  };
  const directKey = directKeys[key];
  if (directKey && fund?.[directKey] !== undefined) return toNumber(fund[directKey]);
  return metadataAmountToWon(fund?.metadata?.[key]);
}

function getFundStatus(fund) {
  return fund?.status || fund?.metadata?.status || '';
}

function getFundSector(fund) {
  return fund?.sector || fund?.metadata?.sector || '미분류';
}

function getFundRegion(fund) {
  const region = fund?.location || fund?.metadata?.region || '미분류';
  return String(region).trim() || '미분류';
}

function getSearchTerms(query) {
  const parts = query.toLowerCase().split(/\s+/).filter(p => p.length > 0);
  let expanded = [];
  parts.forEach(p => {
    if (ALIASES[p]) expanded = expanded.concat(ALIASES[p]);
    else expanded.push(p);
  });
  return [...new Set(expanded)];
}

function buildUniversalFilter(cols, terms) {
  return cols.map(col => terms.map(term => `${col}.ilike.%${term}%`).join(',')).join(',');
}

async function ensureFundSearchColumns() {
  try {
    const { data } = await _supabase.from('funds').select('*').limit(1);
    const sample = data?.[0];
    if (!sample) return;
    fundSearchColumns = [
      'fund_name', 'fund_id', 'short_name',
      ...OPTIONAL_FUND_SEARCH_COLUMNS.filter(col => col in sample)
    ];
  } catch (error) { console.error(error); }
}

async function performSearch(query) {
  if (!query) {
    resultsContainer.innerHTML = '<div class="no-results">조회를 시작하세요.</div>';
    updateTabCounts();
    return;
  }
  const terms = getSearchTerms(query);
  try {
    await ensureFundSearchColumns();
    const [lenderRes, benRes, fundRes, assetRes] = await Promise.all([
      _supabase.from('lender_exposures').select('*, funds(*)').or(buildUniversalFilter(['lender_clean', 'fund_id'], terms)).limit(100),
      _supabase.from('beneficiary_exposures').select('*, funds(*)').or(buildUniversalFilter(['beneficiary_clean', 'fund_id'], terms)).limit(100),
      _supabase.from('funds').select('*').or(buildUniversalFilter(fundSearchColumns, terms)).limit(100),
      _supabase.from('fund_assets').select('*, funds(*)').or(buildUniversalFilter(['asset_name', 'fund_id'], terms)).limit(100)
    ]);
    const projects = (fundRes.data || []).filter(f => f.project_mission_name || f.notion_base_asset_class);
    const normalFunds = (fundRes.data || []).filter(f => !f.project_mission_name && !f.notion_base_asset_class);

    allResults = { 
      lenders: lenderRes.data || [], 
      beneficiaries: benRes.data || [], 
      funds: normalFunds, 
      assets: assetRes.data || [],
      projects: projects
    };
    updateTabCounts();
    renderResults();
  } catch (error) { console.error(error); }
}

function updateTabCounts() {
  const counts = {
    all: allResults.lenders.length + allResults.beneficiaries.length + allResults.funds.length + allResults.assets.length + allResults.projects.length,
    fund: allResults.funds.length, asset: allResults.assets.length, ben: allResults.beneficiaries.length, lender: allResults.lenders.length, project: allResults.projects.length
  };
  tabBtns.forEach(btn => {
    const tab = btn.dataset.tab;
    const count = counts[tab] || 0;
    btn.innerHTML = `${btn.textContent.split(' ')[0]} <span style="opacity:0.4; font-size:0.8em; margin-left:4px;">${count}</span>`;
  });
}

function renderResults() {
  resultsContainer.innerHTML = '';
  const groupedLenders = groupBy(allResults.lenders, 'lender_clean');
  const groupedBens = groupBy(allResults.beneficiaries, 'beneficiary_clean');
  const groupedAssets = groupBy(allResults.assets, 'asset_name');
  const groupedFunds = groupBy(allResults.funds, 'fund_name');
  const groupedProjects = groupBy(allResults.projects, 'fund_name');

  if (currentTab === 'all' || currentTab === 'project') Object.keys(groupedProjects).forEach(k => renderGroupCard('project', k, groupedProjects[k]));
  if (currentTab === 'all' || currentTab === 'fund') Object.keys(groupedFunds).forEach(k => renderGroupCard('fund', k, groupedFunds[k]));
  if (currentTab === 'all' || currentTab === 'asset') Object.keys(groupedAssets).forEach(k => renderGroupCard('asset', k, groupedAssets[k]));
  if (currentTab === 'all' || currentTab === 'lender') Object.keys(groupedLenders).forEach(n => renderGroupCard('lender', n, groupedLenders[n]));
  if (currentTab === 'all' || currentTab === 'ben') Object.keys(groupedBens).forEach(n => renderGroupCard('ben', n, groupedBens[n]));
}

function groupBy(list, key) {
  return list.reduce((acc, obj) => {
    let val = obj[key];
    if (key === 'asset_name') val = obj.metadata?.pnu || obj.pnu || obj.asset_name;
    else if (key === 'fund_name' || key === 'fund_id') val = obj.metadata?.parent_fund_id || obj.parent_fund_id || obj.fund_id;
    acc[val] = acc[val] || [];
    acc[val].push(obj);
    return acc;
  }, {});
}

function renderGroupCard(type, name, items) {
  const isSelected = portfolioBasket.some(i => i.key === `${type}_${name}`);
  const count = items.length;
  const card = document.createElement('div');
  card.className = 'group-card';
  if (isSelected) card.style.borderColor = 'var(--accent)';

  let subTitle = (type === 'asset' ? (items[0].metadata?.pnu || items[0].pnu) : items[0].fund_id) || '';

  card.innerHTML = `
    <div class="group-header">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${items[0].short_name ? '[' + items[0].short_name + '] ' : ''}${name}</div>
        <div class="group-meta">${subTitle}${count > 1 ? ` | ${count}건 참여` : ''}</div>
      </div>
      <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''} 
        onclick="toggleBasket(event, '${type}', '${name}', ${JSON.stringify(items).replace(/"/g, '&quot;')})">
      <div class="toggle-icon">${count > 1 ? '▼' : '▶'}</div>
    </div>
    <div class="sub-list" style="display:none">
      ${items.map(i => `<div class="sub-item" data-id="${i.fund_id}">• ${i.funds?.fund_name || i.fund_name || i.fund_id}</div>`).join('')}
    </div>
  `;
  card.querySelector('.group-header').addEventListener('click', (e) => {
    if (e.target.type === 'checkbox') return;
    if (count > 1) {
      const sl = card.querySelector('.sub-list');
      sl.style.display = sl.style.display === 'none' ? 'block' : 'none';
    }
    showDetail({type, items, targetName: name});
  });
  resultsContainer.appendChild(card);
}

async function showDetail(obj) {
  const { type, items, targetName } = obj;
  const fundIds = items.map(i => i.fund_id);
  detailPanel.innerHTML = '<div class="no-results">상세 로딩 중...</div>';
  try {
    const [fundRes, assetRes, lenderRes, benRes] = await Promise.all([
      _supabase.from('funds').select('*').in('fund_id', fundIds),
      _supabase.from('fund_assets').select('*').in('fund_id', fundIds),
      _supabase.from('lender_exposures').select('*').in('fund_id', fundIds),
      _supabase.from('beneficiary_exposures').select('*').in('fund_id', fundIds)
    ]);
    const f = fundRes.data?.[0] || items[0];
    const a = assetRes.data?.find(x => x.asset_name === targetName) || assetRes.data?.[0] || {};
    
    detailPanel.innerHTML = `
      <div class="detail-header">
        <span class="card-tag tag-fund">ASSET PROFILE</span>
        <h2>${a.asset_name || f.fund_name}</h2>
        <div style="color:var(--muted); font-size:16px;">${fundIds.join(', ')} | ${f.dept || '-'}</div>
      </div>
      <div class="detail-section">
        <div class="section-title">🏢 자산 상세</div>
        <div class="asset-specs-grid">
           <table class="data-table">
              <tr><th>주소</th><td>${a.address || '-'}</td></tr>
              <tr><th>연면적</th><td>${a.gfa ? a.gfa.toLocaleString() + '㎡' : '-'}</td></tr>
              <tr><th>주용도</th><td>${a.main_usage || '-'}</td></tr>
           </table>
           <div id="vmap" style="height:200px; background:#f1f5f9; border-radius:12px;"></div>
        </div>
      </div>
      <div class="detail-section">
        <div class="section-title">💰 대주단/수익자 현황</div>
        <table class="data-table">
           <thead><tr><th>기관명</th><th>금액</th><th>역할</th></tr></thead>
           <tbody>
              ${lenderRes.data?.map(l => `<tr><td>${l.lender_clean}</td><td>${formatNumber(l.drawn_amt)}</td><td>Lender</td></tr>`).join('') || ''}
              ${benRes.data?.map(b => `<tr><td>${b.beneficiary_clean}</td><td>${formatNumber(b.invested_amt)}</td><td>Investor</td></tr>`).join('') || ''}
           </tbody>
        </table>
      </div>
    `;
  } catch (e) { console.error(e); detailPanel.innerHTML = '오류 발생'; }
}

let portfolioBasket = [];
function toggleBasket(event, type, name, items) {
  event.stopPropagation();
  const basketKey = `${type}_${name}`;
  const index = portfolioBasket.findIndex(i => i.key === basketKey);
  if (index > -1) portfolioBasket.splice(index, 1);
  else portfolioBasket.push({ key: basketKey, name: name, type: type, items: items });
  renderBasket();
  if (currentView === 'ranking') renderAnalytics();
}

function renderBasket() {
  const basketEl = document.getElementById('portfolioBasket');
  const itemsEl = document.getElementById('basketItems');
  if (portfolioBasket.length === 0) { basketEl.style.display = 'none'; return; }
  basketEl.style.display = 'block';
  itemsEl.innerHTML = portfolioBasket.map(item => `
    <div class="basket-chip">${item.name}<span onclick="toggleBasket(event, '${item.type}', '${item.name}', [])">✕</span></div>
  `).join('');
}

let currentView = 'list';
document.addEventListener('DOMContentLoaded', () => {
  const listBtn = document.getElementById('listViewBtn');
  const chartBtn = document.getElementById('chartViewBtn');
  if (listBtn) listBtn.addEventListener('click', () => { currentView = 'list'; listBtn.classList.add('active'); chartBtn.classList.remove('active'); renderResults(); });
  if (chartBtn) chartBtn.addEventListener('click', () => { currentView = 'ranking'; chartBtn.classList.add('active'); listBtn.classList.remove('active'); renderAnalytics(); });
  renderBasket();
});

async function renderAnalytics() {
    let targetFunds = (allResults.funds || []);
    if (targetFunds.length === 0) {
        detailPanel.innerHTML = '<div class="no-results" style="padding:100px;">전체 포트폴리오 집계 중...</div>';
        try {
            const [fundRes, assetRes] = await Promise.all([
                _supabase.from('funds').select('fund_id, fund_name, status, sector, location, metadata').limit(1000),
                _supabase.from('fund_assets').select('fund_id, metadata').limit(2000)
            ]);
            targetFunds = fundRes.data || [];
            
            // PNU 매핑 테이블 구축
            const pnuMap = {};
            (assetRes.data || []).forEach(a => {
                const pnu = a.metadata?.pnu;
                if (a.fund_id && pnu) pnuMap[a.fund_id] = pnu;
            });
            window.fundToPnu = pnuMap;

        } catch(e) { console.error(e); }
    }
    window.lastTargetFunds = targetFunds;

    const snapshotDate = new Date('2026-03-31');
    const activeFunds = targetFunds.filter(f => {
        const setup = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
        const end = f.metadata?.termination_date ? new Date(f.metadata.termination_date) : (f.metadata?.maturity_date ? new Date(f.metadata.maturity_date) : new Date('2099-12-31'));
        // Status must be '운용', date must be within range, AND match RA scope if selected
        return getFundStatus(f) === '운용' && setup && setup <= snapshotDate && end > snapshotDate && isRAFund(f);
    });

    // 집계 지표 연동 로직 (AUM vs Count)
    const totalAum = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, 'benchmark_aum'), 0);
    const totalEquity = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, 'committed_equity'), 0);
    const totalLoan = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, 'committed_debt'), 0);
    const totalOther = totalAum - totalEquity - totalLoan;

    // 좌측 KPI 카드: 무조건 AUM(금액) 기준으로 고정
    const mainLabel = '현재 운용 AUM';
    const mainValue = formatNumber(totalAum);
    const eqVal = formatNumber(totalEquity);
    const lnVal = formatNumber(totalLoan);
    const otVal = formatNumber(totalOther);

    // 우측 KPI 카드: 무조건 자산 개수(Count) 기준으로 고정
    const activeAssetCount = groupItems(activeFunds, '', 'count').length;

    // 자산 개수 상세 분류 (국내 vs 해외)
    const overseasKeywords = ['미국', '영국', '글로벌', '유럽', '해외', '북미', '아시아', '독일', '일본', '해외', '베트남', '프랑스', '이탈리아', '스페인'];
    const activeAssets = groupItems(activeFunds, '', 'count');
    const overseasAssetsCount = activeAssets.filter(item => 
        overseasKeywords.some(kw => item.name.includes(kw))
    ).length;
    const domesticAssetsCount = activeAssets.length - overseasAssetsCount;

    detailPanel.innerHTML = `
        <div class="analytics-container" style="padding-bottom:60px;">
          <div class="detail-header" style="margin-bottom:40px;">
            <p class="card-tag tag-project" style="margin-bottom:12px;">REAL-TIME PORTFOLIO TRACKER</p>
            <h2 style="font-size:32px; font-weight:800;">부문 통합 자산 성장 추이</h2>
            <p style="color:var(--muted); font-size:16px;">2010년부터 현재까지의 성장 궤적과 2026년 말 청산 가정 전망치입니다.</p>
          </div>

          <div style="display:grid; grid-template-columns: 2fr 1fr; gap:24px; margin-bottom:32px;">
            <!-- 좌측 카드: AUM 규모 및 비중 -->
            <div class="kpi-card" style="padding:40px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
              <div class="kpi-label" style="font-size:14px; letter-spacing:1px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                <span>현재 운용 AUM (2026.03.31 기준)</span>
                <div id="orgToggle" class="segmented-control" data-active="${currentOrgScope}" onclick="toggleOrgScope()">
                    <div class="segment-slider"></div>
                    <div class="segment ${currentOrgScope === 'all' ? 'active' : ''}" data-val="all">전체</div>
                    <div class="segment ${currentOrgScope === 'ra' ? 'active' : ''}" data-val="ra">RA부문</div>
                </div>
              </div>
              <div class="kpi-value" style="font-size:52px; color:var(--accent); font-weight:900; line-height:1;">${mainValue}</div>
              <div style="margin-top:32px; padding-top:24px; border-top:1px solid #e2e8f0; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:20px;">
                <div class="kpi-sub">
                  <div class="kpi-sub-label">에쿼티</div>
                  <div class="kpi-sub-value" style="color:#6366f1; font-size:18px;">${eqVal}</div>
                </div>
                <div class="kpi-sub">
                  <div class="kpi-sub-label">대출(Debt)</div>
                  <div class="kpi-sub-value" style="color:#f59e0b; font-size:18px;">${lnVal}</div>
                </div>
                <div class="kpi-sub">
                  <div class="kpi-sub-label">기타</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${otVal}</div>
                </div>
              </div>
            </div>

            <!-- 우측 카드: 개수 (국내/해외 상세) -->
            <div class="kpi-card" style="padding:40px; background:#f8fafc; border:1px solid #e2e8f0; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div class="kpi-label" style="margin-bottom:16px;">활성 운용 자산</div>
                <div class="kpi-value" style="font-size:48px; font-weight:900; color:var(--text);">${activeAssets.length}<span style="font-size:18px; font-weight:500; margin-left:4px; color:var(--muted);">개</span></div>
              </div>
              <div style="margin-top:24px; padding-top:20px; border-top:1px dashed #cbd5e1; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <div class="kpi-sub">
                  <div class="kpi-sub-label">국내</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${domesticAssetsCount}<span style="font-size:12px; margin-left:2px;">개</span></div>
                </div>
                <div class="kpi-sub">
                  <div class="kpi-sub-label">해외</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${overseasAssetsCount}<span style="font-size:12px; margin-left:2px;">개</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="detail-section" style="padding:40px; background:white; border-radius:24px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
            <h3 class="section-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:40px;">
              <span style="font-size:20px; font-weight:800;">📈 연도별 포트폴리오 성장 궤적 (2010 - 2026)</span>
              <div class="chart-toggle-group" style="display:flex; background:#f1f5f9; padding:4px; border-radius:12px; gap:4px;">
                 <button id="toggle-benchmark_aum" class="chart-toggle-btn ${currentChartMetric === 'benchmark_aum' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('benchmark_aum')">AUM</button>
                 <button id="toggle-committed_debt" class="chart-toggle-btn ${currentChartMetric === 'committed_debt' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('committed_debt')">Loan</button>
                 <button id="toggle-committed_equity" class="chart-toggle-btn ${currentChartMetric === 'committed_equity' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('committed_equity')">Equity</button>
                 <button id="toggle-count" class="chart-toggle-btn ${currentChartMetric === 'count' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('count')">Count</button>
              </div>
            </h3>
            
            <div id="mainGrowthChart" style="min-height:450px; margin-bottom:60px;"></div>

             <div style="margin-top:80px; border-top:1px solid var(--line); padding-top:60px;">
               <h4 style="font-size:15px; font-weight:700; margin-bottom:20px; color:var(--muted); display:flex; align-items:center; justify-content:space-between;">
                 <div style="display:flex; align-items:center;">
                   <span style="width:8px; height:8px; background:#f59e0b; border-radius:2px; margin-right:10px;"></span>
                   연도별 순증감 추이 (Annual Net Change)
                 </div>
                 <span style="font-size:12px; color:var(--accent); background:#eff6ff; padding:2px 8px; border-radius:6px;">${currentOrgScope === 'ra' ? 'RA 부문 전용' : '전체 포트폴리오'}</span>
               </h4>
            <div id="netGrowthChart" style="min-height:350px;"></div>
            <div id="drillDownResult" style="margin-top:48px; display:none; animation: fadeIn 0.4s ease;">
               <!-- 리스트가 여기에 렌더링됨 -->
            </div>
          </div>
        </div>
        <style>
          /* Modern Segmented Control (Toggle) */
          .segmented-control {
            display: flex; background: #f1f5f9; padding: 4px; border-radius: 12px;
            position: relative; width: 140px; cursor: pointer; border: 1px solid #e2e8f0;
          }
          .segment {
            flex: 1; text-align: center; padding: 6px 0; font-size: 11px; font-weight: 700;
            color: #64748b; z-index: 1; transition: color 0.3s; position: relative;
          }
          .segment.active { color: var(--accent); }
          .segment-slider {
            position: absolute; top: 4px; left: 4px; width: calc(50% - 4px); height: calc(100% - 8px);
            background: white; border-radius: 9px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .segmented-control[data-active="ra"] .segment-slider { transform: translateX(100%); }
        </style>
    `;

    renderHistory('mainGrowthChart');
    renderNetGrowth('netGrowthChart');
}

window.switchMetric = (metric) => {
    currentChartMetric = metric;
    renderAnalytics();
};

window.switchScope = (scope) => {
    window.currentScope = scope;
    renderAnalytics();
};

const renderNetChangeDetails = (label) => {
    const drillPanel = document.getElementById('drillDownResult');
    const targetFunds = window.lastTargetFunds || [];
    if (!drillPanel || targetFunds.length === 0) return;

    drillPanel.style.display = 'block';
    drillPanel.innerHTML = `<div style="text-align:center; padding:40px; color:var(--muted);">데이터 분석 중...</div>`;

    let startDate, endDate, title;
    if (label === '2026 (Actual)') {
        startDate = new Date('2026-01-01'); endDate = new Date('2026-03-31'); title = '2026년 1분기 주요 변동 내역';
    } else if (label === '2026 (Proj.)') {
        startDate = new Date('2026-04-01'); endDate = new Date('2026-12-31'); title = '2026년 잔여 청산 예정 내역';
    } else {
        const year = parseInt(label);
        startDate = new Date(`${year}-01-01`); endDate = new Date(`${year}-12-31`); title = `${year}년 주요 변동 내역`;
    }

    // 신규(+) 추출
    const newlySetup = targetFunds.filter(f => {
        const setup = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
        return setup && setup >= startDate && setup <= endDate && isRAFund(f);
    });

    // 종료(-) 추출
    const terminated = targetFunds.filter(f => {
        const end = f.metadata?.termination_date ? new Date(f.metadata.termination_date) : (f.metadata?.maturity_date ? new Date(f.metadata.maturity_date) : null);
        return end && end >= startDate && end <= endDate && isRAFund(f);
    });

    try {
        const finalItems = [...groupItems(newlySetup, '+'), ...groupItems(terminated, '-')].sort((a, b) => b.aum - a.aum);

        if (finalItems.length === 0) {
            drillPanel.innerHTML = `<div style="padding:40px; text-align:center; color:var(--muted); background:#f8fafc; border-radius:20px;">해당 기간 내 신규 설정이나 청산 내역이 없습니다.</div>`;
            return;
        }

        drillPanel.innerHTML = `
            <div style="background:#f8fafc; border-radius:20px; padding:32px; border:1px solid var(--line);">
               <h4 style="font-size:18px; font-weight:800; margin-bottom:24px; display:flex; justify-content:space-between; align-items:center;">
                 <span>✨ ${title}</span>
                 <span style="font-size:13px; font-weight:normal; color:var(--muted);">${finalItems.length}개 항목</span>
               </h4>
               <table class="data-table" style="background:transparent;">
                  <thead>
                     <tr><th style="width:80px;">구분</th><th>자산/펀드명</th><th style="text-align:right;">${currentChartMetric === 'count' ? '관련 펀드 수' : `규모 (${currentChartMetric === 'benchmark_aum' ? 'AUM' : (currentChartMetric === 'committed_debt' ? 'Loan' : (currentChartMetric === 'committed_equity' ? 'Equity' : ''))})`}</th></tr>
                  </thead>
                  <tbody>
                     ${finalItems.map(item => `
                        <tr onclick="openFundDetail('${item.key}', '${item.name}')" style="cursor:pointer;">
                           <td><span style="padding:2px 8px; border-radius:4px; font-size:12px; font-weight:800; background:${item.type === '+' ? '#ecfdf5' : '#fef2f2'}; color:${item.type === '+' ? '#10b981' : '#ef4444'};">${item.type === '+' ? '신규' : '청산'}</span></td>
                           <td style="font-weight:600;">${item.name}</td>
                           <td style="text-align:right; font-weight:700;">${currentChartMetric === 'count' ? item.aum + '개' : formatNumber(item.aum)}</td>
                        </tr>
                     `).join('')}
                  </tbody>
               </table>
            </div>
        `;
        drillPanel.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } catch (e) {
        console.error("Drilldown Error:", e);
        drillPanel.innerHTML = `<div style="padding:40px; text-align:center; color:#ef4444;">데이터 분석 중 오류가 발생했습니다. (콘솔 로그 확인)</div>`;
    }
};

const renderNetGrowth = (chartId) => {
    const targetFunds = window.lastTargetFunds || [];
    if (targetFunds.length === 0) return;

    const startYear = 2010;
    const endYear = 2025;
    const categories = [];
    for (let y = startYear; y <= endYear; y++) categories.push(y.toString());
    categories.push('2026 (Actual)');
    categories.push('2026 (Proj.)');

    // 먼저 각 시점의 총액(Total)을 계산
    const totals = categories.map(cat => {
        let snapshotDate;
        if (cat === '2026 (Actual)') snapshotDate = new Date('2026-03-31');
        else if (cat === '2026 (Proj.)') snapshotDate = new Date('2026-12-31');
        else snapshotDate = new Date(`${cat}-12-31`);

        const activeInYear = targetFunds.filter(f => {
            if (!isRAFund(f)) return false;
            const setup = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
            const end = f.metadata?.termination_date ? new Date(f.metadata.termination_date) : (f.metadata?.maturity_date ? new Date(f.metadata.maturity_date) : new Date('2099-12-31'));
            if (cat.startsWith('2026') && getFundStatus(f) !== '운용') return false;
            return setup && setup <= snapshotDate && end > snapshotDate;
        });
        if (currentChartMetric === 'count') {
            const uniqueAssets = groupItems(activeInYear, '');
            return uniqueAssets.length;
        }
        return activeInYear.reduce((s, f) => s + getFundAmountWon(f, currentChartMetric), 0);
    });

    // 증감액(Delta) 계산
    const deltas = totals.map((val, idx) => {
        const prev = idx === 0 ? 0 : totals[idx - 1];
        const diff = currentChartMetric === 'count' ? (val - prev) : Math.round((val - prev) / 1e12 * 100) / 100;
        return {
            x: categories[idx],
            y: diff,
            fillColor: diff >= 0 ? (categories[idx].startsWith('2026') ? '#818cf8' : '#6366f1') : '#ef4444'
        };
    });

    const options = {
        series: [{ name: 'Net Change', data: deltas }],
        chart: { 
            type: 'bar', height: 350, toolbar: { show: false }, fontFamily: 'Pretendard Variable',
            events: {
                dataPointSelection: (event, chartContext, config) => {
                    const label = categories[config.dataPointIndex];
                    renderNetChangeDetails(label);
                }
            }
        },
        plotOptions: { 
            bar: { 
                colors: { ranges: [{ from: -1000, to: 0, color: '#ef4444' }] },
                columnWidth: '60%', borderRadius: 6, dataLabels: { position: 'top' }
            } 
        },
        dataLabels: { 
            enabled: true, 
            formatter: val => {
                if (val === 0) return '';
                const prefix = val > 0 ? '+' : '';
                return currentChartMetric === 'count' ? `${prefix}${val}개` : `${prefix}${val.toFixed(1)}조`;
            },
            offsetY: -22, style: { fontSize: '11px', fontWeight: 800, colors: ['#334155'] }
        },
        xaxis: { categories: categories, labels: { style: { fontSize: '10px' } } },
        yaxis: { labels: { formatter: val => {
            const prefix = val > 0 ? '+' : '';
            return currentChartMetric === 'count' ? `${prefix}${val}개` : `${prefix}${val.toFixed(1)}조`;
        } } },
        colors: ['#6366f1'],
        grid: { yaxis: { lines: { show: true } } },
        tooltip: { y: { formatter: val => (val > 0 ? '+' : '') + val.toLocaleString() + (currentChartMetric === 'count' ? ' 개' : ' 조원') } }
    };

    const el = document.querySelector(`#${chartId}`);
    if (el) { el.innerHTML = ''; new ApexCharts(el, options).render(); }
};

const renderHistory = (chartId) => {
    const targetFunds = window.lastTargetFunds || [];
    if (targetFunds.length === 0) return;

    const categories = [];
    for (let y = 2010; y <= 2025; y++) categories.push(y.toString());
    categories.push('2026 (Actual)', '2026 (Proj.)');

    const overseasKeywords = ['미국', '영국', '글로벌', '유럽', '해외', '북미', '아시아', '독일', '일본', '해외', '베트남', '프랑스', '이탈리아', '스페인', '유로'];
    const domesticSeries = [];
    const overseasSeries = [];

    categories.forEach(cat => {
        let snap;
        if (cat === '2026 (Actual)') snap = new Date('2026-03-31');
        else if (cat === '2026 (Proj.)') snap = new Date('2026-12-31');
        else snap = new Date(`${cat}-12-31`);

        const active = targetFunds.filter(f => {
            if (currentOrgScope === 'ra' && !isRAFund(f)) return false;
            const s = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
            const e = f.metadata?.termination_date ? new Date(f.metadata.termination_date) : (f.metadata?.maturity_date ? new Date(f.metadata.maturity_date) : new Date('2099-12-31'));
            if (cat.startsWith('2026') && getFundStatus(f) !== '운용') return false;
            return s && s <= snap && e > snap;
        });

        const overseas = active.filter(f => overseasKeywords.some(kw => (f.fund_name || f.metadata?.fund_name || '').includes(kw)));
        const domestic = active.filter(f => !overseas.includes(f));

        if (currentChartMetric === 'count') {
            domesticSeries.push(groupItems(domestic, '', 'count').length);
            overseasSeries.push(groupItems(overseas, '', 'count').length);
        } else {
            domesticSeries.push(Math.round(domestic.reduce((s, f) => s + getFundAmountWon(f, currentChartMetric), 0) / 1e11) / 10);
            overseasSeries.push(Math.round(overseas.reduce((s, f) => s + getFundAmountWon(f, currentChartMetric), 0) / 1e11) / 10);
        }
    });

    const options = {
        series: [{ name: '국내', data: domesticSeries }, { name: '해외', data: overseasSeries }],
        chart: { type: 'bar', height: 450, stacked: true, toolbar: { show: false }, fontFamily: 'Pretendard Variable' },
        colors: ['#4f46e5', '#38bdf8'],
        plotOptions: { 
            bar: { 
                columnWidth: '60%', 
                borderRadius: 6,
                dataLabels: {
                    total: {
                        enabled: true,
                        offsetY: -10,
                        style: { fontSize: '11px', fontWeight: 900, colors: ['#334155'] },
                        formatter: val => val.toLocaleString() + (currentChartMetric === 'count' ? '개' : '조')
                    }
                }
            } 
        },
        dataLabels: { enabled: false },
        xaxis: { categories: categories, labels: { style: { fontSize: '10px' } } },
        yaxis: { labels: { formatter: val => val + (currentChartMetric === 'count' ? '개' : '조') } },
        grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
        tooltip: { shared: true, y: { formatter: val => val.toLocaleString() + (currentChartMetric === 'count' ? ' 개' : ' 조원') } },
        legend: { position: 'top', horizontalAlign: 'right' }
    };

    const el = document.querySelector(`#${chartId}`);
    if (el) { el.innerHTML = ''; new ApexCharts(el, options).render(); }
};


window.switchMetric = (metric) => {
    currentChartMetric = metric;
    renderAnalytics();
};

window.switchScope = (scope) => {
    currentOrgScope = scope;
    renderAnalytics();
};

function renderDrillDown(year, category, metric) {
    const drillPanel = document.getElementById('drillDownResult');
    drillPanel.innerHTML = `<div style="font-weight:700; margin-bottom:10px;">✨ ${year}년 심층 분석</div><div style="font-size:13px; color:var(--muted);">해당 시점의 포트폴리오 구성을 분석 중입니다...</div>`;
}

searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => performSearch(e.target.value), 400);
});
