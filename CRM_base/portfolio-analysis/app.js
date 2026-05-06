var debounceTimer;
var currentView = 'list';
var currentTab = 'all';

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
