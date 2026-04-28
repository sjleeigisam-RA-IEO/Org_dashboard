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
let allFunds = []; // 전체 펀드 데이터 캐시
let allFundAssets = []; // 전체 자산 데이터 캐시
let analysisFilters = {}; // 현재 적용된 분석 필터 상태
let analysisView = 'year'; 
let analysisMode = 'aum'; 

const EXCLUDE_DEPTS = [
  '인프라전략', '기업&인프라', 
  '헤지펀드운용', '대체증권투자', '상품솔루션', '채권투자',
  '상장리츠', '사모리츠',
  'CM그룹', '전략리서치'
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
    document.getElementById('drawerNav').style.display = 'none';
};

window.openFundDetail = (groupKey, groupName) => {
    if (!groupKey || String(groupKey).trim() === '' || groupKey === 'undefined' || groupKey === 'null') return;
    const allFunds = window.lastTargetFunds || [];
    const filtered = allFunds.filter(f => {
        if (currentOrgScope === 'ra' && !isRAFund(f)) return false;
        const rawName = f.fund_name || f.metadata?.fund_name || '';
        const pnu = window.fundToPnu?.[f.fund_id];
        let cleanName = String(rawName).split('(')[0].trim().replace(/[- ]제?\d+호$/, '호');
        const parentId = isValidKey(f.metadata?.parent_fund_id) ? f.metadata.parent_fund_id : null;
        const validPnu = isValidKey(pnu) ? pnu : null;
        const key = parentId || validPnu || cleanName;
        return String(key).trim() === String(groupKey).trim();
    });

    currentDrawerData = { key: groupKey, name: groupName, items: filtered };
    renderDrawerList();
};

