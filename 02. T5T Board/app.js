const state = {
  masters: {
    staff: [],
    projects: [],
    funds: [],
    assets: [],
    reviewProjects: [],
    counterparties: [],
    orgs: [],
    assignments: [],
  },
  writer: null,
  items: [],
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  setDefaultDate();
  wireHeaderEvents();
  restoreDraft();
  if (!state.items.length) addItem();
  await loadMasters();
  renderAll();
});

function cacheElements() {
  Object.assign(els, {
    status: document.getElementById("connection-status"),
    writerSearch: document.getElementById("writer-search"),
    writerSuggestions: document.getElementById("writer-suggestions"),
    workDate: document.getElementById("work-date"),
    lineLabel: document.getElementById("line-label"),
    weekLabel: document.getElementById("week-label"),
    itemStack: document.getElementById("item-stack"),
    template: document.getElementById("item-template"),
    addItem: document.getElementById("add-item"),
    resetForm: document.getElementById("reset-form"),
    validationList: document.getElementById("validation-list"),
    payloadPreview: document.getElementById("payload-preview"),
    saveDraft: document.getElementById("save-draft"),
    copyPayload: document.getElementById("copy-payload"),
  });
}

function wireHeaderEvents() {
  els.writerSearch.addEventListener("input", handleWriterEmailInput);
  els.workDate.addEventListener("change", renderAll);
  els.addItem.addEventListener("click", () => {
    if (state.items.length < 5) addItem();
    renderAll();
  });
  els.resetForm.addEventListener("click", resetForm);
  els.saveDraft.addEventListener("click", saveDraft);
  els.copyPayload.addEventListener("click", copyPayload);
  document.addEventListener("click", event => {
    if (!event.target.closest(".field")) closeSuggestions();
  });
}

function setDefaultDate() {
  const today = new Date();
  els.workDate.value = formatDate(today);
}

async function loadMasters() {
  try {
    els.status.textContent = "DB master 불러오는 중";
    const [staff, orgs, assignments, projects, reviewProjects, funds, assets, counterparties] = await Promise.all([
      fetchAll("staff", "staff_id,employee_no,name,email,position,title,line_code,line_label,status", "name"),
      fetchAll("orgs", "org_id,org_name,org_path,is_active", "org_name"),
      fetchAll("staff_org_assignments", "assignment_id,staff_id,org_id,is_primary,role,metadata", "staff_id"),
      fetchAll("projects", "project_id,project_name,project_code,project_type,status,primary_asset_id,source_system,metadata", "project_name"),
      fetchOptional("review_projects", "review_project_id,notion_id,source_project_id,project_name,review_status,source_status,metadata", "project_name"),
      fetchAll("funds", "fund_id,fund_name,short_name,asset_name,status,project_mission_name,primary_asset_id", "fund_name"),
      fetchAll("asset_master", "asset_id,canonical_name,asset_type,city,address_text,asset_kind,review_status", "canonical_name"),
      fetchAll("counterparties", "counterparty_id,name,category,metadata", "name"),
    ]);

    state.masters.orgs = orgs;
    state.masters.assignments = assignments;
    state.masters.staff = enrichStaff(staff.filter(row => row.status !== "inactive"), orgs, assignments);
    state.masters.projects = projects.filter(isSelectableProject);
    state.masters.reviewProjects = reviewProjects.filter(isSelectableReviewProject);
    state.masters.funds = funds;
    state.masters.assets = assets;
    state.masters.counterparties = counterparties;
    els.status.textContent = "DB master 연결됨";
    els.status.classList.add("ok");
  } catch (error) {
    console.error(error);
    els.status.textContent = "DB 연결 실패";
    els.status.classList.add("error");
  }
}

async function fetchOptional(table, columns, orderColumn) {
  try {
    return await fetchAll(table, columns, orderColumn);
  } catch (error) {
    console.warn(`Optional master ${table} is not available yet.`, error);
    return [];
  }
}

