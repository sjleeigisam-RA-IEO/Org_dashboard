(function () {
  'use strict';

  if (!document.body.classList.contains('ux-v2')) return;

  var modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-v2-mode]'));
  var panel = document.getElementById('leftPanel');
  var collapseButton = document.getElementById('leftPanelCollapseBtn');
  var filterToggle = document.getElementById('v2FilterToggle');
  var filterToggleLabel = document.getElementById('v2FilterToggleLabel');
  var activeFilterCount = document.getElementById('v2ActiveFilterCount');
  var filterScrim = document.getElementById('v2FilterScrim');
  var mobileFilterClose = document.getElementById('v2MobileFilterClose');
  var panelEyebrow = document.getElementById('v2PanelEyebrow');
  var panelTitle = document.getElementById('v2PanelTitle');
  var panelHint = document.getElementById('v2PanelHint');
  var syncTimer = null;
  var mobileFilterTrigger = null;
  var mobileFilterPortal = null;
  var basisDisclosureOpen = false;
  var factsDisclosureOpen = false;

  var MODE_COPY = {
    portfolio: {
      eyebrow: 'PORTFOLIO',
      title: '포트폴리오 조건',
      hint: '선택한 범위가 자산 구성과 성장 추이에 바로 반영됩니다.'
    },
    capital: {
      eyebrow: 'CAPITAL RELATIONSHIPS',
      title: '자금관계 조건',
      hint: '투자자 또는 대주를 기준으로 약정·투입·미투입 관계를 분석합니다.'
    },
    search: {
      eyebrow: 'DATA EXPLORER',
      title: '데이터 조회',
      hint: '이름과 코드로 투자대상·수익자·대주를 한 번에 찾습니다.'
    }
  };

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
  }

  function currentMode() {
    if (document.body.classList.contains('list-view')) return 'search';
    if (document.body.classList.contains('capital-relationship-mode')) return 'capital';
    return 'portfolio';
  }

  function activeMobileFilterNode() {
    return currentMode() === 'capital'
      ? document.getElementById('capitalRelationshipControls')
      : document.getElementById('analysisViewControls');
  }

  function mountMobileFilter() {
    var node = activeMobileFilterNode();
    if (!node || node.parentNode === document.body) return;
    var placeholder = document.createComment('v2-mobile-filter-portal');
    node.parentNode.insertBefore(placeholder, node);
    document.body.appendChild(node);
    mobileFilterPortal = { node: node, placeholder: placeholder };
  }

  function restoreMobileFilter() {
    if (!mobileFilterPortal) return;
    var node = mobileFilterPortal.node;
    var placeholder = mobileFilterPortal.placeholder;
    if (placeholder.parentNode) {
      placeholder.parentNode.insertBefore(node, placeholder);
      placeholder.remove();
    }
    mobileFilterPortal = null;
  }

  function closeMobileFilter() {
    var wasOpen = document.body.classList.contains('v2-filter-open');
    document.body.classList.remove('v2-filter-open');
    restoreMobileFilter();
    if (filterToggle) filterToggle.setAttribute('aria-expanded', 'false');
    if (wasOpen && mobileFilterTrigger && typeof mobileFilterTrigger.focus === 'function') mobileFilterTrigger.focus();
    mobileFilterTrigger = null;
  }

  function activateMode(mode) {
    closeMobileFilter();
    var chartButton = document.getElementById('chartViewBtn');
    var listButton = document.getElementById('listViewBtn');

    if (mode === 'search') {
      if (listButton) listButton.click();
    } else {
      if (chartButton) chartButton.click();
      var analysisButton = document.querySelector('[data-analysis-mode="' + mode + '"]');
      if (analysisButton) analysisButton.click();
    }

    try {
      var url = new URL(window.location.href);
      if (mode === 'portfolio') url.searchParams.delete('mode');
      else url.searchParams.set('mode', mode);
      window.history.replaceState({}, '', url.toString());
    } catch (error) {
      console.warn('Could not persist v2 mode in the URL:', error);
    }

    window.setTimeout(syncWorkspace, 0);
  }

  function portfolioFilterCount() {
    var checked = document.querySelectorAll('#analysisFilters [data-semantic-filter]:checked').length;
    return checked;
  }

  function capitalFilterCount() {
    var count = 0;
    document.querySelectorAll('#capitalRelationshipFilterForm [data-capital-filter]').forEach(function (control) {
      if (String(control.value || '').trim()) count += 1;
    });
    var query = document.getElementById('capitalSearchInput');
    if (query && String(query.value || '').trim()) count += 1;
    return count;
  }

  function updateFilterCount(mode) {
    if (!activeFilterCount) return;
    var count = mode === 'portfolio' ? portfolioFilterCount() : (mode === 'capital' ? capitalFilterCount() : 0);
    activeFilterCount.textContent = String(count);
    activeFilterCount.hidden = count === 0;
  }

  function updatePanelCopy(mode) {
    var copy = MODE_COPY[mode];
    if (!copy) return;
    if (panelEyebrow) panelEyebrow.textContent = copy.eyebrow;
    if (panelTitle) panelTitle.textContent = copy.title;
    if (panelHint) panelHint.textContent = copy.hint;
  }

  function normalizeSearchWorkspace(mode) {
    if (mode !== 'search') return;
    var detailPanel = document.getElementById('detailPanel');
    if (detailPanel && detailPanel.querySelector('.analytics-container, .capital-analysis-root, .detail-placeholder:not(.v2-detail-placeholder)')) {
      detailPanel.innerHTML = [
        '<div class="detail-placeholder v2-detail-placeholder">',
        '<strong>조회 결과 상세</strong>',
        '<p>검색 결과를 선택하면 자산·펀드·기관의 연결 정보가 표시됩니다.</p>',
        '</div>'
      ].join('');
    }

    var searchInput = document.getElementById('searchInput');
    var results = document.getElementById('results');
    if (results && searchInput && !String(searchInput.value || '').trim()) {
      if (!results.querySelector('.v2-search-empty')) {
        results.innerHTML = [
          '<div class="v2-search-empty">',
          '<strong>검색어를 입력하세요</strong>',
          '<span>자산명, 펀드명, 기관명 또는 코드로 조회할 수 있습니다.</span>',
          '</div>'
        ].join('');
      }
    }
  }

  function enhanceBasisDisclosure() {
    var basisPanel = document.querySelector('.semantic-analysis-summary .semantic-basis-panel');
    if (!basisPanel || basisPanel.querySelector(':scope > .v2-basis-disclosure')) return;

    var definition = basisPanel.querySelector(':scope > .semantic-basis-definition');
    if (!definition) return;

    var details = document.createElement('details');
    details.className = 'v2-basis-disclosure';
    details.open = basisDisclosureOpen;

    var summary = document.createElement('summary');
    summary.textContent = '기준 설명';
    details.appendChild(summary);
    details.appendChild(definition);
    basisPanel.appendChild(details);

    details.addEventListener('toggle', function () {
      basisDisclosureOpen = details.open;
    });
  }

  function syncFactsSummaryCounts(details, kpiGrid) {
    if (!details || !kpiGrid) return;
    var labels = ['대상', '실물', '부동산형', '개발'];
    var articles = Array.prototype.slice.call(kpiGrid.querySelectorAll(':scope > article'));
    var countRow = details.querySelector(':scope > summary .v2-facts-counts');
    if (!countRow) return;

    articles.slice(0, 4).forEach(function (article, index) {
      var valueNode = article.querySelector(':scope > strong');
      var valueText = valueNode ? String(valueNode.textContent || '').replace(/\s+/g, '') : '0';
      var numberMatch = valueText.match(/[\d,.]+/);
      var value = numberMatch ? numberMatch[0] : valueText;
      var item = countRow.children[index];
      if (!item) return;
      var labelNode = item.querySelector('.v2-fact-count-label');
      var valueTarget = item.querySelector('.v2-fact-count-value');
      if (labelNode && labelNode.textContent !== labels[index]) labelNode.textContent = labels[index];
      if (valueTarget && valueTarget.textContent !== value) valueTarget.textContent = value;
    });
  }

  function enhanceFactsDisclosure() {
    var section = document.querySelector('.semantic-analysis-summary');
    if (!section) return;

    var existing = section.querySelector(':scope > .v2-facts-disclosure');
    if (existing) {
      syncFactsSummaryCounts(existing, existing.querySelector('.semantic-kpi-grid'));
      return;
    }

    var head = section.querySelector(':scope > .semantic-summary-head');
    var kpiGrid = section.querySelector(':scope > .semantic-kpi-grid');
    if (!head || !kpiGrid) return;

    var details = document.createElement('details');
    details.className = 'v2-facts-disclosure';
    details.open = factsDisclosureOpen;

    var summary = document.createElement('summary');
    summary.className = 'v2-facts-summary';
    summary.appendChild(head);

    var countRow = document.createElement('div');
    countRow.className = 'v2-facts-counts';
    ['대상', '실물', '부동산형', '개발'].forEach(function (label) {
      var item = document.createElement('span');
      item.className = 'v2-fact-count';

      var labelNode = document.createElement('span');
      labelNode.className = 'v2-fact-count-label';
      labelNode.textContent = label;

      var valueNode = document.createElement('strong');
      valueNode.className = 'v2-fact-count-value';
      valueNode.textContent = '0';

      var unitNode = document.createElement('span');
      unitNode.className = 'v2-fact-count-unit';
      unitNode.textContent = '개';

      item.appendChild(labelNode);
      item.appendChild(valueNode);
      item.appendChild(unitNode);
      countRow.appendChild(item);
    });
    summary.appendChild(countRow);

    var toggle = document.createElement('span');
    toggle.className = 'v2-facts-toggle';
    toggle.textContent = details.open ? '접기' : '상세 보기';
    summary.appendChild(toggle);
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'v2-facts-body';
    Array.prototype.slice.call(section.childNodes).forEach(function (node) {
      body.appendChild(node);
    });
    details.appendChild(body);
    section.appendChild(details);
    section.classList.add('v2-facts-enhanced');
    syncFactsSummaryCounts(details, kpiGrid);

    details.addEventListener('toggle', function () {
      factsDisclosureOpen = details.open;
      toggle.textContent = details.open ? '접기' : '상세 보기';
    });
  }

  function replaceText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function enhanceScaleSemantics() {
    var assetCard = document.querySelector('.current-aum-overview > .kpi-card:nth-child(2)');
    if (!assetCard) return;
    assetCard.classList.add('v2-asset-count-card');

    var note = assetCard.querySelector(':scope > div:first-child > div:last-child');
    replaceText(note, '순 AUM 운용기구 실물 기준 · 재간접·증권·포트폴리오 묶음 제외');
  }

  function enhanceCompositionSemantics() {
    var composition = document.querySelector('.semantic-portfolio-composition');
    if (!composition) return;
    composition.classList.add('v2-composition-semantics');

    var head = composition.querySelector('.semantic-composition-head');
    replaceText(head && head.querySelector('span'), 'AUM ALLOCATION');
    replaceText(head && head.querySelector('h3'), 'AUM 배분 구조');

    var headNote = head && head.querySelector('p');
    if (headNote && String(headNote.textContent || '').indexOf('금액 배분') < 0) {
      var metric = String(headNote.textContent || '').split(' AUM')[0].trim() || '선택 기준';
      replaceText(headNote, metric + ' 기준 · 금액 배분');
    }

    var kpis = composition.querySelector('.semantic-composition-kpis');
    if (kpis) {
      Array.prototype.slice.call(kpis.querySelectorAll(':scope > div')).forEach(function (item) {
        var label = item.querySelector('span');
        if (label && label.textContent.trim() === '배분 AUM') item.remove();
      });
      var items = kpis.querySelectorAll(':scope > div');
      replaceText(items[0] && items[0].querySelector('span'), 'AUM 배분 대상');
      replaceText(items[1] && items[1].querySelector('span'), 'AUM 보유 펀드');
    }

    var titles = composition.querySelectorAll('.semantic-composition-title');
    replaceText(titles[0] && titles[0].querySelector('h4'), '국내·해외 AUM 배분');
    replaceText(titles[0] && titles[0].querySelector('span'), '금액·비중');
    replaceText(titles[1] && titles[1].querySelector('h4'), '기초자산별 AUM 배분');
    replaceText(titles[1] && titles[1].querySelector('span'), '금액·비중');
  }

  function syncFilterToggle(mode) {
    if (!filterToggle || !filterToggleLabel) return;
    var collapsed = panel ? panel.classList.contains('collapsed') : false;
    var mobileOpen = document.body.classList.contains('v2-filter-open');
    var isSearch = mode === 'search';

    if (isMobile()) {
      filterToggle.hidden = isSearch;
      filterToggleLabel.textContent = mobileOpen ? '조건 닫기' : '조건 열기';
      filterToggle.setAttribute('aria-expanded', mobileOpen ? 'true' : 'false');
      filterToggle.setAttribute('aria-label', mobileOpen ? '조건 패널 닫기' : '조건 패널 열기');
      return;
    }

    filterToggle.hidden = false;
    filterToggleLabel.textContent = collapsed
      ? (isSearch ? '검색 열기' : '조건 열기')
      : (isSearch ? '검색 숨기기' : '조건 숨기기');
    filterToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function syncWorkspace() {
    var mode = currentMode();
    modeButtons.forEach(function (button) {
      var active = button.dataset.v2Mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    updatePanelCopy(mode);
    updateFilterCount(mode);
    syncFilterToggle(mode);
    normalizeSearchWorkspace(mode);
    enhanceBasisDisclosure();
    enhanceFactsDisclosure();
    enhanceScaleSemantics();
    enhanceCompositionSemantics();
    document.body.dataset.v2Mode = mode;
  }

  function scheduleSync() {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(syncWorkspace, 0);
  }

  modeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      activateMode(button.dataset.v2Mode);
    });
  });

  if (filterToggle) {
    filterToggle.addEventListener('click', function () {
      if (isMobile()) {
        if (!document.body.classList.contains('v2-filter-open')) mobileFilterTrigger = filterToggle;
        var opening = !document.body.classList.contains('v2-filter-open');
        document.body.classList.toggle('v2-filter-open', opening);
        if (opening) mountMobileFilter();
        else restoreMobileFilter();
        syncFilterToggle(currentMode());
        return;
      }
      if (collapseButton) collapseButton.click();
      window.setTimeout(syncWorkspace, 0);
    });
  }

  if (filterScrim) filterScrim.addEventListener('click', closeMobileFilter);
  if (mobileFilterClose) mobileFilterClose.addEventListener('click', closeMobileFilter);

  document.addEventListener('click', function (event) {
    if (event.target.closest('#chartViewBtn, #listViewBtn, [data-analysis-mode], [data-capital-role], #leftPanelCollapseBtn')) {
      scheduleSync();
    }
  });

  document.addEventListener('change', function (event) {
    if (event.target.closest('#analysisFilters, #capitalRelationshipFilterForm')) scheduleSync();
  });

  document.addEventListener('input', function (event) {
    if (event.target.closest('#capitalRelationshipFilterForm')) scheduleSync();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body.classList.contains('v2-filter-open')) closeMobileFilter();
  });

  var bodyObserver = new MutationObserver(scheduleSync);
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  var controlObserver = new MutationObserver(scheduleSync);
  ['analysisFilters', 'capitalRelationshipFilterForm'].forEach(function (id) {
    var target = document.getElementById(id);
    if (target) controlObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['checked', 'value', 'class'] });
  });

  var detailPanel = document.getElementById('detailPanel');
  if (detailPanel) {
    var detailObserver = new MutationObserver(function () {
      enhanceBasisDisclosure();
      enhanceFactsDisclosure();
      enhanceScaleSemantics();
      enhanceCompositionSemantics();
      if (currentMode() === 'search') normalizeSearchWorkspace('search');
    });
    detailObserver.observe(detailPanel, { childList: true, subtree: true });
  }

  window.addEventListener('resize', function () {
    if (!isMobile()) closeMobileFilter();
    scheduleSync();
  });

  var requestedParams = new URLSearchParams(window.location.search);
  var requestedMode = requestedParams.get('mode');
  var requestedQuery = String(requestedParams.get('query') || '').trim();
  var initialMode = requestedQuery ? 'search' : requestedMode;
  if (['portfolio', 'capital', 'search'].indexOf(initialMode) >= 0 && initialMode !== 'portfolio') {
    window.setTimeout(function () {
      activateMode(initialMode);
      if (requestedQuery) {
        var searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.value = requestedQuery;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }, 0);
  } else {
    syncWorkspace();
  }
})();
