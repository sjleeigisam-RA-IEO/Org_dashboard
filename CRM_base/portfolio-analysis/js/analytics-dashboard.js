async function renderAnalytics() {
    let targetFunds = allResults.funds || [];
    if (targetFunds.length === 0) {
        detailPanel.innerHTML = '<div class="no-results" style="padding:100px;">전체 포트폴리오 집계 중...</div>';
        try {
            const loaded = await ensureAllDataLoaded();
            targetFunds = loaded.funds || [];

            const pnuMap = {};
            (loaded.assets || []).forEach(a => {
                const pnu = a.metadata?.pnu;
                if (a.fund_id && pnu) pnuMap[a.fund_id] = pnu;
            });
            window.fundToPnu = pnuMap;
        } catch (e) {
            console.error(e);
        }
    }
    // Use filtered data if available
    const filteredFunds = (typeof getFilteredData === 'function') ? getFilteredData() : targetFunds;
    window.lastTargetFunds = filteredFunds;
    
    const snapshotDate = new Date('2026-03-31');
    const activeFunds = filteredFunds.filter(isActiveAumSnapshotFund);

    const aumMetric = getAumBasisMetric();
    const aumConfig = getAumMetricConfig(aumMetric);
    const totalAum = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, getMetricColumn('aum', aumMetric)), 0);
    const totalEquity = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, getMetricColumn('equity', aumMetric)), 0);
    const totalLoan = activeFunds.reduce((sum, f) => sum + getFundAmountWon(f, getMetricColumn('loan', aumMetric)), 0);
    const totalOther = totalAum - totalEquity - totalLoan;

    const mainValue = formatNumber(totalAum);
    const eqVal = formatNumber(totalEquity);
    const lnVal = formatNumber(totalLoan);
    const otVal = formatNumber(totalOther);

    const activeAssetFunds = filteredFunds.filter(isActiveAumSnapshotFund);
    const activeAssetRecords = getActiveAssetRecords(activeAssetFunds);
    const domesticAssetsCount = activeAssetRecords.filter(isDomesticAssetRecord).length;
    const overseasAssetsCount = activeAssetRecords.filter(isOverseasAssetRecord).length;
    const otherAssetsCount = Math.max(0, activeAssetRecords.length - domesticAssetsCount - overseasAssetsCount);

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
                <span>현재 운용 AUM (${aumConfig.label}, 2026.03.31 기준)</span>
                <div id="aumBasisToggle" class="segmented-control" data-active="${aumMetric}" onclick="toggleAumBasis()">
                    <div class="segment-slider"></div>
                    <div class="segment ${aumMetric === 'benchmark_aum' ? 'active' : ''}" data-val="benchmark_aum">약정</div>
                    <div class="segment ${aumMetric === 'invested_aum' ? 'active' : ''}" data-val="invested_aum">투입</div>
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
                <div class="kpi-label" style="margin-bottom:16px;">운용 기초자산</div>
                <div class="kpi-value" style="font-size:48px; font-weight:900; color:var(--text);">${activeAssetRecords.length}<span style="font-size:18px; font-weight:500; margin-left:4px; color:var(--muted);">개</span></div>
                <div style="margin-top:10px; color:#94a3b8; font-size:11px; line-height:1.5;">주소/PNU 확인 실물 부동산 기준<br>재간접, 증권, 포트폴리오 묶음 제외</div>
              </div>
              <div style="margin-top:24px; padding-top:20px; border-top:1px dashed #cbd5e1; display:grid; grid-template-columns: repeat(${otherAssetsCount > 0 ? 3 : 2}, 1fr); gap:12px;">
                <div class="kpi-sub">
                  <div class="kpi-sub-label">국내</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${domesticAssetsCount}<span style="font-size:12px; margin-left:2px;">개</span></div>
                </div>
                <div class="kpi-sub">
                  <div class="kpi-sub-label">해외</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${overseasAssetsCount}<span style="font-size:12px; margin-left:2px;">개</span></div>
                </div>
                ${otherAssetsCount > 0 ? `
                <div class="kpi-sub">
                  <div class="kpi-sub-label">기타</div>
                  <div class="kpi-sub-value" style="font-size:18px;">${otherAssetsCount}<span style="font-size:12px; margin-left:2px;">개</span></div>
                </div>` : ''}
              </div>
            </div>
          </div>

          <div class="detail-section" style="padding:40px; background:white; border-radius:24px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
            <h3 class="section-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:40px;">
              <span style="font-size:20px; font-weight:800;">연도별 포트폴리오 성장 궤적 (2010 - 2026)</span>
              <div class="chart-toggle-group" style="display:flex; background:#f1f5f9; padding:4px; border-radius:12px; gap:4px;">
                 <button id="toggle-aum" class="chart-toggle-btn ${currentChartMetric === 'aum' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('aum')">AUM</button>
                 <button id="toggle-equity" class="chart-toggle-btn ${currentChartMetric === 'equity' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('equity')">Equity</button>
                 <button id="toggle-loan" class="chart-toggle-btn ${currentChartMetric === 'loan' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('loan')">Loan</button>
                 <button id="toggle-count" class="chart-toggle-btn ${currentChartMetric === 'count' ? 'active' : ''}" style="padding:8px 20px; border-radius:10px;" onclick="switchMetric('count')">건수</button>
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
          .segmented-control[data-active="invested_aum"] .segment-slider { transform: translateX(100%); }
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

