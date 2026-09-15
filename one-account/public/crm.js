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
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { groupPeople, sortedPeople, titleParts, displayValue, departmentText, peopleSummary, accountSearch, hierarchyGroups, accountPath, personCount, preferenceText, sourceText, escape, labels };
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
  const lockHelp = '추후 인증 기능 업데이트 후 잠금 해제가 가능합니다.';
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
  drawer.addEventListener('close', () => { viewGeneration += 1; clearTimeout(searchTimer); focusReturn?.focus?.(); });
  drawer.addEventListener('click', e => { if (e.target === drawer) drawer.close(); });

  async function api(params) {
    const query = new URLSearchParams(params || {});
    const response = await fetch(`/api/crm${query.size ? `?${query}` : ''}`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store'
    });
    let result;
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      const error = new Error(response.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : response.status === 409 ? '다른 사용자가 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 수정해 주세요.' : result.message || '고객 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      error.status = response.status;
      throw error;
    }
    return result;
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
  async function openPerson(personId, accountId = view.accountId) {
    const generation = show('인물 상세', { kind: 'person', accountId, personId });
    try {
      // The server returns a basic profile while identity authentication is unavailable.
      const result = await api({ action: 'person', personId });
      if (generation !== viewGeneration || !drawer.open) return;
      const person = result.person || {};
      heading.textContent = displayValue(person.name) || '인물 상세';
      const affiliations = section('기본 소속 정보');
      const rows = sortedPeople(list(result.affiliations).map(a => ({
        account_id: a.account_id, account_name: a.account_name, affiliation_id: a.affiliation_id,
        person_id: a.person_id, department: a.department, title: a.title, rank: a.rank, job_grade: a.job_grade
      }))).map(affiliation => {
        const parts = titleParts(affiliation);
        const role = el('span', parts.position); role.title = parts.raw;
        const rank = el('span', parts.rank); rank.title = parts.raw;
        return [button(affiliation.account_name || catalogById.get(affiliation.account_id)?.name || '', () => openAccount(affiliation.account_id), 'oa-crm-table-link'), departmentText(affiliation, catalogById.get(affiliation.account_id)), role, rank];
      });
      affiliations.append(dataTable('기본 소속 정보', ['기관', '부서', '직책', '직급'], rows, 'oa-crm-basic-profile'));
      const masked = result.masked_details || {};
      const contactRows = Object.keys(maskedContactLabels).map(kind => ({ kind, value: list(masked.contacts).some(record => record?.kind === kind && record?.value === '*') ? '*' : '' }));
      const contacts = maskedDetailTable('연락처', [['kind', '종류'], ['value', '내용']], contactRows);
      const preferences = maskedDetailTable('수령가능 여부', [['campaign', '명절'], ['availability', '수령가능 여부'], ['scope', '적용 범위'], ['effective_from', '시작일'], ['effective_to', '종료일']], masked.preferences);
      const gifts = maskedDetailTable('선물 이력', [['campaign', '명절'], ['send_target', '발송대상'], ['item', '품목'], ['planned_amount', '예정 금액'], ['actual_amount', '실제 금액'], ['delivery_status', '실제 발송'], ['received_status', '실제 수령'], ['sent_on', '발송일'], ['received_on', '수령일']], masked.gifts, 'oa-crm-gifts-table');
      const events = maskedDetailTable('경조사', [['event_type', '종류'], ['event_date', '일자'], ['description', '내용']], masked.life_events);
      // Presence-only fields remain masked regardless of client identity flags.
      // Never fall back to raw private arrays, source notes, or editing actions.
      body.replaceChildren(affiliations, contacts, preferences, gifts, events);
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
