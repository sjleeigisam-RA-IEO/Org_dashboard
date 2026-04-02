const SHEET_NAMES = {
  ASSIGNMENTS: "assignments",
  ORGANIZATIONS: "organizations",
  PEOPLE: "people",
  SECTIONS: "sections",
  ROLE_RULES: "role_rules",
};

const ASSIGNMENTS_MINIMAL_HEADERS = [
  "person_name",
  "section_name",
  "group_name",
  "part_name",
  "team_name",
  "role_raw",
  "role_display",
  "is_counted_in_dashboard",
  "is_shared_role",
  "is_acting_role",
  "is_external_hire",
  "raw_name",
  "tags",
];

const SECTION_DEFAULTS = {
  "투자+펀딩": { section_lead_name: "윤관식", section_lead_title: "부대표" },
  "사업+개발": { section_lead_name: "이철승", section_lead_title: "부문대표" },
  "관리+운영": { section_lead_name: "정조민", section_lead_title: "부대표" },
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("조직DB")
    .addItem("assignments 헤더 점검", "ensureAssignmentsHeaders")
    .addItem("파생 시트 동기화", "syncDerivedSheets")
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) {
    return;
  }
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.ASSIGNMENTS) {
    return;
  }
  syncDerivedSheets();
}

function syncDerivedSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const assignmentsSheet = getRequiredSheet_(ss, SHEET_NAMES.ASSIGNMENTS);
  ensureAssignmentsHeaders();
  const assignmentRows = normalizeAssignmentRows_(readSheetObjects_(assignmentsSheet)).filter(
    (row) => row.person_name
  );

  const existingSections = readSheetObjectsSafe_(ss, SHEET_NAMES.SECTIONS);
  const existingOrganizations = readSheetObjectsSafe_(ss, SHEET_NAMES.ORGANIZATIONS);
  const existingPeople = readSheetObjectsSafe_(ss, SHEET_NAMES.PEOPLE);

  const sectionsRows = buildSectionsRows_(assignmentRows, existingSections);
  const organizationsRows = buildOrganizationsRows_(assignmentRows, sectionsRows, existingOrganizations);
  const peopleRows = buildPeopleRows_(assignmentRows, existingPeople);

  writeSheetObjects_(getOrCreateSheet_(ss, SHEET_NAMES.SECTIONS), sectionsRows);
  writeSheetObjects_(getOrCreateSheet_(ss, SHEET_NAMES.ORGANIZATIONS), organizationsRows);
  writeSheetObjects_(getOrCreateSheet_(ss, SHEET_NAMES.PEOPLE), peopleRows);
}

function ensureAssignmentsHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEET_NAMES.ASSIGNMENTS);
  const currentHeaders = readHeaders_(sheet);

  if (!currentHeaders.length) {
    sheet.getRange(1, 1, 1, ASSIGNMENTS_MINIMAL_HEADERS.length).setValues([ASSIGNMENTS_MINIMAL_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  const missingHeaders = ASSIGNMENTS_MINIMAL_HEADERS.filter((header) => !currentHeaders.includes(header));
  if (!missingHeaders.length) {
    return;
  }

  const nextColumn = currentHeaders.length + 1;
  sheet.getRange(1, nextColumn, 1, missingHeaders.length).setValues([missingHeaders]);
  sheet.setFrozenRows(1);
}

function buildSectionsRows_(assignmentRows, existingSections) {
  const existingMap = indexBy_(existingSections, (row) => row.section_name);
  const orderedNames = uniqueOrdered_(assignmentRows.map((row) => row.section_name).filter(Boolean));

  return orderedNames.map((sectionName, index) => {
    const existing = existingMap[sectionName] || {};
    const defaults = SECTION_DEFAULTS[sectionName] || {};
    return {
      section_id: existing.section_id || buildId_("section", [sectionName]),
      section_name: sectionName,
      section_lead_name: existing.section_lead_name || defaults.section_lead_name || "",
      section_lead_title: existing.section_lead_title || defaults.section_lead_title || "",
      display_order: String(index + 1),
    };
  });
}

function buildOrganizationsRows_(assignmentRows, sectionsRows, existingOrganizations) {
  const sectionIdMap = indexMap_(sectionsRows, "section_name", "section_id");
  const existingOrgMap = indexBy_(existingOrganizations, (row) =>
    [row.section_name, row.org_level, row.parent_org_id, row.org_name].join("|")
  );
  const rows = [];
  const seen = new Set();

  assignmentRows.forEach((row) => {
    const sectionName = row.section_name || "";
    const groupName = row.group_name || "";
    const partName = row.part_name || "";
    const teamName = row.team_name || partName || groupName;

    if (!sectionName || !groupName) {
      return;
    }

    const sectionId = sectionIdMap[sectionName] || buildId_("section", [sectionName]);

    const groupLevel = inferGroupLevel_(groupName);
    const groupKey = [sectionName, groupLevel, sectionId, groupName].join("|");
    let groupId = existingOrgMap[groupKey]?.org_id || buildId_("org", [sectionName, groupLevel, groupName]);
    if (!seen.has(groupKey)) {
      rows.push({
        org_id: groupId,
        org_name: groupName,
        org_level: groupLevel,
        section_name: sectionName,
        section_id: sectionId,
        parent_org_id: sectionId,
        org_code: inferOrgCode_(groupName),
        display_order: String(findDisplayOrder_(rows, sectionName, groupLevel) + 1),
        notes: groupLevel === "tf" ? "TF" : "",
      });
      seen.add(groupKey);
    }

    if (partName) {
      const partKey = [sectionName, "part", groupId, partName].join("|");
      const partId = existingOrgMap[partKey]?.org_id || buildId_("org", [sectionName, groupName, "part", partName]);
      if (!seen.has(partKey)) {
        rows.push({
          org_id: partId,
          org_name: partName,
          org_level: "part",
          section_name: sectionName,
          section_id: sectionId,
          parent_org_id: groupId,
          org_code: "",
          display_order: String(findDisplayOrder_(rows, groupId, "part", "parent_org_id") + 1),
          notes: "",
        });
        seen.add(partKey);
      }

      const normalizedTeamName = teamName || partName;
      const teamKey = [sectionName, "team", partId, normalizedTeamName].join("|");
      const teamId =
        existingOrgMap[teamKey]?.org_id || buildId_("org", [sectionName, groupName, partName, "team", normalizedTeamName]);
      if (!seen.has(teamKey)) {
        rows.push({
          org_id: teamId,
          org_name: normalizedTeamName,
          org_level: "team",
          section_name: sectionName,
          section_id: sectionId,
          parent_org_id: partId,
          org_code: "",
          display_order: String(findDisplayOrder_(rows, partId, "team", "parent_org_id") + 1),
          notes: [sectionName, groupName, partName, normalizedTeamName].filter(Boolean).join(" > "),
        });
        seen.add(teamKey);
      }
    }
  });

  return rows;
}

function buildPeopleRows_(assignmentRows, existingPeople) {
  const existingMap = indexBy_(existingPeople, (row) => row.person_name);
  const grouped = {};

  assignmentRows.forEach((row) => {
    if (!grouped[row.person_name]) {
      grouped[row.person_name] = [];
    }
    grouped[row.person_name].push(row);
  });

  return Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b, "ko-KR"))
    .map((personName, index) => {
      const sample = grouped[personName][0] || {};
      const existing = existingMap[personName] || {};
      return {
        person_id: existing.person_id || sample.person_id || buildId_("person", [personName]),
        person_name: personName,
        raw_name_example: sample.raw_name || sample.raw_name_example || personName,
        is_external_hire:
          grouped[personName].some((row) => normalizeFlag_(row.is_external_hire) === "Y") ? "Y" : "N",
      };
    });
}

