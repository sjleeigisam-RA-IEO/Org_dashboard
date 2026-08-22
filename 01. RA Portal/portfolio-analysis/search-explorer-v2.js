(function () {
  'use strict';

  var detailRequestId = 0;

  function ownsDetailPanel(panel, requestId) {
    return requestId === detailRequestId
      && Boolean(panel && panel.querySelector('[data-v2-detail-request="' + requestId + '"]'));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean).map(String)));
  }

  function numberValue(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatMillion(value) {
    return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(numberValue(value) / 1000000);
  }

  function rowAmount(row, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      if (row && row[keys[i]] != null && row[keys[i]] !== '') return numberValue(row[keys[i]]);
    }
    return 0;
  }

  function dedupeItems(items, type) {
    var seen = new Set();
    return (items || []).filter(function (row, index) {
      var key = row.exposure_id || row.id || [
        type,
        row.fund_id,
        row.asset_id,
        row.beneficiary_id || row.lender_id,
        row.commitment_date || row.drawdown_date || row.start_date,
        index
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function fetchAssets(ids) {
    ids = unique(ids);
    if (!ids.length || !window._supabase) return [];
    var select = 'asset_id,asset_code,canonical_name,physical_asset_name,non_physical_asset_label,address_text,asset_type,latitude,longitude';
    var responses = await Promise.all([
      window._supabase.from('asset_master').select(select).in('asset_id', ids).limit(500),
      window._supabase.from('asset_master').select(select).in('asset_code', ids).limit(500)
    ]);
    var rows = [];
    responses.forEach(function (response) {
      if (!response.error) rows = rows.concat(response.data || []);
    });
    var seen = new Set();
    return rows.filter(function (row) {
      var key = row.asset_id || row.asset_code;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function assetTitle(row) {
    return row.physical_asset_name || row.non_physical_asset_label || row.canonical_name || row.asset_code || row.asset_id || '-';
  }

  function fundTitle(row, fallback) {
    return row.project_mission_name || row.short_name || row.fund_name || fallback || row.fund_id || '-';
  }

  function compactAssetRowsHtml(rows) {
    if (!rows.length) return '<p class="v2-relationship-empty">연결 자산 정보가 없습니다.</p>';
    return '<div class="v2-relationship-asset-list">' + rows.map(function (row) {
      var id = row.asset_id || row.asset_code || '';
      return [
        '<button type="button" class="v2-relationship-asset" data-v2-search-asset-id="', esc(id), '" data-v2-search-asset-title="', esc(assetTitle(row)), '">',
        '<span><b>', esc(assetTitle(row)), '</b><small>', esc(row.address_text || row.asset_type || row.asset_code || ''), '</small></span>',
        '<em>자산 상세</em>',
        '</button>'
      ].join('');
    }).join('') + '</div>';
  }

  function compactFundRowsHtml(groups, isLender) {
    if (!groups.length) return '<p class="v2-relationship-empty">연결 펀드 정보가 없습니다.</p>';
    return [
      '<div class="v2-relationship-table-wrap"><table class="v2-relationship-table">',
      '<thead><tr><th>펀드/비히클</th><th>연결 자산</th><th>약정액</th><th>', isLender ? '실행액' : '투입액', '</th></tr></thead>',
      '<tbody>',
      groups.map(function (group) {
        return [
          '<tr>',
          '<td><strong>', esc(group.title), '</strong><small>', esc(group.fundId), '</small></td>',
          '<td>', esc(group.assetNames.slice(0, 3).join(', ') || '-'), group.assetNames.length > 3 ? '<small> 외 ' + (group.assetNames.length - 3) + '개</small>' : '', '</td>',
          '<td>', formatMillion(group.committed), '<small>백만원</small></td>',
          '<td>', formatMillion(group.current), '<small>백만원</small></td>',
          '</tr>'
        ].join('');
      }).join(''),
      '</tbody></table></div>'
    ].join('');
  }

  async function openCompactInstitutionDetail(type, name, items) {
    var panel = document.getElementById('detailPanel');
    if (!panel || !name) return;
    var requestId = ++detailRequestId;
    if (window.pushDetailPanelHistory) window.pushDetailPanelHistory();
    var isLender = type === 'lender';
    var roleLabel = isLender ? '대주' : '수익자';
    var sourceItems = dedupeItems(items, type);
    var fundIds = unique(sourceItems.map(function (row) { return row.fund_id; }));

    panel.innerHTML = [
      '<div class="detail-header v2-search-party-header">',
      '<button type="button" class="back-to-results-btn" onclick="goBackDetailPanel()">← 이전으로</button>',
      '<p>', isLender ? 'LENDER' : 'BENEFICIARY', '</p>',
      '<h2>', esc(name), '</h2>',
      '<span>', esc(roleLabel), ' 기준으로 연결된 투자대상을 정리하고 있습니다.</span>',
      '</div>',
      '<div class="v2-search-detail-loading" data-v2-detail-request="', requestId, '">관계 정보를 불러오는 중입니다.</div>'
    ].join('');

    try {
      var fundRows = [];
      var relationshipRows = [];
      if (fundIds.length && window._supabase) {
        var responses = await Promise.all([
          window._supabase.from('v_funds_enriched').select('*').in('fund_id', fundIds).limit(500),
          window._supabase.from('fund_asset_relationships').select('*').in('fund_id', fundIds).limit(1000)
        ]);
        if (!responses[0].error) fundRows = responses[0].data || [];
        if (!responses[1].error) relationshipRows = responses[1].data || [];
      }
      if (!ownsDetailPanel(panel, requestId)) return;
      var assetIds = unique(sourceItems.map(function (row) { return row.asset_id; }).concat(
        relationshipRows.map(function (row) { return row.asset_id || row.asset_code; })
      ));
      var assets = await fetchAssets(assetIds);
      if (!ownsDetailPanel(panel, requestId)) return;
      var assetById = new Map();
      assets.forEach(function (asset) {
        if (asset.asset_id) assetById.set(String(asset.asset_id), asset);
        if (asset.asset_code) assetById.set(String(asset.asset_code), asset);
      });
      var fundById = new Map(fundRows.map(function (row) { return [String(row.fund_id), row]; }));
      var assetsByFund = new Map();
      relationshipRows.forEach(function (row) {
        var key = String(row.fund_id || '');
        if (!assetsByFund.has(key)) assetsByFund.set(key, []);
        var asset = assetById.get(String(row.asset_id || row.asset_code || '')) || row;
        assetsByFund.get(key).push(assetTitle(asset));
      });
      var amountKeys = isLender
        ? { committed: ['committed_amt', 'committed_amount'], current: ['drawn_amt', 'drawn_amount', 'executed_amt'] }
        : { committed: ['committed_amt', 'committed_amount'], current: ['invested_amt', 'invested_amount', 'paid_in_amt'] };
      var groups = fundIds.map(function (fundId) {
        var rows = sourceItems.filter(function (row) { return String(row.fund_id || '') === String(fundId); });
        var fund = fundById.get(String(fundId)) || rows.map(function (row) { return row.funds; }).find(Boolean) || {};
        return {
          fundId: fundId,
          title: fundTitle(fund, fundId),
          assetNames: unique(assetsByFund.get(String(fundId)) || []),
          committed: rows.reduce(function (sum, row) { return sum + rowAmount(row, amountKeys.committed); }, 0),
          current: rows.reduce(function (sum, row) { return sum + rowAmount(row, amountKeys.current); }, 0)
        };
      }).sort(function (a, b) { return b.committed - a.committed || a.title.localeCompare(b.title, 'ko'); });
      var committedTotal = sourceItems.reduce(function (sum, row) { return sum + rowAmount(row, amountKeys.committed); }, 0);
      var currentTotal = sourceItems.reduce(function (sum, row) { return sum + rowAmount(row, amountKeys.current); }, 0);

      panel.innerHTML = [
        '<div class="detail-header v2-search-party-header">',
        '<button type="button" class="back-to-results-btn" onclick="goBackDetailPanel()">← 이전으로</button>',
        '<p>', isLender ? 'LENDER' : 'BENEFICIARY', '</p>',
        '<div class="v2-search-party-title-row"><div><h2>', esc(name), '</h2><span>', esc(roleLabel), ' 관계를 투자대상 기준으로 묶었습니다.</span></div>',
        '<button type="button" class="v2-open-capital-analysis" data-v2-open-capital-party="', esc(name), '" data-v2-open-capital-role="', esc(type), '">시계열·지도 분석</button></div>',
        '</div>',
        '<section class="v2-search-relation-kpis" aria-label="관계 요약">',
        '<div><span>펀드/비히클</span><strong>', groups.length, '</strong></div>',
        '<div><span>자산</span><strong>', assets.length, '</strong></div>',
        '<div><span>약정액</span><strong>', formatMillion(committedTotal), '</strong><small>백만원</small></div>',
        '<div><span>', isLender ? '실행액' : '투입액', '</span><strong>', formatMillion(currentTotal), '</strong><small>백만원</small></div>',
        '</section>',
        '<section class="v2-search-relation-section"><header><h3>투자 관계</h3><span>한 행이 하나의 펀드/비히클입니다.</span></header>',
        compactFundRowsHtml(groups, isLender), '</section>',
        '<section class="v2-search-relation-section"><header><h3>연결 자산</h3><span>선택하면 자산 상세로 이동합니다.</span></header>',
        compactAssetRowsHtml(assets), '</section>'
      ].join('');
      window.currentDrawerData = { type: 'institution', institutionType: type, key: name, name: name, items: sourceItems };
    } catch (error) {
      if (!ownsDetailPanel(panel, requestId)) return;
      console.error(error);
      panel.innerHTML += '<p class="v2-relationship-empty">관계 정보를 불러오지 못했습니다.</p>';
    }
  }

  function openCapitalAnalysis(name, role) {
    var modeButton = document.querySelector('[data-v2-mode="capital"]');
    if (modeButton) modeButton.click();
    window.setTimeout(function () {
      var roleButton = document.querySelector('[data-capital-role="' + (role === 'lender' ? 'lender' : 'beneficiary') + '"]');
      if (roleButton) roleButton.click();
      var input = document.getElementById('capitalSearchInput');
      var form = document.getElementById('capitalRelationshipFilterForm');
      if (input) {
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, 500);
  }

  document.addEventListener('click', function (event) {
    var assetButton = event.target.closest('[data-v2-search-asset-id]');
    if (assetButton && window.AssetCanonical && typeof window.AssetCanonical.renderCanonicalAssetDetail === 'function') {
      detailRequestId += 1;
      window.AssetCanonical.renderCanonicalAssetDetail(
        assetButton.dataset.v2SearchAssetId,
        assetButton.dataset.v2SearchAssetTitle,
        { inlineOnly: true }
      );
      return;
    }
    var capitalButton = event.target.closest('[data-v2-open-capital-party]');
    if (capitalButton) {
      openCapitalAnalysis(capitalButton.dataset.v2OpenCapitalParty, capitalButton.dataset.v2OpenCapitalRole);
    }
  });

  window.openInstitutionRelationshipDrawer = openCompactInstitutionDetail;
})();
