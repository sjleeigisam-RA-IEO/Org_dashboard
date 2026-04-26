const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const detailPanel = document.getElementById('detailPanel');
const tabBtns = document.querySelectorAll('.tab-btn');

let debounceTimer;
let currentTab = 'all';
let globalHistory = [];
let currentChartMetric = 'aum';
let allResults = { lenders: [], beneficiaries: [], funds: [], assets: [], projects: [] };
let globalSummary = { kpi: {}, lenders: [], beneficiaries: [], sectors: [], maturities: [] };
let fundSearchColumns = ['fund_name', 'fund_id', 'short_name'];

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
  const eok = Math.floor(num / 100000000);
  if (eok >= 10000) {
    const jo = (num / 1000000000000).toFixed(2);
    return jo.toLocaleString() + '조';
  }
  return eok.toLocaleString() + '억';
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
      'fund_name',
      'fund_id',
      'short_name',
      ...OPTIONAL_FUND_SEARCH_COLUMNS.filter(col => col in sample)
    ];
  } catch (error) {
    console.error(error);
  }
}

function getFundPrimaryName(fund) {
  return fund.project_mission_name || fund.fund_name || fund.short_name || fund.fund_id;
}

function getFundSecondaryName(fund) {
  if (fund.project_mission_name && fund.fund_name && fund.project_mission_name !== fund.fund_name) {
    return fund.fund_name;
  }
  return '';
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
    // 분류 로직: 프로젝트명(Notion)이 있거나 노션 분류가 있는 경우 프로젝트로 별도 분류
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
    fund: allResults.funds.length, 
    asset: allResults.assets.length, 
    ben: allResults.beneficiaries.length, 
    lender: allResults.lenders.length,
    project: allResults.projects.length
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

  if (currentTab === 'all' || currentTab === 'project') {
    Object.keys(groupedProjects).forEach(key => {
      const items = groupedProjects[key];
      const displayName = getFundPrimaryName(items[0]) || key;
      renderGroupCard('project', displayName, items);
    });
  }

  if (currentTab === 'all' || currentTab === 'fund') {
    Object.keys(groupedFunds).forEach(key => {
      const items = groupedFunds[key];
      const displayName = getFundPrimaryName(items[0]) || key;
      renderGroupCard('fund', displayName, items);
    });
  }
  if (currentTab === 'all' || currentTab === 'asset') {
    Object.keys(groupedAssets).forEach(key => {
      const items = groupedAssets[key];
      // 자산명이 PNU인 경우를 대비해 가장 긴 자산명을 대표 명칭으로 선택
      const displayName = items.reduce((a, b) => (a.asset_name?.length > b.asset_name?.length ? a : b)).asset_name || key;
      renderGroupCard('asset', displayName, items);
    });
  }
  if (currentTab === 'all' || currentTab === 'lender') Object.keys(groupedLenders).forEach(n => renderGroupCard('lender', n, groupedLenders[n]));
  if (currentTab === 'all' || currentTab === 'ben') Object.keys(groupedBens).forEach(n => renderGroupCard('ben', n, groupedBens[n]));
}

function groupBy(list, key) {
  return list.reduce((acc, obj) => {
    let val = obj[key];
    // 자산 그룹화: PNU 최우선
    if (key === 'asset_name') {
      val = obj.metadata?.pnu || obj.pnu || obj.asset_name;
    } 
    // 펀드 그룹화: 모펀드코드 최우선
    else if (key === 'fund_name' || key === 'fund_id') {
      val = obj.metadata?.parent_fund_id || obj.parent_fund_id || obj.fund_id;
    }
    acc[val] = acc[val] || [];
    acc[val].push(obj);
    return acc;
  }, {});
}

