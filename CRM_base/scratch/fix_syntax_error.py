import os

def fix_syntax_error():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Find where renderAnalytics starts
    start_line = -1
    for i, line in enumerate(lines):
        if 'async function renderAnalytics()' in line:
            start_line = i
            break
    
    if start_line == -1:
        print("Could not find renderAnalytics")
        return

    # Find the end of the broken block (we'll look for the next major function or the end)
    # Based on the view_file, line 762 seems to be the end of the broken block
    # But let's just replace from start_line to where fetchGlobalSummary starts
    end_line = -1
    for i in range(start_line, len(lines)):
        if 'async function fetchGlobalSummary()' in lines[i] or 'function renderGlobalDashboard()' in lines[i]:
            end_line = i
            break
    
    if end_line == -1: end_line = len(lines)

    # Prepare the CLEAN, CORRECT implementation
    new_implementation = """
async function renderAnalytics() {
    if (globalHistory.length === 0) {
        try {
            const hRes = await fetch('data/aum_history.json');
            globalHistory = await hRes.json();
        } catch(e) { console.error("History load fail", e); }
    }

    if (portfolioBasket.length > 0) {
        renderPortfolioAnalysis();
        return;
    }

    const activeFunds = (allResults.funds || []).filter(f => (f.metadata?.status !== '청산'));
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
        const s = f.metadata?.sector || '미분류';
        const r = f.metadata?.region || '미분류';
        sectorMap[s] = (sectorMap[s] || 0) + (f.metadata?.benchmark_aum || 0);
        regionMap[r] = (regionMap[r] || 0) + (f.metadata?.benchmark_aum || 0);
    });

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

    const commonDonut = { chart: { type: 'donut', height: 320, fontFamily: 'Pretendard Variable' }, dataLabels: { enabled: true, dropShadow: { enabled: false } }, legend: { position: 'bottom', fontSize: '14px' }, stroke: { width: 0 }, plotOptions: { pie: { donut: { size: '70%' } } } };
    new ApexCharts(document.querySelector("#sectorDonut"), { ...commonDonut, series: Object.values(sectorMap), labels: Object.keys(sectorMap), colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'] }).render();
    new ApexCharts(document.querySelector("#regionDonut"), { ...commonDonut, series: Object.values(regionMap), labels: Object.keys(regionMap), colors: ['#0ea5e9', '#6366f1', '#f43f5e'] }).render();

    renderHistory('regionChart', 'region');
    renderHistory('sectorChart', 'sector');
}

function renderGlobalDashboard() {
    renderAnalytics();
}

"""
    # Replace the block
    lines[start_line:end_line] = [new_implementation]

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.writelines(lines)

if __name__ == "__main__":
    fix_syntax_error()