function renderDrawerList() {
    const header = document.getElementById('drawerHeader');
    const content = document.getElementById('drawerContent');
    const nav = document.getElementById('drawerNav');
    const { key, name, items } = currentDrawerData;
    
    nav.style.display = 'none';
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
                <p style="color:var(--accent); font-size:12px; font-weight:800; margin-bottom:8px; letter-spacing:1px;">ASSET DEEP-DIVE</p>
                <h2 style="font-size:24px; font-weight:800; line-height:1.3;">${name}</h2>
                <p style="margin-top:12px; color:var(--muted); font-size:14px;">총 ${items.length}개의 관련 펀드가 검색되었습니다.</p>
            </div>
        </div>
    `;

    content.innerHTML = items.map(f => {
        const aum = getFundAmountWon(f, 'benchmark_aum');
        return `
            <div class="fund-detail-card" onclick="showDrawerDetail('${f.fund_id}')" style="cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3 style="font-size:16px; font-weight:800; flex:1; margin-right:16px;">${f.fund_name}</h3>
                    <span style="padding:4px 10px; border-radius:8px; font-size:11px; font-weight:800; background:#f1f5f9; color:#475569;">${getFundStatus(f)}</span>
                </div>
                <div class="meta-grid">
                    <div class="meta-item"><span class="meta-label">운용규모(AUM)</span><span class="meta-val">${formatNumber(aum)}</span></div>
                    <div class="meta-item"><span class="meta-label">담당부서</span><span class="meta-val">${f.metadata?.department || '-'}</span></div>
                    <div class="meta-item"><span class="meta-label">설정일</span><span class="meta-val">${f.setup_date || '-'}</span></div>
                    <div class="meta-item"><span class="meta-label">만기/청산일</span><span class="meta-val">${f.maturity_date || f.expiry_date || '-'}</span></div>
                </div>
            </div>
        `;
    }).join('');
    document.getElementById('sideDrawer').classList.add('active');
    document.getElementById('sideDrawerOverlay').classList.add('active');
};

window.showDrawerDetail = async (fundId) => {
    const content = document.getElementById('drawerContent');
    const header = document.getElementById('drawerHeader');
    const nav = document.getElementById('drawerNav');

    nav.style.display = 'block';
    header.innerHTML = '<div style="padding-left:180px; padding-top:15px;"><p style="color:var(--accent); font-weight:800; font-size:12px; letter-spacing:1px; margin:0;">LOADING DETAIL...</p></div>';
    content.innerHTML = '<div style="padding:100px; text-align:center; color:var(--muted);">데이터를 불러오고 있습니다...</div>';

    const fund = (window.lastTargetFunds || []).find(f => f.fund_id === fundId);
    if (!fund) {
        content.innerHTML = '<div style="padding:100px; text-align:center; color:var(--muted);">펀드 정보를 찾을 수 없습니다.</div>';
        return;
    }

    try {
        await showDetail({ type: 'fund', items: [fund], targetName: fund.fund_name }, content);
    } catch (e) {
        console.error(e);
        content.innerHTML = '<div style="padding:100px; text-align:center; color:#ef4444;">상세 정보를 불러오는 중 오류가 발생했습니다.</div>';
    }
    
    header.style.padding = '0';
    header.style.border = 'none';
};

window.backToDrawerList = () => {
    const header = document.getElementById('drawerHeader');
    header.style.padding = '40px 40px 30px';
    header.style.borderBottom = '1px solid #e2e8f0';
    renderDrawerList();
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

  const item0 = items[0];
  let displayTitle = name;
  if (type === 'asset') {
    displayTitle = item0.asset_name || name;
  } else if (type === 'fund' || type === 'project') {
    const fn = item0.fund_name;
    const sn = item0.short_name;
    if (fn && sn && fn !== sn) displayTitle = `[${sn}] ${fn}`;
    else displayTitle = fn || sn || name;
  }

  let subTitle = (type === 'asset' ? (item0.metadata?.pnu || item0.pnu) : item0.fund_id) || '';

  card.innerHTML = `
    <div class="group-header">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${displayTitle}</div>
        <div class="group-meta">${subTitle}${count > 1 ? ` | ${count}건 참여` : ''}</div>
      </div>
      <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''} 
        onclick="toggleBasket(event, '${type}', '${name}', ${JSON.stringify(items).replace(/"/g, '&quot;')})">
      <div class="toggle-icon">${count > 1 ? '▼' : '▶'}</div>
    </div>
    <div class="sub-list" style="display:none">
      ${items.map(i => `
        <div class="sub-item" data-id="${i.fund_id}">
          <span class="sub-item-name">${i.funds?.fund_name || i.fund_name || i.fund_id}</span>
          <span class="sub-item-id">${i.fund_id}</span>
        </div>`).join('')}
    </div>
  `;
  const header = card.querySelector('.group-header');
  header.addEventListener('click', (e) => {
    if (e.target.type === 'checkbox') return;
    if (count > 1) {
      const sl = card.querySelector('.sub-list');
      sl.style.display = sl.style.display === 'none' ? 'block' : 'none';
    }
    showDetail({type, items, targetName: name});
  });

  // 하위 아이템 클릭 시 해당 항목 상세 조회
  const subItems = card.querySelectorAll('.sub-item');
  subItems.forEach((si, idx) => {
    si.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = items[idx];
      // 하위 항목은 대부분 펀드/프로젝트이므로 type을 'fund'로 전환하여 조회
      showDetail({type: 'fund', items: [item], targetName: item.fund_name || item.fund_id});
      
      // 선택 효과 (기존 선택 제거 후 현재 항목 강조)
      card.querySelectorAll('.sub-item').forEach(el => el.style.background = '');
      si.style.background = 'rgba(79, 70, 229, 0.1)';
    });
  });

  resultsContainer.appendChild(card);
}



async function showDetail(obj, container) {
  const { type, items, targetName, category } = obj;
  const targetPanel = container || detailPanel;
  const fundIds = items.map(i => i.fund_id);
  targetPanel.innerHTML = '<div class="no-results">상세 로딩 중...</div>';
  try {
    const [fundRes, assetRes, lenderRes, benRes] = await Promise.all([
      _supabase.from('funds').select('*').in('fund_id', fundIds),
      _supabase.from('fund_assets').select('*').in('fund_id', fundIds),
      _supabase.from('lender_exposures').select('*').in('fund_id', fundIds),
      _supabase.from('beneficiary_exposures').select('*').in('fund_id', fundIds)
    ]);
    
    // 메인 정보 선택 최적화 (데이터가 가장 풍부한 레코드를 우선순위로 선택)
    const f = fundRes.data?.[0] || items[0];
    const targetPnu = items[0].metadata?.pnu || items[0].pnu;
    
    // 1. 클릭한 이름/PNU와 정확히 일치하는 자산들 중 데이터가 가장 많은 것 선택
    // 2. 없으면 해당 펀드에 속한 자산들 중 데이터가 가장 많은 것 선택
    const getScore = (x) => (x.gfa ? 2 : 0) + (x.site_area ? 2 : 0) + (x.lat ? 1 : 0) + (x.address ? 1 : 0);
    const sortedAssets = (assetRes.data || []).sort((a, b) => getScore(b) - getScore(a));
    
    const a = sortedAssets.find(x => (x.metadata?.pnu || x.pnu || x.asset_name) === targetName) || 
              sortedAssets.find(x => (x.metadata?.pnu || x.pnu) === targetPnu) ||
              sortedAssets[0] || {};
    
    const detailTitle = getFundPrimaryName(f);
    const officialName = getFundSecondaryName(f);
    const meta = f.metadata || {};
    const classifications = [
      meta.notion_base_asset_class,
      meta.notion_asset_nature_class,
      meta.notion_holding_type_class,
      meta.notion_business_stage_class,
      meta.notion_investment_strategy_class,
      meta.notion_vehicle_class
    ].filter(Boolean).join(' | ');

    const mapId = 'vmap-' + Math.random().toString(36).substr(2, 9);
    targetPanel.innerHTML = `
      <div class="detail-header">
        <span class="card-tag tag-fund">ASSET PROFILE</span>
        <h2 style="margin-bottom:4px;">${a.asset_name || detailTitle}</h2>
        <div style="color:var(--muted); font-size:16px;">
          ${fundIds.join(', ')} | ${f.dept || '-'}${officialName ? ' | ' + officialName : ''}${classifications ? ' | ' + classifications : ''}
        </div>
      </div>

      <div class="detail-section">
        <div class="section-title">🏢 자산 상세 (Asset Specs)</div>
        <div class="asset-specs-grid">
          <table class="data-table profile-table">
            <tr><th>주소 <small>Address</small></th><td>${a.address || '-'}</td></tr>
            <tr><th>대지면적 <small>Site Area</small></th><td>${a.site_area ? a.site_area.toLocaleString() + '㎡ (' + (a.site_area * 0.3025).toFixed(2) + 'py)' : '-'}</td></tr>
            <tr><th>연면적 <small>GFA</small></th><td>${a.gfa ? a.gfa.toLocaleString() + '㎡ (' + (a.gfa * 0.3025).toFixed(2) + 'py)' : '-'}</td></tr>
            <tr><th>건폐율/용적률 <small>SCR/FAR</small></th><td>${a.scr || '-'}% / ${a.far || '-'}%</td></tr>
            <tr><th>주용도 <small>Usage</small></th><td>${a.main_usage || '-'}</td></tr>
            <tr><th>층 <small>Floors</small></th><td>B${a.floors_down || '-'} / ${a.floors_up || '-'}F</td></tr>
            <tr><th>건축구조 <small>Structure</small></th><td>${a.structure || '-'}</td></tr>
            <tr><th>주차 <small>Parking</small></th><td>${a.parking || '-'}</td></tr>
            <tr><th>승강기 <small>Elevators</small></th><td>${a.elevators || '-'}</td></tr>
            <tr><th>준공연도 <small>Completion</small></th><td>${a.completion_date || '-'}</td></tr>
          </table>
          <div id="${mapId}" class="vmap-container" style="min-height:500px; border-radius:20px; border:1px solid var(--line);"></div>
        </div>
      </div>

      <div class="detail-section">
        <div class="section-title">💰 대주단 현황 (Lenders)</div>
        <table class="data-table">
          <thead><tr><th>기관명</th><th>인출액</th><th>금리</th><th>대출기간</th></tr></thead>
          <tbody>
            ${lenderRes.data?.map(l => `
              <tr>
                <td style="font-weight:700">${l.lender_clean}</td>
                <td>${formatNumber(l.drawn_amt)}</td>
                <td>${l.all_in_rate ? l.all_in_rate + '%' : '-'}</td>
                <td style="font-size:12px; opacity:0.7">${l.start_date || ''} ~ ${l.end_date || ''}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">정보 없음</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="detail-section">
        <div class="section-title">👥 수익자 현황 (Beneficiaries)</div>
        <table class="data-table">
          <thead><tr><th>기관명</th><th>투자액</th><th>지분율</th><th>약정일</th></tr></thead>
          <tbody>
            ${benRes.data?.map(b => `
              <tr>
                <td style="font-weight:700">${b.beneficiary_clean}</td>
                <td>${formatNumber(b.invested_amt)}</td>
                <td>${b.share_ratio ? b.share_ratio + '%' : '-'}</td>
                <td>${b.invested_date || '-'}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">정보 없음</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    // 종합분석 탭일 때 필터 초기화 및 렌더링
    if (category === 'analysis') {
        initAnalysisFilters();
        renderPortfolioChart();
    }

    if (a.lng && a.lat) {
      setTimeout(() => {
        try {
          if (typeof vw !== 'undefined' && vw.ol3) {
            const vmap = new vw.ol3.Map(mapId, {
              basemapType: vw.ol3.BasemapType.GRAPHIC,
              controlDensity: vw.ol3.DensityType.EMPTY,
              interactionDensity: vw.ol3.DensityType.BASIC,
              homePosition: vw.ol3.CameraPosition,
              initPosition: vw.ol3.CameraPosition
            });
            const lon = parseFloat(a.lng);
            const lat = parseFloat(a.lat);
            if (typeof ol !== 'undefined') {
              const center = ol.proj.fromLonLat([lon, lat]);
              vmap.getView().setCenter(center);
              vmap.getView().setZoom(17);
            }
            const markerLayer = new vw.ol3.layer.Marker(vmap);
            vmap.addLayer(markerLayer);
            markerLayer.addMarker({
              x: lon, y: lat, epsg: "EPSG:4326",
              title: a.asset_name || '위치',
              iconUrl: 'https://map.vworld.kr/images/ol3/marker_blue.png'
            });
          }
        } catch (e) { console.error("VWorld Map Error:", e); }
      }, 500);
    } else {
      const vmapEl = document.getElementById(mapId);
      if (vmapEl) vmapEl.innerHTML = '<div style="padding:40px; color:var(--muted); text-align:center;">좌표 정보가 없어 지도를 표시할 수 없습니다.</div>';
    }
  } catch (e) { console.error(e); targetPanel.innerHTML = '오류 발생'; }
}