async function fetchAll(table, columns, orderColumn) {
  let from = 0;
  const size = 1000;
  const rows = [];
  while (true) {
    let query = supabaseClient.from(table).select(columns).range(from, from + size - 1);
    if (orderColumn) query = query.order(orderColumn, { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < size) break;
    from += size;
  }
  return rows;
}

function addItem(seed = {}) {
  state.items.push({
    id: crypto.randomUUID(),
    task_type: seed.task_type || null,
    projects: seed.projects || [],
    reviewProjects: seed.reviewProjects || [],
    funds: seed.funds || [],
    assets: seed.assets || [],
    relation_texts: seed.relation_texts || [],
    counterparties: seed.counterparties || [],
    counterparty_texts: seed.counterparty_texts || [],
    summary: seed.summary || "",
    raw_text: seed.raw_text || "",
  });
}

function renderAll() {
  updateWriterFields();
  renderItems();
  renderValidation();
  renderPayload();
}

function handleWriterEmailInput() {
  const value = els.writerSearch.value.trim();
  const emailNeedle = normalizeEmail(value);
  const exact = state.masters.staff.find(row => normalizeEmail(row.email) === emailNeedle);
  if (exact) {
    state.writer = exact;
    closeSuggestions();
    renderAll();
    return;
  }

  state.writer = null;
  updateWriterFields();
  renderPayload();
  renderValidation();

  showSuggestions({
    anchor: els.writerSuggestions,
    query: value,
    rows: state.masters.staff.filter(row => row.email),
    label: row => row.email || row.name || row.staff_id,
    meta: row => [row.name, row.org_display, row.position].filter(Boolean).join(" · "),
    onPick: row => {
      state.writer = row;
      els.writerSearch.value = row.email || "";
      closeSuggestions();
      renderAll();
    },
  });
}

function updateWriterFields() {
  els.lineLabel.value = state.writer?.org_display || "";
  els.weekLabel.value = state.writer?.name || "";
}

function renderItems() {
  els.itemStack.innerHTML = "";
  state.items.forEach((item, index) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.itemId = item.id;
    node.querySelector(".item-no").textContent = `ITEM ${index + 1}`;
    node.querySelector(".remove-item").hidden = state.items.length <= 1;
    node.querySelector(".remove-item").addEventListener("click", () => {
      state.items = state.items.filter(row => row.id !== item.id);
      renderAll();
    });

    node.querySelectorAll(".type-toggle button").forEach(button => {
      button.classList.toggle("active", button.dataset.type === item.task_type);
      button.addEventListener("click", () => {
        item.task_type = item.task_type === button.dataset.type ? null : button.dataset.type;
        renderAll();
      });
    });

    wireUnifiedRelationField(node, item);
    wireCounterpartyField(node, item);

    const summary = node.querySelector(".summary-input");
    summary.value = item.summary;
    summary.addEventListener("input", () => {
      item.summary = summary.value;
      renderPayload();
      renderValidation();
    });
    const raw = node.querySelector(".raw-input");
    raw.value = item.raw_text;
    raw.addEventListener("input", () => {
      item.raw_text = raw.value;
      renderPayload();
      renderValidation();
    });
    els.itemStack.appendChild(node);
    updateFallbackClassifier(node, item);
  });
}

