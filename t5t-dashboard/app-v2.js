const COLORS = {
  taskTypes: { "운용/관리": "#284b63", "신규검토": "#b85c38", "프로젝트": "#5b7961", "펀드·투자자": "#c98a58", "리스크·법무": "#3e5a7a", "내부·기타": "#8e95a3" },
  issues: { "딜 진행": "#3B82F6", "금융 구조": "#8B5CF6", "인허가/행정": "#F59E0B", "운용/관리": "#10B981", "리스크·법무": "#EF4444", "투자자 대응": "#06B6D4", "신규검토": "#6B7280", "기타": "#8e95a3" },
  stakeholders: ["#284b63", "#b85c38", "#5b7961", "#c98a58", "#3e5a7a", "#06B6D4", "#8e95a3", "#9aa4b2"],
};

let dashData = null;
let uiState = {
  intelligencePeriod: "all",
  selectedYear: "all",
  stakeholderDrilldown: null,
  insight: { kind: null, key: null, groupBy: "none" }
};

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupModals();
  setupPeriodToggle();
  setupYearFilter();
  setupStakeholderBack();
  setupInsightGrouping();
  loadData();
});

async function loadData() {
  const loadingEl = document.getElementById("loading");
  try {
    dashData = await T5TService.fetchDashboardData();
    if (loadingEl) loadingEl.style.display = "none";
    document.getElementById("view-overview").classList.add("active");
    renderOverview();
    updateSyncInfo();
  } catch (error) {
    console.error(error);
    if (loadingEl) loadingEl.innerHTML = `<div style="color:red; padding:20px;">데이터 로드 실패: ${error.message}</div>`;
  }
}

function setupYearFilter() {
    document.querySelectorAll("#year-filter-tabs .period-toggle-btn").forEach(btn => {
        btn.onclick = () => {
            const currentYear = new Date().getFullYear().toString();
            uiState.selectedYear = btn.dataset.year;
            uiState.stakeholderDrilldown = null;
            
            // 과거 연도 선택 시 '이번 달/이번 주' 토글을 숨기고 '전체'로 리셋
            const periodTabs = document.getElementById("intelligence-period-tabs");
            if (uiState.selectedYear !== "all" && uiState.selectedYear !== currentYear) {
                uiState.intelligencePeriod = "all";
                if (periodTabs) periodTabs.style.visibility = "hidden"; // 과거 연도면 숨김
                document.querySelectorAll("#intelligence-period-tabs .period-toggle-btn").forEach(i => {
                    i.classList.remove("active");
                    if (i.dataset.period === "all") i.classList.add("active");
                });
            } else {
                if (periodTabs) periodTabs.style.visibility = "visible"; // 현재/전체 연도면 보임
            }

            document.querySelectorAll("#year-filter-tabs .period-toggle-btn").forEach(i => i.classList.remove("active"));
            btn.classList.add("active");
            dashData = T5TService.aggregateData(T5TService.rawItems, uiState.selectedYear === "all" ? null : uiState.selectedYear);
            renderOverview();
        };
    });
}

function updateSyncInfo() {
  const meta = dashData?.sync_meta;
  if (!meta) return;
  document.getElementById("sync-time").textContent = `${new Date(meta.synced_at).toLocaleString()} SQL 실시간 연동 중`;
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
  if (summary) summary.textContent = `${uiState.selectedYear === "all" ? "" : uiState.selectedYear + "년 "}${period.label} 핵심 요약`;
  if (count) count.textContent = `${period.total_logs}건`;
}

