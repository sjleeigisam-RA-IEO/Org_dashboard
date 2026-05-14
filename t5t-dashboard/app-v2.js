const COLORS = {
  taskTypes: { "운용/관리": "#284b63", "신규검토": "#b85c38", "프로젝트": "#5b7961", "펀드·투자자": "#c98a58", "리스크·법무": "#3e5a7a", "내부·기타": "#8e95a3" },
  issues: { "딜 진행": "#3B82F6", "금융 구조": "#8B5CF6", "인허가/행정": "#F59E0B", "운용/관리": "#10B981", "리스크·법무": "#EF4444", "투자자 대응": "#06B6D4", "신규검토": "#6B7280", "기타": "#8e95a3" },
  stakeholders: ["#365f72", "#a76548", "#6d846f", "#b98659", "#536477", "#8d8072", "#7f8a94", "#5f6f66"],
};

let dashData = null;
let uiState = {
  intelligencePeriod: "current",
  datePreset: "this_week",
  selectedYear: new Date().getFullYear().toString(),
  selectedMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  customStart: "",
  customEnd: "",
  stakeholderDrilldown: null,
  insight: { kind: null, key: null, groupBy: "none" },
  project: { id: null, groupBy: "none" }
};

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupModals();
  setupDateFilters();
  setupStakeholderBack();
  setupInsightGrouping();
  setupProjectGrouping();
  setupDragScroll();
  loadData();
});

async function loadData() {
  const loadingEl = document.getElementById("loading");
  try {
    dashData = await T5TService.fetchDashboardData();
    initializeDateControlDefaults();
    applyDefaultPeriodFallback();
    updateDateFilterControls();
    dashData = T5TService.aggregateData(T5TService.rawItems, getDateFilterOptions());
    if (loadingEl) loadingEl.style.display = "none";
    document.getElementById("view-overview").classList.add("active");
    renderOverview();
    loadWeeklySummary();
    updateSyncInfo();
  } catch (error) {
    console.error(error);
    if (loadingEl) loadingEl.innerHTML = `<div style="color:red; padding:20px;">데이터 로드 실패: ${error.message}</div>`;
  }
}

function initializeDateControlDefaults() {
  const years = Array.from(new Set((T5TService.rawItems || [])
    .map(item => (item.work_date || "").slice(0, 4))
    .filter(Boolean))).sort().reverse();
  const yearSelect = document.getElementById("range-year");
  if (yearSelect && !yearSelect.options.length) {
    yearSelect.innerHTML = years.map(year => `<option value="${year}">${year}년</option>`).join("");
    if (!years.includes(uiState.selectedYear) && years.length) uiState.selectedYear = years[0];
    yearSelect.value = uiState.selectedYear;
  }
  const monthInput = document.getElementById("range-month");
  if (monthInput) monthInput.value = uiState.selectedMonth;
  const defaultCustomRange = T5TService.getDateFilterRange({ preset: "this_week" });
  if (!uiState.customStart) uiState.customStart = T5TService.formatDate(defaultCustomRange.start);
  if (!uiState.customEnd) uiState.customEnd = T5TService.formatDate(defaultCustomRange.end);
  const start = document.getElementById("custom-start");
  const end = document.getElementById("custom-end");
  if (start) start.value = uiState.customStart;
  if (end) end.value = uiState.customEnd;
}

function getDateFilterOptions() {
  return {
    preset: uiState.datePreset,
    year: uiState.selectedYear,
    month: uiState.selectedMonth,
    customStart: uiState.customStart,
    customEnd: uiState.customEnd
  };
}

function countRowsForOptions(options) {
  const range = T5TService.getDateFilterRange(options);
  return (T5TService.rawItems || []).filter(item => {
    const workDate = T5TService.parseDate(item.work_date);
    if (!workDate) return false;
    if (range.start && workDate < range.start) return false;
    if (range.end && workDate > range.end) return false;
    if (T5TService.isHeaderOnlyLog(item)) return false;
    return true;
  }).length;
}

