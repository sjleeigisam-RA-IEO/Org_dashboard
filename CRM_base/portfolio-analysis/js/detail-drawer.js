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

    const fund = (window.lastTargetFunds || lastTargetFunds || []).find(f => f.fund_id === fundId);
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

  window.backToDrawerList = () => {
    const header = document.getElementById('drawerHeader');
    header.style.padding = '40px 40px 30px';
    header.style.borderBottom = '1px solid #e2e8f0';
    renderDrawerList();
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
        chart: { height: 350, type: 'line', toolbar: { show: false }, fontFamily: 'Pretendard Variable' },
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

  window.showDetail = showDetail;
})();
