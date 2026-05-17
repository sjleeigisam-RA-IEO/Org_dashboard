const DRAFT_KEY = "t5t-input-draft";
const SUBMIT_ENDPOINT = "http://localhost:8787/submit_t5t";
const NOTION_ENDPOINT = "http://localhost:8787/submit_notion";

const state = {
  masters: {
    staff: [],
    orgs: [],
    assignments: [],
    projects: [],
    reviewProjects: [],
    funds: [],
    assets: [],
    counterparties: [],
  },
  writer: null,
  items: [],
  pendingDraft: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  setDefaultDate();
  wireHeaderEvents();
  addItem();
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
    payloadSummary: document.getElementById("payload-summary"),
    payloadPreview: document.getElementById("payload-preview"),
    submitNotion: document.getElementById("submit-notion"),
    submitPayload: document.getElementById("submit-payload"),
    submitStatus: document.getElementById("submit-status"),
    saveDraft: document.getElementById("save-draft"),
    loadDraft: document.getElementById("load-draft"),
    copyPayload: document.getElementById("copy-payload"),
  });
}

function wireHeaderEvents() {
  on(els.writerSearch, "input", handleWriterInput);
  on(els.workDate, "change", renderAll);
  on(els.addItem, "click", () => {
    if (state.items.length < 5) addItem();
    renderAll();
  });
  on(els.resetForm, "click", resetForm);
  on(els.submitNotion, "click", submitNotionOnly);
  on(els.submitPayload, "click", submitPayload);
  on(els.saveDraft, "click", saveDraft);
  on(els.loadDraft, "click", loadDraftFromStorage);
  on(els.copyPayload, "click", copyPayload);
  document.addEventListener("click", event => {
    if (!event.target.closest(".field")) closeSuggestions();
  });
}

function on(element, eventName, handler) {
  if (element) element.addEventListener(eventName, handler);
}

function setDefaultDate() {
  if (els.workDate) els.workDate.value = formatDate(new Date());
}

async function loadMasters() {
  try {
    setStatus("DB master 불러오는 중");
    const [staff, orgs, assignments, projects, reviewProjects, funds, assets, counterparties] = await Promise.all([
      fetchAll("staff", "staff_id,employee_no,name,email,position,title,line_code,line_label,status", "name"),
      fetchAll("orgs", "org_id,org_name,org_path,is_active,metadata", "org_name"),
      fetchAll("staff_org_assignments", "assignment_id,staff_id,org_id,is_primary,role,metadata", "staff_id"),
      fetchAll("projects", "project_id,project_name,project_code,project_type,status,primary_asset_id,source_system,metadata", "project_name"),
      fetchOptional("review_projects", "review_project_id,notion_id,source_project_id,project_name,review_status,source_status,metadata", "project_name"),
      fetchAll("funds", "fund_id,fund_name,short_name,asset_name,status,project_mission_name,primary_asset_id,metadata,notion_vehicle_class", "fund_name"),
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
    setStatus("DB master 연결됨", "ok");
    hydrateDraftSelections();
  } catch (error) {
    console.error(error);
    setStatus("DB 연결 실패", "error");
  }
}

function setStatus(text, type = "") {
  if (!els.status) return;
  els.status.textContent = text;
  els.status.classList.toggle("ok", type === "ok");
  els.status.classList.toggle("error", type === "error");
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
    raw_text: seed.raw_text || "",
    pending_project_ids: seed.pending_project_ids || [],
    pending_review_project_ids: seed.pending_review_project_ids || [],
    pending_fund_ids: seed.pending_fund_ids || [],
    pending_asset_ids: seed.pending_asset_ids || [],
    pending_counterparty_ids: seed.pending_counterparty_ids || [],
  });
}

function renderAll() {
  updateWriterFields();
  renderItems();
  renderValidation();
  renderPayload();
}

