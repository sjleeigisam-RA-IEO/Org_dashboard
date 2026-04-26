import os
import re

def patch_region_donut():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # Add Region aggregation and Donut rendering
    region_logic = """
    // 3. Aggregate Regions for Donut Chart
    const regionMap = {};
    activeFunds.forEach(f => {
        const r = f.metadata?.region || '미분류';
        regionMap[r] = (regionMap[r] || 0) + (f.metadata?.benchmark_aum || 0);
    });
    const regionSeries = Object.values(regionMap);
    const regionLabels = Object.keys(regionMap);

    // Render Sector Donut
    new ApexCharts(document.querySelector("#sectorDonut"), {
        series: sectorSeries,
        labels: sectorLabels,
        chart: { type: 'donut', height: 300, fontFamily: 'Pretendard Variable' },
        colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'],
        dataLabels: { enabled: false },
        legend: { position: 'bottom' },
        stroke: { width: 0 }
    }).render();

    // Render Region Donut
    new ApexCharts(document.querySelector("#regionDonut"), {
        series: regionSeries,
        labels: regionLabels,
        chart: { type: 'donut', height: 300, fontFamily: 'Pretendard Variable' },
        colors: ['#0ea5e9', '#6366f1', '#f43f5e'],
        dataLabels: { enabled: false },
        legend: { position: 'bottom' },
        stroke: { width: 0 }
    }).render();
    """

    # Replace the sector donut rendering with both sector and region donuts
    content = re.sub(r'// Render Donut Charts.*?\}\)\.render\(\);', region_logic, content, flags=re.DOTALL)

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    patch_region_donut()
