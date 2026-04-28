async function renderAnalytics() {
    let targetFunds = allResults.funds || [];
    if (targetFunds.length === 0) {
        detailPanel.innerHTML = '<div class="no-results" style="padding:100px;">전체 포트폴리오 집계 중...</div>';
        try {
            const [fundRes, assetRes] = await Promise.all([
                _supabase.from('funds').select('fund_id, fund_name, status, sector, location, metadata').limit(1000),
                _supabase.from('fund_assets').select('fund_id, metadata').limit(2000)
            ]);
            targetFunds = fundRes.data || [];

            const pnuMap = {};
            (assetRes.data || []).forEach(a => {
                const pnu = a.metadata?.pnu;
                if (a.fund_id && pnu) pnuMap[a.fund_id] = pnu;
            });
            window.fundToPnu = pnuMap;
        } catch (e) {
            console.error(e);
        }
    }
    window.lastTargetFunds = targetFunds;
    lastTargetFunds = targetFunds;

    const snapshotDate = new Date('2026-03-31');
    const activeFunds = targetFunds.filter(f => {
        const setup = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
        const end = f.metadata?.termination_date
            ? new Date(f.metadata.termination_date)
            : (f.metadata?.maturity_date ? new Date(f.metadata.maturity_date) : new Date('2099-12-31'));
        return getFundStatus(f) === '운용' && setup && setup <= snapshotDate && end > snapshotDate && isRAFund(f);
    });

    const totalAum = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, 'benchmark_aum'), 0);
    const totalEquity = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, 'committed_equity'), 0);
    const totalLoan = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, 'committed_debt'), 0);
    const totalOther = totalAum - totalEquity - totalLoan;

    const mainValue = formatNumber(totalAum);
    const eqVal = formatNumber(totalEquity);
    const lnVal = formatNumber(totalLoan);
    const otVal = formatNumber(totalOther);

    const overseasKeywords = ['미국', '영국', '글로벌', '유럽', '해외', '북미', '아시아', '독일', '일본', '베트남', '프랑스', '이탈리아', '스페인'];
    const activeAssets = groupItems(activeFunds, '', 'count');
    const overseasAssetsCount = activeAssets.filter(item => overseasKeywords.some(kw => item.name.includes(kw))).length;
    const domesticAssetsCount = activeAssets.length - overseasAssetsCount;

    detailPanel.innerHTML = `
        <div class="analytics-container" style="padding-bottom:60px;">
          <div class="detail-header" style="margin-bottom:40px;">
            <p class="card-tag tag-project" style="margin-bottom:12px;">REAL-TIME PORTFOLIO TRACKER</p>
            <h2 style="font-size:32px; font-weight:800;">부문 통합 자산 성장 추이</h2>
            <p style="color:var(--muted); font-size:16px;">2010년부터 현재까지의 성장 궤적과 2026년 말 청산 가능 펀드를 반영했습니다.</p>
          </div>

          <div style="display:grid; grid-template-columns: 2fr 1fr; gap:24px; margin-bottom:32px;">
            <div class="kpi-card" style="padding:40px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
              <div class="kpi-label" style="font-size:14px; letter-spacing:1px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                <span>현재 운용 AUM (2026.03.31 기준)</span>
                <div id="orgToggle" class="segmented-control" data-active="${currentOrgScope}" onclick="toggleOrgScope()">
                    <div class="segment-slider"></div>
                    <div class="segment ${currentOrgScope === 'all' ? 'active' : ''}" data-val="all">전체</div>
                    <div class="segment ${currentOrgScope === 'ra' ? 'active' : ''}" data-val="ra">RA부문</div>
                </div>
              </div>
              <div class="kpi-value" style="font-size:52px; color:var(--accent); font-weight:900; line-height:1;">${mainValue}</div>
              <div style="margin-top:32px; padding-top:24px; border-top:1px solid #e2e8f0; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:20px;">
                <div class="kpi-sub">
                  <div class="kpi-sub-label">자본금</div>
                  <div class="kpi-sub-value" style="color:#6366f1; font-size:18px;">${eqVal}</div>
                </div>
                <div class="kpi-sub">
                  <div class="kpi-sub-label">대출(Debt)</div>
                  <div class="kpi-sub-value" style="color:#f59e0b; font-size:18px;">${lnVal}</div>
                </div>
                <div class="kpi-sub">
                  <div class="kpi-sub-label">기타</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${otVal}</div>
                </div>
              </div>
            </div>

            <div class="kpi-card" style="padding:40px; background:#f8fafc; border:1px solid #e2e8f0; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div class="kpi-label" style="margin-bottom:16px;">활성 운용 자산</div>
                <div class="kpi-value" style="font-size:48px; font-weight:900; color:var(--text);">${activeAssets.length}<span style="font-size:18px; font-weight:500; margin-left:4px; color:var(--muted);">개</span></div>
              </div>
              <div style="margin-top:24px; padding-top:20px; border-top:1px dashed #cbd5e1; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <div class="kpi-sub">
                  <div class="kpi-sub-label">국내</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${domesticAssetsCount}<span style="font-size:12px; margin-left:2px;">개</span></div>
                </div>
                <div class="kpi-sub">
                  <div class="kpi-sub-label">해외</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${overseasAssetsCount}<span style="font-size:12px; margin-left:2px;">개</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="detail-section" style="padding:40px; background:white; border-radius:24px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
            <h3 class="section-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:40px;">
              <span style="font-size:20px; font-weight:800;">연도별 포트폴리오 성장 궤적 (2010 - 2026)</span>
              <div class="chart-toggle-group" style="display:flex; background:#f1f5f9; padding:4px; border-radius:12px; gap:4px;">
                 <button id="toggle-benchmark_aum" class="chart-toggle-btn ${currentChartMetric === 'benchmark_aum' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('benchmark_aum')">AUM</button>
                 <button id="toggle-committed_debt" class="chart-toggle-btn ${currentChartMetric === 'committed_debt' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('committed_debt')">Loan</button>
                 <button id="toggle-committed_equity" class="chart-toggle-btn ${currentChartMetric === 'committed_equity' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('committed_equity')">Equity</button>
                 <button id="toggle-count" class="chart-toggle-btn ${currentChartMetric === 'count' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('count')">Count</button>
              </div>
            </h3>

            <div id="mainGrowthChart" style="min-height:450px; margin-bottom:60px;"></div>

             <div style="margin-top:80px; border-top:1px solid var(--line); padding-top:60px;">
               <h4 style="font-size:15px; font-weight:700; margin-bottom:20px; color:var(--muted); display:flex; align-items:center; justify-content:space-between;">
                 <div style="display:flex; align-items:center;">
                   <span style="width:8px; height:8px; background:#f59e0b; border-radius:2px; margin-right:10px;"></span>
                   연도별 순증감 추이 (Annual Net Change)
                 </div>
                 <span style="font-size:12px; color:var(--accent); background:#eff6ff; padding:2px 8px; border-radius:6px;">${currentOrgScope === 'ra' ? 'RA 부문 적용' : '전체 포트폴리오'}</span>
               </h4>
            <div id="netGrowthChart" style="min-height:350px;"></div>
            <div id="drillDownResult" style="margin-top:48px; display:none; animation: fadeIn 0.4s ease;"></div>
          </div>
        </div>
        <style>
          .segmented-control {
            display: flex; background: #f1f5f9; padding: 4px; border-radius: 12px;
            position: relative; width: 140px; cursor: pointer; border: 1px solid #e2e8f0;
          }
          .segment {
            flex: 1; text-align: center; padding: 6px 0; font-size: 11px; font-weight: 700;
            color: #64748b; z-index: 1; transition: color 0.3s; position: relative;
          }
          .segment.active { color: var(--accent); }
          .segment-slider {
            position: absolute; top: 4px; left: 4px; width: calc(50% - 4px); height: calc(100% - 8px);
            background: white; border-radius: 9px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .segmented-control[data-active="ra"] .segment-slider { transform: translateX(100%); }
        </style>
    `;

    renderHistory('mainGrowthChart');
    renderNetGrowth('netGrowthChart');
}

