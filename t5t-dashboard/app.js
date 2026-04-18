const COLORS = {
  taskTypes: {
    "운용/관리": "#284b63",
    "신규검토": "#b85c38",
    "프로젝트": "#5b7961",
    "펀드·투자자": "#c98a58",
    "리스크·법무": "#3e5a7a",
    "내부·기타": "#8e95a3",
  },
  issues: {
    "딜 진행": "#3B82F6",
    "금융 구조": "#8B5CF6",
    "인허가/행정": "#F59E0B",
    "운용/관리": "#10B981",
    "리스크·법무": "#EF4444",
    "리스크/법무": "#EF4444",
    "투자자 대응": "#06B6D4",
    "신규검토": "#6B7280",
  },
  stakeholders: ["#284b63", "#b85c38", "#5b7961", "#c98a58", "#3e5a7a", "#06B6D4", "#8e95a3", "#9aa4b2"],
};

let dashData = null;
let charts = {};
let uiState = {
  intelligencePeriod: "all",
  stakeholderDrilldown: null,
  insight: {
    kind: null,
    key: null,
    groupBy: "none",
  },
};

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupModals();
  setupPeriodToggle();
  setupSyncButton();
  setupStakeholderBack();
  setupInsightGrouping();
  setupDragScroll();
  loadData();
});

function setupNav() {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.view).classList.add("active");
    });
  });
}

function setupModals() {
  bindModalClose("projectModal", "projectModalClose");
  bindModalClose("insightModal", "insightModalClose");
}

function bindModalClose(backdropId, closeButtonId) {
  const backdrop = document.getElementById(backdropId);
  const closeButton = document.getElementById(closeButtonId);
  if (!backdrop || !closeButton) return;

  closeButton.addEventListener("click", () => {
    backdrop.hidden = true;
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target.id === backdropId) backdrop.hidden = true;
  });
}

function setupPeriodToggle() {
  document.querySelectorAll(".period-toggle-btn").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.intelligencePeriod = button.dataset.period;
      uiState.stakeholderDrilldown = null;
      document.querySelectorAll(".period-toggle-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (dashData) renderIntelligence();
    });
  });
}

