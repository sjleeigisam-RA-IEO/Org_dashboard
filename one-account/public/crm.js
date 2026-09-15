'use strict';
(function () {
  const labels = {
    employment: { unknown: '', current: '재직', former: '퇴사·이직' },
    availability: { yes: '수령 가능', no: '수령 불가', unknown: '', not_applicable: '해당없음' },
    scope: { campaign: '해당 명절에 한함', ongoing: '지속 적용', unknown: '' },
    contact: { mobile: '휴대전화', phone: '일반전화', email: '이메일', address: '배송주소', postcode: '우편번호' },
    event: { birthday: '생일', wedding: '결혼', bereavement: '부고', anniversary: '기념일', other: '기타 경조사' },
    calendar: { solar: '양력', lunar: '음력', unknown: '' },
    delivery: { unknown: '', sent: '발송 O', returned: '반송', cancelled: '취소', not_sent: '발송 X' },
    received: { unknown: '', received: '수령 O', not_received: '수령 X', declined: '수령 거절' },
    sourceField: { name: '성명', title: '직책', department: '부서·세부소속', phone: '전화번호', email: '이메일', value: '원본 값', notes: '메모', source_notes: '원본 메모', source_organization_name: '원본 기관명', source_piscfh: '원본 PISCFH', source_receiving_mark: '원본 수령여부', source_position_status: '원본 직책 확인 상태', planned_item_name: '발송 예정품', requester: '요청자', request_team: '요청팀', historical_department: '과거 부서', historical_title: '과거 직책', historical_phone: '과거 전화', historical_email: '과거 이메일', identity_review: '동일인 확인 사항', accepted_reconciliation_match: '기존 명단 일치 근거', list_membership: '명단 포함 근거', possible_duplicate_source_rows: '중복 검토 원본', source_affiliation_id: '원본 소속 연결', is_placeholder: '실명·소속 확인 대상', legacy_account_snapshot: '기존 어카운트 원본' }
  };
  const str = value => value == null ? '' : String(value);
  const list = value => Array.isArray(value) ? value : [];
  const escape = value => str(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const compare = (a, b) => str(a).localeCompare(str(b), 'ko');
  const displayValue = value => /^(?:-|—|미확인|없음|미입력|unknown|null|부서 미확인|직책 미확인)$/i.test(str(value).trim()) ? '' : str(value).trim();
  const maskedContactLabels = { mobile: '휴대전화', phone: '전화', email: '이메일', address: '주소', postcode: '우편번호' };
  function departmentText(person, account = {}) {
    const normalize = value => str(value).replace(/\s+/g, '').toLocaleLowerCase('ko');
    const names = new Set([person.account_name, account.name, ...list(account.aliases).map(a => typeof a === 'string' ? a : a.name)].filter(Boolean).map(normalize));
    const seen = new Set(), parts = [];
    for (const part of displayValue(person.department).split(/\s*\/\s*/)) {
      const tokens = part.split(';').map(v => v.trim());
      if (names.has(normalize(tokens[0]))) tokens.shift();
      const value = tokens.join(';').trim(), key = normalize(value);
      if (value && !seen.has(key)) { seen.add(key); parts.push(value); }
    }
    return parts.join(' / ');
  }
  const positionWeights = { 회장: 1000, 부회장: 980, 총재: 970, 이사장: 960, 대표이사: 950, 총괄대표: 950, 대표: 950, CEO: 950, 사장: 940, 행장: 940, 부총재: 910, 부이사장: 910, 부대표: 900, 부행장: 890, 부문대표: 880, CFO: 850, CIO: 850, COO: 850, 부문장: 740, 본부장: 720, 단장: 700, 국장: 690, 부국장: 680, 실장: 670, 센터장: 660, 소장: 650, 지점장: 650, 부서장: 640, 사업부장: 640, 그룹장: 620, 팀장: 600, 파트장: 580, 점장: 570, 원장: 740, 위원장: 740 };
  const gradeWeights = { 부사장: 880, 전무: 860, 전무이사: 860, 상무: 840, 상무이사: 840, 이사: 820, 사외이사: 820, 부장: 500, 부부장: 480, 차장: 460, 과장: 440, 대리: 420, 계장: 410, 주임: 400, 사원: 380, 수석: 490, 수석매니저: 490, 책임: 450, 책임매니저: 450, 선임: 430, 선임매니저: 430, 매니저: 410 };
  function positionWeight(value) {
    if (gradeWeights[value]) return 0;
    if (positionWeights[value]) return positionWeights[value];
    // A named business unit remains in the displayed role; only its explicit suffix is ranked.
    return Object.keys(positionWeights).filter(key => /장$/.test(key) && str(value).endsWith(key)).reduce((weight, key) => Math.max(weight, positionWeights[key]), 0);
  }
  function titleParts(person) {
    const raw = displayValue(person.title), explicitRank = displayValue(person.rank || person.job_grade);
    const tokens = [...new Set(raw.split(/\s*[/／·]\s*/).filter(Boolean))];
    const roles = tokens.filter(token => positionWeight(token));
    const grades = tokens.filter(token => gradeWeights[token]);
    const other = tokens.filter(token => !positionWeight(token) && !gradeWeights[token]);
    // Split only exact known role/grade vocabulary; unmatched source text remains visible.
    const position = [...roles, ...other].join(' / ');
    const rank = explicitRank || grades.join(' / ');
    const roleWeight = Math.max(0, ...roles.map(positionWeight));
    const rankWeight = Math.max(0, ...rank.split(/\s*[/／·]\s*/).map(token => gradeWeights[token] || 0));
    const seniority = rankWeight >= 800 ? Math.max(roleWeight, rankWeight) : roleWeight || rankWeight;
    return { position, rank, raw, roleWeight, rankWeight, seniority };
  }
  function sortedPeople(people, query = '') {
    const q = query.trim().toLocaleLowerCase('ko');
    return list(people).filter(p => [p.name, p.department, p.title, p.rank, p.job_grade, p.account_name].some(v => str(v).toLocaleLowerCase('ko').includes(q))).slice().sort((a, b) => {
      const aa = titleParts(a), bb = titleParts(b);
      return bb.seniority - aa.seniority || bb.roleWeight - aa.roleWeight || bb.rankWeight - aa.rankWeight || Number(Boolean(bb.raw || bb.rank)) - Number(Boolean(aa.raw || aa.rank)) || compare(displayValue(a.department) || '\uffff', displayValue(b.department) || '\uffff') || compare(a.name, b.name) || compare(a.person_id, b.person_id) || compare(a.affiliation_id, b.affiliation_id);
    });
  }
  const namesMatch = (account, query) => [account.name, ...list(account.aliases).map(alias => typeof alias === 'string' ? alias : alias.name)].some(value => str(value).toLocaleLowerCase('ko').includes(query));
  function accountSearch(accounts, query = '') {
    const rows = list(accounts);
    const byId = new Map(rows.map(account => [account.account_id, account]));
    const q = query.trim().toLocaleLowerCase('ko');
    return rows.filter(account => !account.parent_account_id || !byId.has(account.parent_account_id)).map(account => {
      const children = rows.filter(child => child.parent_account_id === account.account_id);
      return { account, children, matchingChildren: q ? children.filter(child => namesMatch(child, q)) : [] };
    }).filter(item => !q || namesMatch(item.account, q) || item.matchingChildren.length).sort((a, b) => compare(a.account.name, b.account.name));
  }
  function hierarchyGroups(accounts, query = '') {
    const q = query.trim().toLocaleLowerCase('ko');
    const groups = new Map();
    const order = ['중앙회', '지역 조합', '확인 필요'];
    for (const account of list(accounts).filter(account => namesMatch(account, q)).sort((a, b) => compare(a.name, b.name))) {
      const label = account.hierarchy_label || '하위 조직';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(account);
    }
    return [...groups].map(([label, accounts]) => ({ label, accounts })).sort((a, b) => (order.includes(a.label) ? order.indexOf(a.label) : order.length) - (order.includes(b.label) ? order.indexOf(b.label) : order.length) || compare(a.label, b.label));
  }
  function accountPath(accountId, accounts) {
    const byId = new Map(list(accounts).map(account => [account.account_id, account]));
    const path = [], seen = new Set();
    let account = byId.get(accountId);
    while (account && !seen.has(account.account_id)) {
      path.unshift(account); seen.add(account.account_id);
      account = byId.get(account.parent_account_id);
    }
    return path;
  }
  const personCount = people => new Set(list(people).map(person => person.person_id).filter(Boolean)).size;
  function groupPeople(people, query = '') {
    const groups = new Map();
    for (const person of sortedPeople(people, query)) {
      const key = displayValue(person.department);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(person);
    }
    return [...groups].map(([department, people]) => ({ department, people }));
  }
  function preferenceText(pref) {
    const value = labels.availability[pref.availability] || '';
    if (!value) return '';
    const scope = labels.scope[pref.scope] || '';
    const campaign = pref.campaign_name || pref.campaign_label || '';
    const period = [pref.effective_from, pref.effective_to].filter(Boolean).join(' ~ ');
    return [value, scope, campaign, period].filter(Boolean).join(' · ');
  }
  function sourceText(record) {
    const file = record.file_name || record.source_file || record.workbook || record.filename || record.source_name || '';
    const sheet = record.sheet_name || record.source_sheet || record.sheet || '';
    const row = record.row_number ?? record.source_row ?? record.row;
    return [file, sheet, row == null ? '' : `${row}행`].filter(Boolean).join(' · ') || record.source_record_id || record.id || '';
  }
  function peopleSummary(person) {
    // Read only the safe count; raw contact and gift fields never enter list rendering.
    return { contact: Number.isInteger(person.contact_count) && person.contact_count > 0 ? '*' : '', internalContact: '' };
  }
  function identityActive(identity, now = Date.now()) {
    return identity?.identityVerified === true && identity?.canEdit === true && typeof identity.email === 'string' && identity.email.length > 0 && Date.parse(identity.verifiedUntil) > now;
  }
  function mayReveal(identity, privacy, now = Date.now()) {
    return identityActive(identity, now) && privacy?.detailAccess === 'verified' && privacy?.identityVerified === true && privacy?.canEdit === true && Date.parse(privacy.verifiedUntil) > now;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { groupPeople, sortedPeople, titleParts, displayValue, departmentText, peopleSummary, accountSearch, hierarchyGroups, accountPath, personCount, preferenceText, sourceText, escape, labels, identityActive, mayReveal };
    return;
  }
  if (!/^https?:$/.test(location.protocol)) return;

  let catalog = null;
  let catalogById = new Map();
  let view = { kind: 'all', accountId: null, personId: null };
  let viewGeneration = 0;
  let loadGeneration = 0;
  let focusReturn = null;
  let searchTimer;
  let identity = null, identityGeneration = 0, identityTimer, currentPerson = null;
  let editor = null, editorGeneration = 0, identityDialog = null;
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action, className) => {
    const node = el('button', text, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const badge = (text, tone = '') => el('span', text, `oa-crm-badge ${tone}`);
  const lockHelp = '본인 인증 후 개인정보를 조회·수정할 수 있습니다.';
  function lockHint(node, label) {
    node.title = lockHelp; node.tabIndex = 0;
    node.setAttribute('aria-label', `${label}. ${lockHelp}`);
    return node;
  }
  const empty = text => el('p', text, 'oa-crm-empty');
  const section = title => {
    const node = el('section', undefined, 'oa-crm-section');
    node.append(el('h3', title));
    return node;
  };
  const bar = el('section', undefined, 'oa-crm-bar');
  bar.dataset.oneAccountCrm = '';
  bar.setAttribute('aria-label', '고객 관계 관리');
  const barText = el('div');
  barText.append(el('strong', 'Account People'));
  const barStatus = el('span', '기관별 인물 정보를 불러오는 중');
  barStatus.setAttribute('role', 'status');
  barStatus.setAttribute('aria-live', 'polite');
  barText.append(barStatus);
  const barActions = el('div', undefined, 'oa-crm-actions');
  const allButton = button('인물·기관 전체보기', () => openAll(), 'oa-crm-primary');
  const refreshButton = button('새로고침', () => refreshIndex(true));
  const exportLock = lockHint(el('span', undefined, 'oa-crm-locked-control'), '전체 명단 엑셀 잠김');
  exportLock.title = '전체 명단 엑셀 다운로드는 아직 열려 있지 않습니다.';
  exportLock.setAttribute('aria-label', exportLock.title);
  const exportButton = el('button', '전체 명단 엑셀'); exportButton.type = 'button'; exportButton.disabled = true;
  exportLock.append(exportButton);
  barActions.append(allButton, refreshButton, exportLock);
  bar.append(barText, barActions);
  (document.querySelector('.oa-shared-bar') || document.querySelector('.topbar'))?.insertAdjacentElement('afterend', bar);

  const drawer = el('dialog', undefined, 'oa-crm-drawer');
  drawer.dataset.oneAccountCrm = '';
  drawer.setAttribute('aria-labelledby', 'oa-crm-title');
  const head = el('header', undefined, 'oa-crm-head');
  const breadcrumb = el('nav', undefined, 'oa-crm-breadcrumb');
  breadcrumb.setAttribute('aria-label', '고객 정보 경로');
  const heading = el('h2', '인물·기관');
  heading.id = 'oa-crm-title';
  const headingBlock = el('div');
  headingBlock.append(breadcrumb, heading);
  const closeButton = button('닫기', () => drawer.close(), 'oa-crm-close');
  head.append(headingBlock, closeButton);
  const body = el('div', undefined, 'oa-crm-body');
  const footer = el('footer', '기관과 소속인물의 기본 정보를 조회합니다.', 'oa-crm-footer');
  drawer.append(head, body, footer);
  document.body.append(drawer);
  drawer.addEventListener('close', () => { viewGeneration += 1; clearTimeout(searchTimer); clearEditor(); currentPerson = null; body.replaceChildren(); focusReturn?.focus?.(); });
  drawer.addEventListener('click', e => { if (e.target === drawer) drawer.close(); });

  async function requestJson(url, payload) {
    const response = await fetch(url, {
      method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {})
    });
    let result;
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) invalidatePrivate();
      const error = new Error(response.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : response.status === 403 ? result.message || '본인 인증 후 다시 이용해 주세요.' : response.status === 409 ? '다른 사용자가 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 수정해 주세요.' : result.message || result.error || '요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      error.status = response.status; error.retryAfterSeconds = result.retryAfterSeconds; throw error;
    }
    return result;
  }
  async function api(params, payload) {
    const query = new URLSearchParams(params || {});
    return requestJson(`/api/crm${query.size ? `?${query}` : ''}`, payload);
  }
  function failure(error, retry) {
    body.replaceChildren(empty(error.message));
    if (error.status === 401) {
      const link = el('a', '다시 로그인', 'oa-crm-link');
      link.href = '/'; body.append(link);
    } else body.append(button('다시 시도', retry));
  }
  function decorateAccounts() {
    document.querySelectorAll('.account-row[data-id]').forEach(row => {
      row.querySelector('.oa-crm-account-count')?.remove();
      const account = catalogById.get(row.dataset.id);
      if (account) { const count = el('span', `소속인물 ${Number(account.people_count || 0).toLocaleString()}명`, 'oa-crm-account-count'); count.dataset.oneAccountCrm = ''; row.append(count); }
    });
    const inspector = document.querySelector('#inspector .inspector-body') || document.querySelector('#inspector');
    inspector?.querySelector('.oa-crm-account-section')?.remove();
    const id = typeof state !== 'undefined' ? state.selected : null;
    const account = catalogById.get(id);
    if (account && inspector) {
      const block = el('section', undefined, 'section oa-crm-account-section');
      block.dataset.oneAccountCrm = '';
      block.append(el('h3', account.account_kind === 'group' ? '하위 조직·소속인물' : '소속인물'));
      const count = Number(account.people_count || 0);
      block.append(el('p', `${account.account_kind === 'group' ? `하위 조직 ${Number(account.children_count || 0)}개 · ` : ''}${count.toLocaleString()}명 · 부서·직책·연락처·관계 이력`, 'source'), button(account.account_kind === 'group' ? '하위 조직·소속인물 보기' : '소속인물 보기', () => openAccount(id), 'oa-crm-inline-open'));
      inspector.prepend(block);
    }
  }
  if (typeof accountRow === 'function') {
    const originalRow = accountRow;
    accountRow = function (account, ...rest) {
      let html = originalRow(account, ...rest);
      const record = catalogById.get(account.account_id);
      if (account.crm_only && record?.account_kind !== 'group') html = html.replace(/<span class="faces">[^<]*<\/span>/, '<span class="faces">고객정보</span>').replace(/<div class="row-meta">[\s\S]*?<\/div>/, '<div class="row-meta"><span>고객정보 등록기관</span><span>사업 관계 미연결</span></div>');
      return record ? html.replace(/<\/button>\s*$/, `<span data-one-account-crm class="oa-crm-account-count">소속인물 ${Number(record.people_count || 0).toLocaleString()}명</span></button>`) : html;
    };
  }
  if (typeof renderInspector === 'function') {
    const originalInspector = renderInspector;
    renderInspector = function (...args) { const result = originalInspector(...args); decorateAccounts(); return result; };
  }
  async function refreshIndex(refreshView = false, initialCatalog = null) {
    const generation = ++loadGeneration;
    refreshButton.disabled = true;
    barStatus.textContent = '기관별 인물 정보를 불러오는 중';
    try {
      const result = initialCatalog || await api({ action: 'catalog' });
      if (generation !== loadGeneration) return;
      catalog = result;
      catalogById = new Map(list(result.accounts).map(a => [a.account_id, a]));
      window.OneAccountCRM.catalog = catalog;
      const totals = result.totals || {};
      const grouped = Number(totals.grouped_accounts ?? list(result.accounts).filter(account => account.parent_account_id).length);
      const topLevel = Number(totals.top_level_accounts ?? accountSearch(result.accounts).length);
      barStatus.textContent = `${topLevel.toLocaleString()}개 Account${grouped ? ` · 하위 조직 ${grouped.toLocaleString()}개` : ''} · ${Number(totals.persons || 0).toLocaleString()}명`;
      window.dispatchEvent(new CustomEvent('oa:crm-catalog', { detail: catalog }));
      decorateAccounts();
      if (refreshView && drawer.open) await reloadView();
    } catch (error) { if (generation === loadGeneration) barStatus.textContent = error.message; }
    finally { if (generation === loadGeneration) refreshButton.disabled = false; }
  }
  function show(title, next) {
    clearEditor(); currentPerson = null;
    if (!drawer.open) { focusReturn = document.activeElement; drawer.showModal(); }
    view = next;
    heading.textContent = title;
    body.replaceChildren(empty('불러오는 중…'));
    drawBreadcrumb(next);
    body.scrollTop = 0;
    return ++viewGeneration;
  }
  function drawBreadcrumb(next) {
    breadcrumb.replaceChildren(button('전체 기관·인물', () => openAll()));
    const path = accountPath(next.accountId, [...catalogById.values()]);
    path.forEach(account => breadcrumb.append(el('span', '›'), button(account.name || '기관', () => openAccount(account.account_id))));
    if (next.accountId && !path.length) breadcrumb.append(el('span', '›'), button('기관', () => openAccount(next.accountId)));
    if (next.kind === 'person') breadcrumb.append(el('span', '› 인물 상세'));
  }
  function searchInput(label, placeholder, onInput) {
    const wrapper = el('label', undefined, 'oa-crm-search');
    wrapper.append(el('span', label));
    const input = el('input');
    input.type = 'search'; input.placeholder = placeholder;
    input.addEventListener('input', () => onInput(input.value));
    wrapper.append(input);
    return wrapper;
  }
  function dataTable(title, headers, rows, className = '') {
    const wrapper = el('div', undefined, 'oa-crm-table-wrap');
    wrapper.tabIndex = 0; wrapper.setAttribute('aria-label', title);
    const table = el('table', undefined, `oa-crm-table ${className}`);
    table.append(el('caption', title, 'oa-crm-sr-only'));
    const head = el('thead'), header = el('tr'), body = el('tbody');
    headers.forEach(label => { const th = el('th', label); th.setAttribute('scope', 'col'); header.append(th); });
    head.append(header);
    rows.forEach(values => {
      const row = el('tr');
      values.forEach(value => {
        const cell = el('td');
        if (value && typeof value === 'object') cell.append(value);
        else cell.textContent = displayValue(value);
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body); wrapper.append(table); return wrapper;
  }
  function personTable(people, showAccount = false, title = '소속인물') {
    const headers = [...(showAccount ? ['기관'] : []), '성명', '부서', '직책', '직급', '연락처', '사내 컨택포인트'];
    const rows = people.map(person => {
      const name = el('div', undefined, 'oa-crm-name-cell');
      const open = button(displayValue(person.name), () => openPerson(person.person_id, person.account_id || view.accountId), 'oa-crm-person');
      if (!displayValue(person.name)) open.setAttribute('aria-label', '인물 상세 열기');
      name.append(open);
      if (person.employment_status === 'former') name.append(badge(labels.employment.former, 'is-muted'));
      if (person.identity_status === 'needs_review') name.append(badge('확인 필요', 'is-amber'));
      const parts = titleParts(person), summary = peopleSummary(person);
      const role = el('span', parts.position); role.title = parts.raw;
      const rank = el('span', parts.rank); rank.title = parts.raw;
      const contact = summary.contact ? lockHint(el('span', summary.contact, 'oa-crm-contact-lock'), '연락처 잠김') : '';
      const account = showAccount ? button(person.account_name || catalogById.get(person.account_id)?.name || '', () => openAccount(person.account_id), 'oa-crm-table-link') : null;
      return [...(showAccount ? [account] : []), name, departmentText(person, catalogById.get(person.account_id)), role, rank, contact, summary.internalContact];
    });
    return dataTable(title, headers, rows, `oa-crm-people-table${showAccount ? ' oa-crm-search-people-table' : ''}`);
  }
  function peopleGroups(container, people, query = '', showAccount = false) {
    container.replaceChildren();
    const rows = sortedPeople(people, query);
    if (!rows.length) { container.append(empty(query ? '검색 조건에 맞는 인물이 없습니다.' : '등록된 소속인물이 없습니다.')); return; }
    container.append(personTable(rows, showAccount));
  }
  function maskedDetailTable(title, columns, records, className = '') {
    const block = section(title);
    const indicator = lockHint(el('span', '🔒', 'oa-crm-section-lock'), `${title} 잠김`);
    block.children[0].append(indicator);
    const rows = list(records).map(record => columns.map(([key, label]) => {
      if (key === 'kind') return Object.prototype.hasOwnProperty.call(maskedContactLabels, record?.kind) ? maskedContactLabels[record.kind] : '';
      // A malformed or richer response can never reveal a value through this view.
      return record?.[key] === '*' ? lockHint(el('span', '*', 'oa-crm-masked-value'), `${label} 잠김`) : '';
    }));
    block.append(dataTable(title, columns.map(([, label]) => label), rows, `oa-crm-masked-detail-table ${className}`));
    return block;
  }
  function groupedPeopleTables(container, people, query = '') {
    container.replaceChildren();
    const groups = new Map();
    sortedPeople(people, query).forEach(person => {
      const id = person.account_id || '';
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(person);
    });
    [...groups].sort((a, b) => compare(catalogById.get(a[0])?.name || a[1][0].account_name, catalogById.get(b[0])?.name || b[1][0].account_name)).forEach(([id, rows]) => {
      const name = catalogById.get(id)?.name || rows[0].account_name || '';
      const block = section(`${name} · ${personCount(rows)}명`);
      if (id) block.append(button('소속 조직 열기', () => openAccount(id), 'oa-crm-table-link'));
      block.append(personTable(rows, false, `${name} 소속인물`)); container.append(block);
    });
    if (!groups.size) container.append(empty('검색 조건에 맞는 인물이 없습니다.'));
  }
  async function openAll() {
    const generation = show('기관과 소속인물', { kind: 'all', accountId: null, personId: null });
    if (!catalog) await refreshIndex();
    if (generation !== viewGeneration || !drawer.open) return;
    if (!catalog) { failure(new Error('공용 고객 정보에 연결되지 않았습니다.'), openAll); return; }
    const note = el('p', '회사·기관을 선택하거나 이름·부서·직책으로 인물을 찾아보세요.', 'oa-crm-note');
    const results = el('div');
    const drawAccounts = query => {
      const q = query.toLocaleLowerCase('ko').trim();
      const accounts = accountSearch([...catalogById.values()], q);
      const group = section(`Account ${accounts.length.toLocaleString()}개`);
      const rows = accounts.map(({ account, children, matchingChildren }) => [
        button(account.name, () => openAccount(account.account_id), 'oa-crm-account'), account.piscfh || '미Account', children.length || '', Number(account.people_count || 0),
        matchingChildren.length ? `일치하는 하위 조직: ${matchingChildren.slice(0, 4).map(child => child.name).join(', ')}${matchingChildren.length > 4 ? ` 외 ${matchingChildren.length - 4}개` : ''}` : ''
      ]);
      group.append(dataTable('기관 목록', ['기관', '구분', '하위 조직', '인원', '검색 일치'], rows, 'oa-crm-accounts-table')); results.replaceChildren(group);
      if (!accounts.length) group.append(empty('일치하는 기관이 없습니다.'));
      return q;
    };
    let searchGeneration = 0;
    const search = searchInput('기관·인물 검색', '기관명, 이름, 부서, 직책', value => {
      const token = ++searchGeneration;
      clearTimeout(searchTimer);
      const q = drawAccounts(value);
      if (!q) return;
      const matches = section('인물 검색 중…'); results.prepend(matches);
      searchTimer = setTimeout(async () => {
        try {
          const result = await api({ action: 'search', q, limit: '100' });
          if (generation !== viewGeneration || token !== searchGeneration) return;
          matches.replaceChildren(el('h3', `인물 ${list(result.people).length}명${result.truncated ? ' 이상 · 검색어를 더 입력하세요' : ''}`));
          matches.append(personTable(sortedPeople(result.people), true, '인물 검색 결과'));
          if (!list(result.people).length) matches.append(empty('일치하는 인물이 없습니다.'));
        } catch (error) { if (generation === viewGeneration && token === searchGeneration) matches.replaceChildren(empty(error.message)); }
      }, 220);
    });
    body.replaceChildren(note, search, results); drawAccounts('');
  }
  async function openAccount(accountId) {
    const generation = show(catalogById.get(accountId)?.name || '기관 소속인물', { kind: 'account', accountId, personId: null });
    try {
      const result = await api({ action: 'account', accountId });
      if (generation !== viewGeneration || !drawer.open) return;
      if (result.account) catalogById.set(result.account.account_id, { ...catalogById.get(result.account.account_id), ...result.account });
      if (result.parent_account) catalogById.set(result.parent_account.account_id, { ...catalogById.get(result.parent_account.account_id), ...result.parent_account });
      list(result.children).forEach(child => catalogById.set(child.account_id, { ...catalogById.get(child.account_id), ...child }));
      drawBreadcrumb(view);
      heading.textContent = result.account?.name || heading.textContent;
      const summary = el('div', undefined, 'oa-crm-account-summary');
      const grouped = result.account?.account_kind === 'group';
      summary.append(badge(result.account?.piscfh || '미Account'));
      if (grouped) summary.append(badge(`하위 조직 ${list(result.children).length}개`));
      else if (result.account?.hierarchy_label) summary.append(badge(result.account.hierarchy_label, result.account.hierarchy_label === '확인 필요' ? 'is-amber' : ''));
      summary.append(badge(`소속인물 ${personCount(result.people)}명`));
      if (result.account?.hierarchy_note) summary.append(el('p', result.account.hierarchy_note, 'oa-crm-hierarchy-note'));
      const review = result.account?.classification_review;
      if (review?.reason) {
        const details = el('details', undefined, 'oa-crm-classification');
        details.append(el('summary', review.review_required ? '분류 근거 · 추가 확인 필요' : '분류 근거'));
        details.append(el('p', review.reason));
        for (const value of list(review.source_urls)) {
          try {
            const url = new URL(value);
            if (!['https:', 'http:'].includes(url.protocol)) continue;
            const link = el('a', url.hostname);
            link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
            details.append(link, document.createTextNode(' '));
          } catch {}
        }
        summary.append(details);
      }
      if (grouped) {
        const note = el('p', '중앙회와 개별 조합을 선택하면 각 조직의 부서·직책별 소속인물과 연락 정보를 볼 수 있습니다.', 'oa-crm-note');
        const results = el('div');
        const drawChildren = query => {
          results.replaceChildren();
          const groups = hierarchyGroups(result.children, query);
          groups.forEach(group => {
            const block = section(`${group.label} · ${group.accounts.length}개`);
            const rows = group.accounts.map(account => [button(account.name, () => openAccount(account.account_id), 'oa-crm-account oa-crm-child-account'), account.piscfh || '미Account', Number(account.people_count || 0), account.hierarchy_note || '']);
            block.append(dataTable(group.label, ['조직', '구분', '인원', '참고'], rows, 'oa-crm-accounts-table')); results.append(block);
          });
          if (!groups.length) results.append(empty(query ? '일치하는 하위 조직이 없습니다.' : '등록된 하위 조직이 없습니다.'));
        };
        const search = searchInput('중앙회·조합 검색', '조합명 또는 기관명', drawChildren);
        const people = el('details', undefined, 'oa-crm-group-people');
        people.append(el('summary', `전체 소속인물 ${personCount(result.people)}명 보기`));
        const peopleResults = el('div');
        let loaded = false;
        people.addEventListener('toggle', () => {
          if (loaded || !people.open) return;
          loaded = true;
          people.append(searchInput('전체 소속인물 검색', '조합명, 이름, 부서, 직책', value => groupedPeopleTables(peopleResults, result.people, value)), peopleResults);
          groupedPeopleTables(peopleResults, result.people);
        });
        body.replaceChildren(summary, note, search, results, people); drawChildren('');
        return;
      }
      const note = el('p', '직책·직급순', 'oa-crm-note');
      const results = el('div');
      const search = searchInput('소속인물 검색', '이름, 부서, 직책', value => peopleGroups(results, result.people, value));
      body.replaceChildren(summary, note, search, results); peopleGroups(results, result.people);
    } catch (error) { if (generation === viewGeneration) failure(error, () => openAccount(accountId)); }
  }
  function clearEditor() {
    editorGeneration += 1;
    if (editor) { editor.querySelectorAll('input,textarea').forEach(input => { input.value = ''; }); editor.replaceChildren(); if (editor.open) editor.close(); }
  }
  function invalidatePrivate() {
    identityGeneration += 1; clearTimeout(identityTimer); identity = null; currentPerson = null;
    clearEditor();
    if (view.kind === 'person' && drawer.open) {
      viewGeneration += 1;
      body.replaceChildren(empty('개인정보가 잠겼습니다. 본인 인증 후 다시 조회해 주세요.'), button('본인 인증', openIdentity));
    }
  }
  function applyIdentity(value) {
    clearTimeout(identityTimer);
    identity = identityActive(value) ? value : { email: value?.email || '', identityVerified: false, canEdit: false, verifiedUntil: null };
    if (identityActive(identity)) {
      identityTimer = setTimeout(() => {
        const target = { ...view }; invalidatePrivate();
        if (target.kind === 'person' && drawer.open) openPerson(target.personId, target.accountId);
      }, Math.max(1, Math.min(8 * 60 * 60 * 1000, Date.parse(identity.verifiedUntil) - Date.now())));
      identityTimer?.unref?.();
    }
    return identity;
  }
  async function readIdentity() {
    const generation = identityGeneration;
    const result = await requestJson('/api/crm-identity');
    return generation === identityGeneration ? applyIdentity(result) : null;
  }
  async function openIdentity() {
    if (!identityDialog) {
      identityDialog = el('dialog', undefined, 'oa-crm-editor oa-crm-identity-dialog');
      identityDialog.dataset.oneAccountCrm = ''; identityDialog.setAttribute('aria-labelledby', 'oa-crm-identity-title');
      identityDialog.addEventListener('close', () => { identityDialog.querySelectorAll('input').forEach(input => { input.value = ''; }); identityDialog.replaceChildren(); }); document.body.append(identityDialog);
    }
    const generation = ++identityGeneration;
    identityDialog.replaceChildren(empty('인증 상태를 확인하는 중…')); identityDialog.showModal();
    let status;
    try { status = await requestJson('/api/crm-identity'); }
    catch (error) { if (identityDialog.open) identityDialog.replaceChildren(empty(error.message), button('닫기', () => identityDialog.close())); return; }
    if (!identityDialog.open || generation !== identityGeneration) return;
    applyIdentity(status);
    if (identityActive(identity)) { identityDialog.close(); await reloadView(); return; }
    const form = el('form', undefined, 'oa-crm-form');
    const title = el('h2', '본인 인증'); title.id = 'oa-crm-identity-title';
    const email = el('p', status.email || '', 'oa-crm-identity-email');
    const hint = el('p', '로그인한 회사 이메일로 받은 6자리 인증코드를 입력해 주세요.', 'oa-crm-note');
    const field = el('label', undefined, 'oa-crm-input'); field.append(el('span', '인증코드'));
    const code = el('input'); code.name = 'code'; code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 6; code.pattern = '[0-9]{6}'; field.append(code);
    const message = el('p', '', 'oa-crm-form-status'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    let retryAt = 0, busy = false;
    const send = button('인증코드 받기', async () => {
      if (busy) return;
      if (Date.now() < retryAt) { message.textContent = `${Math.ceil((retryAt - Date.now()) / 1000)}초 후 다시 요청해 주세요.`; return; }
      busy = true; send.disabled = true; verify.disabled = true; message.textContent = '인증코드를 보내는 중…';
      try {
        const sent = await requestJson('/api/crm-identity', { action: 'request-code' });
        if (!identityDialog.open || generation !== identityGeneration) return;
        retryAt = Date.now() + Number(sent.retryAfterSeconds || 60) * 1000;
        message.textContent = '인증코드를 발송했습니다. 메일에서 코드를 확인해 주세요.'; code.focus();
      } catch (error) {
        if (identityDialog.open) {
          retryAt = Date.now() + Number(error.retryAfterSeconds || 0) * 1000; message.textContent = error.message;
          if (error.status === 401 || error.status === 403) { code.value = ''; identityDialog.close(); failure(error, openIdentity); }
        }
      }
      finally { busy = false; send.disabled = false; verify.disabled = false; }
    });
    const actions = el('div', undefined, 'oa-crm-actions');
    const verify = el('button', '인증 확인', 'oa-crm-primary'); verify.type = 'submit';
    actions.append(button('취소', () => { code.value = ''; identityDialog.close(); }), verify);
    form.append(title, email, hint, send, field, message, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      if (!/^\d{6}$/.test(code.value.trim())) { message.textContent = '6자리 인증코드를 입력해 주세요.'; return; }
      busy = true; verify.disabled = true; send.disabled = true; message.textContent = '인증 중…';
      try {
        const verified = await requestJson('/api/crm-identity', { action: 'verify', code: code.value.trim() });
        if (!identityDialog.open || generation !== identityGeneration) return;
        if (!identityActive(verified)) throw new Error('인증 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
        applyIdentity(verified); code.value = ''; identityDialog.close(); await reloadView();
      } catch (error) {
        if (identityDialog.open) {
          message.textContent = error.message;
          if (error.status === 401 || error.status === 403) { code.value = ''; identityDialog.close(); failure(error, openIdentity); }
        }
      }
      finally { busy = false; verify.disabled = false; send.disabled = false; }
    });
    identityDialog.replaceChildren(form);
  }
  async function lockIdentity() {
    const target = { ...view }; invalidatePrivate();
    try {
      await requestJson('/api/crm-identity', { action: 'lock' });
      if (target.kind === 'person' && drawer.open) await openPerson(target.personId, target.accountId);
    } catch (error) { if (drawer.open) body.replaceChildren(empty(error.message), button('다시 잠그기', lockIdentity)); }
  }
  function identityBar(verified) {
    const bar = el('div', undefined, 'oa-crm-identity-bar');
    if (verified) bar.append(el('span', `${identity.email} · 본인 인증됨`), button('다시 잠그기', lockIdentity));
    else bar.append(button('본인 인증', openIdentity, 'oa-crm-primary'), el('span', '인증 후 개인정보 조회·수정'));
    return bar;
  }
  function recordTable(title, headers, records, render) {
    const block = section(title); block.append(dataTable(title, headers, list(records).map(render), 'oa-crm-record-table')); return block;
  }
  const entityLabels = { person: '인물', affiliation: '소속·재직', contact_point: '연락처', preference: '수령가능 여부', gift_recipient: '선물 이력', life_event: '경조사' };
  const fieldLabels = { name: '성명', identity_status: '실명 확인 상태', notes: '메모', department: '부서', title: '직책·직급', employment_status: '재직 상태', started_on: '소속 시작일', ended_on: '소속 종료일', kind: '정보 종류', value: '내용', verification_status: '연락처 확인 상태', availability: '수령가능 여부', scope: '적용 범위', campaign_id: '명절', effective_from: '적용 시작일', effective_to: '적용 종료일', event_type: '경조사 종류', event_date: '일자', recurring: '반복 여부', calendar: '양력·음력', description: '내용', item_id: '품목', send_target: '발송대상', plan_status: '명단 상태', delivery_status: '실제 발송', received_status: '실제 수령', planned_amount: '예정 금액', actual_amount: '실제 금액', sent_on: '발송일', received_on: '수령일', account_id: '기관' };
  const choiceLabels = { employment_status: labels.employment, kind: labels.contact, availability: labels.availability, scope: labels.scope, event_type: labels.event, calendar: labels.calendar, delivery_status: labels.delivery, received_status: labels.received, identity_status: { unverified: '', verified: '확인됨', needs_review: '확인 필요' }, verification_status: { unverified: '', source_reported: '원본 기재', verified: '확인됨', conflict: '값 상충' }, plan_status: { listed: '기존 명단', proposed: '추가 후보', cancelled: '취소' } };
  function valueText(key, value, result = currentPerson) {
    if (value == null || value === '') return '';
    if (key === 'send_target') return value === 'yes' ? 'O' : value === 'no' ? 'X' : '';
    if (key === 'recurring') return value === true ? '매년 반복' : value === false ? '해당 일자' : '';
    if (choiceLabels[key]) return choiceLabels[key][value] || '';
    if (key === 'account_id') return catalogById.get(value)?.name || '';
    if (key === 'campaign_id') return list(result?.campaigns).find(c => (c.campaign_id || c.id) === value)?.name || '';
    if (key === 'item_id') return list(result?.items).find(c => (c.item_id || c.id) === value)?.name || '';
    if (['planned_amount', 'actual_amount'].includes(key)) return Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('ko-KR')}원` : '';
    return typeof value === 'object' ? JSON.stringify(value) : str(value);
  }
  function renderVerifiedPerson(result) {
    const profile = section('기본 정보');
    profile.append(button('성명·메모 수정', () => editRecord('person', result.person)));
    if (result.person.notes) profile.append(el('p', result.person.notes, 'oa-crm-note'));
    const affiliations = recordTable('소속·재직 이력', ['기관', '부서', '직책', '직급', '재직', '시작일', '종료일', '메모', '관리'], sortedPeople(result.affiliations), a => {
      const parts = titleParts(a);
      return [a.account_name || catalogById.get(a.account_id)?.name, departmentText(a, catalogById.get(a.account_id)), parts.position, parts.rank, labels.employment[a.employment_status] || '', a.started_on, a.ended_on, a.notes, button('소속·재직 수정', () => editRecord('affiliation', a))];
    });
    affiliations.append(button('다른 소속 추가', () => editRecord('affiliation')));
    const affiliationName = row => list(result.affiliations).find(a => a.affiliation_id === row.affiliation_id)?.account_name || (row.affiliation_id ? '' : '개인 공통');
    const contacts = recordTable('연락처', ['종류', '내용', '소속', '확인 상태', '메모', '관리'], result.contact_points, row => {
      const edit = button('수정', () => editRecord('contact_point', row)); edit.setAttribute('aria-label', `${labels.contact[row.kind] || '연락처'} 수정`);
      return [labels.contact[row.kind] || '', row.value, affiliationName(row), valueText('verification_status', row.verification_status), row.notes, edit];
    });
    contacts.append(button('연락처 추가', () => editRecord('contact_point')));
    const preferences = recordTable('수령가능 여부', ['명절', '수령가능 여부', '적용 범위', '소속', '시작일', '종료일', '메모', '관리'], result.receiving_preferences, row => [row.campaign_name || valueText('campaign_id', row.campaign_id), valueText('availability', row.availability), valueText('scope', row.scope), affiliationName(row), row.effective_from, row.effective_to, row.notes, button('수령가능 여부 수정', () => editRecord('preference', row))]);
    preferences.append(button('수령가능 여부 추가', () => editRecord('preference')));
    const gifts = recordTable('선물 이력', ['명절', '당시 소속', '품목', '발송대상', '예정 금액', '실제 금액', '실제 발송', '실제 수령', '발송일', '수령일', '메모', '관리'], result.gift_recipients, row => [row.campaign_name || valueText('campaign_id', row.campaign_id), row.gift_account_name || affiliationName(row), row.item_name || row.gift_name || valueText('item_id', row.item_id), valueText('send_target', row.send_target), valueText('planned_amount', row.planned_amount), valueText('actual_amount', row.actual_amount), valueText('delivery_status', row.delivery_status), valueText('received_status', row.received_status), row.sent_on, row.received_on, row.notes, button('선물 이력 수정', () => editRecord('gift_recipient', row))]);
    gifts.append(button('선물 이력 추가', () => editRecord('gift_recipient')), el('p', '발송대상과 실제 발송·수령 기록을 각각 입력합니다.', 'oa-crm-note'));
    const events = recordTable('경조사', ['종류', '일자', '양력·음력', '반복', '내용', '메모', '관리'], result.life_events, row => {
      const edit = button('수정', () => editRecord('life_event', row)); edit.setAttribute('aria-label', `${labels.event[row.event_type] || '경조사'} 수정`);
      return [valueText('event_type', row.event_type), row.event_date, valueText('calendar', row.calendar), valueText('recurring', row.recurring), row.description, row.notes, edit];
    });
    events.append(button('경조사 추가', () => editRecord('life_event')));
    const historyRows = [];
    list(result.audit).forEach(record => {
      const before = record.before_record || {}, after = record.after_record || {};
      Object.keys(fieldLabels).forEach(key => {
        if (!(key in before) && !(key in after)) return;
        if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) return;
        const beforeText = displayValue(valueText(key, before[key], result)), afterText = displayValue(valueText(key, after[key], result));
        if (!beforeText && !afterText) return;
        const proof = record.verification;
        const verifiedAt = proof?.auth_method === 'email_otp' && proof.actor_email === record.actor_email && Number.isFinite(Date.parse(proof.verified_at)) ? new Date(proof.verified_at).toLocaleString('ko-KR') : '';
        historyRows.push([record.created_at ? new Date(record.created_at).toLocaleString('ko-KR') : '', record.actor_email || '', record.action === 'create' ? '입력' : record.action === 'update' ? '수정' : '', `${entityLabels[record.entity_type] || '정보'} · ${fieldLabels[key]}`, beforeText, afterText, verifiedAt]);
      });
    });
    const history = section('변경 이력'); history.append(dataTable('변경 이력', ['일시', '수정자', '구분', '항목', '변경 전', '변경 후', '이메일 인증 시각'], historyRows));
    const provenance = el('details', undefined, 'oa-crm-provenance'); provenance.append(el('summary', '원본 출처 및 근거'));
    provenance.append(dataTable('원본 출처', ['출처', '메모'], list(result.source_records).map(record => [sourceText(record), record.notes || record.match_reason || record.role])));
    provenance.append(dataTable('필드별 원본 근거', ['항목', '원본 값', '출처', '메모'], list(result.field_claims).map(claim => {
      const source = list(result.source_records).find(record => (record.source_record_id || record.id) === claim.source_record_id);
      const value = claim.value ?? claim.raw_value;
      return [labels.sourceField[claim.field_name] || fieldLabels[claim.field_name] || claim.field_name, value != null && typeof value === 'object' ? JSON.stringify(value) : value, source ? sourceText(source) : '', claim.notes];
    })));
    body.replaceChildren(identityBar(true), profile, affiliations, contacts, preferences, gifts, events, history, provenance);
  }
  const options = object => Object.entries(object).map(([value, label]) => ({ value, label }));
  function editRecord(entity, record = null) {
    if (!currentPerson || !mayReveal(identity, currentPerson.privacy)) { invalidatePrivate(); openIdentity(); return; }
    const creating = !record;
    if (creating && entity === 'person') return;
    const personId = currentPerson.person.person_id, accountId = view.accountId;
    const targetPerson = currentPerson;
    const chosenAffiliation = list(targetPerson.affiliations).find(a => a.account_id === accountId) || list(targetPerson.affiliations)[0];
    const pk = { person: 'person_id', affiliation: 'affiliation_id', contact_point: 'contact_point_id', preference: 'preference_id', gift_recipient: 'recipient_id', life_event: 'event_id' }[entity];
    const recordId = record?.[pk] || record?.id || crypto.randomUUID();
    if (!editor) {
      editor = el('dialog', undefined, 'oa-crm-editor'); editor.dataset.oneAccountCrm = ''; editor.setAttribute('aria-labelledby', 'oa-crm-editor-title');
      editor.addEventListener('close', () => { editorGeneration += 1; editor.querySelectorAll('input,textarea').forEach(input => { input.value = ''; }); editor.replaceChildren(); }); document.body.append(editor);
    }
    const generation = ++editorGeneration;
    const form = el('form', undefined, 'oa-crm-form');
    const title = el('h2', `${entityLabels[entity]} ${creating ? '추가' : '수정'}`); title.id = 'oa-crm-editor-title'; form.append(title);
    const fields = [];
    const add = (key, label, type = 'text', choices = null, fallback = '') => {
      const wrapper = el('label', undefined, 'oa-crm-input'); wrapper.append(el('span', label));
      const input = el(choices ? 'select' : type === 'textarea' ? 'textarea' : 'input');
      if (choices) choices.forEach(choice => { const option = el('option', choice.label); option.value = choice.value; input.append(option); });
      else if (type !== 'textarea') input.type = type;
      input.name = key; input.value = record?.[key] ?? fallback;
      if (type === 'textarea') { input.rows = 3; input.maxLength = key === 'notes' ? 10000 : 2000; }
      if (type === 'text') input.maxLength = key === 'name' ? 200 : key === 'value' ? 3000 : 1000;
      if (type === 'number') { input.min = '0'; input.max = '99999999999999.99'; input.step = '0.01'; }
      wrapper.append(input); form.append(wrapper); fields.push({ key, input, type }); return input;
    };
    const campaigns = [{ value: '', label: '' }, ...list(targetPerson.campaigns).map(c => ({ value: c.campaign_id || c.id, label: c.name }))];
    const items = [{ value: '', label: '' }, ...list(targetPerson.items).map(i => ({ value: i.item_id || i.id, label: i.name }))];
    if (entity === 'person') {
      add('name', '성명');
    } else if (entity === 'affiliation') {
      if (creating) add('account_id', '소속 기관', 'text', [{ value: '', label: '기관을 선택하세요' }, ...[...catalogById.values()].filter(a => a.account_kind !== 'group').sort((a, b) => compare(a.name, b.name)).map(a => ({ value: a.account_id, label: a.parent_account_id ? `${catalogById.get(a.parent_account_id)?.name || ''} / ${a.name}` : a.name }))], accountId || '');
      add('department', '부서'); add('title', '직책·직급');
      add('employment_status', '재직 상태', 'text', options(labels.employment), 'unknown');
      add('started_on', '소속 시작일', 'date'); add('ended_on', '소속 종료일', 'date');
    } else {
      const affOptions = [{ value: '', label: '개인 공통' }, ...list(targetPerson.affiliations).map(a => ({ value: a.affiliation_id || a.id, label: a.account_name || catalogById.get(a.account_id)?.name || '' }))];
      if (creating) add('affiliation_id', '해당 소속', 'text', affOptions, chosenAffiliation?.affiliation_id || chosenAffiliation?.id || '');
      else form.append(el('p', affOptions.find(a => a.value === (record.affiliation_id || ''))?.label || '', 'oa-crm-note'));
      if (entity === 'contact_point') {
        add('kind', '정보 종류', 'text', options(labels.contact), 'mobile'); add('value', '내용');
        add('verification_status', '확인 상태', 'text', options(choiceLabels.verification_status), 'unverified');
      } else if (entity === 'preference') {
        add('availability', '수령가능 여부', 'text', options(labels.availability), 'unknown');
        const scope = add('scope', '적용 범위', 'text', options(labels.scope), 'unknown');
        const campaign = add('campaign_id', '명절', 'text', campaigns);
        const scopeChanged = () => { campaign.disabled = scope.value === 'ongoing'; if (campaign.disabled) campaign.value = ''; };
        scope.addEventListener('change', scopeChanged); scopeChanged();
        add('effective_from', '적용 시작일', 'date'); add('effective_to', '적용 종료일', 'date');
      } else if (entity === 'gift_recipient') {
        if (creating) add('campaign_id', '명절', 'text', campaigns);
        else form.append(el('p', record.campaign_name || valueText('campaign_id', record.campaign_id, targetPerson), 'oa-crm-note'));
        add('item_id', '품목', 'text', items);
        add('send_target', '발송대상', 'text', [{ value: '', label: '' }, { value: 'yes', label: 'O' }, { value: 'no', label: 'X' }]);
        add('planned_amount', '예정 금액', 'number'); add('actual_amount', '실제 금액', 'number');
        add('delivery_status', '실제 발송', 'text', options(labels.delivery), 'unknown');
        add('received_status', '실제 수령', 'text', options(labels.received), 'unknown');
        add('sent_on', '발송일', 'date'); add('received_on', '수령일', 'date');
      } else if (entity === 'life_event') {
        add('event_type', '경조사 종류', 'text', options(labels.event), 'other'); add('event_date', '일자', 'date');
        add('calendar', '양력·음력', 'text', options(labels.calendar), 'unknown');
        add('recurring', '반복 여부', 'text', [{ value: 'false', label: '해당 일자' }, { value: 'true', label: '매년 반복' }], 'false'); add('description', '내용', 'textarea');
      }
    }
    add('notes', '메모', 'textarea');
    const status = el('p', '', 'oa-crm-form-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = el('div', undefined, 'oa-crm-actions');
    const cancel = button('취소', () => editor.close());
    const save = el('button', '저장', 'oa-crm-primary'); save.type = 'submit'; actions.append(cancel, save); form.append(status, actions);
    const requestId = crypto.randomUUID(); let retryPayload = null, saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || generation !== editorGeneration) return;
      if (!mayReveal(identity, targetPerson.privacy)) { invalidatePrivate(); return; }
      const patch = {};
      fields.forEach(({ key, input, type }) => {
        const value = input.value.trim();
        patch[key] = key === 'recurring' ? value === 'true' : type === 'number' ? value === '' ? null : Number(value) : type === 'date' || key.endsWith('_id') || key === 'send_target' ? value || null : value;
      });
      if (creating) patch.person_id = personId;
      if (entity === 'person' && !patch.name) { status.textContent = '성명을 입력해 주세요.'; return; }
      if (entity === 'contact_point' && !patch.value) { status.textContent = '연락처 내용을 입력해 주세요.'; return; }
      if (creating && entity === 'affiliation' && !patch.account_id) { status.textContent = '소속 기관을 선택해 주세요.'; return; }
      if (creating && entity === 'gift_recipient' && !patch.campaign_id) { status.textContent = '명절을 선택해 주세요.'; return; }
      if (entity === 'preference' && patch.scope === 'ongoing') patch.campaign_id = null;
      if (entity === 'preference' && patch.scope === 'campaign' && !patch.campaign_id) { status.textContent = '명절을 선택해 주세요.'; return; }
      if (patch.started_on && patch.ended_on && patch.started_on > patch.ended_on || patch.effective_from && patch.effective_to && patch.effective_from > patch.effective_to) { status.textContent = '종료일은 시작일보다 빠를 수 없습니다.'; return; }
      if (patch.employment_status === 'current' && patch.ended_on) { status.textContent = '재직 상태에서는 소속 종료일을 비워 주세요.'; return; }
      if (patch.sent_on && patch.delivery_status !== 'sent') { status.textContent = '발송일을 입력하려면 실제 발송 상태를 발송 O로 선택해 주세요.'; return; }
      if (patch.received_on && patch.received_status !== 'received') { status.textContent = '수령일을 입력하려면 실제 수령 상태를 수령 O로 선택해 주세요.'; return; }
      if (['planned_amount', 'actual_amount'].some(key => patch[key] != null && (!Number.isFinite(patch[key]) || patch[key] < 0 || patch[key] > 99999999999999.99))) { status.textContent = '금액은 0 이상의 숫자로 입력해 주세요.'; return; }
      const payload = retryPayload || { action: creating ? 'create' : 'update', entity, id: recordId, expectedRevision: creating ? 0 : record.revision, patch, requestId };
      saving = true; save.disabled = true; cancel.disabled = true; status.textContent = '저장 중…';
      try {
        await api(null, payload);
        if (generation !== editorGeneration) return;
        editor.close();
        if (view.kind === 'person' && view.personId === personId) await openPerson(personId, accountId);
        await refreshIndex();
      } catch (error) {
        if (generation !== editorGeneration) return;
        status.textContent = error.message;
        if (!error.status || error.status >= 500) {
          retryPayload = payload; save.textContent = '저장 결과 재확인'; fields.forEach(({ input }) => { input.disabled = true; });
        } else if (error.status === 409) {
          save.disabled = true; fields.forEach(({ input }) => { input.disabled = true; });
          actions.prepend(button('최신 정보 불러오기', async () => { editor.close(); await openPerson(personId, accountId); }));
        }
      } finally { saving = false; if (generation === editorGeneration) { if (!status.textContent.includes('다른 사용자가')) save.disabled = false; cancel.disabled = false; } }
    });
    editor.replaceChildren(form); editor.showModal();
  }
  async function openPerson(personId, accountId = view.accountId) {
    const generation = show('인물 상세', { kind: 'person', accountId, personId });
    try {
      const [status, result] = await Promise.all([readIdentity().catch(() => null), api({ action: 'person', personId })]);
      if (generation !== viewGeneration || !drawer.open) return;
      heading.textContent = displayValue(result.person?.name) || '인물 상세';
      if (mayReveal(status, result.privacy)) {
        applyIdentity({ ...status, verifiedUntil: new Date(Math.min(Date.parse(status.verifiedUntil), Date.parse(result.privacy.verifiedUntil))).toISOString() });
        currentPerson = result; renderVerifiedPerson(result); return;
      }
      currentPerson = null;
      const affiliations = section('기본 소속 정보');
      const rows = sortedPeople(list(result.affiliations).map(a => ({ account_id: a.account_id, account_name: a.account_name, affiliation_id: a.affiliation_id, person_id: a.person_id, department: a.department, title: a.title, rank: a.rank, job_grade: a.job_grade }))).map(a => {
        const parts = titleParts(a);
        return [button(a.account_name || catalogById.get(a.account_id)?.name || '', () => openAccount(a.account_id), 'oa-crm-table-link'), departmentText(a, catalogById.get(a.account_id)), parts.position, parts.rank];
      });
      affiliations.append(dataTable('기본 소속 정보', ['기관', '부서', '직책', '직급'], rows, 'oa-crm-basic-profile'));
      const masked = result.masked_details || {};
      const contactRows = Object.keys(maskedContactLabels).map(kind => ({ kind, value: list(masked.contacts).some(row => row?.kind === kind && row?.value === '*') ? '*' : '' }));
      const contacts = maskedDetailTable('연락처', [['kind', '종류'], ['value', '내용']], contactRows);
      const preferences = maskedDetailTable('수령가능 여부', [['campaign', '명절'], ['availability', '수령가능 여부'], ['scope', '적용 범위'], ['effective_from', '시작일'], ['effective_to', '종료일']], masked.preferences);
      const gifts = maskedDetailTable('선물 이력', [['campaign', '명절'], ['send_target', '발송대상'], ['item', '품목'], ['planned_amount', '예정 금액'], ['actual_amount', '실제 금액'], ['delivery_status', '실제 발송'], ['received_status', '실제 수령'], ['sent_on', '발송일'], ['received_on', '수령일']], masked.gifts, 'oa-crm-gifts-table');
      const events = maskedDetailTable('경조사', [['event_type', '종류'], ['event_date', '일자'], ['description', '내용']], masked.life_events);
      body.replaceChildren(identityBar(false), affiliations, contacts, preferences, gifts, events);
    } catch (error) { if (generation === viewGeneration) failure(error, () => openPerson(personId, accountId)); }
  }
  async function reloadView() {
    if (view.kind === 'person') return openPerson(view.personId, view.accountId);
    if (view.kind === 'account') return openAccount(view.accountId);
    return openAll();
  }
  window.OneAccountCRM = { catalog, refreshIndex, openAll, openAccount, openPerson, decorateAccounts };
  refreshIndex(false, window.ONE_ACCOUNT_CRM_INITIAL_CATALOG || null);
})();