function switchMetric(metric) {
    currentChartMetric = metric;
    window.currentChartMetric = currentChartMetric;
    renderAnalytics();
}

function switchScope(scope) {
    currentOrgScope = scope;
    window.currentOrgScope = currentOrgScope;
    renderAnalytics();
}

function renderNetChangeDetails(label) {
    const analysisResults = document.getElementById('analysisResults');
    const analysisHeader = document.getElementById('analysisListHeader');
    const targetFunds = window.lastTargetFunds || [];
    if (!analysisResults || !analysisHeader || targetFunds.length === 0) return;

    analysisResults.innerHTML = '<div style="text-align:center; padding:40px; color:var(--muted);">데이터 추출 중...</div>';

    let startDate;
    let endDate;
    let title;
    if (label === '2026 (Actual)') {
        startDate = new Date('2026-01-01');
        endDate = new Date('2026-03-31');
        title = '2026년 1분기';
    } else if (label === '2026 (Proj.)') {
        startDate = new Date('2026-04-01');
        endDate = new Date('2026-12-31');
        title = '2026년 잔여';
    } else {
        const year = parseInt(label, 10);
        startDate = new Date(`${year}-01-01`);
        endDate = new Date(`${year}-12-31`);
        title = `${year}년`;
    }

    const newlySetup = targetFunds.filter(f => {
        const setup = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
        return setup && setup >= startDate && setup <= endDate && isRAFund(f);
    });

    const terminated = targetFunds.filter(f => {
        const end = f.metadata?.termination_date || f.metadata?.maturity_date;
        const d = end ? new Date(end) : null;
        return d && d >= startDate && d <= endDate && isRAFund(f);
    });

    const finalItems = [...groupItems(newlySetup, '+'), ...groupItems(terminated, '-')].sort((a, b) => b.aum - a.aum);

    analysisHeader.innerHTML = `
        <div style="padding:16px; background:white; border-radius:12px; border:1px solid var(--line); box-shadow:var(--shadow);">
            <div style="font-size:12px; color:var(--accent); font-weight:800; margin-bottom:4px;">${title} 변동 내역</div>
            <div style="font-size:16px; font-weight:800;">총 ${finalItems.length}개 항목</div>
        </div>
    `;

    if (finalItems.length === 0) {
        analysisResults.innerHTML = '<div class="no-results">해당 기간 내<br>변동 내역이 없습니다.</div>';
        return;
    }

    analysisResults.innerHTML = finalItems.map(item => `
        <div class="group-card" onclick="openFundDetail('${item.key}', '${item.name}')">
            <div class="group-header">
                <div style="flex:1">
                    <span class="card-tag" style="background:${item.type === '+' ? '#ecfdf5' : '#fef2f2'}; color:${item.type === '+' ? '#10b981' : '#ef4444'};">
                        ${item.type === '+' ? '신규' : '청산'}
                    </span>
                    <div class="group-title">${item.name}</div>
                    <div class="group-meta">${currentChartMetric === 'count' ? `${item.aum}건 참여` : formatNumber(item.aum)}</div>
                </div>
                <div class="toggle-icon">></div>
            </div>
        </div>
    `).join('');
}

