var debounceTimer;
var currentView = 'list';
var currentTab = 'all';
var LEFT_PANEL_WIDTH_KEY = 'ra_insight_left_panel_width_v1';
var LEFT_PANEL_MIN_WIDTH = 300;
var LEFT_PANEL_MAX_WIDTH = 460;

function setDisplay(element, value) {
  if (element) element.style.display = value;
}

function setActiveTab(tabButtons, nextTab) {
  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === nextTab);
  });
  currentTab = nextTab;
}

function showListView() {
  var listBtn = document.getElementById('listViewBtn');
  var chartBtn = document.getElementById('chartViewBtn');
  var searchControls = document.getElementById('searchViewControls');
  var analysisViewControls = document.getElementById('analysisViewControls');
  var results = document.getElementById('results');
  var analysisResults = document.getElementById('analysisResults');

  currentView = 'list';
  document.body.classList.remove('analysis-view');
  document.body.classList.add('list-view');

  if (listBtn) listBtn.classList.add('active');
  if (chartBtn) chartBtn.classList.remove('active');

  setDisplay(searchControls, 'block');
  setDisplay(analysisViewControls, 'none');
  setDisplay(results, 'flex');
  setDisplay(analysisResults, 'none');

  if (typeof renderResults === 'function') {
    renderResults();
  }
}

function showChartView() {
  var listBtn = document.getElementById('listViewBtn');
  var chartBtn = document.getElementById('chartViewBtn');
  var searchControls = document.getElementById('searchViewControls');
  var analysisViewControls = document.getElementById('analysisViewControls');
  var results = document.getElementById('results');

  currentView = 'ranking';
  document.body.classList.remove('list-view');
  document.body.classList.add('analysis-view');

  if (chartBtn) chartBtn.classList.add('active');
  if (listBtn) listBtn.classList.remove('active');

  setDisplay(searchControls, 'none');
  setDisplay(analysisViewControls, 'block');
  setDisplay(results, 'none');

  if (typeof ensureAllDataLoaded === 'function') {
    ensureAllDataLoaded().then(function () {
      if (typeof initAnalysisFilters === 'function') {
        initAnalysisFilters();
      }
      if (typeof renderAnalytics === 'function') {
        renderAnalytics();
      }
    });
  } else if (typeof renderAnalytics === 'function') {
    renderAnalytics();
  }
}

function handleCategoryTabChange(nextTab, tabButtons) {
  var results = document.getElementById('results');
  var analysisResults = document.getElementById('analysisResults');

  setActiveTab(tabButtons, nextTab);

  setDisplay(results, 'flex');
  setDisplay(analysisResults, 'none');

  if (typeof renderResults === 'function') {
    renderResults();
  }
}

function clampLeftPanelWidth(value) {
  var numeric = Number(value);
  if (!Number.isFinite(numeric)) return LEFT_PANEL_MAX_WIDTH;
  return Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(LEFT_PANEL_MAX_WIDTH, numeric));
}

function applyLeftPanelWidth(width, shouldPersist) {
  var leftPanel = document.getElementById('leftPanel');
  var resizer = document.getElementById('leftPanelResizer');
  var clamped = clampLeftPanelWidth(width);
  document.documentElement.style.setProperty('--left-panel-width', clamped + 'px');
  if (leftPanel) {
    leftPanel.classList.toggle('is-compact', clamped <= 360);
  }
  if (resizer) {
    resizer.setAttribute('aria-valuemin', String(LEFT_PANEL_MIN_WIDTH));
    resizer.setAttribute('aria-valuemax', String(LEFT_PANEL_MAX_WIDTH));
    resizer.setAttribute('aria-valuenow', String(Math.round(clamped)));
  }
  if (shouldPersist) {
    try {
      localStorage.setItem(LEFT_PANEL_WIDTH_KEY, String(Math.round(clamped)));
    } catch (e) {
      console.warn('Could not persist left panel width:', e);
    }
  }
  return clamped;
}

function initLeftPanelResize() {
  var leftPanel = document.getElementById('leftPanel');
  var resizer = document.getElementById('leftPanelResizer');
  var layout = document.querySelector('.main-layout.container');
  if (!leftPanel || !resizer || !layout) return;

  var storedWidth = null;
  try {
    storedWidth = localStorage.getItem(LEFT_PANEL_WIDTH_KEY);
  } catch (e) {
    storedWidth = null;
  }
  var currentWidth = applyLeftPanelWidth(storedWidth || LEFT_PANEL_MAX_WIDTH, false);
  var isDragging = false;

  function widthFromPointer(event) {
    var layoutRect = layout.getBoundingClientRect();
    return event.clientX - layoutRect.left;
  }

  function onPointerMove(event) {
    if (!isDragging) return;
    currentWidth = applyLeftPanelWidth(widthFromPointer(event), false);
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    document.body.classList.remove('resizing-left-panel');
    applyLeftPanelWidth(currentWidth, true);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  resizer.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    isDragging = true;
    currentWidth = widthFromPointer(event);
    document.body.classList.add('resizing-left-panel');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    currentWidth = applyLeftPanelWidth(currentWidth, false);
  });

  resizer.addEventListener('dblclick', function () {
    currentWidth = applyLeftPanelWidth(LEFT_PANEL_MAX_WIDTH, true);
  });

  resizer.addEventListener('keydown', function (event) {
    var nextWidth = currentWidth;
    if (event.key === 'ArrowLeft') nextWidth -= 24;
    else if (event.key === 'ArrowRight') nextWidth += 24;
    else if (event.key === 'Home') nextWidth = LEFT_PANEL_MIN_WIDTH;
    else if (event.key === 'End') nextWidth = LEFT_PANEL_MAX_WIDTH;
    else return;
    event.preventDefault();
    currentWidth = applyLeftPanelWidth(nextWidth, true);
  });
}

function initApp() {
  var listBtn = document.getElementById('listViewBtn');
  var chartBtn = document.getElementById('chartViewBtn');
  var searchInput = document.getElementById('searchInput');
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));

  if (listBtn) {
    listBtn.addEventListener('click', showListView);
  }

  if (chartBtn) {
    chartBtn.addEventListener('click', showChartView);
  }

  tabButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      handleCategoryTabChange(button.dataset.tab, tabButtons);
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', function (event) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (typeof performSearch === 'function') {
          performSearch(event.target.value);
        }
      }, 400);
    });
  }

  if (typeof renderBasket === 'function') {
    renderBasket();
  }

  initLeftPanelResize();

  document.body.classList.add(currentView === 'ranking' ? 'analysis-view' : 'list-view');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
