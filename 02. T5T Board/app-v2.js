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
  project: { id: null, groupBy: "none" },
  summary: { weekKey: null, snapshots: [] },
  people: { selected: null, weekKey: null, search: "" }
};

document.addEventListener("DOMContentLoaded", () => {
  initSyncInfo();
  refreshSyncInfoPreview();
  setupNav();
  setupModals();
  setupDateFilters();
  setupStakeholderBack();
  setupInsightGrouping();
  setupProjectGrouping();
  setupPeopleControls();
  setupSummaryControls();
  setupDragScroll();
  loadData();
});

function initSyncInfo() {
  const syncEl = document.getElementById("sync-time");
  if (!syncEl) return;
  const cached = getStoredSyncAt();
  if (cached) {
    syncEl.textContent = `${formatSyncDate(cached)} SQL 최근 확인`;
    return;
  }
  syncEl.textContent = "SQL 데이터 연결 준비";
}

async function refreshSyncInfoPreview() {
  const syncEl = document.getElementById("sync-time");
  if (!syncEl || typeof supabaseClient === "undefined") return;
  try {
    const { data, error } = await supabaseClient
      .from("t5t_form_items")
      .select("work_date")
      .order("work_date", { ascending: false })
      .limit(1);
    if (error) throw error;
    const latestWorkDate = data?.[0]?.work_date;
    syncEl.textContent = latestWorkDate
      ? `최신 업무일 ${latestWorkDate} · SQL 연결됨`
      : "SQL 연결됨";
  } catch (error) {
    console.warn("Sync preview check failed", error);
    syncEl.textContent = "SQL 연결 확인 지연";
  }
}

async function loadData() {
  const loadingEl = document.getElementById("loading");
  try {
    dashData = await T5TService.fetchDashboardData();
    await finishDataLoad(loadingEl, true);
  } catch (error) {
    console.warn("Live SQL data failed. Falling back to bundled dashboard data.", error);
    try {
      dashData = await T5TService.fetchStaticDashboardData();
      await finishDataLoad(loadingEl, false);
    } catch (fallbackError) {
      console.error(fallbackError);
      showLoadingError(loadingEl, fallbackError);
    }
  }
}

async function finishDataLoad(loadingEl, canAggregateRawItems) {
  updateSyncInfo();
  hideLoading(loadingEl);
  await yieldToBrowser();
  initializeDateControlDefaults();
  applyDefaultPeriodFallback();
  updateDateFilterControls();
  if (canAggregateRawItems && (T5TService.rawItems || []).length) {
    dashData = T5TService.aggregateData(T5TService.rawItems, getDateFilterOptions());
  }
  document.getElementById("view-overview").classList.add("active");
  renderOverview();
  renderPeopleView();
  loadWeeklySummary();
  updateSyncInfo();
}

function hideLoading(loadingEl) {
  if (!loadingEl) return;
  loadingEl.classList.add("is-hidden");
  loadingEl.hidden = true;
  loadingEl.style.display = "none";
}

function showLoadingError(loadingEl, error) {
  if (!loadingEl) return;
  loadingEl.hidden = false;
  loadingEl.classList.remove("is-hidden");
  loadingEl.style.display = "flex";
  loadingEl.innerHTML = `<div style="color:red; padding:20px;">데이터 로드 실패: ${error.message}</div>`;
}

function yieldToBrowser() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
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
  const syncEl = document.getElementById("sync-time");
  if (!meta || !syncEl) return;
  setStoredSyncAt(meta.synced_at);
  const sourceLabel = meta.source === "static" ? "백업 데이터" : "SQL 최신 확인";
  syncEl.textContent = `${formatSyncDate(meta.synced_at)} ${sourceLabel}`;
}

function getStoredSyncAt() {
  try {
    return window.localStorage?.getItem("t5t:lastSyncAt") || "";
  } catch {
    return "";
  }
}

