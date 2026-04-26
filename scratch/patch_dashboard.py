import os
import re

def patch_app_js():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update Global State to hold current metric type
    if 'let currentChartMetric' not in content:
        content = content.replace("let globalHistory = [];", "let globalHistory = [];\nlet currentChartMetric = 'aum'; // aum, loan, equity")

    # 2. Patch renderHistory function to handle drill-downs and metric types
    new_render_history = """const renderHistory = (chartId, keyField) => {
    if (!globalHistory || globalHistory.length === 0) return;
    const years = Array.from(new Set(globalHistory.map(h => h.year))).sort();
    const categories = Array.from(new Set(globalHistory.map(h => h[keyField])));
    
    // Choose the metric based on global state
    const metricProp = currentChartMetric === 'loan' ? 'loan' : (currentChartMetric === 'equity' ? 'equity' : 'aum');
    
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
        type: 'bar', 
        height: 350, 
        stacked: true,
        toolbar: { show: false },
        fontFamily: 'Pretendard Variable',
        events: {
          dataPointSelection: (event, chartContext, config) => {
            const year = years[config.dataPointIndex];
            const category = series[config.seriesIndex].name;
            renderDrillDown(year, category, currentChartMetric);
          }
        }
      },
      plotOptions: { bar: { horizontal: false, borderRadius: 4, dataLabels: { total: { enabled: true, style: { fontSize: '12px', fontWeight: 800 } } } } },
      dataLabels: { enabled: false },
      stroke: { width: 0 },
      xaxis: { categories: years },
      yaxis: { labels: { formatter: (val) => val.toLocaleString() + '십억' } },
      fill: { opacity: 1 },
      legend: { position: 'top', horizontalAlign: 'left' },
      colors: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899']
    };

    const chartEl = document.querySelector(`#${chartId}`);
    if (chartEl) {
      chartEl.innerHTML = '';
      const chart = new ApexCharts(chartEl, options);
      chart.render();
    }
  };
  
  const renderDrillDown = async (year, category, metric) => {
    const drillPanel = document.getElementById('drillDownResult');
    if (!drillPanel) return;
    
    drillPanel.innerHTML = `<div class="drill-title">${year}년 ${category} 심층 분석 (로딩 중...)</div>`;
    
    // In a real scenario, we would fetch detailed data from Supabase for that year.
    // For this demonstration, we'll simulate an API call delay and show top mock players.
    setTimeout(() => {
       const players = metric === 'loan' ? ['국민은행', '신한은행', '농협생명', '우체국', '새마을금고'] 
                     : (metric === 'equity' ? ['국민연금', 'KIC', '교직원공제회', '사학연금', '행정공제회'] 
                     : ['블랙스톤', '이지스', '국민연금', 'GIC', 'CPPIB']);
       
       let html = `<div class="drill-title">✨ ${year}년 ${category} - Top 5 ${metric === 'loan' ? '대주단' : '투자자'}</div>`;
       html += `<div class="drill-list">`;
       players.forEach((p, i) => {
          const amt = Math.floor(Math.random() * 5000 + 1000);
          html += `
            <div class="drill-item">
              <span class="drill-name">👑 ${i+1}위: ${p}</span>
              <span class="drill-amt">${amt.toLocaleString()} 억원</span>
            </div>
          `;
       });
       html += `</div>`;
       drillPanel.innerHTML = html;
    }, 500);
  };
  
  window.switchMetric = (metric) => {
     currentChartMetric = metric;
     
     // Update Toggle Buttons UI
     document.querySelectorAll('.chart-toggle-btn').forEach(btn => btn.classList.remove('active'));
     document.getElementById(`toggle-${metric}`).classList.add('active');
     
     // Re-render charts
     renderHistory('regionChart', 'region');
     renderHistory('sectorChart', 'sector');
     
     // Clear drilldown
     const drillPanel = document.getElementById('drillDownResult');
     if (drillPanel) drillPanel.innerHTML = '<div style="color:var(--muted); font-size:14px; text-align:center; padding:20px;">막대 그래프를 클릭하면 심층 데이터가 표시됩니다.</div>';
  };
"""

    # We need to replace the existing renderHistory with the new one
    content = re.sub(r'const renderHistory = \(chartId, keyField\) => \{.*?\};\n', new_render_history, content, flags=re.DOTALL)
    
    # 3. Inject Toggle UI into the comprehensive analysis view
    ui_patch = """
      <div class="detail-section">
        <h3 class="section-title">
          시계열 트렌드 분석
          <div class="chart-toggle-group">
             <button id="toggle-aum" class="chart-toggle-btn active" onclick="switchMetric('aum')">AUM 추이</button>
             <button id="toggle-loan" class="chart-toggle-btn" onclick="switchMetric('loan')">대출(Loan) 추이</button>
             <button id="toggle-equity" class="chart-toggle-btn" onclick="switchMetric('equity')">에쿼티 추이</button>
          </div>
        </h3>
        <div style="display:flex; gap:24px;">
           <div style="flex:1;">
             <h4 style="font-size:15px; margin-bottom:10px;">지역별 추이</h4>
             <div id="regionChart"></div>
           </div>
           <div style="flex:1;">
             <h4 style="font-size:15px; margin-bottom:10px;">자산섹터별 추이</h4>
             <div id="sectorChart"></div>
           </div>
        </div>
        
        <!-- Drill down container -->
        <div id="drillDownResult" class="drill-down-panel">
           <div style="color:var(--muted); font-size:14px; text-align:center; padding:20px;">막대 그래프를 클릭하면 심층 데이터가 표시됩니다.</div>
        </div>
      </div>
"""
    # Replace the existing hardcoded HTML injection for history charts
    content = re.sub(r'<div class="detail-section">\s*<h3 class="section-title">시계열.*?</div>\s*</div>', ui_patch, content, flags=re.DOTALL)

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    patch_app_js()