function handleWriterInput() {
  const value = els.writerSearch.value.trim();
  const exact = state.masters.staff.find(row => normalizeEmail(row.email) === normalizeEmail(value));
  if (exact) {
    state.writer = exact;
    closeSuggestions();
    renderAll();
    return;
  }

  state.writer = null;
  updateWriterFields();
  showSuggestions({
    anchor: els.writerSuggestions,
    query: value,
    rows: state.masters.staff.filter(row => row.email || row.name),
    label: row => row.email || row.name || row.staff_id,
    meta: row => [row.name, row.org_display, row.position || row.title].filter(Boolean).join(" · "),
    onPick: row => {
      state.writer = row;
      els.writerSearch.value = row.email || "";
      closeSuggestions();
      renderAll();
    },
  });
  renderValidation();
  renderPayload();
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

    const removeButton = node.querySelector(".remove-item");
    removeButton.classList.toggle("is-hidden", state.items.length <= 1);
    removeButton.addEventListener("click", () => {
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

    const raw = node.querySelector(".raw-input");
    raw.value = item.raw_text;
    raw.addEventListener("input", () => {
      item.raw_text = raw.value;
      renderValidation();
      renderPayload();
    });

    els.itemStack.appendChild(node);
    updateFallbackClassifier(node, item);
  });
}

function wireUnifiedRelationField(node, item) {
  const field = node.querySelector(".relation-field");
  const input = field.querySelector(".relation-search");
  const editButton = field.querySelector(".edit-relation");
  const chips = field.querySelector(".selected-relations");
  const suggestionBox = field.querySelector(".relation-suggestions");
  const picked = selectedRelations(item)[0] || null;

  input.value = picked ? relationChipLabel(picked) : "";
  input.readOnly = Boolean(picked);
  input.classList.toggle("is-locked", Boolean(picked));
  editButton.hidden = !picked;
  chips.innerHTML = "";

  editButton.addEventListener("click", () => {
    clearUnifiedRelation(item);
    renderAll();
  });

  input.addEventListener("input", () => {
    if (input.readOnly) return;
    showSuggestions({
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
    });
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addRelationTextFromInput(item, input);
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => addRelationTextFromInput(item, input), 160);
  });
}

function selectedRelations(item) {
  return [
    ...item.projects.map(row => ({ source: "project", row })),
    ...item.reviewProjects.map(row => ({ source: "review_project", row })),
    ...item.funds.map(row => ({ source: "fund", row })),
    ...item.assets.map(row => ({ source: "asset", row })),
    ...item.relation_texts.map(text => ({ source: "text", row: { name: text } })),
  ];
}

function addRelationTextFromInput(item, input) {
  if (input.readOnly) return;
  const value = input.value.trim();
  if (!value || exactRelationMatch(value)) return;
  setSingleRelation(item, "text", value);
  item.task_type = item.task_type || "New";
  input.value = "";
  closeSuggestions();
  renderAll();
}

function exactRelationMatch(value) {
  const needle = normalize(value);
  return buildUnifiedRelationRows().some(row => normalize(unifiedRelationLabel(row)) === needle);
}

function buildUnifiedRelationRows() {
  return uniqueRowsByLabel([
    ...state.masters.projects.map(row => ({ source: "project", row })),
    ...state.masters.reviewProjects.map(row => ({ source: "review_project", row })),
    ...state.masters.funds.map(row => ({ source: "fund", row })),
    ...state.masters.assets.map(row => ({ source: "asset", row })),
  ], unifiedRelationLabel);
}

function addUnifiedRelation(item, picked) {
  setSingleRelation(item, picked.source, picked.row);
  item.task_type = null;
}

function setSingleRelation(item, source, value) {
  clearUnifiedRelation(item);
  if (source === "project") item.projects = [value];
  if (source === "review_project") item.reviewProjects = [value];
  if (source === "fund") item.funds = [value];
  if (source === "asset") item.assets = [value];
  if (source === "text") item.relation_texts = [value];
}

function clearUnifiedRelation(item) {
  item.projects = [];
  item.reviewProjects = [];
  item.funds = [];
  item.assets = [];
  item.relation_texts = [];
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

  renderChips(chips, allPicked, counterpartyChipLabel, picked => {
    if (picked.type === "master") item.counterparties = item.counterparties.filter(row => row.counterparty_id !== picked.row.counterparty_id);
    else item.counterparty_texts = item.counterparty_texts.filter(text => normalize(text) !== normalize(picked.row.name));
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
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCounterpartyTextFromInput(item, input);
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => addCounterpartyTextFromInput(item, input), 160);
  });
}

