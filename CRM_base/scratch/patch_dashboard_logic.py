import os
import re

def patch_dashboard_logic():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update formatNumber to show more decimals for Jo
    content = content.replace("const jo = (num / 1000000000000).toFixed(1);", "const jo = (num / 1000000000000).toFixed(2);")

    # 2. Update the logic that populates globalSummary and filters out '청산'
    # We need to ensure that '운용' or active funds are counted and sectors are aggregated from metadata.
    
    new_analysis_logic = """
    // 1. Filter out liquidated funds for accurate AUM/Count
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

    // 2. Aggregate Sectors for Donut Chart
    const sectorMap = {};
    activeFunds.forEach(f => {
        const s = f.metadata?.sector || '미분류';
        sectorMap[s] = (sectorMap[s] || 0) + (f.metadata?.benchmark_aum || 0);
    });
    const sectorSeries = Object.values(sectorMap);
    const sectorLabels = Object.keys(sectorMap);

    detailPanel.innerHTML = `
      <div class="detail-header">
        <p class="card-tag tag-project" style="margin-bottom:10px;">GLOBAL MONITORING</p>
        <h2>RA부문 포트폴리오 통합 현황</h2>
        <p style="color:var(--muted); font-size:15px;">운용 중인 실시간 자산 집계 및 시계열 분석 리포트입니다. (청산 자산 제외)</p>
      </div>

      <div class="kpi-grid" style="grid-template-columns: 1.5fr 1fr;">
        <div class="kpi-card">
          <div class="kpi-label">전체 AUM (운용 기준)</div>
          <div class="kpi-value" style="font-size:36px; color:var(--accent);">${formatNumber(totalAum)}</div>
          <div class="kpi-sub" style="background:transparent; padding:0; margin-top:15px; display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; width:100%;">
             <div style="border-right:1px solid var(--line);">
                <label style="display:block; font-size:11px; color:var(--muted);">에쿼티</label>
                <span style="font-size:14px; color:var(--text);">${formatNumber(totalEquity)}</span>
             </div>
             <div style="border-right:1px solid var(--line);">
                <label style="display:block; font-size:11px; color:var(--muted);">대출</label>
                <span style="font-size:14px; color:var(--text);">${formatNumber(totalLoan)}</span>
             </div>
             <div>
                <label style="display:block; font-size:11px; color:var(--muted);">미실현가치</label>
                <span style="font-size:14px; color:var(--text);">${formatNumber(totalGap)}</span>
             </div>
          </div>
        </div>
        <div class="kpi-card" style="display:flex; flex-direction:column; justify-content:center;">
          <div class="kpi-label">운용 펀드 수</div>
          <div class="kpi-value" style="font-size:36px;">${activeFunds.length}<span style="font-size:18px; font-weight:500; margin-left:5px;">개</span></div>
          <p style="font-size:12px; color:var(--muted); margin-top:10px;">국내 및 해외 프로젝트 펀드 합계</p>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:32px;">
        <div class="detail-section" style="margin-bottom:0;">
          <h3 class="section-title">🏢 섹터별 자산 분포 (운용)</h3>
          <div id="sectorDonut"></div>
        </div>
        <div class="detail-section" style="margin-bottom:0;">
          <h3 class="section-title">📊 지역별 자산 비중</h3>
          <div id="regionDonut"></div>
        </div>
      </div>
    `;

    // Render Donut Charts with fresh data
    new ApexCharts(document.querySelector("#sectorDonut"), {
        series: sectorSeries,
        labels: sectorLabels,
        chart: { type: 'donut', height: 300, fontFamily: 'Pretendard Variable' },
        colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'],
        dataLabels: { enabled: false },
        legend: { position: 'bottom' },
        stroke: { width: 0 }
    }).render();
    """

    # Replace the old rendering logic in app.js
    # We'll look for where the detailPanel.innerHTML is set inside the analysis view
    content = re.sub(r'detailPanel\.innerHTML = `\s*<div class="detail-header">.*?<\/div>\s*<\/div>\s*`;', new_analysis_logic, content, flags=re.DOTALL)

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    patch_dashboard_logic()