function applyDefaultPeriodFallback() {
  if (uiState.datePreset !== "this_week") return;
  const thisWeekCount = countRowsForOptions({ preset: "this_week" });
  if (thisWeekCount > 0) return;
  const lastWeekCount = countRowsForOptions({ preset: "last_week" });
  if (lastWeekCount > 0) {
    uiState.datePreset = "last_week";
    setActiveDatePreset("last_week");
  }
}

function refreshDateFilteredData() {
  uiState.intelligencePeriod = "current";
  uiState.stakeholderDrilldown = null;
  uiState.stakeholderSubDrilldown = null;
  dashData = T5TService.aggregateData(T5TService.rawItems, getDateFilterOptions());
  renderOverview();
}

function setupDateFilters() {
  document.querySelectorAll("#date-preset-tabs .period-toggle-btn").forEach(btn => {
    btn.onclick = () => {
      uiState.datePreset = btn.dataset.preset;
      document.querySelectorAll("#date-preset-tabs .period-toggle-btn").forEach(i => i.classList.remove("active"));
      btn.classList.add("active");
      updateDateFilterControls();
      refreshDateFilteredData();
    };
  });

  const yearSelect = document.getElementById("range-year");
  if (yearSelect) yearSelect.onchange = () => {
    uiState.selectedYear = yearSelect.value;
    uiState.datePreset = "year";
    setActiveDatePreset("year");
    updateDateFilterControls();
    refreshDateFilteredData();
  };

  const monthInput = document.getElementById("range-month");
  if (monthInput) monthInput.onchange = () => {
    uiState.selectedMonth = monthInput.value;
    uiState.datePreset = "month";
    setActiveDatePreset("month");
    updateDateFilterControls();
    refreshDateFilteredData();
  };

  const start = document.getElementById("custom-start");
  const end = document.getElementById("custom-end");
  if (start) start.onchange = () => {
    uiState.customStart = start.value;
    uiState.datePreset = "custom";
    setActiveDatePreset("custom");
    updateDateFilterControls();
    refreshDateFilteredData();
  };
  if (end) end.onchange = () => {
    uiState.customEnd = end.value;
    uiState.datePreset = "custom";
    setActiveDatePreset("custom");
    updateDateFilterControls();
    refreshDateFilteredData();
  };
}

function setActiveDatePreset(preset) {
  document.querySelectorAll("#date-preset-tabs .period-toggle-btn").forEach(i => {
    i.classList.toggle("active", i.dataset.preset === preset);
  });
}

function updateDateFilterControls() {
  const year = document.getElementById("range-year");
  const month = document.getElementById("range-month");
  const customInputs = document.querySelectorAll(".custom-range-input");
  if (year) year.hidden = uiState.datePreset === "month" || uiState.datePreset === "custom";
  if (month) month.hidden = uiState.datePreset !== "month";
  customInputs.forEach(el => { el.hidden = uiState.datePreset !== "custom"; });
}

function updateSyncInfo() {
  const meta = dashData?.sync_meta;
  if (!meta) return;
  document.getElementById("sync-time").textContent = `${new Date(meta.synced_at).toLocaleString()} SQL 실시간 연동 중`;
}