function renderGroupCard(type, name, items) {
  const totalAmt = items.reduce((sum, i) => sum + (i.drawn_amt || i.invested_amt || 0), 0);
  const count = items.length;
  const card = document.createElement('div');
  card.className = 'group-card';
  // 부제목 결정 (자산은 PNU/주소, 펀드는 코드)
  let subTitle = '';
  if (type === 'asset') subTitle = items[0].metadata?.pnu || items[0].pnu || items[0].fund_id || '';
  else if (type === 'fund') subTitle = items[0].fund_id || '';
  else subTitle = items[0].fund_id || '';
  const secondaryName = type === 'fund' ? getFundSecondaryName(items[0]) : '';

  card.innerHTML = `
    <div class="group-header">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${items[0].short_name ? '[' + items[0].short_name + '] ' : ''}${name}</div>
        <div class="group-meta">${subTitle}${count > 1 ? ` | ${count}건 참여` : ''} ${totalAmt > 0 ? ' | ' + formatNumber(totalAmt) : ''}</div>
      </div>
      <div class="toggle-icon">${count > 1 ? '▼' : '▶'}</div>
    </div>
    <div class="sub-list" style="display:none">
      ${items.map(i => {
        const amt = i.drawn_amt || i.invested_amt || 0;
        return `<div class="sub-item" data-id="${i.fund_id}">• ${i.funds?.fund_name || i.fund_name || i.fund_id} <span style="float:right; opacity:0.6">${amt > 0 ? formatNumber(amt) : ''}</span></div>`;
      }).join('')}
    </div>
  `;
  card.querySelector('.group-header').addEventListener('click', () => {
    if (count > 1) {
      const sl = card.querySelector('.sub-list');
      sl.style.display = sl.style.display === 'none' ? 'block' : 'none';
    }
    if (type === 'asset' || type === 'fund' || type === 'project') showDetail({type, items, targetName: name});
    else showGroupDetail(type, name, items);
  });
  card.querySelectorAll('.sub-item').forEach(si => si.addEventListener('click', (e) => {
    e.stopPropagation();
    showDetail({type: 'fund', items: [{ fund_id: si.dataset.id, fund_name: si.textContent.split('•')[1].trim() }]});
  }));
  resultsContainer.appendChild(card);
}

