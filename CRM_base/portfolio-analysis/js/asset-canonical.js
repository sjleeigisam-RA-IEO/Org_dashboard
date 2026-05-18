(function () {
  const STORAGE_KEY = 'ra_asset_canonical_admin_v1';
  const ADMIN_KEY = 'ra_asset_canonical_admin_enabled';

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state || {}));
  }

  function isAdmin() {
    return sessionStorage.getItem(ADMIN_KEY) === '1';
  }

  function escapeSqlLike(value) {
    return String(value || '').replace(/[%_]/g, function (m) { return '\\' + m; });
  }

  function normalizeTerm(value) {
    return String(value || '').trim();
  }

  function buildOrFilter(columns, terms) {
    const parts = [];
    (columns || []).forEach(function (col) {
      (terms || []).forEach(function (term) {
        term = normalizeTerm(term);
        if (term) parts.push(col + '.ilike.%' + escapeSqlLike(term) + '%');
      });
    });
    return parts.join(',');
  }

  function uniqueBy(list, keyFn) {
    const seen = new Set();
    const result = [];
    (list || []).forEach(function (item) {
      const key = keyFn(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
    return result;
  }

  async function fetchAssetSummariesByIds(assetIds) {
    const ids = Array.from(new Set((assetIds || []).filter(Boolean)));
    if (!ids.length) return [];
    const response = await _supabase
      .from('asset_relationship_summary')
      .select('*')
      .in('asset_id', ids)
      .limit(200);
    if (response.error) throw response.error;
    return response.data || [];
  }

  async function searchCanonicalAssets(terms) {
    terms = (terms || []).map(normalizeTerm).filter(Boolean);
    if (!terms.length) return { data: [] };

    const summaryFilter = buildOrFilter(
      ['canonical_name', 'address_text', 'pnu', 'asset_code', 'main_usage'],
      terms
    );
    const aliasFilter = buildOrFilter(['alias_name'], terms);

    const [summaryRes, aliasRes] = await Promise.all([
      _supabase.from('asset_relationship_summary').select('*').or(summaryFilter).limit(100),
      _supabase.from('asset_aliases').select('asset_id, alias_name, alias_type, confidence').or(aliasFilter).limit(200)
    ]);

    if (summaryRes.error) throw summaryRes.error;
    if (aliasRes.error) throw aliasRes.error;

    const aliasRows = aliasRes.data || [];
    const aliasSummaries = await fetchAssetSummariesByIds(aliasRows.map(function (row) { return row.asset_id; }));
    const aliasesByAssetId = {};

    aliasRows.forEach(function (row) {
      aliasesByAssetId[row.asset_id] = aliasesByAssetId[row.asset_id] || [];
      if (!aliasesByAssetId[row.asset_id].some(function (a) { return a.alias_name === row.alias_name; })) {
        aliasesByAssetId[row.asset_id].push(row);
      }
    });

    const merged = uniqueBy((summaryRes.data || []).concat(aliasSummaries), function (row) { return row.asset_id; })
      .map(function (row) {
        return {
          ...row,
          matched_aliases: aliasesByAssetId[row.asset_id] || [],
          canonical_id: row.asset_id,
          confidence: row.review_status === 'verified' ? 1 : 0.95
        };
      })
      .sort(function (a, b) {
        const scoreA = (a.matched_aliases?.length || 0) * 5 + (a.fund_count || 0) + (a.project_count || 0);
        const scoreB = (b.matched_aliases?.length || 0) * 5 + (b.fund_count || 0) + (b.project_count || 0);
        return scoreB - scoreA;
      })
      .slice(0, 100);

    return { data: merged };
  }

  function adminLogin() {
    if (isAdmin()) {
      sessionStorage.removeItem(ADMIN_KEY);
      renderResults();
      return;
    }
    const password = window.prompt('관리자 비밀번호');
    if (password === 'admin') {
      sessionStorage.setItem(ADMIN_KEY, '1');
      renderResults();
    } else if (password !== null) {
      window.alert('비밀번호가 맞지 않습니다.');
    }
  }

  function clearOverrides() {
    if (!window.confirm('로컬 관리자 판단을 초기화할까요?')) return;
    localStorage.removeItem(STORAGE_KEY);
    if (typeof performSearch === 'function') performSearch(window.currentSearchQuery || '');
  }

  function renameGroup(assetId) {
    const title = window.prompt('대표 자산명', '');
    if (!title) return;
    const state = loadState();
    state.titleOverrides = state.titleOverrides || {};
    state.titleOverrides[assetId] = title.trim();
    saveState(state);
    if (typeof performSearch === 'function') performSearch(window.currentSearchQuery || '');
  }

  function renderAdminBar(container) {
    const bar = document.createElement('div');
    bar.className = 'asset-admin-bar';
    bar.innerHTML = `
      <button type="button" class="asset-admin-btn" onclick="AssetCanonical.adminLogin()">${isAdmin() ? '관리자 종료' : '관리자'}</button>
      ${isAdmin() ? '<button type="button" class="asset-admin-btn secondary" onclick="AssetCanonical.clearOverrides()">표시 초기화</button>' : ''}
    `;
    container.appendChild(bar);
  }

  function getDisplayName(group) {
    const state = loadState();
    return state.titleOverrides?.[group.asset_id] || group.canonical_name || group.asset_id;
  }

  function formatArea(value) {
    if (!value) return '-';
    return Number(value).toLocaleString() + '㎡ (' + (Number(value) * 0.3025).toFixed(2) + 'py)';
  }

  function formatAmount(value) {
    if (!value) return '-';
    return window.formatNumber ? window.formatNumber(value) : Number(value).toLocaleString();
  }

  function sumRows(rows, key) {
    return (rows || []).reduce(function (acc, row) {
      return acc + (Number(row[key]) || 0);
    }, 0);
  }

  function groupExposureRows(rows, nameKey, amountKeys) {
    const groups = {};
    (rows || []).forEach(function (row) {
      const name = row[nameKey] || '미분류';
      groups[name] = groups[name] || { name: name, row_count: 0 };
      groups[name].row_count += 1;
      amountKeys.forEach(function (key) {
        groups[name][key] = (groups[name][key] || 0) + (Number(row[key]) || 0);
      });
    });
    return Object.values(groups).sort(function (a, b) {
      const key = amountKeys[0];
      return (b[key] || 0) - (a[key] || 0);
    });
  }

  function isFundVehicleBeneficiary(row) {
    const name = String(row?.beneficiary_clean || row?.beneficiary_raw || '');
    const category = String(row?.beneficiary_cat || '');
    if (category === '펀드') return true;
    return /이지스.*(투자신탁|투자회사|리츠|펀드)/.test(name);
  }

  function normalizeVehicleName(value) {
    return String(value || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, '')
      .replace(/제/g, '')
      .replace(/의1호/g, '호')
      .trim();
  }

  function findLookThroughFunds(vehicleRow, funds) {
    const vehicleName = normalizeVehicleName(vehicleRow?.beneficiary_clean || vehicleRow?.beneficiary_raw);
    if (!vehicleName) return [];
    return (funds || []).filter(function (fund) {
      const fundName = normalizeVehicleName(fund.fund_name || fund.short_name || '');
      return fundName && (fundName.includes(vehicleName) || vehicleName.includes(fundName));
    });
  }

  function renderCanonicalAssetCards(groups, container) {
    renderAdminBar(container);
    if (!groups || !groups.length) return;

    groups.forEach(function (group) {
      const assetId = group.asset_id || group.canonical_id;
      const displayName = getDisplayName(group);
      const aliases = (group.matched_aliases || []).map(function (alias) { return alias.alias_name; }).slice(0, 4);
      const totalLinks = (group.fund_count || 0) + (group.project_count || 0);
      const card = document.createElement('div');
      card.className = 'group-card canonical-asset-card';

      const adminControls = isAdmin() ? `
        <div class="asset-admin-controls" onclick="event.stopPropagation()">
          <button type="button" onclick="AssetCanonical.renameGroup('${assetId.replace(/'/g, "\\'")}')">표시명 변경</button>
        </div>
      ` : '';

      card.innerHTML = `
        <div class="group-header">
          <input type="checkbox" class="card-checkbox" onclick="toggleBasket(event, 'asset', '${assetId.replace(/'/g, "\\'")}', [])">
          <div style="flex:1">
            <span class="card-tag tag-asset">ASSET</span>
            <div class="group-title">${displayName}</div>
            <div class="canonical-meta">
              ${group.address_text || '-'}
              ${aliases.length ? ' | 별칭: ' + aliases.join(', ') : ''}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${totalLinks ? `<span class="canonical-count">펀드 ${group.fund_count || 0} / 프로젝트 ${group.project_count || 0}</span>` : ''}
            <div class="toggle-icon">›</div>
          </div>
        </div>
        ${adminControls}
      `;

      card.querySelector('.group-header').addEventListener('click', function (event) {
        if (event.target.type === 'checkbox') return;
        renderCanonicalAssetDetail(assetId, displayName);
      });
      container.appendChild(card);
    });
  }

  async function renderCanonicalAssetDetail(assetId, displayName) {
    if (!assetId) return;
    detailPanel.innerHTML = '<div class="no-results">자산 상세 로딩 중...</div>';

    try {
      const [assetRes, ledgerRes, fundRelRes, projectRelRes, lenderRes, benRes] = await Promise.all([
        _supabase.from('asset_master').select('*').eq('asset_id', assetId).single(),
        _supabase.from('asset_building_ledger').select('*').eq('asset_id', assetId).maybeSingle(),
        _supabase.from('fund_asset_relationships').select('*').eq('asset_id', assetId).limit(200),
        _supabase.from('project_asset_relationships').select('*').eq('asset_id', assetId).limit(200),
        _supabase.from('lender_exposures').select('*, funds(*)').eq('asset_id', assetId).limit(200),
        _supabase.from('beneficiary_exposures').select('*, funds(*)').eq('asset_id', assetId).limit(200)
      ]);

      [assetRes, ledgerRes, fundRelRes, projectRelRes, lenderRes, benRes].forEach(function (res) {
        if (res.error) throw res.error;
      });

      const asset = assetRes.data || {};
      const ledger = ledgerRes.data || {};
      const rawFunds = fundRelRes.data || [];
      const rawProjects = projectRelRes.data || [];

      // Bulk fetch detailed profiles from v_funds_enriched
      const linkFundIds = rawFunds.map(f => f.fund_id);
      const linkProjIds = rawProjects.map(p => p.project_id);
      const uniqueTargetIds = Array.from(new Set([...linkFundIds, ...linkProjIds])).filter(Boolean);
      
      let enrichedDetails = [];
      if (uniqueTargetIds.length > 0) {
        try {
          const enrichedRes = await _supabase.from('v_funds_enriched').select('*').in('fund_id', uniqueTargetIds);
          if (!enrichedRes.error && enrichedRes.data) {
            enrichedDetails = enrichedRes.data;
          }
        } catch (e) {
          console.error("Bulk enriched details fetch error:", e);
        }
      }

      // Map enriched fields onto our relationships
      const funds = rawFunds.map(f => {
        const enriched = enrichedDetails.find(ed => ed.fund_id === f.fund_id);
        return enriched ? { ...enriched, relation_type: f.relation_type } : f;
      });

      const projects = rawProjects.map(p => {
        const enriched = enrichedDetails.find(ed => ed.fund_id === p.project_id);
        return enriched ? { ...enriched, relation_type: p.relation_type, project_name: p.project_name } : p;
      });

      const lenders = lenderRes.data || [];
      const beneficiaries = benRes.data || [];
      const externalBeneficiaries = beneficiaries.filter(function (row) { return !isFundVehicleBeneficiary(row); });
      const internalBeneficiaries = beneficiaries.filter(isFundVehicleBeneficiary);
      const lenderGroups = groupExposureRows(lenders, 'lender_clean', ['committed_amt', 'drawn_amt', 'remaining_amt']);
      const beneficiaryGroups = groupExposureRows(externalBeneficiaries, 'beneficiary_clean', ['committed_amt', 'invested_amt', 'remaining_amt']);
      const lenderCommitted = sumRows(lenders, 'committed_amt');
      const lenderDrawn = sumRows(lenders, 'drawn_amt');
      const beneficiaryCommitted = sumRows(beneficiaries, 'committed_amt');
      const beneficiaryInvested = sumRows(beneficiaries, 'invested_amt');
      const directBeneficiaryCommitted = sumRows(externalBeneficiaries, 'committed_amt');
      const directBeneficiaryInvested = sumRows(externalBeneficiaries, 'invested_amt');
      const mapId = 'vmap-' + Math.random().toString(36).substr(2, 9);

      window.AssetCanonical._lastDetailData = {
        assetId: assetId,
        funds: funds,
        projects: projects,
        allBeneficiaries: beneficiaries,
        internalBeneficiaries: internalBeneficiaries
      };

      const adminRelationshipSections = isAdmin() ? `
        <div class="detail-section">
          <div class="section-title">연결 펀드 (${funds.length})</div>
          <table class="data-table">
            <thead><tr><th>펀드코드</th><th>펀드명</th><th>상태</th><th>관계</th></tr></thead>
            <tbody>${funds.map(function (f) {
              return `<tr><td>${f.fund_id}</td><td style="font-weight:700">${f.fund_name || f.short_name || '-'}</td><td>${f.fund_status || '-'}</td><td>${f.relation_type || '-'}</td></tr>`;
            }).join('') || '<tr><td colspan="4">연결 펀드 없음</td></tr>'}</tbody>
          </table>
        </div>

        <div class="detail-section">
          <div class="section-title">연결 프로젝트 (${projects.length})</div>
          <table class="data-table">
            <thead><tr><th>프로젝트 ID</th><th>프로젝트명</th><th>상태</th><th>관계</th></tr></thead>
            <tbody>${projects.map(function (p) {
              return `<tr><td>${p.project_id}</td><td style="font-weight:700">${p.project_name || '-'}</td><td>${p.project_status || '-'}</td><td>${p.relation_type || '-'}</td></tr>`;
            }).join('') || '<tr><td colspan="4">연결 프로젝트 없음</td></tr>'}</tbody>
          </table>
        </div>
      ` : '';

      detailPanel.innerHTML = `
        <div class="detail-header">
          <span class="card-tag tag-asset">CANONICAL ASSET</span>
          <h2 style="margin-bottom:4px;">${displayName || asset.canonical_name || assetId}</h2>
          <div style="color:var(--muted); font-size:16px;">
            ${asset.asset_id || assetId} | ${asset.asset_code || '-'} | ${asset.pnu || '-'} | ${asset.review_status || '-'}
          </div>
        </div>

        <div class="detail-section">
          <div class="section-title">자산 상세 (Asset Specs)</div>
          <div class="asset-specs-grid">
            <table class="data-table profile-table">
              <tr><th>주소 <small>Address</small></th><td>${asset.address_text || '-'}</td></tr>
              <tr><th>대지면적 <small>Site Area</small></th><td>${formatArea(asset.site_area || ledger.site_area)}</td></tr>
              <tr><th>연면적 <small>GFA</small></th><td>${formatArea(asset.gross_floor_area || ledger.gross_floor_area)}</td></tr>
              <tr><th>건폐율/용적률 <small>SCR/FAR</small></th><td>${asset.scr || ledger.scr || '-'}% / ${asset.far || ledger.far || '-'}%</td></tr>
              <tr><th>주용도 <small>Usage</small></th><td>${asset.main_usage || ledger.main_usage || '-'}</td></tr>
              <tr><th>층수 <small>Floors</small></th><td>B${asset.floors_down || ledger.floors_down || '-'} / ${asset.floors_up || ledger.floors_up || '-'}F</td></tr>
              <tr><th>건축구조 <small>Structure</small></th><td>${asset.structure || ledger.structure || '-'}</td></tr>
              <tr><th>주차 <small>Parking</small></th><td>${asset.parking || ledger.parking || '-'}</td></tr>
              <tr><th>준공일 <small>Completion</small></th><td>${asset.completion_date || ledger.completion_date || '-'}</td></tr>
              <tr><th>원천 <small>Source</small></th><td>${asset.building_ledger_source || ledger.source_table || '-'}</td></tr>
            </table>
            <div id="${mapId}" class="vmap-container" style="min-height:500px; border-radius:20px; border:1px solid var(--line);"></div>
          </div>
        </div>

        <div class="detail-section">
          <div class="section-title">재원 구성 요약</div>
          <table class="data-table">
            <tr><th>대주 약정</th><td>${formatAmount(lenderCommitted)}</td><th>대주 실행</th><td>${formatAmount(lenderDrawn)}</td></tr>
            <tr><th>수익자 원천 약정</th><td>${formatAmount(beneficiaryCommitted)}</td><th>수익자 원천 납입</th><td>${formatAmount(beneficiaryInvested)}</td></tr>
            <tr><th>직접 투자자 약정</th><td>${formatAmount(directBeneficiaryCommitted)}</td><th>직접 투자자 납입</th><td>${formatAmount(directBeneficiaryInvested)}</td></tr>
            <tr><th>대주 row</th><td>${lenders.length}</td><th>수익자 row</th><td>${beneficiaries.length}</td></tr>
          </table>
        </div>

        <div class="detail-section">
          <div class="section-title">투자자 현황 (${beneficiaryGroups.length + internalBeneficiaries.length})</div>
          <table class="data-table">
            <thead><tr><th>투자자</th><th>구분</th><th>약정금액</th><th>납입금액</th><th>잔여금액</th><th></th></tr></thead>
            <tbody>
              ${beneficiaryGroups.map(function (b) {
                return `<tr><td style="font-weight:700">${b.name}</td><td>직접</td><td>${formatAmount(b.committed_amt)}</td><td>${formatAmount(b.invested_amt)}</td><td>${formatAmount(b.remaining_amt)}</td><td>${b.row_count > 1 ? b.row_count + '건' : ''}</td></tr>`;
              }).join('')}
              ${internalBeneficiaries.map(function (row, index) {
                return `<tr class="vehicle-beneficiary-row"><td style="font-weight:800">${row.beneficiary_clean || row.beneficiary_raw || '-'}</td><td><span class="vehicle-badge">펀드 비히클</span></td><td>${formatAmount(row.committed_amt)}</td><td>${formatAmount(row.invested_amt)}</td><td>${formatAmount(row.remaining_amt)}</td><td><button type="button" class="lookthrough-btn" onclick="AssetCanonical.renderLookThroughModal(${index})">구성 보기</button></td></tr>`;
              }).join('')}
              ${beneficiaryGroups.length || internalBeneficiaries.length ? '' : '<tr><td colspan="6">투자자 정보 없음</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="detail-section">
          <div class="section-title">대주 현황 (${lenderGroups.length})</div>
          <table class="data-table">
            <thead><tr><th>대주</th><th>약정금액</th><th>실행금액</th><th>잔여금액</th><th>비고</th></tr></thead>
            <tbody>${lenderGroups.map(function (l) {
              return `<tr><td style="font-weight:700">${l.name}</td><td>${formatAmount(l.committed_amt)}</td><td>${formatAmount(l.drawn_amt)}</td><td>${formatAmount(l.remaining_amt)}</td><td>${l.row_count > 1 ? l.row_count + '건' : ''}</td></tr>`;
            }).join('') || '<tr><td colspan="5">대주 정보 없음</td></tr>'}</tbody>
          </table>
        </div>

        ${adminRelationshipSections}
      `;

      renderMap(mapId, asset);

      // Trigger side drawer with child funds and projects list
      if (window.openAssetDrawer) {
        window.openAssetDrawer(assetId, displayName);
      }
    } catch (e) {
      console.error(e);
      detailPanel.innerHTML = '<div class="no-results">자산 상세 정보를 불러오지 못했습니다.</div>';
    }
  }

  async function renderLookThroughModal(vehicleIndex) {
    const data = window.AssetCanonical._lastDetailData;
    if (!data) return;
    const vehicle = data.internalBeneficiaries[vehicleIndex];
    if (!vehicle) return;

    const matchedFunds = findLookThroughFunds(vehicle, data.funds);
    const matchedFundIds = new Set(matchedFunds.map(function (fund) { return fund.fund_id; }));
    let sourceBeneficiaries = data.allBeneficiaries || [];

    if (matchedFunds.length && _supabase) {
      const childRes = await _supabase
        .from('beneficiary_exposures')
        .select('*')
        .in('fund_id', matchedFunds.map(function (fund) { return fund.fund_id; }));
      if (!childRes.error && childRes.data) {
        sourceBeneficiaries = uniqueBy(sourceBeneficiaries.concat(childRes.data), function (row) {
          return row.id || [row.fund_id, row.beneficiary_clean, row.committed_amt, row.invested_amt].join('|');
        });
      }
    }

    const childBeneficiaries = sourceBeneficiaries.filter(function (row) {
      return matchedFundIds.has(row.fund_id) && row.id !== vehicle.id;
    });
    const externalChildren = childBeneficiaries.filter(function (row) { return !isFundVehicleBeneficiary(row); });

    closeLookThroughModal();
    const modal = document.createElement('div');
    modal.id = 'assetLookthroughModal';
    modal.className = 'asset-modal-overlay';
    modal.innerHTML = `
      <div class="asset-modal">
        <div class="asset-modal-header">
          <div>
            <div class="card-tag tag-ben">LOOK-THROUGH</div>
            <h3>${vehicle.beneficiary_clean || vehicle.beneficiary_raw || '펀드 비히클'}</h3>
            <p>원천 데이터에서 이 수익자는 최종 투자자가 아니라 펀드/재간접 비히클로 분류됩니다.</p>
          </div>
          <button type="button" class="asset-modal-close" onclick="AssetCanonical.closeLookThroughModal()">×</button>
        </div>
        <div class="asset-modal-body">
          <div class="asset-modal-summary">
            <div><span>약정금액</span><strong>${formatAmount(vehicle.committed_amt)}</strong></div>
            <div><span>납입금액</span><strong>${formatAmount(vehicle.invested_amt)}</strong></div>
            <div><span>매칭 펀드</span><strong>${matchedFunds.length}건</strong></div>
            <div><span>하위 수익자</span><strong>${externalChildren.length}건</strong></div>
          </div>

          <h4>매칭된 펀드/클래스</h4>
          <table class="data-table">
            <thead><tr><th>펀드코드</th><th>펀드명</th><th>상태</th><th>관계</th></tr></thead>
            <tbody>${matchedFunds.map(function (fund) {
              return `<tr><td>${fund.fund_id}</td><td style="font-weight:700">${fund.fund_name || '-'}</td><td>${fund.fund_status || '-'}</td><td>${fund.relation_type || '-'}</td></tr>`;
            }).join('') || '<tr><td colspan="4">매칭된 펀드가 없습니다.</td></tr>'}</tbody>
          </table>

          <h4>하위 최종 수익자 원천</h4>
          <table class="data-table">
            <thead><tr><th>수익자</th><th>펀드코드</th><th>약정금액</th><th>납입금액</th></tr></thead>
            <tbody>${externalChildren.map(function (row) {
              return `<tr><td style="font-weight:700">${row.beneficiary_clean || row.beneficiary_raw || '-'}</td><td>${row.fund_id || '-'}</td><td>${formatAmount(row.committed_amt)}</td><td>${formatAmount(row.invested_amt)}</td></tr>`;
            }).join('') || '<tr><td colspan="4">현재 DB 원천에는 이 비히클의 최종 수익자 정보가 없습니다.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeLookThroughModal();
    });
    document.body.appendChild(modal);
  }

  function closeLookThroughModal() {
    const modal = document.getElementById('assetLookthroughModal');
    if (modal) modal.remove();
  }

  function renderMap(mapId, asset) {
    if (!(asset.longitude && asset.latitude)) {
      const el = document.getElementById(mapId);
      if (el) el.innerHTML = '<div style="padding:40px; color:var(--muted); text-align:center;">좌표 정보가 없어 지도를 표시할 수 없습니다.</div>';
      return;
    }

    setTimeout(function () {
      try {
        if (typeof vw === 'undefined' || !vw.ol3 || typeof ol === 'undefined') return;
        const vmap = new vw.ol3.Map(mapId, {
          basemapType: vw.ol3.BasemapType.GRAPHIC,
          controlDensity: vw.ol3.DensityType.EMPTY,
          interactionDensity: vw.ol3.DensityType.BASIC,
          homePosition: vw.ol3.CameraPosition,
          initPosition: vw.ol3.CameraPosition
        });
        const lon = parseFloat(asset.longitude);
        const lat = parseFloat(asset.latitude);
        vmap.getView().setCenter(ol.proj.fromLonLat([lon, lat]));
        vmap.getView().setZoom(17);
        const markerLayer = new vw.ol3.layer.Marker(vmap);
        vmap.addLayer(markerLayer);
        markerLayer.addMarker({
          x: lon,
          y: lat,
          epsg: 'EPSG:4326',
          title: asset.canonical_name || '위치',
          iconUrl: 'https://map.vworld.kr/images/ol3/marker_blue.png'
        });
      } catch (e) {
        console.error('VWorld Map Error:', e);
      }
    }, 300);
  }

  window.AssetCanonical = {
    searchCanonicalAssets,
    renderCanonicalAssetCards,
    renderCanonicalAssetDetail,
    renderLookThroughModal,
    closeLookThroughModal,
    adminLogin,
    clearOverrides,
    renameGroup,
    isAdmin
  };
})();