function toggleAumBasis() {
    currentAumBasis = getAumBasisMetric() === 'benchmark_aum' ? 'invested_aum' : 'benchmark_aum';
    window.currentAumBasis = currentAumBasis;
    renderAnalytics();
}

function switchScope(scope) {
    currentOrgScope = scope;
    window.currentOrgScope = currentOrgScope;
    renderAnalytics();
}

function renderNetChangeDetails(label) {
    const drillPanel = document.getElementById('drillDownResult');
    const targetFunds = (typeof getFilteredData === 'function') ? getFilteredData() : (window.lastTargetFunds || []);
    
    if (!drillPanel || targetFunds.length === 0) return;

    drillPanel.style.display = 'block';
    drillPanel.innerHTML = '<div style="text-align:center; padding:40px; color:var(--muted);">데이터 추출 중...</div>';

    let startDate, endDate, title;
    if (label === '2026 (Actual)') {
        startDate = new Date('2026-01-01'); endDate = new Date('2026-03-31'); title = '2026년 1분기';
    } else if (label === '2026 (Proj.)') {
        startDate = new Date('2026-04-01'); endDate = new Date('2026-12-31'); title = '2026년 잔여';
    } else {
        const year = parseInt(label, 10);
        startDate = new Date(`${year}-01-01`); endDate = new Date(`${year}-12-31`); title = `${year}년`;
    }

    const newlySetup = targetFunds.filter(f => {
        if (!isFundIncludedForCurrentMetric(f)) return false;
        const setupStr = getFundSetupDate(f);
        const setup = setupStr ? new Date(setupStr) : null;
        return setup && setup >= startDate && setup <= endDate;
    });

    const terminated = targetFunds.filter(f => {
        if (!isFundIncludedForCurrentMetric(f)) return false;
        const end = getFundEndDate(f);
        const d = end ? new Date(end) : null;
        return d && d >= startDate && d <= endDate;
    });

    const setupItems = groupItems(newlySetup, '+').sort((a, b) => b.aum - a.aum);
    const terminatedItems = groupItems(terminated, '-').sort((a, b) => b.aum - a.aum);
    const finalCount = setupItems.length + terminatedItems.length;

    if (finalCount === 0) {
        drillPanel.innerHTML = `<div class="drill-title">${title} 변동 내역</div><div class="no-results">해당 기간 내 변동 내역이 없습니다.</div>`;
        return;
    }

    const renderDrillSection = (sectionTitle, typeMark, items) => `
        <details class="drill-section" ${items.length ? 'open' : ''}>
            <summary>
                <span>${sectionTitle}</span>
                <span class="filter-chip" style="background:${typeMark === '+' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color:${typeMark === '+' ? '#10b981' : '#ef4444'};">${items.length}건</span>
            </summary>
            <div class="drill-list">
                ${items.length ? items.map(item => `
                    <div class="drill-item" onclick="openFundDetail('${item.key}', '${item.name}')">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <span class="filter-chip" style="background:${typeMark === '+' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color:${typeMark === '+' ? '#10b981' : '#ef4444'};">
                                ${typeMark === '+' ? '설정' : '청산'}
                            </span>
                            <span class="drill-name">${item.name}</span>
                        </div>
                        <span class="drill-amt">${currentChartMetric === 'count' ? `${item.aum}건` : formatNumber(item.aum)}</span>
                    </div>
                `).join('') : '<div class="no-results">해당 내역 없음</div>'}
            </div>
        </details>
    `;

    drillPanel.innerHTML = `
        <div class="drill-title">${title} 주요 변동 내역 (${finalCount}건, ${getMetricLabel(currentChartMetric)} 기준)</div>
        ${renderDrillSection('설정 펀드', '+', setupItems)}
        ${renderDrillSection('청산 펀드', '-', terminatedItems)}
    `;
    
    // Scroll to drill panel
    drillPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

        const activeInYear = getSnapshotFunds(targetFunds, cat, snapshotDate);

        if (currentChartMetric === 'count') return getActiveAssetRecords(activeInYear).length;
        return activeInYear.reduce((sum, f) => sum + getFundAmountWon(f, getMetricColumn(currentChartMetric)), 0);
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

    const domesticSeries = [];
    const overseasSeries = [];
    const otherSeries = [];

    categories.forEach(cat => {
        let snap;
        if (cat === '2026 (Actual)') snap = new Date('2026-03-31');
        else if (cat === '2026 (Proj.)') snap = new Date('2026-12-31');
        else snap = new Date(`${cat}-12-31`);

        const active = getSnapshotFunds(targetFunds, cat, snap);

        const overseas = active.filter(isOverseasFund);
        const domestic = active.filter(f => !isOverseasFund(f));

        if (currentChartMetric === 'count') {
            const activeAssets = getActiveAssetRecords(active);
            const domesticAssets = activeAssets.filter(isDomesticAssetRecord);
            const overseasAssets = activeAssets.filter(isOverseasAssetRecord);
            domesticSeries.push(domesticAssets.length);
            overseasSeries.push(overseasAssets.length);
            otherSeries.push(Math.max(0, activeAssets.length - domesticAssets.length - overseasAssets.length));
        } else {
            const column = getMetricColumn(currentChartMetric);
            domesticSeries.push(domestic.reduce((sum, f) => sum + getFundAmountWon(f, column), 0) / 1e12);
            overseasSeries.push(overseas.reduce((sum, f) => sum + getFundAmountWon(f, column), 0) / 1e12);
            otherSeries.push(0);
        }
    });

    const chartSeries = [
        { name: '국내', data: domesticSeries },
        { name: '해외', data: overseasSeries }
    ];
    if (currentChartMetric === 'count' && otherSeries.some(v => v > 0)) {
        chartSeries.push({ name: '기타', data: otherSeries });
    }

    const options = {
        series: chartSeries,
        chart: { type: 'bar', height: 450, stacked: true, toolbar: { show: false }, fontFamily: 'Pretendard Variable' },
        colors: currentChartMetric === 'count' && chartSeries.length === 3 ? ['#4f46e5', '#38bdf8', '#94a3b8'] : ['#4f46e5', '#38bdf8'],
        plotOptions: {
            bar: {
                columnWidth: '60%',
                borderRadius: 6,
                dataLabels: {
                    total: {
                        enabled: true,
                        offsetY: -10,
                        style: { fontSize: '11px', fontWeight: 900, colors: ['#334155'] },
                        formatter: val => formatHistoryChartValue(val)
                    }
                }
            }
        },
        dataLabels: { enabled: false },
        xaxis: { categories: categories, labels: { style: { fontSize: '10px' } } },
        yaxis: { labels: { formatter: val => formatHistoryChartValue(val) } },
        grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
        tooltip: {
            shared: true,
            intersect: false,
            custom: function ({ series, dataPointIndex, w }) {
                const label = w.globals.labels[dataPointIndex] || w.globals.categoryLabels[dataPointIndex] || '';
                const order = currentChartMetric === 'count' && series.length === 3 ? [2, 1, 0] : [1, 0];
                const rows = order.map(idx => {
                    const name = w.globals.seriesNames[idx];
                    const value = series[idx][dataPointIndex] || 0;
                    const color = w.globals.colors[idx];
                    const formattedValue = currentChartMetric === 'count'
                        ? `${value.toLocaleString()} 개`
                        : formatTrillionChartLabel(value);
                    return `
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:4px 0;">
                            <span style="display:flex; align-items:center; gap:8px;">
                                <span style="width:11px; height:11px; border-radius:50%; background:${color}; display:inline-block;"></span>
                                ${name}:
                            </span>
                            <strong>${formattedValue}</strong>
                        </div>
                    `;
                }).join('');
                return `
                    <div style="padding:10px 12px; min-width:150px;">
                        <div style="font-weight:700; color:#0f172a; margin-bottom:8px;">${label}</div>
                        ${rows}
                    </div>
                `;
            }
        },
        legend: { position: 'top', horizontalAlign: 'right' }
    };

    const el = document.querySelector(`#${chartId}`);
    if (el) {
        el.innerHTML = '';
        new ApexCharts(el, options).render();
    }
}

