var OPTIONAL_FUND_SEARCH_COLUMNS = [
  'project_mission_name',
  'notion_base_asset_class',
  'notion_asset_nature_class',
  'notion_holding_type_class',
  'notion_business_stage_class',
  'notion_investment_strategy_class',
  'notion_vehicle_class'
];

var ALIASES = window.ALIASES || {
  nps: ['\uAD6D\uBBFC\uC5F0\uAE08', 'nps'],
  '\uAD6D\uBBFC\uC5F0\uAE08': ['\uAD6D\uBBFC\uC5F0\uAE08', 'nps'],
  kic: ['\uD55C\uAD6D\uD22C\uC790\uACF5\uC0AC', 'kic'],
  '\uC2E0\uD55C': ['\uC2E0\uD55C', 'shinhan'],
  kb: ['\uAD6D\uBBFC', 'kb'],
  '\uD558\uB098': ['\uD558\uB098', 'hana'],
  '\uC6B0\uB9AC': ['\uC6B0\uB9AC', 'woori']
};

var portfolioBasket = [];
window.OPTIONAL_FUND_SEARCH_COLUMNS = OPTIONAL_FUND_SEARCH_COLUMNS;
window.ALIASES = ALIASES;
window.portfolioBasket = portfolioBasket;

function ensureFundSearchColumns() {
  return _supabase.from('funds').select('*').limit(1).then(function (response) {
    var sample = response.data?.[0];
    if (!sample) return;

    fundSearchColumns = [
      'fund_name', 'fund_id', 'short_name'
    ].concat(OPTIONAL_FUND_SEARCH_COLUMNS.filter(function (col) {
      return col in sample;
    }));
    window.fundSearchColumns = fundSearchColumns;
  }).catch(function (error) {
    console.error(error);
  });
}

function performSearch(query) {
  if (!query) {
    resultsContainer.innerHTML = '<div class="no-results">\uC870\uD68C\uB97C \uC2DC\uC791\uD558\uC138\uC694.</div>';
    updateTabCounts();
    return Promise.resolve();
  }

  var terms = getSearchTerms(query);

  return ensureFundSearchColumns().then(function () {
    return Promise.all([
      _supabase.from('lender_exposures').select('*, funds(*)').or(buildUniversalFilter(['lender_clean', 'fund_id'], terms)).limit(100),
      _supabase.from('beneficiary_exposures').select('*, funds(*)').or(buildUniversalFilter(['beneficiary_clean', 'fund_id'], terms)).limit(100),
      _supabase.from('funds').select('*').or(buildUniversalFilter(fundSearchColumns, terms)).limit(100),
      _supabase.from('fund_assets').select('*, funds(*)').or(buildUniversalFilter(['asset_name', 'fund_id'], terms)).limit(100)
    ]);
  }).then(function (responses) {
    var lenderRes = responses[0];
    var benRes = responses[1];
    var fundRes = responses[2];
    var assetRes = responses[3];
    var projects = (fundRes.data || []).filter(function (f) {
      return f.project_mission_name || f.notion_base_asset_class;
    });
    var normalFunds = (fundRes.data || []).filter(function (f) {
      return !f.project_mission_name && !f.notion_base_asset_class;
    });

    allResults = {
      lenders: lenderRes.data || [],
      beneficiaries: benRes.data || [],
      funds: normalFunds,
      assets: assetRes.data || [],
      projects: projects
    };
    window.allResults = allResults;

    updateTabCounts();
    renderResults();
  }).catch(function (error) {
    console.error(error);
  });
}

function updateTabCounts() {
  var counts = {
    all: allResults.lenders.length + allResults.beneficiaries.length + allResults.funds.length + allResults.assets.length + allResults.projects.length,
    fund: allResults.funds.length,
    asset: allResults.assets.length,
    ben: allResults.beneficiaries.length,
    lender: allResults.lenders.length,
    project: allResults.projects.length
  };

  tabBtns.forEach(function (btn) {
    var tab = btn.dataset.tab;
    var count = counts[tab] || 0;
    btn.innerHTML = btn.textContent.split(' ')[0] + ' <span style="opacity:0.4; font-size:0.8em; margin-left:4px;">' + count + '</span>';
  });
}

function renderResults() {
  resultsContainer.innerHTML = '';
  var groupedLenders = groupBy(allResults.lenders, 'lender_clean');
  var groupedBens = groupBy(allResults.beneficiaries, 'beneficiary_clean');
  var groupedAssets = groupBy(allResults.assets, 'asset_name');
  var groupedFunds = groupBy(allResults.funds, 'fund_name');
  var groupedProjects = groupBy(allResults.projects, 'fund_name');

  if (currentTab === 'all' || currentTab === 'project') Object.keys(groupedProjects).forEach(function (k) { renderGroupCard('project', k, groupedProjects[k]); });
  if (currentTab === 'all' || currentTab === 'fund') Object.keys(groupedFunds).forEach(function (k) { renderGroupCard('fund', k, groupedFunds[k]); });
  if (currentTab === 'all' || currentTab === 'asset') Object.keys(groupedAssets).forEach(function (k) { renderGroupCard('asset', k, groupedAssets[k]); });
  if (currentTab === 'all' || currentTab === 'lender') Object.keys(groupedLenders).forEach(function (n) { renderGroupCard('lender', n, groupedLenders[n]); });
  if (currentTab === 'all' || currentTab === 'ben') Object.keys(groupedBens).forEach(function (n) { renderGroupCard('ben', n, groupedBens[n]); });
}

