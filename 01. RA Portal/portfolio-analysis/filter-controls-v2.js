(function () {
  'use strict';

  var portfolioFrame = 0;
  var capitalFrame = 0;
  var advancedOpen = false;

  function selectedCount(menu) {
    return menu.querySelectorAll('[data-semantic-filter]:checked').length;
  }

  function decoratePortfolioFilters() {
    window.cancelAnimationFrame(portfolioFrame);
    portfolioFrame = window.requestAnimationFrame(function () {
      var grid = document.getElementById('filterGrid');
      if (!grid) return;

      grid.querySelectorAll('.semantic-filter-group').forEach(function (group) {
        var heading = group.querySelector(':scope > h3');
        var existingToggle = group.querySelector(':scope > [data-v2-advanced-filter-toggle]');
        var label = heading ? heading.textContent.trim() : (existingToggle ? '고급 조건' : '');
        var mapped = {
          '집계 기준': '투자기구 조건',
          '핵심 분류': '자산 조건',
          '조직/형태': '고급 조건'
        }[label] || label;
        if (heading && heading.textContent.trim() !== mapped) heading.textContent = mapped;
        group.classList.toggle('v2-filter-group-advanced', mapped === '고급 조건');
        if (mapped === '고급 조건') {
          group.classList.toggle('is-collapsed', !advancedOpen);
          if (!group.querySelector('[data-v2-advanced-filter-toggle]')) {
            var toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'v2-advanced-filter-toggle';
            toggle.dataset.v2AdvancedFilterToggle = 'true';
            toggle.setAttribute('aria-expanded', String(advancedOpen));
            toggle.innerHTML = '<span>고급 조건</span><b aria-hidden="true"></b>';
            toggle.addEventListener('click', function () {
              advancedOpen = !advancedOpen;
              toggle.setAttribute('aria-expanded', String(advancedOpen));
              group.classList.toggle('is-collapsed', !advancedOpen);
            });
            heading.replaceWith(toggle);
          }
        }
      });

      grid.querySelectorAll('.semantic-filter-menu').forEach(function (menu) {
        var inputs = Array.from(menu.querySelectorAll('[data-semantic-filter]'));
        menu.classList.remove(
          'v2-filter-inline',
          'v2-filter-binary',
          'v2-filter-small',
          'v2-filter-count-1',
          'v2-filter-count-2',
          'v2-filter-count-3',
          'v2-filter-count-4'
        );
        if (inputs.length <= 4 && inputs.length > 0) {
          menu.classList.add('v2-filter-inline');
          menu.classList.add('v2-filter-count-' + inputs.length);
          menu.open = true;
          if (inputs.length === 2) menu.classList.add('v2-filter-binary');
          else menu.classList.add('v2-filter-small');
        } else if (!selectedCount(menu)) {
          menu.open = false;
        }
      });

      var applyButton = document.querySelector('#analysisFilters > .search-apply-btn');
      if (applyButton) {
        applyButton.textContent = '목록 보기';
        applyButton.title = '현재 조건에 해당하는 펀드·자산 목록을 엽니다.';
      }
    });
  }

  function removeCapitalMirror(field) {
    field.classList.remove('v2-capital-segment-field');
    var mirror = field.querySelector('.v2-capital-segment');
    if (mirror) mirror.remove();
    var select = field.querySelector('select');
    if (select) {
      select.classList.remove('v2-native-select');
      if (select.dataset.v2OriginalTabindex === '__none__') select.removeAttribute('tabindex');
      else if (select.dataset.v2OriginalTabindex != null) select.setAttribute('tabindex', select.dataset.v2OriginalTabindex);
      if (select.dataset.v2OriginalAriaHidden === '__none__') select.removeAttribute('aria-hidden');
      else if (select.dataset.v2OriginalAriaHidden != null) select.setAttribute('aria-hidden', select.dataset.v2OriginalAriaHidden);
      delete select.dataset.v2OriginalTabindex;
      delete select.dataset.v2OriginalAriaHidden;
    }
  }

  function syncCapitalMirror(select, mirror) {
    mirror.querySelectorAll('button').forEach(function (button) {
      var active = button.dataset.value === select.value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function buildCapitalMirror(field, select) {
    var options = Array.from(select.options).filter(function (option) {
      return !option.disabled;
    });
    var concreteOptions = options.filter(function (option) { return option.value !== ''; });
    if (concreteOptions.length < 1 || concreteOptions.length > 3) {
      removeCapitalMirror(field);
      return;
    }

    var signature = options.map(function (option) {
      return option.value + ':' + option.textContent;
    }).join('|');
    var mirror = field.querySelector('.v2-capital-segment');
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.className = 'v2-capital-segment';
      mirror.setAttribute('role', 'group');
      field.appendChild(mirror);
    }
    if (select.dataset.v2OriginalTabindex == null) {
      select.dataset.v2OriginalTabindex = select.hasAttribute('tabindex') ? select.getAttribute('tabindex') : '__none__';
      select.dataset.v2OriginalAriaHidden = select.hasAttribute('aria-hidden') ? select.getAttribute('aria-hidden') : '__none__';
    }
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    var fieldLabel = field.querySelector('label, .capital-filter-label');
    mirror.setAttribute('aria-label', select.getAttribute('aria-label') || (fieldLabel ? fieldLabel.textContent.trim() : '필터 선택'));
    field.classList.add('v2-capital-segment-field');
    select.classList.add('v2-native-select');
    if (mirror.dataset.signature !== signature) {
      mirror.dataset.signature = signature;
      mirror.innerHTML = '';
      options.forEach(function (option) {
        var button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = option.value;
        button.textContent = option.value === '' ? '전체' : option.textContent;
        button.addEventListener('click', function () {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncCapitalMirror(select, mirror);
        });
        mirror.appendChild(button);
      });
    }
    syncCapitalMirror(select, mirror);
  }

  function decorateCapitalFilters() {
    window.cancelAnimationFrame(capitalFrame);
    capitalFrame = window.requestAnimationFrame(function () {
      var form = document.getElementById('capitalRelationshipFilterForm');
      if (!form) return;
      form.querySelectorAll('.capital-filter-field select').forEach(function (select) {
        buildCapitalMirror(select.closest('.capital-filter-field'), select);
      });
      var submit = form.querySelector('[type="submit"]');
      if (submit) {
        submit.textContent = '목록 보기';
        submit.title = '현재 조건에 해당하는 투자자·대주 목록을 엽니다.';
      }
    });
  }

  function installObservers() {
    var grid = document.getElementById('filterGrid');
    if (grid) {
      new MutationObserver(decoratePortfolioFilters).observe(grid, {
        childList: true,
        subtree: true
      });
    }
    var capitalForm = document.getElementById('capitalRelationshipFilterForm');
    if (capitalForm) {
      new MutationObserver(decorateCapitalFilters).observe(capitalForm, {
        childList: true,
        subtree: true
      });
      capitalForm.addEventListener('change', decorateCapitalFilters);
    }
  }

  function init() {
    decoratePortfolioFilters();
    decorateCapitalFilters();
    installObservers();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
