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
  const mark = value => value === 'yes' ? 'O' : value === 'no' ? 'X' : '';
  function campaignInfo(record, campaigns) {
    return list(campaigns).find(c => (c.campaign_id || c.id) === record.campaign_id) || record.campaign || {};
  }
  function campaignOrder(record, campaigns) {
    const campaign = campaignInfo(record, campaigns);
    const name = str(record.campaign_name || record.campaign_label || campaign.name);
    const year = Number(campaign.year || record.campaign_year || name.match(/(?:19|20)\d{2}/)?.[0] || 0);
    return year * 10 + (/추석/.test(name) ? 2 : /설/.test(name) ? 1 : 0);
  }
  function peopleSummary(person, campaigns = []) {
    const belongs = record => (!record.affiliation_id || !person.affiliation_id || record.affiliation_id === person.affiliation_id) && (!record.gift_account_id || !person.account_id || record.gift_account_id === person.account_id);
    const gifts = list(person.gift_recipients).filter(belongs).slice().sort((a, b) => campaignOrder(b, campaigns) - campaignOrder(a, campaigns) || compare(b.updated_at, a.updated_at) || compare(a.recipient_id, b.recipient_id));
    const latest = gifts[0];
    const sameCampaign = latest ? gifts.filter(g => latest.campaign_id ? g.campaign_id === latest.campaign_id : (g.campaign_name || g.campaign_label || '') === (latest.campaign_name || latest.campaign_label || '')) : [];
    const currentCampaign = latest?.campaign_id || list(campaigns).slice().sort((a, b) => campaignOrder({ campaign: b }, []) - campaignOrder({ campaign: a }, []))[0]?.campaign_id;
    const prefs = list(person.receiving_preferences).filter(p => belongs(p) && (p.scope !== 'campaign' || !currentCampaign || p.campaign_id === currentCampaign));
    const values = rows => [...new Set(rows.filter(Boolean))].join(' / ');
    return {
      contact: values(list(person.contact_points).filter(c => ['mobile', 'phone', 'email'].includes(c.kind)).map(c => displayValue(c.value))),
      receiving: values(prefs.map(p => mark(p.availability))),
      receivingDetail: values(prefs.map(p => preferenceText({ ...p, campaign_name: p.campaign_name || campaignInfo(p, campaigns).name }))),
      sendTarget: values(sameCampaign.map(g => mark(g.send_target))),
      item: values(sameCampaign.map(g => displayValue(g.gift_name || g.item_name || g.gift_item))),
      campaign: latest?.campaign_name || latest?.campaign_label || campaignInfo(latest || {}, campaigns).name || ''
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { groupPeople, sortedPeople, titleParts, displayValue, peopleSummary, accountSearch, hierarchyGroups, accountPath, personCount, preferenceText, sourceText, escape, labels };
    return;
  }
  if (!/^https?:$/.test(location.protocol)) return;

  let catalog = null;
  let catalogById = new Map();
  let view = { kind: 'all', accountId: null, personId: null };
  let viewGeneration = 0;
  let loadGeneration = 0;
  let currentAccount = null;
  let currentPerson = null;
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
  barActions.append(allButton, refreshButton);
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
  const footer = el('footer', '연락처·재직·수령 의사와 선물 이력을 기관별로 관리합니다.', 'oa-crm-footer');
  drawer.append(head, body, footer);
  document.body.append(drawer);
  drawer.addEventListener('close', () => { viewGeneration += 1; clearTimeout(searchTimer); focusReturn?.focus?.(); });
  drawer.addEventListener('click', e => { if (e.target === drawer) drawer.close(); });

  const editor = el('dialog', undefined, 'oa-crm-editor');
  editor.dataset.oneAccountCrm = '';
  editor.setAttribute('aria-labelledby', 'oa-crm-editor-title');
  document.body.append(editor);

  async function api(params, payload) {
    const query = new URLSearchParams(params || {});
    const response = await fetch(`/api/crm${query.size ? `?${query}` : ''}`, {
      method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      ...(payload ? { body: JSON.stringify(payload) } : {})
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
    const headers = [...(showAccount ? ['기관'] : []), '성명', '부서', '직책', '직급', '연락처', '수령가능', '발송대상', '품목'];
    const rows = people.map(person => {
      const name = el('div', undefined, 'oa-crm-name-cell');
      const open = button(displayValue(person.name), () => openPerson(person.person_id, person.account_id || view.accountId), 'oa-crm-person');
      if (!displayValue(person.name)) open.setAttribute('aria-label', '인물 상세 열기');
      name.append(open);
      if (person.employment_status === 'former') name.append(badge(labels.employment.former, 'is-muted'));
      if (person.identity_status === 'needs_review') name.append(badge('확인 필요', 'is-amber'));
      const parts = titleParts(person), summary = peopleSummary(person, catalog?.campaigns);
      const role = el('span', parts.position); role.title = parts.raw;
      const rank = el('span', parts.rank); rank.title = parts.raw;
      const receiving = el('span', summary.receiving); receiving.title = summary.receivingDetail;
      const target = el('span', summary.sendTarget); target.title = summary.campaign;
      const item = el('span', summary.item); item.title = summary.campaign;
      const account = showAccount ? button(person.account_name || catalogById.get(person.account_id)?.name || '', () => openAccount(person.account_id), 'oa-crm-table-link') : null;
      return [...(showAccount ? [account] : []), name, person.department, role, rank, summary.contact, receiving, target, item];
    });
    return dataTable(title, headers, rows, 'oa-crm-people-table');
  }
  function peopleGroups(container, people, query = '', showAccount = false) {
    container.replaceChildren();
    const rows = sortedPeople(people, query);
    if (!rows.length) { container.append(empty(query ? '검색 조건에 맞는 인물이 없습니다.' : '등록된 소속인물이 없습니다.')); return; }
    container.append(personTable(rows, showAccount));
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
      currentAccount = result;
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
  function recordTable(title, headers, records, render) {
    const block = section(title);
    block.append(dataTable(title, headers, list(records).map(render), 'oa-crm-record-table'));
    return block;
  }
  async function openPerson(personId, accountId = view.accountId) {
    const generation = show('인물 상세', { kind: 'person', accountId, personId });
    try {
      const result = await api({ action: 'person', personId });
      if (generation !== viewGeneration || !drawer.open) return;
      currentPerson = result;
      const person = result.person || {};
      heading.textContent = displayValue(person.name) || '인물 상세';
      const identity = el('div', undefined, 'oa-crm-account-summary');
      if (person.identity_status === 'needs_review') identity.append(badge('동일인·실명 확인 필요', 'is-amber'));
      identity.append(el('span', '동명이인과 소속 이력은 별도 레코드로 관리합니다.', 'oa-crm-note'));
      const affiliations = recordTable('소속·재직 이력', ['기관', '부서', '직책', '직급', '재직', '시작일', '종료일', '메모', '관리'], result.affiliations, affiliation => {
        const parts = titleParts(affiliation);
        const role = el('span', parts.position); role.title = parts.raw;
        const rank = el('span', parts.rank); rank.title = parts.raw;
        return [button(affiliation.account_name || catalogById.get(affiliation.account_id)?.name || affiliation.account_id, () => openAccount(affiliation.account_id), 'oa-crm-table-link'), affiliation.department, role, rank, labels.employment[affiliation.employment_status] || '', affiliation.started_on, affiliation.ended_on, affiliation.notes, button('소속·재직 수정', () => editRecord('affiliation', affiliation))];
      });
      affiliations.append(button('다른 소속 추가', () => editRecord('affiliation')));
      const affiliationName = record => list(result.affiliations).find(a => a.affiliation_id === record.affiliation_id)?.account_name || (record.affiliation_id ? '' : '개인 공통');
      const contacts = recordTable('연락·배송 정보', ['종류', '내용', '소속', '확인 상태', '메모', '관리'], result.contact_points, contact => {
        const status = contact.verification_status || contact.status;
        const edit = button('수정', () => editRecord('contact_point', contact)); edit.setAttribute('aria-label', `${labels.contact[contact.kind] || '연락처'} 수정`);
        return [labels.contact[contact.kind] || contact.kind, contact.value, affiliationName(contact), status === 'verified' ? '확인됨' : status === 'source_reported' ? '원본 기재' : status === 'conflict' ? '원본 간 값 상충' : '', contact.notes, edit];
      });
      contacts.append(button('연락·배송 정보 추가', () => editRecord('contact_point')));
      const preferences = recordTable('선물 수령 의사', ['수령가능', '적용 범위', '명절', '소속', '시작일', '종료일', '메모', '관리'], result.receiving_preferences, pref => [
        pref.availability === 'not_applicable' ? '해당없음' : mark(pref.availability), labels.scope[pref.scope] || '', pref.campaign_name || campaignInfo(pref, catalog?.campaigns).name, affiliationName(pref), pref.effective_from, pref.effective_to, pref.notes, button('수령 의사 수정', () => editRecord('preference', pref))
      ]);
      preferences.append(el('p', '해당 명절의 수령 불가 표시가 앞으로의 지속적인 거절을 뜻하지는 않습니다. 적용 범위·기간을 함께 확인합니다.', 'oa-crm-note'), button('수령 의사 기록', () => editRecord('preference')));
      const gifts = recordTable('명절별 선물 이력', ['명절', '당시 소속', '품목', '발송대상', '실제 발송', '실제 수령', '예정 금액', '실제 금액', '발송일', '요청자', '요청팀', '메모'], result.gift_recipients, gift => {
        const affiliation = list(result.affiliations).find(a => a.affiliation_id === gift.affiliation_id);
        const amountText = amount => amount == null || amount === '' || !Number.isFinite(Number(amount)) ? '' : `${Number(amount).toLocaleString('ko-KR')}원`;
        const claimValue = field => [...new Set(list(result.field_claims).filter(c => c.entity_id === (gift.recipient_id || gift.id) && c.field_name === field).map(c => c.value).filter(Boolean))].join(' · ');
        return [gift.campaign_name || gift.campaign_label || gift.campaign?.name, gift.gift_account_name || affiliation?.account_name, gift.gift_name || gift.item_name || gift.gift_item, mark(gift.send_target), labels.delivery[gift.delivery_status] || '', labels.received[gift.received_status] || '', amountText(gift.planned_amount ?? gift.unit_price), amountText(gift.actual_amount), gift.sent_on || gift.sent_at, gift.requester_name || gift.requester || claimValue('requester'), gift.request_team || claimValue('request_team'), gift.notes];
      });
      gifts.append(el('p', '발송대상 O/X는 명단의 발송 계획입니다. 실제 발송·수령은 별도 확인 기록입니다.', 'oa-crm-note'));
      const events = recordTable('경조사', ['종류', '일자', '양력·음력', '반복', '내용', '메모', '관리'], result.life_events, event => {
        const edit = button('수정', () => editRecord('life_event', event)); edit.setAttribute('aria-label', `${labels.event[event.event_type] || '경조사'} 수정`);
        return [labels.event[event.event_type] || event.event_type, event.event_date, labels.calendar[event.calendar] || '', event.recurring === true ? '매년 반복' : event.recurring === false ? '해당 일자' : '', event.description, event.notes, edit];
      });
      events.append(button('경조사 기록', () => editRecord('life_event')));
      const provenance = section('출처·변경 이력');
      const sources = el('details', undefined, 'oa-crm-provenance');
      sources.append(el('summary', `원본 출처 ${list(result.source_records).length}건`));
      sources.append(dataTable('원본 출처', ['출처', '근거·메모'], list(result.source_records).map(record => [sourceText(record), record.notes || record.match_reason || record.role])));
      const claims = el('details', undefined, 'oa-crm-provenance');
      claims.append(el('summary', `필드별 원본 근거 ${list(result.field_claims).length}건`));
      claims.append(dataTable('필드별 원본 근거', ['항목', '원본 값', '출처', '메모'], list(result.field_claims).map(claim => {
        const claimValue = claim.value ?? claim.raw_value;
        const field = claim.field_name || claim.field;
        const record = list(result.source_records).find(r => (r.source_record_id || r.id) === claim.source_record_id);
        return [labels.sourceField[field] || field, claimValue != null && typeof claimValue === 'object' ? JSON.stringify(claimValue) : claimValue, record ? sourceText(record) : '', claim.notes];
      })));
      const audit = el('details', undefined, 'oa-crm-provenance');
      audit.append(el('summary', `변경 기록 ${list(result.audit).length}건`));
      audit.append(dataTable('변경 기록', ['일시', '수정자', '작업', '항목'], list(result.audit).map(record => [record.created_at ? new Date(record.created_at).toLocaleString('ko-KR') : '', record.actor_email || record.changed_by, record.action, record.entity_type || record.entity])));
      provenance.append(sources, claims, audit);
      body.replaceChildren(identity, affiliations, contacts, preferences, gifts, events, provenance);
    } catch (error) { if (generation === viewGeneration) failure(error, () => openPerson(personId, accountId)); }
  }
  const options = object => Object.entries(object).map(([value, label]) => ({ value, label }));
  function editRecord(entity, record = null) {
    const creating = !record;
    const chosenAffiliation = list(currentPerson?.affiliations).find(a => a.account_id === view.accountId) || list(currentPerson?.affiliations)[0];
    const recordId = record?.id || record?.[`${entity}_id`] || (entity === 'life_event' ? record?.event_id : '') || crypto.randomUUID();
    const title = { affiliation: '소속·재직 정보', contact_point: '연락·배송 정보', preference: '선물 수령 의사', life_event: '경조사' }[entity];
    const form = el('form', undefined, 'oa-crm-form');
    const formTitle = el('h2', `${title} ${creating ? '추가' : '수정'}`); formTitle.id = 'oa-crm-editor-title';
    form.append(formTitle);
    const fields = [];
    const add = (key, label, type = 'text', choices = null, fallback = '') => {
      const wrapper = el('label', undefined, 'oa-crm-input'); wrapper.append(el('span', label));
      const input = el(choices ? 'select' : type === 'textarea' ? 'textarea' : 'input');
      if (choices) choices.forEach(choice => { const option = el('option', choice.label); option.value = choice.value; input.append(option); });
      else if (type !== 'textarea') input.type = type;
      if (type === 'textarea') input.rows = 3;
      input.name = key; input.value = record?.[key] ?? fallback;
      if (type === 'text') input.maxLength = 1000;
      wrapper.append(input); form.append(wrapper); fields.push({ key, input, type });
      return input;
    };
    if (entity === 'affiliation') {
      if (creating) {
        add('account_id', '소속 기관', 'text', [{ value: '', label: '기관을 선택하세요' }, ...[...catalogById.values()].filter(a => a.account_kind !== 'group').sort((a, b) => compare(a.name, b.name)).map(a => ({ value: a.account_id, label: a.parent_account_id ? `${catalogById.get(a.parent_account_id)?.name || '상위 조직'} / ${a.name}` : a.name }))]);
        form.append(el('p', '기존 소속 이력을 유지하면서 새 소속을 추가합니다. 퇴사 여부는 기존 소속에서 별도로 확인해 주세요.', 'oa-crm-note'));
      }
      add('department', '부서·세부소속'); add('title', '직책');
      add('employment_status', '재직 상태', 'text', options(labels.employment), 'unknown');
      add('started_on', '소속 시작일', 'date'); add('ended_on', '소속 종료일', 'date');
    } else {
      const affOptions = [{ value: '', label: '개인 공통' }, ...list(currentPerson?.affiliations).map(a => ({ value: a.affiliation_id || a.id, label: a.account_name || catalogById.get(a.account_id)?.name || a.account_id }))];
      if (creating) add('affiliation_id', '해당 소속', 'text', affOptions, chosenAffiliation?.affiliation_id || chosenAffiliation?.id || '');
      else form.append(el('p', `소속: ${affOptions.find(option => option.value === record.affiliation_id)?.label || '개인 공통'}`, 'oa-crm-note'));
      if (entity === 'contact_point') {
        add('kind', '정보 종류', 'text', options(labels.contact), 'mobile'); add('value', '내용');
        add('verification_status', '확인 상태', 'text', [{ value: 'unverified', label: '미확인' }, { value: 'source_reported', label: '원본 기재' }, { value: 'verified', label: '본인·담당자에게 확인' }, { value: 'conflict', label: '원본 간 값 상충' }], 'unverified');
      } else if (entity === 'preference') {
        add('availability', '수령가능 여부', 'text', options(labels.availability), 'unknown');
        add('scope', '적용 범위', 'text', options(labels.scope), 'unknown');
        add('effective_from', '적용 시작일', 'date'); add('effective_to', '적용 종료일', 'date');
        const campaign = add('campaign_id', '해당 명절', 'text', [{ value: '', label: '명절 미지정' }, ...list(catalog?.campaigns).map(c => ({ value: c.campaign_id || c.id, label: c.name || c.label }))], record?.campaign_id || '');
        if (record?.campaign_id && ![...campaign.options].some(o => o.value === record.campaign_id)) { const o = el('option', record.campaign_name || '기존 명절'); o.value = record.campaign_id; campaign.append(o); campaign.value = record.campaign_id; }
        form.append(el('p', '지속 적용은 본인이 앞으로도 같은 의사를 유지한다고 확인한 경우에 선택합니다.', 'oa-crm-note'));
      } else if (entity === 'life_event') {
        add('event_type', '경조사 종류', 'text', options(labels.event), 'other'); add('event_date', '일자', 'date');
        add('calendar', '양력·음력', 'text', options(labels.calendar), 'unknown');
        add('recurring', '반복 여부', 'text', [{ value: 'false', label: '해당 일자' }, { value: 'true', label: '매년 반복' }], 'false'); add('description', '내용', 'textarea');
      }
    }
    add('notes', '확인 근거·메모', 'textarea');
    const status = el('p', '', 'oa-crm-form-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = el('div', undefined, 'oa-crm-actions');
    const cancel = button('취소', () => editor.close());
    const save = el('button', '저장', 'oa-crm-primary'); save.type = 'submit';
    actions.append(cancel, save); form.append(status, actions);
    const requestId = crypto.randomUUID();
    let retryPayload = null;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const patch = {};
      fields.forEach(({ key, input, type }) => { patch[key] = key === 'recurring' ? input.value === 'true' : (type === 'date' || key.endsWith('_id')) ? input.value || null : input.value.trim(); });
      if (creating) patch.person_id = view.personId;
      if (creating && entity === 'affiliation' && !patch.account_id) { status.textContent = '소속 기관을 선택해 주세요.'; return; }
      if (entity === 'preference' && patch.scope === 'campaign' && !patch.campaign_id) { status.textContent = '해당 명절에 한함을 선택한 경우 명절을 지정해 주세요.'; return; }
      if (patch.effective_from && patch.effective_to && patch.effective_from > patch.effective_to) { status.textContent = '종료일은 시작일보다 빠를 수 없습니다.'; return; }
      if (patch.started_on && patch.ended_on && patch.started_on > patch.ended_on) { status.textContent = '소속 종료일은 시작일보다 빠를 수 없습니다.'; return; }
      const payload = retryPayload || { action: creating ? 'create' : 'update', entity, id: recordId, expectedRevision: record?.revision || 0, patch, requestId };
      save.disabled = true; cancel.disabled = true; status.textContent = '저장 중…';
      try {
        await api(null, payload);
        editor.close();
        await openPerson(view.personId, view.accountId);
        await refreshIndex();
      } catch (error) {
        status.textContent = error.message;
        if (!error.status || error.status >= 500) {
          retryPayload = payload; save.textContent = '저장 결과 재확인'; fields.forEach(({ input }) => { input.disabled = true; });
        } else if (error.status === 409) {
          save.disabled = true;
          actions.prepend(button('최신 정보 불러오기', async () => { editor.close(); await openPerson(view.personId, view.accountId); }));
        }
      } finally { if (!status.textContent.includes('다른 사용자가')) save.disabled = false; cancel.disabled = false; }
    });
    editor.replaceChildren(form); editor.showModal();
  }
  async function reloadView() {
    if (view.kind === 'person') return openPerson(view.personId, view.accountId);
    if (view.kind === 'account') return openAccount(view.accountId);
    return openAll();
  }
  window.OneAccountCRM = { catalog, refreshIndex, openAll, openAccount, openPerson, decorateAccounts };
  refreshIndex(false, window.ONE_ACCOUNT_CRM_INITIAL_CATALOG || null);
})();
