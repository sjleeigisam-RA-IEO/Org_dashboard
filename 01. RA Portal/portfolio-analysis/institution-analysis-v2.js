(function () {
  'use strict';

  var PALETTE = ['#2f9bff', '#f5b942', '#e85d75', '#8b6cff', '#2fc49f', '#f07ac4', '#8ccf4d', '#9aa8b8'];
  var CATEGORY_COLORS = {
    '여러 자산 연결': '#2f9bff',
    '기타': '#f5b942',
    '기타 자산': '#9aa8b8',
    '특별자산': '#e85d75',
    '오피스': '#8b6cff',
    '주거': '#2fc49f',
    '호텔': '#f07ac4',
    '물류': '#19b8c9',
    '물류센터': '#19b8c9',
    '데이터센터': '#ef8f3f',
    '리테일': '#f06b55',
    '금융상품': '#4f86c6',
    '대출채권': '#2f6f9f',
    '기업주식': '#8ccf4d',
    'NPL': '#d76a4a',
    '미분류': '#77808d'
  };
  var dialogState = {
    resultId: '',
    metric: 'committed',
    year: '',
    facts: [],
    party: null,
    assets: [],
    chart: null,
    map: null,
    trigger: null,
    suspended: false,
    scrollTop: 0,
    navigationTrigger: null
  };
  var dialogRequestId = 0;
  var mapRenderId = 0;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function numberValue(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean).map(String)));
  }

  function formatMillion(value) {
    return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(numberValue(value) / 1000000);
  }

  function compactAmount(value) {
    var amount = numberValue(value);
    if (Math.abs(amount) >= 100000000000) return (amount / 1000000000000).toFixed(amount >= 10000000000000 ? 1 : 2).replace(/\.0+$/, '') + '조';
    if (Math.abs(amount) >= 100000000) return (amount / 100000000).toFixed(amount >= 100000000000 ? 1 : 2).replace(/\.0+$/, '') + '억';
    return formatMillion(amount) + '백만';
  }

  function currentModule() {
    return window.CapitalRelationshipAnalysis;
  }

  function factsForParty(row) {
    var module = currentModule();
    if (!module || !module.state || !row) return [];
    var seen = new Set();
    return (module.state.facts || []).filter(function (fact) {
      return fact.role === row.role && fact.partyId === row.partyId;
    }).filter(function (fact) {
      var key = fact.exposureId
        ? [fact.role, fact.snapshotDate, fact.exposureId].join('|')
        : [fact.role, fact.partyId, fact.snapshotDate, fact.sourceIndex].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function yearLabel(fact) {
    return fact.commitmentYearLabel || fact.commitmentYear || '미상';
  }

  function assetClass(fact) {
    var values = unique(fact.baseAssetClasses || fact.assetTypes || []);
    if (!values.length) return '미분류';
    if (values.length > 1) return '여러 자산 연결';
    return values[0];
  }

  function relatedButtonsHtml(kind, ids, names) {
    var relatedIds = unique(ids || []);
    var relatedNames = names || [];
    if (!relatedIds.length) return esc(relatedNames.join(', ') || '-');
    return relatedIds.map(function (id, index) {
      var title = relatedNames[index] || id;
      return [
        '<button type="button" class="v2-related-detail-link"',
        ' data-v2-related-kind="', esc(kind), '"',
        ' data-v2-related-id="', esc(id), '"',
        ' data-v2-related-title="', esc(title), '">',
        '<span>', esc(title), '</span><b aria-hidden="true">›</b></button>'
      ].join('');
    }).join('');
  }

  function metricValue(fact) {
    return dialogState.metric === 'current' ? numberValue(fact.currentAmount) : numberValue(fact.committedAmount);
  }

  function sortedYears(facts) {
    return unique(facts.map(yearLabel)).sort(function (a, b) {
      if (a === '미상') return 1;
      if (b === '미상') return -1;
      return numberValue(a) - numberValue(b);
    });
  }

  function chartModel(facts) {
    var years = sortedYears(facts);
    var totals = new Map();
    facts.forEach(function (fact) {
      var label = assetClass(fact);
      totals.set(label, (totals.get(label) || 0) + metricValue(fact));
    });
    var classes = Array.from(totals.keys()).sort(function (a, b) {
      return (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b, 'ko');
    });
    var keep = classes.slice(0, 7);
    var overflow = new Set(classes.slice(7));
    if (overflow.size) keep.push('기타 자산');
    var series = keep.map(function (label) {
      return {
        name: label,
        data: years.map(function (year) {
          return facts.filter(function (fact) {
            var factClass = assetClass(fact);
            var groupedClass = overflow.has(factClass) ? '기타 자산' : factClass;
            return yearLabel(fact) === year && groupedClass === label;
          }).reduce(function (sum, fact) { return sum + metricValue(fact); }, 0);
        })
      };
    });
    return { years: years, series: series };
  }

  async function fetchAssets(ids) {
    ids = unique(ids);
    if (!ids.length || !window._supabase) return [];
    var select = 'asset_id,asset_code,canonical_name,physical_asset_name,non_physical_asset_label,address_text,asset_type,latitude,longitude';
    var responses = await Promise.all([
      window._supabase.from('asset_master').select(select).in('asset_id', ids).limit(1000),
      window._supabase.from('asset_master').select(select).in('asset_code', ids).limit(1000)
    ]);
    var rows = [];
    responses.forEach(function (response) {
      if (!response.error) rows = rows.concat(response.data || []);
    });
    var seen = new Set();
    return rows.filter(function (row) {
      var key = row.asset_id || row.asset_code;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function assetTitle(asset) {
    return asset.physical_asset_name || asset.non_physical_asset_label || asset.canonical_name || asset.asset_code || asset.asset_id || '-';
  }

  function assetType(asset) {
    return asset.asset_type || '미분류';
  }

  function colorFor(value, index) {
    var text = String(value || '미분류');
    if (CATEGORY_COLORS[text]) return CATEGORY_COLORS[text];
    if (Number.isInteger(index)) return PALETTE[index % PALETTE.length];
    var hash = 0;
    for (var i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(hash) % PALETTE.length];
  }

  function relevantFacts() {
    if (!dialogState.year) return dialogState.facts;
    return dialogState.facts.filter(function (fact) { return yearLabel(fact) === dialogState.year; });
  }

  function relevantAssets() {
    var ids = new Set([].concat.apply([], relevantFacts().map(function (fact) { return fact.assetIds || []; })).map(String));
    if (!dialogState.year) return dialogState.assets;
    return dialogState.assets.filter(function (asset) {
      return ids.has(String(asset.asset_id || '')) || ids.has(String(asset.asset_code || ''));
    });
  }

  function hasCoordinates(asset) {
    return asset
      && asset.longitude != null && asset.longitude !== ''
      && asset.latitude != null && asset.latitude !== ''
      && Number.isFinite(Number(asset.longitude))
      && Number.isFinite(Number(asset.latitude));
  }

  function ensureDialog() {
    var overlay = document.getElementById('v2InstitutionAnalysisDialog');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'v2InstitutionAnalysisDialog';
    overlay.className = 'v2-institution-overlay';
    overlay.hidden = true;
    overlay.innerHTML = [
      '<section class="v2-institution-dialog" role="dialog" aria-modal="true" aria-labelledby="v2InstitutionTitle">',
      '<header class="v2-institution-header">',
      '<div><p>CAPITAL RELATIONSHIPS</p><h2 id="v2InstitutionTitle"></h2><span id="v2InstitutionDescription"></span></div>',
      '<button type="button" data-v2-institution-close aria-label="닫기" title="닫기">×</button>',
      '</header>',
      '<div id="v2InstitutionContent" class="v2-institution-content"></div>',
      '</section>'
    ].join('');
    document.body.appendChild(overlay);
    return overlay;
  }

  function summaryHtml(row) {
    var committed = dialogState.facts.reduce(function (sum, fact) { return sum + numberValue(fact.committedAmount); }, 0);
    var current = dialogState.facts.reduce(function (sum, fact) { return sum + numberValue(fact.currentAmount); }, 0);
    var remaining = dialogState.facts.reduce(function (sum, fact) { return sum + numberValue(fact.remainingAmount); }, 0);
    var funds = unique([].concat.apply([], dialogState.facts.map(function (fact) { return fact.fundIds || []; })));
    var assets = unique([].concat.apply([], dialogState.facts.map(function (fact) { return fact.assetIds || []; })));
    var valid = Math.abs(committed - numberValue(row.committedAmount)) <= 1
      && Math.abs(current - numberValue(row.currentAmount)) <= 1;
    return [
      '<div class="v2-institution-kpis">',
      '<div><span>연결 펀드</span><strong>', funds.length, '</strong><small>개</small></div>',
      '<div><span>연결 자산</span><strong>', assets.length, '</strong><small>개</small></div>',
      '<div><span>약정액</span><strong>', compactAmount(committed), '</strong><small>', formatMillion(committed), '백만원</small></div>',
      '<div><span>', row.role === 'lender' ? '실행액' : '투입액', '</span><strong>', compactAmount(current), '</strong><small>', formatMillion(current), '백만원</small></div>',
      '<div><span>', row.role === 'lender' ? '미실행액' : '미투입액', '</span><strong>', compactAmount(remaining), '</strong><small>', formatMillion(remaining), '백만원</small></div>',
      '<div class="v2-institution-quality ', valid ? 'is-valid' : 'is-warning', '"><span>합계 검증</span><strong>', valid ? '일치' : '확인 필요', '</strong><small>노출 fact ', dialogState.facts.length, '건</small></div>',
      '</div>'
    ].join('');
  }

  function analysisShellHtml(row) {
    return [
      summaryHtml(row),
      '<div class="v2-institution-analysis-grid">',
      '<section class="v2-institution-panel v2-institution-chart-panel">',
      '<header><div><h3>최초 약정연도별 현재 규모</h3><p>현재 누계 금액의 약정연도 코호트입니다. 막대를 선택하면 같은 연도의 목록과 지도로 좁혀집니다.</p></div>',
      '<div class="v2-institution-metric" role="group" aria-label="금액 기준">',
      '<button type="button" data-v2-institution-metric="committed" class="', dialogState.metric === 'committed' ? 'is-active' : '', '">약정액</button>',
      '<button type="button" data-v2-institution-metric="current" class="', dialogState.metric === 'current' ? 'is-active' : '', '">', row.role === 'lender' ? '실행액' : '투입액', '</button>',
      '</div></header>',
      '<div id="v2InstitutionChart" class="v2-institution-chart"></div>',
      '</section>',
      '<section class="v2-institution-panel v2-institution-map-panel">',
      '<header><div><h3>투자 자산 위치</h3><p>자산 종류별 색으로 표시합니다.</p></div><span id="v2InstitutionMapCount"></span></header>',
      '<div id="v2InstitutionMap" class="v2-institution-map"></div>',
      '<div id="v2InstitutionMapLegend" class="v2-institution-map-legend"></div>',
      '<div id="v2InstitutionMapList" class="v2-institution-map-list"></div>',
      '</section>',
      '</div>',
      '<section class="v2-institution-panel v2-institution-list-panel">',
      '<header><div><h3 id="v2InstitutionListTitle">투자 목록</h3><p>한 행은 원천 노출 fact 한 건이며, 복수 펀드·자산 금액을 임의로 나누지 않습니다.</p></div>',
      '<button type="button" data-v2-clear-year hidden>연도 필터 해제</button></header>',
      '<div id="v2InstitutionFactTable"></div>',
      '</section>'
    ].join('');
  }

  function renderChart() {
    var target = document.getElementById('v2InstitutionChart');
    if (!target) return;
    if (dialogState.chart) {
      dialogState.chart.destroy();
      dialogState.chart = null;
    }
    var model = chartModel(dialogState.facts);
    if (!model.years.length || typeof window.ApexCharts === 'undefined') {
      target.innerHTML = '<p class="v2-institution-empty">약정시점 데이터가 없습니다.</p>';
      return;
    }
    dialogState.chart = new window.ApexCharts(target, {
      chart: {
        type: 'bar',
        height: 420,
        stacked: true,
        toolbar: { show: false },
        fontFamily: 'inherit',
        events: {
          dataPointSelection: function (_event, _context, config) {
            var year = model.years[config.dataPointIndex];
            dialogState.year = dialogState.year === year ? '' : year;
            renderFactTable();
            renderMap();
          }
        }
      },
      series: model.series,
      colors: model.series.map(function (series, index) { return colorFor(series.name, index); }),
      plotOptions: { bar: { columnWidth: '58%', borderRadius: 3 } },
      dataLabels: { enabled: false },
      stroke: { width: 1, colors: ['#17191b'] },
      fill: { opacity: 0.96 },
      xaxis: {
        categories: model.years,
        labels: { style: { colors: '#c8cbd1', fontSize: '11px' } },
        axisBorder: { color: '#4b4c50' },
        axisTicks: { color: '#4b4c50' }
      },
      yaxis: {
        labels: {
          formatter: compactAmount,
          style: { colors: '#aeb2ba', fontSize: '11px' }
        }
      },
      grid: { borderColor: '#3b3d3f', strokeDashArray: 3 },
      legend: { position: 'bottom', labels: { colors: '#d9dce1' }, markers: { radius: 2 } },
      tooltip: {
        shared: true,
        intersect: false,
        theme: 'dark',
        y: { formatter: function (value) { return formatMillion(value) + '백만원'; } }
      },
      states: { active: { filter: { type: 'lighten', value: 0.18 } } }
    });
    dialogState.chart.render();
  }

  function renderFactTable() {
    var target = document.getElementById('v2InstitutionFactTable');
    var title = document.getElementById('v2InstitutionListTitle');
    var clear = document.querySelector('[data-v2-clear-year]');
    if (!target) return;
    var facts = relevantFacts().slice().sort(function (a, b) {
      return numberValue(b.committedAmount) - numberValue(a.committedAmount)
        || String(yearLabel(a)).localeCompare(String(yearLabel(b)));
    });
    if (title) title.textContent = dialogState.year ? dialogState.year + '년 투자 목록' : '전체 투자 목록';
    if (clear) clear.hidden = !dialogState.year;
    if (!facts.length) {
      target.innerHTML = '<p class="v2-institution-empty">선택한 연도의 투자 내역이 없습니다.</p>';
      return;
    }
    target.innerHTML = [
      '<div class="v2-institution-table-wrap"><table class="v2-institution-table">',
      '<thead><tr><th>약정연도</th><th>펀드/비히클</th><th>투자 자산</th><th>자산구성</th><th>약정액</th><th>', dialogState.party.role === 'lender' ? '실행액' : '투입액', '</th></tr></thead>',
      '<tbody>', facts.map(function (fact) {
        return [
          '<tr>',
          '<td>', esc(yearLabel(fact)), '</td>',
          '<td><div class="v2-related-detail-links">', relatedButtonsHtml('fund', fact.fundIds, fact.fundNames), '</div><small>', esc((fact.fundIds || []).join(' · ')), '</small></td>',
          '<td><div class="v2-related-detail-links">', relatedButtonsHtml('asset', fact.assetIds, fact.assetNames), '</div></td>',
          '<td><span class="v2-type-dot" style="--type-color:', colorFor(assetClass(fact)), '"></span>', esc(assetClass(fact)), '</td>',
          '<td>', formatMillion(fact.committedAmount), '<small>백만원</small></td>',
          '<td>', formatMillion(fact.currentAmount), '<small>백만원</small></td>',
          '</tr>'
        ].join('');
      }).join(''), '</tbody></table></div>'
    ].join('');
  }

  function disposeMap() {
    mapRenderId += 1;
    if (dialogState.map && typeof dialogState.map.setTarget === 'function') dialogState.map.setTarget(null);
    dialogState.map = null;
  }

  function renderMap() {
    var target = document.getElementById('v2InstitutionMap');
    var legend = document.getElementById('v2InstitutionMapLegend');
    var list = document.getElementById('v2InstitutionMapList');
    var count = document.getElementById('v2InstitutionMapCount');
    if (!target || !legend || !list) return;
    disposeMap();
    var renderId = mapRenderId;
    target.innerHTML = '';
    var assets = relevantAssets();
    var located = assets.filter(hasCoordinates);
    if (count) count.textContent = located.length + '/' + assets.length + '개 위치 확인';
    var types = unique(located.map(assetType));
    legend.innerHTML = types.map(function (type) {
      return '<span><i style="--marker-color:' + colorFor(type) + '"></i>' + esc(type) + '</span>';
    }).join('');
    list.innerHTML = located.slice(0, 8).map(function (asset) {
      return '<button type="button" data-v2-related-kind="asset" data-v2-related-id="' + esc(asset.asset_id || asset.asset_code) + '" data-v2-related-title="' + esc(assetTitle(asset)) + '"><i style="--marker-color:' + colorFor(assetType(asset)) + '"></i><span><b>' + esc(assetTitle(asset)) + '</b><small>' + esc(asset.address_text || assetType(asset)) + '</small></span></button>';
    }).join('') + (assets.length > located.length ? '<p>좌표 미등록 ' + (assets.length - located.length) + '개</p>' : '');
    if (!located.length || typeof window.vw === 'undefined' || !window.vw.ol3 || typeof window.ol === 'undefined') {
      target.innerHTML = '<p class="v2-institution-empty">표시 가능한 자산 좌표가 없습니다.</p>';
      return;
    }
    window.setTimeout(function () {
      if (renderId !== mapRenderId || !target.isConnected) return;
      try {
        var map = new window.vw.ol3.Map('v2InstitutionMap', {
          basemapType: window.vw.ol3.BasemapType.GRAPHIC,
          controlDensity: window.vw.ol3.DensityType.EMPTY,
          interactionDensity: window.vw.ol3.DensityType.BASIC,
          homePosition: window.vw.ol3.CameraPosition,
          initPosition: window.vw.ol3.CameraPosition
        });
        var features = located.map(function (asset) {
          var feature = new window.ol.Feature({
            geometry: new window.ol.geom.Point(window.ol.proj.fromLonLat([Number(asset.longitude), Number(asset.latitude)])),
            title: assetTitle(asset),
            assetId: asset.asset_id || asset.asset_code
          });
          feature.setStyle(new window.ol.style.Style({
            image: new window.ol.style.Circle({
              radius: 9,
              fill: new window.ol.style.Fill({ color: colorFor(assetType(asset)) }),
              stroke: new window.ol.style.Stroke({ color: '#ffffff', width: 3 })
            })
          }));
          return feature;
        });
        var source = new window.ol.source.Vector({ features: features });
        map.addLayer(new window.ol.layer.Vector({ source: source }));
        dialogState.map = map;
        map.on('singleclick', function (mapEvent) {
          var selectedFeature = null;
          map.forEachFeatureAtPixel(mapEvent.pixel, function (feature) {
            selectedFeature = feature;
            return true;
          });
          if (!selectedFeature) return;
          openRelatedDetail(
            'asset',
            selectedFeature.get('assetId'),
            selectedFeature.get('title'),
            target
          ).catch(function (error) {
            console.error('v2 institution asset navigation error', error);
          });
        });
        map.on('pointermove', function (mapEvent) {
          target.style.cursor = map.hasFeatureAtPixel(mapEvent.pixel) ? 'pointer' : '';
        });
        function fitMap() {
          if (dialogState.map !== map) return;
          var mapElement = document.getElementById('v2InstitutionMap');
          if (mapElement && typeof map.setSize === 'function') {
            map.setSize([mapElement.clientWidth, mapElement.clientHeight]);
          }
          if (typeof map.updateSize === 'function') map.updateSize();
          if (features.length === 1) {
            map.getView().setCenter(features[0].getGeometry().getCoordinates());
            map.getView().setZoom(13);
          } else {
            var extent = window.ol.extent.boundingExtent(features.map(function (feature) {
              return feature.getGeometry().getCoordinates();
            }));
            if (map.getView().fit.length >= 3) {
              map.getView().fit(extent, map.getSize(), { padding: [34, 34, 34, 34], maxZoom: 12 });
            } else {
              map.getView().fit(extent, { padding: [34, 34, 34, 34], maxZoom: 12, duration: 0 });
            }
          }
          if (mapElement) {
            mapElement.dataset.zoom = String(map.getView().getZoom());
            mapElement.dataset.center = String(map.getView().getCenter());
            mapElement.dataset.fitArity = String(map.getView().fit.length);
          }
        }
        window.setTimeout(fitMap, 220);
        window.setTimeout(fitMap, 900);
      } catch (error) {
        if (renderId !== mapRenderId) return;
        console.error('v2 institution map error', error);
        target.innerHTML = '<p class="v2-institution-empty">지도를 불러오지 못했습니다.</p>';
      }
    }, 80);
  }

  async function openDialog(resultId, trigger) {
    var module = currentModule();
    if (!module || !module.state) return;
    var row = (module.state.results || []).find(function (candidate) { return candidate.resultId === resultId; });
    if (!row) return;
    var requestId = ++dialogRequestId;
    dialogState.resultId = resultId;
    dialogState.party = row;
    dialogState.facts = factsForParty(row);
    dialogState.metric = 'committed';
    dialogState.year = '';
    dialogState.trigger = trigger || document.activeElement;
    var overlay = ensureDialog();
    document.getElementById('v2InstitutionTitle').textContent = row.partyName + ' 자금관계';
    document.getElementById('v2InstitutionDescription').textContent = row.role === 'lender'
      ? '대출 실행 내역을 약정시점·펀드·자산 위치로 함께 봅니다.'
      : '에쿼티 투자 내역을 약정시점·펀드·자산 위치로 함께 봅니다.';
    document.getElementById('v2InstitutionContent').innerHTML = '<p class="v2-institution-loading">투자 관계와 자산 위치를 불러오는 중입니다.</p>';
    overlay.hidden = false;
    window.requestAnimationFrame(function () {
      if (requestId !== dialogRequestId) return;
      overlay.classList.add('active');
      var closeButton = overlay.querySelector('[data-v2-institution-close]');
      if (closeButton) closeButton.focus();
    });
    var ids = unique([].concat.apply([], dialogState.facts.map(function (fact) { return fact.assetIds || []; })));
    var assets = await fetchAssets(ids);
    if (requestId !== dialogRequestId || dialogState.resultId !== resultId || overlay.hidden) return;
    dialogState.assets = assets;
    document.getElementById('v2InstitutionContent').innerHTML = analysisShellHtml(row);
    renderChart();
    renderMap();
    renderFactTable();
    overlay.dataset.audit = JSON.stringify(auditCurrentDialog());
  }

  function suspendDialog(trigger) {
    var overlay = document.getElementById('v2InstitutionAnalysisDialog');
    var content = document.getElementById('v2InstitutionContent');
    if (!overlay || overlay.hidden) return;
    dialogRequestId += 1;
    dialogState.scrollTop = content ? content.scrollTop : 0;
    dialogState.navigationTrigger = trigger || document.activeElement;
    dialogState.suspended = true;
    disposeMap();
    overlay.classList.remove('active');
    overlay.hidden = true;
  }

  function resumeDialog() {
    var overlay = document.getElementById('v2InstitutionAnalysisDialog');
    var content = document.getElementById('v2InstitutionContent');
    if (!overlay || !dialogState.party) return;
    overlay.hidden = false;
    window.requestAnimationFrame(function () {
      overlay.classList.add('active');
      if (content) content.scrollTop = dialogState.scrollTop;
    });
    window.setTimeout(function () {
      if (overlay.hidden || !overlay.classList.contains('active')) return;
      if (dialogState.map && typeof dialogState.map.updateSize === 'function') dialogState.map.updateSize();
      else renderMap();
      if (content) content.scrollTop = dialogState.scrollTop;
    }, 180);
    dialogState.suspended = false;
    if (dialogState.navigationTrigger && typeof dialogState.navigationTrigger.focus === 'function') {
      dialogState.navigationTrigger.focus();
    }
    dialogState.navigationTrigger = null;
  }

  function installReturnButton() {
    var panel = document.getElementById('detailPanel');
    if (!panel) return;
    var header = panel.querySelector('.detail-header');
    if (!header) return;
    var button = header.querySelector('.back-to-results-btn');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'back-to-results-btn';
      header.prepend(button);
    }
    button.removeAttribute('onclick');
    button.dataset.v2ReturnToAnalysis = '';
    button.classList.add('v2-return-to-analysis');
    button.textContent = '← ' + (dialogState.party ? dialogState.party.partyName : '기관') + ' 분석으로';
    button.title = '기관 자금관계 분석으로 돌아가기';
  }

  async function openRelatedDetail(kind, id, title, trigger) {
    if (!id) return;
    suspendDialog(trigger);
    try {
      if (kind === 'fund' && typeof window.openFundRelationshipDrawer === 'function') {
        await window.openFundRelationshipDrawer(id, title || id, { inline: true });
      } else if (kind === 'asset' && window.AssetCanonical && typeof window.AssetCanonical.renderCanonicalAssetDetail === 'function') {
        await window.AssetCanonical.renderCanonicalAssetDetail(id, title || id, { inlineOnly: true });
      } else {
        throw new Error('상세 화면을 열 수 없습니다.');
      }
      installReturnButton();
    } catch (error) {
      if (typeof window.goBackDetailPanel === 'function') window.goBackDetailPanel();
      resumeDialog();
      throw error;
    }
  }

  function returnToAnalysis() {
    if (!dialogState.suspended) return;
    if (typeof window.goBackDetailPanel === 'function') window.goBackDetailPanel();
    resumeDialog();
  }

  function closeDialog() {
    var overlay = document.getElementById('v2InstitutionAnalysisDialog');
    if (!overlay || overlay.hidden) return;
    var closeRequestId = ++dialogRequestId;
    if (dialogState.chart) dialogState.chart.destroy();
    dialogState.chart = null;
    disposeMap();
    dialogState.suspended = false;
    overlay.classList.remove('active');
    window.setTimeout(function () {
      if (closeRequestId === dialogRequestId && !overlay.classList.contains('active')) overlay.hidden = true;
    }, 160);
    if (dialogState.trigger && typeof dialogState.trigger.focus === 'function') dialogState.trigger.focus();
    dialogState.trigger = null;
  }

  function auditCurrentDialog() {
    var model = chartModel(dialogState.facts);
    var chartTotal = model.series.reduce(function (total, series) {
      return total + series.data.reduce(function (sum, value) { return sum + numberValue(value); }, 0);
    }, 0);
    var committed = dialogState.facts.reduce(function (sum, fact) { return sum + numberValue(fact.committedAmount); }, 0);
    var current = dialogState.facts.reduce(function (sum, fact) { return sum + numberValue(fact.currentAmount); }, 0);
    var assetIds = unique([].concat.apply([], dialogState.facts.map(function (fact) { return fact.assetIds || []; })));
    return {
      resultId: dialogState.resultId,
      factCount: dialogState.facts.length,
      committedAmount: committed,
      currentAmount: current,
      partyCommittedAmount: dialogState.party ? numberValue(dialogState.party.committedAmount) : 0,
      partyCurrentAmount: dialogState.party ? numberValue(dialogState.party.currentAmount) : 0,
      metric: dialogState.metric,
      chartTotal: chartTotal,
      metricTotal: dialogState.metric === 'current' ? current : committed,
      distinctAssetIds: assetIds.length,
      resolvedAssets: dialogState.assets.length,
      locatedAssets: dialogState.assets.filter(hasCoordinates).length
    };
  }

  document.addEventListener('click', function (event) {
    var partyButton = event.target.closest('[data-capital-party-id]');
    if (!partyButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openDialog(partyButton.dataset.capitalPartyId, partyButton).catch(function (error) {
      console.error('v2 institution analysis error', error);
    });
  }, true);

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-v2-return-to-analysis]')) {
      event.preventDefault();
      returnToAnalysis();
      return;
    }
    if (event.target.closest('[data-v2-institution-close]')) {
      closeDialog();
      return;
    }
    var overlay = event.target.closest('#v2InstitutionAnalysisDialog');
    if (overlay && event.target === overlay) {
      closeDialog();
      return;
    }
    var metric = event.target.closest('[data-v2-institution-metric]');
    if (metric) {
      dialogState.metric = metric.dataset.v2InstitutionMetric;
      document.querySelectorAll('[data-v2-institution-metric]').forEach(function (button) {
        button.classList.toggle('is-active', button === metric);
      });
      renderChart();
      return;
    }
    if (event.target.closest('[data-v2-clear-year]')) {
      dialogState.year = '';
      renderFactTable();
      renderMap();
      return;
    }
    var relatedButton = event.target.closest('[data-v2-related-kind]');
    if (relatedButton) {
      event.preventDefault();
      openRelatedDetail(
        relatedButton.dataset.v2RelatedKind,
        relatedButton.dataset.v2RelatedId,
        relatedButton.dataset.v2RelatedTitle,
        relatedButton
      ).catch(function (error) {
        console.error('v2 institution relationship navigation error', error);
      });
    }
  });

  document.addEventListener('keydown', function (event) {
    var overlay = document.getElementById('v2InstitutionAnalysisDialog');
    if (!overlay || overlay.hidden || !overlay.classList.contains('active')) return;
    if (event.key === 'Escape') {
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    var focusable = Array.prototype.slice.call(overlay.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (element) { return element.offsetParent !== null; });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.V2InstitutionAnalysis = {
    open: openDialog,
    close: closeDialog,
    audit: auditCurrentDialog,
    returnToAnalysis: returnToAnalysis
  };
})();
