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
  function show(mode) {
    const visible = mode !== 'accounts';
    if (legacyApp) { legacyApp.hidden = !visible; legacyApp.setAttribute('aria-hidden', String(!visible)); }
    document.body.classList.toggle('oa-workspace-mode', !visible);
    document.body.classList.toggle('oa-workspace-legacy-mode', visible);
    if (visible) document.querySelector(`[data-view="${mode === 'analysis' ? 'lookthroughView' : 'mapView'}"]`)?.click();
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
      show('rm');
      // Do not hide an unassigned institution behind the legacy assigned-only scope.
      document.querySelector('[data-account-scope="all"]')?.click();
      if (typeof selectAccount === 'function') selectAccount(id);
      legacyApp?.scrollIntoView({ block: 'start' });
    },
  };
})();