// 종합분석 필터 초기화
function initAnalysisFilters() {
    const filterCols = [
        { key: 'notion_vehicle_class', label: 'Vehicle 구분' },
        { key: 'sector', label: '투자섹터' },
        { key: 'notion_investment_strategy_class', label: '투자전략' },
        { key: 'notion_business_stage_class', label: '사업단계' },
        { key: 'notion_asset_nature_class', label: '자산성격' }
    ];

    const grid = document.getElementById('filterGrid');
    if (!grid) return;
    grid.innerHTML = '';

    filterCols.forEach(col => {
        // 유니크 값 추출
        const values = [...new Set(window.allFunds.map(f => f[col.key] || f.metadata?.[col.key] || '미분류'))].filter(v => v !== '미분류').sort();
        
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        
        const label = document.createElement('label');
        label.innerText = col.label;
        
        const select = document.createElement('select');
        select.id = `filter-${col.key}`;
        select.innerHTML = '<option value="">전체</option>' + values.map(v => `<option value="${v}">${v}</option>`).join('');
        select.value = window.analysisFilters[col.key] || '';
        
        select.onchange = (e) => {
            window.analysisFilters[col.key] = e.target.value;
            renderPortfolioChart();
        };

        filterItem.appendChild(label);
        filterItem.appendChild(select);
        grid.appendChild(filterItem);
    });
}

