(function () {
  'use strict';

  var Core = window.GlobalAssetMapCore;
  if (!Core) return;

  var state = {
    active: false,
    generation: 0,
    rows: [],
    filteredRows: [],
    selectedTiers: new Set(Object.keys(Core.TIER_META)),
    scope: { continentCode: '', countryCode: '', city: '' },
    detailMode: false,
    dotZoom: 1,
    query: '',
    map: null,
    markers: [],
    controller: null,
    selectedAssetId: '',
    inspectorOpener: null,
    mapBase: 'concept-svg',
    tileFailed: false,
    renderedMarkerCount: 0,
    source: '',
    loadStatus: 'idle'
  };

  var COUNTRY_NAMES = {
    USA: '미국', CAN: '캐나다', GBR: '영국', FRA: '프랑스', DEU: '독일',
    JPN: '일본', SGP: '싱가포르', AUS: '호주', ESP: '스페인', ITA: '이탈리아',
    NLD: '네덜란드', IRL: '아일랜드', BEL: '벨기에', POL: '폴란드',
    PRT: '포르투갈', SWE: '스웨덴', FIN: '핀란드', DNK: '덴마크',
    NOR: '노르웨이', CHE: '스위스', AUT: '오스트리아', CZE: '체코',
    KOR: '대한민국', CHN: '중국', HKG: '홍콩', IND: '인도', VNM: '베트남',
    THA: '태국', MYS: '말레이시아', IDN: '인도네시아', NZL: '뉴질랜드'
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function endpoint() {
    var base = window.SUPABASE_URL || 'https://qvegpozwrcmspdvjokiz.supabase.co';
    return base.replace('.supabase.co', '.functions.supabase.co') + '/ra-asset-map';
  }

  function disposeMap() {
    state.markers.forEach(function (marker) { if (marker && typeof marker.remove === 'function') marker.remove(); });
    state.markers = [];
    if (state.map && typeof state.map.remove === 'function') state.map.remove();
    else if (state.map && typeof state.map.setTarget === 'function') state.map.setTarget(null);
    state.map = null;
    state.renderedMarkerCount = 0;
    state.tileFailed = false;
  }

  function deactivate() {
    state.active = false;
    state.generation += 1;
    if (state.controller) state.controller.abort();
    state.controller = null;
    disposeMap();
    state.rows = [];
    state.filteredRows = [];
    state.inspectorOpener = null;
    state.loadStatus = 'idle';
    document.body.classList.remove('global-asset-map-mode');
  }

  function loadingHtml() {
    return '<section class="global-map-loading" aria-live="polite"><span></span><strong>글로벌 자산 위치를 불러오는 중입니다</strong><p>확정 위치와 검토 후보를 분리해 구성합니다.</p></section>';
  }

  function errorHtml(message) {
    return [
      '<section class="global-map-error" role="alert">',
      '<strong>자산지도를 불러오지 못했습니다</strong>',
      '<p>', esc(message), '</p>',
      '<button type="button" data-global-map-action="retry">다시 시도</button>',
      '</section>'
    ].join('');
  }

  function isLoopbackHost() {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].indexOf(window.location.hostname) >= 0;
  }

  async function fetchPayload(url, options) {
    var response = await fetch(url, options);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || data.ok === false) throw new Error(data.error || '위치 API 응답을 확인할 수 없습니다.');
    return data;
  }

  function validatePayload(data, generation) {
    if (generation !== state.generation || !state.active) return null;
    if (!Array.isArray(data.assets) || data.assets.length > 10000 || Number(data.count) !== data.assets.length) {
      throw new Error('위치 데이터 형식이 올바르지 않습니다.');
    }
    if (data.assets.length === 0) {
      throw new Error('위치 DB 응답이 0건입니다. 데이터 연결 상태를 관리자에게 확인해 주세요.');
    }
    data.assets.forEach(function (row) {
      var computed = Core.classifyLocation(row).tier;
      if (computed !== row.location_tier) throw new Error('위치 단계 계약이 일치하지 않습니다: ' + String(row.asset_id || 'unknown'));
    });
    state.source = data.source || 'session-edge-function';
    return data.assets;
  }

  async function fetchRows(generation) {
    var token = '';
    if (window.RAAuth && typeof window.RAAuth.getSessionToken === 'function') token = window.RAAuth.getSessionToken();
    else if (window.RAAuth && typeof window.RAAuth.getRememberToken === 'function') token = window.RAAuth.getRememberToken();
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    var requestOptions = { cache: 'no-store', signal: state.controller.signal };

    if (isLoopbackHost()) {
      try {
        var localData = await fetchPayload('/__ra_asset_map_snapshot', requestOptions);
        return validatePayload(localData, generation);
      } catch (localError) {
        if (!token || (localError && localError.name === 'AbortError')) {
          throw new Error('로컬 자산지도 데이터 연결에 실패했습니다. RA 전용 로컬 서버를 다시 실행해 주세요.');
        }
        console.warn('Local asset map proxy unavailable; using the session API.', localError);
      }
    }

    if (!token) throw new Error('로그인 세션을 확인할 수 없습니다. Portal에 다시 로그인해 주세요.');
    var edgeData = await fetchPayload(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: token }),
      cache: 'no-store',
      signal: state.controller.signal
    });
    return validatePayload(edgeData, generation);
  }

  function activate() {
    state.active = true;
    state.generation += 1;
    state.scope = { continentCode: '', countryCode: '', city: '' };
    state.detailMode = false;
    state.dotZoom = 1;
    state.query = '';
    state.selectedAssetId = '';
    state.mapBase = 'concept-svg';
    document.body.classList.add('global-asset-map-mode');
    var panel = document.getElementById('detailPanel');
    if (!panel) return;
    disposeMap();
    panel.innerHTML = loadingHtml();
    var generation = state.generation;
    if (state.loadStatus === 'loaded') {
      render();
      return;
    }
    state.loadStatus = 'loading';
    fetchRows(generation).then(function (rows) {
      if (!rows || generation !== state.generation || !state.active) return;
      state.rows = rows;
      state.loadStatus = 'loaded';
      state.controller = null;
      render();
    }).catch(function (error) {
      if (error && error.name === 'AbortError') return;
      if (generation !== state.generation || !state.active) return;
      state.loadStatus = 'error';
      state.controller = null;
      panel.innerHTML = errorHtml(error.message || error);
    });
  }

  function retry() {
    state.rows = [];
    state.loadStatus = 'idle';
    activate();
  }

  function restore() {
    if (!state.active) return;
    if (state.loadStatus === 'loaded') {
      render();
      return;
    }
    var panel = document.getElementById('detailPanel');
    if (state.loadStatus === 'loading') {
      if (panel) panel.innerHTML = loadingHtml();
      return;
    }
    activate();
  }

  function countryName(code, rows) {
    if (code === '__unknown_country__') return '국가 미확인';
    var fromRow = (rows || state.rows).find(function (row) { return row.country_code_alpha3 === code && row.normalized_country_name; });
    return COUNTRY_NAMES[code] || (fromRow && fromRow.normalized_country_name) || code || '국가 미확인';
  }

  function continentName(code) {
    return Core.CONTINENT_META[code] ? Core.CONTINENT_META[code].label : '권역 미확인';
  }

  function emptyScope() {
    return { continentCode: '', countryCode: '', city: '' };
  }

  function isDetailStage() {
    return Boolean(state.detailMode || state.scope.countryCode);
  }

  function filteredRows() {
    var query = state.query.trim().toLocaleLowerCase('ko');
    return state.rows.filter(function (row) {
      if (!state.selectedTiers.has(Core.classifyLocation(row).tier)) return false;
      if (state.scope.continentCode && Core.continentForRow(row) !== state.scope.continentCode) return false;
      if (state.scope.countryCode) {
        if (state.scope.countryCode === '__unknown_country__' ? Boolean(row.country_code_alpha3) : row.country_code_alpha3 !== state.scope.countryCode) return false;
      }
      if (state.scope.city) {
        var rowCity = String(row.normalized_city || row.raw_city || '');
        if (state.scope.city === '__unknown__' ? Boolean(rowCity) : rowCity.toLocaleLowerCase('en') !== state.scope.city.toLocaleLowerCase('en')) return false;
      }
      if (!query) return true;
      return [row.canonical_name, row.asset_code, row.asset_type, row.normalized_country_name, row.normalized_city, row.raw_city]
        .some(function (value) { return String(value || '').toLocaleLowerCase('ko').includes(query); });
    });
  }

  function summaryHtml(counts) {
    var items = [
      ['verified', '확정'], ['candidate_asset', '주소·건물 후보'], ['local_area', '도로·구역'],
      ['uncertain_point', '정밀도 불명'], ['city_text', '도시 정보'], ['aggregate_only', '비단일'], ['insufficient', '근거 부족']
    ];
    return '<div class="global-map-kpis">' + items.map(function (item) {
      return '<div data-tier="' + item[0] + '"><span>' + item[1] + '</span><strong>' + (counts[item[0]] || 0) + '</strong><small>개</small></div>';
    }).join('') + '</div>';
  }

  function tierFiltersHtml(counts) {
    return Object.keys(Core.TIER_META).map(function (tier) {
      var meta = Core.TIER_META[tier];
      var pressed = state.selectedTiers.has(tier);
      return '<button type="button" data-global-map-tier="' + tier + '" class="tier-filter tier-' + meta.tone + (pressed ? ' active' : '') + '" aria-pressed="' + pressed + '"><i></i><span>' + esc(meta.label) + '</span><b>' + (counts[tier] || 0) + '</b></button>';
    }).join('');
  }

  function breadcrumbsHtml() {
    var parts = ['<button type="button" data-global-map-scope="world">GLOBAL</button>'];
    if (state.scope.continentCode) parts.push('<span>/</span><button type="button" data-global-map-scope="continent">' + esc(continentName(state.scope.continentCode)) + '</button>');
    if (state.scope.countryCode) parts.push('<span>/</span><button type="button" data-global-map-scope="country">' + esc(countryName(state.scope.countryCode)) + '</button>');
    if (state.scope.city) parts.push('<span>/</span><strong>' + esc(state.scope.city === '__unknown__' ? '도시 미확인' : state.scope.city) + '</strong>');
    return '<nav class="global-map-breadcrumbs" aria-label="지도 위치 경로">' + parts.join('') + '</nav>';
  }

  function shellHtml(rows) {
    var counts = Core.summarize(state.rows);
    var detail = isDetailStage();
    var stage = state.scope.countryCode
      ? (state.scope.city ? '도시·자산 상세' : '국가·도시 상세')
      : (state.scope.continentCode ? (detail ? continentName(state.scope.continentCode) + ' 상세 지도' : continentName(state.scope.continentCode) + ' 국가별 개요') : (detail ? '글로벌 상세 지도' : '대륙별 자산 개요'));
    var coordinateCount = rows.filter(Core.hasCoordinatePair).length;
    return [
      '<main class="global-asset-map" data-map-stage="', detail ? 'detail' : 'world', '">',
      '<header class="global-map-header">',
      '<div>', breadcrumbsHtml(), '<p>GLOBAL ASSET LOCATION</p><h1>글로벌 자산 위치</h1><span>', stage, ' · 검증 상태와 좌표 정밀도를 구분해 표시합니다.</span></div>',
      '<div class="global-map-header-actions"><label><span>자산 검색</span><input type="search" data-global-map-search value="', esc(state.query), '" placeholder="자산·도시·국가"></label><button type="button" data-global-map-action="refresh">새로고침</button></div>',
      '</header>',
      summaryHtml(counts),
      '<section class="global-map-workspace">',
      '<aside class="global-map-sidebar"><div class="global-map-tier-filters" role="group" aria-label="위치 정밀도 필터">', tierFiltersHtml(counts), '</div><div id="globalMapList" class="global-map-list"></div></aside>',
      '<section class="global-map-canvas-panel"><div class="global-map-canvas-head"><div><strong id="globalMapStageTitle">', stage, '</strong><span id="globalMapStageNote">좌표 ', coordinateCount, '개 · 관리 대상 ', rows.length, '개</span></div><div id="globalMapBaseBadge" class="global-map-base-badge">', detail ? '오픈소스 상세지도' : '도트 드릴다운', '</div></div><div id="globalMapCanvas" class="global-map-canvas"></div><div id="globalMapInspector" class="global-map-inspector" role="dialog" aria-modal="false" aria-labelledby="globalMapInspectorTitle" hidden></div></section>',
      '</section>',
      '</main>'
    ].join('');
  }

  var WORLD_LAND_POLYGONS = [
    [[-168,72],[-142,71],[-124,61],[-114,53],[-126,49],[-124,38],[-113,29],[-98,18],[-84,21],[-80,31],[-67,45],[-52,49],[-56,61],[-78,72],[-110,78],[-145,76]],
    [[-101,20],[-91,18],[-84,12],[-77,8],[-81,5],[-90,13]],
    [[-82,13],[-70,12],[-53,5],[-36,-7],[-42,-22],[-52,-35],[-66,-55],[-74,-51],[-78,-32],[-81,-12]],
    [[-12,36],[-10,57],[-2,70],[23,72],[43,65],[67,73],[101,77],[139,71],[169,61],[179,51],[164,40],[145,37],[128,25],[111,20],[102,8],[84,7],[72,20],[55,25],[43,31],[28,34],[18,40],[7,43]],
    [[-18,35],[3,37],[26,33],[42,20],[51,10],[44,-7],[34,-20],[20,-35],[7,-35],[-4,-25],[-12,-5],[-17,16]],
    [[42,30],[57,25],[59,15],[51,12],[44,17]],
    [[68,24],[78,30],[89,24],[84,8],[76,7],[70,17]],
    [[111,-11],[128,-10],[143,-16],[154,-28],[149,-41],[135,-45],[119,-38],[112,-25]],
    [[-52,59],[-27,64],[-20,75],[-38,83],[-60,82],[-70,72]],
    [[129,31],[142,43],[146,39],[140,32]],
    [[47,-13],[51,-16],[50,-25],[45,-21]],
    [[166,-35],[179,-38],[175,-47],[167,-45]]
  ];

  function pointInPolygon(longitude, latitude, polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i][0];
      var yi = polygon[i][1];
      var xj = polygon[j][0];
      var yj = polygon[j][1];
      var intersects = ((yi > latitude) !== (yj > latitude))
        && (longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || 0.00001) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pixelLandHtml() {
    var cells = [];
    for (var latitude = 77.5; latitude >= -57.5; latitude -= 5) {
      for (var longitude = -177.5; longitude <= 177.5; longitude += 5) {
        if (!WORLD_LAND_POLYGONS.some(function (polygon) { return pointInPolygon(longitude, latitude, polygon); })) continue;
        var point = Core.projectWorldPoint(longitude, latitude, 1000, 500);
        cells.push('<rect x="' + (point.x - 4.8).toFixed(1) + '" y="' + (point.y - 4.8).toFixed(1) + '" width="9.6" height="9.6"></rect>');
      }
    }
    return cells.join('');
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function continentTone(code) {
    return Core.CONTINENT_META[code] ? Core.CONTINENT_META[code].tone : 'unknown';
  }

  function dotViewBox(layout) {
    if (!state.scope.continentCode) return '0 0 1000 500';
    if (!layout.length) return '0 0 1000 500';
    var minX = Math.min.apply(null, layout.map(function (item) { return item.x - item.radius; }));
    var maxX = Math.max.apply(null, layout.map(function (item) { return item.x + item.radius; }));
    var minY = Math.min.apply(null, layout.map(function (item) { return item.y - item.radius; }));
    var maxY = Math.max.apply(null, layout.map(function (item) { return item.y + item.radius + 18; }));
    var width = Math.max(360, maxX - minX + 90);
    var height = Math.max(180, maxY - minY + 62);
    if (width / height < 2) width = height * 2;
    else height = width / 2;
    var extraZoom = 1 + Math.max(0, state.dotZoom - 1.7) * 0.18;
    width = Math.max(340, width / extraZoom);
    height = Math.max(170, height / extraZoom);
    var centerX = (minX + maxX) / 2;
    var centerY = (minY + maxY) / 2;
    var x = clamp(centerX - width / 2, 0, 1000 - width);
    var y = clamp(centerY - height / 2, 0, 500 - height);
    return [x, y, width, height].map(function (value) { return value.toFixed(1); }).join(' ');
  }

  function clusterRadius(count, level, featured) {
    var radius = level === 'continent' ? 24 + Math.sqrt(count) * 1.45 : 11 + Math.sqrt(count) * 1.35;
    if (featured) radius = Math.max(radius, 38);
    return Math.min(level === 'continent' ? 64 : 40, radius);
  }

  function layoutWorldClusters(clusters, continentLevel) {
    var layout = clusters.map(function (cluster, index) {
      var point = Core.projectWorldPoint(cluster.longitude, cluster.latitude, 1000, 500);
      if (!point) return null;
      var featured = cluster.countryCode === 'KOR';
      return {
        cluster: cluster,
        index: index,
        anchorX: point.x,
        anchorY: point.y,
        x: point.x,
        y: point.y,
        radius: clusterRadius(cluster.count, continentLevel ? 'continent' : 'country', featured)
      };
    }).filter(Boolean);
    if (continentLevel) return layout;

    for (var iteration = 0; iteration < 70; iteration += 1) {
      for (var left = 0; left < layout.length; left += 1) {
        for (var right = left + 1; right < layout.length; right += 1) {
          var a = layout[left];
          var b = layout[right];
          var dx = b.x - a.x;
          var dy = b.y - a.y;
          if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
            var angle = ((a.index + 1) * 137.5) * Math.PI / 180;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
          }
          var distance = Math.sqrt(dx * dx + dy * dy) || 1;
          var minimum = a.radius + b.radius + 8;
          if (distance >= minimum) continue;
          var push = (minimum - distance) * 0.52;
          var unitX = dx / distance;
          var unitY = dy / distance;
          a.x -= unitX * push;
          a.y -= unitY * push;
          b.x += unitX * push;
          b.y += unitY * push;
        }
      }
      layout.forEach(function (item) {
        item.x += (item.anchorX - item.x) * 0.018;
        item.y += (item.anchorY - item.y) * 0.018;
        item.x = clamp(item.x, item.radius + 8, 992 - item.radius);
        item.y = clamp(item.y, item.radius + 8, 472 - item.radius);
      });
    }
    return layout;
  }

  function worldHtml(rows) {
    var continentLevel = !state.scope.continentCode && state.dotZoom < 1.5;
    var clusters = continentLevel ? Core.buildContinentClusters(rows) : Core.buildCountryClusters(rows);
    var layout = layoutWorldClusters(clusters, continentLevel);
    var dots = layout.map(function (item) {
      var cluster = item.cluster;
      var isContinent = Boolean(cluster.continentCode && !cluster.countryCode);
      var code = isContinent ? cluster.continentCode : cluster.countryCode;
      var label = isContinent ? cluster.label : countryName(cluster.countryCode);
      var featured = cluster.countryCode === 'KOR';
      var radius = item.radius;
      var dataAttribute = isContinent ? 'data-global-map-continent="' + esc(code) + '"' : 'data-global-map-country="' + esc(code) + '"';
      var tone = continentTone(cluster.continentCode || Core.continentForRow({ country_code_alpha3: cluster.countryCode }));
      var detail = isContinent ? cluster.countryCount + '개국' : code;
      var koreaNote = isContinent && code === 'ASI'
        ? rows.filter(function (row) { return row.country_code_alpha3 === 'KOR'; }).length
        : 0;
      if (koreaNote) detail += ' · 한국 ' + koreaNote;
      var offset = Math.sqrt(Math.pow(item.x - item.anchorX, 2) + Math.pow(item.y - item.anchorY, 2));
      var leader = !isContinent && offset > 4
        ? '<line class="world-cluster-leader continent-' + tone + '" x1="' + item.anchorX.toFixed(1) + '" y1="' + item.anchorY.toFixed(1) + '" x2="' + item.x.toFixed(1) + '" y2="' + item.y.toFixed(1) + '"></line>'
        : '';
      var visibleLabel = isContinent ? label + ' · ' + detail : (featured ? '대한민국 · KOR' : code);
      return leader + '<g class="world-cluster ' + (isContinent ? 'is-continent' : 'is-country') + ' continent-' + tone + (featured ? ' is-korea' : '') + '" role="button" tabindex="0" aria-label="' + esc(label) + ' ' + cluster.count + '개" ' + dataAttribute + ' transform="translate(' + item.x.toFixed(1) + ' ' + item.y.toFixed(1) + ')"><title>' + esc(label) + ' · ' + cluster.count + '개</title><circle class="world-cluster-halo" r="' + (radius + 6).toFixed(1) + '"></circle><circle class="world-cluster-body" r="' + radius.toFixed(1) + '"></circle><text class="world-cluster-count" y="4">' + cluster.count + '</text><text class="world-cluster-label" y="' + (radius + 13).toFixed(1) + '">' + esc(visibleLabel) + '</text></g>';
    }).join('');
    var levelLabel = continentLevel ? '대륙' : '국가';
    var canZoomOut = state.dotZoom > 1 || Boolean(state.scope.continentCode);
    return '<svg class="global-world-svg" data-global-dot-map viewBox="' + dotViewBox(layout) + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="사각 도트 세계지도의 ' + levelLabel + '별 자산 군집"><g class="world-grid">' + pixelLandHtml() + '</g><g class="world-dots">' + dots + '</g></svg><div class="global-dot-controls" aria-label="도트 지도 확대 축소"><button type="button" data-global-map-action="dot-zoom-out" title="축소" aria-label="도트 지도 축소"' + (canZoomOut ? '' : ' disabled') + '>-</button><span>' + levelLabel + '</span><button type="button" data-global-map-action="dot-zoom-in" title="확대" aria-label="도트 지도 확대">+</button></div><div class="global-world-caption"><span><b>' + rows.length + '</b>개 좌표</span><span>' + (continentLevel ? '대륙을 선택하면 국가별로 나뉩니다.' : '국가를 선택하면 오픈소스 상세지도로 이동합니다.') + '</span></div>';
  }

  function locationLabel(row) {
    return [row.normalized_city || row.raw_city, row.normalized_admin1, row.normalized_country_name].filter(Boolean).join(' · ') || row.portfolio_region || '지역 미확인';
  }

  function renderWorldList(rows) {
    var list = document.getElementById('globalMapList');
    if (!list) return;
    var showContinents = !state.scope.continentCode && state.dotZoom < 1.5;
    if (showContinents) {
      var continentGroups = new Map();
      rows.forEach(function (row) {
        var continentCode = Core.continentForRow(row);
        var group = continentGroups.get(continentCode) || { code: continentCode, count: 0, pointCount: 0, countries: new Set(), koreaCount: 0 };
        group.count += 1;
        if (Core.hasCoordinatePair(row)) group.pointCount += 1;
        if (row.country_code_alpha3) group.countries.add(row.country_code_alpha3);
        if (row.country_code_alpha3 === 'KOR') group.koreaCount += 1;
        continentGroups.set(continentCode, group);
      });
      var continents = Array.from(continentGroups.values()).sort(function (a, b) { return b.count - a.count || continentName(a.code).localeCompare(continentName(b.code), 'ko'); });
      list.innerHTML = '<div class="global-map-list-heading"><strong>대륙별 관리 대상</strong><span>' + continents.length + '개 권역</span></div>' + continents.map(function (group) {
        var korea = group.koreaCount ? ' · 한국 ' + group.koreaCount : '';
        return '<button type="button" class="global-map-country-row global-map-continent-row" data-global-map-continent="' + esc(group.code) + '"><span><b>' + esc(continentName(group.code)) + '</b><small>' + group.countries.size + '개국 · 좌표 ' + group.pointCount + korea + '</small></span><strong>' + group.count + '</strong></button>';
      }).join('') + '<div class="global-map-nonpoint"><strong>지도 밖 관리 대상</strong><span>좌표가 없는 자산과 비단일 위치 대상은 필터별 합계로 관리합니다.</span></div>';
      return;
    }
    var groups = new Map();
    rows.forEach(function (row) {
      var code = row.country_code_alpha3 || '__unknown_country__';
      var group = groups.get(code) || { code: code, count: 0, pointCount: 0 };
      group.count += 1;
      if (Core.hasCoordinatePair(row)) group.pointCount += 1;
      groups.set(code, group);
    });
    var countries = Array.from(groups.values()).sort(function (a, b) { return b.count - a.count || countryName(a.code).localeCompare(countryName(b.code), 'ko'); });
    var nonPointCounts = Core.summarize(rows.filter(function (row) { return !Core.hasCoordinatePair(row); }));
    list.innerHTML = [
      '<div class="global-map-list-heading"><strong>', state.scope.continentCode ? esc(continentName(state.scope.continentCode)) + ' 국가별' : '국가별 관리 대상', '</strong><span>', countries.length, '개 그룹</span></div>',
      countries.map(function (group) {
        return '<button type="button" class="global-map-country-row" data-global-map-country="' + esc(group.code) + '"><span><b>' + esc(countryName(group.code)) + '</b><small>' + (group.code === '__unknown_country__' ? 'ISO 미확인' : esc(group.code)) + ' · 좌표 ' + group.pointCount + '</small></span><strong>' + group.count + '</strong></button>';
      }).join('') || '<p class="global-map-empty">선택한 조건의 관리 대상이 없습니다.</p>',
      '<div class="global-map-nonpoint"><strong>지도 밖 관리 대상</strong><span>도시 정보만 ' + nonPointCounts.city_text + ' · 비단일 ' + nonPointCounts.aggregate_only + ' · 근거 부족 ' + nonPointCounts.insufficient + '</span></div>'
    ].join('');
  }

  function renderDetailList(rows) {
    var list = document.getElementById('globalMapList');
    if (!list) return;
    var cities = new Map();
    rows.forEach(function (row) {
      var city = row.normalized_city || row.raw_city || '도시 미확인';
      cities.set(city, (cities.get(city) || 0) + 1);
    });
    var cityButtons = Array.from(cities.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }).map(function (entry) {
      var cityValue = entry[0] === '도시 미확인' ? '__unknown__' : entry[0];
      var active = state.scope.city === cityValue;
      return '<button type="button" class="global-map-city-row' + (active ? ' active' : '') + '" data-global-map-city="' + esc(cityValue) + '" aria-pressed="' + active + '"><span>' + esc(entry[0]) + '</span><b>' + entry[1] + '</b></button>';
    }).join('');
    var assets = rows.slice().sort(function (a, b) {
      return Core.classifyLocation(a).rank - Core.classifyLocation(b).rank || String(a.canonical_name).localeCompare(String(b.canonical_name), 'ko');
    }).map(function (row) {
      var tier = Core.classifyLocation(row);
      return '<button type="button" class="global-map-asset-row tier-' + tier.tone + '" data-global-map-asset="' + esc(row.asset_id) + '"><i></i><span><b>' + esc(row.canonical_name) + '</b><small>' + esc(locationLabel(row)) + '</small></span><em>' + esc(tier.label) + '</em></button>';
    }).join('');
    list.innerHTML = '<div class="global-map-list-heading"><strong>도시</strong><span>' + cities.size + '개</span></div><div class="global-map-city-list">' + cityButtons + '</div><div class="global-map-list-heading"><strong>자산</strong><span>' + rows.length + '개</span></div>' + (assets || '<p class="global-map-empty">선택한 조건의 자산이 없습니다.</p>');
  }

  function ensureMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (window.__globalMapLibrePromise) return window.__globalMapLibrePromise;
    window.__globalMapLibrePromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-global-maplibre]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.7.1/dist/maplibre-gl.css';
        link.integrity = 'sha384-gNYNsUmuZqDYiT3gbirWTV5K7rt71RoveS/yXAaU09d4ZUmeDVTD3XoqB6uJAIFR';
        link.crossOrigin = 'anonymous';
        link.dataset.globalMaplibre = '';
        document.head.appendChild(link);
      }
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.7.1/dist/maplibre-gl.js';
      script.integrity = 'sha384-gLKaKK6bcaV7wXNta/DHnECgiF2+mF15OXviE93B/+Q4CI68+ivYMRY4utfeUOTN';
      script.crossOrigin = 'anonymous';
      script.onload = function () { resolve(window.maplibregl); };
      script.onerror = function () { reject(new Error('상세 지도 라이브러리를 불러오지 못했습니다.')); };
      document.head.appendChild(script);
    });
    return window.__globalMapLibrePromise;
  }

  function mapStyle() {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap contributors' } },
      layers: [{
        id: 'osm',
        type: 'raster',
        source: 'osm',
        minzoom: 0,
        maxzoom: 19,
        paint: {
          'raster-saturation': -0.72,
          'raster-contrast': 0.16,
          'raster-brightness-min': 0.12,
          'raster-brightness-max': 0.72
        }
      }]
    };
  }

  function renderFallbackPlot(rows, message) {
    var canvas = document.getElementById('globalMapCanvas');
    if (!canvas) return;
    var minLon = Math.min.apply(null, rows.map(function (row) { return Number(row.longitude); }));
    var maxLon = Math.max.apply(null, rows.map(function (row) { return Number(row.longitude); }));
    var minLat = Math.min.apply(null, rows.map(function (row) { return Number(row.latitude); }));
    var maxLat = Math.max.apply(null, rows.map(function (row) { return Number(row.latitude); }));
    if (minLon === maxLon) { minLon -= 1; maxLon += 1; }
    if (minLat === maxLat) { minLat -= 1; maxLat += 1; }
    var dots = rows.map(function (row) {
      var x = 60 + ((Number(row.longitude) - minLon) / (maxLon - minLon)) * 880;
      var y = 440 - ((Number(row.latitude) - minLat) / (maxLat - minLat)) * 380;
      var tier = Core.classifyLocation(row);
      return '<g role="button" tabindex="0" data-global-map-asset="' + esc(row.asset_id) + '" class="fallback-dot tier-' + tier.tone + '" transform="translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')"><circle r="7"></circle></g>';
    }).join('');
    canvas.innerHTML = '<div class="global-map-fallback-note">' + esc(message || '배경지도 없이 상대적 위치만 표시합니다.') + '</div><svg class="global-map-fallback-svg" viewBox="0 0 1000 500" aria-label="선택 국가의 상대적 자산 위치">' + dots + '</svg>';
    state.mapBase = 'coordinate-fallback';
    state.renderedMarkerCount = rows.length;
    updateBaseBadge('좌표 개념도');
  }

  function updateBaseBadge(label) {
    var badge = document.getElementById('globalMapBaseBadge');
    if (badge) badge.textContent = label;
  }

  function clearMapLibreOverviewMarkers() {
    state.markers.forEach(function (marker) {
      if (marker && typeof marker.remove === 'function') marker.remove();
    });
    state.markers = [];
  }

  function overviewMarkerDiameter(cluster, level) {
    var featured = cluster.countryCode === 'KOR';
    var radius = clusterRadius(cluster.count, level, featured);
    return Math.round(Math.max(level === 'continent' ? 78 : 44, radius * 2.05));
  }

  function renderMapLibreOverviewMarkers(map, maplibregl, rows, generation, mapRoot) {
    var renderedLevel = '';

    function draw() {
      if (generation !== state.generation || state.map !== map) return;
      var level = state.scope.continentCode || map.getZoom() >= 2.65 ? 'country' : 'continent';
      if (level === renderedLevel) return;
      renderedLevel = level;
      clearMapLibreOverviewMarkers();
      var clusters = level === 'continent' ? Core.buildContinentClusters(rows) : Core.buildCountryClusters(rows);
      state.markers = clusters.map(function (cluster) {
        var isContinent = level === 'continent';
        var code = isContinent ? cluster.continentCode : cluster.countryCode;
        var label = isContinent ? cluster.label : countryName(code, rows);
        var tone = continentTone(cluster.continentCode || Core.continentForRow({ country_code_alpha3: code }));
        var markerElement = document.createElement('button');
        markerElement.type = 'button';
        markerElement.className = 'global-maplibre-overview-marker is-' + level + ' continent-' + tone + (code === 'KOR' ? ' is-korea' : '');
        markerElement.style.setProperty('--overview-marker-size', overviewMarkerDiameter(cluster, level) + 'px');
        markerElement.setAttribute('aria-label', label + ' ' + cluster.count + '개, 상세 보기');
        markerElement.title = label + ' · ' + cluster.count + '개';
        markerElement.innerHTML = '<strong>' + cluster.count + '</strong><span>' + esc(isContinent ? label : code) + '</span>';
        markerElement.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (isContinent) openContinentDetail(code);
          else openCountry(code);
        });
        return new maplibregl.Marker({ element: markerElement, anchor: 'center' })
          .setLngLat([Number(cluster.longitude), Number(cluster.latitude)])
          .addTo(map);
      });
      state.renderedMarkerCount = clusters.length;
      mapRoot.dataset.raOverviewLevel = level;
      mapRoot.dataset.raRenderedMarkers = String(clusters.length);
      updateBaseBadge(level === 'continent' ? 'OpenStreetMap · 대륙' : 'OpenStreetMap · 국가');
    }

    draw();
    map.on('zoomend', draw);
  }

  function returnToWorldFromDetail(generation) {
    if (generation !== state.generation || !state.active || !isDetailStage()) return;
    if (state.scope.countryCode) {
      state.scope = { continentCode: state.scope.continentCode || '', countryCode: '', city: '' };
      state.dotZoom = 1.8;
    } else {
      state.scope.city = '';
      state.dotZoom = state.scope.continentCode ? 1.8 : 1;
    }
    state.detailMode = false;
    state.selectedAssetId = '';
    state.inspectorOpener = null;
    state.generation += 1;
    disposeMap();
    render();
  }

  function renderMapLibre(rows, generation) {
    var canvas = document.getElementById('globalMapCanvas');
    if (!canvas || !rows.length) {
      if (canvas) canvas.innerHTML = '<p class="global-map-empty">선택한 조건의 좌표가 없습니다.</p>';
      return;
    }
    canvas.innerHTML = '<div id="globalMapLibre" class="global-maplibre" aria-label="선택 지역 상세 지도"></div>' +
      '<div id="globalMapTileStatus" class="global-map-tile-status" hidden>배경지도를 불러오지 못해 좌표만 표시합니다.</div>';
    ensureMapLibre().then(function (maplibregl) {
      if (generation !== state.generation || !state.active || !document.getElementById('globalMapLibre')) return;
      disposeMap();
      var mapRoot = document.getElementById('globalMapLibre');
      mapRoot.dataset.raMapStage = 'creating';
      var map = new maplibregl.Map({
        container: 'globalMapLibre',
        style: mapStyle(),
        center: [Number(rows[0].longitude), Number(rows[0].latitude)],
        zoom: rows.length === 1 ? Math.min(14, Core.maxZoomForPrecision(rows[0].coordinate_precision)) : 3,
        minZoom: 0,
        maxZoom: 19,
        attributionControl: true
      });
      state.map = map;
      state.mapBase = 'maplibre-osm';
      state.renderedMarkerCount = rows.length;
      state.tileFailed = false;
      updateBaseBadge('OpenStreetMap · 상세');
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      var allowZoomOutReturn = false;
      map.on('zoomend', function () {
        if (generation !== state.generation || state.map !== map) return;
        if (!allowZoomOutReturn) return;
        var shouldReturn = state.scope.continentCode || state.scope.countryCode
          ? Core.shouldReturnToWorld(map.getZoom())
          : map.getZoom() <= 1.05;
        if (shouldReturn) returnToWorldFromDetail(generation);
      });
      map.on('error', function (event) {
        if (event && event.error && /tile|source|network|fetch/i.test(String(event.error.message || event.error))) {
          if (generation !== state.generation || state.map !== map || state.tileFailed) return;
          disposeMap();
          state.tileFailed = true;
          renderFallbackPlot(rows, '배경지도 연결에 실패해 좌표만 표시합니다.');
        }
      });
      map.once('load', function () {
        if (generation !== state.generation || state.map !== map) return;
        mapRoot.dataset.raMapStage = 'style-loaded';
        var bounds = new maplibregl.LngLatBounds();
        var features = rows.map(function (row) {
          var tier = Core.classifyLocation(row);
          var coordinates = [Number(row.longitude), Number(row.latitude)];
          bounds.extend(coordinates);
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coordinates },
            properties: { assetId: String(row.asset_id), name: String(row.canonical_name || ''), tone: tier.tone }
          };
        });
        map.addSource('ra-assets', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: features },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 58
        });
        mapRoot.dataset.raMapFeatures = String(features.length);
        map.addLayer({
          id: 'ra-asset-clusters',
          type: 'circle',
          source: 'ra-assets',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#2196df',
            'circle-opacity': 0.58,
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 27, 50, 35, 200, 45],
            'circle-stroke-color': 'rgba(255,255,255,.92)',
            'circle-stroke-width': 2
          }
        });
        mapRoot.dataset.raMapStage = 'layers-ready';
        map.addLayer({
          id: 'ra-asset-cluster-count',
          type: 'symbol',
          source: 'ra-assets',
          filter: ['has', 'point_count'],
          layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Open Sans Bold'] },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(13,20,23,.55)', 'text-halo-width': 1 }
        });
        map.addLayer({
          id: 'ra-asset-points',
          type: 'circle',
          source: 'ra-assets',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['match', ['get', 'tone'], 'verified', '#36aef6', 'candidate', '#ffbd4a', 'area', '#ff8d3a', 'uncertain', '#a8b7c7', '#8f9aa7'],
            'circle-opacity': 0.68,
            'circle-radius': 10,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
          }
        });
        map.on('click', 'ra-asset-clusters', function (event) {
          var feature = event.features && event.features[0];
          if (!feature) return;
          map.easeTo({ center: feature.geometry.coordinates, zoom: Math.min(19, map.getZoom() + 2), duration: 420 });
        });
        map.on('click', 'ra-asset-points', function (event) {
          var feature = event.features && event.features[0];
          if (feature && feature.properties) selectAsset(feature.properties.assetId);
        });
        ['ra-asset-clusters', 'ra-asset-points'].forEach(function (layerId) {
          map.on('mouseenter', layerId, function () { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layerId, function () { map.getCanvas().style.cursor = ''; });
        });
        map.on('idle', function () {
          if (generation !== state.generation || state.map !== map) return;
          var sourceFeatures = map.querySourceFeatures('ra-assets');
          var renderedFeatures = map.queryRenderedFeatures(undefined, { layers: ['ra-asset-clusters', 'ra-asset-points'] });
          mapRoot.dataset.raSourceFeatures = String(sourceFeatures.length);
          mapRoot.dataset.raRenderedFeatures = String(renderedFeatures.length);
        });
        if (rows.length === 1) {
          map.jumpTo({ center: bounds.getCenter(), zoom: Math.min(14, Core.maxZoomForPrecision(rows[0].coordinate_precision)) });
        } else {
          var fitZoom = state.scope.city ? 13 : (state.scope.countryCode ? 11 : (state.scope.continentCode ? 6 : 3));
          map.fitBounds(bounds, { padding: 56, maxZoom: fitZoom, duration: 0 });
        }
        if (!state.scope.countryCode) renderMapLibreOverviewMarkers(map, maplibregl, rows, generation, mapRoot);
        window.setTimeout(function () { allowZoomOutReturn = true; }, 700);
      });
    }).catch(function (error) {
      if (generation !== state.generation || !state.active) return;
      renderFallbackPlot(rows, error.message);
    });
  }

  function renderVWorld(rows, generation) {
    var canvas = document.getElementById('globalMapCanvas');
    if (!canvas || !rows.length) {
      if (canvas) canvas.innerHTML = '<p class="global-map-empty">선택한 조건의 좌표가 없습니다.</p>';
      return;
    }
    if (typeof window.vw === 'undefined' || !window.vw.ol3 || typeof window.ol === 'undefined') {
      renderFallbackPlot(rows, 'VWorld를 불러오지 못해 좌표만 표시합니다.');
      return;
    }
    canvas.innerHTML = '<div id="globalVWorld" class="global-maplibre" aria-label="국내 자산 VWorld 상세 지도"></div>';
    window.setTimeout(function () {
      if (generation !== state.generation || !state.active || !document.getElementById('globalVWorld')) return;
      try {
        disposeMap();
        var map = new window.vw.ol3.Map('globalVWorld', {
          basemapType: window.vw.ol3.BasemapType.GRAPHIC,
          controlDensity: window.vw.ol3.DensityType.EMPTY,
          interactionDensity: window.vw.ol3.DensityType.BASIC,
          homePosition: window.vw.ol3.CameraPosition,
          initPosition: window.vw.ol3.CameraPosition
        });
        var features = rows.map(function (row) {
          var tier = Core.classifyLocation(row);
          var feature = new window.ol.Feature({
            geometry: new window.ol.geom.Point(window.ol.proj.fromLonLat([Number(row.longitude), Number(row.latitude)])),
            assetId: row.asset_id,
            tone: tier.tone
          });
          return feature;
        });
        var source = new window.ol.source.Vector({ features: features });
        var clusterSource = new window.ol.source.Cluster({ distance: 54, minDistance: 16, source: source });
        var styleCache = {};
        map.addLayer(new window.ol.layer.Vector({
          source: clusterSource,
          style: function (clusterFeature) {
            var members = clusterFeature.get('features') || [];
            var count = members.length || 1;
            var tone = count === 1 ? members[0].get('tone') : 'cluster';
            var key = tone + ':' + count;
            if (styleCache[key]) return styleCache[key];
            var fill = tone === 'verified' ? 'rgba(54,174,246,.68)'
              : (tone === 'candidate' ? 'rgba(255,189,74,.62)'
                : (tone === 'area' ? 'rgba(255,141,58,.62)'
                  : (tone === 'uncertain' ? 'rgba(168,183,199,.58)' : 'rgba(33,150,223,.58)')));
            var radius = count > 1 ? Math.min(38, 14 + Math.sqrt(count) * 2.1) : 10;
            styleCache[key] = new window.ol.style.Style({
              image: new window.ol.style.Circle({
                radius: radius,
                fill: new window.ol.style.Fill({ color: fill }),
                stroke: new window.ol.style.Stroke({ color: 'rgba(255,255,255,.94)', width: 2 })
              }),
              text: count > 1 ? new window.ol.style.Text({
                text: String(count),
                fill: new window.ol.style.Fill({ color: '#ffffff' }),
                stroke: new window.ol.style.Stroke({ color: 'rgba(13,20,23,.6)', width: 3 }),
                font: '700 13px sans-serif'
              }) : undefined
            });
            return styleCache[key];
          }
        }));
        state.map = map;
        state.markers = features;
        state.mapBase = 'vworld-graphic';
        state.renderedMarkerCount = rows.length;
        updateBaseBadge('VWorld · 국내 상세');
        map.on('singleclick', function (event) {
          var selected = null;
          map.forEachFeatureAtPixel(event.pixel, function (feature) { selected = feature; return true; });
          if (!selected) return;
          var members = selected.get('features') || [];
          if (members.length === 1) {
            selectAsset(members[0].get('assetId'));
            return;
          }
          if (members.length > 1) {
            var currentZoom = map.getView().getZoom() || 6;
            if (typeof map.updateSize === 'function') map.updateSize();
            var targetView = map.getView();
            var targetCenter = selected.getGeometry().getCoordinates();
            var targetZoom = Math.min(19, currentZoom + 1.25);
            if (typeof targetView.animate === 'function') {
              targetView.animate({ center: targetCenter, zoom: targetZoom, duration: 360 });
            } else {
              targetView.setCenter(targetCenter);
              targetView.setZoom(targetZoom);
            }
          }
        });
        var view = map.getView();
        if (typeof view.setMaxZoom === 'function') view.setMaxZoom(19);
        var extent = window.ol.extent.boundingExtent(features.map(function (feature) { return feature.getGeometry().getCoordinates(); }));
        function applyInitialView() {
          if (generation !== state.generation || state.map !== map) return;
          if (typeof map.updateSize === 'function') map.updateSize();
          if (features.length === 1) {
            view.setCenter(features[0].getGeometry().getCoordinates());
            view.setZoom(Math.min(16, Core.maxZoomForPrecision(rows[0].coordinate_precision)));
          } else if (state.scope.countryCode === 'KOR' && !state.scope.city) {
            view.setCenter(window.ol.proj.fromLonLat([127.75, 36.25]));
            view.setZoom(6.65);
          } else {
            view.fit(extent, {
              size: typeof map.getSize === 'function' ? map.getSize() : undefined,
              padding: [64, 64, 64, 64],
              maxZoom: state.scope.city ? 15 : 12,
              duration: 0
            });
          }
        }
        applyInitialView();
        window.setTimeout(applyInitialView, 160);
        if (typeof view.on === 'function') {
          view.on('change:resolution', function () {
            if (generation !== state.generation || state.map !== map) return;
            if (Core.shouldReturnToWorld(view.getZoom())) returnToWorldFromDetail(generation);
          });
        }
      } catch (error) {
        if (generation !== state.generation || !state.active) return;
        renderFallbackPlot(rows, 'VWorld 초기화에 실패해 좌표만 표시합니다.');
      }
    }, 0);
  }

  function inspectorHtml(row) {
    var tier = Core.classifyLocation(row);
    var confidence = Number(row.coordinate_confidence);
    var confidenceText = Number.isFinite(confidence) ? Math.round(confidence * 100) + '%' : '-';
    return [
      '<button type="button" class="global-map-inspector-close" data-global-map-action="close-inspector" aria-label="자산 위치 상세 닫기">×</button>',
      '<p>LOCATION DETAIL</p><h2 id="globalMapInspectorTitle">', esc(row.canonical_name), '</h2><span class="global-map-inspector-tier tier-', tier.tone, '">', esc(tier.label), '</span>',
      '<dl><div><dt>표시 위치</dt><dd>', esc(locationLabel(row)), '</dd></div><div><dt>좌표 정밀도</dt><dd>', esc(row.coordinate_precision || 'unknown'), '</dd></div><div><dt>신뢰도</dt><dd>', confidenceText, '</dd></div><div><dt>좌표 출처</dt><dd>', esc(row.coordinate_source || '-'), '</dd></div><div><dt>상태</dt><dd>', esc(row.location_status_label || tier.label), '</dd></div></dl>',
      '<p class="global-map-precision-note">자동 이동은 좌표 정밀도에 맞춰 ', Core.maxZoomForPrecision(row.coordinate_precision), '레벨까지 적용하며, 지도는 수동으로 더 확대할 수 있습니다.</p>'
    ].join('');
  }

  function selectAsset(assetId, opener) {
    var row = state.rows.find(function (candidate) { return String(candidate.asset_id) === String(assetId); });
    if (!row) return;
    state.selectedAssetId = row.asset_id;
    state.inspectorOpener = opener && typeof opener.focus === 'function' ? opener : document.activeElement;
    var inspector = document.getElementById('globalMapInspector');
    if (inspector) {
      inspector.innerHTML = inspectorHtml(row);
      inspector.hidden = false;
      var close = inspector.querySelector('.global-map-inspector-close');
      if (close) close.focus();
    }
    if (state.map && state.mapBase === 'maplibre-osm' && Core.hasCoordinatePair(row)) {
      var zoom = Math.min(Core.maxZoomForPrecision(row.coordinate_precision), row.coordinate_precision === 'unknown' ? 8 : 15);
      state.map.easeTo({ center: [Number(row.longitude), Number(row.latitude)], zoom: zoom, duration: 450 });
    } else if (state.map && state.mapBase === 'vworld-graphic' && Core.hasCoordinatePair(row) && state.map.getView) {
      var targetView = state.map.getView();
      var targetCenter = window.ol.proj.fromLonLat([Number(row.longitude), Number(row.latitude)]);
      var targetZoom = Math.min(15, Core.maxZoomForPrecision(row.coordinate_precision));
      if (typeof targetView.animate === 'function') targetView.animate({ center: targetCenter, zoom: targetZoom, duration: 450 });
      else {
        targetView.setCenter(targetCenter);
        targetView.setZoom(targetZoom);
      }
    }
  }

  function closeInspector() {
    var inspector = document.getElementById('globalMapInspector');
    if (!inspector || inspector.hidden) return;
    inspector.hidden = true;
    state.selectedAssetId = '';
    var opener = state.inspectorOpener;
    state.inspectorOpener = null;
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  function render() {
    if (!state.active) return;
    var panel = document.getElementById('detailPanel');
    if (!panel) return;
    disposeMap();
    var rows = filteredRows();
    state.filteredRows = rows;
    panel.innerHTML = shellHtml(rows);
    if (!isDetailStage()) {
      state.mapBase = 'concept-svg';
      document.getElementById('globalMapCanvas').innerHTML = worldHtml(rows.filter(Core.hasCoordinatePair));
      state.renderedMarkerCount = state.scope.continentCode || state.dotZoom >= 1.5
        ? Core.buildCountryClusters(rows.filter(Core.hasCoordinatePair)).length
        : Core.buildContinentClusters(rows.filter(Core.hasCoordinatePair)).length;
      renderWorldList(rows);
      updateBaseBadge(state.scope.continentCode ? '도트 국가 지도' : '도트 세계지도');
    } else {
      var coordinateRows = rows.filter(Core.hasCoordinatePair);
      if (state.scope.countryCode) renderDetailList(rows);
      else renderWorldList(rows);
      if (state.scope.countryCode === 'KOR') renderVWorld(coordinateRows, state.generation);
      else renderMapLibre(coordinateRows, state.generation);
    }
  }

  function openContinent(code) {
    state.scope = { continentCode: code, countryCode: '', city: '' };
    state.detailMode = false;
    state.dotZoom = 1.8;
    state.selectedAssetId = '';
    state.generation += 1;
    render();
  }

  function openContinentDetail(code) {
    state.scope = { continentCode: code, countryCode: '', city: '' };
    state.detailMode = true;
    state.dotZoom = 3;
    state.selectedAssetId = '';
    state.generation += 1;
    render();
  }

  function openCountry(code) {
    var matchingRow = state.rows.find(function (row) {
      return code === '__unknown_country__' ? !row.country_code_alpha3 : row.country_code_alpha3 === code;
    });
    state.scope = {
      continentCode: state.scope.continentCode || (matchingRow ? Core.continentForRow(matchingRow) : ''),
      countryCode: code,
      city: ''
    };
    state.detailMode = true;
    state.dotZoom = 3;
    state.selectedAssetId = '';
    state.generation += 1;
    render();
  }

  function openCity(city) {
    state.scope.city = city;
    state.detailMode = true;
    state.selectedAssetId = '';
    state.generation += 1;
    render();
  }

  function adjustDotZoom(direction) {
    if (direction > 0) {
      state.dotZoom = Math.min(3, state.dotZoom + 0.65);
      if (state.dotZoom >= 2.75) state.detailMode = true;
    } else {
      if (state.detailMode) {
        state.detailMode = false;
        state.dotZoom = state.scope.continentCode ? 2.1 : 1.7;
      } else if (state.dotZoom > 1.1) {
        state.dotZoom = Math.max(1, state.dotZoom - 0.65);
      } else if (state.scope.continentCode) {
        state.scope = emptyScope();
        state.dotZoom = 1;
      }
    }
    state.selectedAssetId = '';
    state.generation += 1;
    render();
  }

  document.addEventListener('click', function (event) {
    if (!state.active) return;
    var action = event.target.closest('[data-global-map-action]');
    if (action) {
      var name = action.dataset.globalMapAction;
      if (name === 'retry') retry();
      if (name === 'refresh') { state.rows = []; retry(); }
      if (name === 'close-inspector') closeInspector();
      if (name === 'dot-zoom-in') adjustDotZoom(1);
      if (name === 'dot-zoom-out') adjustDotZoom(-1);
      return;
    }
    var continent = event.target.closest('[data-global-map-continent]');
    if (continent) { openContinent(continent.dataset.globalMapContinent); return; }
    var country = event.target.closest('[data-global-map-country]');
    if (country) { openCountry(country.dataset.globalMapCountry); return; }
    var city = event.target.closest('[data-global-map-city]');
    if (city) { openCity(city.dataset.globalMapCity); return; }
    var scope = event.target.closest('[data-global-map-scope]');
    if (scope) {
      if (scope.dataset.globalMapScope === 'world') {
        state.scope = emptyScope();
        state.dotZoom = 1;
        state.detailMode = false;
      } else if (scope.dataset.globalMapScope === 'continent') {
        state.scope = { continentCode: state.scope.continentCode, countryCode: '', city: '' };
        state.dotZoom = 1.8;
        state.detailMode = false;
      } else {
        state.scope.city = '';
        state.detailMode = true;
      }
      state.generation += 1; render(); return;
    }
    var tier = event.target.closest('[data-global-map-tier]');
    if (tier) {
      var value = tier.dataset.globalMapTier;
      if (state.selectedTiers.has(value)) state.selectedTiers.delete(value); else state.selectedTiers.add(value);
      state.generation += 1; render(); return;
    }
    var asset = event.target.closest('[data-global-map-asset]');
    if (asset) selectAsset(asset.dataset.globalMapAsset, asset);
  });

  document.addEventListener('keydown', function (event) {
    if (!state.active) return;
    var target = event.target.closest && event.target.closest('[role="button"][data-global-map-continent], [role="button"][data-global-map-country], [role="button"][data-global-map-asset]');
    if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); target.click(); }
    if (event.key === 'Escape') {
      closeInspector();
    }
  });

  document.addEventListener('wheel', function (event) {
    if (!state.active || isDetailStage() || !event.target.closest || !event.target.closest('[data-global-dot-map]')) return;
    event.preventDefault();
    var now = Date.now();
    if (state.lastDotWheelAt && now - state.lastDotWheelAt < 180) return;
    state.lastDotWheelAt = now;
    adjustDotZoom(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener('input', function (event) {
    if (!state.active || !event.target.matches('[data-global-map-search]')) return;
    state.query = event.target.value;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(function () {
      state.generation += 1;
      render();
      var input = document.querySelector('[data-global-map-search]');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }, 160);
  });

  function audit() {
    return {
      active: state.active,
      sourceCount: state.rows.length,
      filteredCount: state.filteredRows.length,
      summary: Core.summarize(state.rows),
      source: state.source,
      scope: Object.assign({}, state.scope),
      mapBase: state.mapBase,
      markerCount: state.renderedMarkerCount,
      selectedAssetId: state.selectedAssetId,
      zoomCap: state.mapBase === 'maplibre-osm' && state.map && typeof state.map.getMaxZoom === 'function'
        ? state.map.getMaxZoom()
        : (state.mapBase === 'vworld-graphic' && state.map && state.map.getView && state.map.getView().getMaxZoom ? state.map.getView().getMaxZoom() : null),
      tileFailed: state.tileFailed,
      loadStatus: state.loadStatus
    };
  }

  window.GlobalAssetMap = { activate: activate, deactivate: deactivate, retry: retry, restore: restore, audit: audit };
})();