function formatTrillionChartLabel(value) {
    const num = Number(value) || 0;
    const sign = num < 0 ? '-' : '';
    const floored = Math.floor(Math.abs(num) * 100) / 100;
    const oneDecimal = Math.round(floored * 10) / 10 === floored;
    const fractionDigits = Number.isInteger(floored) ? 0 : (oneDecimal ? 1 : 2);
    return `${sign}${floored.toLocaleString(undefined, { minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 })}조`;
}

function formatHistoryChartValue(value) {
    if (currentChartMetric === 'count') return `${Math.round(value).toLocaleString()}개`;
    return formatTrillionChartLabel(value);
}

function renderDrillDown(year, category, metric) {
    const drillPanel = document.getElementById('drillDownResult');
    if (!drillPanel) return;
    drillPanel.innerHTML = `<div style="font-weight:700; margin-bottom:10px;">${year}년 심층 분석</div><div style="font-size:13px; color:var(--muted);">해당 시점의 포트폴리오 구성을 분석 중입니다...</div>`;
}

function isFundIncludedForCurrentMetric(fund) {
    return isAumCountedFund(fund);
}

function getFundAumSourceStatus(fund) {
    return cleanAssetText(fund?.metadata?.aum_status);
}

function isActiveAumSnapshotFund(fund) {
    return getFundAumSourceStatus(fund) === '운용'
        && isFundIncludedForCurrentMetric(fund)
        && (currentOrgScope === 'all' || isRAFund(fund));
}