function groupBy(list, key) {
  return list.reduce(function (acc, obj) {
    var val = obj[key];
    if (key === 'asset_name') val = obj.metadata?.pnu || obj.pnu || obj.asset_name;
    else if (key === 'fund_name' || key === 'fund_id') val = obj.metadata?.parent_fund_id || obj.parent_fund_id || obj.fund_id;
    acc[val] = acc[val] || [];
    acc[val].push(obj);
    return acc;
  }, {});
}

function renderGroupCard(type, name, items) {
  var isSelected = portfolioBasket.some(function (i) { return i.key === type + '_' + name; });
  var count = items.length;
  var card = document.createElement('div');
  card.className = 'group-card';
  if (isSelected) card.style.borderColor = 'var(--accent)';

  var item0 = items[0];
  var displayTitle = name;
  if (type === 'asset') {
    displayTitle = item0.asset_name || name;
  } else if (type === 'fund' || type === 'project') {
    var fn = item0.fund_name;
    var sn = item0.short_name;
    if (fn && sn && fn !== sn) displayTitle = '[' + sn + '] ' + fn;
    else displayTitle = fn || sn || name;
  }

  var subTitle = (type === 'asset' ? (item0.metadata?.pnu || item0.pnu) : item0.fund_id) || '';

  card.innerHTML = `
    <div class="group-header">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${displayTitle}</div>
        <div class="group-meta">${subTitle}${count > 1 ? ` | ${count}\uAC74 \uCC38\uC5EC` : ''}</div>
      </div>
      <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''} 
        onclick="toggleBasket(event, '${type}', '${name}', ${JSON.stringify(items).replace(/"/g, '&quot;')})">
      <div class="toggle-icon">${count > 1 ? 'v' : '-'}</div>
    </div>
    <div class="sub-list" style="display:none">
      ${items.map(function (i) {
        return `
        <div class="sub-item" data-id="${i.fund_id}">
          <span class="sub-item-name">${i.funds?.fund_name || i.fund_name || i.fund_id}</span>
          <span class="sub-item-id">${i.fund_id}</span>
        </div>`;
      }).join('')}
    </div>
  `;

  var header = card.querySelector('.group-header');
  header.addEventListener('click', function (e) {
    if (e.target.type === 'checkbox') return;
    if (count > 1) {
      var sl = card.querySelector('.sub-list');
      sl.style.display = sl.style.display === 'none' ? 'block' : 'none';
    }
    showDetail({ type: type, items: items, targetName: name });
  });

  var subItems = card.querySelectorAll('.sub-item');
  subItems.forEach(function (si, idx) {
    si.addEventListener('click', function (e) {
      e.stopPropagation();
      var item = items[idx];
      showDetail({ type: 'fund', items: [item], targetName: item.fund_name || item.fund_id });

      card.querySelectorAll('.sub-item').forEach(function (el) {
        el.style.background = '';
      });
      si.style.background = 'rgba(79, 70, 229, 0.1)';
    });
  });

  resultsContainer.appendChild(card);
}

function toggleBasket(event, type, name, items) {
  event.stopPropagation();
  var basketKey = type + '_' + name;
  var index = portfolioBasket.findIndex(function (i) { return i.key === basketKey; });
  if (index > -1) portfolioBasket.splice(index, 1);
  else portfolioBasket.push({ key: basketKey, name: name, type: type, items: items });
  window.portfolioBasket = portfolioBasket;
  renderBasket();
  if (currentView === 'ranking') renderAnalytics();
}

function renderBasket() {
  var basketEl = document.getElementById('portfolioBasket');
  var itemsEl = document.getElementById('basketItems');
  if (!basketEl || !itemsEl) return;
  if (portfolioBasket.length === 0) {
    basketEl.style.display = 'none';
    return;
  }
  basketEl.style.display = 'block';
  itemsEl.innerHTML = portfolioBasket.map(function (item) {
    return `<div class="basket-chip">${item.name}<span onclick="toggleBasket(event, '${item.type}', '${item.name}', [])">x</span></div>`;
  }).join('');
}

window.ensureFundSearchColumns = ensureFundSearchColumns;
window.performSearch = performSearch;
window.updateTabCounts = updateTabCounts;
window.renderResults = renderResults;
window.groupBy = groupBy;
window.renderGroupCard = renderGroupCard;
window.toggleBasket = toggleBasket;
window.renderBasket = renderBasket;
