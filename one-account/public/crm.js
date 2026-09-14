'use strict';
(function () {
  const labels = {
    employment: { unknown: '재직 미확인', current: '재직', former: '퇴사·이직' },
    availability: { yes: '수령 가능', no: '수령 불가', unknown: '미확인', not_applicable: '해당없음' },
    scope: { campaign: '해당 명절에 한함', ongoing: '지속 적용', unknown: '적용 범위 미확인' },
    contact: { mobile: '휴대전화', phone: '일반전화', email: '이메일', address: '배송주소', postcode: '우편번호' },
    event: { birthday: '생일', wedding: '결혼', bereavement: '부고', anniversary: '기념일', other: '기타 경조사' },
    calendar: { solar: '양력', lunar: '음력', unknown: '역법 미확인' },
    delivery: { unknown: '발송 미확인', sent: '발송 완료', returned: '반송', cancelled: '취소', not_sent: '미발송' },
    received: { unknown: '수령 미확인', received: '수령 완료', not_received: '미수령', declined: '수령 거절' },
    sourceField: { name: '성명', title: '직책', department: '부서·세부소속', phone: '전화번호', email: '이메일', value: '원본 값', notes: '메모', source_notes: '원본 메모', source_organization_name: '원본 기관명', source_piscfh: '원본 PISCFH', source_receiving_mark: '원본 수령여부', source_position_status: '원본 직책 확인 상태', planned_item_name: '발송 예정품', requester: '요청자', request_team: '요청팀', historical_department: '과거 부서', historical_title: '과거 직책', historical_phone: '과거 전화', historical_email: '과거 이메일', identity_review: '동일인 확인 사항', accepted_reconciliation_match: '기존 명단 일치 근거', list_membership: '명단 포함 근거', possible_duplicate_source_rows: '중복 검토 원본', source_affiliation_id: '원본 소속 연결', is_placeholder: '실명·소속 확인 대상', legacy_account_snapshot: '기존 어카운트 원본' }
  };
  const str = value => value == null ? '' : String(value);
  const list = value => Array.isArray(value) ? value : [];
  const escape = value => str(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const compare = (a, b) => str(a).localeCompare(str(b), 'ko');
  function groupPeople(people, query = '') {
    const q = query.trim().toLocaleLowerCase('ko');
    const filtered = list(people).filter(p => [p.name, p.department, p.title, p.account_name].some(v => str(v).toLocaleLowerCase('ko').includes(q)));
    const groups = new Map();
    for (const person of filtered.sort((a, b) => compare(a.department || '\uffff', b.department || '\uffff') || compare(a.title || '\uffff', b.title || '\uffff') || compare(a.name, b.name) || compare(a.person_id, b.person_id))) {
      const key = person.department || '부서 미확인';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(person);
    }
    return [...groups].map(([department, people]) => ({ department, people }));
  }
  function preferenceText(pref) {
    const value = labels.availability[pref.availability] || '미확인';
    const scope = labels.scope[pref.scope] || labels.scope.unknown;
    const campaign = pref.campaign_name || pref.campaign_label || '';
    const period = [pref.effective_from, pref.effective_to].filter(Boolean).join(' ~ ');
    return [value, scope, campaign, period].filter(Boolean).join(' · ');
  }
  function sourceText(record) {
    const file = record.file_name || record.source_file || record.workbook || record.filename || record.source_name || '';
    const sheet = record.sheet_name || record.source_sheet || record.sheet || '';
    const row = record.row_number ?? record.source_row ?? record.row;
    return [file, sheet, row == null ? '' : `${row}행`].filter(Boolean).join(' · ') || record.source_record_id || record.id || '출처 미입력';
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { groupPeople, preferenceText, sourceText, escape, labels };
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
  const addLabeled = (container, label, value) => {
    const item = el('div', undefined, 'oa-crm-field');
    item.append(el('dt', label), el('dd', value || '미입력'));
    container.append(item);
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
      block.append(el('h3', '소속인물'));
      const count = Number(account.people_count || 0);
      block.append(el('p', `${count.toLocaleString()}명 · 부서·직책·연락처·관계 이력`, 'source'), button('소속인물 보기', () => openAccount(id), 'oa-crm-inline-open'));
      inspector.prepend(block);
    }
  }
  if (typeof accountRow === 'function') {
    const originalRow = accountRow;
    accountRow = function (account, ...rest) {
      let html = originalRow(account, ...rest);
      const record = catalogById.get(account.account_id);
      if (account.crm_only) html = html.replace(/<span class="faces">[^<]*<\/span>/, '<span class="faces">고객정보</span>').replace(/<div class="row-meta">[\s\S]*?<\/div>/, '<div class="row-meta"><span>고객정보 등록기관</span><span>사업 관계 미연결</span></div>');
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
      barStatus.textContent = `${Number(totals.accounts ?? catalogById.size).toLocaleString()}개 기관 · ${Number(totals.persons || 0).toLocaleString()}명 · 선물 발송 여부는 별도 확인`;
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
    breadcrumb.replaceChildren(button('전체 기관·인물', () => openAll()));
    if (next.accountId) breadcrumb.append(el('span', '›'), button(catalogById.get(next.accountId)?.name || '기관', () => openAccount(next.accountId)));
    if (next.kind === 'person') breadcrumb.append(el('span', '› 인물 상세'));
    body.scrollTop = 0;
    return ++viewGeneration;
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
  function personCard(person, showAccount = false) {
    const card = button('', () => openPerson(person.person_id, person.account_id || view.accountId), 'oa-crm-person');
    const line = el('div', undefined, 'oa-crm-person-title');
    line.append(el('strong', person.name || '실명 미확인'), badge(labels.employment[person.employment_status] || labels.employment.unknown, person.employment_status === 'former' ? 'is-muted' : ''));
    card.append(line, el('p', [showAccount ? person.account_name : '', person.department || '부서 미확인', person.title || '직책 미확인'].filter(Boolean).join(' · ')));
    const flags = el('div', undefined, 'oa-crm-flags');
    if (person.identity_status === 'needs_review') flags.append(badge('동일인·실명 확인 필요', 'is-amber'));
    const contacts = list(person.contact_points);
    if (contacts.length) flags.append(badge(`연락 정보 ${contacts.length}건`));
    const pref = list(person.receiving_preferences)[0];
    if (pref) flags.append(badge(describePreference(pref), pref.availability === 'no' ? 'is-amber' : ''));
    if (flags.childElementCount) card.append(flags);
    return card;
  }
  function peopleGroups(container, people, query = '') {
    container.replaceChildren();
    const groups = groupPeople(people, query);
    if (!groups.length) { container.append(empty(query ? '검색 조건에 맞는 인물이 없습니다.' : '등록된 소속인물이 없습니다.')); return; }
    groups.forEach(group => {
      const block = section(`${group.department} · ${group.people.length}명`);
      const cards = el('div', undefined, 'oa-crm-person-grid');
      group.people.forEach(person => cards.append(personCard(person)));
      block.append(cards); container.append(block);
    });
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
      const accounts = [...catalogById.values()].filter(a => [a.name, ...list(a.aliases).map(x => typeof x === 'string' ? x : x.name)].some(v => str(v).toLocaleLowerCase('ko').includes(q))).sort((a, b) => compare(a.name, b.name));
      const group = section(`기관 ${accounts.length.toLocaleString()}개`);
      const cards = el('div', undefined, 'oa-crm-account-grid');
      accounts.forEach(account => {
        const card = button('', () => openAccount(account.account_id), 'oa-crm-account');
        card.append(el('strong', account.name), el('span', `${account.piscfh || '미Account'} · 소속인물 ${Number(account.people_count || 0)}명`));
        cards.append(card);
      });
      group.append(cards); results.replaceChildren(group);
      if (!accounts.length) cards.append(empty('일치하는 기관이 없습니다.'));
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
          const cards = el('div', undefined, 'oa-crm-person-grid');
          list(result.people).forEach(person => cards.append(personCard(person, true)));
          matches.append(cards);
          if (!cards.childElementCount) matches.append(empty('일치하는 인물이 없습니다.'));
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
      heading.textContent = result.account?.name || heading.textContent;
      const summary = el('div', undefined, 'oa-crm-account-summary');
      summary.append(badge(result.account?.piscfh || '미Account'), badge(`소속인물 ${list(result.people).length}명`));
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
      const note = el('p', '부서별로 묶고 직책·이름순으로 표시합니다. 원본 명단에 있다는 사실만으로 재직·실제 발송을 확정하지 않습니다.', 'oa-crm-note');
      const results = el('div');
      const search = searchInput('소속인물 검색', '이름, 부서, 직책', value => peopleGroups(results, result.people, value));
      body.replaceChildren(summary, note, search, results); peopleGroups(results, result.people);
    } catch (error) { if (generation === viewGeneration) failure(error, () => openAccount(accountId)); }
  }
  function recordList(title, records, render, emptyText) {
    const block = section(title);
    if (!list(records).length) block.append(empty(emptyText));
    else list(records).forEach(record => block.append(render(record)));
    return block;
  }
  function detailCard() { return el('article', undefined, 'oa-crm-record'); }
  function describePreference(pref) {
    const campaign = list(catalog?.campaigns).find(c => (c.campaign_id || c.id) === pref.campaign_id);
    return preferenceText({ ...pref, campaign_name: pref.campaign_name || campaign?.name || '' });
  }
  async function openPerson(personId, accountId = view.accountId) {
    const generation = show('인물 상세', { kind: 'person', accountId, personId });
    try {
      const result = await api({ action: 'person', personId });
      if (generation !== viewGeneration || !drawer.open) return;
      currentPerson = result;
      const person = result.person || {};
      heading.textContent = person.name || '실명 미확인';
      const identity = el('div', undefined, 'oa-crm-account-summary');
      if (person.identity_status === 'needs_review') identity.append(badge('동일인·실명 확인 필요', 'is-amber'));
      else if (person.identity_status === 'unverified') identity.append(badge('원본 등록 · 현재 정보 미확인'));
      identity.append(el('span', '동명이인과 소속 이력은 별도 레코드로 관리합니다.', 'oa-crm-note'));
      const affiliations = recordList('소속·재직 이력', result.affiliations, affiliation => {
        const card = detailCard();
        card.append(el('strong', affiliation.account_name || catalogById.get(affiliation.account_id)?.name || affiliation.account_id), badge(labels.employment[affiliation.employment_status] || labels.employment.unknown));
        const details = el('dl', undefined, 'oa-crm-fields');
        addLabeled(details, '부서·세부소속', affiliation.department); addLabeled(details, '직책', affiliation.title);
        addLabeled(details, '입사·소속 시작일', affiliation.started_on); addLabeled(details, '퇴사·소속 종료일', affiliation.ended_on);
        card.append(details);
        if (affiliation.notes) card.append(el('p', affiliation.notes, 'oa-crm-note'));
        card.append(button('소속·재직 수정', () => editRecord('affiliation', affiliation)));
        return card;
      }, '소속 이력 없음');
      affiliations.append(button('다른 소속 추가', () => editRecord('affiliation')));
      const contacts = recordList('연락·배송 정보', result.contact_points, contact => {
        const card = detailCard();
        const status = contact.verification_status || contact.status;
        card.append(el('strong', labels.contact[contact.kind] || contact.kind || '연락처'), el('p', contact.value || '미입력', 'oa-crm-contact-value'));
        if (status) card.append(el('p', status === 'verified' ? '확인됨' : status === 'source_reported' ? '원본 기재 · 현재 유효성 확인 필요' : status === 'conflict' ? '원본 간 값 상충 · 확인 필요' : '유효성 미확인', 'oa-crm-note'));
        if (contact.notes) card.append(el('p', contact.notes, 'oa-crm-note'));
        card.append(button('수정', () => editRecord('contact_point', contact)));
        return card;
      }, '등록된 연락 정보 없음');
      contacts.append(button('연락·배송 정보 추가', () => editRecord('contact_point')));
      const preferences = recordList('선물 수령 의사', result.receiving_preferences, pref => {
        const card = detailCard(); card.append(el('strong', describePreference(pref)));
        if (pref.notes) card.append(el('p', pref.notes, 'oa-crm-note'));
        card.append(button('수령 의사 수정', () => editRecord('preference', pref))); return card;
      }, '수령 의사 확인 기록 없음');
      preferences.append(el('p', '해당 명절의 수령 불가 표시가 앞으로의 지속적인 거절을 뜻하지는 않습니다. 적용 범위·기간을 함께 확인합니다.', 'oa-crm-note'), button('수령 의사 기록', () => editRecord('preference')));
      const gifts = recordList('명절별 선물 이력', result.gift_recipients, gift => {
        const card = detailCard();
        card.append(el('strong', gift.campaign_name || gift.campaign_label || gift.campaign?.name || '행사 미입력'), badge(labels.delivery[gift.delivery_status] || labels.delivery.unknown, gift.delivery_status === 'sent' ? 'is-green' : ''), badge(labels.received[gift.received_status] || labels.received.unknown));
        const details = el('dl', undefined, 'oa-crm-fields');
        const affiliation = list(result.affiliations).find(a => a.affiliation_id === gift.affiliation_id);
        addLabeled(details, '당시 소속', gift.gift_account_name || affiliation?.account_name);
        addLabeled(details, '선물', gift.gift_name || gift.item_name || gift.gift_item);
        const amountText = amount => amount == null || amount === '' ? '미입력' : `${Number(amount).toLocaleString('ko-KR')}원`;
        addLabeled(details, '예정 금액', amountText(gift.planned_amount ?? gift.unit_price));
        addLabeled(details, '실제 금액', amountText(gift.actual_amount));
        const claimValue = field => [...new Set(list(result.field_claims).filter(c => c.entity_id === (gift.recipient_id || gift.id) && c.field_name === field).map(c => c.value).filter(Boolean))].join(' · ');
        addLabeled(details, '발송일', gift.sent_on || gift.sent_at);
        addLabeled(details, '요청자', gift.requester_name || gift.requester || claimValue('requester'));
        addLabeled(details, '요청팀', gift.request_team || claimValue('request_team'));
        card.append(details);
        if (gift.notes) card.append(el('p', gift.notes, 'oa-crm-note'));
        return card;
      }, '선물 이력 없음 · 지난 설 선물은 아직 입력되지 않았습니다.');
      gifts.append(el('p', '기존 발송 명단과 추가 후보를 등록한 상태입니다. 실제 발송·수령 여부와 금액은 확인 후 업데이트합니다. 표시되지 않은 명절은 아직 이력이 입력되지 않았습니다.', 'oa-crm-note'));
      const events = recordList('경조사', result.life_events, event => {
        const card = detailCard();
        card.append(el('strong', `${labels.event[event.event_type] || '경조사'} · ${event.event_date || '날짜 미확인'}`), el('p', [labels.calendar[event.calendar] || labels.calendar.unknown, event.recurring ? '매년 반복' : '해당 일자'].join(' · ')));
        if (event.description) card.append(el('p', event.description));
        if (event.notes) card.append(el('p', event.notes, 'oa-crm-note'));
        card.append(button('수정', () => editRecord('life_event', event))); return card;
      }, '등록된 경조사 없음');
      events.append(button('경조사 기록', () => editRecord('life_event')));
      const provenance = section('출처·변경 이력');
      const sources = el('details', undefined, 'oa-crm-provenance');
      sources.append(el('summary', `원본 출처 ${list(result.source_records).length}건`));
      list(result.source_records).forEach(record => {
        const entry = detailCard(); entry.append(el('strong', sourceText(record)));
        const sourceNotes = record.notes || record.match_reason || record.role;
        if (sourceNotes) entry.append(el('p', sourceNotes, 'oa-crm-note'));
        sources.append(entry);
      });
      const claims = el('details', undefined, 'oa-crm-provenance');
      claims.append(el('summary', `필드별 원본 근거 ${list(result.field_claims).length}건`));
      list(result.field_claims).forEach(claim => {
        const entry = detailCard();
        const claimValue = claim.value ?? claim.raw_value;
        const field = claim.field_name || claim.field;
        entry.append(el('strong', labels.sourceField[field] || field || '원본 항목'), el('p', typeof claimValue === 'object' ? JSON.stringify(claimValue) : claimValue == null || claimValue === '' ? '값 없음' : String(claimValue)));
        const record = list(result.source_records).find(r => (r.source_record_id || r.id) === claim.source_record_id);
        if (record) entry.append(el('small', sourceText(record)));
        if (claim.notes) entry.append(el('p', claim.notes, 'oa-crm-note'));
        claims.append(entry);
      });
      const audit = el('details', undefined, 'oa-crm-provenance');
      audit.append(el('summary', `변경 기록 ${list(result.audit).length}건`));
      list(result.audit).forEach(record => audit.append(el('p', [record.created_at ? new Date(record.created_at).toLocaleString('ko-KR') : '', record.actor_email || record.changed_by || '', record.action || '', record.entity_type || record.entity || ''].filter(Boolean).join(' · '))));
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
        add('account_id', '소속 기관', 'text', [{ value: '', label: '기관을 선택하세요' }, ...[...catalogById.values()].sort((a, b) => compare(a.name, b.name)).map(a => ({ value: a.account_id, label: a.name }))]);
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
