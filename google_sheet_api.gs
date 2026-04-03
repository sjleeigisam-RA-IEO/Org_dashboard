const WEBAPP_ACCESS_KEY = "change-this-to-a-random-secret";
const NON_COUNTED_TF_MEMBERS = {
  "SS&C TF": new Set(["신호선", "신동열", "신민재", "윤우섭"]),
};

function doGet(e) {
  const key = (e && e.parameter && e.parameter.key) || "";
  const callback = (e && e.parameter && e.parameter.callback) || "";
  const action = (e && e.parameter && e.parameter.action) || "read";
  if (!WEBAPP_ACCESS_KEY || key !== WEBAPP_ACCESS_KEY) {
    return buildWebOutput_(
      {
        ok: false,
        error: "unauthorized",
      },
      callback
    );
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === "upsertSeatLayout") {
    const result = upsertSeatLayoutRow_(ss, e.parameter || {});
    return buildWebOutput_(result, callback);
  }
  const assignments = normalizeAssignmentRows_(readSheetObjects_(getRequiredSheet_(ss, SHEET_NAMES.ASSIGNMENTS))).filter(
    (row) => row.person_name
  );
  const sectionsSheet = getRequiredSheet_(ss, SHEET_NAMES.SECTIONS);
  const sectionsMeta = readSheetObjects_(sectionsSheet);
  const seatLayoutSheet = getOptionalSheet_(ss, SHEET_NAMES.SEAT_LAYOUT);
  const seatLayoutRows = seatLayoutSheet ? normalizeSeatLayoutRows_(readSheetObjects_(seatLayoutSheet)) : [];

  const payload = buildDashboardPayload_(assignments, sectionsMeta, seatLayoutRows);

  return buildWebOutput_(payload, callback);
}

function buildWebOutput_(payload, callback) {
  if (callback) {
    const body = String(callback) + "(" + JSON.stringify(payload) + ");";
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function buildDashboardPayload_(assignmentRows, sectionRows, seatLayoutRows) {
  const unitMap = new Map();

  assignmentRows.forEach((row, index) => {
    const section = String(row.section_name || "").trim();
    const group = String(row.group_name || "").trim();
    const part = String(row.part_name || "").trim();
    const team = String(row.team_name || "").trim() || part || group;
    const key = [section, group, part, team].join("|");

    if (!section || !group || !row.person_name) {
      return;
    }

    if (!unitMap.has(key)) {
      unitMap.set(key, {
        id: `unit-${index + 1}`,
        section,
        group,
        part,
        team,
        displayName: team,
        path: [section, group, part, team].filter(Boolean).join(" > "),
        members: [],
      });
    }

    unitMap.get(key).members.push({
      role: row.role_raw,
      rawName: row.raw_name || row.person_name,
      name: row.person_name,
      tags: String(row.tags || "")
        .split("|")
        .map((value) => String(value).trim())
        .filter(Boolean),
    });
  });

  const units = [...unitMap.values()].map((unit) => ({
    ...unit,
    assignmentCount: unit.members.filter((member) => shouldCountMember(unit.group, member)).length,
    uniquePeopleCount: new Set(
      unit.members.filter((member) => shouldCountMember(unit.group, member)).map((member) => member.name)
    ).size,
  }));

  const sections = buildSectionsHierarchy_(units, sectionRows);

  return {
    meta: {
      generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      source: "google-sheets",
    },
    sections,
    seatLayout: buildSeatLayoutPayload_(seatLayoutRows),
  };
}

function buildSeatLayoutPayload_(rows) {
  return {
    sheetName: SHEET_NAMES.SEAT_LAYOUT,
    updatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    rows: rows || [],
  };
}

function normalizeSeatLayoutRows_(rows) {
  return rows.map((row) => ({
    seat_code: String(row.seat_code || "").trim(),
    floor_code: String(row.floor_code || "").trim(),
    seat_label: String(row.seat_label || "").trim(),
    person_name: String(row.person_name || "").trim(),
    origin_floor_code: String(row.origin_floor_code || "").trim(),
    origin_seat_code: String(row.origin_seat_code || "").trim(),
    is_moved: normalizeSeatFlag_(row.is_moved),
    is_external_division: normalizeSeatFlag_(row.is_external_division),
    note: String(row.note || "").trim(),
  })).filter((row) => row.seat_code);
}

function normalizeSeatFlag_(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "Y" ? "Y" : "N";
}

function getOptionalSheet_(ss, name) {
  return ss.getSheetByName(name);
}

function upsertSeatLayoutRow_(ss, params) {
  const sheet = getRequiredSheet_(ss, SHEET_NAMES.SEAT_LAYOUT);
  const headers = readHeaders_(sheet);
  const headerIndex = {};
  headers.forEach((header, index) => {
    headerIndex[header] = index + 1;
  });

  const requiredHeaders = [
    "seat_code",
    "floor_code",
    "seat_label",
    "person_name",
    "origin_floor_code",
    "origin_seat_code",
    "is_moved",
    "is_external_division",
    "note",
  ];
  requiredHeaders.forEach((header) => {
    if (!headerIndex[header]) {
      throw new Error("seat_layout_latest 시트 헤더가 올바르지 않습니다: " + header);
    }
  });

  const seatCode = String(params.seat_code || "").trim();
  if (!seatCode) {
    throw new Error("seat_code가 비어 있습니다.");
  }

  const values = sheet.getDataRange().getValues();
  let targetRow = 0;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][headerIndex.seat_code - 1] || "").trim() === seatCode) {
      targetRow = i + 1;
      break;
    }
  }
  if (!targetRow) {
    targetRow = sheet.getLastRow() + 1;
  }

  const rowObject = {
    seat_code: seatCode,
    floor_code: String(params.floor_code || "").trim(),
    seat_label: String(params.seat_label || "").trim(),
    person_name: String(params.person_name || "").trim(),
    origin_floor_code: String(params.origin_floor_code || "").trim(),
    origin_seat_code: String(params.origin_seat_code || "").trim(),
    is_moved: normalizeSeatFlag_(params.is_moved),
    is_external_division: normalizeSeatFlag_(params.is_external_division),
    note: String(params.note || "").trim(),
  };

  requiredHeaders.forEach((header) => {
    sheet.getRange(targetRow, headerIndex[header]).setValue(rowObject[header] || "");
  });

  return {
    ok: true,
    action: "upsertSeatLayout",
    seat_code: seatCode,
    row: targetRow,
  };
}

