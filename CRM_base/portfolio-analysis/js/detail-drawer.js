(function () {
  window.closeDrawer = () => {
    document.getElementById('sideDrawer').classList.remove('active');
    document.getElementById('sideDrawerOverlay').classList.remove('active');
    document.getElementById('drawerNav').style.display = 'none';
  };

  window.openFundDetail = (groupKey, groupName) => {
    if (!groupKey || String(groupKey).trim() === '' || groupKey === 'undefined' || groupKey === 'null') return;
    const allFunds = window.lastTargetFunds || lastTargetFunds || [];
    const filtered = allFunds.filter(f => {
      if (currentOrgScope === 'ra' && !isRAFund(f)) return false;
      const rawName = f.fund_name || '';
      const pnu = window.fundToPnu?.[f.fund_id];
      let cleanName = String(rawName).split('(')[0].trim().replace(/[- ]제?\d+호$/, '호');
      const parentId = f.parent_fund_id || null;
      const validPnu = isValidKey(pnu) ? pnu : null;
      const key = parentId || validPnu || cleanName;
      return String(key).trim() === String(groupKey).trim();
    });

    currentDrawerData = { key: groupKey, name: groupName, items: filtered };
    renderDrawerList();
  };

  function renderDrawerList() {
    const header = document.getElementById('drawerHeader');
    const content = document.getElementById('drawerContent');
    const nav = document.getElementById('drawerNav');
    const { key, name, items } = currentDrawerData;

    nav.style.display = 'none';
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
                <p style="color:var(--accent); font-size:12px; font-weight:800; margin-bottom:8px; letter-spacing:1px;">ASSET DEEP-DIVE</p>
                <h2 style="font-size:24px; font-weight:800; line-height:1.3;">${name}</h2>
                <p style="margin-top:12px; color:var(--muted); font-size:14px;">총 ${items.length}개의 관련 펀드가 검색되었습니다.</p>
            </div>
        </div>
    `;

    content.innerHTML = items.map(f => {
      const aumMetric = getAumBasisMetric();
      const aum = getFundAmountWon(f, getMetricColumn('aum', aumMetric));
      const aumLabel = getAumMetricConfig(aumMetric).shortLabel;
      return `
            <div class="fund-detail-card" onclick="showDrawerDetail('${f.fund_id}')" style="cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3 style="font-size:16px; font-weight:800; flex:1; margin-right:16px;">${f.fund_name}</h3>
                    <span style="padding:4px 10px; border-radius:8px; font-size:11px; font-weight:800; background:#f1f5f9; color:#475569;">${getFundStatus(f)}</span>
                </div>
                <div class="meta-grid">
                    <div class="meta-item"><span class="meta-label">운용규모(AUM, ${aumLabel})</span><span class="meta-val">${formatNumber(aum)}</span></div>
                    <div class="meta-item"><span class="meta-label">담당부서</span><span class="meta-val">${getFieldValue(f, 'department') || '-'}</span></div>
                    <div class="meta-item"><span class="meta-label">설정일</span><span class="meta-val">${getFieldValue(f, 'setup_date') || '-'}</span></div>
                    <div class="meta-item"><span class="meta-label">만기/청산일</span><span class="meta-val">${f.maturity_date || '-'}</span></div>
                </div>
            </div>
        `;
    }).join('');
    document.getElementById('sideDrawer').classList.add('active');
    document.getElementById('sideDrawerOverlay').classList.add('active');
  }

  window.showDrawerDetail = async (fundId) => {
    const content = document.getElementById('drawerContent');
    const header = document.getElementById('drawerHeader');
    const nav = document.getElementById('drawerNav');

    nav.style.display = 'block';
    header.innerHTML = '<div style="padding-left:180px; padding-top:15px;"><p style="color:var(--accent); font-weight:800; font-size:12px; letter-spacing:1px; margin:0;">LOADING DETAIL...</p></div>';
    content.innerHTML = '<div style="padding:100px; text-align:center; color:var(--muted);">데이터를 불러오고 있습니다...</div>';

    let fund = (window.lastTargetFunds || []).find(f => f.fund_id === fundId);
    if (!fund && window.AssetCanonical?._lastDetailData) {
      const activeData = window.AssetCanonical._lastDetailData;
      const combined = [...(activeData.funds || []), ...(activeData.projects || [])];
      fund = combined.find(item => item.fund_id === fundId || item.project_id === fundId);
    }
    if (!fund && window.allFunds) {
      fund = window.allFunds.find(f => f.fund_id === fundId);
    }
    if (!fund && typeof _supabase !== 'undefined') {
      try {
        const fallbackRes = await _supabase.from('v_funds_enriched').select('*').eq('fund_id', fundId).maybeSingle();
        if (fallbackRes.data) {
          fund = fallbackRes.data;
        }
      } catch (e) {
        console.error("Dynamic single fund details load error:", e);
      }
    }
    if (!fund) {
      content.innerHTML = '<div style="padding:100px; text-align:center; color:var(--muted);">펀드 정보를 찾을 수 없습니다.</div>';
      return;
    }

    try {
      await showDetail({ type: 'fund', items: [fund], targetName: fund.fund_name }, content);
    } catch (e) {
      console.error(e);
      content.innerHTML = '<div style="padding:100px; text-align:center; color:#ef4444;">상세 정보를 불러오는 중 오류가 발생했습니다.</div>';
    }

    header.style.padding = '0';
    header.style.border = 'none';
  };

  function openDrawerShell(label, title, subtitle) {
    const header = document.getElementById('drawerHeader');
    const content = document.getElementById('drawerContent');
    const nav = document.getElementById('drawerNav');

    nav.style.display = 'none';
    header.style.padding = '40px 40px 30px';
    header.style.borderBottom = '1px solid #e2e8f0';
    header.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <p style="color:var(--accent); font-size:12px; font-weight:800; margin-bottom:8px; letter-spacing:1px;">${label}</p>
          <h2 style="font-size:22px; font-weight:800; line-height:1.3;">${title || '-'}</h2>
          ${subtitle ? `<p style="margin-top:12px; color:var(--muted); font-size:14px;">${subtitle}</p>` : ''}
        </div>
      </div>
    `;
    content.innerHTML = '<div class="no-results">관계 정보를 불러오는 중...</div>';
    document.getElementById('sideDrawer').classList.add('active');
    document.getElementById('sideDrawerOverlay').classList.add('active');
    return { header, content, nav };
  }

  function assetListCard(row, caption) {
    const assetName = row.canonical_name || row.asset_name || row.asset_id || '-';
    const address = row.address_text || row.address || '-';
    const pnu = row.pnu || row.metadata?.pnu || '';
    const relation = row.relation_type || '';
    const assetId = row.asset_id || '';
    return `
      <div class="fund-detail-card" onclick="AssetCanonical.renderCanonicalAssetDetail('${assetId}', '${String(assetName).replace(/'/g, "\\'")}')" style="cursor:pointer; margin-bottom:12px; border-left:4px solid var(--accent);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
          <h3 style="font-size:15px; font-weight:800; flex:1; margin:0;">${assetName}</h3>
          <span style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:800; background:#f1f5f9; color:#475569;">${relation || caption || 'asset'}</span>
        </div>
        <div class="meta-grid" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; margin-top:12px;">
          <div class="meta-item"><span class="meta-label">주소</span><span class="meta-val">${address}</span></div>
          <div class="meta-item"><span class="meta-label">PNU</span><span class="meta-val">${pnu || '-'}</span></div>
        </div>
      </div>
    `;
  }

  function fundListCard(row, caption) {
    const fundId = row.fund_id || row.project_id || '';
    const fundName = row.project_mission_name || row.fund_name || row.project_name || row.short_name || fundId || '-';
    const status = row.fund_status || row.project_status || row.status || '-';
    const relation = row.relation_type || caption || '';
    return `
      <div class="fund-detail-card" onclick="openFundRelationshipDrawer('${fundId}', '${String(fundName).replace(/'/g, "\\'")}')" style="cursor:pointer; margin-bottom:12px; border-left:4px solid #10b981;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
          <h3 style="font-size:15px; font-weight:800; flex:1; margin:0;">${fundName}</h3>
          <span style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:800; background:rgba(16,185,129,0.1); color:#059669;">${relation || 'fund'}</span>
        </div>
        <div class="meta-grid" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; margin-top:12px;">
          <div class="meta-item"><span class="meta-label">ID</span><span class="meta-val">${fundId || '-'}</span></div>
          <div class="meta-item"><span class="meta-label">상태</span><span class="meta-val">${status}</span></div>
        </div>
      </div>
    `;
  }

  function relationDisplayKey(row) {
    return row.pnu || row.asset_id || row.canonical_name || row.asset_name || '';
  }

  function dedupeAssetRelationshipRows(rows) {
    const priority = { asset_location_merge_plan: 0, fund_assets: 1 };
    const best = {};
    (rows || []).forEach(function (row) {
      const key = relationDisplayKey(row);
      if (!key) return;
      const prev = best[key];
      if (!prev || (priority[row.source_table] ?? 9) < (priority[prev.source_table] ?? 9)) {
        best[key] = row;
      }
    });
    return Object.values(best).sort(function (a, b) {
      const sourceScore = (priority[a.source_table] ?? 9) - (priority[b.source_table] ?? 9);
      if (sourceScore !== 0) return sourceScore;
      return String(a.canonical_name || '').localeCompare(String(b.canonical_name || ''), 'ko');
    });
  }

  function escapeDrawerArg(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function amountValue(row, key) {
    const value = row && row[key];
    if (typeof value === 'number') return value;
    const parsed = Number(String(value || '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  window.openInstitutionRelationshipDrawer = async (type, name, items) => {
    if (!name) return;
    const isLender = type === 'lender';
    const label = isLender ? 'LENDER SELECTED' : 'BENEFICIARY SELECTED';
    const roleLabel = isLender ? '대주' : '수익자';
    const amountKey = isLender ? 'committed_amt' : 'invested_amt';
    const sourceItems = items || [];
    const fundIds = Array.from(new Set(sourceItems.map(function (row) { return row.fund_id; }).filter(Boolean)));
    const shell = openDrawerShell(label, name, `${roleLabel}가 연결된 펀드/비히클과 기초자산을 함께 확인하세요.`);

    try {
      let fundRows = sourceItems.map(function (row) { return row.funds; }).filter(Boolean);
      let assetRows = [];

      if (fundIds.length > 0) {
        const [fundRes, assetRes] = await Promise.all([
          _supabase.from('v_funds_enriched').select('*').in('fund_id', fundIds).limit(500),
          _supabase.from('fund_asset_relationships').select('*').in('fund_id', fundIds).limit(1000)
        ]);
        [fundRes, assetRes].forEach(function (res) {
          if (res.error) throw res.error;
        });
        const fundById = {};
        fundRows.concat(fundRes.data || []).forEach(function (fund) {
          if (fund && fund.fund_id) fundById[fund.fund_id] = fund;
        });
        fundRows = fundIds.map(function (fundId) {
          return fundById[fundId] || { fund_id: fundId, fund_name: fundId };
        });
        assetRows = dedupeAssetRelationshipRows(assetRes.data || []);
      }

      const totalAmount = sourceItems.reduce(function (acc, row) {
        return acc + amountValue(row, amountKey);
      }, 0);
      const sortedItems = sourceItems.slice().sort(function (a, b) {
        const aDate = a.drawdown_date || a.start_date || a.invested_date || '';
        const bDate = b.drawdown_date || b.start_date || b.invested_date || '';
        return String(bDate).localeCompare(String(aDate));
      });

      shell.header.querySelector('p').textContent = label;
      shell.header.querySelector('h2').textContent = name;
      shell.content.innerHTML = `
        <div class="detail-section">
          <div class="section-title">관계 요약</div>
          <table class="data-table">
            <tr><th>${roleLabel} 참여 row</th><td>${sourceItems.length}</td><th>연결 펀드/비히클</th><td>${fundRows.length}</td></tr>
            <tr><th>연결 자산</th><td>${assetRows.length}</td><th>총 약정/투자금액</th><td>${formatNumber(totalAmount)}</td></tr>
          </table>
        </div>
        <div class="detail-section">
          <div class="section-title">관련 펀드/비히클 (${fundRows.length})</div>
          ${fundRows.map(function (row) { return fundListCard(row, roleLabel); }).join('') || '<div class="no-results">연결 펀드/비히클이 없습니다.</div>'}
        </div>
        <div class="detail-section">
          <div class="section-title">관련 자산 (${assetRows.length})</div>
          ${assetRows.map(function (row) { return assetListCard(row, roleLabel); }).join('') || '<div class="no-results">연결 자산이 없습니다.</div>'}
        </div>
        <div class="detail-section">
          <div class="section-title">참여 상세</div>
          <table class="data-table">
            <thead>
              <tr>
                <th>펀드/비히클</th>
                <th>금액</th>
                <th>시작/인출일</th>
                <th>종료/만기일</th>
              </tr>
            </thead>
            <tbody>
              ${sortedItems.map(function (row) {
                const fund = fundRows.find(function (f) { return f.fund_id === row.fund_id; }) || row.funds || {};
                const fundName = fund.project_mission_name || fund.fund_name || fund.short_name || row.fund_id || '-';
                const startDate = row.drawdown_date || row.start_date || row.invested_date || fund.setup_date || '-';
                const endDate = row.loan_maturity_date || row.end_date || fund.maturity_date || fund.termination_date || '-';
                return `
                  <tr onclick="openFundRelationshipDrawer('${escapeDrawerArg(row.fund_id)}', '${escapeDrawerArg(fundName)}')" style="cursor:pointer;">
                    <td style="font-weight:700">${fundName}</td>
                    <td style="color:var(--accent); font-weight:800;">${formatNumber(amountValue(row, amountKey))}</td>
                    <td>${startDate}</td>
                    <td>${endDate}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
      window.currentDrawerData = { type: 'institution', institutionType: type, key: name, name: name, items: sourceItems };
    } catch (e) {
      console.error(e);
      shell.content.innerHTML = `<div class="no-results">${roleLabel} 관계 정보를 불러오지 못했습니다.</div>`;
    }
  };

  window.openFundRelationshipDrawer = async (fundId, displayName) => {
    if (!fundId) return;
    const shell = openDrawerShell('FUND SELECTED', displayName || fundId, '이 펀드/비히클에 연결된 기초자산을 선택하세요.');
    try {
      const [fundRes, assetRelRes, lenderRes, benRes] = await Promise.all([
        _supabase.from('v_funds_enriched').select('*').eq('fund_id', fundId).maybeSingle(),
        _supabase.from('fund_asset_relationships').select('*').eq('fund_id', fundId).limit(300),
        _supabase.from('lender_exposures').select('*').eq('fund_id', fundId).limit(300),
        _supabase.from('beneficiary_exposures').select('*').eq('fund_id', fundId).limit(300)
      ]);
      [fundRes, assetRelRes, lenderRes, benRes].forEach(function (res) {
        if (res.error) throw res.error;
      });
      const fund = fundRes.data || {};
      const assets = dedupeAssetRelationshipRows(assetRelRes.data || []);
      const lenders = lenderRes.data || [];
      const beneficiaries = benRes.data || [];
      shell.header.querySelector('p').textContent = 'FUND SELECTED';
      shell.header.querySelector('h2').textContent = displayName || fund.project_mission_name || fund.fund_name || fund.short_name || fundId;
      shell.content.innerHTML = `
        <div class="detail-section">
          <div class="section-title">연결 자산 (${assets.length})</div>
          ${assets.map(function (row) { return assetListCard(row, 'asset'); }).join('') || '<div class="no-results">연결 자산이 없습니다.</div>'}
        </div>
        <div class="detail-section">
          <div class="section-title">참여자 요약</div>
          <table class="data-table">
            <tr><th>수익자 row</th><td>${beneficiaries.length}</td><th>대주 row</th><td>${lenders.length}</td></tr>
            <tr><th>설정일</th><td>${fund.setup_date || '-'}</td><th>만기/청산일</th><td>${fund.maturity_date || fund.termination_date || '-'}</td></tr>
          </table>
        </div>
      `;
      window.currentDrawerData = { type: 'fund', key: fundId, name: displayName || fundId, items: assets };
    } catch (e) {
      console.error(e);
      shell.content.innerHTML = '<div class="no-results">펀드 관계 정보를 불러오지 못했습니다.</div>';
    }
  };

  window.openProjectRelationshipDrawer = async (projectId, displayName) => {
    if (!projectId) return;
    const shell = openDrawerShell('PROJECT SELECTED', displayName || projectId, '프로젝트에 연결된 자산과 펀드/비히클을 확인하세요.');
    try {
      const [projectAssetRes, fundAssetRes, fundRes] = await Promise.all([
        _supabase.from('project_asset_relationships').select('*').eq('project_id', projectId).limit(300),
        _supabase.from('fund_asset_relationships').select('*').eq('fund_id', projectId).limit(300),
        _supabase.from('v_funds_enriched').select('*').eq('fund_id', projectId).maybeSingle()
      ]);
      [projectAssetRes, fundAssetRes, fundRes].forEach(function (res) {
        if (res.error) throw res.error;
      });
      const assets = dedupeAssetRelationshipRows(
        (projectAssetRes.data && projectAssetRes.data.length) ? projectAssetRes.data : (fundAssetRes.data || [])
      );
      const fund = fundRes.data;
      shell.content.innerHTML = `
        <div class="detail-section">
          <div class="section-title">연결 자산 (${assets.length})</div>
          ${assets.map(function (row) { return assetListCard(row, 'project asset'); }).join('') || '<div class="no-results">연결 자산이 없습니다.</div>'}
        </div>
        <div class="detail-section">
          <div class="section-title">연결 펀드/비히클</div>
          ${fund ? fundListCard(fund, 'vehicle') : '<div class="no-results">동일 ID의 펀드/비히클을 찾지 못했습니다.</div>'}
        </div>
      `;
      window.currentDrawerData = { type: 'project', key: projectId, name: displayName || projectId, items: assets };
    } catch (e) {
      console.error(e);
      shell.content.innerHTML = '<div class="no-results">프로젝트 관계 정보를 불러오지 못했습니다.</div>';
    }
  };

  window.backToDrawerList = () => {
    const header = document.getElementById('drawerHeader');
    header.style.padding = '40px 40px 30px';
    header.style.borderBottom = '1px solid #e2e8f0';
    if (window.currentDrawerData && window.currentDrawerData.type === 'fund' && window.openFundRelationshipDrawer) {
      window.openFundRelationshipDrawer(window.currentDrawerData.key, window.currentDrawerData.name);
    } else if (window.currentDrawerData && window.currentDrawerData.type === 'project' && window.openProjectRelationshipDrawer) {
      window.openProjectRelationshipDrawer(window.currentDrawerData.key, window.currentDrawerData.name);
    } else if (window.currentDrawerData && window.currentDrawerData.type === 'institution' && window.openInstitutionRelationshipDrawer) {
      window.openInstitutionRelationshipDrawer(window.currentDrawerData.institutionType, window.currentDrawerData.name, window.currentDrawerData.items);
    } else if (window.currentDrawerData && window.currentDrawerData.type === 'asset') {
      window.openAssetDrawer(window.currentDrawerData.key, window.currentDrawerData.name);
    } else {
      renderDrawerList();
    }
  };

  async function showDetail(obj, container) {
    const { type, items, targetName, category } = obj;
    const targetPanel = container || detailPanel;

    // 분기 처리: 자산(Asset/Fund/Project) vs 기관(Lender/Beneficiary)
    if (type === 'lender' || type === 'ben') {
      return renderInstitutionDetail(obj, targetPanel);
    }

    const primaryAssetId = items && items[0] && items[0].primary_asset_id;
    if ((type === 'project' || type === 'fund') && primaryAssetId && window.AssetCanonical && !container) {
      return window.AssetCanonical.renderCanonicalAssetDetail(
        primaryAssetId,
        items[0].project_mission_name || items[0].fund_name || targetName
      );
    }

    const fundIds = items.map(i => i.fund_id);
    targetPanel.innerHTML = '<div class="no-results">상세 로딩 중...</div>';
    try {
      const [fundRes, assetRes, lenderRes, benRes] = await Promise.all([
        _supabase.from('v_funds_enriched').select('*').in('fund_id', fundIds),
        _supabase.from('fund_assets').select('*').in('fund_id', fundIds),
        _supabase.from('lender_exposures').select('*').in('fund_id', fundIds),
        _supabase.from('beneficiary_exposures').select('*').in('fund_id', fundIds)
      ]);

      const f = fundRes.data?.[0] || items[0];
      // Map resolved names for UI compatibility
      if (f.dept_resolved) f.dept = f.dept_resolved;
      if (f.manager_resolved) f.manager = f.manager_resolved;
      const targetPnu = items[0].metadata?.pnu || items[0].pnu;

      const getScore = (x) => (x.gfa ? 2 : 0) + (x.site_area ? 2 : 0) + (x.lat || x.latitude ? 1 : 0) + (x.address ? 1 : 0);
      const sortedAssets = (assetRes.data || []).sort((a, b) => getScore(b) - getScore(a));

      let a = null;
      const selectedAssetClass = window.analysisFilters?.base_asset_class || [];
      if (selectedAssetClass.length > 0) {
          a = sortedAssets.find(x => {
              const name = x.asset_name || x.metadata?.asset_name || '';
              if (selectedAssetClass.includes('물류센터')) return name.includes('물류') || name.includes('로지스') || name.includes('아레나스') || name.includes('스카이박스');
              if (selectedAssetClass.includes('오피스')) return name.includes('타워') || name.includes('빌딩') || name.includes('스퀘어') || name.includes('플렉스');
              return false;
          });
      }

      if (!a && f.primary_asset_id) {
          a = sortedAssets.find(x => x.asset_id === f.primary_asset_id);
      }
      if (!a) {
          a = sortedAssets.find(x => (x.metadata?.pnu || x.pnu || x.asset_name) === targetName) ||
              sortedAssets.find(x => (x.metadata?.pnu || x.pnu) === targetPnu) ||
              sortedAssets[0] || {};
      }

      const detailTitle = getFundPrimaryName(f);
      const officialName = getFundSecondaryName(f);
      const meta = f.metadata || {};
      const classifications = [
        getFieldValue(f, 'department'),
        getFieldValue(f, 'fund_class'),
        getFieldValue(f, 'domestic_overseas'),
        getFieldValue(f, 'primary_region'),
        getFieldValue(f, 'base_asset_class'),
        getFieldValue(f, 'fund_type'),
        getFieldValue(f, 'investment_strategy'),
        getFieldValue(f, 'asset_nature_class'),
        getFieldValue(f, 'business_stage_class')
      ].filter(Boolean).join(' | ');

      const mapId = 'vmap-' + Math.random().toString(36).substr(2, 9);
      targetPanel.innerHTML = `
      <div class="detail-header">
        <span class="card-tag tag-fund">ASSET PROFILE</span>
        <h2 style="margin-bottom:4px;">${a.asset_name || detailTitle}</h2>
        <div style="color:var(--muted); font-size:16px;">
          ${fundIds.join(', ')} | ${f.dept || '-'}${officialName ? ' | ' + officialName : ''}${classifications ? ' | ' + classifications : ''}
        </div>
      </div>

      <div class="detail-section">
        <div class="section-title">자산 상세 (Asset Specs)</div>
        <div class="asset-specs-grid">
          <table class="data-table profile-table">
            <tr><th>자산코드 <small>Asset Code</small></th><td style="color:var(--accent); font-weight:800;">${a.metadata?.asset_code || a.metadata?.notion_asset_code || '-'}</td></tr>
            <tr><th>주소 <small>Address</small></th><td>${a.address || '-'}</td></tr>
            <tr><th>대지면적 <small>Site Area</small></th><td>${a.site_area ? a.site_area.toLocaleString() + '㎡ (' + (a.site_area * 0.3025).toFixed(2) + 'py)' : '-'}</td></tr>
            <tr><th>연면적 <small>GFA</small></th><td>${a.gfa ? a.gfa.toLocaleString() + '㎡ (' + (a.gfa * 0.3025).toFixed(2) + 'py)' : '-'}</td></tr>
            <tr><th>건폐율/용적률 <small>SCR/FAR</small></th><td>${a.scr || '-'}% / ${a.far || '-'}%</td></tr>
            <tr><th>주용도 <small>Usage</small></th><td>${a.main_usage || '-'}</td></tr>
            <tr><th>층수 <small>Floors</small></th><td>B${a.floors_down || '-'} / ${a.floors_up || '-'}F</td></tr>
            <tr><th>건축구조 <small>Structure</small></th><td>${a.structure || '-'}</td></tr>
            <tr><th>주차 <small>Parking</small></th><td>${a.parking || '-'}</td></tr>
            <tr><th>승강기 <small>Elevators</small></th><td>${a.elevators || '-'}</td></tr>
            <tr><th>준공연월 <small>Completion</small></th><td>${a.completion_date || '-'}</td></tr>
          </table>
          <div id="${mapId}" class="vmap-container" style="min-height:500px; border-radius:20px; border:1px solid var(--line);"></div>
        </div>
      </div>

      <div class="detail-section">
        <div class="section-title">대주단 현황 (Lenders)</div>
        <table class="data-table">
          <thead><tr><th>기관명</th><th>대출액</th><th>금리</th><th>대출기간</th></tr></thead>
          <tbody>
            ${lenderRes.data?.map(l => `
              <tr>
                <td style="font-weight:700">${l.lender_clean}</td>
                <td>${formatNumber(l.drawn_amt)}</td>
                <td>${l.all_in_rate ? l.all_in_rate + '%' : '-'}</td>
                <td style="font-size:12px; opacity:0.7">${l.start_date || ''} ~ ${l.end_date || ''}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">정보 없음</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="detail-section">
        <div class="section-title">수익자 현황 (Beneficiaries)</div>
        <table class="data-table">
          <thead><tr><th>기관명</th><th>투자액</th><th>지분율</th><th>약정일</th></tr></thead>
          <tbody>
            ${benRes.data?.map(b => `
              <tr>
                <td style="font-weight:700">${b.beneficiary_clean}</td>
                <td>${formatNumber(b.invested_amt)}</td>
                <td>${b.share_ratio ? b.share_ratio + '%' : '-'}</td>
                <td>${b.invested_date || '-'}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">정보 없음</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

      if (category === 'analysis') {
        if (typeof initAnalysisFilters === 'function') initAnalysisFilters();
        if (typeof renderPortfolioChart === 'function') renderPortfolioChart();
      }

      const lon = parseFloat(a.lng || a.longitude || a.metadata?.longitude);
      const lat = parseFloat(a.lat || a.latitude || a.metadata?.latitude);

      if (!isNaN(lon) && !isNaN(lat)) {
        setTimeout(() => {
          try {
            if (typeof vw !== 'undefined' && vw.ol3) {
              const vmap = new vw.ol3.Map(mapId, {
                basemapType: vw.ol3.BasemapType.GRAPHIC,
                controlDensity: vw.ol3.DensityType.EMPTY,
                interactionDensity: vw.ol3.DensityType.BASIC,
                homePosition: vw.ol3.CameraPosition,
                initPosition: vw.ol3.CameraPosition
              });
              if (typeof ol !== 'undefined') {
                const center = ol.proj.fromLonLat([lon, lat]);
                vmap.getView().setCenter(center);
                vmap.getView().setZoom(17);
              }
              const markerLayer = new vw.ol3.layer.Marker(vmap);
              vmap.addLayer(markerLayer);
              markerLayer.addMarker({
                x: lon, y: lat, epsg: "EPSG:4326",
                title: a.asset_name || '위치',
                iconUrl: 'https://map.vworld.kr/images/ol3/marker_blue.png'
              });
            }
          } catch (e) { console.error("VWorld Map Error:", e); }
        }, 500);
      } else {
        const vmapEl = document.getElementById(mapId);
        if (vmapEl) vmapEl.innerHTML = '<div style="padding:40px; color:var(--muted); text-align:center;">좌표 정보가 없어 지도를 표시할 수 없습니다.</div>';
      }
    } catch (e) {
      console.error(e);
      targetPanel.innerHTML = '상세 정보를 불러오지 못했습니다.';
    }
  }

  async function renderInstitutionDetail(obj, targetPanel) {
    const { type, items, targetName } = obj;
    const label = type === 'lender' ? '대주' : '수익자';
    const amountKey = type === 'lender' ? 'committed_amt' : 'invested_amt';

    const totalAmount = items.reduce((acc, curr) => acc + (curr[amountKey] || 0), 0);
    const chartId = 'inst-chart-' + Math.random().toString(36).substr(2, 9);

    // 펀드 정보 조회: 검색 JOIN 데이터(item.funds)를 1순위로, window.allFunds를 fallback으로 사용
    function resolveFund(item) {
      const joined = item.funds;
      const global = (window.allFunds || []).find(f => f.fund_id === item.fund_id);
      return joined || global || null;
    }

    function resolveFundName(item) {
      const fund = resolveFund(item);
      if (fund) return getFundPrimaryName(fund);
      return item.funds?.fund_name || item.fund_id;
    }

    function resolveSetupDate(item) {
      const fund = resolveFund(item);
      // 대주: drawdown_date(인출일) 우선 / 수익자: setup_date(설정일) 우선
      if (type === 'lender') {
        return item.drawdown_date || item.start_date || fund?.setup_date || null;
      }
      return item.start_date || item.invested_date || fund?.setup_date || null;
    }

    function resolveEndDate(item) {
      const fund = resolveFund(item);
      if (type === 'lender') {
        return item.loan_maturity_date || item.end_date || fund?.maturity_date || null;
      }
      return item.end_date || fund?.maturity_date || null;
    }

    // Sort items by date (latest first)
    const sortedItems = [...items].sort((a, b) => {
      const dateA = new Date(resolveSetupDate(a) || '1900-01-01');
      const dateB = new Date(resolveSetupDate(b) || '1900-01-01');
      return dateB - dateA;
    });

    targetPanel.innerHTML = `
      <div class="detail-header">
        <span class="card-tag tag-${type}">${label.toUpperCase()} PROFILE</span>
        <h2 style="margin-bottom:4px;">${targetName}</h2>
        <div style="color:var(--muted); font-size:16px;">
          전체 ${items.length}건 참여 | 총액 ${formatNumber(totalAmount)}
        </div>
      </div>

      <div class="detail-section">
        <div class="section-title">연도별 익스포저 변화 (Exposure Analysis)</div>
        <div id="${chartId}" style="min-height: 350px;"></div>
      </div>

      <div class="detail-section">
        <div class="section-title">참여 프로젝트 상세 (Participation Details)</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>프로젝트/펀드명</th>
              <th>투입금액</th>
              <th>시작일</th>
              <th>종료일</th>
            </tr>
          </thead>
          <tbody>
            ${sortedItems.map(item => {
              return `
                <tr>
                  <td style="font-weight:700">${resolveFundName(item)}</td>
                  <td style="color:var(--accent); font-weight:800;">${formatNumber(item[amountKey])}</td>
                  <td>${resolveSetupDate(item) || '-'}</td>
                  <td>${resolveEndDate(item) || '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Chart Data Preparation
    const yearData = {};
    const currentYear = new Date().getFullYear();
    let minYear = currentYear;

    items.forEach(item => {
      const setupDate = resolveSetupDate(item);
      if (setupDate) {
        const year = new Date(setupDate).getFullYear();
        if (year < minYear) minYear = year;
        yearData[year] = (yearData[year] || 0) + (item[amountKey] || 0);
      }
    });

    const years = [];
    for (let y = minYear; y <= currentYear; y++) years.push(y);

    const newData = years.map(y => yearData[y] || 0);
    const cumulativeData = [];
    let runningSum = 0;

    years.forEach(y => {
      runningSum += (yearData[y] || 0);
      cumulativeData.push(runningSum);
    });

    setTimeout(() => {
      const options = {
        series: [
          { name: '누적 익스포저', type: 'line', data: cumulativeData.map(v => Math.floor(v / 100000000)) },
          { name: '신규 투입액', type: 'column', data: newData.map(v => Math.floor(v / 100000000)) }
        ],
        chart: { height: 350, type: 'line', toolbar: { show: false }, fontFamily: 'Pretendard Variable', foreColor: '#a1a1aa' },
        theme: { mode: 'dark' },
        stroke: { width: [4, 0], curve: 'smooth' },
        plotOptions: { bar: { columnWidth: '60%', borderRadius: 6 } },
        colors: ['#4f46e5', '#93c5fd'],
        xaxis: { categories: years },
        yaxis: [
          {
            labels: {
              formatter: (val) => val.toLocaleString()
            },
            title: { text: '단위: 억원' }
          }
        ],
        tooltip: {
            shared: true,
            intersect: false,
            y: { formatter: (val) => val.toLocaleString() + ' 억' }
        }
      };

      if (typeof ApexCharts !== 'undefined') {
        const chart = new ApexCharts(document.getElementById(chartId), options);
        chart.render();
      }
    }, 100);
  }

  window.openFundDetailById = async (fundId) => {
    const allFunds = window.allFunds || [];
    const fund = allFunds.find(f => f.fund_id === fundId);
    if (!fund) return;

    currentDrawerData = { key: fund.fund_id, name: fund.fund_name, items: [fund] };

    // Activate drawer
    document.getElementById('sideDrawer').classList.add('active');
    document.getElementById('sideDrawerOverlay').classList.add('active');

    // Show detail
    window.showDrawerDetail(fundId);
  };

  window.openAssetDrawer = (assetId, displayName) => {
    const data = window.AssetCanonical?._lastDetailData;
    if (!data || data.assetId !== assetId) return;

    const funds = data.funds || [];
    const projects = data.projects || [];

    const header = document.getElementById('drawerHeader');
    const content = document.getElementById('drawerContent');
    const nav = document.getElementById('drawerNav');

    nav.style.display = 'none';
    header.style.padding = '40px 40px 30px';
    header.style.borderBottom = '1px solid #e2e8f0';
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
                <p style="color:var(--accent); font-size:12px; font-weight:800; margin-bottom:8px; letter-spacing:1px;">ASSET DEEP-DIVE</p>
                <h2 style="font-size:22px; font-weight:800; line-height:1.3; color:#f8fafc;">${displayName}</h2>
                <p style="margin-top:12px; color:var(--muted); font-size:14px; font-weight:500;">
                  이 자산에 연결된 공식 펀드는 <strong style="color:var(--accent-2);">${funds.length}개</strong>, 미션 프로젝트는 <strong style="color:#059669;">${projects.length}개</strong>입니다.
                </p>
            </div>
        </div>
    `;

    let html = '';

    if (funds.length > 0) {
      html += `<h4 style="font-size:14px; font-weight:800; margin:24px 0 12px; color:var(--accent-2); display:flex; align-items:center; gap:6px;">
        <span class="card-tag tag-fund" style="margin:0; background:rgba(79, 70, 229, 0.1); color:var(--accent-2);">FUND</span> 연결 펀드 리스트
      </h4>`;
      html += funds.map(f => {
        const setupDate = f.setup_date || f.metadata?.setup_date || '-';
        const maturityDate = f.maturity_date || f.metadata?.maturity_date || '-';
        const aum = f.benchmark_aum || 0;
        return `
          <div class="fund-detail-card" onclick="showDrawerDetail('${f.fund_id}')" style="cursor:pointer; margin-bottom:12px; border-left: 4px solid var(--accent-2);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <h3 style="font-size:14.5px; font-weight:800; flex:1; margin-right:16px; color:#f8fafc;">${f.fund_name || f.short_name || f.fund_id}</h3>
                  <span style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:800; background:#f1f5f9; color:#475569;">${f.fund_status || '운용'}</span>
              </div>
              <div class="meta-grid" style="grid-template-columns: repeat(3, 1fr); gap:12px; margin-top:12px;">
                  <div class="meta-item"><span class="meta-label">설정액(AUM)</span><span class="meta-val" style="color:var(--accent-2); font-weight:800;">${aum ? formatNumber(aum) : '-'}</span></div>
                  <div class="meta-item"><span class="meta-label">설정일</span><span class="meta-val">${setupDate}</span></div>
                  <div class="meta-item"><span class="meta-label">만기일</span><span class="meta-val">${maturityDate}</span></div>
              </div>
          </div>
        `;
      }).join('');
    }

    if (projects.length > 0) {
      html += `<h4 style="font-size:14px; font-weight:800; margin:24px 0 12px; color:#059669; display:flex; align-items:center; gap:6px;">
        <span class="card-tag tag-project" style="margin:0; background:rgba(16, 185, 129, 0.1); color:#059669;">PROJECT</span> 연결 프로젝트 리스트
      </h4>`;
      html += projects.map(p => {
        const setupDate = p.setup_date || p.metadata?.setup_date || '-';
        const maturityDate = p.maturity_date || p.metadata?.maturity_date || '-';
        const aum = p.benchmark_aum || 0;
        return `
          <div class="fund-detail-card" onclick="showDrawerDetail('${p.fund_id || p.project_id}')" style="cursor:pointer; margin-bottom:12px; border-left: 4px solid #10b981;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <h3 style="font-size:14.5px; font-weight:800; flex:1; margin-right:16px; color:#f8fafc;">${p.project_mission_name || p.fund_name || p.project_name || p.fund_id}</h3>
                  <span style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:800; background:rgba(16, 185, 129, 0.1); color:#059669;">${p.project_status || '검토'}</span>
              </div>
              <div class="meta-grid" style="grid-template-columns: repeat(3, 1fr); gap:12px; margin-top:12px;">
                  <div class="meta-item"><span class="meta-label">검토/AUM</span><span class="meta-val" style="color:#10b981; font-weight:800;">${aum ? formatNumber(aum) : '-'}</span></div>
                  <div class="meta-item"><span class="meta-label">설정일</span><span class="meta-val">${setupDate}</span></div>
                  <div class="meta-item"><span class="meta-label">만기일</span><span class="meta-val">${maturityDate}</span></div>
              </div>
          </div>
        `;
      }).join('');
    }

    content.innerHTML = html || '<div style="padding:100px; text-align:center; color:var(--muted);">연결된 펀드나 프로젝트가 없습니다.</div>';
    document.getElementById('sideDrawer').classList.add('active');
    document.getElementById('sideDrawerOverlay').classList.add('active');

    window.currentDrawerData = { type: 'asset', key: assetId, name: displayName, items: [] };
  };

  window.showDetail = showDetail;
  window.openAssetDrawer = window.openAssetDrawer;
})();