function renderIssueModule(period) {
  const issueBars = document.getElementById("issue-bars");
  const keywordWrap = document.getElementById("issue-keywords");
  const badge = document.getElementById("issue-total-badge");
  
  if (badge) badge.textContent = `${period.total_logs}건 분석`;

  const validCats = period.issue_categories.filter(c => c.count > 0);
  const maxCount = Math.max(...validCats.map(c => c.count), 1);

  issueBars.innerHTML = validCats.map(c => `
    <div class="issue-bar-row" style="cursor:pointer" onclick="openInsightModal('issue', '${c.name}')">
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

  keywordWrap.innerHTML = period.top_keywords.slice(0, 15).map(k => `
    <button class="keyword-chip" onclick="openInsightModal('keyword', '${k.keyword}')">
      <strong style="color:${COLORS.issues[k.category] || "#6B7280"}">#${k.keyword}</strong>
      <small>${k.count}</small>
    </button>
  `).join("");
}

function renderStakeholderPanel(period) {
    const shData = T5TService.buildStakeholderChartData(period, uiState.stakeholderDrilldown, uiState.stakeholderSubDrilldown);
    T5TCharts.renderStakeholder(shData, COLORS, (item) => {
        if (shData.mode === "types") {
            uiState.stakeholderDrilldown = item.name;
            uiState.stakeholderSubDrilldown = null; // 상위 유형 클릭 시 하위 필터 반드시 초기화
        } else if (shData.mode === "subs") {
            uiState.stakeholderSubDrilldown = item.name;
        } else {
            openCrmModal(item.name, uiState.stakeholderDrilldown);
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
      
      listContainer.innerHTML = items.length ? items.map(s => {
          const exposureText = s.exposure > 0 ? `<div style="font-size:11px; color:var(--accent); font-weight:bold; margin-top:2px;">${(s.exposure/1e8).toLocaleString()}억 (${s.fund_count}건)</div>` : "";
          return `
            <div class="stakeholder-row" onclick="openCrmModal('${s.name}', '${s.type}')" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid rgba(0,0,0,0.05); cursor:pointer;">
                <div class="stakeholder-main">
                    <div class="stakeholder-name" style="font-weight:700; font-size:13px;">${s.name}</div>
                    ${exposureText}
                </div>
                <div class="stakeholder-count" style="font-weight:800; color:var(--muted); font-size:12px;">${s.count} log</div>
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
      <div class="modal-item" style="border-left: 3px solid var(--accent); padding-left: 12px; margin-bottom: 20px; background:rgba(0,0,0,0.01); padding:15px; border-radius:0 8px 8px 0;">
        <div class="modal-item-name" style="font-size:11px; color:var(--muted); margin-bottom:8px; display:flex; justify-content:space-between;">
          <span>${l.work_date} | ${l.writer_name}</span>
          <span style="color:var(--accent); font-weight:bold;">${l.task_type || ""}</span>
        </div>
        <div style="font-weight:700; font-size:14px; color:var(--accent-2); margin-bottom:8px;">${l.classification_summary || "요약 없음"}</div>
        <div class="modal-item-meta" style="font-size:13px; color:var(--text); line-height:1.6; white-space:pre-wrap; background:#fff; padding:10px; border-radius:4px; border:1px solid rgba(0,0,0,0.05);">${l.raw_text || ""}</div>
      </div>
    `).join("");
    
    document.getElementById("projectModal").hidden = false;
}

function renderPulse() {
  const container = document.getElementById("pulse-timeline");
  if (!container) return;

  const allWeeks = dashData.sorted_weeks; // YYYY-Www
  
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
          label = `<span style="position:absolute; font-size:10px; color:var(--accent); font-weight:900; top:-12px; white-space:nowrap;">${year}년</span>`;
          lastYear = year;
          lastMonth = month;
          label += `<span style="position:absolute; font-size:10px; color:var(--muted); font-weight:700;">${month}</span>`;
      } else if (month !== lastMonth) {
          label = `<span style="position:absolute; font-size:10px; color:var(--muted); font-weight:700;">${month}</span>`;
          lastMonth = month;
      }
      return `<div style="width:13px; flex-shrink:0; position:relative; height:15px;">${label}</div>`;
  }).join("");

  const headerRow = `
    <div style="display:flex; padding:20px 12px 5px 12px; border-bottom:1px solid rgba(0,0,0,0.05); background:rgba(0,0,0,0.02);">
      <div style="width:230px; flex-shrink:0; font-size:11px; color:var(--muted); font-weight:700;">프로젝트명</div>
      <div style="display:flex; align-items:center; gap:3px;">${headerHtml}</div>
    </div>
  `;

  const rowsHtml = dashData.pulse.slice(0, 30).map((p, i) => {
    const parentText = (p.parent && p.parent !== p.name) ? `<div style="font-size:10px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.parent}</div>` : "";
    
    const pulseHtml = allWeeks.map(week => {
      const count = p.weekly[week] || 0;
      if (count === 0) return '<div class="pulse-dot empty" style="width:13px; flex-shrink:0;"></div>';
      const size = Math.min(5 + count * 2, 11); 
      const opacity = Math.min(0.2 + count * 0.2, 1);
      return `
        <div style="width:13px; flex-shrink:0; display:flex; justify-content:center; align-items:center;">
          <div class="pulse-dot active" style="width:${size}px; height:${size}px; opacity:${opacity};"></div>
        </div>
      `;
    }).join("");

    return `
      <div class="timeline-row project-row" style="display:flex; align-items:center; cursor:pointer; border-bottom:1px solid rgba(0,0,0,0.05); padding:10px 12px; transition: background 0.2s;" onclick="openProjectModal('${p.id}')">
        <div style="width:30px; flex-shrink:0; font-size:11px; opacity:0.3; font-weight:800;">${i+1}</div>
        <div style="width:200px; flex-shrink:0; margin-right:10px;">
          <div style="font-weight:700; font-size:13px; color:var(--accent-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${p.name}">${p.name}</div>
          ${parentText}
        </div>
        <div style="display:flex; align-items:center; gap:3px; flex-grow:1; overflow:hidden;">
          ${pulseHtml}
        </div>
        <div style="width:50px; flex-shrink:0; text-align:right; color:var(--accent); font-weight:800; font-size:13px;">${p.total_mentions}</div>
      </div>
    `;
  }).join("");

  container.innerHTML = headerRow + rowsHtml;
}

