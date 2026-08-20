(function () {
  const TABLE_NAME = "dev_project_34_dashboard_info";
  const FEE_STORAGE_KEY = "devProjectFeeInputs.v3";
  const GROUP_VISIBILITY_STORAGE_KEY = "devProjectColumnGroups.v1";

  const identityColumns = [
    "project_name",
    "source_category",
    "vehicle_text"
  ];

  const feeColumns = [
    "fee_1",
    "fee_2",
    "fee_3",
    "fee_4",
    "fee_5"
  ];

  const progressColumns = [
    "project_statuses",
    "setup_dates",
    "legal_forms",
    "notion_vehicle_classes",
    "notion_business_stage_classes",
    "notion_holding_type_classes"
  ];

  const fundColumns = [
    "fund_short_names",
    "fund_names",
    "fund_statuses",
    "fund_depts",
    "fund_managers",
    "benchmark_aum_total",
    "invested_aum_total"
  ];

  const assetColumns = [
    "asset_names",
    "asset_types",
    "address_texts",
    "main_usages",
    "site_areas",
    "gross_floor_areas",
    "scrs",
    "fars",
    "completion_dates"
  ];

  const columnGroups = [
    { id: "identity", label: "프로젝트", columns: identityColumns, locked: true },
    { id: "fees", label: "보수", columns: feeColumns },
    { id: "progress", label: "진행·분류", columns: progressColumns },
    { id: "funds", label: "펀드", columns: fundColumns },
    { id: "assets", label: "자산", columns: assetColumns }
  ];

  const columns = [
    ...identityColumns,
    ...feeColumns,
    ...progressColumns,
    ...fundColumns,
    ...assetColumns
  ];

  const alwaysVisibleColumns = new Set([...identityColumns, ...feeColumns]);
  const feeColumnSet = new Set(feeColumns);
  const columnGroupByColumn = new Map(
    columnGroups.flatMap((group) => group.columns.map((column) => [column, group.id]))
  );

  const labels = {
    list_no: "No",
    project_name: "프로젝트명",
    source_category: "구분",
    vehicle_text: "비히클",
    fee_1: "보수 1 매입보수",
    fee_2: "보수 2 PF보수(착공보수)",
    fee_3: "보수 3 준공보수",
    fee_4: "보수 4 운용보수",
    fee_5: "보수 5 매각보수",
    project_statuses: "프로젝트 상태",
    fund_short_names: "펀드 약칭",
    fund_names: "펀드명",
    fund_statuses: "펀드 상태",
    setup_dates: "설정일",
    legal_forms: "법적 형태",
    notion_vehicle_classes: "비히클 분류",
    notion_business_stage_classes: "사업단계",
    notion_holding_type_classes: "보유형태",
    fund_depts: "담당부서",
    fund_managers: "담당자",
    benchmark_aum_total: "기준 AUM",
    invested_aum_total: "투자 AUM",
    asset_names: "자산명",
    asset_types: "자산유형",
    asset_kinds: "자산성격",
    business_stages: "자산단계",
    address_texts: "주소",
    main_usages: "주용도",
    site_areas: "대지면적",
    gross_floor_areas: "연면적",
    scrs: "건폐율",
    fars: "용적률",
    completion_dates: "준공일"
  };

  const feeDefinitions = {
    fee_1: {
      number: "보수 1",
      title: "매입보수",
      trigger: "매입·설정·인수 관련 보수",
      owner: "투자 / 사업"
    },
    fee_2: {
      number: "보수 2",
      title: "PF보수(착공보수)",
      trigger: "PF 인출·착공 시점 보수",
      owner: "투자 / 사업"
    },
    fee_3: {
      number: "보수 3",
      title: "준공보수",
      trigger: "준공·사용승인 시점 보수",
      owner: "사업 / 운용관리"
    },
    fee_4: {
      number: "보수 4",
      title: "운용보수",
      trigger: "AMC·PM·관리 등 운용 기간 보수",
      owner: "운용관리 / 사업"
    },
    fee_5: {
      number: "보수 5",
      title: "매각보수",
      trigger: "매각·성과 회수 시점 보수",
      owner: "투자 / 운용관리"
    }
  };

  const pfFeeSource = {
    title: "26년 상반기 결산 보수 취합 / PF 관련 보수",
    totalAmountLabel: "엑셀·노션 취합"
  };

  const pfFeeSchedule = [
    {
      listNo: 25,
      feeColumn: "fee_2",
      placeholder: "PF 예정",
      priority: 5
    },
    {
      listNo: 35,
      feeColumn: "fee_2",
      placeholder: "PF 예정",
      priority: 6
    },
    {
      listNo: 36,
      feeColumn: "fee_2",
      placeholder: "PF 예정",
      priority: 7
    },
    {
      listNo: 37,
      feeColumn: "fee_2",
      placeholder: "PF 예정",
      priority: 8
    },
    {
      listNo: 34,
      feeColumn: "fee_1",
      amountWon: 1800000000,
      timing: "'26.11",
      basis: "PF인출분",
      structure: "매입보수 20억 (설정 2 + PF인출 18)",
      note: "설정분 2억 기수취",
      priority: 10
    },
    {
      listNo: 17,
      feeColumn: "fee_1",
      amountWon: 1250000000,
      timing: "'26.12",
      basis: "유보분 포함 수취 가능액",
      structure: "매입보수 성격 총 70억 (브릿지 5 / 종상향 5 / 본PF 5 / 분양완료 55)",
      note: "시공사 변경 시 보수 조정 가능성 있음",
      priority: 20
    },
    {
      listNo: 10,
      feeColumn: "fee_2",
      amountWon: 1100000000,
      timing: "'26.12",
      basis: "착공분",
      structure: "매입보수 25억 (설정 3 / 착공 11 / 준공 11)",
      note: "설정분 3억은 별도 확인 필요",
      priority: 30
    },
    {
      listNo: 27,
      feeColumn: "fee_2",
      amountWon: 5000000000,
      timing: "'27.1",
      basis: "사업정상화 성과수수료",
      structure: "성과수수료 50억 + 유보수수료 월 10억 (AMC 8 + 관리 2, PF인출일까지)",
      note: "PF인출일로부터 10영업일 이내 수취. 567호 별도 보수 없음",
      priority: 40
    },
    {
      listNo: 12,
      feeColumn: "fee_4",
      displayValue: "150000000원/월",
      timing: "PF후",
      basis: "운용보수",
      structure: "월 300,000,000원 중 PJM 수수료 150,000,000원 포함",
      note: "엑셀 PF후 기준 순액 150,000,000원/월",
      priority: 50
    },
    {
      listNo: 28,
      feeColumn: "fee_1",
      amountWon: 1914000000,
      timing: "기수취",
      basis: "매입보수",
      structure: "매입보수 1,914,000,000원",
      note: "엑셀 PF후 기준",
      priority: 60
    },
    {
      listNo: 28,
      feeColumn: "fee_4",
      displayValue: "27000000원/월",
      timing: "개발기간",
      basis: "운용보수",
      structure: "개발기간 27,000,000원/월, 운영기간 20,000,000원/월",
      note: "엑셀 PF후 기준",
      priority: 61
    },
    {
      listNo: 29,
      feeColumn: "fee_4",
      displayValue: "34000000원/월",
      timing: "개발기간",
      basis: "운용보수",
      structure: "개발기간 34,000,000원/월",
      note: "운영기간 보수는 2029.01 이후 0.2% 조건",
      priority: 62
    },
    {
      listNo: 29,
      feeColumn: "fee_5",
      amountWon: 1050000000,
      timing: "매각",
      basis: "매각기본보수",
      structure: "UW 기준 1,050,000,000원",
      note: "엑셀 PF후 기준",
      priority: 63
    },
    {
      listNo: 14,
      feeColumn: "fee_1",
      amountWon: 2700000000,
      timing: "매입",
      basis: "매입수수료",
      structure: "매입수수료 1·2·3 합계 2,700,000,000원",
      note: "엑셀 PF후 기준",
      priority: 64
    },
    {
      listNo: 14,
      feeColumn: "fee_4",
      displayValue: "83000000원/월",
      timing: "착공후",
      basis: "월관리수수료",
      structure: "착공전 60,000,000원/월, 착공후 83,000,000원/월",
      note: "엑셀 PF후 기준",
      priority: 65
    },
    {
      listNo: 19,
      feeColumn: "fee_1",
      amountWon: 5300000000,
      timing: "기수취",
      basis: "매입 관련 별도보수",
      structure: "최초매입 1,500,000,000원 + 국공유지매입 3,800,000,000원",
      note: "엑셀 PF후 기준",
      priority: 66
    },
    {
      listNo: 19,
      feeColumn: "fee_4",
      displayValue: "50000000원/월",
      timing: "PF후",
      basis: "개발보수",
      structure: "PF전 20,000,000원/월, PF후 50,000,000원/월",
      note: "엑셀 PF후 기준",
      priority: 67
    },
    {
      listNo: 19,
      feeColumn: "fee_5",
      amountWon: 4800000000,
      timing: "매각",
      basis: "매각보수",
      structure: "매각보수 4,800,000,000원",
      note: "엑셀 PF후 기준",
      priority: 68
    },
    {
      listNo: 13,
      feeColumn: "fee_1",
      amountWon: 2000000000,
      timing: "기수취",
      basis: "매입보수",
      structure: "매입보수 2,000,000,000원 지급완료",
      note: "엑셀 PF후 기준",
      priority: 69
    },
    {
      listNo: 13,
      feeColumn: "fee_4",
      displayValue: "140000000원/월",
      timing: "개발기간",
      basis: "개발보수",
      structure: "개발보수 140,000,000원/월",
      note: "엑셀 PF후 기준",
      priority: 70
    },
    {
      listNo: 13,
      feeColumn: "fee_5",
      amountWon: 10444000000,
      timing: "매각",
      basis: "매각보수 잔여 예상",
      structure: "잔여 예상 10,444,000,000원",
      note: "기지급 10,639,000,000원 별도",
      priority: 71
    },
    {
      listNo: 31,
      feeColumn: "fee_4",
      displayValue: "56000000원/월",
      timing: "PF후",
      basis: "운용보수",
      structure: "운용보수 약 56,000,000원/월",
      note: "미수 운용보수 4,650,000,000원은 회수 어려움으로 기재 보류",
      priority: 72
    },
    {
      listNo: 22,
      feeColumn: "fee_4",
      displayValue: "300000000원/월",
      timing: "PF후",
      basis: "운용보수",
      structure: "운용보수 300,000,000원/월",
      note: "엑셀 PF전 기준: 지급액 3,000,000,000원, 미지급액 6,200,000,000원, 본PF시 지급예정",
      priority: 73
    },
    {
      listNo: 23,
      feeColumn: "fee_4",
      displayValue: "600000000원/월",
      timing: "PF후",
      basis: "운용보수",
      structure: "운용보수 600,000,000원/월",
      note: "엑셀 PF후 기준: 미지급액 600,000,000원, 본PF시 추가 연장 예정",
      priority: 74
    }
  ];

  const hiddenProjectListNos = new Set([1, 7, 32]);

  const manualProjectRows = [
    {
      list_no: 35,
      dev_project_id: "manual_pf_035",
      project_name: "김포 DC",
      source_category: "PF전",
      vehicle_text: "수기 추가",
      project_statuses: ["PF전"],
      notion_business_stage_classes: ["PF전"],
      notion_holding_type_classes: [],
      fund_names: [],
      asset_names: ["김포 DC"],
      address_texts: [],
      main_usages: ["데이터센터"]
    },
    {
      list_no: 36,
      dev_project_id: "manual_pf_036",
      project_name: "은평 시니어리빙 2호",
      source_category: "PF전",
      vehicle_text: "수기 추가",
      project_statuses: ["PF전"],
      notion_business_stage_classes: ["PF전"],
      notion_holding_type_classes: [],
      fund_names: [],
      asset_names: ["은평 시니어리빙 2호"],
      address_texts: [],
      main_usages: ["시니어리빙"]
    },
    {
      list_no: 37,
      dev_project_id: "manual_pf_037",
      project_name: "하남 2IDC",
      source_category: "PF전",
      vehicle_text: "수기 추가",
      project_statuses: ["PF전"],
      notion_business_stage_classes: ["PF전"],
      notion_holding_type_classes: [],
      fund_names: [],
      asset_names: ["하남 2IDC"],
      address_texts: [],
      main_usages: ["데이터센터"]
    }
  ];

  const pfFeeByListNo = new Map();
  pfFeeSchedule.forEach((item) => {
    const items = pfFeeByListNo.get(item.listNo) || [];
    items.push(item);
    pfFeeByListNo.set(item.listNo, items);
  });

  let allRows = [];
  let visibleColumns = columns.slice();
  let activeCategory = "all";
  let sortState = { column: "setup_dates", direction: "asc" };
  let collapsedGroups = loadCollapsedGroups();
  let activeFilters = {
    status: "",
    stage: "",
    holding: "",
    dept: ""
  };
  let feeInputs = loadFeeInputs();

  const areaColumns = new Set(["site_areas", "gross_floor_areas"]);
  const integerNumberColumns = new Set([
    "list_no",
    "benchmark_aum_total",
    "invested_aum_total",
    "scrs",
    "fars",
    ...feeColumns
  ]);

  const state = {
    statusText: document.getElementById("statusText"),
    rowCount: document.getElementById("rowCount"),
    projectLinkCount: document.getElementById("projectLinkCount"),
    fundLinkCount: document.getElementById("fundLinkCount"),
    assetLinkCount: document.getElementById("assetLinkCount"),
    flagCount: document.getElementById("flagCount"),
    searchInput: document.getElementById("searchInput"),
    statusFilter: document.getElementById("statusFilter"),
    stageFilter: document.getElementById("stageFilter"),
    holdingFilter: document.getElementById("holdingFilter"),
    deptFilter: document.getElementById("deptFilter"),
    exportButton: document.getElementById("exportButton"),
    groupControls: document.getElementById("groupControls"),
    tableHead: document.getElementById("tableHead"),
    tableBody: document.getElementById("tableBody"),
    emptyState: document.getElementById("emptyState")
  };

  function loadFeeInputs() {
    try {
      return JSON.parse(localStorage.getItem(FEE_STORAGE_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function loadCollapsedGroups() {
    try {
      const parsed = JSON.parse(localStorage.getItem(GROUP_VISIBILITY_STORAGE_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      return new Set();
    }
  }

  function saveCollapsedGroups() {
    localStorage.setItem(GROUP_VISIBILITY_STORAGE_KEY, JSON.stringify([...collapsedGroups]));
  }

  function groupById(groupId) {
    return columnGroups.find((group) => group.id === groupId);
  }

  function isGroupCollapsed(groupId) {
    return collapsedGroups.has(groupId);
  }

  function toggleGroup(groupId) {
    const group = groupById(groupId);
    if (!group || group.locked) return;

    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
    } else {
      collapsedGroups.add(groupId);
    }
    saveCollapsedGroups();
    syncVisibleColumns();
    renderHeader();
    render();
  }

  function saveFeeInputs() {
    localStorage.setItem(FEE_STORAGE_KEY, JSON.stringify(feeInputs));
  }

  function rowKey(row) {
    return row.dev_project_id || row.list_no || row.project_name;
  }

  function feeMetasForRow(row) {
    return pfFeeByListNo.get(Number(row.list_no)) || [];
  }

  function notionFeeForRow(row) {
    return feeMetasForRow(row)[0] || null;
  }

  function feeMetaFor(row, column) {
    return feeMetasForRow(row).find((meta) => meta.feeColumn === column) || null;
  }

  function sourceFeeValue(row, column) {
    const meta = feeMetaFor(row, column);
    if (!meta || meta.noFee) return "";
    if (meta.displayValue) return meta.displayValue;
    if (!meta.amountWon) return "";
    return String(meta.amountWon);
  }

  function feeValue(row, column) {
    return feeInputs[rowKey(row)]?.[column] || sourceFeeValue(row, column);
  }

  function setFeeValue(rowId, column, value) {
    const cleanValue = normalizeNumberInput(value);
    if (!feeInputs[rowId]) feeInputs[rowId] = {};
    if (cleanValue) {
      feeInputs[rowId][column] = cleanValue;
    } else {
      delete feeInputs[rowId][column];
    }
    if (Object.keys(feeInputs[rowId]).length === 0) {
      delete feeInputs[rowId];
    }
    saveFeeInputs();
  }

  function normalizeNumberInput(value) {
    const text = String(value || "").replace(/,/g, "").trim();
    if (!text) return "";
    const monthlyMatch = text.match(/^(-?\d+(?:\.\d+)?)(?:원)?\/월$/);
    if (monthlyMatch) {
      const number = Number(monthlyMatch[1]);
      return Number.isFinite(number) ? `${Math.round(number)}원/월` : text;
    }
    const number = Number(text);
    if (!Number.isFinite(number)) return text;
    return String(Math.round(number));
  }

  function getCellValue(row, column) {
    if (feeColumnSet.has(column)) return feeValue(row, column);
    return row[column];
  }

  function asArray(value) {
    const values = Array.isArray(value) ? value : [value];
    const seen = new Set();
    return values
      .filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
      .filter((item) => {
        const key = String(item).normalize("NFKC").replace(/\s+/g, "").trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function textValue(value) {
    if (Array.isArray(value)) return asArray(value).join(" | ");
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function normalizedText(value) {
    return textValue(value).normalize("NFKC").trim().toLowerCase();
  }

  function rowMatchesFilter(row, column, selectedValue) {
    if (!selectedValue) return true;
    return asArray(getCellValue(row, column)).some((item) => normalizedText(item) === selectedValue);
  }

  function hasFeeContent(row) {
    return feeColumns.some((column) => {
      const value = feeValue(row, column);
      if (String(value || "").trim() !== "") return true;

      const meta = feeMetaFor(row, column);
      if (!meta) return false;

      return [
        meta.amountWon,
        meta.displayValue,
        meta.placeholder,
        meta.timing,
        meta.basis,
        meta.structure,
        meta.note
      ].some((item) => String(item || "").trim() !== "");
    });
  }

  function displayRows() {
    return allRows.filter(hasFeeContent);
  }

  function uniqueColumnValues(column) {
    const values = new Map();
    displayRows().forEach((row) => {
      asArray(getCellValue(row, column)).forEach((item) => {
        const label = textValue(item).trim();
        if (!label) return;
        values.set(normalizedText(label), label);
      });
    });
    return [...values.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "ko-KR", { numeric: true }))
      .map(([value, label]) => ({ value, label }));
  }

  function populateSelect(select, placeholder, column) {
    const current = select.value;
    const options = uniqueColumnValues(column);
    select.innerHTML = [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      ...options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    ].join("");
    select.value = options.some((option) => option.value === current) ? current : "";
  }

  function populateFilters() {
    populateSelect(state.statusFilter, "상태 전체", "project_statuses");
    populateSelect(state.stageFilter, "사업단계 전체", "notion_business_stage_classes");
    populateSelect(state.holdingFilter, "보유형태 전체", "notion_holding_type_classes");
    populateSelect(state.deptFilter, "담당부서 전체", "fund_depts");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isNumericLike(value) {
    return /^-?\d+(?:\.\d+)?$/.test(String(value).trim());
  }

  function formatGroupedNumber(value, keepDecimals) {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value).trim();
    if (!isNumericLike(text)) return text;

    const [whole, fraction] = text.split(".");
    const sign = whole.startsWith("-") ? "-" : "";
    const intPart = sign ? whole.slice(1) : whole;
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (keepDecimals && fraction !== undefined && fraction !== "") {
      return `${sign}${grouped}.${fraction}`;
    }
    return `${sign}${grouped}`;
  }

  function formatMonthlyWon(value) {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value).trim();
    const normalized = text.replace(/,/g, "");
    const match = normalized.match(/^(-?\d+(?:\.\d+)?)(?:원)?\/월$/);
    if (!match) return "";
    return `${formatGroupedNumber(match[1], false)}원/월`;
  }

  function numericSortValue(value) {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value).replace(/,/g, "").trim();
    const monthlyMatch = text.match(/^(-?\d+(?:\.\d+)?)(?:원)?\/월$/);
    const number = Number(monthlyMatch ? monthlyMatch[1] : text);
    return Number.isFinite(number) ? number : "";
  }

  function formatDisplayItem(column, value) {
    const monthlyValue = formatMonthlyWon(value);
    if (monthlyValue) return monthlyValue;
    if (areaColumns.has(column)) {
      return formatGroupedNumber(value, true);
    }
    if (integerNumberColumns.has(column)) {
      return formatGroupedNumber(value, false);
    }
    return String(value);
  }

  function formattedItems(column, value) {
    return asArray(value).map((item) => formatDisplayItem(column, item));
  }

  function renderFeeCell(row, column) {
    const value = feeValue(row, column);
    const meta = feeMetaFor(row, column);

    if (!meta) {
      return `<input class="fee-input" type="text" inputmode="numeric" data-row-id="${escapeHtml(rowKey(row))}" data-column="${escapeHtml(column)}" value="${escapeHtml(formatDisplayItem(column, value))}">`;
    }

    const placeholder = meta.placeholder || (meta.noFee ? "보수 없음" : "");
    const amountControl = `<input class="fee-input fee-input-prefilled" type="text" inputmode="numeric" data-row-id="${escapeHtml(rowKey(row))}" data-column="${escapeHtml(column)}" value="${escapeHtml(formatDisplayItem(column, value))}" placeholder="${escapeHtml(placeholder)}">`;
    const summary = [meta.timing, meta.basis].filter(Boolean).join(" · ");
    const details = [meta.structure, meta.note].filter(Boolean);

    return `
      <div class="fee-cell fee-cell-sourced">
        ${amountControl}
        ${summary ? `<span class="fee-source-line">${escapeHtml(summary)}</span>` : ""}
        ${details.map((item) => `<span class="fee-detail-line">${escapeHtml(item)}</span>`).join("")}
      </div>
    `;
  }

  function renderCell(row, column) {
    if (feeColumnSet.has(column)) {
      return renderFeeCell(row, column);
    }

    const value = row[column];
    if (column === "review_flags") {
      const items = asArray(value);
      if (!items.length) return "";
      return items.map((item) => `<span class="chip flag">${escapeHtml(item)}</span>`).join("");
    }

    const items = formattedItems(column, value);
    if (items.length > 1) {
      return `<span class="cell-stack">${items.map((item) => `<span class="cell-item">${escapeHtml(item)}</span>`).join("")}</span>`;
    }

    return escapeHtml(items[0] || "");
  }

  function rowSearchText(row) {
    const feeText = feeMetasForRow(row)
      .map((meta) => [pfFeeSource.title, meta.timing, meta.basis, meta.structure, meta.note].join(" "))
      .join(" ");
    return `${columns.map((column) => textValue(getCellValue(row, column))).join(" ")} ${feeText}`.toLowerCase();
  }

  function filteredRows() {
    const query = state.searchInput.value.trim().toLowerCase();
    return displayRows().filter((row) => {
      const categoryMatch = activeCategory === "all" || row.source_category === activeCategory;
      const searchMatch = !query || rowSearchText(row).includes(query);
      const statusMatch = rowMatchesFilter(row, "project_statuses", activeFilters.status);
      const stageMatch = rowMatchesFilter(row, "notion_business_stage_classes", activeFilters.stage);
      const holdingMatch = rowMatchesFilter(row, "notion_holding_type_classes", activeFilters.holding);
      const deptMatch = rowMatchesFilter(row, "fund_depts", activeFilters.dept);
      return categoryMatch && searchMatch && statusMatch && stageMatch && holdingMatch && deptMatch;
    });
  }

  function headerTitle(column) {
    const definition = feeDefinitions[column];
    if (!definition) return labels[column] || column;
    return `${definition.number} ${definition.title}\n기준: ${definition.trigger}\n담당: ${definition.owner}`;
  }

  function columnClass(column) {
    const stickyClasses = {
      project_name: "sticky-col sticky-col-1",
      source_category: "sticky-col sticky-col-2",
      vehicle_text: "sticky-col sticky-col-3"
    };
    const group = columnGroupByColumn.get(column) || "misc";
    return `${stickyClasses[column] || ""} group-${group}`.trim();
  }

  function sortIndicator(column) {
    if (sortState.column !== column) return "";
    return sortState.direction === "asc" ? " ▲" : " ▼";
  }

  function renderHeaderCell(column) {
    const definition = feeDefinitions[column];
    const classes = ["column-heading", columnClass(column), definition ? "fee-column-heading" : ""]
      .filter(Boolean)
      .join(" ");
    const sortLabel = `${labels[column] || column}${sortIndicator(column)}`;

    if (!definition) {
      return `
        <th scope="col" class="${escapeHtml(classes)}" aria-sort="${sortState.column === column ? sortState.direction : "none"}">
          <button class="sort-button" type="button" data-sort-column="${escapeHtml(column)}">${escapeHtml(sortLabel)}</button>
        </th>
      `;
    }

    return `
      <th scope="col" class="${escapeHtml(classes)}" title="${escapeHtml(headerTitle(column))}" aria-sort="${sortState.column === column ? sortState.direction : "none"}">
        <button class="sort-button fee-sort-button" type="button" data-sort-column="${escapeHtml(column)}">
          <span class="fee-heading-number">${escapeHtml(definition.number)}${escapeHtml(sortIndicator(column))}</span>
          <span class="fee-heading-title">${escapeHtml(definition.title)}</span>
        </button>
      </th>
    `;
  }

  function groupAvailableColumns(group) {
    return group.columns.filter((column) => {
      if (alwaysVisibleColumns.has(column)) return true;
      return allRows.some((row) => asArray(row[column]).length > 0);
    });
  }

  function renderGroupControls() {
    const chips = columnGroups.map((group) => {
      const collapsed = isGroupCollapsed(group.id);
      const availableCount = groupAvailableColumns(group).length;
      const statusText = group.locked ? "고정" : (collapsed ? "접힘" : `${availableCount}개`);
      const classes = [
        "group-chip",
        `group-${group.id}`,
        collapsed ? "collapsed" : "",
        group.locked ? "locked" : ""
      ].filter(Boolean).join(" ");
      const disabled = group.locked ? " disabled" : "";
      return `
        <button class="${escapeHtml(classes)}" type="button" data-toggle-group="${escapeHtml(group.id)}"${disabled} aria-pressed="${collapsed}">
          <span>${escapeHtml(group.label)}</span>
          <small>${escapeHtml(statusText)}</small>
        </button>
      `;
    }).join("");

    state.groupControls.innerHTML = `
      <span class="group-controls-label">컬럼 그룹</span>
      ${chips}
    `;
  }

  function renderGroupHeaderCell(group) {
    const groupColumns = group.columns.filter((column) => visibleColumns.includes(column));
    if (!groupColumns.length) return "";
    if (group.locked) {
      return `<th scope="colgroup" class="column-group group-${escapeHtml(group.id)}" colspan="${groupColumns.length}">${escapeHtml(group.label)}</th>`;
    }

    return `
      <th scope="colgroup" class="column-group group-${escapeHtml(group.id)}" colspan="${groupColumns.length}">
        <button class="group-toggle" type="button" data-toggle-group="${escapeHtml(group.id)}" aria-expanded="${!isGroupCollapsed(group.id)}">
          <span>${escapeHtml(group.label)}</span>
          <span class="group-toggle-mark" aria-hidden="true">−</span>
        </button>
      </th>
    `;
  }

  function renderHeader() {
    const groupCells = columnGroups
      .map(renderGroupHeaderCell)
      .join("");
    state.tableHead.innerHTML = `
      <tr class="group-header-row">${groupCells}</tr>
      <tr class="column-header-row">${visibleColumns.map(renderHeaderCell).join("")}</tr>
    `;
    renderGroupControls();
  }

  function renderRows(rows) {
    state.tableBody.innerHTML = rows.map((row) => {
      const classes = rowClass(row);
      return `<tr${classes ? ` class="${escapeHtml(classes)}"` : ""}>${visibleColumns.map((column) => `<td class="${escapeHtml(columnClass(column))}">${renderCell(row, column)}</td>`).join("")}</tr>`;
    }).join("");
    state.emptyState.hidden = rows.length > 0;
  }

  function updateMetrics(rows) {
    const pfvRows = rows.filter((row) => row.source_category === "PFV").length;
    const fundRows = rows.filter((row) => row.source_category === "Fund").length;
    const fundLinks = rows.reduce((sum, row) => sum + asArray(row.fund_names).length, 0);
    const assetLinks = rows.reduce((sum, row) => sum + asArray(row.asset_names).length, 0);
    state.rowCount.textContent = rows.length.toLocaleString("ko-KR");
    state.projectLinkCount.textContent = pfvRows.toLocaleString("ko-KR");
    state.fundLinkCount.textContent = fundRows.toLocaleString("ko-KR");
    state.assetLinkCount.textContent = assetLinks.toLocaleString("ko-KR");
    state.flagCount.textContent = fundLinks.toLocaleString("ko-KR");
  }

  function render() {
    const rows = sortRows(filteredRows());
    updateMetrics(rows);
    renderRows(rows);
    state.statusText.textContent = `${TABLE_NAME} · ${rows.length.toLocaleString("ko-KR")} shown / ${allRows.length.toLocaleString("ko-KR")} rows loaded`;
  }

  function toCsvValue(column, value) {
    const text = formattedItems(column, value).join(" | ").replace(/\r?\n/g, " ");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const rows = filteredRows();
    const csv = [
      visibleColumns.map((column) => toCsvValue(column, labels[column] || column)).join(","),
      ...rows.map((row) => visibleColumns.map((column) => toCsvValue(column, getCellValue(row, column))).join(","))
    ].join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dev_project_34_dashboard_info.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setupDateSortValue(row) {
    const value = row.sort_setup_date || asArray(row.setup_dates)[0] || "";
    const time = Date.parse(`${value}T00:00:00`);
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  }

  function firstSortText(row, column) {
    return formattedItems(column, getCellValue(row, column))[0] || "";
  }

  function sortValue(row, column) {
    if (column === "setup_dates") return setupDateSortValue(row);

    const rawValue = asArray(getCellValue(row, column))[0];
    if (rawValue === null || rawValue === undefined || rawValue === "") return "";

    if (areaColumns.has(column) || integerNumberColumns.has(column)) {
      return numericSortValue(rawValue);
    }

    if (column === "completion_dates" || column === "maturity_dates") {
      const time = Date.parse(`${rawValue}T00:00:00`);
      return Number.isFinite(time) ? time : "";
    }

    return firstSortText(row, column).normalize("NFKC");
  }

  function compareSortValues(leftValue, rightValue) {
    const leftBlank = leftValue === "" || leftValue === Number.POSITIVE_INFINITY;
    const rightBlank = rightValue === "" || rightValue === Number.POSITIVE_INFINITY;
    if (leftBlank && rightBlank) return 0;
    if (leftBlank) return 1;
    if (rightBlank) return -1;

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return leftValue - rightValue;
    }

    return String(leftValue).localeCompare(String(rightValue), "ko-KR", { numeric: true });
  }

  function pfFeeSortValue(row) {
    const priorities = feeMetasForRow(row)
      .map((meta) => meta.priority)
      .filter((priority) => Number.isFinite(priority));
    return priorities.length ? Math.min(...priorities) : 999;
  }

  function rowClass(row) {
    const metas = feeMetasForRow(row);
    if (!metas.length) return "";
    return metas.every((meta) => meta.noFee) ? "pf-fee-row pf-fee-none-row" : "pf-fee-row";
  }

  function sortRows(rows) {
    return rows.slice().sort((a, b) => {
      const direction = sortState.direction === "asc" ? 1 : -1;
      if (sortState.column === "setup_dates") {
        const pfFeeDiff = pfFeeSortValue(a) - pfFeeSortValue(b);
        if (pfFeeDiff !== 0) return pfFeeDiff;
      }
      const valueDiff = compareSortValues(sortValue(a, sortState.column), sortValue(b, sortState.column));
      if (valueDiff !== 0) return valueDiff * direction;
      return (Number(a.list_no) || 0) - (Number(b.list_no) || 0);
    });
  }

  function applyRows(data) {
    allRows = [
      ...(data || []).filter((row) => !hiddenProjectListNos.has(Number(row.list_no))),
      ...manualProjectRows
    ];
    syncVisibleColumns();
    populateFilters();
    renderHeader();
    render();
  }

  function syncVisibleColumns() {
    const rows = displayRows();
    visibleColumns = columns.filter((column) => {
      const groupId = columnGroupByColumn.get(column);
      const group = groupId ? groupById(groupId) : null;
      if (group && !group.locked && isGroupCollapsed(groupId)) return false;
      if (alwaysVisibleColumns.has(column)) return true;
      return rows.some((row) => asArray(row[column]).length > 0);
    });
  }

  async function queryRowsWithSupabaseClient() {
    const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
    const { data, error } = await client
      .from(TABLE_NAME)
      .select("*")
      .order("list_no", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function queryRowsWithRest() {
    if (!window.SUPABASE_URL || !window.SUPABASE_KEY) {
      throw new Error("Supabase 설정이 없습니다.");
    }

    const endpoint = new URL(`/rest/v1/${TABLE_NAME}`, window.SUPABASE_URL);
    endpoint.searchParams.set("select", "*");
    endpoint.searchParams.set("order", "list_no.asc");

    const response = await fetch(endpoint.toString(), {
      headers: {
        apikey: window.SUPABASE_KEY,
        Authorization: `Bearer ${window.SUPABASE_KEY}`
      }
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async function loadRows() {
    renderHeader();

    if (Array.isArray(window.SNAPSHOT_ROWS)) {
      applyRows(window.SNAPSHOT_ROWS);
      state.statusText.textContent = `${TABLE_NAME} · ${allRows.length.toLocaleString("ko-KR")} rows loaded · snapshot`;
      return;
    }

    state.statusText.textContent = "Supabase 조회 중";

    try {
      const data = window.supabase && typeof window.supabase.createClient === "function"
        ? await queryRowsWithSupabaseClient()
        : await queryRowsWithRest();
      applyRows(data);
    } catch (error) {
      state.statusText.textContent = `조회 실패: ${error.message}`;
      state.tableBody.innerHTML = "";
      state.emptyState.hidden = false;
    }
  }

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      activeCategory = button.dataset.category;
      render();
    });
  });

  state.tableHead.addEventListener("click", (event) => {
    const groupButton = event.target.closest("[data-toggle-group]");
    if (groupButton) {
      toggleGroup(groupButton.dataset.toggleGroup);
      return;
    }

    const button = event.target.closest("[data-sort-column]");
    if (!button) return;
    const column = button.dataset.sortColumn;
    if (!column) return;

    if (sortState.column === column) {
      sortState = {
        column,
        direction: sortState.direction === "asc" ? "desc" : "asc"
      };
    } else {
      sortState = { column, direction: "asc" };
    }

    renderHeader();
    render();
  });

  state.groupControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-toggle-group]");
    if (!button) return;
    toggleGroup(button.dataset.toggleGroup);
  });

  state.statusFilter.addEventListener("change", () => {
    activeFilters.status = state.statusFilter.value;
    render();
  });

  state.stageFilter.addEventListener("change", () => {
    activeFilters.stage = state.stageFilter.value;
    render();
  });

  state.holdingFilter.addEventListener("change", () => {
    activeFilters.holding = state.holdingFilter.value;
    render();
  });

  state.deptFilter.addEventListener("change", () => {
    activeFilters.dept = state.deptFilter.value;
    render();
  });

  state.tableBody.addEventListener("focusin", (event) => {
    if (!event.target.classList.contains("fee-input")) return;
    event.target.value = normalizeNumberInput(event.target.value);
  });

  state.tableBody.addEventListener("focusout", (event) => {
    if (!event.target.classList.contains("fee-input")) return;
    setFeeValue(event.target.dataset.rowId, event.target.dataset.column, event.target.value);
    event.target.value = formatDisplayItem(event.target.dataset.column, event.target.value);
  });

  state.tableBody.addEventListener("input", (event) => {
    if (!event.target.classList.contains("fee-input")) return;
    setFeeValue(event.target.dataset.rowId, event.target.dataset.column, event.target.value);
  });

  state.tableBody.addEventListener("keydown", (event) => {
    if (!event.target.classList.contains("fee-input")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    }
  });

  state.searchInput.addEventListener("input", render);
  state.exportButton.addEventListener("click", exportCsv);

  loadRows();
})();
