function initAnalysisFilters() {
    const filterCols = [
        { key: 'notion_vehicle_class', label: 'Vehicle 구분' },
        { key: 'sector', label: '투자섹터' },
        { key: 'notion_investment_strategy_class', label: '투자전략' },
        { key: 'notion_business_stage_class', label: '사업단계' },
        { key: 'notion_asset_nature_class', label: '자산성격' }
    ];

    const grid = document.getElementById('filterGrid');
    if (!grid) return;
    grid.innerHTML = '';

    filterCols.forEach(col => {
        const values = [...new Set(allFunds.map(f => f[col.key] || f.metadata?.[col.key] || '미분류'))]
            .filter(v => v !== '미분류')
            .sort();

        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';

        const label = document.createElement('label');
        label.innerText = col.label;

        const select = document.createElement('select');
        select.id = `filter-${col.key}`;
        select.innerHTML = '<option value="">전체</option>' + values.map(v => `<option value="${v}">${v}</option>`).join('');
        select.value = analysisFilters[col.key] || '';

        select.onchange = (e) => {
            analysisFilters[col.key] = e.target.value;
            renderPortfolioChart();
        };

        filterItem.appendChild(label);
        filterItem.appendChild(select);
        grid.appendChild(filterItem);
    });
}

function resetAnalysisFilters() {
    analysisFilters = {};
    window.analysisFilters = analysisFilters;
    initAnalysisFilters();
    renderPortfolioChart();
}

function getFilteredData() {
    let filteredFunds = [...allFunds];

    Object.keys(analysisFilters).forEach(key => {
        const val = analysisFilters[key];
        if (val) {
            filteredFunds = filteredFunds.filter(f => (f[key] || f.metadata?.[key]) === val);
        }
    });

    const fundIds = new Set(filteredFunds.map(f => f.fund_id));
    const filteredAssets = allFundAssets.filter(a => fundIds.has(a.fund_id));

    return { funds: filteredFunds, assets: filteredAssets };
}

function setAnalysisView(view) {
    analysisView = view;
    window.analysisView = analysisView;
    const btns = document.querySelectorAll('#analysisControls .toggle-buttons:first-child button');
    btns.forEach(b => {
        if ((b.getAttribute('onclick') || '').includes(view)) b.classList.add('active');
        else b.classList.remove('active');
    });
    renderPortfolioChart();
}

function setAnalysisMode(mode) {
    analysisMode = mode;
    window.analysisMode = analysisMode;
    renderPortfolioChart();
}