function setupSyncButton() {
  const button = document.getElementById("btn-sync");
  if (!button) return;

  button.addEventListener("click", async () => {
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!isLocal) {
      const githubUrl = "https://github.com/sjleeigisam-RA-IEO/Org_dashboard/actions/workflows/sync.yml";
      alert("배포 환경에서는 직접 동기화가 제한됩니다.\n\nGitHub Actions의 Run workflow로 최신 데이터를 갱신할 수 있습니다.");
      window.open(githubUrl, "_blank");
      return;
    }

    const original = button.innerHTML;
    button.innerHTML = '<span class="icon">…</span> 동기화 중';
    button.disabled = true;
    try {
      const response = await fetch("/api/sync");
      const result = await response.json();
      if (result.status === "success") {
        await loadData();
        alert("최신 데이터를 반영했습니다.");
      } else {
        alert(`동기화 실패: ${result.message || "알 수 없는 오류"}`);
      }
    } catch (error) {
      alert(`동기화 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      button.innerHTML = original;
      button.disabled = false;
    }
  });
}

function setupStakeholderBack() {
  const button = document.getElementById("stakeholder-back-btn");
  if (!button) return;
  button.addEventListener("click", () => {
    uiState.stakeholderDrilldown = null;
    renderStakeholderPanel(getCurrentIntelligencePeriod());
  });
}

function setupInsightGrouping() {
  document.querySelectorAll(".modal-segment-btn").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.insight.groupBy = button.dataset.group;
      document.querySelectorAll(".modal-segment-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (uiState.insight.kind && uiState.insight.key) {
        renderInsightModalContent();
      }
    });
  });
}

function setupDragScroll() {
  document.querySelectorAll("[data-drag-scroll='y']").forEach((container) => {
    let isDragging = false;
    let startY = 0;
    let startScrollTop = 0;

    container.addEventListener("pointerdown", (event) => {
      isDragging = true;
      startY = event.clientY;
      startScrollTop = container.scrollTop;
      container.classList.add("is-dragging");
      container.setPointerCapture(event.pointerId);
    });

    container.addEventListener("pointermove", (event) => {
      if (!isDragging) return;
      const delta = event.clientY - startY;
      container.scrollTop = startScrollTop - delta;
    });

    const stopDragging = (event) => {
      if (!isDragging) return;
      isDragging = false;
      container.classList.remove("is-dragging");
      if (event?.pointerId !== undefined && container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
    };

    container.addEventListener("pointerup", stopDragging);
    container.addEventListener("pointercancel", stopDragging);
    container.addEventListener("pointerleave", stopDragging);
  });
}

async function loadData() {
  try {
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const dataUrl = isLocal ? "/api/dashboard" : "data/dashboard.json";
    const response = await fetch(dataUrl);
    dashData = await response.json();

    document.getElementById("loading").style.display = "none";
    document.getElementById("view-overview").classList.add("active");

    renderOverview();
    renderSummary();
    updateSyncInfo();
  } catch (error) {
    document.getElementById("loading").innerHTML = `
      <div style="color:var(--accent); text-align:center;">
        데이터 로드에 실패했습니다.<br>
        <small>${escapeHtml(error.message)}</small>
      </div>
    `;
  }
}

function updateSyncInfo() {
  const meta = dashData?.sync_meta;
  if (!meta) return;
  const date = new Date(meta.synced_at);
  document.getElementById("sync-time").textContent =
    `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} 동기화`;
}

function renderOverview() {
  renderIntelligence();
  renderTrendChart();
  renderPulse();
}

function getCurrentIntelligencePeriod() {
  return dashData?.intelligence?.periods?.[uiState.intelligencePeriod] || null;
}

function renderIntelligence() {
  const period = getCurrentIntelligencePeriod();
  if (!period) return;
  renderMobileBrief(period);
  renderIssueModule(period);
  renderStakeholderPanel(period);
}

function renderMobileBrief(period) {
  const summary = document.getElementById("mobile-brief-summary");
  const count = document.getElementById("mobile-brief-count");
  const issueList = document.getElementById("mobile-issue-list");
  const keywordList = document.getElementById("mobile-keyword-list");
  const stakeholderList = document.getElementById("mobile-stakeholder-list");
  if (!summary || !count || !issueList || !keywordList || !stakeholderList) return;

  summary.textContent = `${period.label} 기준 핵심 이슈와 상위 접점만 빠르게 보여줍니다.`;
  count.textContent = `${period.total_logs}건`;

  const topIssues = (period.issue_categories || []).filter((item) => item.count > 0).slice(0, 3);
  issueList.innerHTML = topIssues.length
    ? topIssues
        .map(
          (item) => `
            <button class="mobile-pill-button" type="button" data-mobile-kind="issue" data-mobile-key="${escapeAttr(item.name)}">
              <span style="color:${COLORS.issues[item.name] || "#6B7280"}">${escapeHtml(item.name)}</span>
              <span class="mobile-pill-count">${item.count}건</span>
            </button>
          `
        )
        .join("")
    : '<div class="empty-state">핵심 이슈가 없습니다.</div>';

  const topKeywords = (period.top_keywords || []).slice(0, 6);
  keywordList.innerHTML = topKeywords.length
    ? topKeywords
        .map(
          (item) => `
            <button class="mobile-pill-button" type="button" data-mobile-kind="keyword" data-mobile-key="${escapeAttr(item.keyword)}">
              <span style="color:${COLORS.issues[item.category] || "#6B7280"}">#${escapeHtml(item.keyword)}</span>
              <span class="mobile-pill-count">${item.count}</span>
            </button>
          `
        )
        .join("")
    : '<div class="empty-state">핵심 키워드가 없습니다.</div>';

  const topStakeholders = (period.top_stakeholders || []).slice(0, 5);
  stakeholderList.innerHTML = topStakeholders.length
    ? topStakeholders
        .map(
          (item, index) => `
            <button class="mobile-rank-button" type="button" data-mobile-kind="stakeholder" data-mobile-key="${escapeAttr(item.name)}">
              <span class="mobile-rank-index">${index + 1}</span>
              <span>
                <span class="mobile-rank-name">${escapeHtml(item.name)}</span>
                <span class="mobile-rank-meta">${escapeHtml(item.type)}</span>
              </span>
              <span class="mobile-rank-count">${item.count}건</span>
            </button>
          `
        )
        .join("")
    : '<div class="empty-state">주요 상대방 데이터가 없습니다.</div>';

  document.querySelectorAll("[data-mobile-kind]").forEach((button) => {
    button.addEventListener("click", () => openInsightModal(button.dataset.mobileKind, button.dataset.mobileKey));
  });
}

function renderIssueModule(period) {
  const issueSummary = document.getElementById("issue-period-summary");
  const issueTotalBadge = document.getElementById("issue-total-badge");
  const riskBadge = document.getElementById("risk-signal-badge");
  const issueBars = document.getElementById("issue-bars");
  const keywordWrap = document.getElementById("issue-keywords");

  issueSummary.textContent = `${period.label} 기준으로 이슈를 집계했습니다.${period.compare_label ? ` ${period.compare_label} 대비 증감도 함께 봅니다.` : ""}`;
  issueTotalBadge.textContent = `${period.total_logs}건 분석`;

  if ((period.risk_signal?.delta || 0) > 0) {
    riskBadge.hidden = false;
    riskBadge.textContent = `리스크 증가 +${period.risk_signal.delta}`;
  } else {
    riskBadge.hidden = true;
  }

  const maxCount = Math.max(...period.issue_categories.map((item) => item.count), 1);
  issueBars.innerHTML = period.issue_categories
    .filter((item) => item.count > 0)
    .map((item) => {
      const deltaClass = item.delta > 0 ? "up" : item.delta < 0 ? "down" : "flat";
      const deltaLabel = item.delta > 0 ? `+${item.delta}` : `${item.delta}`;
      return `
        <div class="issue-bar-row" data-kind="issue" data-key="${escapeAttr(item.name)}" title="${escapeAttr(`${item.name}: ${item.count}건`)}">
          <div class="issue-bar-head">
            <div class="issue-bar-title">
              <span class="issue-dot" style="background:${COLORS.issues[item.name] || "#6B7280"}"></span>
              <span class="issue-name">${escapeHtml(item.name)}</span>
            </div>
            <div class="issue-meta">
              <span class="delta-pill ${deltaClass}">${escapeHtml(deltaLabel)}</span>
              <span class="issue-count">${item.count}건</span>
            </div>
          </div>
          <div class="issue-bar-track">
            <div class="issue-bar-fill" style="width:${(item.count / maxCount) * 100}%; background:${COLORS.issues[item.name] || "#6B7280"}"></div>
          </div>
        </div>
      `;
    })
    .join("");

  issueBars.querySelectorAll(".issue-bar-row").forEach((element) => {
    element.addEventListener("click", () => openInsightModal("issue", element.dataset.key));
  });

  if (!period.top_keywords.length) {
    keywordWrap.innerHTML = '<div class="empty-state">표시할 키워드가 없습니다.</div>';
    return;
  }

  keywordWrap.innerHTML = period.top_keywords
    .map((item) => `
      <button class="keyword-chip" type="button" data-kind="keyword" data-key="${escapeAttr(item.keyword)}" title="${escapeAttr(`${item.keyword} · ${item.count}건 · ${item.source}`)}">
        <strong style="color:${COLORS.issues[item.category] || "#6B7280"}">#${escapeHtml(item.keyword)}</strong>
        <small>${item.count}</small>
      </button>
    `)
    .join("");

  keywordWrap.querySelectorAll(".keyword-chip").forEach((element) => {
    element.addEventListener("click", () => openInsightModal("keyword", element.dataset.key));
  });
}

function renderStakeholderPanel(period) {
  renderStakeholderChart(period);
  renderStakeholderList(period);
  const backButton = document.getElementById("stakeholder-back-btn");
  backButton.hidden = !uiState.stakeholderDrilldown;
}

function buildStakeholderChartData(period) {
  if (!uiState.stakeholderDrilldown) {
    return {
      title: period.label,
      subtitle: "이해관계자 유형",
      items: period.stakeholder_types || [],
      mode: "types",
    };
  }

  const names = (period.top_stakeholders || []).filter((item) => item.type === uiState.stakeholderDrilldown);
  return {
    title: uiState.stakeholderDrilldown,
    subtitle: "하위 이해관계자",
    items: names.map((item) => ({ name: item.name, count: item.count, type: item.type })),
    mode: "names",
  };
}

function renderStakeholderChart(period) {
  const summary = document.getElementById("stakeholder-period-summary");
  const centerCopy = document.getElementById("stakeholder-center-copy");
  const chartData = buildStakeholderChartData(period);
  const canvas = document.getElementById("stakeholder-chart");
  if (!canvas) return;

  summary.textContent = !uiState.stakeholderDrilldown
    ? `${period.label} 기준 유형별 접점을 보여줍니다. 클릭하면 하위 항목으로 드릴다운됩니다.`
    : `${uiState.stakeholderDrilldown} 유형 안에서 자주 등장한 세부 상대방입니다.`;

  centerCopy.innerHTML = `<strong>${escapeHtml(chartData.title)}</strong>${escapeHtml(chartData.subtitle)}`;

  if (charts.stakeholder) charts.stakeholder.destroy();
  if (!chartData.items.length) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    centerCopy.innerHTML = "<strong>데이터 없음</strong>선택한 범위에 표시할 항목이 없습니다.";
    return;
  }

  charts.stakeholder = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: chartData.items.map((item) => item.name),
      datasets: [
        {
          data: chartData.items.map((item) => item.count),
          backgroundColor: COLORS.stakeholders.slice(0, chartData.items.length),
          borderColor: "rgba(255,253,249,0.95)",
          borderWidth: 3,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#667085",
            font: { family: "Pretendard Variable", size: 12 },
            padding: 12,
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        tooltip: {
          backgroundColor: "rgba(255, 253, 249, 0.95)",
          titleColor: "#1f2a37",
          bodyColor: "#1f2a37",
          borderColor: "rgba(31, 42, 55, 0.1)",
          borderWidth: 1,
          titleFont: { family: "Pretendard Variable" },
          bodyFont: { family: "Pretendard Variable" },
        },
      },
      onClick: (_, elements) => {
        if (!elements.length) return;
        const item = chartData.items[elements[0].index];
        if (!item) return;
        if (chartData.mode === "types") {
          uiState.stakeholderDrilldown = item.name;
          renderStakeholderPanel(period);
        } else {
          openInsightModal("stakeholder", item.name);
        }
      },
    },
  });
}

function renderStakeholderList(period) {
  const container = document.getElementById("stakeholder-list");
  const summary = document.getElementById("stakeholder-ranking-summary");

  const items = !uiState.stakeholderDrilldown
    ? period.top_stakeholders || []
    : (period.top_stakeholders || []).filter((item) => item.type === uiState.stakeholderDrilldown);

  summary.textContent = !uiState.stakeholderDrilldown
    ? "차트와 같은 높이를 유지하고, 내부만 스크롤됩니다."
    : `${uiState.stakeholderDrilldown} 안의 세부 이해관계자만 추렸습니다.`;

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">표시할 이해관계자 신호가 없습니다.</div>';
    return;
  }

  container.innerHTML = items
    .map((item) => `
      <div class="stakeholder-row" data-key="${escapeAttr(item.name)}" title="${escapeAttr(`${item.name}: ${item.count}건`)}">
        <div class="stakeholder-main">
          <div class="stakeholder-name">${escapeHtml(item.name)}</div>
          <div class="stakeholder-type">${escapeHtml(item.type)}</div>
        </div>
        <div class="stakeholder-count">${item.count}건</div>
      </div>
    `)
    .join("");

  container.querySelectorAll(".stakeholder-row").forEach((element) => {
    element.addEventListener("click", () => openInsightModal("stakeholder", element.dataset.key));
  });
}

function renderTrendChart() {
  const trend = dashData?.trend;
  const canvas = document.getElementById("chart-trend");
  if (!trend || !canvas) return;
  if (charts.trend) charts.trend.destroy();

  const datasets = trend.task_types.map((taskType) => ({
    label: taskType,
    data: trend.series[taskType],
    backgroundColor: COLORS.taskTypes[taskType] || "#6b7280",
    borderRadius: 4,
    borderSkipped: false,
    maxBarThickness: 32,
  }));

  charts.trend = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels: trend.weeks.map(formatWeek), datasets },
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
}

function renderPulse() {
  const weeks = dashData?.sorted_weeks || [];
  const pulse = dashData?.pulse || [];
  const container = document.getElementById("pulse-timeline");
  if (!container) return;

  const monthGroups = [];
  const isFirstWeekOfMonth = {};
  let currentMonth = "";
  let count = 0;

  weeks.forEach((week) => {
    const month = `${parseInt(week.split("-")[1], 10)}월`;
    if (month !== currentMonth) {
      if (currentMonth) monthGroups.push({ month: currentMonth, count });
      currentMonth = month;
      count = 1;
      isFirstWeekOfMonth[week] = true;
    } else {
      count += 1;
    }
  });
  if (currentMonth) monthGroups.push({ month: currentMonth, count });

  const headerHtml = `
    <div class="timeline-row" style="padding-left:240px; padding-bottom:4px; margin-bottom:0;">
      ${monthGroups.map((group) => `<div style="width:${group.count * 28}px; text-align:center; font-size:12px; font-weight:700; color:var(--muted); border-left:1px solid rgba(31,42,55,0.15);">${group.month}</div>`).join("")}
    </div>
  `;

  const rowsHtml = pulse.slice(0, 20).map((project, index) => {
    const dots = weeks.map((week) => {
      const countForWeek = project.weekly[week] || 0;
      const logs = (project.logs || []).filter((log) => log.week === week);
      const title = logs.length
        ? `${week} (${countForWeek}건)\n${logs.map((log) => shortenText(log.summary || log.log_name || "내용 없음", 24)).slice(0, 2).join(" / ")}`
        : `${week} (0건)`;
      const size = countForWeek ? 10 + Math.min(countForWeek / 5, 1) * 6 : 12;
      const alpha = countForWeek ? 0.4 + Math.min(countForWeek / 5, 1) * 0.6 : 1;
      const borderLeft = isFirstWeekOfMonth[week] ? "border-left:1px solid rgba(31,42,55,0.15);" : "";
      return `
        <div style="width:28px;height:36px;display:flex;justify-content:center;align-items:center;flex-shrink:0;${borderLeft}">
          <div class="timeline-dot ${countForWeek ? "" : "empty"}" style="${countForWeek ? `background:rgba(40,75,99,${alpha});width:${size}px;height:${size}px;` : ""}" data-project-id="${escapeAttr(project.id)}" data-project-week="${week}" title="${escapeAttr(title)}"></div>
        </div>
      `;
    }).join("");

    const rankClass = index === 0 ? "rank-1" : index === 1 ? "rank-2" : index === 2 ? "rank-3" : "rank-n";
    return `
      <div class="timeline-row project-row" data-project-id="${escapeAttr(project.id)}" style="border-bottom:1px solid rgba(31,42,55,0.06); padding:0; height:36px; cursor:pointer">
        <div style="width:240px;display:flex;align-items:center;gap:8px;flex-shrink:0;height:100%">
          <span class="rank ${rankClass}" style="transform:scale(0.85);margin-left:-4px;flex-shrink:0;">${index + 1}</span>
          <span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-grow:1;font-weight:700;color:var(--accent-2);" title="${escapeAttr(project.name)}">${escapeHtml(project.name)}</span>
          <span style="font-size:12px;font-weight:700;color:var(--accent);flex-shrink:0;width:28px;text-align:right;margin-right:8px;">${project.total_mentions}</span>
        </div>
        <div style="display:flex;align-items:center;height:100%">${dots}</div>
      </div>
    `;
  }).join("");

  container.innerHTML = `<div style="min-width:max-content; padding-right:24px;">${headerHtml}${rowsHtml}</div>`;
  container.querySelectorAll(".project-row").forEach((element) => {
    element.addEventListener("click", () => openProjectModal(element.dataset.projectId));
  });
  container.querySelectorAll(".timeline-dot").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      openProjectModal(element.dataset.projectId, element.dataset.projectWeek);
    });
  });
}

function openProjectModal(projectId, targetWeek = null) {
  let project = (dashData?.top_projects || []).find((item) => item.id === projectId);
  if (!project) project = (dashData?.pulse || []).find((item) => item.id === projectId);
  if (!project) return;

  let logs = project.logs || [];
  if (targetWeek) logs = logs.filter((log) => log.week === targetWeek);

  document.getElementById("projectModalTitle").textContent = targetWeek ? `${project.name} (${formatWeek(targetWeek)})` : project.name;
  document.getElementById("projectModalSummary").innerHTML = `주요 작성자 <strong>${escapeHtml((project.top_writers || []).join(", ") || "-")}</strong><br>총 ${logs.length || project.count || 0}건의 로그가 있습니다.`;

  const list = document.getElementById("projectModalList");
  if (!logs.length) {
    list.innerHTML = '<div class="empty-state">관련 로그가 없습니다.</div>';
  } else {
    list.innerHTML = logs
      .map((log) => `
        <div class="modal-item">
          <div class="modal-item-name">${escapeHtml(log.writer)} · ${escapeHtml(log.task_type)} · ${escapeHtml(formatWeek(log.week))}</div>
          <div class="modal-item-meta">${escapeHtml(log.summary || cleanLogName(log.log_name))}</div>
        </div>
      `)
      .join("");
  }

  document.getElementById("projectModal").hidden = false;
}

function openInsightModal(kind, key) {
  uiState.insight.kind = kind;
  uiState.insight.key = key;
  uiState.insight.groupBy = "none";
  document.querySelectorAll(".modal-segment-btn").forEach((button) => button.classList.toggle("active", button.dataset.group === "none"));
  renderInsightModalContent();
  document.getElementById("insightModal").hidden = false;
}

function getInsightDetails() {
  const period = getCurrentIntelligencePeriod();
  if (!period) return { title: "", summary: "", records: [] };

  const key = uiState.insight.key;
  if (uiState.insight.kind === "issue") {
    const issue = (period.issue_categories || []).find((item) => item.name === key);
    return {
      title: key,
      summary: `${period.label} 기준 ${issue?.count || 0}건입니다. 기본 정렬은 최신순입니다.`,
      records: period.details?.issues?.[key] || [],
    };
  }
  if (uiState.insight.kind === "keyword") {
    const keyword = (period.top_keywords || []).find((item) => item.keyword === key);
    return {
      title: `#${key}`,
      summary: `${period.label} 기준 ${keyword?.count || 0}건이며, 규칙 또는 자동 추론으로 분류된 키워드입니다.`,
      records: period.details?.keywords?.[key] || [],
    };
  }
  if (uiState.insight.kind === "stakeholder") {
    const stakeholder = (period.top_stakeholders || []).find((item) => item.name === key);
    return {
      title: key,
      summary: `${stakeholder?.type || "이해관계자"} · ${period.label} 기준 ${stakeholder?.count || 0}건입니다.`,
      records: period.details?.stakeholders?.[key] || [],
    };
  }
  if (uiState.insight.kind === "stakeholderType") {
    return {
      title: key,
      summary: `${period.label} 기준 해당 유형의 대표 로그입니다.`,
      records: period.details?.stakeholder_types?.[key] || [],
    };
  }
  return { title: "", summary: "", records: [] };
}

