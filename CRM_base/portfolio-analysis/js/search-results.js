  'project_mission_name',
  'fund_class',
  'legal_form',
  'fund_type',
  'division',
  'primary_region',
  'is_development',
  'notion_base_asset_class',
  'notion_asset_nature_class',
  'notion_holding_type_class',
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
  window.currentSearchQuery = query || '';
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
      window.AssetCanonical
        ? window.AssetCanonical.searchCanonicalAssets(terms)
        : _supabase.from('fund_assets').select('*, funds(*)').or(buildUniversalFilter(['asset_name', 'fund_id'], terms)).limit(100)
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
      assets: window.AssetCanonical ? [] : (assetRes.data || []),
      projects: projects,
      assetGroups: window.AssetCanonical ? (assetRes.data || []) : []
    };
    window.allResults = allResults;

    updateTabCounts();
    renderResults();
  }).catch(function (error) {
    console.error(error);
  });
}

function updateTabCounts() {
  var assetCount = allResults.assetGroups ? allResults.assetGroups.length : allResults.assets.length;
  var counts = {
    all: allResults.lenders.length + allResults.beneficiaries.length + allResults.funds.length + assetCount + allResults.projects.length,
    fund: allResults.funds.length,
    asset: assetCount,
    ben: allResults.beneficiaries.length,
    lender: allResults.lenders.length,
    project: allResults.projects.length
  };

  tabBtns.forEach(function (btn) {
    var tab = btn.dataset.tab;
    var count = counts[tab] || 0;
    // 최초 1회만 원본 라벨 저장
    if (!btn.dataset.label) {
      btn.dataset.label = btn.textContent.trim();
    }
    var label = btn.dataset.label;
    btn.innerHTML = '<span>' + label + '</span><span class="tab-count">' + count + '</span>';
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
  if (currentTab === 'all' || currentTab === 'asset') {
    if (window.AssetCanonical && allResults.assetGroups) {
      window.AssetCanonical.renderCanonicalAssetCards(allResults.assetGroups, resultsContainer);
    } else {
      Object.keys(groupedAssets).forEach(function (k) { renderGroupCard('asset', k, groupedAssets[k]); });
    }
  }
  if (currentTab === 'all' || currentTab === 'lender') Object.keys(groupedLenders).forEach(function (n) { renderGroupCard('lender', n, groupedLenders[n]); });
  if (currentTab === 'all' || currentTab === 'ben') Object.keys(groupedBens).forEach(function (n) { renderGroupCard('ben', n, groupedBens[n]); });
}

function groupBy(list, key) {
  return list.reduce(function (acc, obj) {
    var val = obj[key];
    if (key === 'asset_name') val = obj.pnu || obj.asset_name;
    else if (key === 'fund_name' || key === 'fund_id') val = obj.parent_fund_id || obj.fund_id;
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
      <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''} 
        onclick="toggleBasket(event, '${type}', '${name}', ${JSON.stringify(items).replace(/"/g, '&quot;')})">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${displayTitle}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        ${count > 1 ? `<span style="font-size:11px; font-weight:700; color:var(--accent); background:rgba(79,70,229,0.05); padding:2px 6px; border-radius:4px;">${count}\uAC74 \uCC38\uC5EC</span>` : ''}
        <div class="toggle-icon">${count > 1 ? 'v' : '-'}</div>
      </div>
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
    if ((type === 'project' || type === 'fund') && item0.primary_asset_id && window.AssetCanonical) {
      window.AssetCanonical.renderCanonicalAssetDetail(item0.primary_asset_id, displayTitle);
      return;
    }
    showDetail({ type: type, items: items, targetName: name });
  });

  var subItems = card.querySelectorAll('.sub-item');
  subItems.forEach(function (si, idx) {
    si.addEventListener('click', function (e) {
      e.stopPropagation();
      var item = items[idx];
      if ((type === 'project' || type === 'fund') && item.primary_asset_id && window.AssetCanonical) {
        window.AssetCanonical.renderCanonicalAssetDetail(item.primary_asset_id, item.project_mission_name || item.fund_name || item.short_name || item.fund_id);
      } else {
        showDetail({ type: 'fund', items: [item], targetName: item.fund_name || item.fund_id });
      }

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
  
  // 같은 카테고리 2건 이상 선택 시 비교 차트 렌더링
  checkAndRenderComparison();
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
    var tagClass = 'tag-' + item.type;
    var typeLabel = { fund: '펀드', asset: '자산', lender: '대주', ben: '수익자', project: '프로젝트' }[item.type] || item.type;
    return '<div class="basket-chip"><span class="card-tag ' + tagClass + '" style="margin-bottom:0; font-size:9px; padding:1px 5px;">' + typeLabel + '</span> ' + item.name + '<span class="basket-remove" onclick="toggleBasket(event, \'' + item.type + '\', \'' + item.name + '\', [])">×</span></div>';
  }).join('');
}

function clearBasket() {
  portfolioBasket.length = 0;
  window.portfolioBasket = portfolioBasket;
  renderBasket();
  // 체크박스 해제
  document.querySelectorAll('.card-checkbox').forEach(function(cb) { cb.checked = false; });
  // 상세 패널 초기화
  var detailPanel = document.getElementById('detailPanel');
  if (detailPanel) {
    detailPanel.innerHTML = '<div class="detail-placeholder"><div class="placeholder-icon">📋</div><p>리스트에서 항목을 선택하면<br>상세 정보가 여기에 표시됩니다.</p></div>';
  }
}

function checkAndRenderComparison() {
  // 같은 카테고리(type)로 2건 이상 선택된 것만 필터
  var typeGroups = {};
  portfolioBasket.forEach(function(item) {
    if (!typeGroups[item.type]) typeGroups[item.type] = [];
    typeGroups[item.type].push(item);
  });
  
  // 가장 많이 선택된 같은 카테고리 그룹 찾기
  var bestGroup = null;
  Object.keys(typeGroups).forEach(function(t) {
    if (typeGroups[t].length >= 2) {
      if (!bestGroup || typeGroups[t].length > bestGroup.length) {
        bestGroup = typeGroups[t];
      }
    }
  });
  
  if (bestGroup) {
    var groupType = bestGroup[0].type;
    if (groupType === 'lender' || groupType === 'ben') {
      renderComparisonChart(bestGroup);
    } else {
      var detailPanel = document.getElementById('detailPanel');
      if (detailPanel) {
        var typeLabel = { fund: '펀드', asset: '자산', project: '프로젝트' }[groupType] || groupType;
        detailPanel.innerHTML = '<div class="detail-placeholder" style="text-align:center; padding:80px 40px;"><div style="font-size:48px; margin-bottom:20px;">🚧</div><h3 style="font-size:18px; font-weight:800; color:var(--text); margin-bottom:8px;">' + typeLabel + ' 비교 분석</h3><p style="color:var(--muted); font-size:14px; line-height:1.6;">해당 기능은 현재 개발 중입니다.<br>대주 또는 수익자 비교 분석을 먼저 이용해 주세요.</p></div>';
      }
    }
  }
}

function renderComparisonChart(selectedItems) {
  var detailPanel = document.getElementById('detailPanel');
  if (!detailPanel) return;
  
  var type = selectedItems[0].type;
  var isLender = (type === 'lender');
  var amountKey = isLender ? 'committed_amt' : 'invested_amt';
  var label = isLender ? '대주' : '수익자';
  var chartId = 'compare-chart-' + Math.random().toString(36).substr(2, 9);
  
  // 전체 연도 범위 계산
  var allYears = {};
  var minYear = 9999;
  var maxYear = 0;
  var currentYear = new Date().getFullYear();
  
  // 기관별 연도별 데이터 계산
  var seriesData = selectedItems.map(function(sel) {
    var yearData = {};
    sel.items.forEach(function(item) {
      var fund = item.funds || (window.allFunds || []).find(function(f) { return f.fund_id === item.fund_id; });
      var date;
      if (isLender) {
        date = item.drawdown_date || item.start_date || (fund ? fund.setup_date : null);
      } else {
        date = item.start_date || item.invested_date || (fund ? fund.setup_date : null);
      }
      if (date) {
        var year = new Date(date).getFullYear();
        if (year < minYear) minYear = year;
        if (year > maxYear) maxYear = year;
        yearData[year] = (yearData[year] || 0) + (item[amountKey] || 0);
      }
    });
    return { name: sel.name, yearData: yearData };
  });
  
  if (maxYear < currentYear) maxYear = currentYear;
  
  var years = [];
  for (var y = minYear; y <= maxYear; y++) years.push(y);
  
  // 시리즈 생성 (누적 막대)
  var series = seriesData.map(function(sd) {
    return {
      name: sd.name,
      data: years.map(function(y) { return Math.floor((sd.yearData[y] || 0) / 100000000); })
    };
  });
  
  // 총합 계산
  var totals = selectedItems.map(function(sel) {
    var total = sel.items.reduce(function(acc, item) { return acc + (item[amountKey] || 0); }, 0);
    return { name: sel.name, total: total };
  });
  
  // 색상 팔레트
  var colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
  
  detailPanel.innerHTML = 
    '<div class="detail-header">' +
      '<span class="card-tag tag-' + type + '">' + label.toUpperCase() + ' COMPARISON</span>' +
      '<h2 style="margin-bottom:4px;">' + selectedItems.map(function(s){return s.name}).join(' vs ') + '</h2>' +
      '<div style="color:var(--muted); font-size:14px; margin-top:8px; display:flex; gap:16px; flex-wrap:wrap;">' +
        totals.map(function(t, i) {
          return '<span style="display:flex; align-items:center; gap:6px;">' +
            '<span style="width:10px;height:10px;border-radius:3px;background:' + colors[i % colors.length] + '"></span>' +
            '<strong>' + t.name + '</strong> ' + (Math.floor(t.total / 100000000)).toLocaleString() + '억' +
          '</span>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="detail-section">' +
      '<div class="section-title">연도별 약정액 비교 (Stacked Comparison)</div>' +
      '<div id="' + chartId + '" style="min-height:400px;"></div>' +
    '</div>';
  
  setTimeout(function() {
    if (typeof ApexCharts === 'undefined') return;
    var options = {
      series: series,
      chart: { type: 'bar', height: 400, stacked: true, toolbar: { show: false }, fontFamily: 'Pretendard Variable' },
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 4 } },
      colors: colors.slice(0, series.length),
      xaxis: { categories: years },
      yaxis: [{
        labels: { formatter: function(val) { return val.toLocaleString(); } },
        title: { text: '단위: 억원' }
      }],
      dataLabels: {
        enabled: true,
        formatter: function(val) { return val ? val.toLocaleString() : ''; },
        style: { fontSize: '11px', fontWeight: 700 }
      },
      tooltip: {
        shared: true,
        intersect: false,
        inverseOrder: true,
        y: { formatter: function(val) { return val.toLocaleString() + ' 억'; } }
      },
      legend: { position: 'bottom', fontSize: '13px', fontWeight: 600, inverseOrder: true }
    };
    var chart = new ApexCharts(document.getElementById(chartId), options);
    chart.render();
  }, 100);
}

window.ensureFundSearchColumns = ensureFundSearchColumns;
window.performSearch = performSearch;
window.updateTabCounts = updateTabCounts;
window.renderResults = renderResults;
window.groupBy = groupBy;
window.renderGroupCard = renderGroupCard;
window.toggleBasket = toggleBasket;
window.renderBasket = renderBasket;
window.clearBasket = clearBasket;
window.renderComparisonChart = renderComparisonChart;