function setStoredSyncAt(value) {
  try {
    window.localStorage?.setItem("t5t:lastSyncAt", value);
  } catch {
    // Storage can be unavailable in some embedded browser contexts.
  }
}

function formatSyncDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function loadWeeklySummary() {
  const container = document.getElementById("summary-content");
  if (!container) return;
  try {
    const summary = await loadSelectedWeeklySummary();
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

function setupSummaryControls() {
  const select = document.getElementById("summary-week-select");
  if (!select) return;
  select.addEventListener("change", () => {
    uiState.summary.weekKey = select.value || null;
    loadWeeklySummary();
  });
}

async function loadSelectedWeeklySummary() {
  if (typeof supabaseClient !== "undefined") {
    const snapshots = await fetchWeeklySummarySnapshots();
    if (snapshots.length) {
      uiState.summary.snapshots = snapshots;
      if (!uiState.summary.weekKey || !snapshots.some(row => row.week_key === uiState.summary.weekKey)) {
        uiState.summary.weekKey = snapshots[0].week_key;
      }
      renderSummaryWeekOptions(snapshots);
      const selected = snapshots.find(row => row.week_key === uiState.summary.weekKey) || snapshots[0];
      return selected.summary_json || {};
    }
  }
  const response = await fetch(`data/weekly_summary.json?v=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const summary = await response.json();
  renderSummaryWeekOptions([{
    week_key: summary.week_key || "",
    week_start: summary.week_start || "",
    week_end: summary.week_end || "",
    total_logs: summary.total_logs || 0,
    summary_json: summary
  }]);
  return summary;
}

async function fetchWeeklySummarySnapshots() {
  const { data, error } = await supabaseClient
    .from("t5t_weekly_summary_snapshots")
    .select("week_key,week_start,week_end,total_logs,generated_at,summary_json")
    .order("week_end", { ascending: false })
    .limit(120);
  if (error) throw error;
  return data || [];
}

function renderSummaryWeekOptions(snapshots) {
  const select = document.getElementById("summary-week-select");
  if (!select) return;
  select.innerHTML = snapshots.map(row => {
    const label = `${row.week_key || ""} · ${row.week_start || ""}~${row.week_end || ""} · ${Number(row.total_logs || 0).toLocaleString()}건`;
    return `<option value="${escapeHtml(row.week_key || "")}" ${row.week_key === uiState.summary.weekKey ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  select.disabled = snapshots.length <= 1;
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

function setupPeopleControls() {
  const search = document.getElementById("people-search");
  const reset = document.getElementById("people-reset");
  if (search) {
    search.placeholder = "작성자, 프로젝트, 업무 내용 검색";
    search.addEventListener("input", () => {
      uiState.people.search = search.value.trim();
      if (uiState.people.search) {
        uiState.people.selected = null;
        uiState.people.weekKey = null;
      }
      renderPeopleView();
    });
  }
  if (reset) {
    reset.addEventListener("click", () => {
      uiState.people.search = "";
      uiState.people.selected = null;
      uiState.people.weekKey = null;
      if (search) search.value = "";
      renderPeopleView();
    });
  }
}

function getCurrentWeekKey() {
  const currentRange = T5TService.getReportingWeekRange(new Date(), 0);
  return T5TService.getWeekKey(currentRange.end);
}

function normalizePeopleSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function getPersonLogSearchText(person, log) {
  return [
    person?.name,
    person?.displayName,
    person?.affiliation,
    ...(person?.aliases ? Array.from(person.aliases) : []),
    log?.work_date,
    log?.task_type,
    log?.project,
    log?.summary,
    log?.raw_text,
    ...(Array.isArray(log?.keywords) ? log.keywords : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function personLogMatchesSearch(person, log, needle) {
  if (!needle) return true;
  const terms = needle.split(/\s+/).filter(Boolean);
  const haystack = getPersonLogSearchText(person, log);
  return terms.every(term => haystack.includes(term));
}

function getPeopleSearchResults(people, needle) {
  if (!needle) return [];
  const results = [];
  people.forEach(person => {
    (person.sortedPeriods || []).forEach(period => {
      (period.logs || []).forEach(log => {
        if (!personLogMatchesSearch(person, log, needle)) return;
        results.push({ person, period, log });
      });
    });
  });
  return results.sort((a, b) => {
    const dateDiff = new Date(b.log?.date_obj || b.log?.work_date || 0) - new Date(a.log?.date_obj || a.log?.work_date || 0);
    if (dateDiff) return dateDiff;
    return String(a.person?.displayName || "").localeCompare(String(b.person?.displayName || ""), "ko");
  });
}

function renderPeopleSearchResults(results, needle) {
  const visibleResults = results.slice(0, 80);
  const overflowCount = Math.max(0, results.length - visibleResults.length);
  return `
    <div class="person-search-results">
      <div class="person-search-summary">
        <div>
          <div class="section-eyebrow">Search Results</div>
          <strong>"${escapeHtml(needle)}" 검색 결과</strong>
        </div>
        <span>${results.length.toLocaleString()}건</span>
      </div>
      ${visibleResults.length ? `
        <div class="person-log-list">
          ${visibleResults.map(result => renderPersonLog(result.log, {
            personName: result.person.displayName,
            weekLabel: result.period.displayWeekKey || result.period.weekKey
          })).join("")}
        </div>
        ${overflowCount ? `<div class="people-empty">상위 ${visibleResults.length}건만 표시했습니다. 검색어를 더 구체적으로 입력해 주세요.</div>` : ""}
      ` : `
        <div class="person-empty person-empty-inline">
          <strong>검색 결과가 없습니다.</strong>
          <span>작성자, 프로젝트, 업무 내용에 포함된 단어로 다시 검색해 주세요.</span>
        </div>
      `}
    </div>
  `;
}

const WRITER_NAME_ALIASES = {
  "이승훈c": "이승훈"
};

function canonicalizeWriterDisplayName(value) {
  const displayName = String(value || "").trim();
  const compactKey = displayName.replace(/\s+/g, "").toLowerCase();
  return WRITER_NAME_ALIASES[compactKey] || displayName;
}

function parseWriterLabel(value) {
  const fullName = String(value || "익명").trim() || "익명";
  const parts = fullName.split("/").map(part => part.trim()).filter(Boolean);
  const rawDisplayName = parts[0] || fullName;
  return {
    fullName,
    displayName: canonicalizeWriterDisplayName(rawDisplayName),
    affiliation: parts.length > 1 ? parts.slice(1).join(" / ") : ""
  };
}

function getPersonEntries() {
  const people = new Map();
  (T5TService.rawItems || []).forEach(item => {
    const workDate = T5TService.parseDate(item.work_date);
    if (!workDate || T5TService.isHeaderOnlyLog(item)) return;
    const writer = parseWriterLabel(item.writer_name);
    const name = writer.displayName;
    const weekKey = T5TService.getWeekKey(workDate);
    const taskType = T5TService.normalizeTaskType(item.task_type || item.match_status);
    const category = T5TService.detectCategory(item);
    const log = T5TService.makeLogRecord(item, category, weekKey, taskType);
    log.date_obj = workDate;
    log.submission_id = item.submission_id || "";
    log.item_no = item.item_no || "";
    if (!people.has(name)) {
      people.set(name, {
        name,
        displayName: writer.displayName,
        affiliation: writer.affiliation,
        total: 0,
        periods: new Map(),
        latestDate: null,
        taskTypes: new Map(),
        aliases: new Set()
      });
    }
    const person = people.get(name);
    person.aliases.add(writer.fullName);
    person.total += 1;
    person.latestDate = !person.latestDate || workDate > person.latestDate ? workDate : person.latestDate;
    person.taskTypes.set(taskType, (person.taskTypes.get(taskType) || 0) + 1);
    const periodKey = item.submission_id ? `submission:${item.submission_id}` : `date:${weekKey}:${item.work_date || ""}`;
    if (!person.periods.has(periodKey)) {
      person.periods.set(periodKey, {
        key: periodKey,
        weekKey,
        submissionId: item.submission_id || "",
        workDate: item.work_date || "",
        sortDate: workDate,
        logs: []
      });
    }
    const period = person.periods.get(periodKey);
    period.sortDate = !period.sortDate || workDate > period.sortDate ? workDate : period.sortDate;
    period.logs.push(log);
  });
  return Array.from(people.values()).map(person => {
    const periodChunks = [];
    Array.from(person.periods.values()).forEach(period => {
      period.logs.sort((a, b) => {
        const itemDiff = Number(a.item_no || 0) - Number(b.item_no || 0);
        if (itemDiff) return itemDiff;
        return new Date(a.work_date || 0) - new Date(b.work_date || 0);
      });
      for (let start = 0; start < period.logs.length; start += 5) {
        const chunkIndex = Math.floor(start / 5) + 1;
        const chunkCount = Math.ceil(period.logs.length / 5);
        periodChunks.push({
          ...period,
          key: chunkCount > 1 ? `${period.key}:part:${chunkIndex}` : period.key,
          chunkIndex,
          chunkCount,
          logs: period.logs.slice(start, start + 5)
        });
      }
    });
    assignDisplayWeeks(periodChunks);
    person.sortedPeriods = periodChunks.sort((a, b) => {
      const dateDiff = new Date(b.sortDate || 0) - new Date(a.sortDate || 0);
      if (dateDiff) return dateDiff;
      if ((a.chunkIndex || 1) !== (b.chunkIndex || 1)) return (a.chunkIndex || 1) - (b.chunkIndex || 1);
      return String(b.submissionId || "").localeCompare(String(a.submissionId || ""));
    });
    return person;
  }).sort((a, b) => (b.latestDate || 0) - (a.latestDate || 0));
}

function parseWeekKey(weekKey) {
  const match = String(weekKey || "").match(/^(\d{4})-W(\d{2})$/);
  return match ? { year: Number(match[1]), week: Number(match[2]) } : null;
}

function addWeeksToKey(weekKey, offset) {
  const parsed = parseWeekKey(weekKey);
  if (!parsed) return weekKey;
  let year = parsed.year;
  let week = parsed.week + offset;
  while (week < 1) {
    year -= 1;
    week += getIsoWeeksInYear(year);
  }
  while (week > getIsoWeeksInYear(year)) {
    week -= getIsoWeeksInYear(year);
    year += 1;
  }
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function getIsoWeeksInYear(year) {
  const dec31 = new Date(Date.UTC(year, 11, 31));
  const day = dec31.getUTCDay() || 7;
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day === 4 || (day === 5 && isLeap) ? 53 : 52;
}

function weekSortValue(weekKey) {
  const parsed = parseWeekKey(weekKey);
  return parsed ? parsed.year * 100 + parsed.week : 0;
}

function findFreeDisplayWeek(baseWeek, direction, usedWeeks) {
  for (let i = 1; i <= 12; i += 1) {
    const candidate = addWeeksToKey(baseWeek, direction * i);
    if (!usedWeeks.has(candidate)) return candidate;
  }
  return null;
}

function assignDisplayWeeks(periods) {
  const groups = new Map();
  periods.forEach(period => {
    period.displayWeekKey = period.weekKey;
    if (!groups.has(period.weekKey)) groups.set(period.weekKey, []);
    groups.get(period.weekKey).push(period);
  });

  const usedWeeks = new Set();
  groups.forEach((group, weekKey) => {
    if (group.length === 1) usedWeeks.add(weekKey);
  });

  const occupiedWeeks = Array.from(groups.keys()).sort((a, b) => weekSortValue(a) - weekSortValue(b));
  const duplicateGroups = Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .sort(([a], [b]) => weekSortValue(a) - weekSortValue(b));

  const collectSlots = (weekKey, direction, boundaryWeek, limit) => {
    const slots = [];
    for (let i = 1; slots.length < limit && i <= limit + 8; i += 1) {
      const candidate = addWeeksToKey(weekKey, direction * i);
      if (boundaryWeek) {
        const reachedBoundary = direction > 0
          ? weekSortValue(candidate) >= weekSortValue(boundaryWeek)
          : weekSortValue(candidate) <= weekSortValue(boundaryWeek);
        if (reachedBoundary) break;
      }
      if (!usedWeeks.has(candidate)) slots.push(candidate);
    }
    return slots;
  };

  duplicateGroups.forEach(([weekKey, group]) => {
    if (group.length === 1) return;

    const sorted = [...group].sort((a, b) => {
      const dateDiff = new Date(a.sortDate || 0) - new Date(b.sortDate || 0);
      if (dateDiff) return dateDiff;
      return (a.chunkIndex || 1) - (b.chunkIndex || 1);
    });
    const extras = sorted.length - 1;
    const previousBoundary = [...occupiedWeeks].reverse().find(candidate => weekSortValue(candidate) < weekSortValue(weekKey));
    const nextBoundary = occupiedWeeks.find(candidate => weekSortValue(candidate) > weekSortValue(weekKey));
    const prevSlots = collectSlots(weekKey, -1, previousBoundary, extras);
    const nextSlots = collectSlots(weekKey, 1, nextBoundary, extras);
    const useNextFirst = nextSlots.length > 0 && (Boolean(nextBoundary) || prevSlots.length === 0);

    const keep = useNextFirst ? sorted[0] : sorted[sorted.length - 1];
    keep.displayWeekKey = weekKey;
    usedWeeks.add(weekKey);
    const remaining = sorted.filter(period => period !== keep);

    if (useNextFirst) {
      nextSlots.forEach(slot => {
        const period = remaining.pop();
        if (!period) return;
        period.displayWeekKey = slot;
        usedWeeks.add(slot);
      });
      prevSlots.forEach(slot => {
        const period = remaining.shift();
        if (!period) return;
        period.displayWeekKey = slot;
        usedWeeks.add(slot);
      });
      return;
    }

    prevSlots.forEach(slot => {
      const period = remaining.shift();
      if (!period) return;
      period.displayWeekKey = slot;
      usedWeeks.add(slot);
    });
    nextSlots.forEach(slot => {
      const period = remaining.pop();
      if (!period) return;
      period.displayWeekKey = slot;
      usedWeeks.add(slot);
    });
  });
}

function renderPeopleView() {
  const list = document.getElementById("people-card-list");
  const detail = document.getElementById("person-detail-card");
  const mobileResults = document.getElementById("people-search-results-mobile");
  if (!list || !detail) return;

  const people = getPersonEntries();
  const needle = normalizePeopleSearch(uiState.people.search);
  const searchResults = getPeopleSearchResults(people, needle);
  const resultPeople = new Set(searchResults.map(result => result.person.name));
  const visiblePeople = people.filter(person => {
    return !needle || resultPeople.has(person.name);
  });
  if (mobileResults) {
    mobileResults.innerHTML = needle ? renderPeopleSearchResults(searchResults, needle) : "";
  }
  list.innerHTML = visiblePeople.length ? visiblePeople.map(person => renderPersonCard(person)).join("") : `
    <div class="people-empty">검색 결과가 없습니다.</div>
  `;

  const selected = visiblePeople.find(person => person.name === uiState.people.selected);
  if (needle) {
    detail.innerHTML = renderPeopleSearchResults(searchResults, needle);
    return;
  }
  if (!selected) {
    detail.innerHTML = `
      <div class="person-empty">
        <strong>작성자를 선택하세요.</strong>
        <span>카드를 누르면 이번 주 기록과 과거 주차 선택이 표시됩니다.</span>
      </div>
    `;
    return;
  }
  renderPersonDetail(selected);
}

function renderPersonCard(person) {
  const currentPeriod = getDefaultPersonPeriod(person);
  const currentCount = currentPeriod ? currentPeriod.logs.length : 0;
  const isActive = uiState.people.selected === person.name;
  return `
    <article class="person-card-shell ${isActive ? "active" : ""}">
      <button class="person-card ${isActive ? "active" : ""}" type="button" onclick='selectPerson(${jsString(person.name)})'>
        <span class="person-card-top">
          <span class="person-card-name">${escapeHtml(person.displayName)}</span>
          <strong class="person-card-week">이번주 ${currentCount}건</strong>
        </span>
        <span class="person-card-meta">${person.total}건 · ${countPersonWeeks(person)}주 누적</span>
      </button>
      ${isActive ? `<div class="person-mobile-detail">${renderPersonDetailContent(person)}</div>` : ""}
    </article>
  `;
}

function selectPerson(name) {
  uiState.people.selected = name;
  uiState.people.weekKey = null;
  renderPeopleView();
}

function selectPersonWeek(weekKey) {
  uiState.people.weekKey = weekKey;
  renderPeopleView();
}

function countPersonWeeks(person) {
  return new Set((person.sortedPeriods || []).map(period => period.displayWeekKey || period.weekKey)).size;
}

function getDefaultPersonPeriod(person) {
  const currentWeek = getCurrentWeekKey();
  return (person.sortedPeriods || []).find(period => (period.displayWeekKey || period.weekKey) === currentWeek) || null;
}

function makeEmptyPersonPeriod(weekKey) {
  return {
    key: `empty:${weekKey}`,
    weekKey,
    submissionId: "",
    workDate: "",
    sortDate: null,
    logs: []
  };
}

function getPersonPeriodLabel(period, currentWeek, weekSequence) {
  const displayWeek = period.displayWeekKey || period.weekKey;
  const base = displayWeek === currentWeek ? "이번주" : displayWeek;
  const date = period.workDate ? ` · ${period.workDate}` : "";
  return `${base}${date}`;
}

function renderPersonDetail(person) {
  const detail = document.getElementById("person-detail-card");
  if (!detail) return;
  detail.innerHTML = renderPersonDetailContent(person);
}

function renderPersonDetailContent(person) {
  const currentWeek = getCurrentWeekKey();
  const defaultPeriod = getDefaultPersonPeriod(person);
  const selectedKey = uiState.people.weekKey || (defaultPeriod ? defaultPeriod.key : `empty:${currentWeek}`);
  const emptyCurrentPeriod = makeEmptyPersonPeriod(currentWeek);
  const periodOptions = defaultPeriod
    ? [...person.sortedPeriods]
    : [emptyCurrentPeriod, ...person.sortedPeriods];
  const selectedPeriod = periodOptions.find(period => period.key === selectedKey) || periodOptions[0] || emptyCurrentPeriod;
  const logs = selectedPeriod.logs || [];
  const latestLogs = person.sortedPeriods.length ? person.sortedPeriods[0].logs || [] : [];
  const weekSeen = new Map();
  const optionMeta = periodOptions.map(period => {
    const displayWeek = period.displayWeekKey || period.weekKey;
    const nextSeq = (weekSeen.get(displayWeek) || 0) + 1;
    weekSeen.set(displayWeek, nextSeq);
    return { period, label: getPersonPeriodLabel(period, currentWeek, nextSeq) };
  });
  const selectedMeta = optionMeta.find(meta => meta.period.key === selectedPeriod.key);
  const selectedLabel = selectedMeta ? selectedMeta.label : getPersonPeriodLabel(selectedPeriod, currentWeek, 1);
  return `
    <div class="person-detail-head">
      <div>
        <div class="section-eyebrow">Writer Timeline</div>
        <h2>${escapeHtml(person.displayName)}</h2>
        <p>${person.total}건 누적 · ${countPersonWeeks(person)}개 주차 · 최근 ${escapeHtml(T5TService.formatDate(person.latestDate))}</p>
      </div>
      <select class="period-input person-week-select" onchange="selectPersonWeek(this.value)">
        ${optionMeta.map(meta => `<option value="${escapeHtml(meta.period.key)}" ${meta.period.key === selectedPeriod.key ? "selected" : ""}>${escapeHtml(meta.label)} (${meta.period.logs.length}건)</option>`).join("")}
      </select>
    </div>
    <div class="person-week-summary">
      <strong>${escapeHtml(selectedLabel)}</strong>
      <span>${logs.length}건</span>
    </div>
    <div class="person-log-list">
      ${logs.length ? logs.map(renderPersonLog).join("") : `
        <div class="person-empty person-empty-inline">
          <strong>이번 주 기록이 없습니다.</strong>
          <span>${latestLogs.length ? "상단 주차 선택에서 과거 기록을 확인할 수 있습니다." : "아직 누적 기록이 없습니다."}</span>
        </div>
      `}
    </div>
  `;
}

function renderPersonLog(log, context = {}) {
  const keywords = (log.keywords || []).slice(0, 5).map(keyword => `<span>#${escapeHtml(keyword)}</span>`).join("");
  const contextMeta = [context.personName, context.weekLabel].filter(Boolean);
  return `
    <article class="person-log-card">
      <div class="person-log-meta">
        ${contextMeta.map(value => `<span>${escapeHtml(value)}</span>`).join("")}
        <span>${escapeHtml(log.work_date || "")}</span>
        <span>${escapeHtml(log.task_type || "")}</span>
        <span>${escapeHtml(log.project || "미분류")}</span>
      </div>
      ${log.summary ? `<h3>${escapeHtml(log.summary)}</h3>` : ""}
      <p>${escapeHtml(log.raw_text || log.summary || "내용 없음")}</p>
      ${keywords ? `<div class="person-log-tags">${keywords}</div>` : ""}
    </article>
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

  const issueList = document.getElementById("mobile-issue-list");
  const keywordList = document.getElementById("mobile-keyword-list");
  const stakeholderList = document.getElementById("mobile-stakeholder-list");

  if (issueList) {
    const issues = (period.issue_categories || []).filter(item => item.count > 0).slice(0, 3);
    issueList.innerHTML = issues.length ? issues.map(item => `
      <button class="mobile-pill-button" type="button" onclick='openInsightModal("issue", ${jsString(item.name)})'>
        <span>${escapeHtml(item.name)}</span>
        <strong>${item.count}</strong>
      </button>
    `).join("") : '<span class="mobile-empty-note">이번 기간 이슈 없음</span>';
  }

  if (keywordList) {
    const keywords = (period.top_keywords || []).slice(0, 6);
    keywordList.innerHTML = keywords.length ? keywords.map(item => `
      <button class="mobile-pill-button" type="button" onclick='openInsightModal("keyword", ${jsString(item.keyword)})'>
        <span>#${escapeHtml(item.keyword)}</span>
        <strong>${item.count}</strong>
      </button>
    `).join("") : '<span class="mobile-empty-note">키워드 없음</span>';
  }

  if (stakeholderList) {
    const stakeholders = (period.top_stakeholders || []).slice(0, 5);
    stakeholderList.innerHTML = stakeholders.length ? stakeholders.map(item => `
      <button class="mobile-mini-row" type="button" onclick='openInsightModal("stakeholder", ${jsString(item.name)})'>
        <span>${escapeHtml(item.name)}</span>
        <strong>${item.count} log</strong>
      </button>
    `).join("") : '<span class="mobile-empty-note">상대방 없음</span>';
  }
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
      if (tab.dataset.view === "view-people") renderPeopleView();
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
