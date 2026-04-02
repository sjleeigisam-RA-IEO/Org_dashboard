const WEBAPP_ACCESS_KEY = "change-this-to-a-random-secret";

function doGet(e) {
  const key = (e && e.parameter && e.parameter.key) || "";
  if (!WEBAPP_ACCESS_KEY || key !== WEBAPP_ACCESS_KEY) {
    return ContentService.createTextOutput(
      JSON.stringify({
        ok: false,
        error: "unauthorized",
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const assignments = normalizeAssignmentRows_(readSheetObjects_(getRequiredSheet_(ss, SHEET_NAMES.ASSIGNMENTS))).filter(
    (row) => row.person_name
  );
  const sectionsSheet = getRequiredSheet_(ss, SHEET_NAMES.SECTIONS);
  const sectionsMeta = readSheetObjects_(sectionsSheet);

  const payload = buildDashboardPayload_(assignments, sectionsMeta);

  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function buildDashboardPayload_(assignmentRows, sectionRows) {
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
  };
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