function addCounterpartyTextFromInput(item, input) {
  const value = input.value.trim();
  if (!value || exactCounterpartyMatch(value)) return;
  if (!item.counterparty_texts.some(text => normalize(text) === normalize(value))) item.counterparty_texts.push(value);
  input.value = "";
  closeSuggestions();
  renderAll();
}

function exactCounterpartyMatch(value) {
  const needle = normalize(value);
  return state.masters.counterparties.some(row => normalize(row.name) === needle);
}

function renderChips(container, rows, labelFn, onRemove) {
  container.innerHTML = rows.map((row, index) => `
    <span class="chip">
      ${renderChipLabel(labelFn(row))}
      <button type="button" data-index="${index}" aria-label="삭제">×</button>
    </span>
  `).join("");
  container.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => onRemove(rows[Number(button.dataset.index)]));
  });
}

function renderChipLabel(label) {
  if (typeof label === "object" && label !== null) {
    return `<strong>${escapeHtml(label.tag)}</strong><span>${escapeHtml(label.text)}</span>`;
  }
  return `<span>${escapeHtml(label)}</span>`;
}

function counterpartyChipLabel(picked) {
  return { tag: picked.type === "master" ? "DB" : "직접", text: picked.row.name };
}

function showSuggestions({ anchor, query, rows, label, meta, onPick }) {
  const needle = normalize(query);
  if (!anchor || !needle) {
    if (anchor) {
      anchor.classList.remove("is-open");
      anchor.innerHTML = "";
    }
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
  `).join("") : '<div class="suggestion empty"><strong>검색 결과 없음</strong><small>Enter로 직접 입력값을 확정할 수 있습니다.</small></div>';
  anchor.classList.add("is-open");
  anchor.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => onPick(matches[Number(button.dataset.index)]));
  });
}

function closeSuggestions() {
  document.querySelectorAll(".suggestions").forEach(box => box.classList.remove("is-open"));
}

function makePayload() {
  return {
    writer_staff_id: state.writer?.staff_id || null,
    writer_email: state.writer?.email || els.writerSearch.value.trim() || null,
    writer_name: state.writer?.name || null,
    work_date: els.workDate.value,
    week_key: getWeekKey(els.workDate.value),
    week_label: getWeekLabel(els.workDate.value),
    org_id: state.writer?.org_id || null,
    org_name: state.writer?.org_display || null,
    line: state.writer?.line_label || state.writer?.line_code || state.writer?.org_display || null,
    source_system: "t5t_input_local",
    items: state.items.map((item, index) => ({
      item_no: index + 1,
      task_type: hasDbRelation(item) ? null : item.task_type,
      project_ids: item.projects.map(row => row.project_id),
      review_project_ids: item.reviewProjects.map(row => row.review_project_id),
      fund_ids: item.funds.map(row => row.fund_id),
      asset_ids: item.assets.map(row => row.asset_id),
      relation_texts: item.relation_texts,
      relation_labels: selectedRelations(item).map(relationChipLabel),
      counterparty_ids: item.counterparties.map(row => row.counterparty_id),
      counterparty_candidates: item.counterparty_texts,
      counterparty_labels: [
        ...item.counterparties.map(row => row.name),
        ...item.counterparty_texts,
      ],
      summary: makeAutoSummary(item.raw_text),
      raw_text: item.raw_text.trim(),
    })),
  };
}

function makeAutoSummary(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 70 ? `${normalized.slice(0, 70)}...` : normalized;
}

function renderPayload() {
  const payload = makePayload();
  els.payloadSummary.innerHTML = makePayloadSummary(payload).map(row => `
    <div class="summary-row">
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.value)}</strong>
    </div>
  `).join("");
  els.payloadPreview.textContent = JSON.stringify(payload, null, 2);
}

function makePayloadSummary(payload) {
  const relationCount = payload.items.reduce((sum, item) => sum + item.relation_labels.length, 0);
  const counterpartyCount = payload.items.reduce((sum, item) => sum + item.counterparty_labels.length, 0);
  const typedItems = payload.items.reduce((acc, item) => {
    const key = item.task_type || "DB 연결";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const typeLabel = Object.entries(typedItems).map(([key, count]) => `${key} ${count}`).join(" · ");
  return [
    { label: "작성자", value: payload.writer_name || "미확인" },
    { label: "주차", value: payload.week_label || "-" },
    { label: "업무 항목", value: `${payload.items.length}개` },
    { label: "업무 분류", value: typeLabel || "-" },
    { label: "프로젝트/펀드/자산", value: `${relationCount}개` },
    { label: "이해관계자", value: `${counterpartyCount}개` },
  ];
}

function renderValidation() {
  const payload = makePayload();
  const checks = getValidationChecks(payload);
  els.validationList.innerHTML = checks.map(([label, ok]) => `
    <div class="check ${ok ? "ok" : "bad"}">
      <span>${escapeHtml(label)}</span>
      <strong>${ok ? "OK" : "필요"}</strong>
    </div>
  `).join("");
}

function getValidationChecks(payload) {
  return [
    ["이메일로 작성자 확인", Boolean(payload.writer_staff_id)],
    ["작성일 입력", Boolean(payload.work_date)],
    ["업무 항목 1개 이상", payload.items.length > 0],
    ["모든 항목 업무 내용 입력", payload.items.every(item => item.raw_text)],
    ["관련 프로젝트/펀드/자산 또는 분류 선택", payload.items.every(item =>
      item.relation_labels.length > 0 || Boolean(item.task_type)
    )],
  ];
}

function isPayloadValid(payload) {
  return getValidationChecks(payload).every(([, ok]) => ok);
}

async function submitPayload() {
  await postSubmission({
    endpoint: SUBMIT_ENDPOINT,
    button: els.submitPayload,
    pendingMessage: "SQL DB와 Notion에 저장하는 중입니다...",
    successMessage: result => `저장 완료: ${result.submission_id}`,
  });
}

async function submitNotionOnly() {
  await postSubmission({
    endpoint: NOTION_ENDPOINT,
    button: els.submitNotion,
    pendingMessage: "Notion 원문 DB에 저장하는 중입니다...",
    successMessage: result => `Notion 저장 완료: ${result.notion_url || result.notion_page_id}`,
  });
}

async function postSubmission({ endpoint, button, pendingMessage, successMessage }) {
  const payload = makePayload();
  if (!isPayloadValid(payload)) {
    setSubmitStatus("필수 항목을 먼저 입력해 주세요.", "error");
    return;
  }
  button.disabled = true;
  setSubmitStatus(pendingMessage, "");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "제출에 실패했습니다.");
    localStorage.removeItem(DRAFT_KEY);
    setSubmitStatus(successMessage(result), "ok");
  } catch (error) {
    console.error(error);
    setSubmitStatus(error.message || "제출에 실패했습니다.", "error");
  } finally {
    button.disabled = false;
  }
}

function setSubmitStatus(message, type) {
  if (!els.submitStatus) return;
  els.submitStatus.textContent = message;
  els.submitStatus.className = `submit-status ${type || ""}`.trim();
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(makePayload()));
  pulseButton(els.saveDraft, "저장됨", "로컬 초안 저장");
}

function loadDraftFromStorage() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) {
    pulseButton(els.loadDraft, "저장된 초안 없음", "초안 불러오기");
    return;
  }
  try {
    const draft = JSON.parse(raw);
    state.pendingDraft = draft;
    state.writer = null;
    els.writerSearch.value = draft.writer_email || "";
    els.workDate.value = draft.work_date || formatDate(new Date());
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
      raw_text: item.raw_text || item.summary || "",
      pending_project_ids: item.project_ids || [],
      pending_review_project_ids: item.review_project_ids || [],
      pending_fund_ids: item.fund_ids || [],
      pending_asset_ids: item.asset_ids || [],
      pending_counterparty_ids: item.counterparty_ids || [],
    }));
    hydrateDraftSelections();
    renderAll();
    pulseButton(els.loadDraft, "불러옴", "초안 불러오기");
  } catch {
    localStorage.removeItem(DRAFT_KEY);
    pulseButton(els.loadDraft, "초안 오류", "초안 불러오기");
  }
}

function hydrateDraftSelections() {
  const draft = state.pendingDraft;
  if (!draft) return;
  const writer = state.masters.staff.find(row =>
    row.staff_id === draft.writer_staff_id ||
    normalizeEmail(row.email) === normalizeEmail(draft.writer_email)
  );
  if (writer) {
    state.writer = writer;
    els.writerSearch.value = writer.email || "";
  }

  const byId = rows => new Map(rows.map(row => [getRowId(row), row]));
  const projectById = byId(state.masters.projects);
  const reviewProjectById = byId(state.masters.reviewProjects);
  const fundById = byId(state.masters.funds);
  const assetById = byId(state.masters.assets);
  const counterpartyById = byId(state.masters.counterparties);
  state.items.forEach(item => {
    item.projects = hydrateByIds(projectById, item.pending_project_ids);
    item.reviewProjects = hydrateByIds(reviewProjectById, item.pending_review_project_ids);
    item.funds = hydrateByIds(fundById, item.pending_fund_ids);
    item.assets = hydrateByIds(assetById, item.pending_asset_ids);
    item.counterparties = hydrateByIds(counterpartyById, item.pending_counterparty_ids);
  });
  state.pendingDraft = null;
}

function hydrateByIds(map, ids = []) {
  return ids.map(id => map.get(id)).filter(Boolean);
}

async function copyPayload() {
  await navigator.clipboard.writeText(JSON.stringify(makePayload(), null, 2));
  pulseButton(els.copyPayload, "복사됨", "Payload 복사");
}

function pulseButton(button, activeText, originalText) {
  if (!button) return;
  button.textContent = activeText;
  setTimeout(() => { button.textContent = originalText; }, 1200);
}

function resetForm() {
  state.writer = null;
  state.items = [];
  els.writerSearch.value = "";
  els.lineLabel.value = "";
  els.weekLabel.value = "";
  setDefaultDate();
  localStorage.removeItem(DRAFT_KEY);
  addItem();
  setSubmitStatus("", "");
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

function reviewProjectLabel(row) {
  return row.project_name || row.review_project_id;
}

function fundLabel(row) {
  const vehicle = row.short_name || row.metadata?.vehicle_type || row.notion_vehicle_class;
  return vehicle ? `${vehicle} · ${row.fund_name}` : row.fund_name || row.fund_id;
}

function assetLabel(row) {
  return row.canonical_name || row.asset_id;
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
  return { project: "프로젝트", review_project: "검토프로젝트", fund: "펀드", asset: "자산", text: "직접입력" }[picked.source] || "";
}

function relationChipLabel(picked) {
  return `${unifiedRelationMeta(picked)} · ${unifiedRelationLabel(picked)}`;
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

function searchTextForRow(row) {
  const data = row?.row || row || {};
  const metadata = data.metadata || {};
  return [
    data.project_name,
    data.project_code,
    data.fund_name,
    data.short_name,
    data.asset_name,
    data.project_mission_name,
    data.notion_vehicle_class,
    metadata.vehicle_type,
    metadata.vehicle_name,
    metadata.short_name,
    metadata.asset_name,
    data.canonical_name,
    data.asset_code,
    data.city,
    data.address_text,
    data.name,
    data.email,
    data.org_display,
  ].filter(Boolean).join(" ");
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
  return values.some(value => value.includes("tf") || value.includes("tft") || value.includes("임시") || value.includes("겸직"));
}

function isSelectableProject(row) {
  const name = String(row.project_name || "").trim();
  const source = String(row.source_system || "");
  const type = String(row.project_type || "");
  if (!name) return false;
  if (type === "Mission") return false;
  if (name.startsWith("'") || name.startsWith('"')) return false;
  if (source === "t5t_project_mission" && row.status !== "설정 중") return false;
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
  return [
    "분기별",
    "위탁운용보고",
    "운용현황",
    "수익자",
    "대주현황",
    "투자자 보고",
    "투자자 커뮤니케이션",
    "보고자료",
    "보고서",
    "시장현황",
    "IM작성",
    "마켓 DB",
    "DB 관리",
    "업데이트",
    "작성 지원",
    "자료 지원",
  ].some(term => name.includes(term));
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
