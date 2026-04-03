(function () {
  const seatData = window.SEAT_LAYOUT_DATA;
  const remoteSeatLayout = normalizeRemoteSeatLayout_(window.ORG_DASHBOARD_SEAT_LAYOUT);
  const overlays = window.SEAT_LAYOUT_OVERLAYS || { zones: [], externalSeatCodes: {} };
  if (!seatData || !Array.isArray(seatData.floors) || !seatData.floors.length) return;

  const orgView = document.getElementById("orgDashboardView");
  const seatView = document.getElementById("seatLayoutView");
  const switchEl = document.getElementById("viewSwitch");
  if (!orgView || !seatView || !switchEl) return;

  const FLOOR_ORDER = ["13F", "12F", "2F"].filter(fc =>
    seatData.floors.some(f => f.floorCode === fc)
  );

  /* ── Constants ──────────────────────────────────── */
  const FLOOR_SIZES = {
    "13F": { cell: 56, shape: 24, gap: 10 },
    "12F": { cell: 56, shape: 24, gap: 10 },
    "2F":  { cell: 56, shape: 24, gap: 10 },
  };
  const DEFAULT_SIZES = { cell: 56, shape: 24, gap: 10 };
  const SEAT_INSET = 1;
  const PAD = 1.5;
  const ADMIN_PASSWORD = "seat2604";

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
    activeView: "org",
    floorCode: FLOOR_ORDER[0] || seatData.floors[0].floorCode,
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
  };

  /* ── Floor outlines ─────────────────────────────── */
  const FLOOR_OUTLINES = {
    "13F": [[11,2],[36,2],[36,47],[-1,47],[-1,12],[5,12],[5,7],[11,7]],
    "12F": [[12,-1],[39,-1],[39,52],[0,52],[0,16],[5,16],[5,4],[12,4]],
    "2F":  [[12,1],[32,1],[32,50],[2,50],[2,13],[6,13],[6,10],[12,10]],
  };

  const CORE_AREAS = {
    "13F": [{ label: "EV 홀", x: 13, y: 20, w: 10, h: 4 },{ label: "계단실", x: 13, y: 25, w: 10, h: 3 }],
    "12F": [{ label: "EV 홀", x: 13, y: 22, w: 12, h: 4 },{ label: "계단실", x: 13, y: 27, w: 12, h: 4 }],
    "2F":  [{ label: "EV 홀", x: 9, y: 22, w: 12, h: 4 },{ label: "계단실", x: 9, y: 27, w: 12, h: 4 }],
  };

  const EQUAL_WIDTH_LABELS = {
    "13F": ["파트장실-2", "파트장실-3", "파트장실-4"],
    "12F": ["파트장실-1", "파트장실-2", "파트장실-3"],
  };
  const MOVE_OVERRIDES = {
    "2F-B19": { ignore: true },
    "2F-B65": { forceOriginFloor: "12F", forceOriginSeat: "" },
  };

  /* ── Utilities ──────────────────────────────────── */
  function esc(s) { return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function fmt(v) { return new Intl.NumberFormat("ko-KR").format(v); }
  function floorLabel(fc) { return fc.replace("F","층"); }
  function getFloor(fc) { return seatData.floors.find(f=>f.floorCode===fc)||seatData.floors[0]; }
  function getAssignments(floor,sc) {
    if (remoteSeatLayout) return remoteSeatLayout.assignmentsByFloor[floor.floorCode] || {};
    return floor.scenarios?.[sc]?.assignments||{};
  }

  function normalizeRemoteSeatLayout_(payload) {
    if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) return null;
    const rows = payload.rows
      .map((row) => ({
        seatCode: String(row.seat_code || "").trim(),
        floorCode: String(row.floor_code || "").trim(),
        seatLabel: String(row.seat_label || "").trim(),
        personName: String(row.person_name || "").trim(),
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

  function getSeatAssignmentInfo(floor, seatCode) {
    const assignments = getAssignments(floor, state.scenario);
    return assignments[seatCode] || null;
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
      window.alert("같은 좌석은 이동 대상으로 지정할 수 없습니다.");
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
      window.alert("시트 저장용 웹앱 설정이 없습니다.");
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
        url.searchParams.set("seat_code", row.seatCode || "");
        url.searchParams.set("floor_code", row.floorCode || "");
        url.searchParams.set("seat_label", row.seatLabel || "");
        url.searchParams.set("person_name", row.personName || "");
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
          <p>1. 이동할 사람 좌석 선택  2. 대상 좌석 선택  3. 이동 여부 지정</p>
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
            <span>${summary.targetName || "비어 있는 좌석 또는 변경할 좌석을 클릭하세요"}</span>
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
    const a=getAssignments(floor,state.scenario);
    return { totalSeats:floor.seatDefs.length, occupiedSeats:Object.values(a).filter(i=>i.personName).length, movedSeats:getMovedPeopleForFloor(floor.floorCode).length };
  }

  /* ── Coordinate Compression ─────────────────────── */
  function buildCoordMap(floor) {
    const sz = FLOOR_SIZES[floor.floorCode] || DEFAULT_SIZES;
    const CELL = sz.cell, SHAPE_CELL = sz.shape, GAP_CELL = sz.gap;

    const seatX = new Set(), seatY = new Set();
    const shapeX = new Set(), shapeY = new Set();

    floor.seatDefs.forEach(s => {
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
    floor.seatDefs.forEach(s=>{xs.push(s.x,s.x+s.w);ys.push(s.y,s.y+s.h)});
    const outline=FLOOR_OUTLINES[floor.floorCode];
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

  /* ── SVG Renderers ──────────────────────────────── */
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

  function svgOutline(cm,fc) {
    const pts=FLOOR_OUTLINES[fc];
    if(!pts) return "";
    return `<polygon class="sv-outline" points="${pts.map(p=>`${cm.toX(p[0])},${cm.toY(p[1])}`).join(" ")}"/>`;
  }

  function svgCoreAreas(cm,fc) {
    const cores=CORE_AREAS[fc]; if(!cores) return "";
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
    const equalizeLabels = EQUAL_WIDTH_LABELS[floor.floorCode] || [];
    const equalizeTargets = floor.shapes.filter((shape) => equalizeLabels.includes(shape.label));
    const equalizedWidth = equalizeTargets.length
      ? Math.max(...equalizeTargets.map((shape) => cm.spanW(shape.x, shape.w)))
      : 0;

      return floor.shapes.map(s=>{
        if(s.shapeType==="zone") return "";
        let sx=cm.toX(s.x),sy=cm.toY(s.y);
        const extH=(s.shapeType==="office"&&s.h<=1)?1:0;
        let sw=cm.spanW(s.x,s.w),sh=cm.spanH(s.y,s.h+extH);
        if (floor.floorCode === "2F" && s.label === "그룹장실-1") {
          sx -= 8;
          sw += 16;
          sh += 18;
        }
        if (equalizedWidth && equalizeLabels.includes(s.label)) {
          const centerX = sx + sw / 2;
          sw = equalizedWidth;
          sx = centerX - sw / 2;
        }
      let cls="sv-shape-support";
      if(s.shapeType==="room")cls="sv-shape-room";
      else if(s.shapeType==="office")cls="sv-shape-office";
      else if(s.shapeType==="common")cls="sv-shape-common";
      const area=sw*sh;
      let fs=12; if(area>15000)fs=14;else if(area>6000)fs=13;else if(area<2000)fs=9;else if(area<3500)fs=10;
      const labelY=(s.shapeType==="office"&&extH)?sy+cm.spanH(s.y,s.h)*0.5:sy+sh/2;
      return `<g class="${cls}"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="5"/>
        <title>${esc(s.label)}</title>
        <text x="${sx+sw/2}" y="${labelY}" class="sv-shape-label" style="font-size:${fs}px">${esc(s.label)}</text></g>`;
    }).join("");
  }

  function svgSeats(floor,cm,assignments,extSet) {
    const fc = floor.floorCode;
    const otherDeptConfig = OTHER_DEPT[fc];
    const moveMaps = buildMoveMaps(floor);
    const movedNames = new Set([...moveMaps.byName.keys()]);
    return floor.seatDefs.map(seat=>{
      const sx=cm.toX(seat.x)+SEAT_INSET, sy=cm.toY(seat.y)+SEAT_INSET;
      const sw=cm.spanW(seat.x,seat.w)-SEAT_INSET*2, sh=cm.spanH(seat.y,seat.h)-SEAT_INSET*2;
      const info=assignments[seat.seatCode]; const person=info?.personName||""; const dept=info?.deptName||"";
      const remoteSeat = remoteSeatLayout?.bySeat?.get(seat.seatCode);
      const isExt=extSet.has(seat.seatCode), isOcc=!!person;
      const isMoved = !!(person && movedNames.has(person));
      const moveInfo = moveMaps.byToSeat.get(seat.seatCode);

      // Other-department seats → gray out
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
        return `<g class="${cls}" data-code="${esc(seat.seatCode)}" data-person="${esc(person)}" data-dept="${esc(dept)}" data-origin-seat="${esc(moveInfo?.fromSeat || "")}" data-origin-floor="${esc(moveInfo?.fromFloor || "")}">
        <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="5" filter="url(#seatShadow)"/>
        <text x="${sx+sw/2}" y="${showName ? sy+sh*0.42 : sy+sh/2}" class="sv-seat-code">${esc(seat.seatLabel)}</text>
        ${showName?`<text x="${sx+sw/2}" y="${sy+sh*0.72}" class="sv-seat-name">${esc(person.length>3?person.slice(0,3)+'…':person)}</text>`:""}
      </g>`;
    }).join("");
  }

  /* ── Other-dept hatch overlay ────────────────────── */
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

  function renderFloorSVG(floor) {
    const cm=buildCoordMap(floor);
    const assignments=getAssignments(floor,state.scenario);
    const extSet=new Set(overlays.externalSeatCodes?.[floor.floorCode]||[]);
    return `<svg class="floor-svg" viewBox="0 0 ${cm.totalW} ${cm.totalH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      ${svgDefs(cm.CELL)}
      <rect width="${cm.totalW}" height="${cm.totalH}" fill="url(#svGrid)" opacity="0.5"/>
      ${svgOutline(cm,floor.floorCode)}
      ${svgCoreAreas(cm,floor.floorCode)}
      ${svgShapes(floor,cm)}
      ${svgSeats(floor,cm,assignments,extSet)}
      ${svgOtherDeptOverlay(floor,cm)}
    </svg><div class="sv-tooltip" id="svTooltip"></div>`;
  }

  /* ── UI ─────────────────────────────────────────── */
  function renderFloorStack() {
    return FLOOR_ORDER.map(fc=>{
      const f=getFloor(fc),active=fc===state.floorCode;
      return `<button class="floor-card ${active?"active":""}" type="button" data-floor="${fc}">
        <span class="floor-card-label">${floorLabel(fc)}</span><span class="floor-card-count">${fmt(f.seatDefs.length)} 석</span></button>`;
    }).join("");
  }

  function renderMoveList(floor) {
    const m=getMovedPeople(floor);
    if(!m.length) return `<div class="seat-empty">현재안과 변경안 사이에 좌석 이동이 없습니다.</div>`;
    return m.slice(0,20).map(r=>`<div class="move-row"><strong>${esc(r.name)}</strong><span>${esc(r.fromSeat)} → ${esc(r.toSeat)}</span></div>`).join("");
  }

  function renderSeatView() {
    const floor=getFloor(state.floorCode), stats=buildSeatStats(floor);
    seatView.innerHTML=`
        <section class="seat-hero panel ${state.adminMode ? "admin-active" : ""}">
          <div class="seat-hero-copy"><p class="eyebrow">Seat Layout</p><h2>${floorLabel(floor.floorCode)} 자리배치</h2>
            <p>변경안 기준 도면입니다. 이동한 사람을 호버하거나 클릭하면 원래 자리 위치를 같은 층에서 하이라이트합니다.</p></div>
          <div class="seat-hero-actions">
            <div class="seat-scenario-badge">변경안 기준</div>
            ${state.adminMode ? `<div class="seat-admin-indicator">관리자모드 활성화</div>` : ``}
          </div>
        </section>
      <section class="seat-summary-grid">
        <article class="kpi-card"><div class="kpi-label">선택 층</div><div class="kpi-value">${floorLabel(floor.floorCode)}</div></article>
        <article class="kpi-card"><div class="kpi-label">좌석 수</div><div class="kpi-value">${fmt(stats.totalSeats)}</div></article>
        <article class="kpi-card"><div class="kpi-label">배치 인원</div><div class="kpi-value">${fmt(stats.occupiedSeats)}</div><div class="kpi-sub">변경안 기준</div></article>
        <article class="kpi-card"><div class="kpi-label">이동 인원</div><div class="kpi-value">${fmt(stats.movedSeats)}</div></article>
      </section>
      <section class="seat-layout-grid">
          <aside class="seat-stack-panel panel"><div class="panel-head"><h3>층 선택</h3></div><div class="floor-stack">${renderFloorStack()}</div>${renderAdminPanel(floor)}</aside>
        <div class="seat-main-column">
            <div class="seat-detail-card">
              <div class="seat-detail-head">
                <div><p class="eyebrow">Floor Plan</p><h2>${floorLabel(floor.floorCode)} 도면</h2></div>
                <div class="seat-head-actions">
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
            <div class="seat-board-shell">
              <div class="seat-board-zoom" style="--seat-zoom:${state.zoom};">
                ${renderFloorSVG(floor)}
              </div>
            </div>
          </div>
        </div>
      </section>`;

    seatView.querySelectorAll("[data-floor]").forEach(b=>b.addEventListener("click",()=>{state.floorCode=b.dataset.floor;renderSeatView()}));
    const adminToggle = seatView.querySelector("#seatAdminToggle");
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

      svg.addEventListener("mousemove",e=>{
        const g=e.target.closest(".sv-seat");
        if(!g){tip.classList.remove("visible");return}
        const c=g.dataset.code||"",p=g.dataset.person||"",d=g.dataset.dept||"";
        const originSeat = g.dataset.originSeat || "";
        const originFloor = g.dataset.originFloor || "";
        const originText = originFloor
          ? (originSeat && originFloor === floor.floorCode ? `원래 자리 ${originSeat}` : `원래 ${floorLabel(originFloor)}`)
          : "";
        tip.innerHTML=p?`<strong>${c}</strong><span class="sv-tt-name">${esc(p)}</span>${d?`<span class="sv-tt-dept">${esc(d)}</span>`:""}${originText?`<span class="sv-tt-origin">${esc(originText)}</span>`:""}`:`<strong>${c}</strong><span class="sv-tt-empty">미배치</span>`;
        tip.classList.add("visible");
        const shell=seatView.querySelector(".seat-board-shell"),r=shell.getBoundingClientRect();
        tip.style.left=(e.clientX-r.left+14)+"px";tip.style.top=(e.clientY-r.top-10)+"px";
        if (state.adminMode) {
          applyAdminSelection();
        } else {
          applyOriginHighlight(g);
        }
      });
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

  /* ── View switch ────────────────────────────────── */
  function syncView() {
    const show=state.activeView==="seat";
    orgView.hidden=show;seatView.hidden=!show;
    switchEl.querySelectorAll(".view-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===state.activeView));
    if(show) renderSeatView();
  }
  switchEl.querySelectorAll(".view-tab").forEach(b=>b.addEventListener("click",()=>{state.activeView=b.dataset.view||"org";syncView()}));
  syncView();
})();