function wireUnifiedRelationField(node, item) {
  const field = node.querySelector(".relation-field");
  const input = field.querySelector(".relation-search");
  const suggestionBox = field.querySelector(".relation-suggestions");
  const chips = field.querySelector(".selected-chip-list");
  const pickedRows = [
    ...item.projects.map(row => ({ source: "project", row })),
    ...item.reviewProjects.map(row => ({ source: "review_project", row })),
    ...item.funds.map(row => ({ source: "fund", row })),
    ...item.assets.map(row => ({ source: "asset", row })),
    ...item.relation_texts.map(text => ({ source: "text", row: { name: text } })),
  ];
  renderChips(chips, pickedRows, relationChipLabel, picked => removeUnifiedRelation(item, picked));
  input.addEventListener("input", () => showSuggestions({
    anchor: suggestionBox,
    query: input.value,
    rows: buildUnifiedRelationRows(),
    label: unifiedRelationLabel,
    meta: unifiedRelationMeta,
    onPick: row => {
      addUnifiedRelation(item, row);
      input.value = "";
      closeSuggestions();
      renderAll();
    },
  }));
  node.querySelector(".add-relation-text").addEventListener("click", () => {
    const value = input.value.trim();
    if (value && !item.relation_texts.some(text => normalize(text) === normalize(value))) {
      item.relation_texts.push(value);
    }
    input.value = "";
    closeSuggestions();
    renderAll();
  });
}

function buildUnifiedRelationRows() {
  return uniqueRowsByLabel([
    ...state.masters.projects.map(row => ({ source: "project", row })),
    ...state.masters.reviewProjects.map(row => ({ source: "review_project", row })),
    ...state.masters.funds.map(row => ({ source: "fund", row })),
    ...state.masters.assets.map(row => ({ source: "asset", row })),
  ], unifiedRelationLabel);
}

function isSelectableProject(row) {
  const name = String(row.project_name || "").trim();
  const source = String(row.source_system || "");
  const type = String(row.project_type || "");
  if (!name) return false;
  if (type === "Mission") return false;
  if (name.startsWith("'") || name.startsWith('"')) return false;
  if (source === "t5t_project_mission" && row.status !== "설정 후") return false;
  if (isWorkLikeProjectName(name)) return false;
  if (source === "t5t_project_mission" && name.length > 24) return false;
  return true;
}

function isSelectableReviewProject(row) {
  const name = String(row.project_name || "").trim();
  if (!name) return false;
  if (name.startsWith("'") || name.startsWith('"')) return false;
  return !isWorkLikeProjectName(name);
}

function isWorkLikeProjectName(name) {
  const workLikeTerms = [
    "분기별",
    "위탁운용보고서",
    "위탁운용펀드",
    "수익자",
    "대주현황",
    "수익자/대주",
    "투자자 보고",
    "투자자 세미나",
    "보고자료",
    "보고회",
    "시장전망",
    "IM작성",
    "마켓 DB",
    "DB 관리",
    "업데이트",
    "작성 지원",
    "자료 지원",
  ];
  return workLikeTerms.some(term => name.includes(term));
}

function addUnifiedRelation(item, picked) {
  const map = { project: "projects", review_project: "reviewProjects", fund: "funds", asset: "assets" };
  const key = map[picked.source];
  if (!key) return;
  if (!item[key].some(existing => getRowId(existing) === getRowId(picked.row))) item[key].push(picked.row);
  item.relation_texts = item.relation_texts.filter(text => normalize(text) !== normalize(unifiedRelationLabel(picked)));
  item.task_type = null;
}

function removeUnifiedRelation(item, picked) {
  if (picked.source === "project") item.projects = item.projects.filter(row => row !== picked.row);
  if (picked.source === "review_project") item.reviewProjects = item.reviewProjects.filter(row => row !== picked.row);
  if (picked.source === "fund") item.funds = item.funds.filter(row => row !== picked.row);
  if (picked.source === "asset") item.assets = item.assets.filter(row => row !== picked.row);
  if (picked.source === "text") item.relation_texts = item.relation_texts.filter(text => text !== picked.row.name);
  renderAll();
}

function hasDbRelation(item) {
  return item.projects.length > 0 || item.reviewProjects.length > 0 || item.funds.length > 0 || item.assets.length > 0;
}