function renderNetGrowth(chartId) {
    const targetFunds = window.lastTargetFunds || [];
    if (targetFunds.length === 0) return;

    const categories = [];
    for (let y = 2010; y <= 2025; y++) categories.push(y.toString());
    categories.push('2026 (Actual)');
    categories.push('2026 (Proj.)');

    const totals = categories.map(cat => {
        let snapshotDate;
        if (cat === '2026 (Actual)') snapshotDate = new Date('2026-03-31');
        else if (cat === '2026 (Proj.)') snapshotDate = new Date('2026-12-31');
        else snapshotDate = new Date(`${cat}-12-31`);

        const activeInYear = targetFunds.filter(f => {
            if (!isRAFund(f)) return false;
            const setup = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
            const end = f.metadata?.termination_date
                ? new Date(f.metadata.termination_date)
                : (f.metadata?.maturity_date ? new Date(f.metadata.maturity_date) : new Date('2099-12-31'));
            if (cat.startsWith('2026') && getFundStatus(f) !== '운용') return false;
            return setup && setup <= snapshotDate && end > snapshotDate;
        });

        if (currentChartMetric === 'count') return groupItems(activeInYear, '').length;
        return activeInYear.reduce((sum, f) => sum + getFundAmountWon(f, currentChartMetric), 0);
    });

    const deltas = totals.map((val, idx) => {
        const prev = idx === 0 ? 0 : totals[idx - 1];
        const diff = currentChartMetric === 'count' ? (val - prev) : Math.round((val - prev) / 1e12 * 100) / 100;
        return {
            x: categories[idx],
            y: diff,
            fillColor: diff >= 0 ? (categories[idx].startsWith('2026') ? '#818cf8' : '#6366f1') : '#ef4444'
        };
    });

    const options = {
        series: [{ name: 'Net Change', data: deltas }],
        chart: {
            type: 'bar',
            height: 350,
            toolbar: { show: false },
            fontFamily: 'Pretendard Variable',
            events: {
                dataPointSelection: (event, chartContext, config) => {
                    const label = categories[config.dataPointIndex];
                    renderNetChangeDetails(label);
                }
            }
        },
        plotOptions: {
            bar: {
                colors: { ranges: [{ from: -1000, to: 0, color: '#ef4444' }] },
                columnWidth: '60%',
                borderRadius: 6,
                dataLabels: { position: 'top' }
            }
        },
        dataLabels: {
            enabled: true,
            formatter: val => {
                if (val === 0) return '';
                const prefix = val > 0 ? '+' : '';
                return currentChartMetric === 'count' ? `${prefix}${val}개` : `${prefix}${val.toFixed(1)}조`;
            },
            offsetY: -22,
            style: { fontSize: '11px', fontWeight: 800, colors: ['#334155'] }
        },
        xaxis: { categories: categories, labels: { style: { fontSize: '10px' } } },
        yaxis: {
            labels: {
                formatter: val => {
                    const prefix = val > 0 ? '+' : '';
                    return currentChartMetric === 'count' ? `${prefix}${val}개` : `${prefix}${val.toFixed(1)}조`;
                }
            }
        },
        colors: ['#6366f1'],
        grid: { yaxis: { lines: { show: true } } },
        tooltip: {
            shared: true,
            intersect: false,
            y: {
                formatter: val => (val > 0 ? '+' : '') + val.toLocaleString() + (currentChartMetric === 'count' ? ' 개' : ' 조원')
            }
        }
    };

    const el = document.querySelector(`#${chartId}`);
    if (el) {
        el.innerHTML = '';
        new ApexCharts(el, options).render();
    }
}