function getSnapshotFunds(targetFunds, category, snapshotDate) {
    if (category === '2026 (Actual)') {
        return targetFunds.filter(isActiveAumSnapshotFund);
    }

    return targetFunds.filter(f => {
        if (!isFundIncludedForCurrentMetric(f)) return false;
        if (currentOrgScope === 'ra' && !isRAFund(f)) return false;
        const setupStr = getFundSetupDate(f);
        const setup = setupStr ? new Date(setupStr) : null;
        const endStr = getFundEndDate(f);
        const end = endStr ? new Date(endStr) : new Date('2099-12-31');
        if (category.startsWith('2026') && getFundAumSourceStatus(f) !== '운용') return false;
        return setup && setup <= snapshotDate && end > snapshotDate;
    });
}

function getActiveAssetRecords(activeFunds) {
    const activeFundIds = new Set((activeFunds || []).map(f => f.fund_id).filter(Boolean));
    const activeFundById = new Map((activeFunds || []).map(f => [f.fund_id, f]));
    const unique = new Map();
    (window.allFundAssets || []).forEach(asset => {
        if (!activeFundIds.has(asset.fund_id)) return;
        const fund = activeFundById.get(asset.fund_id);
        if (isExcludedPhysicalAssetRecord(asset, fund)) return;
        const key = getPhysicalAssetKey(asset);
        if (key && !unique.has(key)) unique.set(key, asset);
    });
    return Array.from(unique.values());
}

function cleanAssetText(value) {
    const text = String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return isValidKey(text) ? text : '';
}

function normalizePhysicalAddress(address) {
    let text = cleanAssetText(address).toLowerCase();
    if (!text) return '';
    text = text.split(',')[0].trim();
    [' 외 ', ' 및 '].forEach(marker => {
        if (text.includes(marker)) text = text.split(marker)[0].trim();
    });
    return text;
}

function isSpecificPhysicalAddress(address) {
    const text = normalizePhysicalAddress(address);
    if (!text) return false;
    const broadLocations = new Set(['대한민국', '북미', '유럽', '글로벌', '아시아', '미국', '영국', '네덜란드', '일본', '호주', '프랑스', '이탈리아', '스페인']);
    if (broadLocations.has(text)) return false;
    return text.length >= 8 && (/\d/.test(text) || text.split(' ').length >= 3);
}

function getPhysicalAssetKey(asset) {
    const metadata = asset?.metadata || {};
    const pnu = cleanAssetText(metadata.pnu);
    if (pnu) return `pnu:${pnu}`;

    const address = cleanAssetText(asset?.address || metadata.address);
    if (!isSpecificPhysicalAddress(address)) return null;
    return `addr:${normalizePhysicalAddress(address)}`;
}