function updateFallbackClassifier(node, item) {
  const disabled = hasDbRelation(item);
  const box = node.querySelector(".fallback-classifier");
  box.classList.toggle("is-disabled", disabled);
  node.querySelectorAll(".type-toggle button").forEach(button => {
    button.disabled = disabled;
    if (disabled) button.classList.remove("active");
  });
}

function wireCounterpartyField(node, item) {
  const input = node.querySelector(".counterparty-search");
  const suggestionBox = node.querySelector(".counterparty-suggestions");
  const chips = node.querySelector(".selected-counterparties");
  const allPicked = [
    ...item.counterparties.map(row => ({ type: "master", row })),
    ...item.counterparty_texts.map(text => ({ type: "text", row: { name: text } })),
  ];
  renderChips(chips, allPicked, picked => picked.row.name, picked => {
    if (picked.type === "master") item.counterparties = item.counterparties.filter(row => row !== picked.row);
    else item.counterparty_texts = item.counterparty_texts.filter(text => text !== picked.row.name);
    renderAll();
  });
  input.addEventListener("input", () => showSuggestions({
    anchor: suggestionBox,
    query: input.value,
    rows: state.masters.counterparties,
    label: row => row.name,
    meta: row => row.category || "counterparty",
    onPick: row => {
      if (!item.counterparties.some(existing => existing.counterparty_id === row.counterparty_id)) item.counterparties.push(row);
      input.value = "";
      closeSuggestions();
      renderAll();
    },
  }));
  node.querySelector(".add-counterparty-text").addEventListener("click", () => {
    const value = input.value.trim();
    if (value && !item.counterparty_texts.includes(value)) item.counterparty_texts.push(value);
    input.value = "";
    renderAll();
  });
}

function renderChips(container, rows, labelFn, onRemove) {
  container.innerHTML = rows.map((row, index) => `
    <span class="chip">
      <span>${escapeHtml(labelFn(row))}</span>
      <button type="button" data-index="${index}" aria-label="삭제">×</button>
    </span>
  `).join("");
  container.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => onRemove(rows[Number(button.dataset.index)]));
  });
}

function showSuggestions({ anchor, query, rows, label, meta, onPick }) {
  const needle = normalize(query);
  if (!needle) {
    anchor.classList.remove("is-open");
    anchor.innerHTML = "";
    return;
  }
  const matches = rows
    .filter(row => normalize(`${label(row)} ${meta(row)} ${searchTextForRow(row)}`).includes(needle))
    .slice(0, 12);
  anchor.innerHTML = matches.length ? matches.map((row, index) => `
    <button type="button" class="suggestion" data-index="${index}">
      <strong>${escapeHtml(label(row))}</strong>
      ${meta(row) ? `<small>${escapeHtml(meta(row))}</small>` : ""}
    </button>
  `).join("") : '<div class="suggestion"><strong>검색 결과 없음</strong><small>신규 후보로 저장할 수 있습니다.</small></div>';
  anchor.classList.add("is-open");
  anchor.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => onPick(matches[Number(button.dataset.index)]));
  });
}

function searchTextForRow(row) {
  const data = row?.row || row || {};
  const metadata = data.metadata || {};
  return [
    data.project_name,
    data.project_code,
    data.review_project_id,
    data.fund_name,
    data.short_name,
    data.asset_name,
    data.project_mission_name,
    data.notion_vehicle_class,
    metadata["Vehicle(약칭)"],
    metadata["Vehicle(약칭)(롤업)"],
    metadata["Project & Mission 이름"],
    metadata["펀드명"],
    metadata["펀드코드"],
    metadata["자산명"],
    metadata.vehicle_type,
    metadata.vehicle_name,
    metadata.short_name,
    metadata.asset_name,
    data.canonical_name,
    data.asset_code,
    data.city,
    data.address_text,
    data.portfolio_theme,
    data.portfolio_region,
    data.name,
    data.email,
    data.org_display,
  ].filter(Boolean).join(" ");
}

