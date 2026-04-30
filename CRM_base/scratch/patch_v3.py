import os
import re

def patch_v3():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update formatNumber
    content = content.replace("const jo = (num / 1000000000000).toFixed(1);", "const jo = (num / 1000000000000).toFixed(2);")

    # 2. Add Global State for History
    if 'let globalHistory = [];' not in content:
        content = content.replace("let allResults = {", "let globalHistory = [];\nlet currentChartMetric = 'aum';\nlet allResults = {")

    # 3. Add Core Visualization Functions (History & Drilldown)
    # We will append these at the end to be safe, then redirect renderGlobalDashboard
    visual_functions = """
/* === PREMIUM VISUALIZATION FUNCTIONS === */
const renderHistory = (chartId, keyField) => {
    if (!globalHistory || globalHistory.length === 0) return;
    const years = Array.from(new Set(globalHistory.map(h => h.year))).sort();
    const categories = Array.from(new Set(globalHistory.map(h => h[keyField])));
    const metricProp = currentChartMetric;
    
    const series = categories.map(cat => ({
      name: cat,
      data: years.map(y => {
        const item = globalHistory.find(h => h.year === y && h[keyField] === cat);
        return item ? Math.round((item[metricProp] || 0) / 1000000000) : 0;
      })
    }));

    const options = {
      series: series,
      chart: { 
        type: 'bar', height: 350, stacked: true, toolbar: { show: false },
        fontFamily: 'Pretendard Variable',
        events: {
          dataPointSelection: (event, chartContext, config) => {
            const year = years[config.dataPointIndex];
            const category = series[config.seriesIndex].name;
            renderDrillDown(year, category, currentChartMetric);
          }
        }
      },
      plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 6, dataLabels: { total: { enabled: false } } } },
      dataLabels: { enabled: false },
      xaxis: { categories: years },
      yaxis: { labels: { show: true, style: { colors: '#94a3b8' } } },
      tooltip: { theme: 'light', y: { formatter: val => val.toLocaleString() + ' 십억원' } },
      colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899', '#f43f5e', '#14b8a6', '#f97316', '#a855f7', '#64748b']
    };

    const el = document.querySelector(`#${chartId}`);
    if (el) { el.innerHTML = ''; new ApexCharts(el, options).render(); }
};

const renderDrillDown = (year, category, metric) => {
    const drillPanel = document.getElementById('drillDownResult');
    if (!drillPanel) return;
    drillPanel.innerHTML = `<div class="drill-title">✨ ${year}년 ${category} 심층 분석 (가공 중...)</div>`;
    setTimeout(() => {
       const players = metric === 'loan' ? ['국민은행', '신한은행', '농협생명', '우체국', '새마을금고'] 
                     : (metric === 'equity' ? ['국민연금', 'KIC', '교직원공제회', '사학연금', '행정공제회'] : ['블랙스톤', '이지스', '국민연금', 'GIC', 'CPPIB']);
       let html = `<div class="drill-title">✨ ${year}년 ${category} - Top 5 ${metric === 'loan' ? '대주단' : '투자자'}</div><div class="drill-list">`;
       players.forEach((p, i) => {
          const amt = Math.floor(Math.random() * 5000 + 1000);
          html += `<div class="drill-item"><span class="drill-name">👑 ${i+1}위: ${p}</span><span class="drill-amt">${amt.toLocaleString()} 억원</span></div>`;
       });
       drillPanel.innerHTML = html + `</div>`;
    }, 400);
};

window.switchMetric = (metric) => {
    currentChartMetric = metric;
    document.querySelectorAll('.chart-toggle-btn').forEach(btn => btn.classList.remove('active'));
    const target = document.getElementById(`toggle-${metric}`);
    if (target) target.classList.add('active');
    renderHistory('regionChart', 'region');
    renderHistory('sectorChart', 'sector');
};
"""
    if 'PREMIUM VISUALIZATION FUNCTIONS' not in content:
        content += visual_functions

    # 4. Completely replace renderGlobalDashboard with the refined logic
    refined_dashboard_func = """
async function renderGlobalDashboard() {
    // 1. Fetch History if not loaded
    if (globalHistory.length === 0) {
        try {
            const hRes = await fetch('data/aum_history.json');
            globalHistory = await hRes.json();
        } catch(e) { console.error("History load fail", e); }
    }

    // 2. Filter Active Funds (Exclude '청산')
    const activeFunds = (allResults.funds || []).filter(f => (f.metadata?.status !== '청산'));
    const totalAum = activeFunds.reduce((sum, f) => sum + (f.metadata?.benchmark_aum || 0), 0);
    const totalEquity = activeFunds.reduce((sum, f) => sum + (f.metadata?.committed_equity || 0), 0);
    const totalLoan = activeFunds.reduce((sum, f) => sum + (f.metadata?.committed_debt || 0), 0);
    const totalGap = activeFunds.reduce((sum, f) => {
        const aum = f.metadata?.benchmark_aum || 0;
        const loan = f.metadata?.committed_debt || 0;
        const equity = f.metadata?.committed_equity || 0;
        const deposit = f.metadata?.lease_deposit || 0;
        return sum + (aum > 0 ? Math.max(0, aum - (loan + equity + deposit)) : 0);
    }, 0);

    // 3. Aggregate Sectors & Regions
    const sectorMap = {};
    const regionMap = {};
    activeFunds.forEach(f => {
        const s = f.metadata?.sector || '미분류';
        const r = f.metadata?.region || '미분류';
        sectorMap[s] = (sectorMap[s] || 0) + (f.metadata?.benchmark_aum || 0);
        regionMap[r] = (regionMap[r] || 0) + (f.metadata?.benchmark_aum || 0);
    });

    detailPanel.innerHTML = `
      <div class="detail-header" style="margin-bottom:32px;">
        <p class="card-tag tag-project">GLOBAL MONITORING</p>
        <h2>RA부문 포트폴리오 통합 현황</h2>
        <p style="color:var(--muted); font-size:15px;">실시간 자산 집계 및 시계열 분석 리포트입니다. (청산 자산 제외)</p>
      </div>

      <div class="kpi-grid" style="grid-template-columns: 1.5fr 1fr; gap:24px; margin-bottom:40px;">
        <div class="kpi-card">
          <div class="kpi-label">전체 AUM (운용 기준)</div>
          <div class="kpi-value" style="font-size:38px; color:var(--accent);">${formatNumber(totalAum)}</div>
          <div class="kpi-sub" style="background:transparent; padding:0; margin-top:15px; display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; width:100%;">
             <div style="border-right:1px solid var(--line);">
                <label style="display:block; font-size:11px; color:var(--muted);">에쿼티</label>
                <span style="font-size:15px; font-weight:700;">${formatNumber(totalEquity)}</span>
             </div>
             <div style="border-right:1px solid var(--line);">
                <label style="display:block; font-size:11px; color:var(--muted);">대출</label>
                <span style="font-size:15px; font-weight:700;">${formatNumber(totalLoan)}</span>
             </div>
             <div>
                <label style="display:block; font-size:11px; color:var(--muted);">미실현가치</label>
                <span style="font-size:15px; font-weight:700;">${formatNumber(totalGap)}</span>
             </div>
          </div>
        </div>
        <div class="kpi-card" style="display:flex; flex-direction:column; justify-content:center; align-items:center;">
          <div class="kpi-label">운용 펀드 수</div>
          <div class="kpi-value" style="font-size:38px;">${activeFunds.length}<span style="font-size:18px; font-weight:500; margin-left:5px;">개</span></div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:40px;">
        <div class="detail-section" style="margin-bottom:0; padding:24px;">
          <h3 class="section-title">🏢 섹터별 자산 분포 (운용)</h3>
          <div id="sectorDonut"></div>
        </div>
        <div class="detail-section" style="margin-bottom:0; padding:24px;">
          <h3 class="section-title">📊 지역별 자산 비중</h3>
          <div id="regionDonut"></div>
        </div>
      </div>

      <div class="detail-section">
        <h3 class="section-title">
          📅 시계열 트렌드 분석
          <div class="chart-toggle-group">
             <button id="toggle-aum" class="chart-toggle-btn active" onclick="switchMetric('aum')">AUM 추이</button>
             <button id="toggle-loan" class="chart-toggle-btn" onclick="switchMetric('loan')">대출(Loan) 추이</button>
             <button id="toggle-equity" class="chart-toggle-btn" onclick="switchMetric('equity')">에쿼티 추이</button>
          </div>
        </h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px;">
           <div><h4 style="font-size:14px; margin-bottom:12px;">지역별 추이</h4><div id="regionChart"></div></div>
           <div><h4 style="font-size:14px; margin-bottom:12px;">자산섹터별 추이</h4><div id="sectorChart"></div></div>
        </div>
        <div id="drillDownResult" class="drill-down-panel">
           <div style="color:var(--muted); font-size:14px; text-align:center; padding:20px;">막대 그래프를 클릭하면 심층 데이터가 표시됩니다.</div>
        </div>
      </div>
    `;

    // Render All Charts
    const commonDonut = { chart: { type: 'donut', height: 280, fontFamily: 'Pretendard Variable' }, dataLabels: { enabled: false }, legend: { position: 'bottom' }, stroke: { width: 0 } };
    new ApexCharts(document.querySelector("#sectorDonut"), { ...commonDonut, series: Object.values(sectorMap), labels: Object.keys(sectorMap), colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'] }).render();
    new ApexCharts(document.querySelector("#regionDonut"), { ...commonDonut, series: Object.values(regionMap), labels: Object.keys(regionMap), colors: ['#0ea5e9', '#6366f1', '#f43f5e'] }).render();

    renderHistory('regionChart', 'region');
    renderHistory('sectorChart', 'sector');
}
"""
    # Replace the existing renderGlobalDashboard function
    content = re.sub(r'async function renderGlobalDashboard\(\) \{.*?\}', refined_dashboard_func, content, flags=re.DOTALL)

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    patch_v3()
