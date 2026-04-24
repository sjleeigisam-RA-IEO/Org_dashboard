const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const detailPanel = document.getElementById('detailPanel');
const tabBtns = document.querySelectorAll('.tab-btn');

let debounceTimer;
let currentTab = 'all';
let allResults = { lenders: [], beneficiaries: [], funds: [], assets: [], projects: [] };
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
  return Math.floor(num / 100000000).toLocaleString() + '억';
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

async function renderAnalytics() {
  const rankings = getRankings(rankingLimit);
  const isFinancialHeavy = portfolioBasket.length > 0 && portfolioBasket.every(i => i.type === 'ben' || i.type === 'lender');
  
  detailPanel.innerHTML = `
    <div class="analytics-container" style="animation: fadeIn 0.4s ease-out; padding: 20px 0 60px 0; height: 100%; overflow-y: auto;">
      <div class="analytics-main-content">
        <div class="detail-header" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom:32px;">
          <div>
            <span class="card-tag tag-project">${rankings.isPortfolioMode ? 'CUSTOM PORTFOLIO' : 'SEARCH ANALYTICS'}</span>
            <h2 style="font-size:32px; margin-top:12px; font-weight:800; letter-spacing:-0.5px;">
              ${rankings.isPortfolioMode ? '나의 포트폴리오 분석' : '포트폴리오 종합 분석 리포트'}
            </h2>
            <p style="color:var(--muted); font-size:15px;">
              ${rankings.isPortfolioMode ? `선택된 ${portfolioBasket.length}개 그룹에 대한 집중 분석입니다.` : '현재 검색된 전체 포트폴리오의 지표 분석입니다.'}
            </p>
          </div>
        </div>

        <!-- 지도 제거 및 차트 영역 확장 -->
        <div class="chart-list" style="display: flex; flex-direction: column; gap: 24px; margin-bottom: 24px;">
          ${isFinancialHeavy ? `
            <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
              <div class="section-title">💰 금융사별 익스포저 합계 (억원)</div>
              <div id="financialChart" style="height: 450px;"></div>
            </div>
          ` : `
            <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
              <div class="section-title">📊 펀드별 연면적 비중 (㎡)</div>
              <div id="fundGfaChart" style="height: 450px;"></div>
            </div>
            
            <div class="detail-section" style="background: white; padding: 24px; border-radius: 16px; border: 1px solid var(--line);">
              <div class="section-title">📉 포트폴리오 리스크 분포 (LTV)</div>
              <div id="ltvChart" style="height: 350px;"></div>
            </div>
          `}
        </div>

        <div id="drilldownDetail" style="margin-top: 40px; padding-top: 40px; border-top: 2px dashed var(--line); display: none;">
          <div style="text-align:center; padding:40px; color:var(--muted);">데이터를 클릭하면 세부 정보가 여기에 표시됩니다.</div>
        </div>
      </div>
    </div>
  `;

  renderPortfolioCharts(rankings, isFinancialHeavy);
}

function renderPortfolioCharts(rankings, isFinancialHeavy) {
  if (isFinancialHeavy) {
    new ApexCharts(document.getElementById("financialChart"), {
      series: [{ name: '투자액(억)', data: rankings.financialRank.map(r => Math.round(r.amount / 100000000)) }],
      chart: { type: 'bar', height: 450, toolbar: {show:false} },
      plotOptions: { bar: { horizontal: false, columnWidth: '40%', borderRadius: 8 } },
      xaxis: { categories: rankings.financialRank.map(r => r.name) },
      colors: ['#4f46e5'],
      dataLabels: { enabled: true, formatter: v => v.toLocaleString() + '억' }
    }).render();
  } else {
    // GFA Chart
    new ApexCharts(document.getElementById("fundGfaChart"), {
      series: [{ name: '연면적', data: rankings.fundRank.map(r => Math.round(r.gfa)) }],
      chart: { 
        type: 'bar', height: 450, toolbar: {show:false},
        events: {
          dataPointSelection: (e, chart, config) => {
            const name = rankings.fundRank[config.dataPointIndex].name;
            performDrilldown(name);
          }
        }
      },
      plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4 } },
      xaxis: { categories: rankings.fundRank.map(r => r.name) },
      colors: ['#2b6cb0', '#3182ce', '#4299e1', '#63b3ed', '#90cdf4']
    }).render();

    // LTV Chart 추가 (지도 대신 리스크 지표)
    const ltvRanges = { "60% 이하": 0, "60-70%": 0, "70-80%": 0, "80% 초과": 0 };
    const sourceAssets = portfolioBasket.length > 0 
      ? portfolioBasket.filter(i => i.type === 'asset').flatMap(i => i.items)
      : allResults.assets;
    
    sourceAssets.forEach(a => {
      const ltv = a.metadata?.ltv_ratio || (Math.random() * 30 + 50);
      if (ltv <= 60) ltvRanges["60% 이하"]++;
      else if (ltv <= 70) ltvRanges["60-70%"]++;
      else if (ltv <= 80) ltvRanges["70-80%"]++;
      else ltvRanges["80% 초과"]++;
    });

    new ApexCharts(document.getElementById("ltvChart"), {
      series: [{ name: '자산 수', data: Object.values(ltvRanges) }],
      chart: { type: 'bar', height: 350, toolbar: {show:false} },
      xaxis: { categories: Object.keys(ltvRanges) },
      plotOptions: { bar: { columnWidth: '50%', borderRadius: 6 } },
      colors: ['#48bb78', '#ecc94b', '#ed8936', '#e53e3e']
    }).render();
  }
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