function resetAnalysisFilters() {
    window.analysisFilters = {};
    initAnalysisFilters();
    renderPortfolioChart();
}

function getFilteredData() {
    let filteredFunds = [...window.allFunds];
    
    // 필터 적용
    Object.keys(window.analysisFilters).forEach(key => {
        const val = window.analysisFilters[key];
        if (val) {
            filteredFunds = filteredFunds.filter(f => (f[key] || f.metadata?.[key]) === val);
        }
    });

    const fundIds = new Set(filteredFunds.map(f => f.fund_id));
    const filteredAssets = window.allFundAssets.filter(a => fundIds.has(a.fund_id));

    return { funds: filteredFunds, assets: filteredAssets };
}

window.renderPortfolioChart = function() {
    const ctx = document.getElementById('portfolioChart');
    if (!ctx) return;

    const { funds, assets } = getFilteredData();
    
    // 기존 차트 파괴 (중복 렌더링 방지)
    if (window.myChart) {
        window.myChart.destroy();
    }

    const mode = window.analysisMode; // 'aum', 'loan', 'equity', 'count'
    const view = window.analysisView; // 'year', 'sector', 'strategy'

    let labels = [];
    let datasets = [];

    if (view === 'year') {
        // 연도별 로직 (기존 유지하되 필터링된 데이터 사용)
        const years = Array.from({length: 17}, (_, i) => 2010 + i);
        labels = years.map(y => y.toString());
        
        const dataDomestic = years.map(y => {
            const currentFunds = funds.filter(f => {
                const setupYear = new Date(f.setup_date).getFullYear();
                const maturityYear = f.maturity_date ? new Date(f.maturity_date).getFullYear() : 2099;
                return setupYear <= y && maturityYear >= y && f.location === '국내';
            });
            return calculateTotal(currentFunds, assets, mode);
        });

        const dataOverseas = years.map(y => {
            const currentFunds = funds.filter(f => {
                const setupYear = new Date(f.setup_date).getFullYear();
                const maturityYear = f.maturity_date ? new Date(f.maturity_date).getFullYear() : 2099;
                return setupYear <= y && maturityYear >= y && f.location === '해외';
            });
            return calculateTotal(currentFunds, assets, mode);
        });

        datasets = [
            { label: '국내', data: dataDomestic, backgroundColor: '#6366f1', borderRadius: 6 },
            { label: '해외', data: dataOverseas, backgroundColor: '#38bdf8', borderRadius: 6 }
        ];
    } else if (view === 'sector') {
        // 섹터별 비중 (현재 시점 기준)
        const sectors = [...new Set(funds.map(f => f.sector || '기타'))].filter(s => s);
        labels = sectors;
        
        const sectorData = sectors.map(s => {
            const sectorFunds = funds.filter(f => (f.sector || '기타') === s);
            return calculateTotal(sectorFunds, assets, mode);
        });

        datasets = [{
            label: '섹터별 비중',
            data: sectorData,
            backgroundColor: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#94a3b8'],
            borderWidth: 0
        }];
    } else if (view === 'strategy') {
        // 전략별 현황
        const strategies = [...new Set(funds.map(f => f.notion_investment_strategy_class || '기타'))].filter(s => s);
        labels = strategies;

        const strategyData = strategies.map(s => {
            const strategyFunds = funds.filter(f => (f.notion_investment_strategy_class || '기타') === s);
            return calculateTotal(strategyFunds, assets, mode);
        });

        datasets = [{
            label: '전략별 현황',
            data: strategyData,
            backgroundColor: ['#4f46e5', '#7c3aed', '#db2777', '#d97706', '#059669', '#2563eb', '#64748b'],
            borderWidth: 0
        }];
    }

    // 차트 옵션 및 생성
    window.myChart = new Chart(ctx, {
        type: (view === 'year' ? 'bar' : 'doughnut'),
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            let value = context.raw;
                            if (mode === 'count') return `${value}건`;
                            return `${(value / 1000000000000).toFixed(1)}조 원`;
                        }
                    }
                }
            },
            scales: view === 'year' ? {
                x: { stacked: true, grid: { display: false } },
                y: { stacked: true, grid: { color: '#f1f5f9' }, ticks: { callback: v => `${(v/1000000000000).toFixed(0)}조` } }
            } : {}
        }
    });

    // 필터링된 리스트 렌더링
    renderAnalysisResults(funds);
};

