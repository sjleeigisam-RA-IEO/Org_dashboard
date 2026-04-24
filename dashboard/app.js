const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const detailPanel = document.getElementById('detailPanel');
const tabBtns = document.querySelectorAll('.tab-btn');

let debounceTimer;
let currentTab = 'all';
let allResults = { lenders: [], beneficiaries: [], funds: [], assets: [] };

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

async function performSearch(query) {
  if (!query) {
    resultsContainer.innerHTML = '<div class="no-results">조회를 시작하세요.</div>';
    updateTabCounts();
    return;
  }
  const terms = getSearchTerms(query);
  try {
    const [lenderRes, benRes, fundRes, assetRes] = await Promise.all([
      _supabase.from('lender_exposures').select('*, funds(*)').or(buildUniversalFilter(['lender_clean', 'fund_id'], terms)).limit(100),
      _supabase.from('beneficiary_exposures').select('*, funds(*)').or(buildUniversalFilter(['beneficiary_clean', 'fund_id'], terms)).limit(100),
      _supabase.from('funds').select('*').or(buildUniversalFilter(['fund_name', 'fund_id', 'short_name'], terms)).limit(100),
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

  if (currentTab === 'all' || currentTab === 'fund') allResults.funds.forEach(i => renderGroupCard('fund', i.fund_name, [i]));
  if (currentTab === 'all' || currentTab === 'asset') allResults.assets.forEach(i => renderGroupCard('asset', i.asset_name, [i]));
  if (currentTab === 'all' || currentTab === 'lender') Object.keys(groupedLenders).forEach(n => renderGroupCard('lender', n, groupedLenders[n]));
  if (currentTab === 'all' || currentTab === 'ben') Object.keys(groupedBens).forEach(n => renderGroupCard('ben', n, groupedBens[n]));
}

function groupBy(list, key) {
  return list.reduce((acc, obj) => {
    const val = obj[key];
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
  card.innerHTML = `
    <div class="group-header">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${name}</div>
        <div class="group-meta">${count > 1 ? count + '건 참여' : items[0].fund_id || ''} | ${totalAmt > 0 ? formatNumber(totalAmt) : ''}</div>
      </div>
      <div class="toggle-icon">${count > 1 ? '▼' : '▶'}</div>
    </div>
    <div class="sub-list" style="display:none">
      ${items.map(i => `<div class="sub-item" data-id="${i.fund_id}">• ${i.funds?.fund_name || i.fund_id} <span style="float:right; opacity:0.6">${formatNumber(i.drawn_amt || i.invested_amt)}</span></div>`).join('')}
    </div>
  `;
  card.querySelector('.group-header').addEventListener('click', () => {
    if (count > 1) {
      const sl = card.querySelector('.sub-list');
      sl.style.display = sl.style.display === 'none' ? 'block' : 'none';
    }
    if (type === 'asset' || type === 'fund') showDetail({type, data: items[0]});
    else showGroupDetail(type, name, items);
  });
  card.querySelectorAll('.sub-item').forEach(si => si.addEventListener('click', (e) => {
    e.stopPropagation();
    showDetail({type: 'fund', data: { fund_id: si.dataset.id, fund_name: si.textContent.split('•')[1].trim() }});
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
  const { type, data } = obj;
  const fundId = data.fund_id;
  detailPanel.innerHTML = '<div class="no-results">상세 로딩 중...</div>';
  try {
    const [fundRes, assetRes, lenderRes, benRes] = await Promise.all([
      _supabase.from('funds').select('*').eq('fund_id', fundId).maybeSingle(),
      _supabase.from('fund_assets').select('*').eq('fund_id', fundId),
      _supabase.from('lender_exposures').select('*').eq('fund_id', fundId),
      _supabase.from('beneficiary_exposures').select('*').eq('fund_id', fundId)
    ]);
    
    const f = fundRes.data || data;
    const a = assetRes.data?.[0] || {}; // 첫 번째 자산 기준

    detailPanel.innerHTML = `
      <div class="detail-header">
        <span class="card-tag tag-fund">ASSET PROFILE</span>
        <h2 style="margin-bottom:4px;">${a.asset_name || f.fund_name}</h2>
        <div style="color:var(--muted); font-size:16px;">${fundId} | ${f.dept || '-'}</div>
      </div>

      <!-- IM 스타일 자산개요 테이블 -->
      <div class="detail-section">
        <div class="section-title">🏢 자산 개요 (Asset Profile)</div>
        <table class="data-table profile-table">
          <tr><th>주소 <small>Address</small></th><td>${a.address || '-'}</td></tr>
          <tr><th>대지면적 <small>Site Area</small></th><td>${a.site_area ? a.site_area.toLocaleString() + '㎡ (' + (a.site_area * 0.3025).toFixed(2) + 'py)' : '-'}</td></tr>
          <tr><th>연면적 <small>GFA</small></th><td>${a.gross_floor_area ? a.gross_floor_area.toLocaleString() + '㎡ (' + (a.gross_floor_area * 0.3025).toFixed(2) + 'py)' : '-'}</td></tr>
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
        <div class="section-title">💰 대주 및 수익자 현황</div>
        <div class="info-grid">
          <div class="info-item"><label>대주단 규모</label><span>${lenderRes.data?.length || 0}개 기관</span></div>
          <div class="info-item"><label>수익자 규모</label><span>${benRes.data?.length || 0}개 기관</span></div>
        </div>
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