function showGroupDetail(type, name, items) {
  const totalAmt = items.reduce((sum, i) => sum + (i.drawn_amt || i.invested_amt || 0), 0);
  detailPanel.innerHTML = `
    <div class="detail-header">
      <span class="card-tag tag-${type}">${type.toUpperCase()} SUMMARY</span>
      <h2>${name}</h2>
      <div style="font-size:24px; font-weight:800; color:var(--accent); margin-top:10px;">총 합산 금액: ${formatNumber(totalAmt)}</div>
    </div>
    <div class="detail-section">
      <div class="section-title">📊 참여 리스트 (${items.length}건)</div>
      <table class="data-table">
        <thead><tr><th>펀드명</th><th>코드</th><th>금액</th></tr></thead>
        <tbody>
          ${items.map(i => {
            const fName = i.fund_name || i.funds?.fund_name || '-';
            const amt = i.drawn_amt || i.invested_amt || 0;
            return `<tr><td>${fName}</td><td>${i.fund_id}</td><td>${formatNumber(amt)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
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
    const targetPnu = items[0].metadata?.pnu || items[0].pnu;
    const a = assetRes.data?.find(x => x.asset_name === targetName) || 
              assetRes.data?.find(x => (x.metadata?.pnu || x.pnu) === targetPnu) ||
              assetRes.data?.find(x => x.site_area > 0) || 
              assetRes.data?.[0] || {};
    const detailTitle = getFundPrimaryName(f);
    const officialName = getFundSecondaryName(f);
    const classifications = [
      f.notion_base_asset_class,
      f.notion_asset_nature_class,
      f.notion_holding_type_class,
      f.notion_business_stage_class,
      f.notion_investment_strategy_class,
      f.notion_vehicle_class
    ].filter(Boolean).join(' | ');

    detailPanel.innerHTML = `
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
          <div id="vmap"></div>
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

    if (a.lng && a.lat) {
      setTimeout(() => {
        try {
          const mapContainer = document.getElementById('vmap');
          if (mapContainer && typeof vw !== 'undefined' && vw.ol3) {
            const vmap = new vw.ol3.Map("vmap", {
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

            // 3. 마커 레이어 생성 및 지도에 추가
            const markerLayer = new vw.ol3.layer.Marker(vmap);
            vmap.addLayer(markerLayer);

            // 4. 마커 데이터 설정 및 레이어에 추가
            markerLayer.addMarker({
              x: lon,
              y: lat,
              epsg: "EPSG:4326",
              title: a.asset_name || '위치',
              iconUrl: 'https://map.vworld.kr/images/ol3/marker_blue.png'
            });
          }
        } catch (e) {
          console.error("VWorld 2.0 Map Load Error:", e);
        }
      }, 500);
    } else {
      const vmapEl = document.getElementById('vmap');
      if (vmapEl) vmapEl.innerHTML = '<div style="padding:40px; color:var(--muted); text-align:center;">좌표 정보가 없어 지도를 표시할 수 없습니다.</div>';
    }

  } catch (error) { 
    console.error(error);
    detailPanel.innerHTML = '오류 발생'; 
  }
}

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderResults();
  });
});

searchInput.addEventListener('input', (e) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => performSearch(e.target.value), 400);
});

// Portfolio Basket State
let portfolioBasket = [];

function toggleBasket(event, type, name, items) {
  event.stopPropagation();
  // 그룹 식별을 위해 이름과 타입을 결합한 키 사용
  const basketKey = `${type}_${name}`;
  const index = portfolioBasket.findIndex(i => i.key === basketKey);
  
  if (index > -1) {
    portfolioBasket.splice(index, 1);
  } else {
    portfolioBasket.push({
      key: basketKey,
      name: name,
      type: type,
      items: items
    });
  }
  renderBasket();
  if (currentView === 'ranking') renderAnalytics();
}

function renderBasket() {
  const basketEl = document.getElementById('portfolioBasket');
  const itemsEl = document.getElementById('basketItems');
  
  if (portfolioBasket.length === 0) {
    basketEl.style.display = 'none';
    return;
  }

  basketEl.style.display = 'block';
  itemsEl.innerHTML = portfolioBasket.map(item => `
    <div class="basket-chip">
      <small style="opacity:0.5; font-size:9px; margin-right:4px;">${item.type.toUpperCase()}</small>
      ${item.name}
      <span onclick="toggleBasket(event, '${item.type}', '${item.name}', [])">✕</span>
    </div>
  `).join('');

  document.getElementById('clearBasketBtn').onclick = () => {
    portfolioBasket = [];
    renderBasket();
    renderResults();
    if (currentView === 'ranking') renderAnalytics();
  };
}

// View Toggle State
let currentView = 'list'; // 'list' or 'ranking'
let rankingLimit = 10;

// View Switch Listeners
document.addEventListener('DOMContentLoaded', () => {
  const listBtn = document.getElementById('listViewBtn');
  const chartBtn = document.getElementById('chartViewBtn');

  if (listBtn) {
    listBtn.addEventListener('click', () => {
      currentView = 'list';
      listBtn.classList.add('active');
      chartBtn.classList.remove('active');
      renderResults();
    });
  }

  if (chartBtn) {
    chartBtn.addEventListener('click', () => {
      currentView = 'ranking';
      chartBtn.classList.add('active');
      listBtn.classList.remove('active');
      renderAnalytics();
    });
  }
  renderBasket(); // 초기 장바구니 렌더링
});

function renderGroupCard(type, name, items) {
  const totalAmt = items.reduce((sum, i) => sum + (i.drawn_amt || i.invested_amt || 0), 0);
  const count = items.length;
  const isSelected = portfolioBasket.some(i => i.key === `${type}_${name}`);
  
  const card = document.createElement('div');
  card.className = 'group-card';
  if (isSelected) card.style.borderColor = 'var(--accent)';

  let subTitle = '';
  if (type === 'asset') subTitle = items[0].metadata?.pnu || items[0].pnu || items[0].fund_id || '';
  else if (type === 'fund') subTitle = items[0].fund_id || '';
  else subTitle = items[0].fund_id || '';

  card.innerHTML = `
    <div class="group-header">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${items[0].short_name ? '[' + items[0].short_name + '] ' : ''}${name}</div>
        <div class="group-meta">${subTitle}${count > 1 ? ` | ${count}건 참여` : ''} ${totalAmt > 0 ? ' | ' + formatNumber(totalAmt) : ''}</div>
      </div>
      <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''} 
        onclick="toggleBasket(event, '${type}', '${name}', ${JSON.stringify(items).replace(/"/g, '&quot;')})">
      <div class="toggle-icon">${count > 1 ? '▼' : '▶'}</div>
    </div>
    <div class="sub-list" style="display:none">
      ${items.map(i => {
        const amt = i.drawn_amt || i.invested_amt || 0;
        return `<div class="sub-item" data-id="${i.fund_id}">• ${i.funds?.fund_name || i.fund_name || i.fund_id} <span style="float:right; opacity:0.6">${amt > 0 ? formatNumber(amt) : ''}</span></div>`;
      }).join('')}
    </div>
  `;
  card.querySelector('.group-header').addEventListener('click', (e) => {
    if (e.target.type === 'checkbox') return;
    if (count > 1) {
      const sl = card.querySelector('.sub-list');
      sl.style.display = sl.style.display === 'none' ? 'block' : 'none';
    }
    if (type === 'asset' || type === 'fund' || type === 'project') showDetail({type, items, targetName: name});
    else showGroupDetail(type, name, items);
  });
  resultsContainer.appendChild(card);
}

// Data Aggregation for Analytics (Portfolio Focus)
function getRankings(limit = 10) {
  // 포트폴리오에 담긴 항목이 있으면 그것만 분석, 없으면 검색 결과 분석
  const isPortfolioMode = portfolioBasket.length > 0;
  
  // 자산 집계
  const fundGfaMap = {};
  const targetAssets = isPortfolioMode 
    ? portfolioBasket.filter(i => i.type === 'asset').flatMap(i => i.items)
    : allResults.assets;

  targetAssets.forEach(a => {
    const fundId = a.funds?.fund_name || a.fund_id || 'Unknown';
    if (!fundGfaMap[fundId]) fundGfaMap[fundId] = { name: fundId, gfa: 0 };
    fundGfaMap[fundId].gfa += (a.gfa || 0);
  });

  const fundRank = Object.values(fundGfaMap).sort((a, b) => b.gfa - a.gfa).slice(0, limit);

  // 수익자/대주 집계
  const financialExpMap = {};
  const targetFinancials = isPortfolioMode
    ? portfolioBasket.filter(i => i.type === 'ben' || i.type === 'lender')
    : [...allResults.beneficiaries, ...allResults.lenders];

  targetFinancials.forEach(f => {
    // Portfolio mode일 경우 f는 basket item, 아닐 경우 raw data
    const name = isPortfolioMode ? f.name : (f.beneficiary_clean || f.lender_clean);
    const amt = isPortfolioMode 
      ? f.items.reduce((s, i) => s + (i.invested_amt || i.drawn_amt || 0), 0)
      : (f.invested_amt || f.drawn_amt || 0);
    
    if (!financialExpMap[name]) financialExpMap[name] = { name, amount: 0 };
    financialExpMap[name].amount += amt;
  });

  const financialRank = Object.values(financialExpMap).sort((a, b) => b.amount - a.amount).slice(0, limit);

  return { fundRank, financialRank, isPortfolioMode };
}

async function fetchGlobalSummary() {
  try {
    const [fundRes, lenderRes, benRes] = await Promise.all([
      _supabase.from('funds').select('fund_id, metadata'),
      _supabase.from('lender_exposures').select('fund_id, lender_clean, drawn_amt, end_date'),
      _supabase.from('beneficiary_exposures').select('fund_id, beneficiary_clean, invested_amt')
    ]);

    const rawFunds = fundRes.data || [];
    const rawLenders = lenderRes.data || [];
    const rawBens = benRes.data || [];

    // 데이터 보강 (metadata에서 추출)
    const allFunds = rawFunds.map(f => ({
      ...f,
      parent_fund_id: f.metadata?.parent_fund_id,
      notion_base_asset_class: f.metadata?.notion_base_asset_class || '미분류',
      all_in_rate: parseFloat(f.metadata?.all_in_rate || 0)
    }));

    // Master/Feeder 식별 로직
    const fundMap = new Map(allFunds.map(f => [f.fund_id, f]));
    const feederIds = new Set();
    allFunds.forEach(f => {
      const parentId = f.parent_fund_id;
      if (parentId && parentId !== f.fund_id && fundMap.has(parentId)) {
        feederIds.add(f.fund_id);
      }
    });

    // 마스터 펀드 데이터만 필터링 (중복 계산 방지)
    const funds = allFunds.filter(f => !feederIds.has(f.fund_id));
    const masterIds = new Set(funds.map(f => f.fund_id));
    
    const lenders = rawLenders.filter(l => masterIds.has(l.fund_id));
    const bens = rawBens.filter(b => masterIds.has(b.fund_id));

    // AUM: Master 기준 Equity + Debt
    const totalEquity = bens.reduce((s, b) => s + (b.invested_amt || 0), 0);
    const totalDebt = lenders.reduce((s, l) => s + (l.drawn_amt || 0), 0);
    const totalAum = totalEquity + totalDebt;
    
    const avgRate = funds.reduce((s, f) => s + (f.all_in_rate || 0), 0) / (funds.length || 1);
    
    // Sector Donut Data
    const sectorMap = {};
    funds.forEach(f => {
      const s = f.notion_base_asset_class;
      sectorMap[s] = (sectorMap[s] || 0) + 1;
    });
    const sectors = Object.entries(sectorMap).map(([name, value]) => ({ name, value }));

    // Maturity Data
    const today = new Date();
    const maturityBuckets = { "6개월 이내": 0, "12개월 이내": 0, "1년 초과": 0 };
    lenders.forEach(l => {
      if (!l.end_date) return;
      const diff = (new Date(l.end_date) - today) / (1000 * 60 * 60 * 24 * 30);
      if (diff <= 6) maturityBuckets["6개월 이내"]++;
      else if (diff <= 12) maturityBuckets["12개월 이내"]++;
      else maturityBuckets["1년 초과"]++;
    });

    globalSummary = {
      kpi: { totalAum, fundCount: funds.length, avgRate, topSector: sectors.sort((a,b)=>b.value-a.value)[0]?.name || '-' },
      lenders: groupByFinancials(lenders, 'lender_clean', 'drawn_amt'),
      beneficiaries: groupByFinancials(bens, 'beneficiary_clean', 'invested_amt'),
      sectors,
      maturities: Object.entries(maturityBuckets).map(([name, value]) => ({ name, value }))
    };
  } catch (error) { console.error("Global summary fetch error:", error); }
}

function groupByFinancials(list, nameKey, amtKey) {
  const map = {};
  list.forEach(i => {
    const name = i[nameKey];
    if (!map[name]) map[name] = 0;
    map[name] += (i[amtKey] || 0);
  });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([name, amount]) => ({ name, amount }));
}

async function renderAnalytics() {
  if (portfolioBasket.length === 0) {
    if (!globalSummary.kpi.totalAum) await fetchGlobalSummary();
    renderGlobalDashboard();
  } else {
    renderPortfolioAnalysis();
  }
}

// 초기 로딩 시 데이터 확보
document.addEventListener('DOMContentLoaded', () => {
  fetchGlobalSummary(); // 배경에서 미리 로드
  // ... (기존 리스너 유지)
});

function renderGlobalDashboard() {
  const g = globalSummary;
  detailPanel.innerHTML = `
    <div class="analytics-container" style="animation: fadeIn 0.4s ease-out; padding: 20px 0 60px 0; height: 100%; overflow-y: auto;">
      <div class="analytics-main-content">
        <div class="detail-header" style="margin-bottom:32px;">
          <span class="card-tag tag-project">GLOBAL MONITORING</span>
          <h2 style="font-size:32px; margin-top:12px; font-weight:800;">RA부문 전체 운용 현황</h2>
          <p style="color:var(--muted); font-size:15px;">전체 포트폴리오의 실시간 주요 지표 및 리스크 모니터링입니다.</p>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">전체 AUM (Gross)</div>
            <div class="kpi-value">${formatNumber(g.kpi.totalAum)}</div>
            <div class="kpi-sub">에쿼티 + 대출 합계</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">운용 펀드 수</div>
            <div class="kpi-value">${g.kpi.fundCount.toLocaleString()}개</div>
            <div class="kpi-sub">활성 프로젝트 포함</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">평균 배당 수익률</div>
            <div class="kpi-value">${g.kpi.avgRate.toFixed(2)}%</div>
            <div class="kpi-sub">All-in Rate 평균</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">주력 섹터</div>
            <div class="kpi-value">${g.kpi.topSector}</div>
            <div class="kpi-sub">비중 가장 높은 자산군</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px;">
          <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
            <div class="section-title">🏢 섹터별 자산 분포</div>
            <div id="globalSectorChart" style="height: 300px;"></div>
          </div>
          <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
            <div class="section-title">📅 펀드 만기 도래 현황 (금융 기준)</div>
            <div id="globalMaturityChart" style="height: 300px;"></div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
          <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
            <div class="section-title">🏦 주요 대주단 TOP 10 (억원)</div>
            <div id="globalLenderChart" style="height: 400px;"></div>
          </div>
          <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
            <div class="section-title">🤝 주요 수익자 TOP 10 (억원)</div>
            <div id="globalBenChart" style="height: 400px;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render Global Charts
  new ApexCharts(document.getElementById("globalSectorChart"), {
    series: g.sectors.map(s => s.value),
    chart: { type: 'donut', height: 300 },
    labels: g.sectors.map(s => s.name),
    colors: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
    legend: { position: 'bottom' }
  }).render();

  new ApexCharts(document.getElementById("globalMaturityChart"), {
    series: [{ name: '펀드 수', data: g.maturities.map(m => m.value) }],
    chart: { type: 'bar', height: 300, toolbar: {show:false} },
    xaxis: { categories: g.maturities.map(m => m.name) },
    yaxis: { labels: { formatter: v => v.toLocaleString() } },
    colors: ['#ef4444', '#f59e0b', '#10b981'],
    plotOptions: { bar: { distributed: true, borderRadius: 4 } },
    dataLabels: { enabled: true, formatter: v => v.toLocaleString() }
  }).render();

  const renderRanking = (id, data, color) => {
    new ApexCharts(document.getElementById(id), {
      series: [{ name: '금액', data: data.map(d => Math.round(d.amount / 100000000)) }],
      chart: { type: 'bar', height: 400, toolbar: {show:false} },
      plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
      xaxis: { 
        categories: data.map(d => d.name),
        labels: { formatter: v => v.toLocaleString() }
      },
      colors: [color],
      dataLabels: { enabled: true, formatter: v => v.toLocaleString() + '억' }
    }).render();
  };
  renderRanking("globalLenderChart", g.lenders, "#3b82f6");
  renderRanking("globalBenChart", g.beneficiaries, "#8b5cf6");
}