function calculateTotal(funds, assets, mode) {
    if (mode === 'count') return funds.length;
    
    let total = 0;
    funds.forEach(f => {
        const fundAssets = assets.filter(a => a.fund_id === f.fund_id);
        if (mode === 'aum') {
            total += fundAssets.reduce((sum, a) => sum + (parseFloat(a.aum) || 0), 0);
        } else if (mode === 'loan') {
            total += fundAssets.reduce((sum, a) => sum + (parseFloat(a.loan_amount) || 0), 0);
        } else if (mode === 'equity') {
            // 자산별 equity 정보가 있다면 합산, 없다면 aum - loan으로 추정 (예시)
            total += fundAssets.reduce((sum, a) => sum + ((parseFloat(a.aum) || 0) - (parseFloat(a.loan_amount) || 0)), 0);
        }
    });
    return total;
}

function renderAnalysisResults(filteredFunds) {
    const resultsContainer = document.getElementById('analysisResults');
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = '';
    
    if (filteredFunds.length === 0) {
        resultsContainer.innerHTML = '<div style="padding:40px; text-align:center; color:var(--muted);">필터 조건에 맞는 데이터가 없습니다.</div>';
        return;
    }

    // 그룹화하여 표시
    const groups = {};
    filteredFunds.forEach(f => {
        const key = f.sector || '미분류';
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    });

    Object.keys(groups).sort().forEach(groupName => {
        const groupEl = document.createElement('div');
        groupEl.className = 'result-group';
        groupEl.innerHTML = `
            <div class="group-title">${groupName} (${groups[groupName].length})</div>
            <div class="result-list">
                ${groups[groupName].map(f => `
                    <div class="result-item" onclick="showDrawerDetail('${f.fund_id}')">
                        <div class="item-name">${f.fund_name}</div>
                        <div class="item-meta">${f.fund_id} | ${f.location} | ${f.notion_investment_strategy_class || '-'}</div>
                    </div>
                `).join('')}
            </div>
        `;
        resultsContainer.appendChild(groupEl);
    });
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

async function ensureAllDataLoaded() {
    if (window.allFunds?.length === 0 || !window.allFunds) {
        try {
            const [fundRes, assetRes] = await Promise.all([
                _supabase.from('funds').select('*'),
                _supabase.from('fund_assets').select('*')
            ]);
            window.allFunds = fundRes.data || [];
            window.allFundAssets = assetRes.data || [];
        } catch (e) { console.error(e); }
    }
    return { funds: window.allFunds, assets: window.allFundAssets };
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
  const searchControls = document.getElementById('searchViewControls');
  const analysisControls = document.getElementById('analysisViewControls');
  const results = document.getElementById('results');
  const analysisResults = document.getElementById('analysisResults');

  if (listBtn) listBtn.addEventListener('click', () => { 
    currentView = 'list'; 
    listBtn.classList.add('active'); 
    chartBtn.classList.remove('active'); 
    searchControls.style.display = 'block';
    analysisControls.style.display = 'none';
    results.style.display = 'flex';
    analysisResults.style.display = 'none';
    renderResults(); 
  });

  if (chartBtn) chartBtn.addEventListener('click', () => { 
    currentView = 'ranking'; 
    chartBtn.classList.add('active'); 
    listBtn.classList.remove('active'); 
    searchControls.style.display = 'none';
    analysisControls.style.display = 'block';
    results.style.display = 'none';
    analysisResults.style.display = 'flex';
    renderAnalytics(); 
  });
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
    currentOrgScope = scope;
    renderAnalytics();
};

const renderNetChangeDetails = (label) => {
    const analysisResults = document.getElementById('analysisResults');
    const analysisHeader = document.getElementById('analysisListHeader');
    const targetFunds = window.lastTargetFunds || [];
    if (!analysisResults || targetFunds.length === 0) return;

    analysisResults.innerHTML = `<div style="text-align:center; padding:40px; color:var(--muted);">데이터 추출 중...</div>`;

    let startDate, endDate, title;
    if (label === '2026 (Actual)') {
        startDate = new Date('2026-01-01'); endDate = new Date('2026-03-31'); title = '2026년 1분기';
    } else if (label === '2026 (Proj.)') {
        startDate = new Date('2026-04-01'); endDate = new Date('2026-12-31'); title = '2026년 잔여';
    } else {
        const year = parseInt(label);
        startDate = new Date(`${year}-01-01`); endDate = new Date(`${year}-12-31`); title = `${year}년`;
    }

    const newlySetup = targetFunds.filter(f => {
        const setup = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
        return setup && setup >= startDate && setup <= endDate && isRAFund(f);
    });

    const terminated = targetFunds.filter(f => {
        const end = f.metadata?.termination_date || f.metadata?.maturity_date;
        const d = end ? new Date(end) : null;
        return d && d >= startDate && d <= endDate && isRAFund(f);
    });

    const finalItems = [...groupItems(newlySetup, '+'), ...groupItems(terminated, '-')].sort((a, b) => b.aum - a.aum);

    analysisHeader.innerHTML = `
        <div style="padding:16px; background:white; border-radius:12px; border:1px solid var(--line); box-shadow:var(--shadow);">
            <div style="font-size:12px; color:var(--accent); font-weight:800; margin-bottom:4px;">${title} 변동 내역</div>
            <div style="font-size:16px; font-weight:800;">총 ${finalItems.length}개 항목</div>
        </div>
    `;

    if (finalItems.length === 0) {
        analysisResults.innerHTML = `<div class="no-results">해당 기간 내<br>변동 내역이 없습니다.</div>`;
        return;
    }

    analysisResults.innerHTML = finalItems.map(item => `
        <div class="group-card" onclick="openFundDetail('${item.key}', '${item.name}')">
            <div class="group-header">
                <div style="flex:1">
                    <span class="card-tag" style="background:${item.type === '+' ? '#ecfdf5' : '#fef2f2'}; color:${item.type === '+' ? '#10b981' : '#ef4444'};">
                        ${item.type === '+' ? '신규' : '청산'}
                    </span>
                    <div class="group-title">${item.name}</div>
                    <div class="group-meta">${currentChartMetric === 'count' ? item.aum + '건 참여' : formatNumber(item.aum)}</div>
                </div>
                <div class="toggle-icon">▶</div>
            </div>
        </div>
    `).join('');
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
        tooltip: { shared: true, intersect: false, y: { formatter: val => (val > 0 ? '+' : '') + val.toLocaleString() + (currentChartMetric === 'count' ? ' 개' : ' 조원') } }
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
        tooltip: { shared: true, intersect: false, y: { formatter: val => val.toLocaleString() + (currentChartMetric === 'count' ? ' 개' : ' 조원') } },
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

document.addEventListener('DOMContentLoaded', () => {
    const listBtn = document.getElementById('listViewBtn');
    const chartBtn = document.getElementById('chartViewBtn');
    const searchControls = document.getElementById('searchViewControls');
    const analysisControls = document.getElementById('analysisViewControls');

    if (listBtn) listBtn.addEventListener('click', () => { 
        currentView = 'list'; 
        listBtn.classList.add('active'); 
        chartBtn.classList.remove('active'); 
        searchControls.style.display = 'block';
        analysisControls.style.display = 'none';
        renderResults(); 
    });

    if (chartBtn) chartBtn.addEventListener('click', () => { 
        currentView = 'ranking'; 
        chartBtn.classList.add('active'); 
        listBtn.classList.remove('active'); 
        searchControls.style.display = 'none';
        analysisControls.style.display = 'block';
        renderAnalytics(); 
    });

    // 카테고리 탭 버튼 이벤트 리스너 추가
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.dataset.tab;

            const analysisControls = document.getElementById('analysisControls');
            const searchResults = document.getElementById('results');
            const analysisResults = document.getElementById('analysisResults');

            if (currentTab === 'analysis') {
                if (analysisControls) analysisControls.style.display = 'block';
                if (searchResults) searchResults.style.display = 'none';
                if (analysisResults) analysisResults.style.display = 'flex';
                ensureAllDataLoaded().then(() => {
                    initAnalysisFilters();
                    renderPortfolioChart();
                });
            } else {
                if (analysisControls) analysisControls.style.display = 'none';
                if (searchResults) searchResults.style.display = 'flex';
                if (analysisResults) analysisResults.style.display = 'none';
                renderResults();
            }
        });
    });

    // 검색어 입력 이벤트 리스너
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => performSearch(e.target.value), 400);
        });
    }

    renderBasket();
});

