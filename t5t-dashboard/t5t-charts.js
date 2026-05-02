/**
 * T5T Chart Module
 * Handles all Chart.js rendering and updates.
 */
const T5TCharts = {
    instances: {},

    /**
     * Render the Task Type Trend Chart (Stacked Bar)
     */
    renderTrend(trendData, colors) {
        const canvas = document.getElementById("chart-trend");
        if (!trendData || !canvas) return;
        if (this.instances.trend) this.instances.trend.destroy();

        const datasets = trendData.task_types.map((taskType) => ({
            label: taskType,
            data: trendData.series[taskType],
            backgroundColor: colors.taskTypes[taskType] || "#6b7280",
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 32,
        }));

        this.instances.trend = new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: { 
                labels: trendData.weeks.map(w => w.replace("-W", "주 (") + ")"), 
                datasets 
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color: "#667085",
                            font: { size: 12, family: "Pretendard Variable" },
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: "rectRounded",
                        },
                    },
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: "#667085", font: { size: 11, family: "Pretendard Variable" } } },
                    y: { stacked: true, grid: { color: "rgba(31,42,55,0.06)" }, ticks: { color: "#667085", font: { size: 11, family: "Pretendard Variable" } } },
                },
            },
        });
    },

    renderStakeholder(chartData, colors, onPointClick) {
        const container = document.getElementById("stakeholder-chart-container");
        const centerCopy = document.getElementById("stakeholder-center-copy");
        if (!container) return;

        // 물리적 캔버스 초기화 (이벤트 리스너 완전 제거)
        container.innerHTML = '<canvas id="stakeholder-chart"></canvas>';
        const canvas = document.getElementById("stakeholder-chart");
        const ctx = canvas.getContext("2d");

        centerCopy.innerHTML = `<strong>${chartData.title}</strong>${chartData.subtitle}`;

        if (!chartData || !chartData.items || !chartData.items.length) {
            centerCopy.innerHTML = "<strong>데이터 없음</strong>";
            return;
        }

        new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: chartData.items.map((item) => item.name),
                datasets: [{
                    data: chartData.items.map((item) => item.count),
                    backgroundColor: colors.stakeholders.slice(0, chartData.items.length),
                    borderColor: "#ffffff",
                    borderWidth: 2,
                    hoverOffset: 8,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "65%",
                animation: { duration: 400 }, // 애니메이션 단축으로 충돌 방지
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color: "#667085",
                            font: { family: "Pretendard Variable", size: 11 },
                            padding: 10,
                            usePointStyle: true,
                            pointStyle: "circle",
                        },
                    },
                    tooltip: { enabled: true }
                },
                onClick: (_, elements) => {
                    if (elements.length && onPointClick) {
                        onPointClick(chartData.items[elements[0].index]);
                    }
                },
            },
        });
    }
};