function isExcludedPhysicalAssetRecord(asset, fund) {
    const assetMeta = asset?.metadata || {};
    const fundMeta = fund?.metadata || {};
    const text = [
        asset?.asset_name,
        asset?.asset_type,
        asset?.address,
        assetMeta.asset_name,
        assetMeta.asset_type,
        assetMeta.investment_sector,
        assetMeta.fund_type,
        assetMeta.investment_strategy,
        assetMeta.base_asset_class,
        assetMeta.asset_nature_class,
        fund?.fund_name,
        fundMeta.investment_sector,
        fundMeta.fund_type,
        fundMeta.investment_strategy,
        fundMeta.base_asset_class,
        fundMeta.asset_nature_class
    ].map(cleanAssetText).filter(Boolean).join(' ').toLowerCase();

    return [
        '재간접',
        '펀드오브펀드',
        'fund of fund',
        'fof',
        '지분증권',
        '포트폴리오',
        'portfolio'
    ].some(term => text.includes(term));
}

function getAssetLocationText(asset) {
    const metadata = asset?.metadata || {};
    return [
        metadata.asset_location_type,
        asset?.location_category,
        metadata.fund_location,
        asset?.address,
        asset?.asset_name
    ].filter(Boolean).join(' ');
}

function isOverseasAssetRecord(asset) {
    return /해외|북미|유럽|글로벌|아시아|미국|영국|일본|베트남|프랑스|이탈리아|스페인|호주/.test(getAssetLocationText(asset));
}