// --- Comprehensive Analysis Functions ---

function initAnalysisFilters() {
    const filterCols = [
        { key: 'notion_vehicle_class', label: 'Vehicle 구분' },
        { key: 'sector', label: '투자섹터' },
        { key: 'notion_investment_strategy_class', label: '투자전략' },
        { key: 'notion_business_stage_class', label: '사업단계' },
        { key: 'notion_asset_nature_class', label: '자산성격' }
    ];

    const grid = document.getElementById('filterGrid');
    if (!grid) return;
    grid.innerHTML = '';

    filterCols.forEach(col => {
        // 유니크 값 추출
        const values = [...new Set(allFunds.map(f => f[col.key] || f.metadata?.[col.key] || '미분류'))].filter(v => v !== '미분류').sort();
        
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        
        const label = document.createElement('label');
        label.innerText = col.label;
        
        const select = document.createElement('select');
        select.id = `filter-${col.key}`;
        select.innerHTML = '<option value="">전체</option>' + values.map(v => `<option value="${v}">${v}</option>`).join('');
        select.value = analysisFilters[col.key] || '';
        
        select.onchange = (e) => {
            analysisFilters[col.key] = e.target.value;
            renderPortfolioChart();
        };

        filterItem.appendChild(label);
        filterItem.appendChild(select);
        grid.appendChild(filterItem);
    });
}