function renderInsightModalContent() {
  const { title, summary, records } = getInsightDetails();
  document.getElementById("insightModalTitle").textContent = title || "세부 항목";
  document.getElementById("insightModalSummary").textContent = summary;

  const list = document.getElementById("insightModalList");
  if (!records.length) {
    list.innerHTML = '<div class="empty-state">표시할 세부 로그가 없습니다.</div>';
    return;
  }

  const sortedRecords = [...records].sort((a, b) => (b.work_date || "").localeCompare(a.work_date || ""));
  if (uiState.insight.groupBy === "none") {
    list.innerHTML = sortedRecords.map(renderInsightRecord).join("");
    return;
  }

  const grouped = new Map();
  sortedRecords.forEach((record) => {
    const key = uiState.insight.groupBy === "project" ? record.primary_project : record.writer;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });

  list.innerHTML = Array.from(grouped.entries())
    .map(([groupName, items]) => `
      <div class="modal-group">
        <div class="modal-group-title">${escapeHtml(groupName)} · ${items.length}건</div>
        ${items.map(renderInsightRecord).join("")}
      </div>
    `)
    .join("");
}

function renderInsightRecord(record) {
  const projectText = record.projects?.join(", ") || "미연결";
  const detailLink = record.url
    ? `<a class="modal-item-link" href="${escapeAttr(record.url)}" target="_blank" rel="noreferrer">원문 열기</a>`
    : "";
  const remarks = record.remarks ? `<div class="modal-item-meta" style="color:var(--muted)">비고: ${escapeHtml(record.remarks)}</div>` : "";
  return `
    <div class="modal-item">
      <div class="modal-item-name">${escapeHtml(record.writer)} · ${escapeHtml(record.task_type)} · ${escapeHtml(record.work_date || "-")}</div>
      <div class="modal-item-meta">${escapeHtml(record.summary || cleanLogName(record.log_name || ""))}</div>
      ${remarks}
      <div class="modal-item-meta" style="color:var(--muted)">프로젝트: ${escapeHtml(projectText)} · 라인: ${escapeHtml(record.line || "-")}</div>
      ${detailLink}
    </div>
  `;
}

