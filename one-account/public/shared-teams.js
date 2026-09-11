'use strict';
(function () {
  const fields = { primary: 'primaryRmId', backup: 'backupRmId', sponsor: 'sponsorRmId' };
  const roles = Object.keys(fields);
  const copy = value => JSON.parse(JSON.stringify(value));
  function changesBetween(before, after) {
    const changes = [];
    for (const accountId of [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort()) {
      for (const role of roles) {
        const field = fields[role];
        const beforeRmId = before?.[accountId]?.[field] || '';
        const afterRmId = after?.[accountId]?.[field] || '';
        if (beforeRmId !== afterRmId) changes.push({ accountId, role, beforeRmId, afterRmId });
      }
    }
    return changes;
  }
  function applyChanges(assignments, changes) {
    const next = copy(assignments);
    for (const change of changes) {
      const record = next[change.accountId] || { primaryRmId: '', backupRmId: '', sponsorRmId: '', updatedAtByRole: {} };
      record[fields[change.role]] = change.afterRmId;
      record.updatedAtByRole ||= {};
      delete record.updatedAtByRole[change.role];
      if (roles.some(role => record[fields[role]])) next[change.accountId] = record;
      else delete next[change.accountId];
    }
    return next;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { changesBetween, applyChanges };
    return;
  }
  if (!/^https?:$/.test(location.protocol) || typeof teamAssignments === 'undefined') return;

  let ready = false;
  let busy = false;
  let common = null;
  let pending = null;
  let recovered = { active: null, archives: [] };
  let recoveryKey = '';
  let sessionExpired = false;
  let dialogGeneration = 0;
  const legacy = (() => {
    try {
      return localStorage.getItem(TEAM_STORAGE_KEY) !== null
        ? { label: '기존 브라우저 수정본', assignments: copy(teamAssignments), savedAt: null, legacy: true }
        : null;
    } catch { return null; }
  })();

  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action, className) => {
    const node = element('button', text, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const bar = element('section', undefined, 'oa-shared-bar');
  bar.dataset.oneAccountShared = '';
  bar.setAttribute('aria-label', '공용 데이터 저장');
  const stateBox = element('div', undefined, 'oa-shared-state');
  const versionLabel = element('strong', '공용 데이터 연결 중');
  const statusLabel = element('span', '서버에서 최신 배정을 불러오고 있습니다.');
  statusLabel.setAttribute('role', 'status');
  statusLabel.setAttribute('aria-live', 'polite');
  stateBox.append(versionLabel, statusLabel);
  const actions = element('div', undefined, 'oa-shared-actions');
  const saveButton = button('공용 저장', () => pending ? retryPending() : showSave(), 'oa-shared-primary');
  const refreshButton = button('최신 공용본 불러오기', showRefresh);
  const historyButton = button('변경 이력', () => showHistory());
  const recoveryButton = button('브라우저 수정본', showRecoveryList);
  actions.append(saveButton, refreshButton, historyButton, recoveryButton);
  bar.append(stateBox, actions);
  document.querySelector('.topbar').insertAdjacentElement('afterend', bar);
  const dialog = element('dialog', undefined, 'oa-shared-dialog');
  dialog.dataset.oneAccountShared = '';
  dialog.setAttribute('aria-labelledby', 'oa-shared-dialog-title');
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialogGeneration += 1; });

  function status(message, error = false) {
    statusLabel.textContent = message;
    statusLabel.classList.toggle('oa-shared-error', error);
  }
  function dirtyChanges() { return common ? changesBetween(common.assignments, teamAssignments) : []; }
  function listRecoveries() {
    const items = [recovered.active, ...recovered.archives, legacy].filter(Boolean);
    return common ? items.filter(item => changesBetween(common.assignments, item.assignments).length) : items;
  }
  function updateControls() {
    const dirty = dirtyChanges().length;
    versionLabel.textContent = common ? `공용 데이터 · v${common.revision}` : '공용 데이터 연결 중';
    saveButton.textContent = pending ? '저장 결과 재확인' : dirty ? `공용 저장 · ${dirty}건` : '공용 저장';
    saveButton.disabled = busy || !ready || (!pending && !dirty);
    refreshButton.disabled = busy || sessionExpired || !!pending;
    historyButton.disabled = busy || !ready || !!pending;
    recoveryButton.disabled = busy || !ready || !!pending || !listRecoveries().length;
    const count = listRecoveries().length;
    recoveryButton.textContent = count ? `브라우저 수정본 · ${count}개` : '브라우저 수정본';
    bar.setAttribute('aria-busy', String(busy || !ready));
  }
  function describeVersion(value) {
    const actor = value.updatedBy || '초기 등록';
    const date = value.updatedAt ? new Date(value.updatedAt).toLocaleString('ko-KR') : '';
    return `${actor}${date ? ` · ${date}` : ''}`;
  }
  function renderDashboard() {
    ensureScopeSelection();
    renderKpis(); renderList(); renderSelection(); renderLookthrough(); renderReviews(); renderQuality();
    if (document.querySelector('#rmDrawer.open')) { renderRmCandidates(); updateRmDrawerFooter(); }
  }
  function writeRecovery(next) {
    localStorage.setItem(recoveryKey, JSON.stringify(next));
    recovered = next;
  }
  function rememberPending(value) {
    writeRecovery({ ...recovered, pendingRequest: value });
    pending = value;
  }
  function forgetPending() {
    pending = null;
    try { writeRecovery({ ...recovered, pendingRequest: null }); } catch { /* A retained request remains safe to replay. */ }
  }
  function currentDraft(assignments = teamAssignments) {
    return { id: crypto.randomUUID(), label: '공용 저장 전 수정본', savedAt: new Date().toISOString(), baseRevision: common.revision, baseAssignments: copy(common.assignments), assignments: copy(assignments) };
  }
  function archiveActive() {
    if (!recovered.active) return;
    const active = recovered.active;
    const duplicate = recovered.archives.some(item => !changesBetween(item.assignments, active.assignments).length && item.baseRevision === active.baseRevision);
    writeRecovery({ active: null, archives: duplicate ? recovered.archives : [active, ...recovered.archives] });
  }
  function validateAssignments(assignments) {
    for (const [accountId, record] of Object.entries(assignments)) {
      const used = new Set();
      for (const role of roles) {
        const id = record[fields[role]];
        if (!id) continue;
        const candidate = rmById.get(id);
        if (!accountsById.has(accountId) || !candidate || !roleCohort(candidate, role)) throw new Error('역할 후보군에 맞지 않는 배정이 있습니다.');
        if (used.has(id)) throw new Error(`${accountsById.get(accountId)?.display_name || accountId}: 같은 사람이 두 역할을 맡을 수 없습니다. 선택한 변경을 다시 확인해 주세요.`);
        used.add(id);
      }
    }
  }
  // All existing drawer and drag/drop assignments pass through this synchronous hook.
  // Keep the original storage key untouched so the pre-DB draft remains recoverable.
  commitTeamAssignments = function (next) {
    if (!ready || busy || pending || sessionExpired) throw new Error('공용 저장 상태를 먼저 확인해 주세요.');
    const cleaned = cleanTeamAssignments(next);
    validateAssignments(cleaned);
    writeRecovery({ ...recovered, active: currentDraft(cleaned) });
    teamAssignments = cleaned;
    updateControls();
    status(`미저장 변경 ${dirtyChanges().length}건 · 공용 저장을 눌러 다른 사용자에게 반영하세요.`);
  };
  document.addEventListener('click', event => {
    const edit = event.target.closest?.('[data-edit-team-role],#primaryAssign,#assignRm,#primaryClear');
    if (edit && (!ready || busy || pending || sessionExpired)) {
      event.preventDefault(); event.stopImmediatePropagation();
      status(pending ? '앞선 저장 결과를 먼저 재확인해 주세요. 수정본은 보관되어 있습니다.' : '공용 데이터 연결 또는 저장이 끝난 뒤 수정할 수 있습니다.', true);
    }
  }, true);
  document.addEventListener('drop', event => {
    if ((!ready || busy || pending || sessionExpired) && event.target.closest?.('.account-row,#accountMap,#inspector')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  const originalSetRmStatus = setRmStatus;
  setRmStatus = function (message, isError) {
    if (!isError && /배정을 (저장|해제)했습니다/.test(message)) message += ' 공용 저장 버튼을 눌러 반영하세요.';
    originalSetRmStatus(message, isError);
  };
  const originalBuildSharedHtml = buildSharedHtml;
  buildSharedHtml = function (snapshotId) {
    const parsed = new DOMParser().parseFromString(originalBuildSharedHtml(snapshotId), 'text/html');
    parsed.querySelectorAll('[data-one-account-shared],#oa-shared-adapter').forEach(node => node.remove());
    return '<!doctype html>\n' + parsed.documentElement.outerHTML;
  };
  addEventListener('beforeunload', event => {
    if (dirtyChanges().length || pending) { event.preventDefault(); event.returnValue = ''; }
  });

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      let body;
      try { body = await response.json(); } catch { body = {}; }
      if (response.status === 401) {
        sessionExpired = true;
        status('로그인이 만료되었습니다. 수정본은 이 브라우저에 보관되어 있습니다. 다시 로그인해 주세요.', true);
        updateControls();
        const link = element('a', '다시 로그인', 'oa-shared-relogin');
        link.href = '/'; link.target = '_top';
        if (!stateBox.querySelector('.oa-shared-relogin')) stateBox.append(link);
      }
      if (!response.ok) {
        const error = new Error(body.message || (response.status === 409 ? '다른 사용자가 먼저 공용 데이터를 변경했습니다.' : '요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
        error.status = response.status; error.payload = body;
        throw error;
      }
      return body;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('응답을 기다리는 시간이 길어졌습니다.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function modal(title, description) {
    dialogGeneration += 1;
    dialog.replaceChildren();
    const head = element('div', undefined, 'oa-shared-dialog-head');
    const heading = element('h2', title); heading.id = 'oa-shared-dialog-title';
    const close = button('닫기', () => dialog.close());
    head.append(heading, close);
    const desc = element('p', description, 'oa-shared-description');
    const content = element('div', undefined, 'oa-shared-dialog-content');
    const footer = element('div', undefined, 'oa-shared-dialog-actions');
    dialog.append(head, desc, content, footer);
    if (!dialog.open) dialog.showModal();
    return { content, footer, desc, generation: dialogGeneration };
  }
  const accountName = id => accountsById.get(id)?.display_name || id;
  const personName = id => id ? rmById.get(id)?.name || id : '미지정';
  function changeTable(changes, { choose = false, beforeLabel = '변경 전', afterLabel = '변경 후' } = {}) {
    const wrap = element('div', undefined, 'oa-shared-table-wrap');
    const table = element('table');
    const header = element('tr');
    if (choose) header.append(element('th', '반영'));
    for (const label of ['Account', '역할', beforeLabel, afterLabel]) header.append(element('th', label));
    const thead = element('thead'); thead.append(header); table.append(thead);
    const tbody = element('tbody');
    const picks = [];
    changes.forEach(change => {
      const tr = element('tr');
      if (choose) {
        const cell = element('td');
        const check = element('input'); check.type = 'checkbox';
        check.setAttribute('aria-label', `${accountName(change.accountId)} ${TEAM_ROLE_LABEL[change.role]} 변경 반영`);
        cell.append(check); tr.append(cell); picks.push({ check, change });
      }
      tr.append(element('td', accountName(change.accountId)), element('td', TEAM_ROLE_LABEL[change.role]), element('td', personName(change.beforeRmId)), element('td', personName(change.afterRmId)));
      tbody.append(tr);
    });
    table.append(tbody); wrap.append(table);
    return { node: wrap, picks };
  }
  function showSave() {
    const changes = dirtyChanges();
    if (!changes.length || !ready || busy) return;
    const view = modal('공용 데이터에 저장', `v${common.revision}에서 ${changes.length}개 역할 배정을 변경합니다. 저장 후 다른 사용자에게도 반영되며 수정 이력이 남습니다.`);
    view.content.append(changeTable(changes).node);
    const label = element('label', '변경 메모 (선택)', 'oa-shared-note');
    const note = element('textarea'); note.maxLength = 300; note.rows = 2; note.placeholder = '변경 사유를 간단히 남겨주세요.';
    label.append(note); view.content.append(label);
    view.footer.append(button('계속 수정', () => dialog.close()), button(`${changes.length}건 공용 저장`, () => {
      try {
        rememberPending({ expectedRevision: common.revision, assignments: copy(teamAssignments), requestId: crypto.randomUUID(), note: note.value.trim() });
        retryPending();
      } catch { view.desc.textContent = '저장 요청을 브라우저에 보관하지 못했습니다. HTML로 수정본을 저장한 뒤 다시 시도해 주세요.'; }
    }, 'oa-shared-primary'));
  }
  async function retryPending() {
    if (!pending || busy) return;
    busy = true; updateControls(); dialog.close(); status('공용 데이터와 변경 이력을 저장하고 있습니다.');
    try {
      let saved = await request('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
      const laterRevision = Number(saved.currentRevision || saved.revision) > Number(saved.revision);
      if (laterRevision) saved = await request('/api/teams');
      common = saved;
      teamAssignments = cleanTeamAssignments(saved.assignments);
      pending = null;
      try { writeRecovery({ ...recovered, active: null, pendingRequest: null }); } catch { /* Server save is already confirmed; retain local recovery. */ }
      renderDashboard();
      status(laterRevision ? `저장 결과를 확인하고 최신 v${saved.revision}을 불러왔습니다.` : `공용 저장 완료 · ${describeVersion(saved)}`);
    } catch (error) {
      if (error.status === 409) {
        forgetPending();
        status('다른 사용자가 먼저 저장했습니다. 내 수정본을 유지했습니다. 최신 공용본을 불러온 뒤 브라우저 수정본과 비교해 주세요.', true);
        showConflict(error.payload);
      } else if (error.status && error.status < 500 && error.status !== 408 && error.status !== 429) {
        forgetPending();
        status(error.message, true);
      } else {
        status(`${error.message} 수정본은 유지했습니다. ‘저장 결과 재확인’을 누르면 같은 요청의 결과를 확인합니다.`, true);
      }
    } finally { busy = false; updateControls(); }
  }
  function showConflict(latest) {
    const view = modal('동시 수정 확인', '다른 사용자가 먼저 저장하여 이번 변경은 반영되지 않았습니다. 내 수정본은 브라우저에 보관되어 있습니다.');
    if (latest?.assignments) view.content.append(changeTable(changesBetween(latest.assignments, teamAssignments), { beforeLabel: '최신 공용값', afterLabel: '내 수정값' }).node);
    view.footer.append(button('내 수정 계속 보기', () => dialog.close()), button('최신 공용본 불러오기', () => loadLatest(true), 'oa-shared-primary'));
  }
  function showRefresh() {
    if (pending) { status('앞선 저장 결과를 먼저 재확인해 주세요.', true); return; }
    if (!dirtyChanges().length) return loadLatest(true);
    const view = modal('최신 공용본 불러오기', '현재 미저장 수정본을 이 브라우저에 보관한 뒤 최신 공용본을 표시합니다. ‘브라우저 수정본’에서 필요한 변경만 다시 불러올 수 있습니다.');
    view.content.append(changeTable(dirtyChanges()).node);
    view.footer.append(button('취소', () => dialog.close()), button('수정본 보관 후 불러오기', () => loadLatest(true), 'oa-shared-primary'));
  }
  async function loadLatest(preserve = false) {
    if (busy) return;
    busy = true; updateControls(); status('최신 공용 데이터를 불러오고 있습니다.');
    try {
      const value = await request('/api/teams');
      if (!recoveryKey) {
        recoveryKey = `one-account-shared-drafts:v1:${value.snapshotId || SNAPSHOT_ID}:${value.actorEmail}`;
        try {
          const stored = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
          if (stored && Array.isArray(stored.archives)) {
            recovered = stored;
            if (stored.pendingRequest && typeof stored.pendingRequest.requestId === 'string') pending = stored.pendingRequest;
          }
        } catch { /* A damaged draft must not prevent loading the shared snapshot. */ }
      } else if (preserve) archiveActive();
      common = value;
      teamAssignments = cleanTeamAssignments(pending?.assignments || value.assignments);
      ready = true;
      renderDashboard(); dialog.close();
      const count = listRecoveries().length;
      status(pending ? '결과가 확인되지 않은 저장 요청이 있습니다. ‘저장 결과 재확인’을 눌러주세요.' : `${describeVersion(value)}${count ? ` · 브라우저 수정본 ${count}개는 비교 후 불러올 수 있습니다.` : ' · 모든 변경이 저장되어 있습니다.'}`);
    } catch (error) { status(`${error.message} 기존 브라우저 수정본은 보존되어 있습니다.`, true); }
    finally { busy = false; updateControls(); }
  }
  function showRecoveryList() {
    const view = modal('브라우저 수정본', '공용본과 다른 내용을 비교하고 필요한 변경만 선택할 수 있습니다. 불러온 뒤 공용 저장을 눌러야 다른 사용자에게 반영됩니다.');
    const items = listRecoveries();
    if (!items.length) view.content.append(element('p', '현재 공용본과 다른 브라우저 수정본이 없습니다.'));
    items.forEach(item => {
      const card = element('div', undefined, 'oa-shared-recovery-card');
      const text = element('div');
      text.append(element('strong', item.label || '브라우저 수정본'));
      text.append(element('p', `${item.baseRevision !== undefined ? `기준 v${item.baseRevision} · ` : ''}${item.savedAt ? new Date(item.savedAt).toLocaleString('ko-KR') + ' · ' : ''}${changesBetween(common.assignments, item.assignments).length}개 역할 차이`));
      card.append(text, button('비교하여 불러오기', () => showImport(item)));
      view.content.append(card);
    });
  }
  function showImport(item) {
    const changes = changesBetween(teamAssignments, item.assignments);
    const view = modal('브라우저 수정본 비교', '반영할 역할만 선택하세요. 선택하지 않은 역할은 현재 화면의 값을 유지합니다. 아직 공용 DB에는 저장하지 않습니다.');
    const table = changeTable(changes, { choose: true, beforeLabel: '현재 화면', afterLabel: '브라우저 수정본' });
    view.content.append(table.node);
    const error = element('p', '', 'oa-shared-error'); error.setAttribute('role', 'alert'); view.content.append(error);
    view.footer.append(button('모두 선택', () => table.picks.forEach(item => { item.check.checked = true; })), button('선택 해제', () => table.picks.forEach(item => { item.check.checked = false; })), button('선택한 변경 불러오기', () => {
      const selected = table.picks.filter(item => item.check.checked).map(item => item.change);
      if (!selected.length) { error.textContent = '불러올 변경을 선택해 주세요.'; return; }
      try {
        const next = applyChanges(teamAssignments, selected);
        validateAssignments(next);
        archiveActive();
        commitTeamAssignments(next);
        renderDashboard(); dialog.close();
        status(`${selected.length}개 변경을 불러왔습니다. 확인 후 공용 저장을 눌러주세요.`);
      } catch (problem) { error.textContent = problem.message || '수정본을 불러오지 못했습니다.'; }
    }, 'oa-shared-primary'));
  }
  async function showHistory(before, existingView) {
    const view = existingView || modal('변경 이력', '공용 저장마다 버전과 변경 전·후 값, 로그인 이메일, 서버 저장 시각을 기록합니다.');
    const loading = element('p', '이력을 불러오고 있습니다.'); view.content.append(loading);
    try {
      const result = await request(`/api/history?limit=20${before === undefined ? '' : `&before=${encodeURIComponent(before)}`}`);
      if (view.generation !== dialogGeneration || !dialog.open) return;
      loading.remove();
      if (!result.versions?.length && before === undefined) view.content.append(element('p', '아직 변경 이력이 없습니다.'));
      for (const version of result.versions || []) {
        const details = element('details', undefined, 'oa-shared-history-item');
        const summary = element('summary');
        const title = version.action === 'restore' ? `v${version.revision} · v${version.restoredFromRevision} 복원` : ['baseline', 'seed'].includes(version.action) ? `v${version.revision} · 초기 등록` : `v${version.revision} · ${version.changes?.length || 0}개 역할 변경`;
        summary.append(element('strong', title), element('span', `${version.actorEmail || '초기 등록'} · ${new Date(version.createdAt).toLocaleString('ko-KR')}`));
        details.append(summary);
        if (version.note) details.append(element('p', version.note, 'oa-shared-history-note'));
        if (version.changes?.length) details.append(changeTable(version.changes).node);
        const restore = button('이 버전으로 복원 검토', () => previewRestore(version.revision));
        restore.disabled = Number(version.revision) === Number(common.revision);
        details.append(restore); view.content.append(details);
      }
      view.footer.replaceChildren();
      if (result.nextBeforeRevision !== null && result.nextBeforeRevision !== undefined) view.footer.append(button('이전 이력 더 보기', () => showHistory(result.nextBeforeRevision, view)));
    } catch (error) { if (view.generation === dialogGeneration) loading.textContent = error.message; }
  }
  async function previewRestore(revision) {
    const view = modal(`v${revision} 복원 검토`, '복원은 현재 공용 데이터를 과거 값으로 바꾸는 새 버전으로 기록합니다.');
    const loading = element('p', '현재 공용본과 복원할 버전을 비교하고 있습니다.'); view.content.append(loading);
    try {
      const [latest, historical] = await Promise.all([request('/api/teams'), request(`/api/teams?revision=${encodeURIComponent(revision)}`)]);
      if (view.generation !== dialogGeneration || !dialog.open) return;
      loading.remove();
      const changes = changesBetween(latest.assignments, historical.assignments);
      view.desc.textContent = `최신 공용 v${latest.revision}에서 v${revision}의 값으로 ${changes.length}개 역할을 변경합니다. 이전 이력은 그대로 남습니다.${dirtyChanges().length ? ' 현재 미저장 수정본은 브라우저에 보관합니다.' : ''}`;
      view.content.append(changes.length ? changeTable(changes, { beforeLabel: `현재 v${latest.revision}`, afterLabel: `복원 v${revision}` }).node : element('p', '현재 공용본과 배정 내용이 같습니다.'));
      view.footer.append(button('취소', () => dialog.close()));
      if (changes.length) view.footer.append(button(`v${revision} 값으로 복원`, () => {
        try {
          archiveActive();
          rememberPending({ expectedRevision: latest.revision, restoreRevision: revision, requestId: crypto.randomUUID(), note: `v${revision}으로 복원` });
          retryPending();
        } catch (error) { status('수정본을 브라우저에 보관하지 못했습니다. HTML로 저장한 뒤 다시 시도해 주세요.', true); }
      }, 'oa-shared-primary'));
    } catch (error) { if (view.generation === dialogGeneration) loading.textContent = error.message; }
  }
  updateControls();
  loadLatest();
})();