async function loadWeeklySummary() {
  const container = document.getElementById("summary-content");
  if (!container) return;
  try {
    const response = await fetch(`data/weekly_summary.json?v=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const summary = await response.json();
    renderWeeklySummary(summary);
  } catch (error) {
    container.innerHTML = `
      <div class="summary-empty">
        <strong>주간 요약본이 아직 생성되지 않았습니다.</strong>
        <span>월요일 오전 8시 자동 생성 이후 이 영역에 표시됩니다.</span>
      </div>
    `;
  }
}

function renderWeeklySummary(summary) {
  const container = document.getElementById("summary-content");
  if (!container) return;
  const generatedAt = summary.generated_at ? new Date(summary.generated_at).toLocaleString() : "";
  const range = `${summary.week_start || ""} ~ ${summary.week_end || ""}`;
  const sections = Array.isArray(summary.sections) ? summary.sections : [];
  container.innerHTML = `
    <div class="weekly-summary-meta">
      <span>${escapeHtml(range)}</span>
      <span>${Number(summary.total_logs || 0).toLocaleString()} log</span>
      ${generatedAt ? `<span>${escapeHtml(generatedAt)} 생성</span>` : ""}
    </div>
    <div class="weekly-summary-grid">
      ${sections.map(section => `
        <section class="weekly-summary-section">
          <h3>${escapeHtml(section.title || "")}</h3>
          <ul>
            ${(section.bullets || []).map(bullet => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
        </section>
      `).join("")}
    </div>
  `;
}

function renderOverview() {
  renderIntelligence();
  T5TCharts.renderTrend(dashData.trend, COLORS);
  renderPulse();
}

function renderIntelligence() {
  const period = dashData?.intelligence?.periods?.[uiState.intelligencePeriod];
  if (!period) return;
  renderMobileBrief(period);
  renderIssueModule(period);
  renderStakeholderPanel(period);
}

function renderMobileBrief(period) {
  const summary = document.getElementById("mobile-brief-summary");
  const count = document.getElementById("mobile-brief-count");
  if (summary) summary.textContent = `${period.label} 핵심 요약`;
  if (count) count.textContent = `${period.total_logs}건`;
}

function renderIssueModule(period) {
  const issueBars = document.getElementById("issue-bars");
  const keywordWrap = document.getElementById("issue-keywords");
  const badge = document.getElementById("issue-total-badge");
  
  if (badge) badge.textContent = `${period.total_logs}건 분석`;

  const validCats = period.issue_categories.filter(c => c.count > 0);
  const maxCount = Math.max(...validCats.map(c => c.count), 1);

  issueBars.innerHTML = validCats.map(c => `
    <div class="issue-bar-row" style="cursor:pointer" onclick='openInsightModal("issue", ${jsString(c.name)})'>
      <div class="issue-bar-head">
        <div class="issue-bar-title">
          <span class="issue-dot" style="background:${COLORS.issues[c.name]||"#666"}"></span>
          <span class="issue-name">${c.name}</span>
        </div>
        <div class="issue-meta"><span>${c.count}건</span></div>
      </div>
      <div class="issue-bar-track"><div class="issue-bar-fill" style="width:${(c.count/maxCount)*100}%; background:${COLORS.issues[c.name]||"#666"}"></div></div>
    </div>
  `).join("");

  keywordWrap.innerHTML = period.top_keywords.slice(0, 18).map(k => `
    <button class="keyword-chip" style="--chip-color:${COLORS.issues[k.category] || "#6B7280"}" onclick='openInsightModal("keyword", ${jsString(k.keyword)})'>
      <strong>#${k.keyword}</strong>
      <small>${k.count}</small>
    </button>
  `).join("");
}

function renderStakeholderPanel(period) {
    const shData = T5TService.buildStakeholderChartData(period, uiState.stakeholderDrilldown, uiState.stakeholderSubDrilldown);
    const periodSummary = document.getElementById("stakeholder-period-summary");
    if (periodSummary) {
        const scope = uiState.stakeholderSubDrilldown || uiState.stakeholderDrilldown || "유형별 분포";
        periodSummary.textContent = `${period.label} · ${scope}`;
    }
    const rankingSummary = document.getElementById("stakeholder-ranking-summary");
    if (rankingSummary) {
        rankingSummary.textContent = `${period.top_stakeholders.length}개 후보 중 상위 10개만 표시합니다.`;
    }
    T5TCharts.renderStakeholder(shData, COLORS, (item) => {
        if (shData.mode === "types") {
            uiState.stakeholderDrilldown = item.name;
            uiState.stakeholderSubDrilldown = null; // 상위 유형 클릭 시 하위 필터 반드시 초기화
        } else if (shData.mode === "subs") {
            uiState.stakeholderSubDrilldown = item.name;
        } else {
            openInsightModal("stakeholder", item.name);
            return;
        }
        renderIntelligence();
    });
  
  const backButton = document.getElementById("stakeholder-back-btn");
  if (backButton) backButton.style.display = (uiState.stakeholderDrilldown) ? "block" : "none";
  
  const listContainer = document.getElementById("stakeholder-list");
  if (listContainer) {
      let items = period.top_stakeholders;
      if (uiState.stakeholderSubDrilldown) {
          items = items.filter(s => s.type === uiState.stakeholderDrilldown && s.sub === uiState.stakeholderSubDrilldown);
      } else if (uiState.stakeholderDrilldown) {
          items = items.filter(s => s.type === uiState.stakeholderDrilldown);
      }
      
      const visibleItems = items.slice(0, 10);
      listContainer.innerHTML = visibleItems.length ? visibleItems.map(s => {
          const exposureText = s.exposure > 0 ? `<div class="stakeholder-exposure">${(s.exposure/1e8).toLocaleString()}억 (${s.fund_count}건)</div>` : "";
          return `
            <div class="stakeholder-row" onclick='openInsightModal("stakeholder", ${jsString(s.name)})'>
                <div class="stakeholder-main">
                    <div class="stakeholder-name">${s.name}</div>
                    ${exposureText}
                </div>
                <div class="stakeholder-count">${s.count} log</div>
            </div>
          `;
      }).join("") : '<div class="empty-state">데이터가 없습니다.</div>';
  }
}

function openCrmModal(name, type) {
    const p = dashData.intelligence.periods[uiState.intelligencePeriod];
    const sInfo = p.top_stakeholders.find(x => x.name === name);
    
    document.getElementById("projectModalTitle").textContent = `${name} (${type})`;
    
    let summaryHtml = `이해관계자 <strong>${name}</strong>와(과) 관련된 총 <strong>${sInfo?.count || 0}건</strong>의 업무 로그가 있습니다.`;
    if (sInfo && sInfo.exposure > 0) {
        summaryHtml += `<br/><div style="margin-top:10px; padding:12px; background:rgba(0,0,0,0.02); border-radius:8px; border:1px solid rgba(0,0,0,0.05);">
            <div style="font-size:11px; color:var(--muted);">내부 DB 마스터 정보</div>
            <div style="font-size:18px; font-weight:900; color:var(--accent-2);">${(sInfo.exposure/1e8).toLocaleString()}억 <span style="font-size:13px; font-weight:normal; color:var(--muted);">/ ${sInfo.fund_count}개 프로젝트 참여 중</span></div>
        </div>`;
    }
    document.getElementById("projectModalSummary").innerHTML = summaryHtml;

    // 해당 이해관계자가 언급된 로그 필터링
    const relatedLogs = T5TService.rawItems.filter(item => {
        const text = (item.classification_summary || "") + (item.raw_text || "") + (item.stakeholder_text || "");
        return text.includes(name);
    }).slice(0, 50);

    document.getElementById("projectModalList").innerHTML = relatedLogs.map(l => `
      <div class="modal-item modal-log-item">
        <div class="modal-item-name" style="font-size:11px; color:var(--muted); margin-bottom:8px; display:flex; justify-content:space-between;">
          <span>${l.work_date} | ${l.writer_name}</span>
          <span style="color:var(--accent); font-weight:bold;">${l.task_type || ""}</span>
        </div>
        <div style="font-weight:700; font-size:14px; color:var(--accent-2); margin-bottom:8px;">${l.classification_summary || "요약 없음"}</div>
        <div class="modal-item-meta modal-raw-text">${l.raw_text || ""}</div>
      </div>
    `).join("");
    
    document.getElementById("projectModal").hidden = false;
}

function renderPulse() {
  const container = document.getElementById("pulse-timeline");
  if (!container) return;

  const allWeeks = getPulseWeeks(dashData.pulse_weeks || dashData.sorted_weeks || []);
  
  let lastYear = "";
  let lastMonth = -1;
  const headerHtml = allWeeks.map(week => {
      const parts = week.split("-W");
      const year = parts[0];
      const ww = parseInt(parts[1]);
      
      // 주차를 월로 변환 (간이 계산)
      const date = new Date(year, 0, 1 + (ww - 1) * 7);
      const month = date.getMonth() + 1;
      
      let label = "";
      if (year !== lastYear) {
          label = `<span class="pulse-year">${year}년</span>`;
          lastYear = year;
          lastMonth = month;
          label += `<span class="pulse-month">${month}</span>`;
      } else if (month !== lastMonth) {
          label = `<span class="pulse-month">${month}</span>`;
          lastMonth = month;
      }
      return `<div class="pulse-week-head">${label}</div>`;
  }).join("");

  const headerRow = `
    <div class="pulse-header-row">
      <div class="pulse-project-head">프로젝트명</div>
      <div class="pulse-weeks">${headerHtml}</div>
      <div class="pulse-total-head">Total</div>
    </div>
  `;

  const rowsHtml = dashData.pulse.slice(0, 30).map((p, i) => {
    const parentText = (p.parent && p.parent !== p.name) ? `<div style="font-size:10px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.parent}</div>` : "";
    
    const pulseHtml = allWeeks.map(week => {
      const count = p.weekly[week] || 0;
      if (count === 0) return '<div class="pulse-cell"><div class="pulse-dot empty"></div></div>';
      const size = Math.min(5 + count * 2, 11); 
      const opacity = Math.min(0.2 + count * 0.2, 1);
      return `
        <div class="pulse-cell">
          <div class="pulse-dot active" style="width:${size}px; height:${size}px; opacity:${opacity};"></div>
        </div>
      `;
    }).join("");

    return `
      <div class="timeline-row project-row" onclick='openProjectModal(${jsString(p.id)})'>
        <div class="pulse-rank">${i+1}</div>
        <div class="pulse-project-meta">
          <div class="pulse-project-name" title="${p.name}">${p.name}</div>
          ${parentText}
        </div>
        <div class="pulse-weeks">
          ${pulseHtml}
        </div>
        <div class="pulse-total">${p.total_mentions}</div>
      </div>
    `;
  }).join("");

  container.innerHTML = `<div class="pulse-table">${headerRow}${rowsHtml}</div>`;
}