function renderSummary() {
  const blocks = dashData?.summary_blocks || [];
  const container = document.getElementById("summary-content");
  if (!container) return;
  if (!blocks.length) {
    container.innerHTML = '<div style="color:var(--muted);text-align:center;">요약본 데이터가 없습니다.</div>';
    return;
  }

  let html = "";
  blocks.forEach((block) => {
    const type = block.type;
    const content = block[type];
    if (!content) return;
    let textHtml = "";
    if (content.rich_text) {
      textHtml = content.rich_text.map((segment) => {
        let text = escapeHtml(segment.plain_text || "");
        if (segment.annotations?.bold) text = `<strong>${text}</strong>`;
        if (segment.annotations?.italic) text = `<em>${text}</em>`;
        if (segment.annotations?.strikethrough) text = `<del>${text}</del>`;
        if (segment.annotations?.underline) text = `<u>${text}</u>`;
        if (segment.annotations?.code) text = `<code>${text}</code>`;
        if (segment.href) text = `<a href="${segment.href}" target="_blank" style="color:var(--accent); text-decoration:underline;">${text}</a>`;
        return text;
      }).join("").replace(/\n/g, "<br>");
    }

    if (type === "heading_1") html += `<h1 style="font-size:24px; font-weight:800; margin:32px 0 16px;">${textHtml}</h1>`;
    else if (type === "heading_2") html += `<h2 style="font-size:20px; font-weight:800; margin:24px 0 12px;">${textHtml}</h2>`;
    else if (type === "heading_3") html += `<h3 style="font-size:16px; font-weight:800; margin:16px 0 8px;">${textHtml}</h3>`;
    else if (type === "paragraph") html += `<p style="margin-bottom:12px;">${textHtml}</p>`;
    else if (type === "bulleted_list_item") html += `<ul><li style="margin-bottom:6px;">${textHtml}</li></ul>`;
    else if (type === "numbered_list_item") html += `<ol><li style="margin-bottom:6px;">${textHtml}</li></ol>`;
    else if (type === "quote") html += `<blockquote style="border-left:4px solid var(--accent); padding-left:16px; margin:16px 0; color:var(--muted); font-style:italic;">${textHtml}</blockquote>`;
    else if (type === "divider") html += `<hr style="border:none; border-top:1px solid var(--line); margin:32px 0;">`;
    else if (textHtml) html += `<div style="margin-bottom:12px;">${textHtml}</div>`;
  });

  html = html.replace(/<\/ul>\s*<ul>/g, "");
  html = html.replace(/<\/ol>\s*<ol>/g, "");
  html = html.replace(/<ul>/g, '<ul style="margin:4px 0 16px; padding-left:24px;">');
  html = html.replace(/<ol>/g, '<ol style="margin:4px 0 16px; padding-left:24px;">');
  container.innerHTML = html;
}

function cleanLogName(value) {
  const text = (value || "").trim();
  if (!text.includes("|")) return text || "업무 로그";
  return text.split("|").at(-1).trim();
}

function shortenText(value, limit = 26) {
  const text = (value || "").trim().replace(/\s+/g, " ");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

function formatWeek(value) {
  if (!value) return "-";
  const parts = value.split("-");
  if (parts.length < 3) return value;
  return `${parts[1]}/${parts[2]}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}
