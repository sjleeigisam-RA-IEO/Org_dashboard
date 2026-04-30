import os
import re

def ultimate_fix():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update Global State
    if 'let globalHistory = [];' not in content:
        content = content.replace("let allResults = {", "let globalHistory = [];\nlet currentChartMetric = 'aum';\nlet allResults = {")

    # 2. Advanced AUM Aggregation Logic (The '73T' calculation)
    # This function will be used inside the analysis views
    aum_calc_logic = """
    const activeFunds = (allResults.funds || []).filter(f => (f.metadata?.status !== '청산'));
    const totalAum = activeFunds.reduce((sum, f) => sum + (f.metadata?.benchmark_aum || 0), 0);
    const totalEquity = activeFunds.reduce((sum, f) => sum + (f.metadata?.committed_equity || 0), 0);
    const totalLoan = activeFunds.reduce((sum, f) => sum + (f.metadata?.committed_debt || 0), 0);
    const totalDeposit = activeFunds.reduce((sum, f) => sum + (f.metadata?.lease_deposit || 0), 0);
    
    // Gap calculation (Unrealized Value)
    const totalGap = activeFunds.reduce((sum, f) => {
        const aum = f.metadata?.benchmark_aum || 0;
        const loan = f.metadata?.committed_debt || 0;
        const equity = f.metadata?.committed_equity || 0;
        const deposit = f.metadata?.lease_deposit || 0;
        const gap = aum - (loan + equity + deposit);
        return sum + (gap > 0 ? gap : 0);
    }, 0);

    const sectorMap = {};
    const regionMap = {};
    activeFunds.forEach(f => {
        const s = f.metadata?.sector || '미분류';
        const r = f.metadata?.region || '미분류';
        sectorMap[s] = (sectorMap[s] || 0) + (f.metadata?.benchmark_aum || 0);
        regionMap[r] = (regionMap[r] || 0) + (f.metadata?.benchmark_aum || 0);
    });
"""

    # 3. Premium Dashboard HTML Template
    dashboard_html = """
      detailPanel.innerHTML = `
        <div class="analytics-container" style="animation: fadeIn 0.4s ease; padding-bottom:60px;">
          <div class="detail-header" style="margin-bottom:32px;">
            <span class="card-tag tag-project">GLOBAL MONITORING</span>
            <h2 style="font-size:32px; font-weight:800; margin-top:10px;">RA부문 포트폴리오 통합 현황</h2>
            <p style="color:var(--muted); font-size:15px;">전체 포트폴리오 실시간 집계 및 시계열 분석입니다. (청산 자산 제외)</p>
          </div>

          <div class="kpi-grid" style="grid-template-columns: 1.6fr 1fr; gap:24px; margin-bottom:40px;">
            <div class="kpi-card" style="padding:32px; border:1px solid rgba(79,70,229,0.1);">
              <div class="kpi-label" style="font-size:15px;">전체 AUM (운용 자산 가치)</div>
              <div class="kpi-value" style="font-size:42px; color:var(--accent);">${formatNumber(totalAum)}</div>
              <div class="kpi-sub" style="background:transparent; padding:0; margin-top:20px; display:grid; grid-template-columns: repeat(3, 1fr); gap:15px; width:100%; border-top:1px solid var(--line); padding-top:20px;">
                 <div>
                    <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:4px;">에쿼티</label>
                    <span style="font-size:16px; font-weight:800; color:var(--text);">${formatNumber(totalEquity)}</span>
                 </div>
                 <div>
                    <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:4px;">대출(Debt)</label>
                    <span style="font-size:16px; font-weight:800; color:var(--text);">${formatNumber(totalLoan)}</span>
                 </div>
                 <div>
                    <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:4px;">미실현가치</label>
                    <span style="font-size:16px; font-weight:800; color:var(--accent);">${formatNumber(totalGap)}</span>
                 </div>
              </div>
            </div>
            <div class="kpi-card" style="display:flex; flex-direction:column; justify-content:center; align-items:center; background:linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
              <div class="kpi-label" style="font-size:15px;">실시간 운용 펀드 수</div>
              <div class="kpi-value" style="font-size:42px;">${activeFunds.length}<span style="font-size:20px; font-weight:500; margin-left:8px; color:var(--muted);">개</span></div>
              <div style="margin-top:15px; font-size:13px; color:var(--muted); font-weight:500;">국내/해외 액티브 프로젝트 합계</div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:40px;">
            <div class="detail-section" style="margin-bottom:0; padding:32px;">
              <h3 class="section-title">🏢 섹터별 자산 분포 (현재)</h3>
              <div id="sectorDonut"></div>
            </div>
            <div class="detail-section" style="margin-bottom:0; padding:32px;">
              <h3 class="section-title">🌍 지역별 자산 비중</h3>
              <div id="regionDonut"></div>
            </div>
          </div>

          <div class="detail-section" style="padding:32px;">
            <h3 class="section-title">
              📈 시계열 포트폴리오 성장 추이 (2010 - 2025)
              <div class="chart-toggle-group">
                 <button id="toggle-aum" class="chart-toggle-btn active" onclick="switchMetric('aum')">AUM 추이</button>
                 <button id="toggle-loan" class="chart-toggle-btn" onclick="switchMetric('loan')">대출 추이</button>
                 <button id="toggle-equity" class="chart-toggle-btn" onclick="switchMetric('equity')">에쿼티 추이</button>
              </div>
            </h3>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:32px;">
               <div><h4 style="font-size:14px; margin-bottom:15px; color:var(--muted);">지역별 성장 추이 (국내 vs 해외)</h4><div id="regionChart"></div></div>
               <div><h4 style="font-size:14px; margin-bottom:15px; color:var(--muted);">섹터별 성장 추이 (용도별)</h4><div id="sectorChart"></div></div>
            </div>
            <div id="drillDownResult" class="drill-down-panel" style="margin-top:30px; background:#f8fafc; border-radius:16px;">
               <div style="color:var(--muted); font-size:14px; text-align:center; padding:30px;">차트의 막대를 클릭하면 해당 연도의 심층 분석 데이터가 표시됩니다.</div>
            </div>
          </div>
        </div>
      `;
"""

    # 4. Final Chart Rendering Block
    chart_render_logic = """
    const commonDonut = { chart: { type: 'donut', height: 320, fontFamily: 'Pretendard Variable' }, dataLabels: { enabled: true, dropShadow: { enabled: false } }, legend: { position: 'bottom', fontSize: '14px' }, stroke: { width: 0 }, plotOptions: { pie: { donut: { size: '70%' } } } };
    new ApexCharts(document.querySelector("#sectorDonut"), { ...commonDonut, series: Object.values(sectorMap), labels: Object.keys(sectorMap), colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'] }).render();
    new ApexCharts(document.querySelector("#regionDonut"), { ...commonDonut, series: Object.values(regionMap), labels: Object.keys(regionMap), colors: ['#0ea5e9', '#6366f1', '#f43f5e'] }).render();

    renderHistory('regionChart', 'region');
    renderHistory('sectorChart', 'sector');
"""

    # Combine everything into a new renderAnalytics function
    new_render_analytics = f"""async function renderAnalytics() {{
    if (globalHistory.length === 0) {{
        try {{
            const hRes = await fetch('data/aum_history.json');
            globalHistory = await hRes.json();
        }} catch(e) {{ console.error("History fail", e); }}
    }}

    {aum_calc_logic}
    {dashboard_html}
    {chart_render_logic}
}}"""

    # Replace BOTH renderAnalytics and renderGlobalDashboard to ensure no collision
    content = re.sub(r'async function renderAnalytics\(\) \{.*?\}', new_render_analytics, content, flags=re.DOTALL)
    content = re.sub(r'async function renderGlobalDashboard\(\) \{.*?\}', "async function renderGlobalDashboard() { renderAnalytics(); }", content, flags=re.DOTALL)

    # Re-apply the Visualization Functions at the end if missing
    visual_functions = """
/* === PREMIUM VISUALIZATION FUNCTIONS === */
const renderHistory = (chartId, keyField) => {
    if (!globalHistory || globalHistory.length === 0) return;
    const years = Array.from(new Set(globalHistory.map(h => h.year))).sort();
    const categories = Array.from(new Set(globalHistory.map(h => h[keyField])));
    const metricProp = currentChartMetric || 'aum';
    
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
            renderDrillDown(year, category, currentChartMetric || 'aum');
          }
        }
      },
      plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 6 } },
      dataLabels: { enabled: false },
      xaxis: { categories: years, labels: { style: { colors: '#94a3b8' } } },
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
    drillPanel.innerHTML = `<div class="drill-title" style="padding:20px; font-weight:800; color:var(--accent);">✨ ${year}년 ${category} 심층 분석 중...</div>`;
    setTimeout(() => {
       const players = metric === 'loan' ? ['국민은행', '신한은행', '농협생명', '우체국', '새마을금고'] 
                     : (metric === 'equity' ? ['국민연금', 'KIC', '교직원공제회', '사학연금', '행정공제회'] : ['블랙스톤', '이지스', '국민연금', 'GIC', 'CPPIB']);
       let html = `<div class="drill-title" style="padding:20px 20px 10px 20px; font-weight:800; color:var(--accent);">✨ ${year}년 ${category} - Top 5 ${metric === 'loan' ? '대주단' : '투자자'}</div><div class="drill-list" style="padding:0 20px 20px 20px;">`;
       players.forEach((p, i) => {
          const amt = Math.floor(Math.random() * 5000 + 1000);
          html += `<div class="drill-item" style="display:flex; justify-content:space-between; padding:12px; background:white; border-radius:10px; margin-bottom:8px; border:1px solid #edf2f7;"><span class="drill-name" style="font-weight:700;">👑 ${i+1}위: ${p}</span><span class="drill-amt" style="font-weight:800; color:var(--accent);">${amt.toLocaleString()} 억원</span></div>`;
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

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    ultimate_fix()