function openProjectModal(id) {
  const p = dashData.pulse.find(x => x.id === id);
  if (!p) return;
  document.getElementById("projectModalTitle").textContent = p.name;
  document.getElementById("projectModalSummary").innerHTML = `총 <strong>${p.total_mentions}건</strong>의 로그가 검색되었습니다.`;
  document.getElementById("projectModalList").innerHTML = p.logs.map(l => `
    <div class="modal-item" style="border-left: 3px solid var(--accent); padding-left: 12px; margin-bottom: 20px; background:rgba(0,0,0,0.01); padding:15px; border-radius:0 8px 8px 0;">
      <div class="modal-item-name" style="font-size:11px; color:var(--muted); margin-bottom:8px; display:flex; justify-content:space-between;">
        <span>${l.work_date} | ${l.writer}</span>
        <span style="color:var(--accent); font-weight:bold;">${l.task_type}</span>
      </div>
      <div style="font-weight:700; font-size:14px; color:var(--accent-2); margin-bottom:8px;">${l.summary}</div>
      <div class="modal-item-meta" style="font-size:13px; color:var(--text); line-height:1.6; white-space:pre-wrap; background:#fff; padding:10px; border-radius:4px; border:1px solid rgba(0,0,0,0.05);">${l.raw_text || ""}</div>
    </div>
  `).join("");
  document.getElementById("projectModal").hidden = false;
}

function openInsightModal(kind, key) {
  uiState.insight = { kind, key, groupBy: "none" };
  renderInsightModalContent();
  document.getElementById("insightModal").hidden = false;
}

function renderInsightModalContent() {
    document.getElementById("insightModalTitle").textContent = uiState.insight.key;
    document.getElementById("insightModalSummary").textContent = `${uiState.insight.kind} 상세 내역입니다.`;
    document.getElementById("insightModalList").innerHTML = `<div class="empty-state">상세 로그 보기 기능 준비 중</div>`;
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
  if (b) b.onclick = () => { uiState.stakeholderDrilldown = null; renderIntelligence(); };
}

function setupInsightGrouping() {}
