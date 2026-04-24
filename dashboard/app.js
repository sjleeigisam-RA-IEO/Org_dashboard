const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const detailPanel = document.getElementById('detailPanel');
const tabBtns = document.querySelectorAll('.tab-btn');

let debounceTimer;
let currentTab = 'all';
let allResults = { lenders: [], beneficiaries: [], funds: [], assets: [] };
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
    allResults = { lenders: lenderRes.data || [], beneficiaries: benRes.data || [], funds: fundRes.data || [], assets: assetRes.data || [] };
    updateTabCounts();
    renderResults();
  } catch (error) { console.error(error); }
}

function updateTabCounts() {
  const counts = {
    all: allResults.lenders.length + allResults.beneficiaries.length + allResults.funds.length + allResults.assets.length,
    fund: allResults.funds.length, asset: allResults.assets.length, ben: allResults.beneficiaries.length, lender: allResults.lenders.length
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
    if (type === 'asset' || type === 'fund') showDetail({type, items});
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
          ${items.map(i => `<tr><td>${i.funds?.fund_name || '-'}</td><td>${i.fund_id}</td><td>${formatNumber(i.drawn_amt || i.invested_amt)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function showDetail(obj) {
  const { type, items } = obj;
  const fundIds = items.map(i => i.fund_id);
  detailPanel.innerHTML = '<div class="no-results">상세 로딩 중...</div>';
  try {
    const [fundRes, assetRes, lenderRes, benRes] = await Promise.all([
      _supabase.from('funds').select('*').in('fund_id', fundIds),
      _supabase.from('fund_assets').select('*').in('fund_id', fundIds),
      _supabase.from('lender_exposures').select('*').in('fund_id', fundIds),
      _supabase.from('beneficiary_exposures').select('*').in('fund_id', fundIds)
    ]);
    
    // 메인 정보 (첫 번째 유효한 데이터 사용)
    const f = fundRes.data?.[0] || items[0];
    const a = assetRes.data?.find(x => x.site_area > 0) || assetRes.data?.[0] || {};
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
