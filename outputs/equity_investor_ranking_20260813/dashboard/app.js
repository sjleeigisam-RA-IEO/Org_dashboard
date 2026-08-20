(function () {
  "use strict";

  const payload = window.EQUITY_INVESTOR_DATA;
  if (!payload || !Array.isArray(payload.investors)) {
    document.body.innerHTML = "<p>대시보드 데이터를 불러오지 못했습니다.</p>";
    return;
  }

  const CLASS_ORDER = ["기관", "금융기관", "일반기업", "개인", "펀드·리츠·SPC", "미분류"];
  const state = {
    query: "",
    includeSimilar: false,
    categories: new Set(),
    minimumInvestedMillion: 0,
    paidRatio: "all",
    fundCount: "all",
    review: "all",
    quick: new Set(),
    sort: "invested-desc",
    visibleCount: 50,
    selected: new Set(),
    filtered: payload.investors.slice(),
  };

  const elements = {
    kpiCount: document.getElementById("kpiCount"),
    kpiInvested: document.getElementById("kpiInvested"),
    kpiCommitted: document.getElementById("kpiCommitted"),
    kpiRemaining: document.getElementById("kpiRemaining"),
    kpiPaidRatio: document.getElementById("kpiPaidRatio"),
    kpiReview: document.getElementById("kpiReview"),
    categoryBars: document.getElementById("categoryBars"),
    concentrationBars: document.getElementById("concentrationBars"),
    overviewNote: document.getElementById("overviewNote"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    similarToggle: document.getElementById("similarToggle"),
    categoryFilter: document.getElementById("categoryFilter"),
    minimumInvestedInput: document.getElementById("minimumInvestedInput"),
    paidRatioFilter: document.getElementById("paidRatioFilter"),
    fundCountFilter: document.getElementById("fundCountFilter"),
    reviewFilter: document.getElementById("reviewFilter"),
    activeFilterSummary: document.getElementById("activeFilterSummary"),
    resetButton: document.getElementById("resetButton"),
    resultsBody: document.getElementById("resultsBody"),
    resultsSummary: document.getElementById("resultsSummary"),
    emptyState: document.getElementById("emptyState"),
    loadMoreButton: document.getElementById("loadMoreButton"),
    downloadCsvButton: document.getElementById("downloadCsvButton"),
    detailPanel: document.getElementById("detailPanel"),
    detailBackdrop: document.getElementById("detailBackdrop"),
    detailTitle: document.getElementById("detailTitle"),
    detailContent: document.getElementById("detailContent"),
    closeDetailButton: document.getElementById("closeDetailButton"),
    compareSection: document.getElementById("compareSection"),
    compareGrid: document.getElementById("compareGrid"),
    clearCompareButton: document.getElementById("clearCompareButton"),
    compareTray: document.getElementById("compareTray"),
    compareTrayText: document.getElementById("compareTrayText"),
    openCompareButton: document.getElementById("openCompareButton"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleUpperCase("ko-KR")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/[\s()\[\]{}.,·'"_-]/g, "");
  }

  function sum(rows, key) {
    return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  }

  function formatNumber(value, maximumFractionDigits = 0) {
    return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits });
  }

  function formatMillion(won, withUnit = true) {
    const value = Number(won || 0) / 1_000_000;
    const text = formatNumber(value, 0);
    return withUnit ? `${text} 백만원` : text;
  }

  function formatPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
  }

  function rowSearchText(row) {
    return normalize([
      row.displayName,
      row.className,
      row.sourceCategories,
      row.beneficiaryTypes,
      row.classificationBasis,
      row.review,
    ].join(" "));
  }

  function matchesSearch(row) {
    const query = normalize(state.query);
    if (!query) return true;
    const haystack = rowSearchText(row);
    if (haystack.includes(query)) return true;
    if (!state.includeSimilar) return false;

    const queryTokens = query.split(" ").filter((token) => token.length >= 2);
    if (queryTokens.length && queryTokens.every((token) => haystack.includes(token))) return true;
    const compactQuery = compact(query);
    const compactName = compact(row.displayName);
    if (compactQuery.length < 2 || compactName.length < 2) return false;
    return compactName.includes(compactQuery) || compactQuery.includes(compactName);
  }

  function matchesPaidRatio(row) {
    const ratio = Number(row.paidRatio || 0);
    if (state.paidRatio === "under50") return ratio < 0.5;
    if (state.paidRatio === "50to80") return ratio >= 0.5 && ratio < 0.8;
    if (state.paidRatio === "80to100") return ratio >= 0.8 && ratio <= 1;
    if (state.paidRatio === "over100") return ratio > 1;
    return true;
  }

  function matchesFundCount(row) {
    const count = Number(row.fundCount || 0);
    if (state.fundCount === "single") return count === 1;
    if (state.fundCount === "multi") return count >= 2;
    if (state.fundCount === "tenPlus") return count >= 10;
    return true;
  }

  function matchesReview(row) {
    const hasReview = Boolean(row.review);
    const hasNegative = Number(row.remaining) < 0 || String(row.review).includes("음수금액");
    if (state.review === "review") return hasReview;
    if (state.review === "clear") return !hasReview;
    if (state.review === "negative") return hasNegative;
    return true;
  }

  function matchesQuickFilters(row) {
    if (state.quick.has("top10") && Number(row.overallRank) > 10) return false;
    if (state.quick.has("over1000") && Number(row.invested) < 1_000_000_000) return false;
    if (state.quick.has("multiFund") && Number(row.fundCount) < 2) return false;
    if (state.quick.has("negative") && Number(row.remaining) >= 0 && !String(row.review).includes("음수금액")) return false;
    if (state.quick.has("unclassified") && row.className !== "미분류") return false;
    return true;
  }

  function filterRows() {
    const minimumWon = state.minimumInvestedMillion * 1_000_000;
    return payload.investors.filter((row) => (
      matchesSearch(row)
      && (!state.categories.size || state.categories.has(row.className))
      && Number(row.invested) >= minimumWon
      && matchesPaidRatio(row)
      && matchesFundCount(row)
      && matchesReview(row)
      && matchesQuickFilters(row)
    ));
  }

  function sortRows(rows) {
    const [key, direction] = state.sort.split("-");
    const multiplier = direction === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      if (key === "displayName") {
        return a.displayName.localeCompare(b.displayName, "ko") * multiplier;
      }
      const difference = Number(a[key] || 0) - Number(b[key] || 0);
      return (difference * multiplier) || a.displayName.localeCompare(b.displayName, "ko");
    });
  }

  function renderCategoryFilter() {
    const buttons = ["전체", ...CLASS_ORDER].map((className) => {
      const active = className === "전체" ? !state.categories.size : state.categories.has(className);
      const count = className === "전체"
        ? payload.investors.length
        : payload.investors.filter((row) => row.className === className).length;
      return `<button type="button" class="${active ? "active" : ""}" data-category="${escapeHtml(className)}">${escapeHtml(className)} ${formatNumber(count)}</button>`;
    });
    elements.categoryFilter.innerHTML = buttons.join("");
  }

  function renderKpis(rows) {
    const committed = sum(rows, "committed");
    const invested = sum(rows, "invested");
    const remaining = sum(rows, "remaining");
    elements.kpiCount.textContent = `${formatNumber(rows.length)}명`;
    elements.kpiInvested.innerHTML = `${formatMillion(invested, false)}<small>백만원</small>`;
    elements.kpiCommitted.innerHTML = `${formatMillion(committed, false)}<small>백만원</small>`;
    elements.kpiRemaining.innerHTML = `${formatMillion(remaining, false)}<small>백만원</small>`;
    elements.kpiPaidRatio.textContent = committed ? formatPercent(invested / committed) : "-";
    elements.kpiReview.textContent = `${formatNumber(rows.filter((row) => row.review).length)}명`;
  }

  function renderCategoryBars(rows) {
    const total = sum(rows, "invested");
    elements.categoryBars.innerHTML = CLASS_ORDER.map((className) => {
      const amount = sum(rows.filter((row) => row.className === className), "invested");
      const share = total ? amount / total : 0;
      return `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(className)}</span>
          <span class="bar-track"><span class="bar-fill ${className === "미분류" ? "unclassified" : ""}" style="width:${Math.max(0, share * 100).toFixed(2)}%"></span></span>
          <span class="bar-value">${formatMillion(amount)} · ${formatPercent(share)}</span>
        </div>`;
    }).join("");
  }

  function renderConcentration(rows) {
    const sorted = rows.slice().sort((a, b) => b.invested - a.invested);
    const total = sum(sorted, "invested");
    const entries = [5, 10, 20].map((count) => {
      const amount = sum(sorted.slice(0, count), "invested");
      return { label: `상위 ${count}`, share: total ? amount / total : 0, amount };
    });
    elements.concentrationBars.innerHTML = entries.map((entry) => `
      <div class="bar-row">
        <span class="bar-label">${entry.label}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(entry.share * 100).toFixed(2)}%"></span></span>
        <span class="bar-value">${formatPercent(entry.share)} · ${formatMillion(entry.amount)}</span>
      </div>`).join("");
    elements.overviewNote.textContent = rows.length === payload.investors.length
      ? "전체 446명 기준"
      : `현재 조회 ${formatNumber(rows.length)}명 기준`;
  }

  function reviewBadge(row) {
    if (!row.review) return '<span class="status-badge">정상</span>';
    const negative = Number(row.remaining) < 0 || row.review.includes("음수금액");
    return `<span class="status-badge ${negative ? "negative" : "review"}">${negative ? "금액 검토" : "검토"}</span>`;
  }

  function renderTable(rows) {
    const visibleRows = rows.slice(0, state.visibleCount);
    const totalInvested = sum(payload.investors, "invested");
    elements.resultsBody.innerHTML = visibleRows.map((row) => `
      <tr data-id="${escapeHtml(row.id)}" tabindex="0" aria-label="${escapeHtml(row.displayName)} 상세 열기">
        <td><input class="row-checkbox" type="checkbox" data-select-id="${escapeHtml(row.id)}" aria-label="${escapeHtml(row.displayName)} 비교 선택" ${state.selected.has(row.id) ? "checked" : ""}></td>
        <td>${formatNumber(row.overallRank)}</td>
        <td class="investor-name">${escapeHtml(row.displayName)}</td>
        <td><span class="category-badge ${row.className === "미분류" ? "unclassified" : ""}">${escapeHtml(row.className)}</span></td>
        <td class="numeric">${formatMillion(row.invested, false)}</td>
        <td class="numeric">${formatPercent(totalInvested ? row.invested / totalInvested : 0)}</td>
        <td class="numeric">${formatMillion(row.remaining, false)}</td>
        <td class="numeric">${formatPercent(row.paidRatio)}</td>
        <td class="numeric">${formatNumber(row.fundCount)}</td>
        <td>${reviewBadge(row)}</td>
      </tr>`).join("");

    elements.emptyState.hidden = rows.length !== 0;
    elements.loadMoreButton.hidden = rows.length <= state.visibleCount;
    elements.loadMoreButton.textContent = `${formatNumber(Math.min(50, rows.length - state.visibleCount))}개 더 보기`;

    elements.resultsBody.querySelectorAll("tr").forEach((rowElement) => {
      rowElement.addEventListener("click", (event) => {
        if (event.target.closest("input")) return;
        openDetail(rowElement.dataset.id);
      });
      rowElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail(rowElement.dataset.id);
        }
      });
    });

    elements.resultsBody.querySelectorAll("[data-select-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => toggleSelection(checkbox.dataset.selectId, checkbox.checked));
    });
  }

  function renderResultSummary(rows) {
    const invested = sum(rows, "invested");
    const committed = sum(rows, "committed");
    elements.resultsSummary.textContent = `${formatNumber(rows.length)}명 · 투입 ${formatMillion(invested)} · 약정 ${formatMillion(committed)}`;

    const filters = [];
    if (state.query) filters.push(`검색 “${state.query}”${state.includeSimilar ? " + 유사명" : ""}`);
    if (state.categories.size) filters.push(`분류 ${[...state.categories].join(", ")}`);
    if (state.minimumInvestedMillion) filters.push(`${formatNumber(state.minimumInvestedMillion)} 백만원 이상`);
    if (state.paidRatio !== "all") filters.push("납입률 조건");
    if (state.fundCount !== "all") filters.push("연결펀드 조건");
    if (state.review !== "all") filters.push("검토 상태 조건");
    if (state.quick.size) filters.push(`빠른 필터 ${[...state.quick].length}개`);
    elements.activeFilterSummary.textContent = filters.length
      ? `${filters.join(" · ")} 적용 중`
      : "전체 투자자 446명을 표시하고 있습니다.";
  }

  function openDetail(id) {
    const row = payload.investors.find((item) => item.id === id);
    if (!row) return;
    const totalInvested = sum(payload.investors, "invested");
    elements.detailTitle.textContent = row.displayName;
    elements.detailContent.innerHTML = `
      <div class="detail-metrics">
        <div><span>전체 순위</span><strong>${formatNumber(row.overallRank)}위</strong></div>
        <div><span>분류 내 순위</span><strong>${formatNumber(row.classRank)}위</strong></div>
        <div><span>투입금액</span><strong>${formatMillion(row.invested)}</strong></div>
        <div><span>전체 비중</span><strong>${formatPercent(totalInvested ? row.invested / totalInvested : 0)}</strong></div>
        <div><span>총 약정금액</span><strong>${formatMillion(row.committed)}</strong></div>
        <div><span>잔여약정</span><strong>${formatMillion(row.remaining)}</strong></div>
        <div><span>납입률</span><strong>${formatPercent(row.paidRatio)}</strong></div>
        <div><span>연결 펀드</span><strong>${formatNumber(row.fundCount)}개</strong></div>
      </div>
      <section class="detail-section">
        <h3>분류 정보</h3>
        <dl class="detail-list">
          <div><dt>대분류</dt><dd>${escapeHtml(row.className)}</dd></div>
          <div><dt>원천분류</dt><dd>${escapeHtml(row.sourceCategories)}</dd></div>
          <div><dt>수익자구분</dt><dd>${escapeHtml(row.beneficiaryTypes)}</dd></div>
          <div><dt>분류근거</dt><dd>${escapeHtml(row.classificationBasis)}</dd></div>
        </dl>
      </section>
      <section class="detail-section">
        <h3>데이터 범위</h3>
        <dl class="detail-list">
          <div><dt>익스포저 건수</dt><dd>${formatNumber(row.exposureCount)}건</dd></div>
          <div><dt>최초 기준일</dt><dd>${escapeHtml(row.minBaseDate || "-")}</dd></div>
          <div><dt>최신 기준일</dt><dd>${escapeHtml(row.maxBaseDate || "-")}</dd></div>
        </dl>
      </section>
      ${row.review ? `<div class="review-note"><strong>검토사항</strong><br>${escapeHtml(row.review)}</div>` : ""}
    `;
    elements.detailPanel.classList.add("open");
    elements.detailPanel.setAttribute("aria-hidden", "false");
    elements.detailBackdrop.hidden = false;
    elements.closeDetailButton.focus();
  }

  function closeDetail() {
    elements.detailPanel.classList.remove("open");
    elements.detailPanel.setAttribute("aria-hidden", "true");
    elements.detailBackdrop.hidden = true;
  }

  function toggleSelection(id, checked) {
    if (checked && !state.selected.has(id) && state.selected.size >= 5) {
      window.alert("비교 대상은 최대 5명까지 선택할 수 있습니다.");
      renderTable(state.filtered);
      return;
    }
    if (checked) state.selected.add(id);
    else state.selected.delete(id);
    renderCompare();
  }

  function renderCompare() {
    const selectedRows = [...state.selected]
      .map((id) => payload.investors.find((row) => row.id === id))
      .filter(Boolean);
    const visibleIds = new Set(state.filtered.map((row) => row.id));
    const outsideCount = selectedRows.filter((row) => !visibleIds.has(row.id)).length;
    elements.compareTray.hidden = !selectedRows.length;
    elements.compareTrayText.textContent = `${selectedRows.length}개 선택${outsideCount ? ` · 필터 밖 ${outsideCount}개` : ""}`;
    elements.compareSection.hidden = !selectedRows.length;
    elements.compareGrid.innerHTML = selectedRows.map((row) => `
      <article class="compare-item">
        <span class="category-badge ${row.className === "미분류" ? "unclassified" : ""}">${escapeHtml(row.className)}</span>
        <h3>${escapeHtml(row.displayName)}</h3>
        <dl>
          <div><dt>투입금액</dt><dd>${formatMillion(row.invested)}</dd></div>
          <div><dt>약정금액</dt><dd>${formatMillion(row.committed)}</dd></div>
          <div><dt>잔여약정</dt><dd>${formatMillion(row.remaining)}</dd></div>
          <div><dt>납입률</dt><dd>${formatPercent(row.paidRatio)}</dd></div>
          <div><dt>연결펀드</dt><dd>${formatNumber(row.fundCount)}개</dd></div>
        </dl>
      </article>`).join("");
  }

  function renderQuickFilters() {
    document.querySelectorAll("[data-quick]").forEach((button) => {
      button.classList.toggle("active", state.quick.has(button.dataset.quick));
    });
  }

  function render() {
    state.filtered = sortRows(filterRows());
    renderKpis(state.filtered);
    renderCategoryBars(state.filtered);
    renderConcentration(state.filtered);
    renderTable(state.filtered);
    renderResultSummary(state.filtered);
    renderCategoryFilter();
    renderQuickFilters();
    renderCompare();
  }

  function resetFilters() {
    state.query = "";
    state.includeSimilar = false;
    state.categories.clear();
    state.minimumInvestedMillion = 0;
    state.paidRatio = "all";
    state.fundCount = "all";
    state.review = "all";
    state.quick.clear();
    state.sort = "invested-desc";
    state.visibleCount = 50;
    elements.searchInput.value = "";
    elements.similarToggle.checked = false;
    elements.minimumInvestedInput.value = "";
    elements.paidRatioFilter.value = "all";
    elements.fundCountFilter.value = "all";
    elements.reviewFilter.value = "all";
    elements.sortSelect.value = "invested-desc";
    render();
  }

  function csvCell(value) {
    const text = String(value ?? "").replace(/"/g, '""');
    return `"${text}"`;
  }

  function downloadCsv() {
    const headers = [
      "전체순위", "분류내순위", "투자자명", "대분류", "원천분류", "수익자구분",
      "총약정금액(백만원)", "투입금액(백만원)", "잔여약정금액(백만원)", "납입률",
      "연결펀드수", "익스포저건수", "최초기준일", "최신기준일", "분류근거", "검토사항",
    ];
    const rows = state.filtered.map((row) => [
      row.overallRank,
      row.classRank,
      row.displayName,
      row.className,
      row.sourceCategories,
      row.beneficiaryTypes,
      Math.round(row.committed / 1_000_000),
      Math.round(row.invested / 1_000_000),
      Math.round(row.remaining / 1_000_000),
      row.paidRatio,
      row.fundCount,
      row.exposureCount,
      row.minBaseDate,
      row.maxBaseDate,
      row.classificationBasis,
      row.review,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `에쿼티_투자자_조회결과_${payload.asOfDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value.trim();
    state.visibleCount = 50;
    render();
  });
  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value;
    render();
  });
  elements.similarToggle.addEventListener("change", () => {
    state.includeSimilar = elements.similarToggle.checked;
    render();
  });
  elements.minimumInvestedInput.addEventListener("input", () => {
    state.minimumInvestedMillion = Math.max(0, Number(elements.minimumInvestedInput.value || 0));
    state.visibleCount = 50;
    render();
  });
  elements.paidRatioFilter.addEventListener("change", () => {
    state.paidRatio = elements.paidRatioFilter.value;
    state.visibleCount = 50;
    render();
  });
  elements.fundCountFilter.addEventListener("change", () => {
    state.fundCount = elements.fundCountFilter.value;
    state.visibleCount = 50;
    render();
  });
  elements.reviewFilter.addEventListener("change", () => {
    state.review = elements.reviewFilter.value;
    state.visibleCount = 50;
    render();
  });
  elements.categoryFilter.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const category = button.dataset.category;
    if (category === "전체") state.categories.clear();
    else if (state.categories.has(category)) state.categories.delete(category);
    else state.categories.add(category);
    state.visibleCount = 50;
    render();
  });
  document.querySelector(".quick-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-quick]");
    if (!button) return;
    const key = button.dataset.quick;
    if (state.quick.has(key)) state.quick.delete(key);
    else state.quick.add(key);
    state.visibleCount = 50;
    render();
  });
  elements.resetButton.addEventListener("click", resetFilters);
  elements.loadMoreButton.addEventListener("click", () => {
    state.visibleCount += 50;
    renderTable(state.filtered);
  });
  elements.downloadCsvButton.addEventListener("click", downloadCsv);
  elements.closeDetailButton.addEventListener("click", closeDetail);
  elements.detailBackdrop.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });
  elements.clearCompareButton.addEventListener("click", () => {
    state.selected.clear();
    render();
  });
  elements.openCompareButton.addEventListener("click", () => {
    elements.compareSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  render();
})();