function shouldCountMember(groupName, member) {
  const tags = Array.isArray(member.tags) ? member.tags : [];
  if (tags.includes("외부영입")) {
    return false;
  }
  return !NON_COUNTED_TF_MEMBERS[groupName]?.has(member.name);
}

function buildSectionsHierarchy_(units, sectionRows) {
  const sectionMetaMap = indexBy_(sectionRows, (row) => row.section_name);
  const sectionMap = new Map();

  units.forEach((unit) => {
    if (!sectionMap.has(unit.section)) {
      sectionMap.set(unit.section, {
        name: unit.section,
        display_order: Number(sectionMetaMap[unit.section]?.display_order || 999),
        groups: new Map(),
      });
    }

    const section = sectionMap.get(unit.section);
    if (!section.groups.has(unit.group)) {
      section.groups.set(unit.group, {
        name: unit.group,
        parts: new Map(),
      });
    }

    const group = section.groups.get(unit.group);
    const partName = unit.part || "미지정";
    if (!group.parts.has(partName)) {
      group.parts.set(partName, {
        name: partName,
        teams: [],
      });
    }

    group.parts.get(partName).teams.push(unit);
  });

  return [...sectionMap.values()]
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "ko-KR"))
    .map((section) => {
      const groups = [...section.groups.values()].map((group) => {
        const parts = [...group.parts.values()].map((part) => {
          const countedMembers = part.teams.flatMap((team) =>
            team.members.filter((member) => shouldCountMember(group.name, member))
          );
          return {
            name: part.name,
            assignmentCount: countedMembers.length,
            uniquePeopleCount: new Set(countedMembers.map((member) => member.name)).size,
            teams: part.teams,
          };
        });

        const countedMembers = parts.flatMap((part) =>
          part.teams.flatMap((team) => team.members.filter((member) => shouldCountMember(group.name, member)))
        );
        return {
          name: group.name,
          assignmentCount: countedMembers.length,
          uniquePeopleCount: new Set(countedMembers.map((member) => member.name)).size,
          parts,
        };
      });

      const countedMembers = groups.flatMap((group) =>
        group.parts.flatMap((part) =>
          part.teams.flatMap((team) => team.members.filter((member) => shouldCountMember(group.name, member)))
        )
      );

      return {
        name: section.name,
        assignmentCount: countedMembers.length,
        uniquePeopleCount: new Set(countedMembers.map((member) => member.name)).size,
        groups,
      };
    });
}