function resetAnalysisFilters() {
    analysisFilters = {};
    initAnalysisFilters();
    renderPortfolioChart();
}

function getFilteredData() {
    let filteredFunds = [...allFunds];
    
    // 필터 적용
    Object.keys(analysisFilters).forEach(key => {
        const val = analysisFilters[key];
        if (val) {
            filteredFunds = filteredFunds.filter(f => (f[key] || f.metadata?.[key]) === val);
        }
    });

    const fundIds = new Set(filteredFunds.map(f => f.fund_id));
    const filteredAssets = allFundAssets.filter(a => fundIds.has(a.fund_id));

    return { funds: filteredFunds, assets: filteredAssets };
}

window.setAnalysisView = (view) => {
    analysisView = view;
    const btns = document.querySelectorAll('#analysisControls .toggle-buttons:first-child button');
    btns.forEach(b => {
        if (b.getAttribute('onclick').includes(view)) b.classList.add('active');
        else b.classList.remove('active');
    });
    renderPortfolioChart();
};

window.setAnalysisMode = (mode) => {
    analysisMode = mode;
    // UI 업데이트 (모드 버튼이 있다면)
    renderPortfolioChart();
};

window.renderPortfolioChart = function() {
    const chartEl = document.getElementById('portfolioChart');
    if (!chartEl) return;

    const { funds, assets } = getFilteredData();
    
    const mode = analysisMode; // 'aum', 'loan', 'equity', 'count'
    const view = analysisView; // 'year', 'sector', 'strategy'

    let series = [];
    let categories = [];
    let chartType = 'bar';
    let isStacked = true;

    if (view === 'year') {
        const years = Array.from({length: 17}, (_, i) => 2010 + i);
        categories = years.map(y => y.toString());
        
        const dataDomestic = years.map(y => calculateTotal(funds.filter(f => {
            const sy = new Date(f.setup_date).getFullYear();
            const my = f.maturity_date ? new Date(f.maturity_date).getFullYear() : 2099;
            return sy <= y && my >= y && f.location === '국내';
        }), assets, mode));

        const dataOverseas = years.map(y => calculateTotal(funds.filter(f => {
            const sy = new Date(f.setup_date).getFullYear();
            const my = f.maturity_date ? new Date(f.maturity_date).getFullYear() : 2099;
            return sy <= y && my >= y && f.location === '해외';
        }), assets, mode));

        series = [
            { name: '국내', data: dataDomestic },
            { name: '해외', data: dataOverseas }
        ];
    } else {
        const filterKey = (view === 'sector') ? 'sector' : 'notion_investment_strategy_class';
        const uniqueValues = [...new Set(funds.map(f => f[filterKey] || f.metadata?.[filterKey] || '기타'))].filter(v => v);
        
        const chartData = uniqueValues.map(v => {
            const groupFunds = funds.filter(f => (f[filterKey] || f.metadata?.[filterKey] || '기타') === v);
            return calculateTotal(groupFunds, assets, mode);
        });

        chartType = 'donut';
        isStacked = false;
        series = chartData;
        categories = uniqueValues;
    }

    const options = {
        series: series,
        chart: {
            type: chartType,
            height: 450,
            stacked: isStacked,
            fontFamily: 'Pretendard Variable, sans-serif',
            toolbar: { show: false }
        },
        colors: ['#4f46e5', '#38bdf8', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#64748b'],
        plotOptions: {
            bar: { borderRadius: 6, columnWidth: '60%' },
            pie: { donut: { size: '70%', labels: { show: true, total: { show: true, label: 'TOTAL', formatter: (w) => {
                const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                return mode === 'count' ? `${total}건` : `${(total / 1e12).toFixed(1)}조`;
            }}}}}
        },
        xaxis: chartType === 'bar' ? { categories: categories } : undefined,
        labels: chartType === 'donut' ? categories : undefined,
        yaxis: chartType === 'bar' ? { labels: { formatter: (v) => mode === 'count' ? v : (v / 1e12).toFixed(0) + '조' } } : undefined,
        tooltip: {
            y: { formatter: (v) => mode === 'count' ? `${v}건` : `${(v / 1000000000000).toFixed(1)}조 원` }
        },
        legend: { position: 'bottom' },
        dataLabels: { enabled: false }
    };

    chartEl.innerHTML = '';
    new ApexCharts(chartEl, options).render();

    renderAnalysisResults(funds);
};

function calculateTotal(funds, assets, mode) {
    if (mode === 'count') return funds.length;
    
    let total = 0;
    funds.forEach(f => {
        const fundAssets = assets.filter(a => a.fund_id === f.fund_id);
        if (mode === 'aum') {
            total += fundAssets.reduce((sum, a) => sum + (parseFloat(a.aum) || 0), 0);
        } else if (mode === 'loan') {
            total += fundAssets.reduce((sum, a) => sum + (parseFloat(a.loan_amount) || 0), 0);
        } else if (mode === 'equity') {
            total += fundAssets.reduce((sum, a) => sum + ((parseFloat(a.aum) || 0) - (parseFloat(a.loan_amount) || 0)), 0);
        }
    });
    return total;
}

function renderAnalysisResults(filteredFunds) {
    const resultsContainer = document.getElementById('analysisResults');
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = '';
    
    if (filteredFunds.length === 0) {
        resultsContainer.innerHTML = '<div style="padding:40px; text-align:center; color:var(--muted);">필터 조건에 맞는 데이터가 없습니다.</div>';
        return;
    }

    const groups = {};
    filteredFunds.forEach(f => {
        const key = f.sector || '미분류';
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    });

    Object.keys(groups).sort().forEach(groupName => {
        const groupEl = document.createElement('div');
        groupEl.className = 'result-group';
        groupEl.innerHTML = `
            <div class="group-title">${groupName} (${groups[groupName].length})</div>
            <div class="result-list">
                ${groups[groupName].map(f => `
                    <div class="result-item" onclick="showDrawerDetail('${f.fund_id}')">
                        <div class="item-name">${f.fund_name}</div>
                        <div class="item-meta">${f.fund_id} | ${f.location} | ${f.notion_investment_strategy_class || '-'}</div>
                    </div>
                `).join('')}
            </div>
        `;
        resultsContainer.appendChild(groupEl);
    });
}