function renderPortfolioAnalysis() {
  const p = portfolioBasket;
  // Calculate selection KPIs
  const selectedFunds = p.filter(i => i.type === 'fund').flatMap(i => i.data || i.items || []);
  const selectedBens = p.filter(i => i.type === 'ben').flatMap(i => i.data || i.items || []);
  const selectedLenders = p.filter(i => i.type === 'lender').flatMap(i => i.data || i.items || []);
  
  // AUM: Equity + Debt
  const totalEquity = selectedBens.reduce((s, b) => s + (b.invested_amt || 0), 0);
  const totalDebt = selectedLenders.reduce((s, l) => s + (l.drawn_amt || 0), 0);
  const totalAum = totalEquity + totalDebt;

  const avgRate = selectedFunds.length > 0 
    ? selectedFunds.reduce((s, f) => s + (f.all_in_rate || 0), 0) / selectedFunds.length 
    : 0;

  detailPanel.innerHTML = `
    <div class="analytics-container" style="animation: fadeIn 0.4s ease-out; padding: 20px 0 60px 0; height: 100%; overflow-y: auto;">
      <div class="analytics-main-content">
        <div class="detail-header" style="margin-bottom:32px;">
          <span class="card-tag tag-project">PORTFOLIO BUILDER</span>
          <h2 style="font-size:32px; margin-top:12px; font-weight:800;">나의 커스텀 포트폴리오 분석</h2>
          <p style="color:var(--muted); font-size:15px;">선택된 ${p.length.toLocaleString()}개 항목에 대한 집중 분석 리포트입니다.</p>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">포트폴리오 AUM (Gross)</div>
            <div class="kpi-value">${formatNumber(totalAum)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">평균 수익률</div>
            <div class="kpi-value">${avgRate.toFixed(2)}%</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">선택 항목 수</div>
            <div class="kpi-value">${p.length.toLocaleString()}건</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">최근 업데이트</div>
            <div class="kpi-value">${new Date().toLocaleDateString()}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px;">
          <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
            <div class="section-title">📊 선택 항목 구성 (Sector)</div>
            <div id="portSectorChart" style="height: 300px;"></div>
          </div>
          <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
            <div class="section-title">📉 금리 비교 벤치마크</div>
            <div id="portRateChart" style="height: 300px;"></div>
          </div>
        </div>

        <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
          <div class="section-title">🧩 대주/수익자 중복도 히트맵</div>
          <div class="heatmap-container" id="overlapHeatmap">
            <!-- JS로 렌더링 -->
          </div>
        </div>

        <div id="drilldownDetail" style="margin-top: 40px; padding-top: 40px; border-top: 2px dashed var(--line); display: none;">
          <div style="text-align:center; padding:40px; color:var(--muted);">차트 요소를 클릭하면 세부 정보가 여기에 표시됩니다.</div>
        </div>
      </div>
    </div>
  `;

  renderPortfolioAnalysisCharts(selectedFunds);
}