function renderHistory(chartId) {
    const targetFunds = window.lastTargetFunds || [];
    if (targetFunds.length === 0) return;

    const categories = [];
    for (let y = 2010; y <= 2025; y++) categories.push(y.toString());
    categories.push('2026 (Actual)', '2026 (Proj.)');

    const overseasKeywords = ['미국', '영국', '글로벌', '유럽', '해외', '북미', '아시아', '독일', '일본', '베트남', '프랑스', '이탈리아', '스페인', '유로'];
    const domesticSeries = [];
    const overseasSeries = [];

    categories.forEach(cat => {
        let snap;
        if (cat === '2026 (Actual)') snap = new Date('2026-03-31');
        else if (cat === '2026 (Proj.)') snap = new Date('2026-12-31');
        else snap = new Date(`${cat}-12-31`);

        const active = targetFunds.filter(f => {
            if (currentOrgScope === 'ra' && !isRAFund(f)) return false;
            const s = f.metadata?.setup_date ? new Date(f.metadata.setup_date) : null;
            const e = f.metadata?.termination_date
                ? new Date(f.metadata.termination_date)
                : (f.metadata?.maturity_date ? new Date(f.metadata.maturity_date) : new Date('2099-12-31'));
            if (cat.startsWith('2026') && getFundStatus(f) !== '운용') return false;
            return s && s <= snap && e > snap;
        });

        const overseas = active.filter(f => overseasKeywords.some(kw => (f.fund_name || f.metadata?.fund_name || '').includes(kw)));
        const domestic = active.filter(f => !overseas.includes(f));

        if (currentChartMetric === 'count') {
            domesticSeries.push(groupItems(domestic, '', 'count').length);
            overseasSeries.push(groupItems(overseas, '', 'count').length);
        } else {
            domesticSeries.push(Math.round(domestic.reduce((sum, f) => sum + getFundAmountWon(f, currentChartMetric), 0) / 1e11) / 10);
            overseasSeries.push(Math.round(overseas.reduce((sum, f) => sum + getFundAmountWon(f, currentChartMetric), 0) / 1e11) / 10);
        }
    });

    const options = {
        series: [
            { name: '국내', data: domesticSeries },
            { name: '해외', data: overseasSeries }
        ],
        chart: { type: 'bar', height: 450, stacked: true, toolbar: { show: false }, fontFamily: 'Pretendard Variable' },
        colors: ['#4f46e5', '#38bdf8'],
        plotOptions: {
            bar: {
                columnWidth: '60%',
                borderRadius: 6,
                dataLabels: {
                    total: {
                        enabled: true,
                        offsetY: -10,
                        style: { fontSize: '11px', fontWeight: 900, colors: ['#334155'] },
                        formatter: val => val.toLocaleString() + (currentChartMetric === 'count' ? '개' : '조')
                    }
                }
            }
        },
        dataLabels: { enabled: false },
        xaxis: { categories: categories, labels: { style: { fontSize: '10px' } } },
        yaxis: { labels: { formatter: val => val + (currentChartMetric === 'count' ? '개' : '조') } },
        grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
        tooltip: {
            shared: true,
            intersect: false,
            y: { formatter: val => val.toLocaleString() + (currentChartMetric === 'count' ? ' 개' : ' 조원') }
        },
        legend: { position: 'top', horizontalAlign: 'right' }
    };

    const el = document.querySelector(`#${chartId}`);
    if (el) {
        el.innerHTML = '';
        new ApexCharts(el, options).render();
    }
}

function renderDrillDown(year, category, metric) {
    const drillPanel = document.getElementById('drillDownResult');
    if (!drillPanel) return;
    drillPanel.innerHTML = `<div style="font-weight:700; margin-bottom:10px;">${year}년 심층 분석</div><div style="font-size:13px; color:var(--muted);">해당 시점의 포트폴리오 구성을 분석 중입니다...</div>`;
}

function toggleOrgScope() {
    currentOrgScope = currentOrgScope === 'all' ? 'ra' : 'all';
    window.currentOrgScope = currentOrgScope;

    const toggleEl = document.getElementById('orgToggle');
    if (toggleEl) {
        toggleEl.setAttribute('data-active', currentOrgScope);
        const segments = toggleEl.querySelectorAll('.segment');
        segments.forEach(s => {
            if (s.getAttribute('data-val') === currentOrgScope) s.classList.add('active');
            else s.classList.remove('active');
        });
    }

    renderAnalytics();
}

window.renderAnalytics = renderAnalytics;
window.switchMetric = switchMetric;
window.switchScope = switchScope;
window.toggleOrgScope = toggleOrgScope;