function renderPortfolioChart() {
    const chartEl = document.getElementById('portfolioChart');
    if (!chartEl) return;

    const filtered = getFilteredData();
    const funds = filtered.funds;
    const assets = filtered.assets;
    const mode = analysisMode;
    const view = analysisView;

    let series = [];
    let categories = [];
    let chartType = 'bar';
    let isStacked = true;

    if (view === 'year') {
        const years = Array.from({ length: 17 }, (_, i) => 2010 + i);
        categories = years.map(y => y.toString());

        const dataDomestic = years.map(y => calculateTotal(funds.filter(f => {
            const sy = new Date(f.setup_date).getFullYear();
            const my = f.maturity_date ? new Date(f.maturity_date).getFullYear() : 2099;
            return sy <= y && my >= y && f.location === '\uad6d\ub0b4';
        }), assets, mode));

        const dataOverseas = years.map(y => calculateTotal(funds.filter(f => {
            const sy = new Date(f.setup_date).getFullYear();
            const my = f.maturity_date ? new Date(f.maturity_date).getFullYear() : 2099;
            return sy <= y && my >= y && f.location === '\ud574\uc678';
        }), assets, mode));

        series = [
            { name: '\uad6d\ub0b4', data: dataDomestic },
            { name: '\ud574\uc678', data: dataOverseas }
        ];
    } else {
        const filterKey = view === 'sector' ? 'sector' : 'notion_investment_strategy_class';
        const uniqueValues = [...new Set(funds.map(f => f[filterKey] || f.metadata?.[filterKey] || '기타'))].filter(Boolean);

        const chartData = uniqueValues.map(v => {
            const groupFunds = funds.filter(f => (f[filterKey] || f.metadata?.[filterKey] || '기타') === v);
            return calculateTotal(groupFunds, assets, mode);
        });

        chartType = 'donut';
        isStacked = false;
        series = chartData;
        categories = uniqueValues;
    }

    const options = {
        series: series,
        chart: {
            type: chartType,
            height: 450,
            stacked: isStacked,
            fontFamily: 'Pretendard Variable, sans-serif',
            toolbar: { show: false }
        },
        colors: ['#4f46e5', '#38bdf8', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#64748b'],
        plotOptions: {
            bar: { borderRadius: 6, columnWidth: '60%' },
            pie: {
                donut: {
                    size: '70%',
                    labels: {
                        show: true,
                        total: {
                            show: true,
                            label: 'TOTAL',
                            formatter: w => {
                                const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                return mode === 'count' ? `${total}건` : `${(total / 1e12).toFixed(1)}조`;
                            }
                        }
                    }
                }
            }
        },
        tooltip: {
            y: { formatter: v => mode === 'count' ? `${v}건` : `${(v / 1000000000000).toFixed(1)}조 원` }
        },
        legend: { position: 'bottom' },
        dataLabels: { enabled: false }
    };

    if (chartType === 'bar') {
        options.xaxis = { categories: categories };
        options.yaxis = { labels: { formatter: v => mode === 'count' ? v : (v / 1e12).toFixed(0) + '조' } };
    } else {
        options.labels = categories;
    }

    chartEl.innerHTML = '';
    new ApexCharts(chartEl, options).render();

    renderAnalysisResults(funds);
}

function calculateTotal(funds, assets, mode) {
    if (mode === 'count') return funds.length;

    let total = 0;
    funds.forEach(f => {
        const fundAssets = assets.filter(a => a.fund_id === f.fund_id);
        if (mode === 'aum') {
            total += fundAssets.reduce((sum, a) => sum + (parseFloat(a.aum) || 0), 0);
        } else if (mode === 'loan') {
            total += fundAssets.reduce((sum, a) => sum + (parseFloat(a.loan_amount) || 0), 0);
        } else if (mode === 'equity') {
            total += fundAssets.reduce((sum, a) => sum + ((parseFloat(a.aum) || 0) - (parseFloat(a.loan_amount) || 0)), 0);
        }
    });
    return total;
}

function renderAnalysisResults(filteredFunds) {
    const resultsContainer = document.getElementById('analysisResults');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = '';

    if (filteredFunds.length === 0) {
        resultsContainer.innerHTML = '<div style="padding:40px; text-align:center; color:var(--muted);">필터 조건에 맞는 데이터가 없습니다.</div>';
        return;
    }

    const groups = {};
    filteredFunds.forEach(f => {
        const key = f.sector || '미분류';
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    });

    Object.keys(groups).sort().forEach(groupName => {
        const groupEl = document.createElement('div');
        groupEl.className = 'result-group';
        groupEl.innerHTML = `
            <div class="group-title">${groupName} (${groups[groupName].length})</div>
            <div class="result-list">
                ${groups[groupName].map(f => `
                    <div class="result-item" onclick="showDrawerDetail('${f.fund_id}')">
                        <div class="item-name">${f.fund_name}</div>
                        <div class="item-meta">${f.fund_id} | ${f.location} | ${f.notion_investment_strategy_class || '-'}</div>
                    </div>
                `).join('')}
            </div>
        `;
        resultsContainer.appendChild(groupEl);
    });
}

window.initAnalysisFilters = initAnalysisFilters;
window.resetAnalysisFilters = resetAnalysisFilters;
window.getFilteredData = getFilteredData;
window.setAnalysisView = setAnalysisView;
window.setAnalysisMode = setAnalysisMode;
window.renderPortfolioChart = renderPortfolioChart;