function isDomesticAssetRecord(asset) {
    const text = getAssetLocationText(asset);
    return !isOverseasAssetRecord(asset) && /국내|대한민국|서울|경기|인천|부산|대구|대전|광주|울산|세종|제주|강원|충북|충남|전북|전남|경북|경남/.test(text);
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

function applyFiltersAndShowList(page = 1) {
    // 필터 선택 여부 체크 (성능 최적화)
    const filters = window.analysisFilters || {};
    const hasFilter = Object.values(filters).some(arr => arr && arr.length > 0);
    
    const drillPanel = document.getElementById('drillDownResult');
    if (!drillPanel) {
        renderAnalytics().then(() => applyFiltersAndShowList(page));
        return;
    }

    if (!hasFilter) {
        drillPanel.style.display = 'block';
        drillPanel.innerHTML = `
            <div class="drill-title">조회 제한</div>
            <div style="padding:40px; text-align:center; background:rgba(245, 158, 11, 0.05); border:1px dashed #f59e0b; border-radius:16px; color:#d97706;">
                <div style="font-size:24px; margin-bottom:12px;">⚠️</div>
                <strong>최소 하나 이상의 상세 필터를 선택해 주세요.</strong><br>
                <span style="font-size:13px; opacity:0.8; margin-top:8px; display:block;">전체 데이터를 불러올 경우 시스템 속도가 저하될 수 있습니다.</span>
            </div>
        `;
        drillPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    let filteredFunds = (typeof getFilteredData === 'function') ? getFilteredData() : (window.lastTargetFunds || []);
    
    // Filter out inactive or 0 AUM funds to match the KPI chart and remove clutter
    filteredFunds = filteredFunds.filter(isActiveAumSnapshotFund);

    drillPanel.style.display = 'block';
    if (page === 1) {
        drillPanel.innerHTML = '<div style="text-align:center; padding:40px; color:var(--muted);">검색 결과를 생성 중입니다...</div>';
    }

    if (filteredFunds.length === 0) {
        drillPanel.innerHTML = `
            <div class="drill-title">조회 결과</div>
            <div style="padding:40px; text-align:center; background:#f8fafc; border-radius:16px; color:var(--muted);">
                조건에 맞는 운용 중인 펀드가 없습니다. 필터를 조정해 보세요.
            </div>
        `;
        return;
    }

    // Pagination constants
    const PAGE_SIZE = 30;
    const totalCount = filteredFunds.length;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    
    // Sort by AUM descending
    const aumMetric = getAumBasisMetric();
    const sortedFunds = [...filteredFunds].sort((a, b) => {
        return getFundAmountWon(b, getMetricColumn('aum', aumMetric)) - getFundAmountWon(a, getMetricColumn('aum', aumMetric));
    });

    // Get current page slice
    const startIdx = (page - 1) * PAGE_SIZE;
    const pagedFunds = sortedFunds.slice(startIdx, startIdx + PAGE_SIZE);

    const listHtml = pagedFunds.map(f => {
        const aum = getFundAmountWon(f, getMetricColumn('aum', aumMetric));
        const dept = f.dept || f.metadata?.department || '-';
        
        // Find linked assets and intelligently display the primary or matched one
        const assets = (window.allFundAssets || []).filter(a => a.fund_id === f.fund_id);
        let assetName = '-';
        
        if (assets.length > 0) {
            let matchedAsset = f.primary_asset_id ? assets.find(a => a.asset_id === f.primary_asset_id) : null;
            if (!matchedAsset) {
                const selectedAssetClass = window.analysisFilters?.base_asset_class || [];
                if (selectedAssetClass.length > 0) {
                    matchedAsset = assets.find(a => {
                        const name = a.asset_name || a.metadata?.asset_name || '';
                        if (selectedAssetClass.includes('물류센터')) return name.includes('물류') || name.includes('로지스') || name.includes('아레나스');
                        if (selectedAssetClass.includes('오피스')) return name.includes('타워') || name.includes('빌딩') || name.includes('스퀘어');
                        return false;
                    });
                }
            }
            if (!matchedAsset) matchedAsset = assets[0];
            
            assetName = matchedAsset.asset_name || matchedAsset.metadata?.asset_name || '-';
            
            if (assets.length > 1) {
                assetName += ` <span style="font-size:12px; font-weight:500; color:var(--muted);">(외 ${assets.length - 1}건)</span>`;
            }
        }

        return `
            <div class="drill-item" onclick="openFundDetailById('${f.fund_id}')" style="display:flex; align-items:center; padding:16px 24px;">
                <div style="width:36px; height:36px; background:#f1f5f9; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; margin-right:20px;">📂</div>
                
                <div style="flex: 0 0 320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:40px;">
                    <div class="drill-name" style="font-size:15px; font-weight:800; color:var(--text);">${f.fund_name}</div>
                    <div style="font-size:12px; color:var(--muted); margin-top:4px;">${dept}</div>
                </div>

                <div style="flex: 1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border-left:1px solid #f1f5f9; padding-left:40px;">
                    <div style="font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px; letter-spacing:0.5px;">ASSET PROFILE</div>
                    <div style="font-size:14px; font-weight:700; color:#6366f1;">${assetName}</div>
                </div>

                <div style="text-align:right; flex-shrink:0; margin-left:40px; min-width:100px;">
                    <div class="drill-amt" style="font-size:16px; font-weight:900; color:var(--accent);">${formatNumber(aum)}</div>
                    <div style="font-size:11px; color:var(--muted); font-weight:700; margin-top:2px;">AUM</div>
                </div>
            </div>
        `;
    }).join('');

    let paginationHtml = '';
    if (totalPages > 1) {
        paginationHtml = `
            <div class="analysis-pagination" style="margin-top:32px; padding:20px 0; border-top:1px solid #f1f5f9; display:flex; justify-content:center; align-items:center; gap:12px;">
        `;
        for (let i = 1; i <= totalPages; i++) {
            const isActive = i === page;
            paginationHtml += `
                <span onclick="applyFiltersAndShowList(${i})" style="
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: ${isActive ? '800' : '500'};
                    color: ${isActive ? 'var(--accent)' : 'var(--muted)'};
                    ${isActive ? 'text-decoration: underline; text-underline-offset: 4px;' : ''}
                ">${i}</span>
                ${i < totalPages ? '<span style="color:#e2e8f0; font-size:10px;">|</span>' : ''}
            `;
        }
        paginationHtml += '</div>';
    }

    drillPanel.innerHTML = `
        <div class="drill-title" style="margin-bottom:24px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <span>필터링된 자산 리스트</span>
                <span style="font-size:14px; font-weight:600; color:var(--muted); margin-left:8px;">총 ${totalCount}건</span>
            </div>
            ${totalPages > 1 ? `<span style="font-size:12px; color:var(--muted);">${page} / ${totalPages} 페이지</span>` : ''}
        </div>
        <div class="drill-list">
            ${listHtml}
        </div>
        ${paginationHtml}
    `;

    drillPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.applyFiltersAndShowList = applyFiltersAndShowList;
window.renderAnalytics = renderAnalytics;
window.switchMetric = switchMetric;
window.switchScope = switchScope;
window.toggleOrgScope = toggleOrgScope;
window.toggleAumBasis = toggleAumBasis;
