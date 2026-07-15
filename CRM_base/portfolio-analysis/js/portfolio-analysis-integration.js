(function () {
  'use strict';

  var Engine = window.PortfolioAnalysisEngine;
  if (!Engine) {
    console.error('PortfolioAnalysisEngine is not available.');
    return;
  }

  var datasetCache = null;
  var datasetSignature = '';
  var defaultsApplied = false;
  var semanticSearchAnswer = null;
  var semanticSearchRequestId = 0;
  var analysisCountBasis = window.analysisCountBasis || 'fund_code';
  var originalRenderAnalytics = window.renderAnalytics;
  var originalPerformSearch = window.performSearch;
  var originalRenderResults = window.renderResults;
  var viewportRestoreSequence = 0;

  function captureViewportState() {
    var elementScroll = {};
    ['detailPanel', 'leftPanel', 'results', 'drawerContent'].forEach(function (id) {
      var element = document.getElementById(id);
      if (element) elementScroll[id] = { top: element.scrollTop, left: element.scrollLeft };
    });
    var scroller = document.scrollingElement || document.documentElement || document.body;
    return {
      windowX: window.scrollX || 0,
      windowY: window.scrollY || 0,
      documentTop: scroller ? scroller.scrollTop : 0,
      documentLeft: scroller ? scroller.scrollLeft : 0,
      elementScroll: elementScroll
    };
  }

  function restoreViewportState(state) {
    if (!state) return;
    Object.keys(state.elementScroll || {}).forEach(function (id) {
      var element = document.getElementById(id);
      var saved = state.elementScroll[id];
      if (!element || !saved) return;
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
    });
    var scroller = document.scrollingElement || document.documentElement || document.body;
    if (scroller) {
      scroller.scrollTop = state.documentTop;
      scroller.scrollLeft = state.documentLeft;
    }
    if (Math.abs((window.scrollY || 0) - state.windowY) > 0.5 || Math.abs((window.scrollX || 0) - state.windowX) > 0.5) {
      window.scrollTo({ top: state.windowY, left: state.windowX, behavior: 'auto' });
    }
  }

  function scheduleViewportRestore(state) {
    if (!state) return;
    var sequence = ++viewportRestoreSequence;
    var restore = function () {
      if (sequence === viewportRestoreSequence) restoreViewportState(state);
    };
    restore();
    window.requestAnimationFrame(function () {
      restore();
      window.requestAnimationFrame(restore);
    });
    window.setTimeout(restore, 60);
  }

  function settleViewportAfter(result, state) {
    if (result && typeof result.then === 'function') {
      result.then(function () { scheduleViewportRestore(state); }, function () { scheduleViewportRestore(state); });
    } else {
      scheduleViewportRestore(state);
    }
    return result;
  }

  var interactionViewportState = null;

  function isViewportStableInteraction(target) {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.closest('a[href], .left-panel-resizer')) return false;
    if (!target.closest('.main-layout, .side-drawer, .modal-overlay, .floating-view-toggle')) return false;
    return Boolean(target.closest([
      'button',
      'input',
      'select',
      'textarea',
      'summary',
      'label',
      '[role="button"]',
      '[onclick]',
      '.group-card',
      '.unified-result-card',
      '.sub-item',
      '.drill-item',
      '.apexcharts-bar-area',
      '.apexcharts-legend-series'
    ].join(',')));
  }

  function rememberInteractionViewport(event) {
    if (!isViewportStableInteraction(event.target)) return;
    interactionViewportState = captureViewportState();
  }

  function restoreInteractionViewport(event) {
    if (!interactionViewportState || !isViewportStableInteraction(event.target)) return;
    var state = interactionViewportState;
    interactionViewportState = null;
    scheduleViewportRestore(state);
  }

  function initViewportStabilityGuard() {
    document.addEventListener('pointerdown', rememberInteractionViewport, true);
    document.addEventListener('click', restoreInteractionViewport, false);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') rememberInteractionViewport(event);
    }, true);
    document.addEventListener('keyup', function (event) {
      if (event.key === 'Enter' || event.key === ' ') restoreInteractionViewport(event);
    }, false);
  }

  function getStableViewportState() {
    return interactionViewportState || captureViewportState();
  }

  var BASIS_OPTIONS = [
    {
      value: 'fund_code',
      label: '펀드코드',
      title: '펀드코드 기준',
      note: 'DB의 고유 펀드코드 1개를 1건으로 계산합니다.',
      includes: '모펀드·자펀드·일반 펀드·PFV 등 등록된 투자기구',
      excludes: '산정기준 자체의 제외 없음. 선택한 운용 상태와 분류 필터만 적용'
    },
    {
      value: 'representative',
      label: '자펀드 제외',
      title: '자펀드 제외 기준',
      note: '같은 구조 안에서 자펀드로 표시된 투자기구를 빼고 계산합니다.',
      includes: '모펀드·단독 펀드·일반 펀드·PFV·모자 구분 미설정 투자기구',
      excludes: '원천 DB에서 자펀드로 분류된 투자기구'
    },
    {
      value: 'aum_target',
      label: 'AUM 대상',
      title: 'AUM 대상 기준',
      note: '현재 AUM 합산에 들어가는 운용 투자기구만 계산합니다.',
      includes: 'AUM 상태가 운용이면서 자펀드가 아닌 투자기구',
      excludes: '자펀드 및 AUM 상태가 청산·설정예정·미설정인 투자기구'
    }
  ];

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cloneFilters(filters) {
    var cloned = {};
    Object.keys(filters || {}).forEach(function (key) {
      var values = Array.isArray(filters[key]) ? filters[key] : [filters[key]];
      var normalized = values.map(Engine.clean).filter(Boolean);
      if (normalized.length) cloned[key] = Array.from(new Set(normalized));
    });
    return cloned;
  }

  function ensureDefaultFilters() {
    if (defaultsApplied) return;
    defaultsApplied = true;
    if (!window.analysisFilters || typeof window.analysisFilters !== 'object') window.analysisFilters = {};
    if (!Object.keys(window.analysisFilters).length) {
      window.analysisFilters.operational_status = ['운용'];
    }
    analysisFilters = window.analysisFilters;
  }

  function combinedExposureRows() {
    var masterRows = window.allAssetMaster || [];
    var linkRows = window.allAssetFundLinks || [];
    var fallbackRows = window.allFundAssets || [];
    var masterById = new Map(masterRows.map(function (asset) { return [String(asset.asset_id), asset]; }));
    var rowsByKey = new Map();

    linkRows.forEach(function (link) {
      var master = masterById.get(String(link.asset_id));
      if (!master || !link.fund_id) return;
      var masterMeta = master.metadata && typeof master.metadata === 'object' ? master.metadata : {};
      var linkMeta = link.metadata && typeof link.metadata === 'object' ? link.metadata : {};
      var row = Object.assign({}, master, {
        fund_id: link.fund_id,
        asset_name: master.canonical_name || master.physical_asset_name || master.non_physical_asset_label,
        address: master.address_text,
        location_category: master.portfolio_region || master.country_code,
        directness: link.directness,
        exposure_role: link.exposure_role,
        relation_type: link.relation_type,
        metadata: Object.assign({}, masterMeta, linkMeta, {
          pnu: master.pnu || masterMeta.pnu,
          asset_kind: master.asset_kind,
          is_physical: master.is_physical,
          business_stage: master.business_stage,
          directness: link.directness,
          exposure_role: link.exposure_role,
          source_confidence: link.confidence
        })
      });
      rowsByKey.set(String(link.fund_id) + '|' + String(link.asset_id), row);
    });

    fallbackRows.forEach(function (asset) {
      if (!asset.fund_id) return;
      var key = String(asset.fund_id) + '|' + String(asset.asset_id || asset.id || asset.asset_name || 'fallback');
      if (!rowsByKey.has(key)) rowsByKey.set(key, asset);
    });

    return Array.from(rowsByKey.values());
  }

  function currentDatasetSignature() {
    return [
      (window.allFunds || []).length,
      (window.allFundAssets || []).length,
      (window.allAssetMaster || []).length,
      (window.allAssetFundLinks || []).length
    ].join(':');
  }

  function invalidatePortfolioAnalysisDataset() {
    datasetCache = null;
    datasetSignature = '';
  }

  function getPortfolioAnalysisDataset() {
    var signature = currentDatasetSignature();
    if (!datasetCache || signature !== datasetSignature) {
      datasetCache = Engine.createDataset(window.allFunds || [], combinedExposureRows());
      datasetSignature = signature;
    }
    return datasetCache;
  }

  function buildAnalysisQuerySpec(options) {
    var settings = options || {};
    return {
      filters: cloneFilters(window.analysisFilters || {}),
      countBasis: settings.countBasis || analysisCountBasis,
      ignoreKeys: settings.ignoreKeys || []
    };
  }

  function getCurrentAnalysisResult(options) {
    return Engine.query(getPortfolioAnalysisDataset(), buildAnalysisQuerySpec(options));
  }

  function getSemanticFilteredData(options) {
    if (!(window.allFunds || []).length) return [];
    return getCurrentAnalysisResult(options).funds;
  }

  function getDefinitionOptions(definition, dataset) {
    var options = Engine.getFilterOptions(dataset, definition.key);
    if (definition.options) {
      var existing = new Set(options);
      definition.options.forEach(function (value) {
        if (!existing.has(value)) options.push(value);
      });
    }
    return options.filter(Boolean);
  }

  function selectedLabel(key) {
    var selected = (window.analysisFilters && window.analysisFilters[key]) || [];
    if (!selected.length) return '전체';
    if (selected.length === 1) return selected[0];
    return selected.length + '개 선택';
  }

  function renderBasisControl() {
    var selectedBasis = BASIS_OPTIONS.find(function (option) { return option.value === analysisCountBasis; }) || BASIS_OPTIONS[0];
    return `
      <section class="semantic-basis-panel" aria-label="펀드 집계 기준">
        <div>
          <strong>펀드 수 산정 기준</strong>
        </div>
        <div class="semantic-basis-options">
          ${BASIS_OPTIONS.map(function (option) {
            return `<button type="button" class="semantic-basis-btn ${analysisCountBasis === option.value ? 'is-active' : ''}" data-analysis-basis="${option.value}" title="${escapeHtml(option.note)}">${escapeHtml(option.label)}</button>`;
          }).join('')}
        </div>
        <div class="semantic-basis-definition" aria-live="polite">
          <strong>${escapeHtml(selectedBasis.title)}</strong>
          <p>${escapeHtml(selectedBasis.note)}</p>
          <dl>
            <div><dt>포함</dt><dd>${escapeHtml(selectedBasis.includes)}</dd></div>
            <div><dt>제외</dt><dd>${escapeHtml(selectedBasis.excludes)}</dd></div>
          </dl>
        </div>
      </section>
    `;
  }

  function renderFilterControl(definition, dataset) {
    var options = getDefinitionOptions(definition, dataset);
    var selected = new Set((window.analysisFilters && window.analysisFilters[definition.key]) || []);
    return `
      <details class="semantic-filter-menu" data-filter-menu="${escapeHtml(definition.key)}">
        <summary>
          <span>${escapeHtml(definition.label)}</span>
          <strong data-filter-summary="${escapeHtml(definition.key)}">${escapeHtml(selectedLabel(definition.key))}</strong>
        </summary>
        <div class="semantic-filter-options">
          ${options.map(function (option) {
            return `
              <label>
                <input type="checkbox" data-semantic-filter="${escapeHtml(definition.key)}" value="${escapeHtml(option)}" ${selected.has(option) ? 'checked' : ''}>
                <span>${escapeHtml(option)}</span>
              </label>
            `;
          }).join('') || '<span class="semantic-filter-empty">선택 가능한 값이 없습니다.</span>'}
        </div>
      </details>
    `;
  }

  function renderActiveFilterSummary() {
    var target = document.getElementById('semanticActiveFilters');
    if (!target) return;
    var labels = new Map(Engine.FILTER_DEFINITIONS.map(function (definition) { return [definition.key, definition.label]; }));
    var chips = [];
    Object.keys(window.analysisFilters || {}).forEach(function (key) {
      (window.analysisFilters[key] || []).forEach(function (value) {
        chips.push(`<button type="button" data-remove-filter-key="${escapeHtml(key)}" data-remove-filter-value="${escapeHtml(value)}"><span>${escapeHtml(labels.get(key) || key)}</span>${escapeHtml(value)}<b aria-hidden="true">×</b></button>`);
      });
    });
    target.innerHTML = chips.length
      ? chips.join('')
      : '<span>선택한 조건이 없습니다. 전체 데이터가 대상입니다.</span>';
  }

  function updateFilterSummary(key) {
    var summary = document.querySelector('[data-filter-summary="' + CSS.escape(key) + '"]');
    if (summary) summary.textContent = selectedLabel(key);
    renderActiveFilterSummary();
  }

  function rerenderAnalysis(viewportState) {
    var state = viewportState || getStableViewportState();
    var result = typeof window.renderAnalytics === 'function' ? window.renderAnalytics() : null;
    return settleViewportAfter(result, state);
  }

  function initSemanticAnalysisFilters() {
    ensureDefaultFilters();
    var grid = document.getElementById('filterGrid');
    if (!grid) return;
    var dataset = getPortfolioAnalysisDataset();
    if (!dataset.fundFacts.length) {
      grid.innerHTML = '<div class="semantic-filter-loading">분석 데이터를 불러오는 중입니다.</div>';
      return;
    }
    var groups = Array.from(new Set(Engine.FILTER_DEFINITIONS.map(function (definition) { return definition.group; })));
    grid.innerHTML = '<div id="semanticActiveFilters" class="semantic-active-filters"></div>'
      + groups.map(function (group) {
        var definitions = Engine.FILTER_DEFINITIONS.filter(function (definition) { return definition.group === group; });
        return `
          <section class="semantic-filter-group">
            <h3>${escapeHtml(group)}</h3>
            <div class="semantic-filter-grid">
              ${definitions.map(function (definition) { return renderFilterControl(definition, dataset); }).join('')}
            </div>
          </section>
        `;
      }).join('');

    grid.querySelectorAll('[data-semantic-filter]').forEach(function (input) {
      input.addEventListener('change', function () {
        var viewportState = getStableViewportState();
        var key = input.dataset.semanticFilter;
        var selected = Array.from(grid.querySelectorAll('[data-semantic-filter="' + CSS.escape(key) + '"]:checked')).map(function (item) { return item.value; });
        if (selected.length) window.analysisFilters[key] = selected;
        else delete window.analysisFilters[key];
        analysisFilters = window.analysisFilters;
        updateFilterSummary(key);
        rerenderAnalysis(viewportState);
      });
    });

    grid.addEventListener('click', function (event) {
      var removeButton = event.target.closest('[data-remove-filter-key]');
      if (!removeButton) return;
      var viewportState = getStableViewportState();
      var key = removeButton.dataset.removeFilterKey;
      var value = removeButton.dataset.removeFilterValue;
      window.analysisFilters[key] = (window.analysisFilters[key] || []).filter(function (item) { return item !== value; });
      if (!window.analysisFilters[key].length) delete window.analysisFilters[key];
      initSemanticAnalysisFilters();
      rerenderAnalysis(viewportState);
    });

    renderActiveFilterSummary();
  }

  function resetSemanticAnalysisFilters() {
    var viewportState = getStableViewportState();
    window.analysisFilters = {};
    analysisFilters = window.analysisFilters;
    defaultsApplied = true;
    initSemanticAnalysisFilters();
    rerenderAnalysis(viewportState);
  }

  function setAnalysisCountBasis(value) {
    if (!BASIS_OPTIONS.some(function (option) { return option.value === value; })) return;
    var viewportState = getStableViewportState();
    analysisCountBasis = value;
    window.analysisCountBasis = value;
    initSemanticAnalysisFilters();
    rerenderAnalysis(viewportState);
  }

  function applyAnalysisPreset(key, value) {
    if (!key || !value) return;
    var viewportState = getStableViewportState();
    window.analysisFilters[key] = [value];
    analysisFilters = window.analysisFilters;
    initSemanticAnalysisFilters();
    rerenderAnalysis(viewportState);
  }

  function formatRatio(value) {
    return Number(value || 0).toFixed(1) + '%';
  }

  function formatInteger(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function breakdownButtons(title, key, rows, limit) {
    var visibleRows = (rows || []).slice(0, limit || 6);
    return `
      <div class="semantic-breakdown">
        <h4>${escapeHtml(title)}</h4>
        <div>
          ${visibleRows.map(function (row) {
            return `<button type="button" data-semantic-preset-key="${escapeHtml(key)}" data-semantic-preset-value="${escapeHtml(row.label)}"><span>${escapeHtml(row.label)}</span><strong>${formatInteger(row.count)}</strong></button>`;
          }).join('') || '<span class="semantic-empty">분류 데이터 없음</span>'}
        </div>
      </div>
    `;
  }

  function formatWonCompact(value) {
    var amount = Number(value || 0);
    if (amount >= 1e12 && typeof window.formatNumber === 'function') return window.formatNumber(amount);
    if (amount >= 1e12) {
      var trillion = Math.floor((amount / 1e12) * 100) / 100;
      return trillion.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '조';
    }
    if (amount >= 1e8) return (amount / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '억';
    if (amount >= 1e4) return (amount / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '만';
    return Math.round(amount).toLocaleString('ko-KR') + '원';
  }

  function compositionColor(key, label, index) {
    if (key === 'domestic_overseas') {
      return { '국내': '#2997ff', '해외': '#32d6a2', '미분류': '#737883' }[label] || '#82afb9';
    }
    var palette = ['#2997ff', '#32d6a2', '#f5b84b', '#ff7a7a', '#82afb9', '#b68cff', '#f58bc5', '#58c4dd', '#b8c45a', '#8f9bb3', '#d6945f', '#65a66a'];
    return palette[index % palette.length];
  }

  function getAumComposition() {
    var result = getCurrentAnalysisResult({ countBasis: 'aum_target' });
    var metric = typeof window.getAumBasisMetric === 'function' ? window.getAumBasisMetric() : 'benchmark_aum';
    var column = typeof window.getMetricColumn === 'function' ? window.getMetricColumn('aum', metric) : metric;
    var composition = Engine.buildAumComposition(result, {
      amountField: column,
      amountGetter: function (fund) {
        if (window.currentOrgScope === 'ra' && typeof window.isRAFund === 'function' && !window.isRAFund(fund)) return 0;
        if (typeof window.getFundAumStatus === 'function' && Engine.clean(window.getFundAumStatus(fund)) !== '운용') return 0;
        if (typeof window.isAumCountedFund === 'function' && !window.isAumCountedFund(fund)) return 0;
        return typeof window.getFundAmountWon === 'function' ? window.getFundAmountWon(fund, column) : 0;
      }
    });
    composition.metric = metric;
    composition.metricLabel = typeof window.getAumMetricConfig === 'function'
      ? window.getAumMetricConfig(metric).shortLabel
      : (metric === 'invested_aum' ? '투입액' : '약정액');
    return composition;
  }

  function stackedCompositionHtml(key, rows) {
    return `
      <div class="semantic-composition-stack" role="img" aria-label="국내 해외 AUM 구성비">
        ${(rows || []).map(function (row, index) {
          var title = row.label + ' ' + formatWonCompact(row.amount) + ' (' + formatRatio(row.ratio) + ')';
          var visibleLabel = row.ratio >= 8 ? row.label : '';
          return `<button type="button" data-semantic-preset-key="${escapeHtml(key)}" data-semantic-preset-value="${escapeHtml(row.label)}" style="--composition-size:${Math.max(0, row.ratio)}%; --composition-color:${compositionColor(key, row.label, index)}" title="${escapeHtml(title)}"><span>${escapeHtml(visibleLabel)}</span></button>`;
        }).join('')}
      </div>
      <div class="semantic-composition-legend">
        ${(rows || []).map(function (row, index) {
          return `<button type="button" data-semantic-preset-key="${escapeHtml(key)}" data-semantic-preset-value="${escapeHtml(row.label)}"><i style="--composition-color:${compositionColor(key, row.label, index)}"></i><span>${escapeHtml(row.label)}</span><strong>${formatWonCompact(row.amount)}</strong><em>${formatRatio(row.ratio)}</em></button>`;
        }).join('') || '<span class="semantic-empty">분류 데이터 없음</span>'}
      </div>
    `;
  }

  function horizontalCompositionHtml(key, rows) {
    return `
      <div class="semantic-composition-bars">
        ${(rows || []).map(function (row, index) {
          return `
            <button type="button" data-semantic-preset-key="${escapeHtml(key)}" data-semantic-preset-value="${escapeHtml(row.label)}">
              <span class="semantic-composition-bar-label"><b>${escapeHtml(row.label)}</b><em>${formatRatio(row.ratio)}</em></span>
              <span class="semantic-composition-bar-track"><i style="--composition-size:${Math.max(0, row.ratio)}%; --composition-color:${compositionColor(key, row.label, index)}"></i></span>
              <strong>${formatWonCompact(row.amount)}</strong>
            </button>
          `;
        }).join('') || '<span class="semantic-empty">분류 데이터 없음</span>'}
      </div>
    `;
  }

  function portfolioCompositionHtml() {
    var composition = getAumComposition();
    var hasData = composition.assetRows.length && composition.allocatedTotal > 0;
    return `
      <section id="semanticPortfolioComposition" class="semantic-portfolio-composition">
        <div class="semantic-composition-head">
          <div>
            <span>PORTFOLIO COMPOSITION</span>
            <h3>AUM 포트폴리오 구성</h3>
          </div>
          <p>${escapeHtml(composition.metricLabel)} AUM · AUM 대상(운용·자펀드 제외)</p>
        </div>
        ${hasData ? `
          <div class="semantic-composition-kpis">
            <div><span>배분 AUM</span><strong>${formatWonCompact(composition.allocatedTotal)}</strong></div>
            <div><span>투자대상</span><strong>${formatInteger(composition.assetRows.length)}<small>개</small></strong></div>
            <div><span>AUM 보유 펀드</span><strong>${formatInteger(composition.includedFundCount)}<small>개</small></strong></div>
          </div>
          <div class="semantic-composition-grid">
            <article>
              <div class="semantic-composition-title"><h4>국내·해외 구성</h4><span>AUM 비중</span></div>
              ${stackedCompositionHtml('domestic_overseas', composition.distributions.domestic_overseas)}
            </article>
            <article>
              <div class="semantic-composition-title"><h4>기초자산 구성</h4><span>AUM 비중</span></div>
              ${horizontalCompositionHtml('base_asset_class', composition.distributions.base_asset_class)}
            </article>
          </div>
        ` : '<div class="semantic-composition-empty">현재 필터와 AUM 기준에 해당하는 금액 데이터가 없습니다.</div>'}
        <p class="semantic-composition-note"><strong>산정 기준</strong> 각 펀드 AUM을 필터에 포함된 고유 투자대상 수로 균등 배분합니다. 한 대상에 기초자산 분류가 여러 개면 분류 간에도 균등 배분하고, 실물 연결이 없는 재간접·비실물은 펀드 기준으로 구성에 포함합니다. 개별 자산 감정가가 아닌 포트폴리오 구성 추정치입니다.</p>
      </section>
    `;
  }

  function semanticSummaryHtml(result) {
    var metrics = result.metrics;
    var filterCount = Object.values(window.analysisFilters || {}).reduce(function (sum, values) { return sum + values.length; }, 0);
    var basis = BASIS_OPTIONS.find(function (option) { return option.value === analysisCountBasis; }) || BASIS_OPTIONS[0];
    return `
      <section id="semanticAnalysisSummary" class="semantic-analysis-summary">
        <div class="semantic-summary-head">
          <div>
            <span>PORTFOLIO FACTS</span>
            <h3>조건별 펀드·자산 현황</h3>
          </div>
          <p>${escapeHtml(basis.label)} 기준 · 필터 ${filterCount}개 · 규칙 ${escapeHtml(result.ruleVersion)}</p>
        </div>
        ${renderBasisControl()}
        <div class="semantic-kpi-grid">
          <article>
            <span>대상 투자기구</span>
            <strong>${formatInteger(metrics.fundCount)}<small>개</small></strong>
            <p>Fund ${formatInteger(metrics.fundVehicleCount)}개</p>
          </article>
          <article>
            <span>고유 실물 부동산</span>
            <strong>${formatInteger(metrics.uniquePhysicalAssetCount)}<small>개</small></strong>
            <p>${formatInteger(metrics.linkedFundCount)}개 투자기구에 연결</p>
          </article>
          <article>
            <span>부동산형 Fund</span>
            <strong>${formatRatio(metrics.propertyRatio)}</strong>
            <p>${formatInteger(metrics.propertyCount)} / ${formatInteger(metrics.fundVehicleCount)}개</p>
          </article>
          <article>
            <span>개발 Fund + PFV</span>
            <strong>${formatRatio(metrics.developmentRatio)}</strong>
            <p>${formatInteger(metrics.developmentCount)} / ${formatInteger(metrics.developmentBaseCount)}개</p>
          </article>
        </div>
        <div class="semantic-breakdown-grid">
          ${breakdownButtons('국내/해외', 'domestic_overseas', result.distributions.domestic_overseas, 3)}
          ${breakdownButtons('기초자산', 'base_asset_class', result.distributions.base_asset_class, 6)}
          ${breakdownButtons('직접/재간접', 'investment_mode', result.distributions.investment_mode, 3)}
          ${breakdownButtons('개발/운영', 'business_stage', result.distributions.business_stage, 4)}
        </div>
      </section>
    `;
  }

  function bindSummaryActions(root) {
    if (!root) return;
    root.querySelectorAll('[data-analysis-basis]').forEach(function (button) {
      button.addEventListener('click', function () {
        setAnalysisCountBasis(button.dataset.analysisBasis);
      });
    });
    root.querySelectorAll('[data-semantic-preset-key]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyAnalysisPreset(button.dataset.semanticPresetKey, button.dataset.semanticPresetValue);
      });
    });
  }

  function injectSemanticSummary() {
    var previous = document.getElementById('semanticAnalysisSummary');
    if (previous) previous.remove();
    var previousComposition = document.getElementById('semanticPortfolioComposition');
    if (previousComposition) previousComposition.remove();
    var result = getCurrentAnalysisResult();
    var summaryHtml = semanticSummaryHtml(result);
    var compositionHtml = portfolioCompositionHtml();
    var mobileShell = document.querySelector('.mobile-analysis-shell');
    if (mobileShell) {
      mobileShell.insertAdjacentHTML('afterbegin', summaryHtml);
      var mobileSnapshot = mobileShell.querySelector('.mobile-analysis-snapshot');
      if (mobileSnapshot) mobileSnapshot.insertAdjacentHTML('afterend', compositionHtml);
      else document.getElementById('semanticAnalysisSummary').insertAdjacentHTML('afterend', compositionHtml);
      bindSummaryActions(document.getElementById('semanticAnalysisSummary'));
      bindSummaryActions(document.getElementById('semanticPortfolioComposition'));
      return;
    }
    var header = document.querySelector('.analytics-container > .detail-header');
    if (header) {
      header.insertAdjacentHTML('afterend', summaryHtml);
      var overview = document.querySelector('.analytics-container > .current-aum-overview');
      if (overview) overview.insertAdjacentHTML('afterend', compositionHtml);
      else document.getElementById('semanticAnalysisSummary').insertAdjacentHTML('afterend', compositionHtml);
      bindSummaryActions(document.getElementById('semanticAnalysisSummary'));
      bindSummaryActions(document.getElementById('semanticPortfolioComposition'));
    }
  }

  async function renderSemanticAnalytics() {
    if (typeof originalRenderAnalytics !== 'function') return;
    var viewportState = getStableViewportState();
    try {
      await originalRenderAnalytics();
      injectSemanticSummary();
    } finally {
      scheduleViewportRestore(viewportState);
    }
  }

  function filterDescription(filters) {
    var labels = new Map(Engine.FILTER_DEFINITIONS.map(function (definition) { return [definition.key, definition.label]; }));
    labels.set('development_scope', '개발 범주');
    var parts = [];
    Object.keys(filters || {}).forEach(function (key) {
      parts.push((labels.get(key) || key) + ': ' + filters[key].join(', '));
    });
    return parts.join(' · ') || '전체 데이터';
  }

  function questionValueHtml(answer) {
    if (answer.intent.metric === 'distribution') {
      return `<strong>${formatInteger(answer.denominator)}<small>개 기준</small></strong>`;
    }
    if (answer.unit === '%') {
      return `<strong>${Number(answer.value || 0).toFixed(1)}<small>%</small></strong><p>${formatInteger(answer.numerator)} / ${formatInteger(answer.denominator)}개</p>`;
    }
    return `<strong>${formatInteger(answer.value)}<small>${escapeHtml(answer.unit)}</small></strong>`;
  }

  function questionBreakdownHtml(answer) {
    if (!answer.breakdown || !answer.breakdown.length) return '';
    return `
      <div class="semantic-question-breakdown">
        ${answer.breakdown.map(function (row) {
          return `<div><span>${escapeHtml(row.label)}</span><strong>${formatInteger(row.count)}개</strong><em>${formatRatio(row.ratio)}</em></div>`;
        }).join('')}
      </div>
    `;
  }

  function questionFundListHtml(answer) {
    var funds = (answer.matchingFunds || []).slice().sort(function (a, b) {
      return String(a.fund_name || a.short_name || '').localeCompare(String(b.fund_name || b.short_name || ''), 'ko');
    });
    var visible = funds.slice(0, 30);
    if (!visible.length) return '<div class="semantic-question-empty">조건에 해당하는 펀드가 없습니다.</div>';
    return `
      <details class="semantic-question-evidence">
        <summary>근거 목록 ${formatInteger(funds.length)}개 보기</summary>
        <div>
          ${visible.map(function (fund) {
            return `<button type="button" onclick="openFundDetailById('${escapeHtml(fund.fund_id)}')"><span>${escapeHtml(fund.fund_name || fund.short_name || fund.fund_id)}</span><small>${escapeHtml(fund.fund_id)} · ${escapeHtml(fund.dept || '-')}</small></button>`;
          }).join('')}
          ${funds.length > visible.length ? `<p>앞의 ${visible.length}개를 표시했습니다. 전체 목록은 같은 조건을 종합분석에 적용해 확인하세요.</p>` : ''}
        </div>
      </details>
    `;
  }

  function renderSemanticQuestionAnswer() {
    if (!semanticSearchAnswer || !resultsContainer) return;
    var answer = semanticSearchAnswer.answer;
    var intent = answer.intent;
    resultsContainer.innerHTML = `
      <section class="semantic-question-card">
        <div class="semantic-question-kicker">ANALYTICAL SEARCH</div>
        <h2>${escapeHtml(intent.rawText)}</h2>
        <div class="semantic-question-value">${questionValueHtml(answer)}</div>
        <p class="semantic-question-label">${escapeHtml(answer.label)}</p>
        <div class="semantic-question-basis">
          <span>분자 조건</span><strong>${escapeHtml(filterDescription(intent.filters))}</strong>
          ${intent.metric === 'ratio' || intent.metric === 'distribution' ? `<span>분모 조건</span><strong>${escapeHtml(filterDescription(intent.denominatorFilters))}</strong>` : ''}
          <span>집계 규칙</span><strong>펀드코드 기준 · 규칙 ${escapeHtml(answer.ruleVersion)}</strong>
        </div>
        ${questionBreakdownHtml(answer)}
        <button type="button" class="semantic-question-apply" onclick="applyCurrentQuestionToAnalysis()">종합분석에 조건 적용</button>
      </section>
      ${questionFundListHtml(answer)}
    `;
  }

  function performSemanticSearch(query) {
    var intent = Engine.parseQuestion(query);
    if (!intent) {
      semanticSearchAnswer = null;
      return typeof originalPerformSearch === 'function' ? originalPerformSearch(query) : Promise.resolve();
    }

    semanticSearchRequestId += 1;
    var requestId = semanticSearchRequestId;
    window.currentSearchQuery = query;
    if (resultsContainer) resultsContainer.innerHTML = '<div class="no-results">분석 조건을 해석하는 중입니다.</div>';
    return ensureAllDataLoaded().then(function () {
      if (requestId !== semanticSearchRequestId) return;
      invalidatePortfolioAnalysisDataset();
      var answer = Engine.answerQuestion(getPortfolioAnalysisDataset(), intent);
      semanticSearchAnswer = { answer: answer };
      window.currentAnalyticalSearch = semanticSearchAnswer;
      renderSemanticQuestionAnswer();
    }).catch(function (error) {
      console.error('Analytical search failed:', error);
      if (resultsContainer) resultsContainer.innerHTML = '<div class="no-results">분석 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    });
  }

  function renderSemanticOrEntityResults() {
    if (semanticSearchAnswer) {
      renderSemanticQuestionAnswer();
      return;
    }
    if (typeof originalRenderResults === 'function') originalRenderResults();
  }

  function applyCurrentQuestionToAnalysis() {
    if (!semanticSearchAnswer) return;
    window.analysisFilters = cloneFilters(semanticSearchAnswer.answer.intent.filters);
    analysisFilters = window.analysisFilters;
    defaultsApplied = true;
    if (typeof window.showChartView === 'function') window.showChartView();
    else {
      var button = document.getElementById('chartViewBtn');
      if (button) button.click();
    }
  }

  window.invalidatePortfolioAnalysisDataset = invalidatePortfolioAnalysisDataset;
  window.getPortfolioAnalysisDataset = getPortfolioAnalysisDataset;
  window.buildAnalysisQuerySpec = buildAnalysisQuerySpec;
  window.getCurrentAnalysisResult = getCurrentAnalysisResult;
  window.getFilteredData = getSemanticFilteredData;
  window.initAnalysisFilters = initSemanticAnalysisFilters;
  window.resetAnalysisFilters = resetSemanticAnalysisFilters;
  window.setAnalysisCountBasis = setAnalysisCountBasis;
  window.applyAnalysisPreset = applyAnalysisPreset;
  window.renderAnalytics = renderSemanticAnalytics;
  window.performSearch = performSemanticSearch;
  window.renderResults = renderSemanticOrEntityResults;
  window.applyCurrentQuestionToAnalysis = applyCurrentQuestionToAnalysis;

  initViewportStabilityGuard();

  getFilteredData = getSemanticFilteredData;
  initAnalysisFilters = initSemanticAnalysisFilters;
  resetAnalysisFilters = resetSemanticAnalysisFilters;
  renderAnalytics = renderSemanticAnalytics;
  performSearch = performSemanticSearch;
  renderResults = renderSemanticOrEntityResults;
})();