function closeSuggestions() {
  document.querySelectorAll(".suggestions").forEach(box => box.classList.remove("is-open"));
}

function makePayload() {
  return {
    writer_staff_id: state.writer?.staff_id || null,
    writer_email: state.writer?.email || null,
    writer_name: state.writer?.name || null,
    work_date: els.workDate.value,
    week_key: getWeekKey(els.workDate.value),
    week_label: getWeekLabel(els.workDate.value),
    org_id: state.writer?.org_id || null,
    org_name: state.writer?.org_display || null,
    line: state.writer?.line_label || state.writer?.line_code || state.writer?.org_display || null,
    source_system: "t5t_input_prototype",
    items: state.items.map((item, index) => ({
      item_no: index + 1,
      task_type: hasDbRelation(item) ? null : item.task_type,
      project_ids: item.projects.map(row => row.project_id),
      review_project_ids: item.reviewProjects.map(row => row.review_project_id),
      fund_ids: item.funds.map(row => row.fund_id),
      asset_ids: item.assets.map(row => row.asset_id),
      relation_texts: item.relation_texts,
      counterparty_ids: item.counterparties.map(row => row.counterparty_id),
      counterparty_candidates: item.counterparty_texts,
      summary: item.summary.trim(),
      raw_text: item.raw_text.trim(),
    })),
  };
}

function renderPayload() {
  els.payloadPreview.textContent = JSON.stringify(makePayload(), null, 2);
}

function renderValidation() {
  const payload = makePayload();
  const checks = [
    ["이메일로 작성자 확인", Boolean(payload.writer_staff_id)],
    ["작성일 입력", Boolean(payload.work_date)],
    ["업무 항목 1개 이상", payload.items.length > 0],
    ["모든 항목 요약 입력", payload.items.every(item => item.summary)],
    ["모든 항목 원문 입력", payload.items.every(item => item.raw_text)],
    ["관련 프로젝트/펀드/자산 또는 텍스트 입력", payload.items.every(item =>
      item.project_ids.length > 0 ||
      item.review_project_ids.length > 0 ||
      item.fund_ids.length > 0 ||
      item.asset_ids.length > 0 ||
      item.relation_texts.length > 0 ||
      Boolean(item.task_type)
    )],
  ];
  els.validationList.innerHTML = checks.map(([label, ok]) => `
    <div class="check ${ok ? "ok" : "bad"}">
      <span>${label}</span>
      <strong>${ok ? "OK" : "필요"}</strong>
    </div>
  `).join("");
}

function saveDraft() {
  localStorage.setItem("t5t-input-draft", JSON.stringify(makePayload()));
  els.saveDraft.textContent = "저장됨";
  setTimeout(() => { els.saveDraft.textContent = "로컬 초안 저장"; }, 1200);
}

function restoreDraft() {
  const raw = localStorage.getItem("t5t-input-draft");
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (draft.work_date) els.workDate.value = draft.work_date;
    state.items = (draft.items || []).map(item => ({
      id: crypto.randomUUID(),
      task_type: item.task_type || null,
      projects: [],
      reviewProjects: [],
      funds: [],
      assets: [],
      relation_texts: item.relation_texts || [],
      counterparties: [],
      counterparty_texts: item.counterparty_candidates || [],
      summary: item.summary || "",
      raw_text: item.raw_text || "",
    }));
  } catch {
    localStorage.removeItem("t5t-input-draft");
  }
}

async function copyPayload() {
  await navigator.clipboard.writeText(JSON.stringify(makePayload(), null, 2));
  els.copyPayload.textContent = "복사됨";
  setTimeout(() => { els.copyPayload.textContent = "Payload 복사"; }, 1200);
}

function resetForm() {
  state.writer = null;
  state.items = [];
  els.writerSearch.value = "";
  els.lineLabel.value = "";
  setDefaultDate();
  localStorage.removeItem("t5t-input-draft");
  addItem();
  renderAll();
}