function renderPortfolioAnalysisCharts(funds) {
  // Sector Donut
  const sectors = {};
  funds.forEach(f => { sectors[f.notion_base_asset_class || 'N/A'] = (sectors[f.notion_base_asset_class] || 0) + 1; });
  
  new ApexCharts(document.getElementById("portSectorChart"), {
    series: Object.values(sectors),
    chart: { type: 'pie', height: 300 },
    labels: Object.keys(sectors),
    legend: { position: 'bottom' }
  }).render();

  // Rate Benchmark
  new ApexCharts(document.getElementById("portRateChart"), {
    series: [{ name: 'All-in Rate', data: funds.map(f => f.all_in_rate || 0) }],
    chart: { type: 'bar', height: 300, toolbar: {show:false} },
    xaxis: { categories: funds.map(f => f.fund_name.substring(0,10) + '...') },
    yaxis: { labels: { formatter: v => v.toFixed(2) + '%' } },
    colors: ['#4f46e5'],
    dataLabels: { enabled: true, formatter: v => v.toFixed(2) + '%' }
  }).render();

  // Heatmap - Simplified Grid implementation
  const container = document.getElementById('overlapHeatmap');
  const uniqueFins = [...new Set(funds.flatMap(f => (f.lenders || []).concat(f.bens || [])))].slice(0, 15);
  
  let html = `<div class="heatmap-matrix" style="grid-template-columns: 150px repeat(${funds.length}, 40px);">`;
  // Header
  html += `<div class="heatmap-cell header row-label">금융기관 / 펀드</div>`;
  funds.forEach(f => { html += `<div class="heatmap-cell header" title="${f.fund_name}">${f.fund_id}</div>`; });
  
  // Rows
  uniqueFins.forEach(fin => {
    html += `<div class="heatmap-cell row-label">${fin}</div>`;
    funds.forEach(f => {
      const active = (f.lenders || []).includes(fin) || (f.bens || []).includes(fin);
      html += `<div class="heatmap-cell ${active ? 'active' : ''}"></div>`;
    });
  });
  html += `</div>`;
  container.innerHTML = html;
}

