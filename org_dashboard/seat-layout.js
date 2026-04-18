(function () {
  const seatData = window.SEAT_LAYOUT_DATA;
  const remoteSeatLayout = normalizeRemoteSeatLayout_(window.ORG_DASHBOARD_SEAT_LAYOUT);
  const orgData = window.ORG_DASHBOARD_DATA || null;
  const overlays = window.SEAT_LAYOUT_OVERLAYS || { zones: [], externalSeatCodes: {} };
  if (!seatData || !Array.isArray(seatData.floors) || !seatData.floors.length) return;
  const ORG_OVERLAY_TEST = !window.SEAT_LAYOUT_ORG_OVERLAY_DISABLED;
  const VIEWPORT_TEST = !!window.SEAT_LAYOUT_VIEWPORT_TEST;

  const orgView = document.getElementById("orgDashboardView");
  const seatView = document.getElementById("seatLayoutView");
  const switchEl = document.getElementById("viewSwitch");
  if (!orgView || !seatView || !switchEl) return;
  const mobileMediaQuery = window.matchMedia("(max-width: 720px)");

  const discoveredFloorOrder = seatData.floors.map((floor) => floor.floorCode);
  const preferredFloorOrder = ["13F", "12F", "2F", "CCMM11F"];
  const FLOOR_ORDER = [
    ...preferredFloorOrder.filter((floorCode) => discoveredFloorOrder.includes(floorCode)),
    ...discoveredFloorOrder.filter((floorCode) => !preferredFloorOrder.includes(floorCode)),
  ];

  /* ?? Constants ???????????????????????????????????? */
  const FLOOR_SIZES = {
    "13F": { cell: 56, shape: 24, gap: 10 },
    "12F": { cell: 56, shape: 24, gap: 10 },
    "2F":  { cell: 56, shape: 24, gap: 10 },
  };
  const DEFAULT_SIZES = { cell: 56, shape: 24, gap: 10 };
  const SEAT_INSET = 1;
  const PAD = 1.5;
  const ADMIN_PASSWORD = "seat2604";
  const HIDDEN_SEAT_CODES = new Set(["2F-A45"]);

  // Other-department seat prefixes / zones per floor (grayed out with hatch overlay)
  const OTHER_DEPT = {
    "2F": {
      seatPrefix: "2F-A",
      area: { x: 13, y: 5, w: 18, h: 15 },
    },
    "12F": {
      seatPrefix: "12F-B",
      areas: [
        { x: 31.4, y: 25.4, w: 5.1, h: 21.8 },
      ],
    },
  };

  const state = {
    activeView: window.SEAT_LAYOUT_FORCE_ACTIVE_VIEW || "org",
    floorCode:
      (window.SEAT_LAYOUT_DEFAULT_FLOOR && discoveredFloorOrder.includes(window.SEAT_LAYOUT_DEFAULT_FLOOR)
        ? window.SEAT_LAYOUT_DEFAULT_FLOOR
        : FLOOR_ORDER[0]) || seatData.floors[0].floorCode,
    scenario: "plan",
    zoom: 1,
    adminMode: false,
    adminSelection: {
      sourceSeatCode: "",
      targetSeatCode: "",
      moveFlag: "Y",
    },
    adminPendingSeatCodes: [],
    adminSaving: false,
    orgOverlayVisible: ORG_OVERLAY_TEST,
    minimapVisible: VIEWPORT_TEST,
    subview: "",
  };

  /* ?? Floor outlines ??????????????????????????????? */
  const FLOOR_OUTLINES = {
    "13F": [[11,2],[36,2],[36,47],[-1,47],[-1,12],[5,12],[5,7],[11,7]],
    "12F": [[12,-1],[39,-1],[39,52],[0,52],[0,16],[5,16],[5,4],[12,4]],
    "2F":  [[12,1],[32,1],[32,50],[2,50],[2,13],[6,13],[6,10],[12,10]],
  };

  const CORE_AREAS = {
    "13F": [{ label: "EV 홀", x: 13, y: 20, w: 10, h: 4 }, { label: "계단실", x: 13, y: 25, w: 10, h: 3 }],
    "12F": [{ label: "EV 홀", x: 13, y: 22, w: 12, h: 4 }, { label: "계단실", x: 13, y: 27, w: 12, h: 4 }],
    "2F":  [{ label: "EV 홀", x: 9, y: 22, w: 12, h: 4 }, { label: "계단실", x: 9, y: 27, w: 12, h: 4 }],
  };

  const EQUAL_WIDTH_LABELS = {
    "13F": ["파트장실-2", "파트장실-3", "파트장실-4"],
    "12F": ["파트장실-1", "파트장실-2", "파트장실-3"],
  };
  const MOVE_OVERRIDES = {
    "2F-B19": { ignore: true },
    "2F-B65": { forceOriginFloor: "12F", forceOriginSeat: "" },
  };
  const SEAT_DISPLAY_OVERRIDES = {
    "CCMM11F-C12": { personName: "최우석", deptName: "인턴사원" },
    "CCMM11F-C23": { personName: "정서윤", deptName: "인턴사원" },
    "CCMM11F-C36": { personName: "", emptyLabel: "모션데스크" },
  };
  const SEAT_SHEET_BY_FLOOR = window.SEAT_LAYOUT_SHEET_BY_FLOOR || {};

  /* ?? Utilities ???????????????????????????????????? */
  function esc(s) { return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function fmt(v) { return new Intl.NumberFormat("ko-KR").format(v); }
  function floorLabel(fc) {
    return `${String(fc || "").replace("F", "")}층`;
  }
  function getFloor(fc) { return seatData.floors.find(f=>f.floorCode===fc)||seatData.floors[0]; }
  function getAssignments(floor,sc) {
    if (remoteSeatLayout) return remoteSeatLayout.assignmentsByFloor[floor.floorCode] || {};
    return floor.scenarios?.[sc]?.assignments||{};
  }

  function getDefaultSubview(floorCode) {
    if (!VIEWPORT_TEST) return "";
    if (floorCode === "12F") return "north";
    return "focus";
  }
  state.subview = getDefaultSubview(state.floorCode);

  function getRenderableSeats(floor) {
    return (floor.seatDefs || []).filter((seat) => !HIDDEN_SEAT_CODES.has(seat.seatCode));
  }

  function getSeatRectPx_(seat, cm) {
    return {
      x: cm.toX(seat.x) + SEAT_INSET,
      y: cm.toY(seat.y) + SEAT_INSET,
      w: cm.spanW(seat.x, seat.w) - SEAT_INSET * 2,
      h: cm.spanH(seat.y, seat.h) - SEAT_INSET * 2,
    };
  }

  function getViewportOptionsForFloor(floorCode) {
    if (!VIEWPORT_TEST) return [];
    if (floorCode === "12F") {
      return [
        { key: "north", label: "북측" },
        { key: "south", label: "남측" },
        { key: "all", label: "전체" },
      ];
    }
    return [
      { key: "focus", label: "확대" },
      { key: "all", label: "전체" },
    ];
  }

  function normalizeRemoteSeatLayout_(payload) {
    if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) return null;
    const rows = payload.rows
      .map((row) => ({
        seatCode: String(row.seat_code || "").trim(),
        floorCode: String(row.floor_code || "").trim(),
        seatLabel: String(row.seat_label || "").trim(),
        personName: String(row.person_name || "").trim(),
        teamOrgIdSeat: String(row.team_org_id_seat || "").trim(),
        originFloorCode: String(row.origin_floor_code || "").trim(),
        originSeatCode: String(row.origin_seat_code || "").trim(),
        isMoved: String(row.is_moved || "").trim().toUpperCase() === "Y",
        isExternalDivision: String(row.is_external_division || "").trim().toUpperCase() === "Y",
        note: String(row.note || "").trim(),
      }))
      .filter((row) => row.seatCode);
    const assignmentsByFloor = {};
    const rowsByFloor = {};
    const bySeat = new Map();
    rows.forEach((row) => {
      if (!assignmentsByFloor[row.floorCode]) assignmentsByFloor[row.floorCode] = {};
      if (!rowsByFloor[row.floorCode]) rowsByFloor[row.floorCode] = [];
      assignmentsByFloor[row.floorCode][row.seatCode] = {
        personName: row.personName,
        sheetName: payload.sheetName || "seat_layout_latest",
        deptName: "",
      };
      rowsByFloor[row.floorCode].push(row);
      bySeat.set(row.seatCode, row);
    });
    return {
      rows,
      bySeat,
      rowsByFloor,
      assignmentsByFloor,
      updatedAt: payload.updatedAt || "",
    };
  }

  function buildAssignmentMap(scenario) {
    if (remoteSeatLayout) {
      const byName = new Map();
      remoteSeatLayout.rows.forEach((row) => {
        if (row.personName) byName.set(row.personName, row.seatCode);
      });
      return byName;
    }
    const byName = new Map();
    seatData.floors.forEach((floor) => {
      const assignments = getAssignments(floor, scenario);
      Object.entries(assignments).forEach(([seatCode, info]) => {
        if (info.personName) byName.set(info.personName, seatCode);
      });
    });
    return byName;
  }

  function buildSeatMoveMapForFloor(floor) {
    if (remoteSeatLayout) {
      const byToSeat = new Map();
      const byName = new Map();
      const rows = remoteSeatLayout.rowsByFloor[floor.floorCode] || [];
      rows.forEach((row) => {
        if (!row.personName || !row.isMoved) return;
        const item = {
          name: row.personName,
          fromSeat: row.originSeatCode || "",
          fromFloor: row.originFloorCode || (row.originSeatCode ? row.originSeatCode.split("-")[0] : ""),
          toSeat: row.seatCode,
        };
        byToSeat.set(row.seatCode, item);
        byName.set(row.personName, item);
      });
      return { byToSeat, byName };
    }
    const currentByName = buildAssignmentMap("current");
    const assignments = getAssignments(floor, "plan");
    const byToSeat = new Map();
    const byName = new Map();

    Object.entries(assignments).forEach(([seatCode, info]) => {
      const name = info.personName;
      if (!name) return;
      const override = MOVE_OVERRIDES[seatCode];
      if (override?.ignore) return;
      const fromSeat = currentByName.get(name);
      const finalFromSeat = override?.forceOriginSeat !== undefined ? override.forceOriginSeat : fromSeat;
      const finalFromFloor = override?.forceOriginFloor || (finalFromSeat ? finalFromSeat.split("-")[0] : "");
      if ((!finalFromSeat && !finalFromFloor) || finalFromSeat === seatCode) return;
      const item = { name, fromSeat: finalFromSeat, fromFloor: finalFromFloor, toSeat: seatCode };
      byToSeat.set(seatCode, item);
      byName.set(name, item);
    });

    return { byToSeat, byName };
  }

  function getMovedPeople() {
    if (remoteSeatLayout) {
      return remoteSeatLayout.rows
        .filter((row) => row.personName && row.isMoved)
        .map((row) => ({
          name: row.personName,
          fromSeat: row.originSeatCode || "",
          fromFloor: row.originFloorCode || "",
          toSeat: row.seatCode,
        }));
    }
    const currentByName = buildAssignmentMap("current");
    const planByName = buildAssignmentMap("plan");
    const moved = [];
    currentByName.forEach((fromSeat, name) => {
      const toSeat = planByName.get(name);
      if (toSeat && toSeat !== fromSeat) {
        moved.push({ name, fromSeat, toSeat });
      }
    });
    return moved;
  }

  function getMovedPeopleForFloor(floorCode) {
    return getMovedPeople().filter((item) => item.fromSeat.startsWith(`${floorCode}-`) || item.toSeat.startsWith(`${floorCode}-`));
  }

  function getSeatDisplayOverride(seatCode) {
    return SEAT_DISPLAY_OVERRIDES[seatCode] || null;
  }

  function getSeatAssignmentInfo(floor, seatCode) {
    const assignments = getAssignments(floor, state.scenario);
    return assignments[seatCode] || null;
  }

  function buildOrgUnitLookup_() {
    const map = new Map();
    const sections = Array.isArray(orgData?.sections) ? orgData.sections : [];
    sections.forEach((section, sectionIndex) => {
      const sectionKey = `section-${String(sectionIndex + 1).padStart(2, "0")}`;
      (section.groups || []).forEach((group, groupIndex) => {
        const groupKey = `${sectionKey}-group-${String(groupIndex + 1).padStart(2, "0")}`;
        const groupPayload = {
          sectionName: section.name || "",
          groupName: group.name || "",
          partName: "",
          teamName: "",
          overlayName: group.name || "",
        };
        map.set(groupKey, groupPayload);
        (group.parts || []).forEach((part, partIndex) => {
          const partKey = `${groupKey}-part-${String(partIndex + 1).padStart(2, "0")}`;
          const partPayload = {
            sectionName: section.name || "",
            groupName: group.name || "",
            partName: part.name || "",
            teamName: "",
            overlayName: part.name && part.name !== "미지정" ? part.name : (group.name || ""),
          };
          map.set(partKey, partPayload);
          (part.teams || []).forEach((team, teamIndex) => {
            const teamPayload = {
              teamId: team.id,
              sectionName: section.name || "",
              groupName: group.name || "",
              partName: part.name || "",
              teamName: team.displayName || team.team || "",
              overlayName: team.displayName || team.team || partPayload.overlayName,
            };
            if (team?.id) {
              map.set(team.id, teamPayload);
            }
            const seqTeamKey = `${partKey}-team-${String(teamIndex + 1).padStart(2, "0")}`;
            map.set(seqTeamKey, teamPayload);
          });
        });
      });
    });
    return map;
  }

  const ORG_UNIT_LOOKUP = buildOrgUnitLookup_();
  const ORG_OFFICE_EXCLUDED_ROLES = new Set(["디렉터", "그룹장", "파트장/센터장", "담당디렉터", "부대표", "부문대표"]);

  function resolveOrgUnitFromHierarchicalId_(teamOrgIdSeat) {
    const match = String(teamOrgIdSeat || "").match(/^section-(\d+)-group-(\d+)(?:-part-(\d+))?(?:-team-(\d+))?$/);
    if (!match) return null;
    const [, sectionNo, groupNo, partNo, teamNo] = match;
    const sections = Array.isArray(orgData?.sections) ? orgData.sections : [];
    const section = sections[Number(sectionNo) - 1];
    const group = section?.groups?.[Number(groupNo) - 1];
    const part = partNo ? group?.parts?.[Number(partNo) - 1] : null;
    const team = teamNo ? part?.teams?.[Number(teamNo) - 1] : null;
    if (!section || !group) return null;
    return {
      teamId: teamOrgIdSeat,
      sectionName: section.name || "",
      groupName: group.name || "",
      partName: part?.name || "",
      teamName: team?.displayName || team?.team || "",
      overlayName:
        team?.displayName ||
        team?.team ||
        (part?.name && part.name !== "미지정" ? part.name : "") ||
        group.name ||
        "",
    };
  }

  function resolveOrgUnit_(teamOrgIdSeat) {
    return ORG_UNIT_LOOKUP.get(teamOrgIdSeat) || resolveOrgUnitFromHierarchicalId_(teamOrgIdSeat);
  }

  function getSeatOverlayLabel_(floorCode, teamOrgIdSeat) {
    const overlayInfo = getSeatOverlayGrouping_(floorCode, teamOrgIdSeat);
    return overlayInfo?.label || "";
  }


  function getSeatOverlayGrouping_(floorCode, teamOrgIdSeat) {
    if (!teamOrgIdSeat) return null;
    const unit = resolveOrgUnit_(teamOrgIdSeat);
    if (!unit) return null;
    if (floorCode === "CCMM11F") {
      const groupLabel = unit.groupName || unit.teamName || "";
      const partLabel = unit.partName && unit.partName !== "미지정" ? unit.partName : "";
      if (groupLabel && partLabel) {
        return {
          key: `ccmm-part:${groupLabel}:${partLabel}`,
          label: `${groupLabel} ${partLabel}`,
          level: "part",
        };
      }
      if (groupLabel) {
        return { key: `ccmm-group:${groupLabel}`, label: groupLabel, level: "group" };
      }
    }
    if (floorCode === "12F" && unit.groupName === "사업그룹" && /^([1-4])파트$/.test(unit.partName || "")) {
      const partNo = RegExp.$1;
      const label = `사업그룹 ${partNo}파트`;
      return { key: `part:사업그룹:${partNo}파트`, label, level: "part" };
    }
    if (floorCode === "13F" || floorCode === "2F") {
      const label = unit.groupName || unit.teamName;
      return label ? { key: `group:${label}`, label, level: "group" } : null;
    }
    if (floorCode === "12F" && (teamOrgIdSeat.startsWith("section-01-group-03") || teamOrgIdSeat.startsWith("section-01-group-05"))) {
      const label = unit.groupName || unit.teamName;
      return label ? { key: `group:${label}`, label, level: "group" } : null;
    }
    const partLabel = unit.partName && unit.partName !== "미지정" ? unit.partName : (unit.teamName || unit.groupName);
    return partLabel ? { key: `part:${unit.groupName}:${partLabel}`, label: partLabel, level: "part" } : null;
  }

  function getOfficeExcludedNamesForOverlay_(floorCode, teamOrgIdSeat) {
    const unit = resolveOrgUnit_(teamOrgIdSeat);
    if (!unit) return new Set();
    const names = new Set();
    const sections = Array.isArray(orgData?.sections) ? orgData.sections : [];
    const pushMembers = (members) => {
      (members || []).forEach((member) => {
        const role = String(member?.role || "").trim();
        const name = String(member?.name || "").trim();
        if (name && ORG_OFFICE_EXCLUDED_ROLES.has(role)) names.add(name);
      });
    };

    sections.forEach((section) => {
      (section.groups || []).forEach((group) => {
        if (group.name !== unit.groupName) return;

        if (floorCode === "13F" || floorCode === "2F") {
          (group.parts || []).forEach((part) => {
            (part.teams || []).forEach((team) => pushMembers(team.members));
          });
          return;
        }

        if (floorCode === "12F" && (teamOrgIdSeat.startsWith("section-01-group-03") || teamOrgIdSeat.startsWith("section-01-group-05"))) {
          (group.parts || []).forEach((part) => {
            (part.teams || []).forEach((team) => pushMembers(team.members));
          });
          return;
        }

        (group.parts || []).forEach((part) => {
          if (part.name !== unit.partName) return;
          (part.teams || []).forEach((team) => pushMembers(team.members));
        });
      });
    });

    return names;
  }

  function isSeatWithinPrivateOffice_(floor, seat) {
    if (seat?.seatCode === "2F-B1") return true;
    return (floor.shapes || []).some((shape) => {
      if (shape.shapeType !== "office") return false;
      const extraH = shape.h <= 1 ? 1 : 0;
      return (
        seat.x >= shape.x &&
        seat.x < shape.x + shape.w &&
        seat.y >= shape.y &&
        seat.y < shape.y + shape.h + extraH
      );
    });
  }

  function colorFromKey_(key) {
    const overrides = {
      "group:투자3그룹": { fill: "hsla(254, 58%, 78%, 0.18)", stroke: "hsla(254, 34%, 46%, 0.50)", badge: "hsla(254, 82%, 97%, 0.98)", text: "hsla(254, 28%, 28%, 1)" },
      "group:리빙그룹": { fill: "hsla(18, 72%, 79%, 0.18)", stroke: "hsla(18, 38%, 48%, 0.50)", badge: "hsla(18, 85%, 97%, 0.98)", text: "hsla(18, 32%, 30%, 1)" },
      "part:사업그룹:1파트": { fill: "hsla(210, 60%, 78%, 0.18)", stroke: "hsla(210, 36%, 46%, 0.50)", badge: "hsla(210, 82%, 97%, 0.98)", text: "hsla(210, 30%, 25%, 1)" },
      "part:사업그룹:2파트": { fill: "hsla(158, 48%, 79%, 0.18)", stroke: "hsla(158, 30%, 44%, 0.50)", badge: "hsla(158, 76%, 97%, 0.98)", text: "hsla(158, 26%, 27%, 1)" },
      "part:사업그룹:3파트": { fill: "hsla(22, 70%, 80%, 0.18)", stroke: "hsla(22, 38%, 48%, 0.50)", badge: "hsla(22, 84%, 97%, 0.98)", text: "hsla(22, 32%, 30%, 1)" },
      "part:사업그룹:4파트": { fill: "hsla(46, 74%, 77%, 0.19)", stroke: "hsla(46, 40%, 44%, 0.52)", badge: "hsla(46, 86%, 97%, 0.98)", text: "hsla(46, 34%, 24%, 1)" },
      "part:공간솔루션센터:공간솔루션센터": { fill: "hsla(286, 62%, 79%, 0.18)", stroke: "hsla(286, 34%, 46%, 0.48)", badge: "hsla(286, 80%, 97%, 0.98)", text: "hsla(286, 28%, 28%, 1)" },
      "part:개발솔루션센터:개발솔루션센터": { fill: "hsla(196, 68%, 75%, 0.18)", stroke: "hsla(196, 38%, 42%, 0.50)", badge: "hsla(196, 84%, 97%, 0.98)", text: "hsla(196, 30%, 25%, 1)" },
      "part:기획추진센터:기획추진센터": { fill: "hsla(138, 48%, 77%, 0.18)", stroke: "hsla(138, 30%, 44%, 0.50)", badge: "hsla(138, 76%, 97%, 0.98)", text: "hsla(138, 26%, 27%, 1)" },
    };
    if (overrides[key]) return overrides[key];
    const groupPalette = [
      { hue: 220, fillA: 0.16, strokeA: 0.44 },
      { hue: 262, fillA: 0.16, strokeA: 0.44 },
      { hue: 18, fillA: 0.16, strokeA: 0.42 },
      { hue: 146, fillA: 0.16, strokeA: 0.42 },
      { hue: 334, fillA: 0.15, strokeA: 0.40 },
      { hue: 46, fillA: 0.16, strokeA: 0.42 },
    ];
    const partPalette = [
      { hue: 205, fillA: 0.18, strokeA: 0.48 },
      { hue: 144, fillA: 0.18, strokeA: 0.46 },
      { hue: 260, fillA: 0.18, strokeA: 0.48 },
      { hue: 18, fillA: 0.18, strokeA: 0.44 },
      { hue: 332, fillA: 0.16, strokeA: 0.42 },
      { hue: 48, fillA: 0.18, strokeA: 0.44 },
    ];
    const palette = key.startsWith("group:") || key.startsWith("ccmm-group:")
      ? groupPalette
      : partPalette;
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash) + key.charCodeAt(i);
    const entry = palette[Math.abs(hash) % palette.length];
    const hue = entry.hue;
    return {
      fill: `hsla(${hue}, 54%, 74%, ${entry.fillA})`,
      stroke: `hsla(${hue}, 34%, 44%, ${entry.strokeA})`,
      badge: `hsla(${hue}, 48%, 97%, 0.98)`,
      text: `hsla(${hue}, 28%, 28%, 1)`,
    };
  }

  function buildOrgOverlayGroups_(floor, cm) {
    if (!ORG_OVERLAY_TEST || !state.orgOverlayVisible || !remoteSeatLayout) return [];
    const rows = remoteSeatLayout.rowsByFloor[floor.floorCode] || [];
    const seatDefByCode = new Map(getRenderableSeats(floor).map((seat) => [seat.seatCode, seat]));
    const grouped = new Map();

    rows.forEach((row) => {
      if (!row.teamOrgIdSeat || row.isExternalDivision) return;
      const overlayInfo = getSeatOverlayGrouping_(floor.floorCode, row.teamOrgIdSeat);
      if (!overlayInfo) return;
      const seat = seatDefByCode.get(row.seatCode);
      if (!seat) return;
      const excludedOfficeNames = getOfficeExcludedNamesForOverlay_(floor.floorCode, row.teamOrgIdSeat);
      if (row.personName && excludedOfficeNames.has(row.personName) && isSeatWithinPrivateOffice_(floor, seat)) return;
      const rect = {
        x: cm.toX(seat.x) + SEAT_INSET,
        y: cm.toY(seat.y) + SEAT_INSET,
        w: cm.spanW(seat.x, seat.w) - SEAT_INSET * 2,
        h: cm.spanH(seat.y, seat.h) - SEAT_INSET * 2,
      };
      if (!grouped.has(overlayInfo.key)) {
        grouped.set(overlayInfo.key, {
          ...overlayInfo,
          rects: [],
        });
      }
      grouped.get(overlayInfo.key).rects.push(rect);
    });

    return [...grouped.values()].flatMap((group) => {
      const colors = colorFromKey_(group.key);
      const thresholdX =
        group.label === "투자3그룹" ? cm.CELL * 2.25 :
        group.label === "기획추진센터" ? cm.CELL * 1.95 :
        group.label === "리빙그룹" ? cm.CELL * 1.55 :
        cm.CELL * 1.45;
      const thresholdY =
        group.label === "투자3그룹" ? cm.CELL * 1.55 :
        group.label === "기획추진센터" ? cm.CELL * 1.4 :
        group.label === "리빙그룹" ? cm.CELL * 1.8 :
        cm.CELL * 1.1;
      let clusters = clusterRects_(group.rects, thresholdX, thresholdY);
      if ((group.label === "투자3그룹" || group.label === "기획추진센터" || group.label === "리빙그룹") && clusters.length > 1) {
        const merged = clusters.reduce((acc, item) => ({
          rects: acc.rects.concat(item.rects),
          minX: Math.min(acc.minX, item.minX),
          minY: Math.min(acc.minY, item.minY),
          maxX: Math.max(acc.maxX, item.maxX),
          maxY: Math.max(acc.maxY, item.maxY),
        }), {
          rects: [],
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        });
        clusters = [merged];
      }
      return clusters.map((cluster, index) => {
        const padX = cm.CELL * 0.18;
        const padY = cm.CELL * 0.14;
        const x = cluster.minX - padX;
        const y = cluster.minY - padY;
        const w = (cluster.maxX - cluster.minX) + padX * 2;
        const h = (cluster.maxY - cluster.minY) + padY * 2;
        const badgeWidth = Math.max(76, group.label.length * 11 + 24);
        return {
          key: group.key,
          label: group.label,
          colors,
          index,
          x,
          y,
          w,
          h,
          badgeWidth,
        };
      });
    });
  }

  function clusterRects_(rects, thresholdX, thresholdY) {
    const clusters = [];
    rects.forEach((rect) => {
      let cluster = null;
      for (const item of clusters) {
        const intersects = !(rect.x > item.maxX + thresholdX ||
          rect.x + rect.w < item.minX - thresholdX ||
          rect.y > item.maxY + thresholdY ||
          rect.y + rect.h < item.minY - thresholdY);
        if (intersects) {
          cluster = item;
          break;
        }
      }
      if (!cluster) {
        clusters.push({
          rects: [rect],
          minX: rect.x,
          minY: rect.y,
          maxX: rect.x + rect.w,
          maxY: rect.y + rect.h,
        });
        return;
      }
      cluster.rects.push(rect);
      cluster.minX = Math.min(cluster.minX, rect.x);
      cluster.minY = Math.min(cluster.minY, rect.y);
      cluster.maxX = Math.max(cluster.maxX, rect.x + rect.w);
      cluster.maxY = Math.max(cluster.maxY, rect.y + rect.h);
    });
    return clusters;
  }

  function isOtherDeptSeat(seatCode) {
    if (!seatCode) return false;
    if (remoteSeatLayout) {
      return !!remoteSeatLayout.bySeat?.get(seatCode)?.isExternalDivision;
    }
    const floorCode = seatCode.split("-")[0];
    const config = OTHER_DEPT[floorCode];
    return !!(config?.seatPrefix && seatCode.startsWith(config.seatPrefix));
  }

  function getRemoteSeatRow(seatCode) {
    return remoteSeatLayout?.bySeat?.get(seatCode) || null;
  }

  function rebuildRemoteSeatLayoutIndexes() {
    if (!remoteSeatLayout) return;
    const assignmentsByFloor = {};
    const rowsByFloor = {};
    const bySeat = new Map();
    remoteSeatLayout.rows.forEach((row) => {
      if (!assignmentsByFloor[row.floorCode]) assignmentsByFloor[row.floorCode] = {};
      if (!rowsByFloor[row.floorCode]) rowsByFloor[row.floorCode] = [];
      assignmentsByFloor[row.floorCode][row.seatCode] = {
        personName: row.personName || "",
        sheetName: remoteSeatLayout.sheetName || "seat_layout_latest",
        deptName: "",
      };
      rowsByFloor[row.floorCode].push(row);
      bySeat.set(row.seatCode, row);
    });
    remoteSeatLayout.assignmentsByFloor = assignmentsByFloor;
    remoteSeatLayout.rowsByFloor = rowsByFloor;
    remoteSeatLayout.bySeat = bySeat;
  }

  function markAdminDirty(seatCode) {
    if (!seatCode) return;
    if (!state.adminPendingSeatCodes.includes(seatCode)) {
      state.adminPendingSeatCodes = [...state.adminPendingSeatCodes, seatCode];
    }
  }

  function clearAdminSelection() {
    state.adminSelection = { sourceSeatCode: "", targetSeatCode: "", moveFlag: state.adminSelection.moveFlag || "Y" };
  }

  function applyAdminSeatChange() {
    if (!remoteSeatLayout) {
      window.alert("구글시트 기반 자리배치 데이터가 연결되지 않았습니다.");
      return;
    }
    const sourceSeatCode = state.adminSelection.sourceSeatCode;
    const targetSeatCode = state.adminSelection.targetSeatCode;
    if (!sourceSeatCode || !targetSeatCode) {
      window.alert("선택 좌석과 이동 대상을 모두 지정해 주세요.");
      return;
    }
    if (sourceSeatCode === targetSeatCode) {
      window.alert("같은 좌석을 이동 대상으로 지정할 수 없습니다.");
      return;
    }

    const moveFlag = state.adminSelection.moveFlag === "Y";
    const sourceRow = getRemoteSeatRow(sourceSeatCode);
    const targetRow = getRemoteSeatRow(targetSeatCode);
    if (!sourceRow || !targetRow) {
      window.alert("선택한 좌석 정보를 찾을 수 없습니다.");
      return;
    }
    if (!sourceRow.personName) {
      window.alert("선택 좌석에 배치된 사람이 없습니다.");
      return;
    }

    const sourcePerson = sourceRow.personName;
    const targetPerson = targetRow.personName;
    const sourceOriginFloor = sourceRow.floorCode;
    const sourceOriginSeat = sourceRow.seatCode;
    const targetOriginFloor = targetRow.floorCode;
    const targetOriginSeat = targetRow.seatCode;

    targetRow.personName = sourcePerson;
    targetRow.isMoved = moveFlag;
    targetRow.originFloorCode = moveFlag ? sourceOriginFloor : "";
    targetRow.originSeatCode = moveFlag ? sourceOriginSeat : "";
    targetRow.note = targetRow.note || "";

    if (targetPerson) {
      sourceRow.personName = targetPerson;
      sourceRow.isMoved = moveFlag;
      sourceRow.originFloorCode = moveFlag ? targetOriginFloor : "";
      sourceRow.originSeatCode = moveFlag ? targetOriginSeat : "";
    } else {
      sourceRow.personName = "";
      sourceRow.isMoved = false;
      sourceRow.originFloorCode = "";
      sourceRow.originSeatCode = "";
    }

    markAdminDirty(sourceSeatCode);
    markAdminDirty(targetSeatCode);
    rebuildRemoteSeatLayoutIndexes();
    clearAdminSelection();
  }

  function loadRemoteJsonpForSave(url) {
    return new Promise((resolve, reject) => {
      const callbackName = "__ORG_DASHBOARD_SAVE_CALLBACK__";
      const script = document.createElement("script");
      const cleanup = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
        delete window[callbackName];
      };
      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };
      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("저장 요청을 보내지 못했습니다."));
      };
      document.body.appendChild(script);
    });
  }

  async function saveAdminChanges() {
    if (!remoteSeatLayout) {
      window.alert("구글시트 기반 자리배치 데이터가 연결되지 않았습니다.");
      return;
    }
    if (!state.adminPendingSeatCodes.length) {
      window.alert("저장할 변경 사항이 없습니다.");
      return;
    }
    const config = window.ORG_DASHBOARD_REMOTE || {};
    if (!config.webAppUrl || !config.accessKey) {
      window.alert("시트 연동용 설정이 없습니다.");
      return;
    }

    state.adminSaving = true;
    renderSeatView();
    try {
      for (const seatCode of state.adminPendingSeatCodes) {
        const row = getRemoteSeatRow(seatCode);
        if (!row) continue;
        const url = new URL(config.webAppUrl);
        url.searchParams.set("key", config.accessKey);
        url.searchParams.set("callback", "__ORG_DASHBOARD_SAVE_CALLBACK__");
        url.searchParams.set("action", "upsertSeatLayout");
        const seatSheet =
          SEAT_SHEET_BY_FLOOR[row.floorCode] ||
          config.seatSheet ||
          (Array.isArray(config.seatSheets) ? config.seatSheets[0] : "");
        if (seatSheet) url.searchParams.set("seat_sheet", seatSheet);
        url.searchParams.set("seat_code", row.seatCode || "");
        url.searchParams.set("floor_code", row.floorCode || "");
        url.searchParams.set("seat_label", row.seatLabel || "");
        url.searchParams.set("person_name", row.personName || "");
        url.searchParams.set("team_org_id_seat", row.teamOrgIdSeat || "");
        url.searchParams.set("origin_floor_code", row.originFloorCode || "");
        url.searchParams.set("origin_seat_code", row.originSeatCode || "");
        url.searchParams.set("is_moved", row.isMoved ? "Y" : "N");
        url.searchParams.set("is_external_division", row.isExternalDivision ? "Y" : "N");
        url.searchParams.set("note", row.note || "");
        url.searchParams.set("_t", Date.now().toString());
        const payload = await loadRemoteJsonpForSave(url);
        if (!payload || payload.ok === false) {
          throw new Error(payload?.error || `저장 실패: ${seatCode}`);
        }
      }
      state.adminPendingSeatCodes = [];
      window.alert("자리배치 변경사항을 저장했습니다.");
    } catch (error) {
      window.alert(`저장 중 오류가 발생했습니다. ${error.message}`);
    } finally {
      state.adminSaving = false;
      renderSeatView();
    }
  }

  function getAdminSelectionSummary(floor) {
    const sourceSeatCode = state.adminSelection.sourceSeatCode;
    const targetSeatCode = state.adminSelection.targetSeatCode;
    const sourceInfo = sourceSeatCode ? getSeatAssignmentInfo(floor, sourceSeatCode) : null;
    const targetInfo = targetSeatCode ? getSeatAssignmentInfo(floor, targetSeatCode) : null;
    return {
      sourceSeatCode,
      sourceName: sourceInfo?.personName || "",
      targetSeatCode,
      targetName: targetInfo?.personName || "",
      moveFlag: state.adminSelection.moveFlag,
      pendingCount: state.adminPendingSeatCodes.length,
    };
  }

  function renderAdminPanel(floor) {
    if (!state.adminMode) return "";
    const summary = getAdminSelectionSummary(floor);
    return `
      <div class="seat-admin-panel">
        <div class="seat-admin-panel-head">
          <h4>자리배치 편집</h4>
          <p>1. 이동할 사람 좌석 선택  2. 이동 대상 좌석 선택  3. 이동 여부 지정</p>
        </div>
        <div class="seat-admin-fields">
          <div class="seat-admin-field">
            <span class="seat-admin-label">선택 좌석</span>
            <strong>${summary.sourceSeatCode || "미선택"}</strong>
            <span>${summary.sourceName || "사람이 있는 좌석을 클릭하세요"}</span>
          </div>
          <div class="seat-admin-field">
            <span class="seat-admin-label">이동 대상</span>
            <strong>${summary.targetSeatCode || "미선택"}</strong>
            <span>${summary.targetName || "비어 있는 좌석 또는 바꿀 좌석을 클릭하세요"}</span>
          </div>
        </div>
        <div class="seat-admin-toggle-group">
          <button class="seat-admin-toggle ${summary.moveFlag === "Y" ? "active" : ""}" type="button" data-admin-move="Y">이동 Y</button>
          <button class="seat-admin-toggle ${summary.moveFlag === "N" ? "active" : ""}" type="button" data-admin-move="N">이동 N</button>
          <button class="seat-admin-apply" type="button" id="seatAdminApply">확인 반영</button>
          <button class="seat-admin-reset" type="button" id="seatAdminReset">선택 초기화</button>
        </div>
        <div class="seat-admin-savebar">
          <span class="seat-admin-pending">반영 대기 ${summary.pendingCount}건</span>
          <button class="seat-admin-save" type="button" id="seatAdminSave" ${state.adminSaving ? "disabled" : ""}>
            ${state.adminSaving ? "저장 중..." : "저장하기"}
          </button>
        </div>
      </div>`;
  }

  function buildMoveMaps(floor) {
    return buildSeatMoveMapForFloor(floor);
  }
  function buildSeatStats(floor) {
    const assignments = getAssignments(floor, state.scenario);
    const countedSeats = getRenderableSeats(floor).filter((seat) => !isOtherDeptSeat(seat.seatCode));
    const occupiedSeats = countedSeats.filter((seat) => assignments[seat.seatCode]?.personName).length;
    return {
      totalSeats: countedSeats.length,
      occupiedSeats,
      movedSeats: getMovedPeopleForFloor(floor.floorCode).length,
    };
  }

  /* ?? Coordinate Compression ??????????????????????? */
  function buildCoordMap(floor) {
    const sz = FLOOR_SIZES[floor.floorCode] || DEFAULT_SIZES;
    const CELL = sz.cell, SHAPE_CELL = sz.shape, GAP_CELL = sz.gap;

    const seatX = new Set(), seatY = new Set();
    const shapeX = new Set(), shapeY = new Set();

    getRenderableSeats(floor).forEach(s => {
      for (let x=s.x; x<s.x+s.w; x++) seatX.add(x);
      for (let y=s.y; y<s.y+s.h; y++) seatY.add(y);
    });
    floor.shapes.forEach(s => {
      if (s.shapeType==="zone") return;
      for (let x=s.x; x<s.x+s.w; x++) shapeX.add(x);
      for (let y=s.y; y<s.y+s.h; y++) shapeY.add(y);
    });

    // Bounds
    const xs=[],ys=[];
    floor.shapes.forEach(s=>{xs.push(s.x,s.x+s.w);ys.push(s.y,s.y+s.h)});
    getRenderableSeats(floor).forEach(s=>{xs.push(s.x,s.x+s.w);ys.push(s.y,s.y+s.h)});
      const outline=floor.outlinePoints || FLOOR_OUTLINES[floor.floorCode];
    if(outline) outline.forEach(p=>{xs.push(p[0]);ys.push(p[1])});
    const minX=Math.floor(Math.min(...xs)-PAD), maxX=Math.ceil(Math.max(...xs)+PAD);
    const minY=Math.floor(Math.min(...ys)-PAD), maxY=Math.ceil(Math.max(...ys)+PAD);

    // Build X position map
    const xPos=new Map(); let px=0;
    for(let x=minX;x<=maxX+1;x++){
      xPos.set(x,px);
      px += seatX.has(x)?CELL : shapeX.has(x)?SHAPE_CELL : GAP_CELL;
    }
    // Build Y position map
    const yPos=new Map(); let py=0;
    for(let y=minY;y<=maxY+1;y++){
      yPos.set(y,py);
      py += seatY.has(y)?CELL : shapeY.has(y)?SHAPE_CELL : GAP_CELL;
    }

    const toX=x=>{const f=Math.floor(x),v=xPos.get(f);if(v===undefined)return 0;const fr=x-f;if(!fr)return v;const n=xPos.get(f+1);return v+fr*((n??v)-v)};
    const toY=y=>{const f=Math.floor(y),v=yPos.get(f);if(v===undefined)return 0;const fr=y-f;if(!fr)return v;const n=yPos.get(f+1);return v+fr*((n??v)-v)};
    const spanW=(x,w)=>(xPos.get(x+w)??px)-(xPos.get(x)??0);
    const spanH=(y,h)=>(yPos.get(y+h)??py)-(yPos.get(y)??0);

    return { toX,toY,spanW,spanH,totalW:px,totalH:py,CELL };
  }

  /* ?? SVG Renderers ???????????????????????????????? */
  function svgDefs(cellSize) {
    return `<defs>
      <filter id="seatShadow" x="-10%" y="-10%" width="130%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="rgba(30,40,55,0.09)"/>
      </filter>
      <filter id="seatHoverShadow" x="-15%" y="-15%" width="140%" height="150%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(184,92,56,0.18)"/>
      </filter>
      <pattern id="svGrid" width="${cellSize}" height="${cellSize}" patternUnits="userSpaceOnUse">
        <path d="M ${cellSize} 0 L 0 0 0 ${cellSize}" fill="none" stroke="rgba(0,0,0,0.018)" stroke-width="0.5"/>
      </pattern>
      <pattern id="hatchPat" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(140,150,165,0.12)" stroke-width="2"/>
      </pattern>
      <pattern id="otherDeptHatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="12" height="12" fill="rgba(190,192,198,0.25)"/>
        <line x1="0" y1="0" x2="0" y2="12" stroke="rgba(150,155,165,0.35)" stroke-width="3.5"/>
      </pattern>
    </defs>`;
  }

  function svgOutline(cm,floor) {
    const pts=floor.outlinePoints || FLOOR_OUTLINES[floor.floorCode];
    if(!pts) return "";
    return `<polygon class="sv-outline" points="${pts.map(p=>`${cm.toX(p[0])},${cm.toY(p[1])}`).join(" ")}"/>`;
  }

  function svgCoreAreas(cm,floor) {
    const cores=floor.coreAreas || CORE_AREAS[floor.floorCode]; if(!cores) return "";
    return cores.map(c=>{
      const cx=cm.toX(c.x),cy=cm.toY(c.y),cw=cm.spanW(c.x,c.w),ch=cm.spanH(c.y,c.h);
      return `<g class="sv-core">
        <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="4" fill="url(#hatchPat)"/>
        <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="4" class="sv-core-bg"/>
        <text x="${cx+cw/2}" y="${cy+ch/2}" class="sv-core-label">${esc(c.label)}</text>
      </g>`;
    }).join("");
  }

  function svgShapes(floor,cm) {
    const isEqualizedRoom = (label) => {
      const text = String(label || "");
      if (floor.floorCode === "12F") return /^파트장실-[123]$/.test(text);
      if (floor.floorCode === "13F") return /^파트장실-[234]$/.test(text);
      return false;
    };
    const equalizeTargets = floor.shapes.filter((shape) => isEqualizedRoom(shape.label));
    const equalizedWidth = equalizeTargets.length
      ? Math.max(...equalizeTargets.map((shape) => cm.spanW(shape.x, shape.w)))
      : 0;

      return floor.shapes.map(s=>{
        if(s.shapeType==="zone") return "";
        let sx=cm.toX(s.x),sy=cm.toY(s.y);
        const extH=(s.shapeType==="office"&&s.h<=1)?1:0;
        let sw=cm.spanW(s.x,s.w),sh=cm.spanH(s.y,s.h+extH);
        if (floor.floorCode === "2F" && String(s.label || "") === "그룹장실-1") {
          sx -= 8;
          sw += 16;
          sh += 28;
        }
        if (equalizedWidth && isEqualizedRoom(s.label)) {
          const centerX = sx + sw / 2;
          sw = equalizedWidth;
          sx = centerX - sw / 2;
        }
      let cls="sv-shape-support";
      if(s.shapeType==="room")cls="sv-shape-room";
      else if(s.shapeType==="office")cls="sv-shape-office";
      else if(s.shapeType==="common")cls="sv-shape-common";
      let displayLabel = s.label || "";
      const normalizedOfficeLabel = String(displayLabel).replace(/\s+/g, "");
      if (floor.floorCode === "2F" && s.shapeType === "office") {
        if (normalizedOfficeLabel === "그룹장실-1" && s.x === 3 && s.y === 33) {
          displayLabel = "부대표실";
        } else if (normalizedOfficeLabel === "파트장실-2" && s.x === 20 && s.y === 32) {
          displayLabel = "그룹장실";
        }
      }
      if (floor.floorCode === "12F" && s.shapeType === "office") {
        if (normalizedOfficeLabel === "파트장실-1" && s.x === 29 && s.y === 18) {
          displayLabel = "그룹장실-1";
        } else if (normalizedOfficeLabel === "파트장실-7" && s.x === 13 && s.y === 18) {
          displayLabel = "그룹장실-2";
        }
      }
      if (floor.floorCode === "13F" && s.shapeType === "office" && normalizedOfficeLabel === "그룹장실-1") {
        displayLabel = "부대표실";
      }
      const area=sw*sh;
      let fs=12; if(area>15000)fs=14;else if(area>6000)fs=13;else if(area<2000)fs=9;else if(area<3500)fs=10;
      const labelY=(s.shapeType==="office"&&extH)?sy+cm.spanH(s.y,s.h)*0.5:sy+sh/2;
      return `<g class="${cls}"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="5"/>
        <title>${esc(displayLabel)}</title>
        <text x="${sx+sw/2}" y="${labelY}" class="sv-shape-label" style="font-size:${fs}px">${esc(displayLabel)}</text></g>`;
    }).join("");
  }

  function svgOrgOverlayUnderlay(floor, cm) {
    const groups = buildOrgOverlayGroups_(floor, cm);
    if (!groups.length) return "";
    return groups.map((group) => {
      return `<g class="sv-org-overlay" data-org-key="${esc(group.key)}">
        <rect x="${group.x}" y="${group.y}" width="${group.w}" height="${group.h}" rx="14" fill="${group.colors.fill}" stroke="${group.colors.stroke}" stroke-width="1.25"/>
      </g>`;
    }).join("");
  }

    function svgOrgOverlayBadges(floor, cm) {
      const groups = buildOrgOverlayGroups_(floor, cm);
      if (!groups.length) return "";
      const placed = [];
      const gap = 6;
      const sorted = [...groups].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      return sorted
        .map((group) => {
          const badgeHeight = 24;
          const useBottomBadge = /센터|솔루션파트/.test(group.label || "");
          const badgeX = group.x + 8;
          let badgeY = useBottomBadge ? group.y + group.h - badgeHeight - 6 : group.y + 6;
          const bottomLimit = group.y + group.h - badgeHeight - 6;
          const topLimit = group.y + 6;

          for (const prev of placed) {
            const overlapX = !(badgeX + group.badgeWidth < prev.x || badgeX > prev.x + prev.w);
            const overlapY = !(badgeY + badgeHeight < prev.y || badgeY > prev.y + prev.h);
            if (overlapX && overlapY) {
              if (useBottomBadge) {
                badgeY = Math.max(topLimit, prev.y - badgeHeight - gap);
              } else {
                badgeY = Math.min(bottomLimit, prev.y + prev.h + gap);
              }
            }
          }

          placed.push({ x: badgeX, y: badgeY, w: group.badgeWidth, h: badgeHeight });

          return `<g class="sv-org-badge" data-org-key="${esc(group.key)}">
          <rect x="${badgeX}" y="${badgeY}" width="${group.badgeWidth}" height="${badgeHeight}" rx="12" fill="${group.colors.badge}" stroke="${group.colors.stroke}" stroke-width="1"/>
          <text x="${badgeX + group.badgeWidth / 2}" y="${badgeY + badgeHeight / 2}" fill="${group.colors.text}" class="sv-org-badge-text" dominant-baseline="middle">${esc(group.label)}</text>
        </g>`;
        }).join("");
    }

  function svgSeats(floor,cm,assignments,extSet) {
    const fc = floor.floorCode;
    const otherDeptConfig = OTHER_DEPT[fc];
    const moveMaps = buildMoveMaps(floor);
    const movedNames = new Set([...moveMaps.byName.keys()]);
    return getRenderableSeats(floor).map(seat=>{
      const sx=cm.toX(seat.x)+SEAT_INSET;
      let sy=cm.toY(seat.y)+SEAT_INSET;
      const sw=cm.spanW(seat.x,seat.w)-SEAT_INSET*2, sh=cm.spanH(seat.y,seat.h)-SEAT_INSET*2;
      if (seat.seatCode === "2F-B1") {
        sy -= 8;
      }
        const info=assignments[seat.seatCode];
        const remoteSeat = remoteSeatLayout?.bySeat?.get(seat.seatCode);
        const override = getSeatDisplayOverride(seat.seatCode);
        const rawPerson=info?.personName||"";
        const person = override && Object.prototype.hasOwnProperty.call(override, "personName") ? override.personName : rawPerson;
        const dept = override?.deptName !== undefined ? override.deptName : getSeatOverlayLabel_(floor.floorCode, remoteSeat?.teamOrgIdSeat || "");
        const emptyLabel = override?.emptyLabel || "";
        const isExt=extSet.has(seat.seatCode), isOcc=!!person;
        const isMoved = !!(person && movedNames.has(person));
      const moveInfo = moveMaps.byToSeat.get(seat.seatCode);

      // Other-department seats ??gray out
      const odPfx = otherDeptConfig?.seatPrefix;
      const isOtherDept = remoteSeatLayout
        ? !!remoteSeat?.isExternalDivision
        : !!(odPfx && seat.seatCode.startsWith(odPfx));

      let cls="sv-seat";
      if (isOtherDept) cls += " sv-seat-other";
      else if(isExt) cls+=" sv-seat-ext";
      else if(isOcc) cls+=" sv-seat-occupied";
      if (isMoved && !isOtherDept) cls += " sv-seat-moved";

        const showName = isOcc && !isOtherDept;
          return `<g class="${cls}" data-code="${esc(seat.seatCode)}" data-person="${esc(person)}" data-dept="${esc(dept)}" data-empty-label="${esc(emptyLabel)}" data-origin-seat="${esc(moveInfo?.fromSeat || "")}" data-origin-floor="${esc(moveInfo?.fromFloor || "")}">
          <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="5" filter="url(#seatShadow)"/>
          <text x="${sx+sw/2}" y="${showName ? sy+sh*0.42 : sy+sh/2}" class="sv-seat-code">${esc(seat.seatLabel)}</text>
        ${showName ? `<text x="${sx+sw/2}" y="${sy + sh * 0.72}" class="sv-seat-name">${esc(person.length > 3 ? person.slice(0, 3) + ".." : person)}</text>` : ""}
      </g>`;
    }).join("");
  }

  /* ?? Other-dept hatch overlay ?????????????????????? */
  function svgOtherDeptOverlay(floor, cm) {
    const config = OTHER_DEPT[floor.floorCode];
    if (!config) return "";
    const prefix = config.seatPrefix;
    if (!prefix) return "";
    const otherSeats = floor.seatDefs.filter(s => s.seatCode.startsWith(prefix));
    if (!otherSeats.length) return "";

    if (config.areas?.length) {
      return config.areas.map((area) => {
        const ax = cm.toX(area.x);
        const ay = cm.toY(area.y);
        const aw = cm.spanW(area.x, area.w);
        const ah = cm.spanH(area.y, area.h);
        return `<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" class="sv-other-overlay" rx="10"/>`;
      }).join("");
    }

    if (config.area) {
      const ax = cm.toX(config.area.x);
      const ay = cm.toY(config.area.y);
      const aw = cm.spanW(config.area.x, config.area.w);
      const ah = cm.spanH(config.area.y, config.area.h);
      return `<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" class="sv-other-overlay" rx="10"/>`;
    }

    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    otherSeats.forEach(s => {
      const sx=cm.toX(s.x), sy=cm.toY(s.y);
      const ex=sx+cm.spanW(s.x,s.w), ey=sy+cm.spanH(s.y,s.h);
      minX=Math.min(minX,sx); minY=Math.min(minY,sy);
      maxX=Math.max(maxX,ex); maxY=Math.max(maxY,ey);
    });
    // Also include explicitly named shapes when needed
    floor.shapes.forEach(s => {
      if (s.shapeType==="zone") return;
      if (config.includeShapes && !config.includeShapes.includes(s.label)) return;
      const sx=cm.toX(s.x), sy=cm.toY(s.y);
      const ex=sx+cm.spanW(s.x,s.w), ey=sy+cm.spanH(s.y,s.h);
        minX=Math.min(minX,sx); minY=Math.min(minY,sy);
        maxX=Math.max(maxX,ex); maxY=Math.max(maxY,ey);
    });
    const p=12;
    return `<rect x="${minX-p}" y="${minY-p}" width="${maxX-minX+p*2}" height="${maxY-minY+p*2}"
      class="sv-other-overlay" rx="10"/>`;
  }

  function getViewportRectForFloor(floor, cm) {
    if (!VIEWPORT_TEST) return { x: 0, y: 0, w: cm.totalW, h: cm.totalH };
    if (state.subview === "all") return { x: 0, y: 0, w: cm.totalW, h: cm.totalH };

    const seats = getRenderableSeats(floor)
      .filter((seat) => !isOtherDeptSeat(seat.seatCode))
      .filter((seat) => {
        if (floor.floorCode !== "12F") return true;
        if (state.subview === "north") return seat.y < 24;
        if (state.subview === "south") return seat.y >= 24;
        return true;
      });

    if (!seats.length) return { x: 0, y: 0, w: cm.totalW, h: cm.totalH };

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    seats.forEach((seat) => {
      const rect = getSeatRectPx_(seat, cm);
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w);
      maxY = Math.max(maxY, rect.y + rect.h);
    });

    (floor.shapes || []).forEach((shape) => {
      const label = String(shape.label || "");
      const includeShape =
        floor.floorCode === "12F"
          ? (state.subview === "north"
              ? shape.y < 24 && /회의실|OA|서버실|창고|파트장실|그룹장실|부대표실|부문대표|EV|계단/.test(label)
              : state.subview === "south"
                ? shape.y >= 20
                : true)
          : /회의실|OA|서버실|창고|파트장실|그룹장실|부대표실|부문대표|라운지|휴게|락커룸|EV|계단/.test(label);
      if (!includeShape) return;
      const sx = cm.toX(shape.x);
      const sy = cm.toY(shape.y);
      const sw = cm.spanW(shape.x, shape.w);
      const sh = cm.spanH(shape.y, shape.h);
      minX = Math.min(minX, sx);
      minY = Math.min(minY, sy);
      maxX = Math.max(maxX, sx + sw);
      maxY = Math.max(maxY, sy + sh);
    });

    const padX = cm.CELL * 1.6;
    const padY = cm.CELL * 1.4;
    const x = Math.max(0, minX - padX);
    const y = Math.max(0, minY - padY);
    const w = Math.min(cm.totalW - x, (maxX - minX) + padX * 2);
    const h = Math.min(cm.totalH - y, (maxY - minY) + padY * 2);
    return { x, y, w, h };
  }

  function renderMiniMap(floor) {
    if (!VIEWPORT_TEST || !state.minimapVisible) return "";
    const cm = buildCoordMap(floor);
    const vp = getViewportRectForFloor(floor, cm);
    return `<div class="seat-minimap">
      <div class="seat-minimap-head">미니맵</div>
      <svg class="seat-minimap-svg" viewBox="0 0 ${cm.totalW} ${cm.totalH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
        <rect width="${cm.totalW}" height="${cm.totalH}" rx="12" fill="rgba(255,255,255,0.78)"/>
        ${svgOutline(cm, floor)}
        <rect x="${vp.x}" y="${vp.y}" width="${vp.w}" height="${vp.h}" rx="12" class="seat-minimap-viewport"/>
      </svg>
    </div>`;
  }

  function renderFloorSVG(floor) {
    const cm=buildCoordMap(floor);
    const assignments=getAssignments(floor,state.scenario);
    const extSet=new Set(overlays.externalSeatCodes?.[floor.floorCode]||[]);
    const vp = getViewportRectForFloor(floor, cm);
    return `<svg class="floor-svg" viewBox="${vp.x} ${vp.y} ${vp.w} ${vp.h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      ${svgDefs(cm.CELL)}
      <rect width="${cm.totalW}" height="${cm.totalH}" fill="url(#svGrid)" opacity="0.5"/>
        ${svgOutline(cm,floor)}
        ${svgCoreAreas(cm,floor)}
      ${svgShapes(floor,cm)}
      ${svgOrgOverlayUnderlay(floor,cm)}
      ${svgSeats(floor,cm,assignments,extSet)}
      ${svgOrgOverlayBadges(floor,cm)}
      ${svgOtherDeptOverlay(floor,cm)}
    </svg><div class="sv-tooltip" id="svTooltip"></div>`;
  }

  /* ?? UI ??????????????????????????????????????????? */
    function renderFloorStack() {
      return FLOOR_ORDER.map(fc=>{
        const f=getFloor(fc),active=fc===state.floorCode;
        const label = floorLabel(fc);
        const compactClass = label.length >= 6 ? " compact" : "";
        return `<button class="floor-card ${active?"active":""}" type="button" data-floor="${fc}">
          <span class="floor-card-label${compactClass}">${label}</span>
          <span class="floor-card-count">좌석 ${fmt(buildSeatStats(f).totalSeats)}</span>
        </button>`;
      }).join("");
    }

  function renderMoveList(floor) {
    const m=getMovedPeople(floor);
    if(!m.length) return `<div class="seat-empty">현재 기준 이동 좌석이 없습니다.</div>`;
    return m.slice(0,20).map(r=>`<div class="move-row"><strong>${esc(r.name)}</strong><span>${esc(r.fromSeat)} → ${esc(r.toSeat)}</span></div>`).join("");
  }

  function renderSeatView() {
    const floor=getFloor(state.floorCode), stats=buildSeatStats(floor);
    const viewportOptions = getViewportOptionsForFloor(floor.floorCode);
    seatView.innerHTML=`
        <section class="seat-hero panel ${state.adminMode ? "admin-active" : ""}">
          <div class="seat-hero-copy"><p class="eyebrow">자리배치</p><h2>${floorLabel(floor.floorCode)} 자리배치</h2>
            <p>변경안 기준 평면입니다. 이동한 인원에 호버하면 원래 위치 정보를 확인할 수 있습니다.</p></div>
          <div class="seat-hero-actions">
            <div class="seat-scenario-badge">변경안 기준</div>
            ${state.adminMode ? `<div class="seat-admin-indicator">관리자모드 활성화</div>` : ``}
          </div>
        </section>
      <section class="seat-layout-grid">
          <aside class="seat-stack-panel panel"><div class="panel-head"><h3>층 선택</h3></div><div class="floor-stack">${renderFloorStack()}</div>${renderAdminPanel(floor)}</aside>
        <div class="seat-main-column">
            <div class="seat-detail-card">
              <div class="seat-detail-head">
                <div><p class="eyebrow">평면도</p><h2>${floorLabel(floor.floorCode)} 평면</h2></div>
                <div class="seat-head-actions">
                  ${VIEWPORT_TEST ? `
                  <button class="seat-layer-toggle ${state.minimapVisible ? "active" : ""}" type="button" id="seatMinimapToggle">
                    ${state.minimapVisible ? "미니맵 ON" : "미니맵 OFF"}
                  </button>` : ``}
                  ${ORG_OVERLAY_TEST ? `
                  <button class="seat-layer-toggle ${state.orgOverlayVisible ? "active" : ""}" type="button" id="seatOrgOverlayToggle">
                    ${state.orgOverlayVisible ? "조직 레이어 ON" : "조직 레이어 OFF"}
                  </button>` : ``}
                  <button class="seat-admin-btn ${state.adminMode ? "active" : ""}" type="button" id="seatAdminToggle">
                    ${state.adminMode ? "관리자모드 ON" : "관리자모드"}
                  </button>
                  <div class="seat-zoom-controls">
                    <button class="seat-zoom-btn" type="button" data-zoom-action="out">-</button>
                    <span class="seat-zoom-value">${Math.round(state.zoom * 100)}%</span>
                    <button class="seat-zoom-btn" type="button" data-zoom-action="in">+</button>
                  </div>
                </div>
              </div>
            ${viewportOptions.length ? `<div class="seat-subview-tabs">${viewportOptions.map((option) => `
              <button class="seat-subview-tab ${state.subview === option.key ? "active" : ""}" type="button" data-subview="${option.key}">${option.label}</button>
            `).join("")}</div>` : ``}
            <div class="seat-board-shell">
              ${renderMiniMap(floor)}
              <div class="seat-board-zoom" style="--seat-zoom:${state.zoom};">
                ${renderFloorSVG(floor)}
              </div>
            </div>
          </div>
        </div>
      </section>`;

    seatView.querySelectorAll("[data-floor]").forEach(b=>b.addEventListener("click",()=>{state.floorCode=b.dataset.floor;state.subview=getDefaultSubview(state.floorCode);renderSeatView()}));
    const adminToggle = seatView.querySelector("#seatAdminToggle");
    const overlayToggle = seatView.querySelector("#seatOrgOverlayToggle");
    const minimapToggle = seatView.querySelector("#seatMinimapToggle");
    const handleOverlayToggle = () => {
      state.orgOverlayVisible = !state.orgOverlayVisible;
      renderSeatView();
    };
    if (overlayToggle) overlayToggle.addEventListener("click", handleOverlayToggle);
    if (minimapToggle) minimapToggle.addEventListener("click", () => {
      state.minimapVisible = !state.minimapVisible;
      renderSeatView();
    });
    seatView.querySelectorAll("[data-subview]").forEach((button) => {
      button.addEventListener("click", () => {
        state.subview = button.getAttribute("data-subview") || "";
        renderSeatView();
      });
    });
    if (adminToggle) {
      adminToggle.addEventListener("click", () => {
        if (state.adminMode) {
          state.adminMode = false;
          state.adminSelection = { sourceSeatCode: "", targetSeatCode: "", moveFlag: "Y" };
          renderSeatView();
          return;
        }
        const input = window.prompt("관리자 비밀번호를 입력하세요.");
        if (input === null) return;
        if (input === ADMIN_PASSWORD) {
          state.adminMode = true;
          renderSeatView();
          return;
        }
        window.alert("비밀번호가 올바르지 않습니다.");
      });
    }
    const applyButton = seatView.querySelector("#seatAdminApply");
    if (applyButton) {
      applyButton.addEventListener("click", () => {
        applyAdminSeatChange();
        renderSeatView();
      });
    }
    seatView.querySelectorAll("[data-admin-move]").forEach((button) => {
      button.addEventListener("click", () => {
        state.adminSelection.moveFlag = button.getAttribute("data-admin-move") || "Y";
        renderSeatView();
      });
    });
    const resetButton = seatView.querySelector("#seatAdminReset");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        state.adminSelection = { sourceSeatCode: "", targetSeatCode: "", moveFlag: "Y" };
        renderSeatView();
      });
    }
    const saveButton = seatView.querySelector("#seatAdminSave");
    if (saveButton) {
      saveButton.addEventListener("click", () => {
        saveAdminChanges();
      });
    }
    seatView.querySelectorAll("[data-zoom-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-zoom-action");
        if (action === "in") state.zoom = Math.min(2.4, +(state.zoom + 0.2).toFixed(2));
        if (action === "out") state.zoom = Math.max(0.8, +(state.zoom - 0.2).toFixed(2));
        renderSeatView();
      });
    });

    const shellEl = seatView.querySelector(".seat-board-shell");
    if (shellEl) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let startScrollLeft = 0;
      let startScrollTop = 0;

      const stopDragging = () => {
        isDragging = false;
        shellEl.classList.remove("is-dragging");
      };

      shellEl.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.target.closest(".sv-seat")) return;
        isDragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startScrollLeft = shellEl.scrollLeft;
        startScrollTop = shellEl.scrollTop;
        shellEl.classList.add("is-dragging");
        shellEl.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });

      shellEl.addEventListener("pointerup", stopDragging);
      shellEl.addEventListener("pointercancel", stopDragging);
      shellEl.addEventListener("mouseleave", stopDragging);

      shellEl.addEventListener("pointermove", (event) => {
        if (!isDragging) return;
        shellEl.scrollLeft = startScrollLeft - (event.clientX - startX);
        shellEl.scrollTop = startScrollTop - (event.clientY - startY);
        event.preventDefault();
      });
    }

    const tip=document.getElementById("svTooltip"),svg=seatView.querySelector(".floor-svg");
    if(svg&&tip){
      const clearOriginHighlights = () => {
        svg.querySelectorAll(".sv-seat-origin, .sv-seat-origin-source, .sv-seat-selected, .sv-seat-target").forEach((el) => {
          el.classList.remove("sv-seat-origin", "sv-seat-origin-source", "sv-seat-selected", "sv-seat-target");
        });
      };

      const applyOriginHighlight = (seatEl) => {
        clearOriginHighlights();
        if (!seatEl) return;
        const originSeat = seatEl.dataset.originSeat || "";
        const originFloor = seatEl.dataset.originFloor || "";
        if (!originSeat || originFloor !== floor.floorCode) return;
        const originEl = svg.querySelector(`.sv-seat[data-code="${originSeat}"]`);
        if (!originEl) return;
        seatEl.classList.add("sv-seat-origin-source");
        originEl.classList.add("sv-seat-origin");
      };

      const applyAdminSelection = () => {
        clearOriginHighlights();
        if (!state.adminMode) return;
        if (state.adminSelection.sourceSeatCode) {
          const sourceEl = svg.querySelector(`.sv-seat[data-code="${state.adminSelection.sourceSeatCode}"]`);
          sourceEl?.classList.add("sv-seat-selected");
        }
        if (state.adminSelection.targetSeatCode) {
          const targetEl = svg.querySelector(`.sv-seat[data-code="${state.adminSelection.targetSeatCode}"]`);
          targetEl?.classList.add("sv-seat-target");
        }
      };

      svg.addEventListener("mouseenter", (e) => {
        const g = e.target.closest(".sv-seat");
        if (!g) return;
        const c = g.dataset.code || "";
        const p = g.dataset.person || "";
        const d = g.dataset.dept || "";
        const emptyLabel = g.dataset.emptyLabel || "";
        const originSeat = g.dataset.originSeat || "";
        const originFloor = g.dataset.originFloor || "";
        const originText = p === "권진명"
          ? "추후이동"
          : originFloor
            ? (originSeat && originFloor === floor.floorCode ? `원래 자리 ${originSeat}` : `원래 ${floorLabel(originFloor)}`)
            : "";
        tip.innerHTML = p
          ? `<strong>${c}</strong><span class="sv-tt-name">${esc(p)}</span>${d ? `<span class="sv-tt-dept">${esc(d)}</span>` : ""}${originText ? `<span class="sv-tt-origin">${esc(originText)}</span>` : ""}`
          : `<strong>${c}</strong><span class="sv-tt-empty">미배치</span>${emptyLabel ? `<span class="sv-tt-dept">${esc(emptyLabel)}</span>` : ""}`;
        tip.classList.add("visible");
        const shell = seatView.querySelector(".seat-board-shell");
        const shellRect = shell.getBoundingClientRect();
        const seatRect = g.getBoundingClientRect();
        const tipWidth = 168;
        const tipHeight = 88;
        let left = seatRect.left - shellRect.left + (seatRect.width / 2) - (tipWidth / 2);
        let top = seatRect.top - shellRect.top - tipHeight - 10;
        const maxLeft = Math.max(8, shell.clientWidth - tipWidth - 8);
        left = Math.max(8, Math.min(left, maxLeft));
        if (top < 8) {
          top = seatRect.bottom - shellRect.top + 10;
        }
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
        if (state.adminMode) {
          applyAdminSelection();
        } else {
          applyOriginHighlight(g);
        }
      }, true);
      svg.addEventListener("mouseleave",()=>{tip.classList.remove("visible"); clearOriginHighlights();});
      svg.addEventListener("click",(e)=>{
        const g=e.target.closest(".sv-seat");
        if(!g){ clearOriginHighlights(); return; }
        if (state.adminMode) {
          const seatCode = g.dataset.code || "";
          const personName = g.dataset.person || "";
          if (!state.adminSelection.sourceSeatCode) {
            if (!personName) return;
            state.adminSelection.sourceSeatCode = seatCode;
            state.adminSelection.targetSeatCode = "";
            renderSeatView();
            return;
          }
          if (seatCode === state.adminSelection.sourceSeatCode) {
            state.adminSelection = { sourceSeatCode: "", targetSeatCode: "", moveFlag: state.adminSelection.moveFlag };
            renderSeatView();
            return;
          }
          state.adminSelection.targetSeatCode = seatCode;
          renderSeatView();
          return;
        }
        applyOriginHighlight(g);
      });
      if (state.adminMode) applyAdminSelection();
    }
  }

  /* ?? View switch ?????????????????????????????????? */
  function syncView() {
    if (mobileMediaQuery.matches) {
      state.activeView = "org";
    }
    const show=state.activeView==="seat";
    orgView.hidden=show;seatView.hidden=!show;
    switchEl.querySelectorAll(".view-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===state.activeView));
    if(show) renderSeatView();
  }
  switchEl.querySelectorAll(".view-tab").forEach(b=>b.addEventListener("click",()=>{state.activeView=b.dataset.view||"org";syncView()}));
  if (typeof mobileMediaQuery.addEventListener === "function") {
    mobileMediaQuery.addEventListener("change", syncView);
  } else if (typeof mobileMediaQuery.addListener === "function") {
    mobileMediaQuery.addListener(syncView);
  }
  syncView();
})();