function getWeekKey(dateString) {
  if (!dateString) return "";
  const date = parseDate(dateString);
  const day = date.getDay();
  const daysSinceTuesday = (day + 5) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysSinceTuesday);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return formatDate(weekEnd);
}

function getWeekLabel(dateString) {
  if (!dateString) return "";
  const end = getWeekKey(dateString);
  const start = parseDate(end);
  start.setDate(start.getDate() - 6);
  return `${formatDate(start)} ~ ${end} (화~월)`;
}

function parseDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function projectLabel(row) {
  return row.project_name || row.project_id;
}

function projectMeta() {
  return "";
}

function fundLabel(row) {
  const vehicle = row.short_name || row.metadata?.vehicle_type || row.notion_vehicle_class;
  return vehicle ? `${vehicle} · ${row.fund_name}` : row.fund_name || row.fund_id;
}

function fundMeta() {
  return "";
}

function assetLabel(row) {
  return row.canonical_name || row.asset_id;
}

function assetMeta() {
  return "";
}

function unifiedRelationLabel(picked) {
  if (picked.source === "project") return projectLabel(picked.row);
  if (picked.source === "review_project") return reviewProjectLabel(picked.row);
  if (picked.source === "fund") return fundLabel(picked.row);
  if (picked.source === "asset") return assetLabel(picked.row);
  if (picked.source === "text") return picked.row.name;
  return "";
}

function unifiedRelationMeta(picked) {
  const label = { project: "프로젝트", review_project: "검토 프로젝트", fund: "펀드", asset: "자산", text: "텍스트" }[picked.source] || "";
  return label;
}

function relationChipLabel(picked) {
  const typeLabel = unifiedRelationMeta(picked);
  return `${typeLabel} · ${unifiedRelationLabel(picked)}`;
}

function reviewProjectLabel(row) {
  return row.project_name || row.review_project_id;
}

function getRowId(row) {
  return row.project_id || row.review_project_id || row.fund_id || row.asset_id || row.counterparty_id || row.name;
}

function uniqueRowsByLabel(rows, labelFn) {
  const seen = new Set();
  return rows.filter(row => {
    const key = normalize(labelFn(row));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichStaff(staff, orgs, assignments) {
  const orgById = new Map(orgs.map(org => [org.org_id, org]));
  const assignmentsByStaff = new Map();
  assignments.forEach(assignment => {
    if (!assignmentsByStaff.has(assignment.staff_id)) assignmentsByStaff.set(assignment.staff_id, []);
    assignmentsByStaff.get(assignment.staff_id).push(assignment);
  });
  return staff.map(row => {
    const staffAssignments = assignmentsByStaff.get(row.staff_id) || [];
    const mainAssignments = staffAssignments.filter(item => !isTemporaryOrgAssignment(item, orgById.get(item.org_id)));
    const sourceAssignments = mainAssignments.length ? mainAssignments : staffAssignments;
    const assignment = sourceAssignments.find(item => item.is_primary) || sourceAssignments[0] || null;
    const org = assignment ? orgById.get(assignment.org_id) : null;
    const metaPath = assignment?.metadata?.org_path;
    return {
      ...row,
      org_id: org?.org_id || assignment?.org_id || null,
      org_display: org?.org_path || metaPath || row.line_label || row.line_code || "",
    };
  });
}

function isTemporaryOrgAssignment(assignment, org) {
  const meta = assignment?.metadata || {};
  const values = [
    org?.org_name,
    org?.org_path,
    org?.org_type,
    meta.section,
    meta.group,
    meta.part,
    meta.team,
    meta.org_path,
    ...(Array.isArray(meta.tags) ? meta.tags : []),
  ].filter(Boolean).map(value => String(value).toLowerCase());

  return values.some(value =>
    value.includes("tf") ||
    value.includes("tft") ||
    value.includes("임시") ||
    value.includes("겸직")
  );
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}