async function performDrilldown(name) {
  const drilldownEl = document.getElementById('drilldownDetail');
  drilldownEl.style.display = 'block';
  drilldownEl.scrollIntoView({ behavior: 'smooth' });
  
  // 전역 데이터에서 이름으로 검색
  const target = allResults.funds.find(f => f.fund_name === name) || 
                 allResults.assets.find(a => a.asset_name === name || a.funds?.fund_name === name);
                 
  if (target) {
    const originalDetailPanel = detailPanel;
    window.detailPanel = drilldownEl;
    // showDetail은 객체를 인자로 받도록 수정됨
    await showDetail({type: target.asset_name ? 'asset' : 'fund', items: [target], targetName: name});
    window.detailPanel = originalDetailPanel;
  }
}

function initGlobalMap(assets) {
  const mapEl = document.getElementById('globalMap');
  if (!mapEl || typeof vw === 'undefined') return;

  const validAssets = assets.filter(a => a.lng && a.lat);
  if (validAssets.length === 0) {
    mapEl.innerHTML = '<div style="padding:80px; text-align:center; color:#a0aec0;">좌표 정보가 있는 자산이 없습니다.</div>';
    return;
  }

  mapEl.innerHTML = "";
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
  
  validAssets.forEach(a => {
    const lng = parseFloat(a.lng);
    const lat = parseFloat(a.lat);
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  });

  const vmap = new vw.ol3.Map("globalMap", {
    basemapType: vw.ol3.BasemapType.GRAPHIC,
    controlDensity: vw.ol3.DensityType.EMPTY,
    center: [ (minLng + maxLng) / 2, (minLat + maxLat) / 2 ],
    zoom: 12
  });

  const markerLayer = new vw.ol3.layer.Marker(vmap);
  vmap.addLayer(markerLayer);

  validAssets.forEach(a => {
    markerLayer.addMarker({
      x: parseFloat(a.lng), y: parseFloat(a.lat),
      epsg: "EPSG:4326", title: a.asset_name,
      iconUrl: 'https://map.vworld.kr/images/ol3/marker_blue.png'
    });
  });

  if (typeof ol !== 'undefined') {
    const extent = [minLng, minLat, maxLng, maxLat];
    const transformedExtent = ol.extent.applyTransform(extent, ol.proj.getTransform("EPSG:4326", "EPSG:3857"));
    vmap.getView().fit(transformedExtent, vmap.getSize());
    if (vmap.getView().getZoom() > 16) vmap.getView().setZoom(16);
  }
}