function getPulseWeeks(dataWeeks) {
  const weeks = [...new Set(dataWeeks)].sort();
  if (weeks.length !== 1) return weeks;
  const [year, week] = weeks[0].split("-W").map(Number);
  const expanded = [];
  for (let i = 7; i >= 0; i -= 1) {
    expanded.push(T5TService.addWeeksToWeekKey(year, week, -i));
  }
  return expanded;
}

function openProjectModal(id) {
  const p = dashData.pulse.find(x => x.id === id);
  if (!p) return;
  uiState.project = { id, groupBy: "none" };
  document.querySelectorAll("#project-group-toggle .modal-segment-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.group === "none");
  });
  document.getElementById("projectModalTitle").textContent = p.name;
  document.getElementById("projectModalSummary").innerHTML = `총 <strong>${p.total_mentions}건</strong>의 로그가 검색되었습니다.`;
  renderProjectModalContent();
  document.getElementById("projectModal").hidden = false;
}

function renderProjectModalContent() {
  const p = dashData?.pulse?.find(x => x.id === uiState.project.id);
  if (!p) return;
  const logs = (p.logs || []).map(log => ({ ...log, project: p.name }));
  document.getElementById("projectModalList").innerHTML = renderProjectLogs(logs, uiState.project.groupBy);
}

