'use strict';
(function accountWorkspace() {
  const ROLES = ['primary', 'backup', 'sponsor'];
  const FIELDS = { primary: 'primaryRmId', backup: 'backupRmId', sponsor: 'sponsorRmId' };
  const ROLE_LABELS = { primary: 'Primary', backup: 'Backup', sponsor: 'Sponsor' };
  const TABS = { overview: '개요', relationships: '거래·관계', information: '기관정보', history: '변경이력' };
  const text = value => value == null ? '' : String(value);
  const list = value => Array.isArray(value) ? value : [];
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
  const nameOf = account => text(account?.display_name || account?.name);
  const codesOf = account => typeof account?.piscfh === 'string' ? [account.piscfh] : list(account?.piscfh?.default_candidate_codes);
  const CATEGORY_ORDER = ['P', 'I', 'S', 'C', 'F', 'H'];
  function categoryRank(account) {
    const ranks = codesOf(account).map(code => CATEGORY_ORDER.indexOf(code)).filter(rank => rank >= 0);
    return ranks.length ? Math.min(...ranks) : CATEGORY_ORDER.length;
  }
  function compareAccounts(a, b) {
    return categoryRank(a) - categoryRank(b) || nameOf(a).localeCompare(nameOf(b), 'ko') || text(a?.account_id).localeCompare(text(b?.account_id));
  }
  const aliasesOf = account => list(account?.aliases).map(alias => typeof alias === 'string' ? alias : alias?.name).filter(Boolean);
  const ownTeam = (account, assignments) => assignments?.[account.account_id] || {};
  const hasRm = team => ROLES.some(role => Boolean(team?.[FIELDS[role]]));
  function matchesAccount(account, filters, assignments) {
    const team = ownTeam(account, assignments);
    if (filters.scope === 'assigned' && !hasRm(team)) return false;
    if (filters.scope === 'unassigned' && hasRm(team)) return false;
    if (filters.rm && !ROLES.some(role => team[FIELDS[role]] === filters.rm)) return false;
    if (filters.code && !(filters.code === '미Account' ? !codesOf(account).some(code => /^[PISCFH]$/.test(code)) : codesOf(account).includes(filters.code))) return false;
    const query = text(filters.query).trim().toLocaleLowerCase('ko');
    return !query || [nameOf(account), ...aliasesOf(account)].some(value => text(value).toLocaleLowerCase('ko').includes(query));
  }
  function accountTree(accounts, filters = {}, assignments = {}) {
    const byId = new Map(accounts.map(account => [account.account_id, account]));
    const children = new Map();
    for (const account of accounts) {
      const parent = byId.get(account.parent_account_id);
      if (parent?.account_kind === 'group' && parent !== account) {
        if (!children.has(parent.account_id)) children.set(parent.account_id, []);
        children.get(parent.account_id).push(account);
      }
    }
    const sorted = rows => rows.slice().sort(compareAccounts);
    return sorted(accounts.filter(account => !children.has(account.parent_account_id))).map(account => {
      const members = sorted(children.get(account.account_id) || []);
      return { account, ownMatch: matchesAccount(account, filters, assignments), children: members, matches: members.filter(child => matchesAccount(child, filters, assignments)) };
    }).filter(item => item.ownMatch || item.matches.length);
  }
  function scopeCounts(accounts, filters, assignments) {
    const candidates = accounts.filter(account => matchesAccount(account, { ...filters, scope: 'all' }, assignments));
    const assigned = candidates.filter(account => hasRm(ownTeam(account, assignments))).length;
    return { all: candidates.length, assigned, unassigned: candidates.length - assigned };
  }
  function readRoute(url) {
    const q = new URL(url, 'https://one-account.invalid').searchParams;
    return { account: validId(q.get('account')) ? q.get('account') : '', person: validId(q.get('person')) ? q.get('person') : '', tab: Object.hasOwn(TABS, q.get('tab')) ? q.get('tab') : 'overview', view: ['rm', 'analysis'].includes(q.get('view')) ? q.get('view') : 'accounts' };
  }
  function routeUrl(url, route) {
    const next = new URL(url, 'https://one-account.invalid');
    for (const key of ['account', 'person', 'tab', 'view']) next.searchParams.delete(key);
    if (validId(route.account)) next.searchParams.set('account', route.account);
    if (validId(route.account) && validId(route.person)) next.searchParams.set('person', route.person);
    if (route.tab && route.tab !== 'overview' && Object.hasOwn(TABS, route.tab)) next.searchParams.set('tab', route.tab);
    if (['rm', 'analysis'].includes(route.view)) next.searchParams.set('view', route.view);
    return next.pathname + next.search + next.hash;
  }
  function changedTeam(before, after) {
    return Object.fromEntries(ROLES.map(role => FIELDS[role]).filter(field => (before?.[field] || '') !== (after?.[field] || '')).map(field => [field, after[field] || '']));
  }
  function mergeMetadata(account, metadata) {
    if (!account || !metadata || metadata.accountId !== account.account_id) return;
    const names = new Set(aliasesOf(account));
    if (nameOf(account)) names.add(nameOf(account));
    for (const alias of list(metadata.aliases)) if (typeof alias === 'string') names.add(alias);
    for (const alias of names) if (!aliasesOf(account).includes(alias)) { account.aliases ||= []; account.aliases.push({ name: alias, role: 'CRM', source: 'account_profile' }); }
    account.display_name = metadata.name;
    if (Number.isSafeInteger(metadata.profileRevision)) account.profile_revision = metadata.profileRevision;
    const codes = /^[PISCFH]$/.test(metadata.piscfh) ? [metadata.piscfh] : [];
    account.piscfh = { ...(typeof account.piscfh === 'object' ? account.piscfh : {}), default_candidate_codes: codes, active_default_codes: codes };
    // Display edits do not replace source aliases, IDs, source records, or relationships.
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { compareAccounts, ROLES, FIELDS, validId, ownTeam, hasRm, matchesAccount, accountTree, scopeCounts, readRoute, routeUrl, changedTeam, mergeMetadata };
    return;
  }
  if (window.OneAccountWorkspace || typeof D === 'undefined' || !Array.isArray(D.accounts)) return;

  const legacy = () => window.OneAccountLegacy;
  const crm = () => window.OneAccountCRM;
  const byId = id => (typeof accountsById !== 'undefined' && accountsById.get(id)) || D.accounts.find(account => account.account_id === id);
  let routeWindow = window;
  try { if (window.parent !== window && window.parent.location.origin === window.location.origin) routeWindow = window.parent; } catch { /* Cross-origin embeds keep their own route. */ }
  const initial = readRoute(routeWindow.location.href);
  const state = { ...initial, query: '', scope: 'all', code: '', rm: '', expanded: new Set(), data: null, team: null, metadata: null, editor: null, sequence: 0, personSequence: 0, loading: false, errors: {}, search: [], searchLoading: false, searchError: '', lastOpenedPerson: '' };
  const teamOverrides = {};
  let searchTimer, searchAbort, routeRestoring = false, ui, identitySnapshot = {}, identityEpoch = 0, editorGeneration = 0;
  const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = text(value); if (className) node.className = className; return node; };
  const button = (value, fn, className = '') => { const node = el('button', value, className); node.type = 'button'; node.addEventListener('click', fn); return node; };
  const option = (value, label) => { const node = el('option', label); node.value = value; return node; };
  function assignments() {
    let source;
    try { source = legacy()?.getTeams?.(); } catch { /* Use the last known in-memory source. */ }
    return { ...(source?.assignments || source?.teams || source || (typeof teamAssignments !== 'undefined' ? teamAssignments : {})), ...teamOverrides };
  }
  function rmName(id) { return id ? list(D.rm_candidates).find(person => person.person_id === id)?.name || list(state.team?.candidates).find(person => person.rmId === id)?.name || id : ''; }
  function verified() { return identitySnapshot.identityVerified === true && identitySnapshot.canEdit === true && Date.parse(identitySnapshot.verifiedUntil) > Date.now(); }
  async function request(url, init = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) { receiveIdentity({}); Promise.resolve(crm()?.lockIdentity?.()).catch(() => {}); }
      const error = new Error(body.message || (response.status === 409 ? '다른 사용자가 먼저 수정했습니다.' : '연결을 확인하고 다시 시도해 주세요.')); error.status = response.status; error.body = body; throw error;
    }
    return body;
  }
  function announce(value, bad = false) { ui.status.textContent = value; ui.status.classList.toggle('is-error', bad); }
  function syncRoute(replace = false) {
    if (routeRestoring) return;
    const target = routeUrl(routeWindow.location.href, state);
    const existing = routeWindow.location.pathname + routeWindow.location.search + routeWindow.location.hash;
    if (target === existing) return;
    try { routeWindow.history[replace ? 'replaceState' : 'pushState']({ ...routeWindow.history.state, oneAccount: true }, '', target); } catch { /* Browsing still works if the host restricts history. */ }
  }
  function entryCount(account) { const count = account.crm_people_count ?? account.people_count; return Number.isSafeInteger(count) && count >= 0 ? count.toLocaleString('ko-KR') : ''; }
  function createShell() {
    const shell = el('main', undefined, 'oa-workspace'); shell.id = 'oa-workspace'; shell.dataset.oneAccountCrm = '';
    const header = el('header', undefined, 'oa-workspace-header');
    const brand = el('div', undefined, 'oa-workspace-brand'); brand.append(el('span', 'ONE ACCOUNT'), el('h1', '고객 관계 관리'));
    const identity = el('div', undefined, 'oa-workspace-identity');
    const identityText = el('span'); const identityButton = button('본인 인증', () => crm()?.openIdentity?.(), 'oa-workspace-button');
    const lock = button('재잠금', () => crm()?.lockIdentity?.(), 'oa-workspace-text-button');
    identity.append(identityText, identityButton, lock); header.append(brand, identity);
    const nav = el('nav', undefined, 'oa-workspace-nav'); nav.setAttribute('aria-label', '작업 공간');
    const navButtons = new Map();
    for (const [mode, label] of [['accounts', '어카운트'], ['rm', 'RM 관리'], ['analysis', '거래 분석']]) {
      const node = button(label, () => navigate(() => show(mode)), 'oa-workspace-nav-button'); node.dataset.workspaceView = mode; navButtons.set(mode, node); nav.append(node);
    }
    const status = el('div', '', 'oa-workspace-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const area = el('div', undefined, 'oa-workspace-area');
    const sidebar = el('aside', undefined, 'oa-workspace-sidebar'); sidebar.setAttribute('aria-label', '기관·기업 목록');
    const controls = el('div', undefined, 'oa-workspace-controls'); controls.append(el('h2', '기관·기업 목록'));
    const search = el('input'); search.type = 'search'; search.placeholder = '기관·별칭·인물 검색'; search.setAttribute('aria-label', '기관·별칭·인물 통합검색'); search.autocomplete = 'off'; search.maxLength = 200;
    search.addEventListener('input', () => { state.query = search.value; renderList(); findPeople(); });
    const segments = el('div', undefined, 'oa-workspace-segments'); segments.setAttribute('aria-label', 'RM 배정 범위');
    const scopeButtons = new Map();
    for (const [value, label] of [['all', '전체'], ['assigned', 'RM 배정'], ['unassigned', 'RM 미배정']]) {
      const node = button(label, () => { state.scope = value; renderList(); }, ''); node.dataset.workspaceScope = value; node.dataset.label = label; scopeButtons.set(value, node); segments.append(node);
    }
    const filters = el('div', undefined, 'oa-workspace-filters');
    const classification = el('select'); classification.setAttribute('aria-label', 'PISCFH 분류'); classification.append(option('', 'PISCFH 전체'));
    for (const code of ['P', 'I', 'S', 'C', 'F', 'H', '미Account']) classification.append(option(code, code));
    classification.addEventListener('change', () => { state.code = classification.value; renderList(); });
    const rm = el('select'); rm.setAttribute('aria-label', '담당 RM'); rm.append(option('', '담당 RM 전체'));
    for (const person of list(D.rm_candidates).slice().sort((a, b) => text(a.name).localeCompare(text(b.name), 'ko'))) rm.append(option(person.person_id, person.name));
    rm.addEventListener('change', () => { state.rm = rm.value; renderList(); });
    filters.append(classification, rm);
    const hint = el('p', '각 기관의 Primary·Backup·Sponsor 중 1명 이상이면 배정', 'oa-workspace-filter-hint');
    controls.append(search, segments, filters, hint);
    const results = el('div', undefined, 'oa-workspace-person-results'); results.hidden = true;
    const listStatus = el('div', '', 'oa-workspace-list-status'); const listWrap = el('div', undefined, 'oa-workspace-list');
    sidebar.append(controls, results, listStatus, listWrap);
    const detail = el('section', undefined, 'oa-workspace-detail'); detail.setAttribute('aria-label', '어카운트 상세');
    area.append(sidebar, detail); shell.append(header, nav, status, area);
    document.body.prepend(shell); document.body.classList.add('oa-workspace-active');
    ui = { shell, header, navButtons, status, area, sidebar, search, segments, scopeButtons, classification, rm, results, listStatus, listWrap, detail, identityText, identityButton, lock };
  }
  function renderIdentity() {
    const active = verified();
    ui.identityText.textContent = active ? '본인 인증됨' : '개인 상세 잠김';
    ui.identityText.className = active ? 'is-verified' : '';
    ui.identityButton.hidden = active; ui.lock.hidden = !active;
  }
  function renderList() {
    const scroll = ui.listWrap.scrollTop;
    const data = assignments(); const groups = accountTree(D.accounts, state, data); const counts = scopeCounts(D.accounts, state, data);
    for (const [key, node] of ui.scopeButtons) { node.textContent = `${node.dataset.label} ${counts[key].toLocaleString('ko-KR')}`; node.setAttribute('aria-pressed', String(state.scope === key)); }
    ui.listStatus.textContent = `조건에 맞는 기관 ${counts[state.scope].toLocaleString('ko-KR')}개 · PISCFH·기관명순`;
    ui.listWrap.replaceChildren();
    const table = el('table', undefined, 'oa-workspace-account-table');
    const head = el('thead'); const tr = el('tr'); for (const title of ['기관명', '담당 RM', '인물']) tr.append(el('th', title)); head.append(tr); table.append(head);
    const body = el('tbody');
    const row = (account, child = false, wrapper = false, item = null) => {
      const tr = el('tr', undefined, state.account === account.account_id ? 'is-selected' : '');
      tr.dataset.workspaceAccount = account.account_id; if (child) tr.classList.add('is-child');
      const name = el('td');
      if (item?.children.length) {
        const expanded = state.expanded.has(account.account_id) || Boolean(state.query || state.scope !== 'all' || state.rm || state.code);
        const toggle = button(expanded ? '−' : '+', () => { state.expanded.has(account.account_id) ? state.expanded.delete(account.account_id) : state.expanded.add(account.account_id); renderList(); }, 'oa-workspace-tree-toggle');
        toggle.setAttribute('aria-label', `${nameOf(account)} 하위 조직 ${expanded ? '접기' : '펼치기'}`); toggle.setAttribute('aria-expanded', String(expanded)); name.append(toggle);
      }
      const link = button(nameOf(account), () => selectAccount(account.account_id), 'oa-workspace-account-link'); link.title = nameOf(account); name.append(link);
      const meta = el('small', [codesOf(account).join(' · ') || '미Account', wrapper ? '하위 조직 검색결과' : account.account_kind === 'group' ? `그룹 · ${item?.children.length || account.children_count || 0}개 조직` : ''].filter(Boolean).join(' · ')); name.append(meta);
      const team = ownTeam(account, data); const rmCell = el('td');
      const names = ROLES.map(role => team[FIELDS[role]] ? `${ROLE_LABELS[role]} ${rmName(team[FIELDS[role]])}` : '').filter(Boolean);
      rmCell.textContent = names.length ? names.map(value => value.replace(/^(Primary|Backup|Sponsor) /, '')).join(' · ') : '미배정'; rmCell.title = names.join(' / '); if (!names.length) rmCell.className = 'oa-workspace-muted';
      tr.append(name, rmCell, el('td', entryCount(account), 'oa-workspace-number')); body.append(tr);
    };
    for (const item of groups) {
      row(item.account, false, !item.ownMatch, item);
      const expanded = state.expanded.has(item.account.account_id) || Boolean(state.query || state.scope !== 'all' || state.rm || state.code);
      if (expanded) for (const child of item.matches) row(child, true);
    }
    table.append(body); ui.listWrap.append(table);
    if (!groups.length) ui.listWrap.append(el('p', '검색 조건에 맞는 기관이 없습니다.', 'oa-workspace-empty'));
    ui.listWrap.scrollTop = scroll; renderPeopleSearch();
  }
  async function findPeople() {
    clearTimeout(searchTimer); searchAbort?.abort(); state.search = []; state.searchError = '';
    const query = state.query.trim(); state.searchLoading = query.length >= 2; renderPeopleSearch();
    if (query.length < 2) return;
    searchTimer = setTimeout(async () => {
      const controller = new AbortController(); searchAbort = controller;
      try {
        const result = await request(`/api/crm?action=search&q=${encodeURIComponent(query)}&limit=30`, { signal: controller.signal });
        if (state.query.trim() !== query || controller.signal.aborted) return;
        state.search = list(result.people); state.searchError = result.truncated ? '인물 결과 일부만 표시합니다. 검색어를 좁혀 주세요.' : '';
      } catch (error) { if (controller.signal.aborted) return; state.searchError = '인물 검색에 연결하지 못했습니다.'; }
      finally { if (!controller.signal.aborted) { state.searchLoading = false; renderPeopleSearch(); } }
    }, 300);
  }
  function renderPeopleSearch() {
    ui.results.replaceChildren(); ui.results.hidden = state.query.trim().length < 2;
    if (ui.results.hidden) return;
    const shown = state.search.filter(person => {
      const account = byId(person.account_id); return account && matchesAccount(account, { ...state, query: '' }, assignments());
    });
    ui.results.append(el('strong', `인물 ${shown.length}`));
    if (state.searchLoading) ui.results.append(el('p', '인물을 찾고 있습니다…'));
    else if (state.searchError) ui.results.append(el('p', state.searchError));
    else if (!shown.length) ui.results.append(el('p', '일치하는 인물이 없습니다.'));
    for (const person of shown) {
      const node = button('', () => selectAccount(person.account_id, { person: person.person_id }), 'oa-workspace-person-result');
      node.append(el('span', person.name), el('small', `${person.account_name || nameOf(byId(person.account_id))} · ${person.department || person.title || ''}`)); ui.results.append(node);
    }
  }
  function show(mode, options = {}) {
    state.view = ['rm', 'analysis'].includes(mode) ? mode : 'accounts';
    ui.area.hidden = state.view !== 'accounts';
    for (const [key, node] of ui.navButtons) node.setAttribute('aria-current', key === state.view ? 'page' : 'false');
    legacy()?.show?.(state.view);
    document.body.dataset.oaWorkspaceView = state.view;
    if (state.view === 'accounts') { renderList(); renderDetail(); }
    if (!options.noRoute) syncRoute();
  }
  function navigate(fn) {
    if (crm()?.canLeave?.() === false) return false;
    if (state.editor?.saving || state.editor?.request) { state.editor.notice.textContent = state.editor.saving ? '저장 중입니다. 잠시 기다려 주세요.' : '저장 결과를 먼저 재확인해 주세요. 확인 전에는 이동할 수 없습니다.'; return false; }
    if (!state.editor || !state.editor.dirty) { fn(); return true; }
    const editor = state.editor;
    editor.notice.replaceChildren(el('p', '저장하지 않은 입력이 있습니다.'));
    editor.notice.append(button('저장 후 이동', async () => { if (await editor.save()) fn(); }, 'oa-workspace-primary'), button('버리고 이동', () => { closeEditor(); fn(); }), button('계속 편집', () => editor.notice.replaceChildren()));
    editor.notice.scrollIntoView?.({ block: 'nearest' });
    return false;
  }
  function selectAccount(id, options = {}) {
    if (!validId(id)) return;
    navigate(() => activateAccount(id, options));
  }
  function activateAccount(id, options = {}) {
    if (state.account === id && state.data) {
      state.view = 'accounts'; state.tab = options.tab || 'overview'; show('accounts', { noRoute: true });
      if (options.person) openPerson(options.person, state.data.account); else { state.person = ''; closePersonQuietly(); }
      syncRoute(Boolean(options.replace)); return;
    }
    closeEditor(); closePersonQuietly();
    state.account = id; state.person = options.person || ''; state.tab = options.tab || 'overview'; state.data = null; state.team = null; state.metadata = null; state.errors = {}; state.view = 'accounts';
    const account = byId(id); if (account?.parent_account_id) state.expanded.add(account.parent_account_id);
    show('accounts', { noRoute: true }); syncRoute(Boolean(options.replace)); loadAccount();
  }
  async function loadAccount() {
    const id = state.account; if (!id) return;
    const sequence = ++state.sequence; const authEpoch = identityEpoch; state.loading = true; state.errors = {}; renderDetail();
    const endpoint = `/api/account?accountId=${encodeURIComponent(id)}`;
    await Promise.allSettled([
      request(`/api/crm?action=account&accountId=${encodeURIComponent(id)}`).then(result => {
        if (sequence !== state.sequence || id !== state.account) return;
        state.data = result; state.loading = false; renderDetail();
        if (state.person) openPerson(state.person, result.account, true);
      }).catch(error => { if (sequence === state.sequence) { state.errors.people = error.message; state.loading = false; renderDetail(); } }),
      request(`${endpoint}&action=team`).then(result => {
        if (sequence !== state.sequence || id !== state.account) return;
        state.team = result; teamOverrides[id] = result.team || {}; renderList(); renderDetail();
      }).catch(error => { if (sequence === state.sequence) { state.errors.team = error.message; renderDetail(); } }),
      request(`${endpoint}&action=metadata`).then(result => {
        if (sequence !== state.sequence || id !== state.account) return;
        if (authEpoch !== identityEpoch || !verified()) redactMetadata(result);
        state.metadata = result; mergeMetadata(byId(id), result.account); renderList(); renderDetail();
      }).catch(error => { if (sequence === state.sequence) { state.errors.metadata = error.message; renderDetail(); } })
    ]);
  }
  function openPerson(id, account, fromRoute = false, checked = false) {
    if (!validId(id)) return;
    if (!checked) { navigate(() => { closeEditor(); openPerson(id, account, fromRoute, true); }); return; }
    if (crm()?.canLeave?.() === false) return;
    const actualAccountId = typeof account === 'string' ? account : account?.account_id;
    if (!fromRoute && validId(actualAccountId) && actualAccountId !== state.account) { selectAccount(actualAccountId, { person: id }); return; }
    state.person = id; state.lastOpenedPerson = id;
    crm()?.openPerson?.(id, account || state.data?.account || { account_id: state.account, name: nameOf(byId(state.account)) });
    if (!fromRoute) syncRoute();
  }
  function closePersonQuietly() { const restoring = routeRestoring; routeRestoring = true; try { const closed = crm()?.closePerson?.(); if (closed !== false) state.lastOpenedPerson = ''; return closed !== false; } finally { routeRestoring = restoring; } }
  function appendIssue(container, key) {
    if (!state.errors[key]) return;
    const node = el('div', undefined, 'oa-workspace-inline-error'); node.append(el('span', state.errors[key]), button('다시 불러오기', () => loadAccount())); container.append(node);
  }
  function renderDetail() {
    if (state.editor) return;
    const scroll = ui.detail.scrollTop; ui.detail.replaceChildren();
    if (!state.account) {
      const intro = el('div', undefined, 'oa-workspace-welcome'); intro.append(el('span', '고객 관계 관리', 'oa-workspace-eyebrow'), el('h2', '기관을 선택해 주세요'), el('p', '담당 RM, 소속 인물과 거래 관계를 한곳에서 확인하고 관리합니다.'), el('p', '왼쪽에서 기관명·별칭·인물명으로 검색할 수 있습니다.', 'oa-workspace-muted')); ui.detail.append(intro); return;
    }
    const account = byId(state.account) || state.data?.account || { account_id: state.account, name: state.account };
    const header = el('header', undefined, 'oa-workspace-account-header');
    const breadcrumb = el('nav', undefined, 'oa-workspace-breadcrumb'); breadcrumb.setAttribute('aria-label', '기관 경로');
    const parent = byId(account.parent_account_id) || state.data?.parent_account;
    if (parent) breadcrumb.append(button(nameOf(parent), () => selectAccount(parent.account_id)), el('span', '›'));
    breadcrumb.append(el('span', account.account_kind === 'group' ? 'Account 그룹' : account.hierarchy_label || '기관'));
    const heading = el('div', undefined, 'oa-workspace-heading'); const title = el('div'); title.append(el('h2', nameOf(account)), el('span', codesOf(account).join(' · ') || '미Account', 'oa-workspace-code'));
    const edit = button('기관정보 수정', () => editMetadata(), 'oa-workspace-button'); edit.disabled = !state.metadata || Boolean(state.errors.metadata); heading.append(title, edit);
    const teamLine = el('div', undefined, 'oa-workspace-team-line'); const team = state.team?.team || ownTeam(account, assignments());
    for (const role of ROLES) { const part = el('span'); part.append(el('small', ROLE_LABELS[role]), el('strong', rmName(team[FIELDS[role]]) || '미배정')); teamLine.append(part); }
    const editTeamButton = button('RM 변경', () => editTeam(), 'oa-workspace-text-button'); editTeamButton.disabled = !state.team; teamLine.append(editTeamButton);
    if (account.account_kind === 'group') teamLine.append(el('small', '이 그룹 자체의 배정', 'oa-workspace-muted'));
    header.append(breadcrumb, heading, teamLine); appendIssue(header, 'team'); appendIssue(header, 'metadata');
    const tabs = el('nav', undefined, 'oa-workspace-tabs'); tabs.setAttribute('aria-label', '기관 상세 탭');
    for (const [key, label] of Object.entries(TABS)) { const node = button(label, () => navigate(() => { state.tab = key; state.person = ''; closePersonQuietly(); syncRoute(); renderDetail(); })); node.setAttribute('aria-current', state.tab === key ? 'page' : 'false'); node.dataset.workspaceTab = key; tabs.append(node); }
    const content = el('div', undefined, 'oa-workspace-content');
    ui.detail.append(header, tabs, content);
    if (state.tab === 'overview') renderOverview(content, account);
    if (state.tab === 'relationships') renderRelationships(content, account);
    if (state.tab === 'information') renderInformation(content, account);
    if (state.tab === 'history') renderHistory(content);
    ui.detail.scrollTop = scroll;
  }
  function table(headers, rows, className = '') {
    const wrap = el('div', undefined, 'oa-workspace-table-wrap'); const node = el('table', undefined, `oa-workspace-table ${className}`); const head = el('thead'); const tr = el('tr');
    for (const label of headers) tr.append(el('th', label)); head.append(tr); const body = el('tbody');
    for (const cells of rows) { const row = el('tr'); for (const cell of cells) { const td = el('td'); if (cell && typeof cell === 'object' && 'nodeType' in cell) td.append(cell); else if (cell && typeof cell === 'object' && cell.tagName) td.append(cell); else td.textContent = text(cell); row.append(td); } body.append(row); }
    node.append(head, body); wrap.append(node); return wrap;
  }
  function renderOverview(container, account) {
    const children = list(state.data?.children).length ? state.data.children : D.accounts.filter(child => child.parent_account_id === state.account);
    if (account.account_kind === 'group' || children.length) {
      const section = el('section', undefined, 'oa-workspace-group');
      const title = el('div', undefined, 'oa-workspace-section-heading'); title.append(el('h3', `하위 조직 ${children.length}`), el('span', 'RM은 각 조직에 따로 배정됩니다.', 'oa-workspace-muted'));
      const search = el('input'); search.type = 'search'; search.placeholder = '하위 조직 검색'; search.setAttribute('aria-label', '하위 조직 검색');
      const rows = el('div'); const paint = () => {
        const matches = children.filter(child => matchesAccount(byId(child.account_id) || child, { query: search.value }, assignments())).sort((a, b) => compareAccounts(byId(a.account_id) || a, byId(b.account_id) || b));
        rows.replaceChildren(table(['조직명', '구분', '담당 RM', '인물'], matches.map(child => {
          const entity = byId(child.account_id) || child; const team = ownTeam(entity, assignments());
          return [button(nameOf(entity), () => selectAccount(entity.account_id), 'oa-workspace-inline-link'), entity.hierarchy_label || '', ROLES.map(role => rmName(team[FIELDS[role]])).filter(Boolean).join(' · ') || '미배정', entryCount(entity)];
        })));
      }; search.addEventListener('input', paint); paint(); section.append(title, search, rows); container.append(section);
    }
    const people = el('section', undefined, 'oa-workspace-people'); const heading = el('div', undefined, 'oa-workspace-section-heading');
    heading.append(el('h3', children.length ? '전체 소속 인물' : '소속 인물'));
    const add = button('인물 추가', () => createPerson(), 'oa-workspace-button'); add.disabled = !state.data || account.account_kind === 'group'; if (account.account_kind === 'group') add.title = '실제 소속 하위 조직에서 등록하세요.'; heading.append(add); people.append(heading);
    if (children.length) people.append(el('p', '실제 소속 조직을 기준으로 표시합니다.', 'oa-workspace-muted'));
    appendIssue(people, 'people');
    if (state.data) {
      const reusable = ui.peopleResult === state.data && ui.peopleHost;
      const host = reusable || el('div', undefined, 'oa-workspace-people-host'); people.append(host);
      if (!reusable) {
        if (crm()?.mountPeople) { crm().mountPeople(host, state.data, { onPerson: (id, sourceAccount) => openPerson(typeof id === 'string' ? id : id.person_id, sourceAccount), onAccount: id => selectAccount(typeof id === 'string' ? id : id.account_id) }); ui.peopleHost = host; ui.peopleResult = state.data; }
        else host.append(el('p', '인물 화면을 준비하고 있습니다.', 'oa-workspace-empty'));
      }
    } else if (state.loading) people.append(el('p', '소속 인물을 불러오고 있습니다…', 'oa-workspace-empty'));
    container.append(people);
  }
  function renderRelationships(container, account) {
    const data = legacy()?.getAccountContext?.(state.account) || {};
    const rows = list(data.exposures).length ? data.exposures : list(D.account_asset_exposures || D.exposures).filter(row => row.account_id === state.account);
    const heading = el('div', undefined, 'oa-workspace-section-heading'); heading.append(el('h3', `거래·관계 ${rows.length.toLocaleString('ko-KR')}`), button('관계지도 보기', () => { legacy()?.openMap?.(state.account); }, 'oa-workspace-button')); container.append(heading);
    if (account.account_kind === 'group') container.append(el('p', '개별 조직의 거래는 해당 조직에서 확인하세요. 상위 그룹으로 합산하거나 이전하지 않습니다.', 'oa-workspace-muted'));
    if (!rows.length) { container.append(el('p', '이 기관에 등록된 거래·관계가 없습니다.', 'oa-workspace-empty')); return; }
    const amount = row => {
      const value = row.amount ?? row.primary_amount ?? row.exposure_amount ?? row.amount_krw;
      return value == null ? '' : typeof value === 'number' ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : text(value);
    };
    container.append(table(['역할', '펀드', '자산', '금액', '통화·단위', '기준일', '출처'], rows.map(row => [row.role || row.role_code || row.relationship_role || '', row.fundName || row.fund_name || row.fund_display_name || row.fund_code || row.fund_id || '', row.assetName || row.asset_name || row.asset_display_name || row.asset_id || '', amount(row), row.amountLabel || row.currency || row.amount_unit || (row.amount_krw != null ? 'KRW' : ''), row.snapshotDate || row.as_of_date || row.reference_date || row.base_date || '', row.source || row.source_system || row.source_file || ''])));
  }
  function renderInformation(container, account) {
    const metadata = state.metadata?.account;
    appendIssue(container, 'metadata');
    if (!metadata) { container.append(el('p', '기관정보를 불러오고 있습니다…', 'oa-workspace-empty')); return; }
    container.append(table(['항목', '내용'], [['표시명', metadata.name], ['분류', metadata.piscfh], ['별칭', list(metadata.aliases).join(' · ')], ['기관 메모', verified() ? metadata.notes : metadata.notesMasked || ''], ['기관 ID', state.account], ['상위 기관', nameOf(byId(account.parent_account_id))], ['정보 버전', `v${metadata.revision}`]], 'oa-workspace-information-table'));
  }
  function renderHistory(container) {
    appendIssue(container, 'team'); appendIssue(container, 'metadata');
    const rows = [
      ...list(state.team?.history).map(row => ({ date: row.createdAt, kind: 'RM 배정', actor: row.actorEmail, summary: list(row.changes).map(change => `${ROLE_LABELS[change.role] || change.role}: ${rmName(change.beforeRmId) || '미배정'} → ${rmName(change.afterRmId) || '미배정'}`).join(' · '), version: `RM v${row.revision}` })),
      ...list(state.metadata?.history).map(row => ({ date: row.createdAt, kind: row.entityType === 'account' ? '기관정보' : '소속·인물', actor: row.actorEmail, summary: list(row.changedFields).map(field => ({ name: '성명·표시명', piscfh: '분류', notes: '메모', department: '부서', title: '직책', account_id: '소속기관' }[field] || field)).join(' · '), version: row.revision ? `정보 v${row.revision}` : '' }))
    ].sort((a, b) => text(b.date).localeCompare(text(a.date)));
    container.append(el('h3', '이 기관의 변경이력'), el('p', '개인정보의 변경 전후 값은 본인 인증 후 인물 상세에서 확인합니다.', 'oa-workspace-muted'));
    if (!rows.length) container.append(el('p', state.team && state.metadata ? '등록된 변경이력이 없습니다.' : '변경이력을 불러오고 있습니다…', 'oa-workspace-empty'));
    else container.append(table(['시각', '구분', '변경 항목', '작성자', '버전'], rows.map(row => [row.date ? new Date(row.date).toLocaleString('ko-KR') : '', row.kind, row.summary, row.actor, row.version])));
  }
  function closeEditor() {
    editorGeneration++;
    if (!state.editor) return;
    const editor = state.editor; state.editor = null;
    editor.fields.querySelectorAll('input,textarea,select').forEach(input => { input.value = ''; }); editor.request = null;
    editor.node.remove(); editor.returnFocus?.focus?.();
  }
  function editor(title, kind) {
    closeEditor();
    const node = el('section', undefined, 'oa-workspace-editor'); node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'false'); node.setAttribute('aria-label', title);
    const heading = el('div', undefined, 'oa-workspace-section-heading'); const dismiss = button('닫기', () => navigate(() => { closeEditor(); renderDetail(); })); heading.append(el('h3', title), dismiss);
    const form = el('form'); const fields = el('div', undefined, 'oa-workspace-editor-fields'); const notice = el('div', undefined, 'oa-workspace-editor-notice'); notice.setAttribute('role', 'status');
    const actions = el('div', undefined, 'oa-workspace-editor-actions'); const save = el('button', '저장', 'oa-workspace-primary'); save.type = 'submit';
    const cancel = button('취소', () => navigate(() => { closeEditor(); renderDetail(); })); actions.append(cancel, save); form.append(fields, notice, actions); node.append(heading, form);
    const current = { node, form, fields, notice, saveButton: save, cancelButton: cancel, kind, dirty: false, saving: false, request: null, returnFocus: document.activeElement };
    state.editor = current;
    form.addEventListener('input', () => { current.dirty = true; }); form.addEventListener('change', () => { current.dirty = true; });
    form.addEventListener('submit', event => { event.preventDefault(); current.save?.(); });
    ui.detail.append(node); node.scrollIntoView?.({ block: 'nearest' }); return current;
  }
  function field(container, label, value, type = 'text') {
    const wrap = el('label', undefined, 'oa-workspace-field'); wrap.append(el('span', label)); const input = el(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type; input.value = text(value); input.autocomplete = 'off'; wrap.append(input); container.append(wrap); return input;
  }
  function requireIdentity() {
    if (verified()) return true;
    announce('본인 인증 후 수정할 수 있습니다.'); crm()?.openIdentity?.(); return false;
  }
  async function saveEditor(current, makeBody, onSaved) {
    if (current.saving || state.editor !== current) return false;
    let body;
    try { body = current.request || makeBody(); if (!body) return false; } catch (error) { current.notice.textContent = error.message; return false; }
    current.request = body; current.saving = true; current.saveButton.disabled = true; current.cancelButton.disabled = true; current.saveButton.textContent = '저장 중…';
    // Keep the exact request in memory for retries; customer inputs never enter persistent storage.
    current.fields.querySelectorAll('input,textarea,select').forEach(node => { node.disabled = true; });
    current.notice.textContent = '';
    try {
      const result = await request('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (state.editor !== current) return false;
      current.dirty = false; current.request = null; closeEditor(); await onSaved(result); return true;
    } catch (error) {
      if (state.editor !== current) return false;
      if (error.status === 409) {
        current.request = null;
        current.notice.replaceChildren(el('p', '다른 사용자가 먼저 수정했습니다. 내 입력은 유지했습니다. 최신 내용을 확인하고 다시 저장하세요.'));
        const compareButton = button('최신 값 비교', () => compareConflict(current, body), 'oa-workspace-button'); current.notice.append(compareButton);
      } else {
        current.notice.textContent = error.message + (error.status >= 500 || !error.status ? ' 같은 요청으로 결과를 다시 확인할 수 있습니다.' : '');
        if (error.status && error.status < 500) current.request = null;
      }
      return false;
    } finally {
      current.saving = false; current.saveButton.disabled = false; current.cancelButton.disabled = false; current.saveButton.textContent = current.request ? '저장 결과 재확인' : '저장';
      if (!current.request) current.fields.querySelectorAll('input,textarea,select').forEach(node => { node.disabled = false; });
    }
  }
  async function compareConflict(current, body) {
    const pending = Object.fromEntries(Object.entries(current.inputs || {}).map(([key, input]) => [key, key === 'piscfh' || key.endsWith('RmId') ? input.value : input.value.trim()]));
    const patch = body.action === 'save-team' ? changedTeam(current.base, pending) : Object.fromEntries(Object.entries(pending).filter(([key, value]) => value !== text(current.base[key])));
    body = { ...body, patch };
    current.fields.querySelectorAll('input,textarea,select').forEach(input => { input.disabled = true; }); current.saveButton.disabled = true;
    try {
      const authEpoch = identityEpoch;
      const action = body.action === 'save-team' ? 'team' : 'metadata'; const result = await request(`/api/account?action=${action}&accountId=${encodeURIComponent(body.accountId)}`);
      if (state.editor !== current || (action === 'metadata' && (authEpoch !== identityEpoch || !verified()))) return;
      current.notice.replaceChildren(el('p', '최신 저장값과 내 입력을 비교해 주세요.'));
      const latest = action === 'team' ? result.team : result.account;
      const labels = { primaryRmId: 'Primary', backupRmId: 'Backup', sponsorRmId: 'Sponsor', name: '표시명', piscfh: '분류', notes: '기관 메모' };
      current.notice.append(table(['항목', '최신 저장값', '내 입력'], Object.entries(body.patch).map(([key, value]) => [labels[key] || key, action === 'team' ? rmName(latest[key]) || '미배정' : latest[key], action === 'team' ? rmName(value) || '미배정' : value])));
      const acceptLatest = () => {
        // Fields that were not in the submitted patch belong to the other user's edit.
        for (const [key, input] of Object.entries(current.inputs || {})) if (!Object.hasOwn(body.patch, key)) input.value = text(latest[key]);
        current.expectedRevision = action === 'team' ? result.accountRevision : result.account.revision; current.base = latest; current.request = null;
        current.fields.querySelectorAll('input,textarea,select').forEach(input => { input.disabled = false; }); current.saveButton.disabled = false;
      };
      current.notice.append(button('최신 버전을 기준으로 내 입력 저장', () => { acceptLatest(); current.save(); }, 'oa-workspace-primary'), button('내 입력 계속 편집', () => { acceptLatest(); current.notice.replaceChildren(); }));
    } catch (error) { if (state.editor === current) { current.notice.append(el('p', error.message)); current.fields.querySelectorAll('input,textarea,select').forEach(input => { input.disabled = false; }); current.saveButton.disabled = false; } }
  }
  function editTeam(checked = false) {
    if (!checked) { navigate(() => { closeEditor(); editTeam(true); }); return; }
    if (!state.team) return;
    if (legacy()?.hasUnsaved?.()) { announce('RM 관리에 미저장 일괄 작업이 있습니다. 일괄 작업을 저장하거나 보관한 뒤 기관별 RM을 변경하세요.', true); return; }
    const id = state.account; const current = editor(`${nameOf(byId(id))} · RM 변경`, 'team'); current.base = state.team.team || {}; current.expectedRevision = state.team.accountRevision;
    const inputs = {}; current.inputs = inputs; const candidates = list(state.team.candidates);
    current.fields.append(el('p', '이 기관의 변경만 저장합니다.', 'oa-workspace-muted'));
    for (const role of ROLES) {
      const label = el('label', undefined, 'oa-workspace-field'); label.append(el('span', ROLE_LABELS[role])); const select = el('select'); select.append(option('', '미배정'));
      const eligible = candidates.filter(person => list(person.roles).includes(role));
      for (const person of eligible) select.append(option(person.rmId, person.name));
      const selected = current.base[FIELDS[role]];
      if (selected && !eligible.some(person => person.rmId === selected)) select.append(option(selected, `${rmName(selected)} · 기존 배정`));
      select.value = selected || ''; inputs[FIELDS[role]] = select; label.append(select); current.fields.append(label);
    }
    current.save = () => saveEditor(current, () => {
      const team = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value || '']));
      const ids = Object.values(team).filter(Boolean); if (new Set(ids).size !== ids.length) throw new Error('같은 사람이 두 역할을 맡을 수 없습니다.');
      const patch = changedTeam(current.base, team); if (!Object.keys(patch).length) { closeEditor(); renderDetail(); return null; }
      return { action: 'save-team', accountId: id, expectedRevision: current.expectedRevision, patch, requestId: crypto.randomUUID() };
    }, async result => {
      teamOverrides[id] = result.team || {}; if (state.account === id) state.team = result;
      try { await legacy()?.refreshTeams?.(); } catch { /* The per-account server read remains authoritative. */ }
      renderList(); renderDetail(); announce('RM 배정을 저장했습니다.');
    });
    Object.values(inputs)[0]?.focus();
  }
  async function editMetadata(checked = false) {
    if (!checked) { navigate(() => { closeEditor(); editMetadata(true); }); return; }
    if (!state.metadata || !requireIdentity()) return;
    const id = state.account; const authEpoch = identityEpoch; const editorIntent = ++editorGeneration;
    let result;
    try { result = await request(`/api/account?action=metadata&accountId=${encodeURIComponent(id)}`); } catch (error) { announce(error.message, true); return; }
    if (id !== state.account || authEpoch !== identityEpoch || editorIntent !== editorGeneration || !verified()) return;
    if (result.privacy?.canEdit !== true) { announce('본인 인증 상태를 다시 확인해 주세요.', true); return; }
    state.metadata = result;
    const base = result.account; const current = editor('기관정보 수정', 'metadata'); current.expectedRevision = base.revision; current.base = base;
    const name = field(current.fields, '표시명', base.name); name.maxLength = 300; name.required = true;
    const label = el('label', undefined, 'oa-workspace-field'); label.append(el('span', 'PISCFH 분류')); const code = el('select'); for (const value of ['P', 'I', 'S', 'C', 'F', 'H', '미Account']) code.append(option(value, value)); code.value = base.piscfh || '미Account'; label.append(code); current.fields.append(label);
    const notes = field(current.fields, '기관 메모', base.notes, 'textarea'); notes.maxLength = 10000; notes.rows = 4;
    current.inputs = { name, piscfh: code, notes };
    current.save = () => saveEditor(current, () => {
      if (!verified()) throw new Error('본인 인증이 만료되었습니다. 다시 인증해 주세요.');
      const values = { name: name.value.trim(), piscfh: code.value, notes: notes.value.trim() }; if (!values.name) throw new Error('기관 표시명을 입력해 주세요.');
      const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== text(current.base[key])));
      if (!Object.keys(patch).length) { closeEditor(); renderDetail(); return null; }
      return { action: 'update-account', accountId: id, expectedRevision: current.expectedRevision, patch, requestId: crypto.randomUUID() };
    }, async result => {
      if (state.account === id) state.metadata = result; mergeMetadata(byId(id), result.account); renderList(); renderDetail(); announce('기관정보를 저장했습니다.');
      window.dispatchEvent(new CustomEvent('oa:workspace-account-saved', { detail: { accountId: id } }));
      try { await crm()?.refreshIndex?.(true); } catch { /* The saved account response is already reflected. */ }
    }); name.focus();
  }
  function createPerson(checked = false) {
    if (!checked) { navigate(() => { closeEditor(); createPerson(true); }); return; }
    if (!requireIdentity() || !state.data || state.data.account?.account_kind === 'group') return;
    const id = state.account; const current = editor('소속 인물 추가', 'person'); current.fields.append(el('p', `소속 기관: ${nameOf(byId(id) || state.data.account)}`, 'oa-workspace-muted'));
    const name = field(current.fields, '이름', ''); name.maxLength = 200; name.required = true;
    const department = field(current.fields, '부서·세부소속', ''); department.maxLength = 1000;
    const title = field(current.fields, '직책·직급 (원문)', ''); title.maxLength = 1000;
    current.save = () => saveEditor(current, () => {
      if (!verified()) throw new Error('본인 인증이 만료되었습니다. 다시 인증해 주세요.');
      if (!name.value.trim()) throw new Error('이름을 입력해 주세요.');
      return { action: 'create-person', accountId: id, patch: { name: name.value.trim(), department: department.value.trim(), title: title.value.trim() }, requestId: crypto.randomUUID() };
    }, async result => {
      announce('인물과 소속을 등록했습니다.');
      if (state.account === id) { state.person = result.personId; await loadAccount(); syncRoute(); }
      try { await crm()?.refreshIndex?.(false); } catch { /* The committed person and affiliation are already confirmed. */ }
    }); name.focus();
  }
  async function refresh() {
    for (const id of Object.keys(teamOverrides)) delete teamOverrides[id]; renderList(); if (state.account) await loadAccount();
  }
  createShell(); renderIdentity();
  window.OneAccountWorkspace = { compareAccounts, selectAccount, refresh, show: mode => navigate(() => show(mode)), readState: () => ({ account: state.account, person: state.person, tab: state.tab, view: state.view, query: state.query, scope: state.scope, code: state.code, rm: state.rm }) };
  show(state.view, { noRoute: true });
  routeWindow.addEventListener('popstate', () => {
    const route = readRoute(routeWindow.location.href);
    const moved = navigate(() => {
      routeRestoring = true;
      try {
        const changed = state.account !== route.account; state.account = route.account; state.person = route.person; state.tab = route.tab; state.view = route.view;
        closePersonQuietly(); if (changed) { state.data = null; state.team = null; state.metadata = null; }
        show(route.view, { noRoute: true });
        if (changed && state.account) loadAccount(); else if (route.person) openPerson(route.person, state.data?.account, true);
      } finally { routeRestoring = false; syncRoute(true); }
    });
    if (!moved) syncRoute(true);
  });
  function redactMetadata(result) {
    if (result?.account) { if (result.account.notes) result.account.notesMasked = '*'; result.account.notes = ''; }
    if (result) result.privacy = { detailAccess: 'locked', identityVerified: false, canEdit: false };
  }
  async function receiveIdentity(value) {
    const previouslyVerified = verified(); identitySnapshot = value || {}; identityEpoch++;
    renderIdentity();
    if (!verified()) {
      redactMetadata(state.metadata);
      if (state.editor && ['person', 'metadata'].includes(state.editor.kind)) { closeEditor(); announce('본인 인증이 종료되어 입력창을 닫았습니다.'); }
      renderDetail();
    } else if (!previouslyVerified && state.account) {
      const id = state.account, authEpoch = identityEpoch;
      try {
        const result = await request(`/api/account?action=metadata&accountId=${encodeURIComponent(id)}`);
        if (authEpoch === identityEpoch && id === state.account && verified()) { state.metadata = result; renderDetail(); }
      } catch { /* The normal detail reload provides an explicit retry. */ }
    }
  }
  window.addEventListener('oa:crm-identity', event => { receiveIdentity(event.detail); });
  window.addEventListener('oa:crm-person-open', event => {
    const id = event.detail?.personId || event.detail?.person_id; if (!validId(id)) return;
    state.person = id; state.lastOpenedPerson = id; syncRoute();
  });
  window.addEventListener('oa:crm-person-close', () => { if (routeRestoring || !state.person) return; state.person = ''; state.lastOpenedPerson = ''; syncRoute(); });
  window.addEventListener('oa:crm-saved', () => { if (state.account) loadAccount(); });
  window.addEventListener('oa:crm-catalog', () => { renderList(); if (state.account) renderDetail(); });
  window.addEventListener('oa:teams-changed', () => { for (const id of Object.keys(teamOverrides)) delete teamOverrides[id]; renderList(); renderDetail(); });
  window.addEventListener('beforeunload', event => { if (state.editor?.dirty || state.editor?.request || crm()?.hasUnsavedChanges?.()) { event.preventDefault(); event.returnValue = ''; } });
  if (state.account) loadAccount();
  Promise.resolve(crm()?.readIdentity?.()).then(value => { if (value && !identityEpoch) receiveIdentity(value); }).catch(() => {});
})();