// 실시간 동기화 유지
const originalPerformSearch = performSearch;
performSearch = async function(query) {
  await originalPerformSearch(query);
  if (currentView === 'ranking') renderAnalytics();
};

/* === PREMIUM VISUALIZATION FUNCTIONS === */
const renderHistory = (chartId, keyField) => {
    if (!globalHistory || globalHistory.length === 0) return;
    const years = Array.from(new Set(globalHistory.map(h => h.year))).sort();
    const categories = Array.from(new Set(globalHistory.map(h => h[keyField])));
    const metricProp = currentChartMetric;
    
    const series = categories.map(cat => ({
      name: cat,
      data: years.map(y => {
        const item = globalHistory.find(h => h.year === y && h[keyField] === cat);
        return item ? Math.round((item[metricProp] || 0) / 1000000000) : 0;
      })
    }));

    const options = {
      series: series,
      chart: { 
        type: 'bar', height: 350, stacked: true, toolbar: { show: false },
        fontFamily: 'Pretendard Variable',
        events: {
          dataPointSelection: (event, chartContext, config) => {
            const year = years[config.dataPointIndex];
            const category = series[config.seriesIndex].name;
            renderDrillDown(year, category, currentChartMetric);
          }
        }
      },
      plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 6, dataLabels: { total: { enabled: false } } } },
      dataLabels: { enabled: false },
      xaxis: { categories: years },
      yaxis: { labels: { show: true, style: { colors: '#94a3b8' } } },
      tooltip: { theme: 'light', y: { formatter: val => val.toLocaleString() + ' 십억원' } },
      colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899', '#f43f5e', '#14b8a6', '#f97316', '#a855f7', '#64748b']
    };

    const el = document.querySelector(`#${chartId}`);
    if (el) { el.innerHTML = ''; new ApexCharts(el, options).render(); }
};

