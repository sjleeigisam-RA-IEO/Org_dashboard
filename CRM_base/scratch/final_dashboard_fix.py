import os

def final_dashboard_fix():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # We need to make sure renderAnalytics fetches data if allResults is empty
    # And we'll use _supabase directly to get the master list for the global view.
    
    new_render_analytics = """
async function renderAnalytics() {
    let targetFunds = (allResults.funds || []);
    
    // 1. If no search results, fetch EVERYTHING for the Global Monitoring view
    if (targetFunds.length === 0) {
        detailPanel.innerHTML = '<div class="no-results" style="padding:100px;">전체 포트폴리오 집계 중...</div>';
        try {
            const { data } = await _supabase.from('funds').select('metadata').limit(1000);
            targetFunds = data || [];
        } catch(e) { console.error("Global fetch fail", e); }
    }

    // Load History if missing
    if (globalHistory.length === 0) {
        try {
            const hRes = await fetch('data/aum_history.json');
            globalHistory = await hRes.json();
        } catch(e) { console.error("History fail", e); }
    }

    // 2. Filter Active Funds (Exclude '청산')
    const activeFunds = targetFunds.filter(f => (f.metadata?.status !== '청산'));
    const totalAum = activeFunds.reduce((sum, f) => sum + (f.metadata?.benchmark_aum || 0), 0);
    const totalEquity = activeFunds.reduce((sum, f) => sum + (f.metadata?.committed_equity || 0), 0);
    const totalLoan = activeFunds.reduce((sum, f) => sum + (f.metadata?.committed_debt || 0), 0);
    const totalDeposit = activeFunds.reduce((sum, f) => sum + (f.metadata?.lease_deposit || 0), 0);
    
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
        const s = f.metadata?.sector || '기타';
        const r = f.metadata?.region || '국내';
        sectorMap[s] = (sectorMap[s] || 0) + (f.metadata?.benchmark_aum || 0);
        regionMap[r] = (regionMap[r] || 0) + (f.metadata?.benchmark_aum || 0);
    });

    const isGlobal = (allResults.funds || []).length === 0;

    detailPanel.innerHTML = `
        <div class="analytics-container" style="animation: fadeIn 0.4s ease; padding-bottom:60px;">
          <div class="detail-header" style="margin-bottom:32px;">
            <p class="card-tag tag-project" style="margin-bottom:10px;">${isGlobal ? 'GLOBAL MONITORING' : 'ANALYSIS RESULTS'}</p>
            <h2>RA부문 포트폴리오 통합 현황</h2>
            <p style="color:var(--muted); font-size:15px;">운용 중인 전체 자산의 실시간 집계 및 시계열 분석입니다. (청산 자산 제외)</p>
          </div>

          <div class="kpi-grid" style="grid-template-columns: 1.6fr 1fr; gap:24px; margin-bottom:40px;">
            <div class="kpi-card" style="padding:32px;">
              <div class="kpi-label">전체 AUM (운용 자산 가치)</div>
              <div class="kpi-value" style="font-size:42px; color:var(--accent);">${formatNumber(totalAum)}</div>
              <div class="kpi-sub" style="background:transparent; padding:0; margin-top:20px; display:grid; grid-template-columns: repeat(3, 1fr); gap:15px; width:100%; border-top:1px solid var(--line); padding-top:20px;">
                 <div>
                    <label style="display:block; font-size:12px; color:var(--muted);">에쿼티</label>
                    <span style="font-size:16px; font-weight:800;">${formatNumber(totalEquity)}</span>
                 </div>
                 <div>
                    <label style="display:block; font-size:12px; color:var(--muted);">대출(Debt)</label>
                    <span style="font-size:16px; font-weight:800;">${formatNumber(totalLoan)}</span>
                 </div>
                 <div>
                    <label style="display:block; font-size:12px; color:var(--muted);">미실현가치</label>
                    <span style="font-size:16px; font-weight:800; color:var(--accent);">${formatNumber(totalGap)}</span>
                 </div>
              </div>
            </div>
            <div class="kpi-card" style="display:flex; flex-direction:column; justify-content:center; align-items:center;">
              <div class="kpi-label">운용 펀드 수</div>
              <div class="kpi-value" style="font-size:42px;">${activeFunds.length}<span style="font-size:20px; font-weight:500; margin-left:8px; color:var(--muted);">개</span></div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:40px;">
            <div class="detail-section" style="margin-bottom:0; padding:32px;">
              <h3 class="section-title">🏢 섹터별 자산 분포</h3>
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

    // Render Charts
    const commonDonut = { chart: { type: 'donut', height: 320, fontFamily: 'Pretendard Variable' }, dataLabels: { enabled: true }, legend: { position: 'bottom', fontSize: '14px' }, stroke: { width: 0 }, plotOptions: { pie: { donut: { size: '70%' } } } };
    new ApexCharts(document.querySelector("#sectorDonut"), { ...commonDonut, series: Object.values(sectorMap), labels: Object.keys(sectorMap), colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'] }).render();
    new ApexCharts(document.querySelector("#regionDonut"), { ...commonDonut, series: Object.values(regionMap), labels: Object.keys(regionMap), colors: ['#0ea5e9', '#6366f1', '#f43f5e'] }).render();

    renderHistory('regionChart', 'region');
    renderHistory('sectorChart', 'sector');
}
"""
    # Replace the renderAnalytics function block correctly
    # We will look for async function renderAnalytics() { ... }
    # Since we replaced it in the last step, let's find it.
    import re
    content = re.sub(r'async function renderAnalytics\(\) \{.*?\}', new_render_analytics, content, flags=re.DOTALL)

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    final_dashboard_fix()