function normalizeAssignmentRows_(rows) {
  return rows
    .map((row, index) => {
      const personName = String(row.person_name || "").trim();
      const sectionName = String(row.section_name || "").trim();
      const groupName = String(row.group_name || "").trim();
      const partName = String(row.part_name || "").trim();
      const teamName = String(row.team_name || "").trim() || partName || groupName;
      const roleRaw = String(row.role_raw || "").trim();
      const roleDisplay = String(row.role_display || "").trim() || roleRaw;
      const isCounted = normalizeDashboardCount_(row.is_counted_in_dashboard);
      const isShared = normalizeFlag_(row.is_shared_role);
      const isActing = normalizeFlag_(row.is_acting_role);
      const isExternal = normalizeFlag_(row.is_external_hire);
      const rawName = String(row.raw_name || "").trim() || personName;
      const tags = buildTags_(row.tags, {
        is_shared_role: isShared,
        is_acting_role: isActing,
        is_external_hire: isExternal,
      });

      return {
        assignment_id: String(row.assignment_id || "").trim() || buildId_("assign", [sectionName, groupName, partName, teamName, personName, index + 1]),
        person_id: String(row.person_id || "").trim(),
        person_name: personName,
        section_name: sectionName,
        group_name: groupName,
        part_name: partName,
        team_name: teamName,
        group_org_id: String(row.group_org_id || "").trim(),
        part_org_id: String(row.part_org_id || "").trim(),
        team_org_id: String(row.team_org_id || "").trim(),
        role_raw: roleRaw,
        role_display: roleDisplay,
        is_counted_in_dashboard: isCounted,
        is_shared_role: isShared,
        is_acting_role: isActing,
        is_external_hire: isExternal,
        raw_name: rawName,
        tags: tags,
      };
    })
    .filter((row) => row.person_name && row.section_name && row.group_name && row.role_raw);
}

function inferGroupLevel_(groupName) {
  if (groupName.includes("TF") || groupName.includes("CFT")) {
    return "tf";
  }
  if (groupName.includes("센터")) {
    return "center";
  }
  if (groupName.includes("그룹")) {
    return "group";
  }
  return "org";
}

function inferOrgCode_(name) {
  const matched = String(name).match(/\(([A-Z]+)\)$/);
  return matched ? matched[1] : "";
}

function normalizeFlag_(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "Y" ? "Y" : "N";
}

function normalizeDashboardCount_(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "N" ? "N" : "Y";
}

function buildTags_(rawTags, flags) {
  const tags = new Set(
    String(rawTags || "")
      .split("|")
      .map((value) => String(value).trim())
      .filter(Boolean)
  );

  if (flags.is_shared_role === "Y") {
    tags.add("겸직");
  }
  if (flags.is_acting_role === "Y") {
    tags.add("대행");
  }
  if (flags.is_external_hire === "Y") {
    tags.add("외부영입");
  }

  return [...tags].join("|");
}

function buildId_(prefix, parts) {
  const raw = parts.join("::");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  const encoded = Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "").slice(0, 10);
  return `${prefix}-${encoded}`;
}

function uniqueOrdered_(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function indexBy_(rows, keyFn) {
  return rows.reduce((acc, row) => {
    acc[keyFn(row)] = row;
    return acc;
  }, {});
}

function indexMap_(rows, keyField, valueField) {
  return rows.reduce((acc, row) => {
    acc[row[keyField]] = row[valueField];
    return acc;
  }, {});
}

function findDisplayOrder_(rows, matchValue, level, matchField) {
  const field = matchField || "section_name";
  return rows.filter((row) => row[field] === matchValue && row.org_level === level).length;
}

function getRequiredSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`시트가 없습니다: ${sheetName}`);
  }
  return sheet;
}

function getOrCreateSheet_(ss, sheetName) {
  return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}

function readSheetObjectsSafe_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  return sheet ? readSheetObjects_(sheet) : [];
}

function readHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) {
    return [];
  }
  return sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function readSheetObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length || values[0].every((value) => value === "")) {
    return [];
  }
  const headers = values[0].map((value) => String(value).trim());
  return values
    .slice(1)
    .filter((row) => row.some((value) => value !== ""))
    .map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });
}

function writeSheetObjects_(sheet, rows) {
  sheet.clearContents();
  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const values = [headers].concat(rows.map((row) => headers.map((header) => row[header] ?? "")));
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
}