function renderProjectLogs(logs, groupBy) {
  const sortedLogs = [...logs].sort((a, b) => new Date(b.work_date || 0) - new Date(a.work_date || 0));
  if (!sortedLogs.length) return '<div class="empty-state">해당 프로젝트의 원문 로그가 없습니다.</div>';

  if (groupBy === "writer" || groupBy === "task_type") {
    const groups = new Map();
    sortedLogs.forEach(log => {
      const key = groupBy === "writer" ? (log.writer || "미확인") : (log.task_type || "미분류");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(log);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0]), "ko"))
      .map(([name, groupLogs]) => `
        <section class="modal-item modal-group-card" style="padding:0; overflow:hidden;">
          <div class="modal-group-head">
            <strong>${escapeHtml(name)}</strong>
            <span class="modal-item-meta" style="margin:0;">${groupLogs.length}건</span>
          </div>
          <div style="padding:12px 14px;">${groupLogs.map(renderProjectLogItem).join("")}</div>
        </section>
      `).join("");
  }

  return sortedLogs.map(renderProjectLogItem).join("");
}

function renderProjectLogItem(log) {
  return `
    <div class="modal-item modal-log-item">
      <div class="modal-item-name" style="font-size:11px; color:var(--muted); margin-bottom:8px; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <span>${escapeHtml(log.work_date || "")} | ${escapeHtml(log.writer || "미확인")}</span>
        <span style="color:var(--accent); font-weight:bold;">${escapeHtml(log.task_type || "")}</span>
      </div>
      ${log.summary ? `<div style="font-weight:700; font-size:14px; color:var(--accent-2); margin-bottom:8px;">${escapeHtml(log.summary)}</div>` : ""}
      <div class="modal-item-meta modal-raw-text">${escapeHtml(log.raw_text || "")}</div>
    </div>
  `;
}

