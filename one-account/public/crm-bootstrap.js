'use strict';
(function () {
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
  function normalizedAccount(row) {
    if (!row || !idPattern.test(row.account_id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 300) throw new Error('INVALID_CRM_ACCOUNT');
    const codes = ['P','I','S','C','F','H'].includes(row.piscfh) ? [row.piscfh] : [];
    const names = [row.name, ...(Array.isArray(row.aliases) ? row.aliases.map(v => typeof v === 'string' ? v : v?.name) : [])];
    const aliases = [...new Set(names.filter(v => typeof v === 'string' && v.length <= 300))].map(name => ({ name, role: 'CRM', source: 'contact_registry' }));
    return {
      account_id: row.account_id, display_name: row.name, group_name: '',
      category: row.is_placeholder ? '소속 확인 필요' : codes.length ? '고객정보 등록기관' : '미분류',
      roles: [], role_summary: [], aliases, validation_status: 'RAW_ONLY',
      identity_evidence_types: [], identity_conflicts: [], lender_amount: null, investor_amount: null, priority_amount: null,
      metrics: { role_count: 0, exposure_count: 0, fund_count: 0, asset_count: 0, total_primary_amount: null, priority_amount: null },
      team: { primary: null, backup: null, sponsor: null, steward: null, status: 'UNASSIGNED' },
      capital_conditions: { equity: false, loan: false },
      piscfh: { default_candidate_codes: codes, active_default_codes: codes, case_roles: [], link_status: 'CRM_SOURCE_REPORTED', assignment_status: 'SOURCE_REPORTED', team_draft: {}, classification: { code: codes[0] || null, rule: 'CRM_IMPORTED_ACCOUNT', confidence: 'SOURCE_REPORTED' } },
      merged_from_account_ids: [row.account_id], entity_resolution_status: 'CRM_SOURCE_REPORTED',
      delegated_relationship_summary: { relationship_count: 0, fund_group_count: 0, beneficiary_commitment: null, paid_in_availability: 'NOT_PROVIDED_BY_SOURCE' },
      crm_only: true, crm_account_id: row.contact_account_id || row.account_id,
      crm_people_count: Number.isSafeInteger(row.people_count) && row.people_count >= 0 ? row.people_count : 0,
    };
  }
  function mergeCatalog(catalog, accounts, accountMap) {
    if (!catalog || !Array.isArray(catalog.accounts) || catalog.accounts.length > 5000) throw new Error('INVALID_CRM_CATALOG');
    const prepared = catalog.accounts.map(normalizedAccount);
    if (new Set(prepared.map(a => a.account_id)).size !== prepared.length) throw new Error('DUPLICATE_CRM_ACCOUNT');
    let added = 0;
    for (const row of prepared) {
      const existing = accountMap.get(row.account_id);
      if (existing) {
        // The financial relationship graph and original RM identity stay intact.
        existing.crm_account_id = row.crm_account_id;
        existing.crm_people_count = row.crm_people_count;
      } else {
        accounts.push(row); accountMap.set(row.account_id, row); added++;
      }
    }
    return added;
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { normalizedAccount, mergeCatalog }; return; }
  if (!/^https?:$/.test(location.protocol) || typeof D === 'undefined' || typeof accountsById === 'undefined') return;

  function loadScript(src, id, shared) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src; script.id = id;
      script.setAttribute(shared ? 'data-one-account-shared' : 'data-one-account-crm', '');
      script.onload = resolve; script.onerror = () => reject(new Error('ADAPTER_LOAD_FAILED'));
      document.body.append(script);
    });
  }
  function showUnavailable() {
    const banner = document.createElement('section');
    banner.setAttribute('data-one-account-crm', '');
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'padding:12px 20px;background:#fff2d4;color:#694b13;font:14px sans-serif';
    banner.textContent = '소속 인물 DB 연결을 확인하지 못했습니다. 새로고침하여 다시 불러와 주세요.';
    document.querySelector('.topbar')?.insertAdjacentElement('afterend', banner);
  }
  function protectOfflineCopy() {
    if (typeof buildSharedHtml !== 'function') return;
    const previous = buildSharedHtml;
    buildSharedHtml = function (snapshotId) {
      const parsed = new DOMParser().parseFromString(previous(snapshotId), 'text/html');
      parsed.querySelectorAll('[data-one-account-crm]').forEach(node => node.remove());
      // Only institution metadata joins the offline copy. People remain in the API.
      const embedded = parsed.querySelector('#embedded-data');
      if (embedded) embedded.textContent = JSON.stringify(D).replace(/</g, '\\u003c');
      return '<!doctype html>\n' + parsed.documentElement.outerHTML;
    };
  }
  window.ONE_ACCOUNT_CRM_BOOTSTRAP_PROMISE = (async () => {
    let catalog = null;
    try {
      const response = await fetch('/api/crm?action=catalog', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('CRM_UNAVAILABLE');
      catalog = await response.json();
      mergeCatalog(catalog, D.accounts, accountsById);
      if (typeof roleLabel !== 'undefined') roleLabel.CRM = '고객정보 원본';
      if (typeof loadTeamAssignments === 'function') teamAssignments = loadTeamAssignments();
      window.ONE_ACCOUNT_CRM_INITIAL_CATALOG = catalog;
      if (typeof renderKpis === 'function') renderKpis();
      if (typeof renderList === 'function') renderList();
      if (typeof renderSelection === 'function') renderSelection();
      window.dispatchEvent(new CustomEvent('oa:crm-ready', { detail: catalog }));
    } catch { showUnavailable(); }
    // Catalog expansion must precede RM validation, including recovery drafts.
    await loadScript('/shared-teams.js', 'oa-shared-adapter', true);
    await loadScript('/crm.js', 'oa-crm-adapter', false);
    protectOfflineCopy();
    return catalog;
  })().catch(() => { showUnavailable(); return null; });
})();