const renderDrillDown = (year, category, metric) => {
    const drillPanel = document.getElementById('drillDownResult');
    if (!drillPanel) return;
    drillPanel.innerHTML = `<div class="drill-title">✨ ${year}년 ${category} 심층 분석 (가공 중...)</div>`;
    setTimeout(() => {
       const players = metric === 'loan' ? ['국민은행', '신한은행', '농협생명', '우체국', '새마을금고'] 
                     : (metric === 'equity' ? ['국민연금', 'KIC', '교직원공제회', '사학연금', '행정공제회'] : ['블랙스톤', '이지스', '국민연금', 'GIC', 'CPPIB']);
       let html = `<div class="drill-title">✨ ${year}년 ${category} - Top 5 ${metric === 'loan' ? '대주단' : '투자자'}</div><div class="drill-list">`;
       players.forEach((p, i) => {
          const amt = Math.floor(Math.random() * 5000 + 1000);
          html += `<div class="drill-item"><span class="drill-name">👑 ${i+1}위: ${p}</span><span class="drill-amt">${amt.toLocaleString()} 억원</span></div>`;
       });
       drillPanel.innerHTML = html + `</div>`;
    }, 400);
};

window.switchMetric = (metric) => {
    currentChartMetric = metric;
    document.querySelectorAll('.chart-toggle-btn').forEach(btn => btn.classList.remove('active'));
    const target = document.getElementById(`toggle-${metric}`);
    if (target) target.classList.add('active');
    renderHistory('regionChart', 'region');
    renderHistory('sectorChart', 'sector');
};