function openInsightModal(kind, key) {
  uiState.insight = { kind, key, groupBy: "none" };
  document.querySelectorAll("#insight-group-toggle .modal-segment-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.group === "none");
  });
  renderInsightModalContent();
  document.getElementById("insightModal").hidden = false;
}

function renderInsightModalContent() {
    const period = dashData?.intelligence?.periods?.[uiState.intelligencePeriod];
    const logs = filterInsightLogs(period?.logs || [], uiState.insight.kind, uiState.insight.key);
    document.getElementById("insightModalTitle").textContent = uiState.insight.key;
    document.getElementById("insightModalSummary").textContent = `${period?.label || "선택 구간"} 기준 ${logs.length}건의 원문 로그입니다.`;
    document.getElementById("insightModalList").innerHTML = renderGroupedLogs(logs, uiState.insight.groupBy);
}

function filterInsightLogs(logs, kind, key) {
  const needle = (key || "").toLowerCase();
  return logs.filter(log => {
    if (kind === "issue") return log.category === key;
    if (kind === "keyword") return (log.keywords || []).some(k => String(k).toLowerCase() === needle);
    if (kind === "stakeholder") {
      return `${log.raw_text || ""} ${log.summary || ""} ${log.stakeholder_text || ""}`.toLowerCase().includes(needle);
    }
    return false;
  }).sort((a, b) => new Date(b.work_date) - new Date(a.work_date));
}

function renderGroupedLogs(logs, groupBy) {
  if (!logs.length) return '<div class="empty-state">해당 조건의 원문 로그가 없습니다.</div>';
  if (groupBy === "project" || groupBy === "writer") {
    const groups = new Map();
    logs.forEach(log => {
      const key = groupBy === "project" ? (log.project || "미분류") : (log.writer || "익명");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(log);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, groupLogs]) => `
        <section class="modal-item modal-group-card" style="padding:0; overflow:hidden;">
          <div class="modal-group-head">
            <strong>${escapeHtml(name)}</strong>
            <span class="modal-item-meta" style="margin:0;">${groupLogs.length}건</span>
          </div>
          <div style="padding:12px 14px;">${groupLogs.map(renderLogItem).join("")}</div>
        </section>
      `).join("");
  }
  return logs.map(renderLogItem).join("");
}

