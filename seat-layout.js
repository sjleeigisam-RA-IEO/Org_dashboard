(function () {
  const seatData = window.SEAT_LAYOUT_DATA;
  const overlays = window.SEAT_LAYOUT_OVERLAYS || { zones: [], externalSeatCodes: {} };

  if (!seatData || !Array.isArray(seatData.floors) || !seatData.floors.length) {
    return;
  }

  const orgView = document.getElementById("orgDashboardView");
  const seatView = document.getElementById("seatLayoutView");
  const switchEl = document.getElementById("viewSwitch");
  if (!orgView || !seatView || !switchEl) {
    return;
  }

  const FLOOR_ORDER = ["13F", "12F", "2F"].filter((floorCode) =>
    seatData.floors.some((floor) => floor.floorCode === floorCode)
  );

  const state = {
    activeView: "org",
    floorCode: FLOOR_ORDER[0] || seatData.floors[0].floorCode,
    scenario: "current",
  };

  const FLOOR_ART = {
    "13F": {
      clipPath: "polygon(34% 7%, 100% 7%, 100% 100%, 0 100%, 0 30%, 18% 30%, 18% 21%, 34% 21%)",
      backgroundBlocks: [
        { kind: "common", label: "포커스 라운지", x: 83, y: 6, w: 15, h: 32 },
        { kind: "support", label: "회의·지원", x: 4, y: 32, w: 18, h: 34 },
        { kind: "core", label: "엘리베이터 코어", x: 42, y: 44, w: 28, h: 10 },
        { kind: "core", label: "계단 코어", x: 42, y: 60, w: 28, h: 10 },
        { kind: "meeting", label: "중앙 대회의실", x: 46, y: 76, w: 22, h: 16 },
        { kind: "meeting", label: "하부 회의실 존", x: 4, y: 84, w: 72, h: 14 },
        { kind: "common", label: "하부 라운지", x: 79, y: 56, w: 19, h: 42 },
      ],
      seatBlocks: [
        { x: 38, y: 8, w: 52, h: 32, columns: 11, match: (seat) => seat.x >= 12 && seat.y <= 13 },
        { x: 4, y: 34, w: 18, h: 28, columns: 3, match: (seat) => seat.x <= 5 && seat.y >= 13 && seat.y <= 19 },
        { x: 42, y: 36, w: 28, h: 6, columns: 4, match: (seat) => seat.x >= 17 && seat.x <= 20 && seat.y === 17 },
        { x: 4, y: 74, w: 22, h: 22, columns: 3, match: (seat) => seat.x <= 4 && seat.y >= 22 },
      ],
    },
    "12F": {
      clipPath: "polygon(35% 7%, 100% 7%, 100% 100%, 0 100%, 0 30%, 17% 30%, 17% 23%, 35% 23%)",
      backgroundBlocks: [
        { kind: "common", label: "타운홀", x: 4, y: 24, w: 14, h: 34 },
        { kind: "core", label: "엘리베이터 코어", x: 42, y: 42, w: 28, h: 10 },
        { kind: "core", label: "계단 코어", x: 42, y: 58, w: 28, h: 10 },
        { kind: "support", label: "회의·지원", x: 74, y: 36, w: 18, h: 24 },
        { kind: "common", label: "우측 라운지", x: 88, y: 58, w: 10, h: 32 },
      ],
      seatBlocks: [
        { x: 38, y: 8, w: 56, h: 30, columns: 12, match: (seat) => seat.y >= 6 && seat.y <= 14 && seat.x >= 12 },
        { x: 42, y: 34, w: 30, h: 6, columns: 7, match: (seat) => seat.y === 19 },
        { x: 6, y: 60, w: 16, h: 18, columns: 3, match: (seat) => seat.x <= 6 && seat.y >= 26 && seat.y <= 31 },
        { x: 76, y: 60, w: 18, h: 18, columns: 5, match: (seat) => seat.x >= 29 && seat.x <= 35 && seat.y >= 33 && seat.y <= 38 },
        { x: 34, y: 76, w: 46, h: 20, columns: 11, match: (seat) => seat.y >= 39 },
      ],
    },
    "2F": {
      clipPath: "polygon(35% 7%, 100% 7%, 100% 100%, 0 100%, 0 32%, 18% 32%, 18% 22%, 35% 22%)",
      backgroundBlocks: [
        { kind: "meeting", label: "좌측 회의실 존", x: 4, y: 26, w: 14, h: 42 },
        { kind: "support", label: "지원 공간", x: 22, y: 36, w: 14, h: 16 },
        { kind: "core", label: "엘리베이터 코어", x: 42, y: 38, w: 32, h: 10 },
        { kind: "core", label: "계단 코어", x: 42, y: 56, w: 32, h: 10 },
        { kind: "common", label: "라운지", x: 78, y: 32, w: 16, h: 42 },
      ],
      seatBlocks: [
        { x: 42, y: 10, w: 48, h: 24, columns: 11, match: (seat) => seat.y >= 6 && seat.y <= 12 },
        { x: 42, y: 48, w: 24, h: 6, columns: 4, match: (seat) => seat.y === 18 },
        { x: 6, y: 68, w: 12, h: 10, columns: 3, match: (seat) => seat.y >= 33 && seat.y <= 35 },
        { x: 28, y: 78, w: 58, h: 18, columns: 16, match: (seat) => seat.y >= 37 },
      ],
    },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmt(value) {
    return new Intl.NumberFormat("ko-KR").format(value);
  }

  function formatFloorLabel(floorCode) {
    return floorCode.replace("F", "층");
  }

  function getFloor(floorCode) {
    return seatData.floors.find((floor) => floor.floorCode === floorCode) || seatData.floors[0];
  }

  function getAssignments(floor, scenario) {
    return floor.scenarios[scenario]?.assignments || {};
  }

  function getMovedPeople(floor) {
    const currentAssignments = getAssignments(floor, "current");
    const planAssignments = getAssignments(floor, "plan");
    const currentByName = new Map();
    const planByName = new Map();

    Object.entries(currentAssignments).forEach(([seatCode, info]) => {
      if (info.personName) currentByName.set(info.personName, seatCode);
    });

    Object.entries(planAssignments).forEach(([seatCode, info]) => {
      if (info.personName) planByName.set(info.personName, seatCode);
    });

    const moved = [];
    currentByName.forEach((fromSeat, name) => {
      const toSeat = planByName.get(name);
      if (toSeat && toSeat !== fromSeat) {
        moved.push({ name, fromSeat, toSeat });
      }
    });
    return moved;
  }

  function buildSeatStats(floor) {
    const assignments = getAssignments(floor, state.scenario);
    return {
      totalSeats: floor.seatDefs.length,
      occupiedSeats: Object.values(assignments).filter((info) => info.personName).length,
      movedSeats: getMovedPeople(floor).length,
    };
  }

  function renderFloorStack() {
    return FLOOR_ORDER.map((floorCode, index) => {
      const floor = getFloor(floorCode);
      const isActive = floorCode === state.floorCode;
      return `
        <button class="floor-stack-card ${isActive ? "active" : ""}" type="button" data-floor="${floorCode}" style="--stack-index:${index};">
          <div class="floor-stack-meta">
            <span class="floor-stack-label">${formatFloorLabel(floorCode)}</span>
            <span class="floor-stack-count">좌석 ${fmt(floor.seatDefs.length)}</span>
          </div>
          <div class="floor-mini-board floor-mini-board-${floorCode.toLowerCase()}"></div>
        </button>
      `;
    }).join("");
  }

  function renderLegend() {
    return `
      <div class="seat-legend">
        <span><i class="legend-chip chip-seat"></i>좌석 타일</span>
        <span><i class="legend-chip chip-office"></i>업무 구역</span>
        <span><i class="legend-chip chip-meeting"></i>회의·지원</span>
        <span><i class="legend-chip chip-common"></i>공용 공간</span>
      </div>
    `;
  }

  function sortSeats(seats) {
    return [...seats].sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.seatLabel.localeCompare(b.seatLabel));
  }

  function renderSeatTiles(floor, block) {
    const assignments = getAssignments(floor, state.scenario);
    const externalSeats = new Set(overlays.externalSeatCodes?.[floor.floorCode] || []);
    const seats = sortSeats(floor.seatDefs.filter(block.match));
    if (!seats.length) return "";

    return `
      <div class="plan-seat-grid" style="--seat-cols:${block.columns};">
        ${seats
          .map((seat) => {
            const title = `${seat.seatCode}${assignments[seat.seatCode]?.personName ? ` | ${assignments[seat.seatCode].personName}` : ""}`;
            return `
              <div class="seat-tile ${externalSeats.has(seat.seatCode) ? "external" : ""}" title="${escapeHtml(title)}">
                ${escapeHtml(seat.seatLabel)}
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderBackgroundBlocks(art) {
    return art.backgroundBlocks
      .map(
        (block) => `
          <section class="plan-block plan-block-${block.kind}" style="left:${block.x}%;top:${block.y}%;width:${block.w}%;height:${block.h}%;"><div class="plan-block-label">${escapeHtml(block.label)}</div></section>
        `
      )
      .join("");
  }

  function renderSeatBlocks(floor, art) {
    return art.seatBlocks
      .map(
        (block) => `
          <section class="plan-block plan-block-seats" style="left:${block.x}%;top:${block.y}%;width:${block.w}%;height:${block.h}%;">
            ${renderSeatTiles(floor, block)}
          </section>
        `
      )
      .join("");
  }

  function renderSeatDetail(floor) {
    const art = FLOOR_ART[floor.floorCode] || FLOOR_ART["12F"];
    return `
      <div class="seat-detail-card">
        <div class="seat-detail-head">
          <div>
            <p class="eyebrow">Seat Base</p>
            <h2>${formatFloorLabel(floor.floorCode)} 자리배치 베이스</h2>
            <p class="seat-detail-copy">좌석 블록에는 임시 이름을 붙이지 않고, 실제 시설명만 남긴 상태입니다. 이후 구역·조직·사람 정보는 이 좌석 코드 위에 맵핑합니다.</p>
          </div>
          ${renderLegend()}
        </div>
        <div class="seat-board-shell">
          <div class="plan-board" style="clip-path:${art.clipPath};">
            ${renderBackgroundBlocks(art)}
            ${renderSeatBlocks(floor, art)}
          </div>
        </div>
      </div>
    `;
  }

  function renderMoveList(floor) {
    const moved = getMovedPeople(floor);
    if (!moved.length) {
      return `<div class="seat-empty">이 층에서는 현재안과 변경안 사이에 좌석 이동 인원이 아직 없습니다.</div>`;
    }

    return moved
      .slice(0, 18)
      .map(
        (item) => `
          <div class="move-row">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.fromSeat)} → ${escapeHtml(item.toSeat)}</span>
          </div>
        `
      )
      .join("");
  }

  function renderSeatView() {
    const floor = getFloor(state.floorCode);
    const stats = buildSeatStats(floor);

    seatView.innerHTML = `
      <section class="seat-hero panel">
        <div class="seat-hero-copy">
          <p class="eyebrow">Seat Layout</p>
          <h2>층계 좌석 베이스</h2>
          <p>좌석은 불변 코드 기준으로 유지하고, 사람·조직·구역 정보는 그 위에 덧입히는 구조로 가져갑니다. 현재는 실제 시설명만 남기고 좌석 구역 임시명은 제거한 상태입니다.</p>
        </div>
        <div class="seat-scenario-switch">
          <button class="scenario-tab ${state.scenario === "current" ? "active" : ""}" type="button" data-scenario="current">현재안</button>
          <button class="scenario-tab ${state.scenario === "plan" ? "active" : ""}" type="button" data-scenario="plan">변경안</button>
        </div>
      </section>

      <section class="seat-summary-grid">
        <article class="kpi-card">
          <div class="kpi-label">선택 층</div>
          <div class="kpi-value">${formatFloorLabel(floor.floorCode)}</div>
          <div class="kpi-sub">레이어에서 즉시 전환</div>
        </article>
        <article class="kpi-card">
          <div class="kpi-label">좌석 수</div>
          <div class="kpi-value">${fmt(stats.totalSeats)}</div>
          <div class="kpi-sub">불변 좌석코드 기준</div>
        </article>
        <article class="kpi-card">
          <div class="kpi-label">배치 인원</div>
          <div class="kpi-value">${fmt(stats.occupiedSeats)}</div>
          <div class="kpi-sub">${state.scenario === "current" ? "현재안" : "변경안"} 기준</div>
        </article>
        <article class="kpi-card">
          <div class="kpi-label">이동 인원</div>
          <div class="kpi-value">${fmt(stats.movedSeats)}</div>
          <div class="kpi-sub">현재안과 변경안 비교</div>
        </article>
      </section>

      <section class="seat-layout-grid">
        <aside class="seat-stack-panel panel">
          <div class="panel-head">
            <h3>층 레이어</h3>
            <p>13층부터 순서대로 선택</p>
          </div>
          <div class="floor-stack">${renderFloorStack()}</div>
        </aside>
        <div class="seat-main-column">
          ${renderSeatDetail(floor)}
          <article class="panel seat-move-panel">
            <div class="panel-head">
              <h3>이동 요약</h3>
              <p>현재안과 변경안 사이에서 좌석이 달라진 인원</p>
            </div>
            <div class="move-list">${renderMoveList(floor)}</div>
          </article>
        </div>
      </section>
    `;

    seatView.querySelectorAll("[data-floor]").forEach((button) => {
      button.addEventListener("click", () => {
        state.floorCode = button.getAttribute("data-floor") || state.floorCode;
        renderSeatView();
      });
    });

    seatView.querySelectorAll("[data-scenario]").forEach((button) => {
      button.addEventListener("click", () => {
        state.scenario = button.getAttribute("data-scenario") || state.scenario;
        renderSeatView();
      });
    });
  }

  function syncView() {
    const showSeat = state.activeView === "seat";
    orgView.hidden = showSeat;
    seatView.hidden = !showSeat;
    switchEl.querySelectorAll(".view-tab").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-view") === state.activeView);
    });
    if (showSeat) {
      renderSeatView();
    }
  }

  switchEl.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.getAttribute("data-view") || "org";
      syncView();
    });
  });

  syncView();
})();
