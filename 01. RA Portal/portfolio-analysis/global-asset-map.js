(function () {
  'use strict';

  var Core = window.GlobalAssetMapCore;
  if (!Core) return;

  var state = {
    active: false,
    generation: 0,
    rows: [],
    filteredRows: [],
    selectedTiers: new Set(['verified', 'candidate_asset', 'local_area', 'uncertain_point']),
    scope: { countryCode: '', city: '' },
    query: '',
    map: null,
    markers: [],
    controller: null,
    selectedAssetId: '',
    inspectorOpener: null,
    mapBase: 'concept-svg',
    tileFailed: false,
    renderedMarkerCount: 0
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

  async function fetchRows(generation) {
    var token = '';
    if (window.RAAuth && typeof window.RAAuth.getSessionToken === 'function') token = window.RAAuth.getSessionToken();
    else if (window.RAAuth && typeof window.RAAuth.getRememberToken === 'function') token = window.RAAuth.getRememberToken();
    if (!token) throw new Error('로그인 세션을 확인할 수 없습니다. Portal에 다시 로그인해 주세요.');
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    var response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: token }),
      cache: 'no-store',
      signal: state.controller.signal
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || data.ok === false) throw new Error(data.error || '위치 API 응답을 확인할 수 없습니다.');
    if (generation !== state.generation || !state.active) return null;
    if (!Array.isArray(data.assets) || data.assets.length > 10000 || data.count !== data.assets.length) throw new Error('위치 데이터 형식이 올바르지 않습니다.');
    data.assets.forEach(function (row) {
      var computed = Core.classifyLocation(row).tier;
      if (computed !== row.location_tier) throw new Error('위치 단계 계약이 일치하지 않습니다: ' + String(row.asset_id || 'unknown'));
    });
    return data.assets;
  }

  function activate() {
    state.active = true;
    state.generation += 1;
    state.scope = { countryCode: '', city: '' };
    state.query = '';
    state.selectedAssetId = '';
    state.mapBase = 'concept-svg';
    document.body.classList.add('global-asset-map-mode');
    var panel = document.getElementById('detailPanel');
    if (!panel) return;
    disposeMap();
    panel.innerHTML = loadingHtml();
    var generation = state.generation;
    if (state.rows.length) {
      render();
      return;
    }
    fetchRows(generation).then(function (rows) {
      if (!rows || generation !== state.generation || !state.active) return;
      state.rows = rows;
      render();
    }).catch(function (error) {
      if (error && error.name === 'AbortError') return;
      if (generation !== state.generation || !state.active) return;
      panel.innerHTML = errorHtml(error.message || error);
    });
  }

  function retry() {
    state.rows = [];
    activate();
  }

  function countryName(code, rows) {
    if (code === '__unknown_country__') return '국가 미확인';
    var fromRow = (rows || state.rows).find(function (row) { return row.country_code_alpha3 === code && row.normalized_country_name; });
    return COUNTRY_NAMES[code] || (fromRow && fromRow.normalized_country_name) || code || '국가 미확인';
  }

  function filteredRows() {
    var query = state.query.trim().toLocaleLowerCase('ko');
    return state.rows.filter(function (row) {
      if (!state.selectedTiers.has(Core.classifyLocation(row).tier)) return false;
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
    if (state.scope.countryCode) parts.push('<span>/</span><button type="button" data-global-map-scope="country">' + esc(countryName(state.scope.countryCode)) + '</button>');
    if (state.scope.city) parts.push('<span>/</span><strong>' + esc(state.scope.city === '__unknown__' ? '도시 미확인' : state.scope.city) + '</strong>');
    return '<nav class="global-map-breadcrumbs" aria-label="지도 위치 경로">' + parts.join('') + '</nav>';
  }

  function shellHtml(rows) {
    var counts = Core.summarize(state.rows);
    var stage = state.scope.countryCode ? (state.scope.city ? '도시·자산 상세' : '국가·도시 상세') : '글로벌 개요';
    return [
      '<main class="global-asset-map" data-map-stage="', state.scope.countryCode ? 'detail' : 'world', '">',
      '<header class="global-map-header">',
      '<div>', breadcrumbsHtml(), '<p>GLOBAL ASSET LOCATION</p><h1>글로벌 자산 위치</h1><span>', stage, ' · 위치 정밀도보다 과도하게 확대하지 않습니다.</span></div>',
      '<div class="global-map-header-actions"><label><span>자산 검색</span><input type="search" data-global-map-search value="', esc(state.query), '" placeholder="자산·도시·국가"></label><button type="button" data-global-map-action="refresh">새로고침</button></div>',
      '</header>',
      summaryHtml(counts),
      '<section class="global-map-workspace">',
      '<aside class="global-map-sidebar"><div class="global-map-tier-filters" role="group" aria-label="위치 정밀도 필터">', tierFiltersHtml(counts), '</div><div id="globalMapList" class="global-map-list"></div></aside>',
      '<section class="global-map-canvas-panel"><div class="global-map-canvas-head"><div><strong id="globalMapStageTitle">', stage, '</strong><span id="globalMapStageNote">', rows.length, '개 표시 대상</span></div><div id="globalMapBaseBadge" class="global-map-base-badge">', state.scope.countryCode ? '상세 지도' : '개념 세계지도', '</div></div><div id="globalMapCanvas" class="global-map-canvas"></div><div id="globalMapInspector" class="global-map-inspector" role="dialog" aria-modal="false" aria-labelledby="globalMapInspectorTitle" hidden></div></section>',
      '</section>',
      '</main>'
    ].join('');
  }

  function continentPaths() {
    return [
      'M72 128 C106 84 180 66 248 87 C282 98 299 130 282 153 C253 174 236 195 222 228 C196 237 176 221 160 206 C137 194 105 190 83 166 Z',
      'M246 232 C278 231 307 257 314 292 C308 330 287 373 265 421 C244 427 232 394 239 363 C227 334 211 303 221 271 Z',
      'M415 111 C460 76 528 72 576 96 C604 77 680 77 738 103 C787 97 857 118 907 154 C926 175 899 194 867 190 C839 211 809 221 779 213 C744 245 699 235 668 209 C628 219 595 204 572 180 C538 188 501 175 480 156 C449 159 417 145 415 111 Z',
      'M489 190 C535 176 584 196 606 233 C624 278 596 339 559 390 C536 403 511 367 512 330 C489 306 469 270 472 228 Z',
      'M753 285 C785 263 834 267 863 291 C882 322 852 352 818 357 C786 355 757 329 753 285 Z',
      'M917 226 C932 215 946 221 947 238 C938 249 923 247 917 226 Z',
      'M313 105 C326 92 348 95 351 111 C341 124 321 123 313 105 Z'
    ];
  }

  function worldHtml(rows) {
    var clusters = Core.buildCountryClusters(rows);
    var paths = continentPaths().map(function (path) { return '<path d="' + path + '"></path>'; }).join('');
    var dots = clusters.map(function (cluster) {
      var point = Core.projectWorldPoint(cluster.longitude, cluster.latitude, 1000, 500);
      if (!point) return '';
      var radius = Math.min(22, 8 + Math.sqrt(cluster.count) * 3);
      return '<g class="world-cluster" role="button" tabindex="0" aria-label="' + esc(countryName(cluster.countryCode)) + ' ' + cluster.count + '개" data-global-map-country="' + esc(cluster.countryCode) + '" transform="translate(' + point.x + ' ' + point.y + ')"><circle r="' + radius + '"></circle><text y="4">' + cluster.count + '</text></g>';
    }).join('');
    return '<svg class="global-world-svg" viewBox="0 0 1000 500" role="img" aria-label="국경과 지형을 생략한 글로벌 자산 분포 개념도"><g class="world-land">' + paths + '</g><g class="world-dots">' + dots + '</g></svg><p class="global-world-caption">국경·도로·지형을 생략한 개념도입니다. 국가 표시를 선택하면 실제 지도베이스로 전환됩니다.</p>';
  }

  function locationLabel(row) {
    return [row.normalized_city || row.raw_city, row.normalized_admin1, row.normalized_country_name].filter(Boolean).join(' · ') || row.portfolio_region || '지역 미확인';
  }

  function renderWorldList(rows) {
    var list = document.getElementById('globalMapList');
    if (!list) return;
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
      '<div class="global-map-list-heading"><strong>국가별 관리 대상</strong><span>', countries.length, '개 그룹</span></div>',
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
      sources: { carto: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png', 'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' } },
      layers: [{ id: 'carto', type: 'raster', source: 'carto', minzoom: 0, maxzoom: 19 }]
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
      return '<g role="button" tabindex="0" data-global-map-asset="' + esc(row.asset_id) + '" class="fallback-dot tier-' + tier.tone + '" transform="translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')"><circle r="8"></circle></g>';
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

  function renderMapLibre(rows, generation) {
    var canvas = document.getElementById('globalMapCanvas');
    if (!canvas || !rows.length) {
      if (canvas) canvas.innerHTML = '<p class="global-map-empty">선택한 조건의 좌표가 없습니다.</p>';
      return;
    }
    canvas.innerHTML = '<div id="globalMapLibre" class="global-maplibre" aria-label="선택 지역 상세 지도"></div><div id="globalMapTileStatus" class="global-map-tile-status" hidden>배경지도를 불러오지 못해 좌표만 표시합니다.</div>';
    ensureMapLibre().then(function (maplibregl) {
      if (generation !== state.generation || !state.active || !document.getElementById('globalMapLibre')) return;
      disposeMap();
      var maxPrecisionZoom = Math.min.apply(null, rows.map(function (row) { return Core.maxZoomForPrecision(row.coordinate_precision); }));
      var map = new maplibregl.Map({ container: 'globalMapLibre', style: mapStyle(), center: [Number(rows[0].longitude), Number(rows[0].latitude)], zoom: rows.length === 1 ? Math.min(10, maxPrecisionZoom) : 3, maxZoom: maxPrecisionZoom, attributionControl: true });
      state.map = map;
      state.mapBase = 'maplibre-carto';
      state.renderedMarkerCount = rows.length;
      state.tileFailed = false;
      updateBaseBadge('CARTO · OpenStreetMap');
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', function (event) {
        if (event && event.error && /tile|source|network|fetch/i.test(String(event.error.message || event.error))) {
          if (generation !== state.generation || state.map !== map || state.tileFailed) return;
          disposeMap();
          state.tileFailed = true;
          renderFallbackPlot(rows, '배경지도 연결에 실패해 좌표만 표시합니다.');
        }
      });
      var bounds = new maplibregl.LngLatBounds();
      rows.forEach(function (row) {
        var tier = Core.classifyLocation(row);
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'global-map-marker tier-' + tier.tone;
        button.dataset.globalMapAsset = row.asset_id;
        button.setAttribute('aria-label', row.canonical_name + ' · ' + tier.label);
        button.title = row.canonical_name + ' · ' + tier.label;
        var marker = new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat([Number(row.longitude), Number(row.latitude)]).addTo(map);
        state.markers.push(marker);
        bounds.extend([Number(row.longitude), Number(row.latitude)]);
      });
      map.once('load', function () {
        if (generation !== state.generation || state.map !== map) return;
        if (rows.length === 1) {
          map.jumpTo({ center: bounds.getCenter(), zoom: Math.min(10, Core.maxZoomForPrecision(rows[0].coordinate_precision)) });
        } else {
          map.fitBounds(bounds, { padding: 64, maxZoom: Math.min(10, maxPrecisionZoom), duration: 0 });
        }
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
          var fill = tier.tone === 'verified' ? '#1769aa' : (tier.tone === 'candidate' || tier.tone === 'area' ? '#bd6900' : '#657184');
          var feature = new window.ol.Feature({
            geometry: new window.ol.geom.Point(window.ol.proj.fromLonLat([Number(row.longitude), Number(row.latitude)])),
            assetId: row.asset_id
          });
          feature.setStyle(new window.ol.style.Style({
            image: new window.ol.style.Circle({
              radius: 9,
              fill: new window.ol.style.Fill({ color: fill }),
              stroke: new window.ol.style.Stroke({ color: '#ffffff', width: 3 })
            })
          }));
          return feature;
        });
        var source = new window.ol.source.Vector({ features: features });
        map.addLayer(new window.ol.layer.Vector({ source: source }));
        state.map = map;
        state.markers = features;
        state.mapBase = 'vworld-graphic';
        state.renderedMarkerCount = rows.length;
        updateBaseBadge('VWorld · 국내 상세');
        map.on('singleclick', function (event) {
          var selected = null;
          map.forEachFeatureAtPixel(event.pixel, function (feature) { selected = feature; return true; });
          if (selected) selectAsset(selected.get('assetId'));
        });
        var view = map.getView();
        var maxZoom = Math.min.apply(null, rows.map(function (row) { return Core.maxZoomForPrecision(row.coordinate_precision); }));
        if (typeof view.setMaxZoom === 'function') view.setMaxZoom(maxZoom);
        if (features.length === 1) {
          view.setCenter(features[0].getGeometry().getCoordinates());
          view.setZoom(Math.min(13, Core.maxZoomForPrecision(rows[0].coordinate_precision)));
        } else {
          var extent = window.ol.extent.boundingExtent(features.map(function (feature) { return feature.getGeometry().getCoordinates(); }));
          view.fit(extent, { padding: [64, 64, 64, 64], maxZoom: Math.min(12, maxZoom), duration: 0 });
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
      '<p class="global-map-precision-note">이 위치는 ', Core.maxZoomForPrecision(row.coordinate_precision), '레벨 이상으로 자동 확대하지 않습니다.</p>'
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
    if (state.map && state.mapBase === 'maplibre-carto' && Core.hasCoordinatePair(row)) {
      var visibleCoordinates = state.filteredRows.filter(Core.hasCoordinatePair);
      var mixedCap = visibleCoordinates.length ? Math.min.apply(null, visibleCoordinates.map(function (candidate) { return Core.maxZoomForPrecision(candidate.coordinate_precision); })) : Core.maxZoomForPrecision(row.coordinate_precision);
      var zoom = Math.min(Core.maxZoomForPrecision(row.coordinate_precision), mixedCap, row.coordinate_precision === 'unknown' ? 7 : 14);
      state.map.easeTo({ center: [Number(row.longitude), Number(row.latitude)], zoom: zoom, duration: 450 });
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
    if (!state.scope.countryCode) {
      state.mapBase = 'concept-svg';
      document.getElementById('globalMapCanvas').innerHTML = worldHtml(rows.filter(Core.hasCoordinatePair));
      state.renderedMarkerCount = Core.buildCountryClusters(rows.filter(Core.hasCoordinatePair)).length;
      renderWorldList(rows);
      updateBaseBadge('개념 세계지도');
    } else {
      var coordinateRows = rows.filter(Core.hasCoordinatePair);
      renderDetailList(rows);
      if (state.scope.countryCode === 'KOR') renderVWorld(coordinateRows, state.generation);
      else renderMapLibre(coordinateRows, state.generation);
    }
  }

  function openCountry(code) {
    state.scope = { countryCode: code, city: '' };
    state.selectedAssetId = '';
    state.generation += 1;
    render();
  }

  function openCity(city) {
    state.scope.city = city;
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
      return;
    }
    var country = event.target.closest('[data-global-map-country]');
    if (country) { openCountry(country.dataset.globalMapCountry); return; }
    var city = event.target.closest('[data-global-map-city]');
    if (city) { openCity(city.dataset.globalMapCity); return; }
    var scope = event.target.closest('[data-global-map-scope]');
    if (scope) {
      state.scope = scope.dataset.globalMapScope === 'world' ? { countryCode: '', city: '' } : { countryCode: state.scope.countryCode, city: '' };
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
    var target = event.target.closest && event.target.closest('[role="button"][data-global-map-country], [role="button"][data-global-map-asset]');
    if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); target.click(); }
    if (event.key === 'Escape') {
      closeInspector();
    }
  });

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
      scope: Object.assign({}, state.scope),
      mapBase: state.mapBase,
      markerCount: state.renderedMarkerCount,
      selectedAssetId: state.selectedAssetId,
      zoomCap: state.mapBase === 'maplibre-carto' && state.map && typeof state.map.getMaxZoom === 'function'
        ? state.map.getMaxZoom()
        : (state.mapBase === 'vworld-graphic' && state.map && state.map.getView && state.map.getView().getMaxZoom ? state.map.getView().getMaxZoom() : null),
      tileFailed: state.tileFailed
    };
  }

  window.GlobalAssetMap = { activate: activate, deactivate: deactivate, retry: retry, restore: render, audit: audit };
})();