function renderLogItem(log) {
  return `
    <div class="modal-item modal-log-item">
      <div class="modal-item-name" style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <span>${escapeHtml(log.work_date || "")} | ${escapeHtml(log.writer || "익명")} | ${escapeHtml(log.project || "미분류")}</span>
        <span style="color:var(--accent);">${escapeHtml(log.task_type || "")}</span>
      </div>
      ${log.summary ? `<div style="font-weight:700; color:var(--accent-2); margin-top:8px;">${escapeHtml(log.summary)}</div>` : ""}
      <div class="modal-item-meta modal-raw-text">${escapeHtml(log.raw_text || "")}</div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function jsString(value) {
  return JSON.stringify(String(value ?? "")).replace(/</g, "\\u003c");
}

function openCrmModal(name, type) {
  document.getElementById("crmModalTitle").textContent = name;
  document.getElementById("crmModalName").textContent = name;
  document.getElementById("crmModalType").textContent = type || "이해관계자";
  document.getElementById("crmModal").hidden = false;
}

function setupNav() {
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".nav-tab").forEach(i => i.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.view).classList.add("active");
    };
  });
}

function setupModals() {
  const close = (mid, cid) => {
    const m = document.getElementById(mid), c = document.getElementById(cid);
    if (m && c) {
        c.onclick = () => { m.style.display = ""; m.hidden = true; };
        m.onclick = (e) => { if(e.target.id === mid) { m.style.display = ""; m.hidden = true; } };
    }
  };
  close("projectModal", "projectModalClose");
  close("insightModal", "insightModalClose");
  close("crmModal", "crmModalClose");
}

function setupPeriodToggle() {
  document.querySelectorAll("#intelligence-period-tabs .period-toggle-btn").forEach(btn => {
    btn.onclick = () => {
      uiState.intelligencePeriod = btn.dataset.period;
      document.querySelectorAll("#intelligence-period-tabs .period-toggle-btn").forEach(i => i.classList.remove("active"));
      btn.classList.add("active");
      renderIntelligence();
    };
  });
}

function setupStakeholderBack() {
  const b = document.getElementById("stakeholder-back-btn");
  if (b) b.onclick = () => {
    uiState.stakeholderDrilldown = null;
    uiState.stakeholderSubDrilldown = null;
    renderIntelligence();
  };
}

function setupInsightGrouping() {
  document.querySelectorAll("#insight-group-toggle .modal-segment-btn").forEach(btn => {
    btn.onclick = () => {
      uiState.insight.groupBy = btn.dataset.group;
      document.querySelectorAll("#insight-group-toggle .modal-segment-btn").forEach(i => i.classList.remove("active"));
      btn.classList.add("active");
      renderInsightModalContent();
    };
  });
}

function setupProjectGrouping() {
  document.querySelectorAll("#project-group-toggle .modal-segment-btn").forEach(btn => {
    btn.onclick = () => {
      uiState.project.groupBy = btn.dataset.group;
      document.querySelectorAll("#project-group-toggle .modal-segment-btn").forEach(i => i.classList.remove("active"));
      btn.classList.add("active");
      renderProjectModalContent();
    };
  });
}

function setupDragScroll() {
  document.querySelectorAll("[data-drag-scroll='y']").forEach(scroller => {
    let isDown = false;
    let startY = 0;
    let startScrollTop = 0;
    scroller.addEventListener("pointerdown", event => {
      isDown = true;
      startY = event.clientY;
      startScrollTop = scroller.scrollTop;
      scroller.classList.add("is-dragging");
      scroller.setPointerCapture(event.pointerId);
    });
    scroller.addEventListener("pointermove", event => {
      if (!isDown) return;
      scroller.scrollTop = startScrollTop - (event.clientY - startY);
    });
    const stop = event => {
      isDown = false;
      scroller.classList.remove("is-dragging");
      if (event.pointerId && scroller.hasPointerCapture(event.pointerId)) {
        scroller.releasePointerCapture(event.pointerId);
      }
    };
    scroller.addEventListener("pointerup", stop);
    scroller.addEventListener("pointercancel", stop);
    scroller.addEventListener("pointerleave", () => {
      isDown = false;
      scroller.classList.remove("is-dragging");
    });
  });
}
