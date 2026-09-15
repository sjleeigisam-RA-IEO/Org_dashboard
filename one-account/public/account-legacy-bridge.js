'use strict';
(function () {
  const copy = value => JSON.parse(JSON.stringify(value));
  function projectExposures(rows) {
    return (rows || []).map(row => ({
      exposureId: row.exposure_id || '', role: row.role_label || row.role || '',
      fundName: row.fund_name || '', assetName: row.asset_name || '',
      amount: typeof row.amount_primary === 'number' && Number.isFinite(row.amount_primary) ? row.amount_primary : null,
      amountLabel: row.amount_primary_label || '', operatingStatus: row.operating_status || '', snapshotDate: row.snapshot_date || '',
    }));
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { projectExposures }; return; }
  if (typeof D === 'undefined' || typeof accountsById === 'undefined') return;
  const legacyApp = document.querySelector('body > .app');
  let committed = window.OneAccountShared?.getState() || { teams: {}, version: null };
  window.addEventListener('oa:teams-changed', event => { committed = copy(event.detail); });
  // The workspace owns navigation. Keep legacy tab handlers for existing drill-downs.
  let switchingView = false;
  function show(mode) {
    const visible = mode !== 'accounts';
    if (legacyApp) { legacyApp.hidden = !visible; legacyApp.setAttribute('aria-hidden', String(!visible)); }
    document.body.classList.toggle('oa-workspace-mode', !visible);
    document.body.classList.toggle('oa-workspace-legacy-mode', visible);
    if (visible) {
      switchingView = true;
      try { document.querySelector(`[data-view="${mode === 'analysis' ? 'lookthroughView' : 'mapView'}"]`)?.click(); }
      finally { switchingView = false; }
      if (mode === 'rm' && typeof renderList === 'function') renderList();
    }
    adaptInterface();
  }
  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node && node.textContent !== value) node.textContent = value;
  }
  function replaceCopy(selector, replacements) {
    document.querySelectorAll(selector).forEach(node => {
      // Touch labels only, never a parent containing controls or source values.
      if (node.children.length) return;
      let value = node.textContent;
      for (const [before, after] of replacements) value = value.replaceAll(before, after);
      if (value !== node.textContent) node.textContent = value;
    });
  }
  function adaptInterface() {
    setText('#accountIndex .panel-head h2', '기관 목록');
    setText('#accountIndex .panel-head p', 'PISCFH 분류순 · 기관명순');
    setText('label[for="search"]', '기관 검색');
    setText('#viewMode option[value="account"]', '기관별');
    setText('#viewMode option[value="rm"]', '담당 RM별');
    setText('#viewMode option[value="piscfh"]', '분류별');
    document.querySelector('#search')?.setAttribute('placeholder', '기관명·별칭 검색');
    document.querySelector('#piscfhFilter')?.setAttribute('aria-label', 'PISCFH 분류');
    for (const id of ['statusFilter', 'sortBy']) {
      const field = document.getElementById(id)?.closest('.filter-field');
      if (field) field.hidden = true;
    }
    if (typeof filtered === 'function') setText('#resultCount', `${filtered().length.toLocaleString('ko-KR')}개 기관 · PISCFH·기관명순`);
    replaceCopy('.account-row .faces', [['개 얼굴', '개 관계 유형']]);
    replaceCopy('.account-row .row-meta span', [['Team ', 'RM ']]);
    setText('#rmDrawerTitle', 'RM 담당팀 배정');
    setText('#rmDrawer .rm-drawer-title p', 'Primary·Backup·Sponsor 각 1명 · 역할마다 다른 담당자를 배정합니다.');
    setText('#assignRm', '선택 기관에 배정');
    document.querySelector('#rmDrawerClose')?.setAttribute('aria-label', 'RM 담당팀 닫기');
    document.querySelector('#rmCandidateList')?.setAttribute('aria-label', 'RM 담당자 후보');
    const selection = document.querySelector('#rmSelection');
    if (selection) for (const child of selection.childNodes) if (child.nodeType === 3) child.textContent = child.textContent.replaceAll('현재 Account', '선택 기관');
    setText('#primaryAssign', 'RM 담당팀 배정');
    setText('#mapOverview', '기관 관계');
    replaceCopy('#inspector h3, #inspector .inspector-toggle, #inspector .lt-jump, .map-context-strip span, .oa-hierarchy-eyebrow', [
      ['Account Team', 'RM 담당팀'], ['Account 상세', '기관 정보'], ['Account', '기관'],
      ['통합 익스포저', '투자·거래 관계'], ['Look-through', '투자 경로'], ['Role Focus', '관계 유형'],
    ]);
    document.querySelector('#accountScopeToggle')?.setAttribute('aria-label', '기관 표시 범위');
    const assignButton = document.querySelector('#primaryAssign');
    if (assignButton) assignButton.setAttribute('aria-label', (assignButton.getAttribute('aria-label') || 'RM 담당팀 배정').replaceAll('Account Team', 'RM 담당팀'));
    replaceCopy('#inspector .group, #inspector .team-cell small, #inspector .exposure-list .empty, #inspector .delegated-inspector .source', [
      ['Account 묶음', '기관 그룹'], ['Account Team에서 지정', 'RM 담당팀에서 배정'],
      ['익스포저', '투자·거래 관계'], ['Account canonical exposure에 포함', '투자·거래 관계에 포함'],
    ]);
    replaceCopy('#inspector h3', [['익스포저', '투자·거래 관계'], ['PISCFH·자본조건', '분류·투자 유형']]);
    document.querySelectorAll('#inspector .section').forEach(section => {
      if (section.querySelector('h3')?.textContent === 'Alias·식별 근거') section.hidden = true;
    });
    document.querySelectorAll('.map-context-strip span, .oa-hierarchy-eyebrow').forEach(node => {
      for (const child of node.childNodes) if (child.nodeType === 3) child.textContent = child.textContent.replaceAll('ACCOUNT', '기관').replaceAll('Account', '기관');
    });
    document.querySelectorAll('.account-row').forEach(node => {
      const label = node.getAttribute('aria-label');
      if (label) node.setAttribute('aria-label', label.replaceAll('Account', '기관'));
    });
    document.querySelectorAll('.piscfh-code[title]').forEach(node => {
      if (/^[A-Z_]+$/.test(node.title)) node.removeAttribute('title');
    });
    document.querySelector('#ltKpis')?.setAttribute('aria-label', '분류별 관계금액');
    document.querySelector('[aria-label="Look-through 금액 기준"]')?.setAttribute('aria-label', '금액 기준');
    replaceCopy('#inspector .lt-inspector p', [['관계지도·Role Focus와 동일한 canonical Account exposure', '선택 기관의 투자·거래 관계를 집계합니다.']]);
    replaceCopy('#inspector .lt-inspector-grid span', [['에셋', '자산'], ['경제관계', '투자·거래 관계']]);
    setText('#lookthroughView .lt-head h2', '투자·거래 관계 분석');
    setText('#lookthroughView .lt-head p', '기관별 투자·대출·거래 관계와 연결된 펀드·자산을 조회합니다.');
    setText('label[for="ltSearch"]', '투자·거래 검색');
    document.querySelector('#ltSearch')?.setAttribute('placeholder', '기관·자산·펀드 검색');
    document.querySelector('#ltRoleFilter')?.setAttribute('aria-label', '관계 유형');
    document.querySelector('#ltPiscfhFilter')?.setAttribute('aria-label', 'PISCFH 분류');
    replaceCopy('.lt-table-head span', [['오리진 Account', '기관'], ['에셋', '자산·펀드'], ['원소스 경로', '연결 경로']]);
    replaceCopy('#ltResult, #ltRows .lt-empty, #modalEyebrow', [
      ['Account×에셋', '기관·자산'], ['통합 Account Exposure', '투자·거래 관계'], ['통합 익스포저', '투자·거래 관계'],
    ]);
    replaceCopy('#ltKpis .lt-kpi span', [['통합 익스포저', '총 관계금액']]);
    replaceCopy('#ltKpis .lt-kpi small', [['관계지도와 동일', '선택한 금액 기준']]);
    const cards = document.querySelector('#ltKpis');
    if (cards) {
      const order = ['P', 'I', 'S', 'C', 'F', 'H'];
      const ranked = [...cards.children].filter(node => /^[PISCFH] ·/.test(node.querySelector('span')?.textContent || ''));
      ranked.sort((a, b) => order.indexOf(a.querySelector('span').textContent[0]) - order.indexOf(b.querySelector('span').textContent[0]));
      for (const node of ranked) cards.append(node);
    }
    // Source diagnostics remain available to maintainers, outside the customer UI.
    const coverage = document.querySelector('#ltCoverage')?.closest('.lt-section');
    if (coverage) coverage.hidden = true;
    const warning = document.querySelector('#lookthroughView .lt-warning');
    if (warning && !warning.closest('details')) {
      const details = document.createElement('details'); details.className = 'oa-analysis-method';
      const summary = document.createElement('summary'); summary.textContent = '금액 집계 기준';
      warning.before(details); details.append(summary, warning);
      // Preserve snapshot dates, exclusions and missing-amount qualifications.
      const walker = document.createTreeWalker(warning, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        let value = walker.currentNode.textContent;
        for (const [before, after] of [
          ['관계지도·Role Focus와 동일한 exposure', '투자·대출·거래 금액의 집계 기준'],
          ['LP 지분 약정', '투자자의 지분 약정'], ['Seller/Buyer 거래가격', '매도·매수 거래가격'],
          ['내부 비히클', '내부 투자기구'], ['passthrough로 보존합니다', '중간 투자 경로로 보존하며 중복 집계하지 않습니다'],
          ['root와 결합한 cross-snapshot 참고 추정치', '자료와 결합한 서로 다른 기준일의 참고 추정치'],
        ]) value = value.replaceAll(before, after);
        walker.currentNode.textContent = value;
      }
    }
  }
  // Preserve every existing filter and source record; change only display order.
  if (typeof filtered === 'function') {
    const originalFiltered = filtered;
    filtered = function (...args) {
      const rows = originalFiltered.apply(this, args);
      const compare = window.OneAccountWorkspace?.compareAccounts;
      return compare ? rows.slice().sort(compare) : rows;
    };
  }
  if (typeof state !== 'undefined') state.sort = 'name';
  const sort = document.querySelector('#sortBy'); if (sort) sort.value = 'name';
  for (const name of ['renderList', 'renderInspector', 'renderSelection', 'renderMap', 'prepareInspectorV2', 'renderLookthrough', 'renderLtRows', 'openLtModal', 'openRmDrawer', 'updateRmDrawerFooter']) {
    const original = window[name];
    if (typeof original === 'function') window[name] = function (...args) { const result = original.apply(this, args); adaptInterface(); return result; };
  }
  for (const [view, mode] of [['mapView', 'rm'], ['lookthroughView', 'analysis']]) {
    document.querySelector(`[data-view="${view}"]`)?.addEventListener('click', () => {
      if (!switchingView && window.OneAccountWorkspace?.readState().view !== mode) window.OneAccountWorkspace?.show(mode);
    });
  }
  function getAccountContext(id) {
    const account = accountsById.get(id);
    if (!account) return null;
    const rows = (D.account_asset_exposures || []).filter(row => row.account_id === id);
    return {
      account: copy(account), exposures: projectExposures(rows), relationshipCount: rows.length,
      fundCount: new Set(rows.map(row => row.fund_code).filter(Boolean)).size,
      assetCount: new Set(rows.map(row => row.asset_code).filter(Boolean)).size,
    };
  }
  window.OneAccountLegacy = {
    show, getAccountContext,
    getTeams: () => copy(committed),
    hasUnsaved: () => !!window.OneAccountShared?.hasUnsaved(),
    refreshTeams: async () => {
      committed = await window.OneAccountShared.refresh();
      return copy(committed);
    },
    openMap: id => {
      window.OneAccountWorkspace?.show('rm');
      // Do not hide an unassigned institution behind the legacy assigned-only scope.
      document.querySelector('[data-account-scope="all"]')?.click();
      if (typeof selectAccount === 'function') selectAccount(id);
      legacyApp?.scrollIntoView({ block: 'start' });
    },
  };
})();
