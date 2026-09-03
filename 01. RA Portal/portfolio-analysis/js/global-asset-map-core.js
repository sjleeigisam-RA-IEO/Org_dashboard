(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlobalAssetMapCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var TIER_META = {
    verified: { label: '위치 확정', tone: 'verified', plotted: true, rank: 1 },
    candidate_asset: { label: '주소·건물 후보', tone: 'candidate', plotted: true, rank: 2 },
    local_area: { label: '도로·구역 수준', tone: 'area', plotted: true, rank: 3 },
    uncertain_point: { label: '정밀도 불명 좌표', tone: 'uncertain', plotted: true, rank: 4 },
    city_text: { label: '도시 정보만 확인', tone: 'city', plotted: false, rank: 5 },
    aggregate_only: { label: '비단일 위치', tone: 'aggregate', plotted: false, rank: 6 },
    insufficient: { label: '위치 근거 부족', tone: 'insufficient', plotted: false, rank: 7 }
  };

  var MAX_ZOOM = {
    address_point: 17,
    building: 16,
    street: 14,
    district: 11,
    city: 8,
    region: 5,
    country: 4,
    unknown: 8
  };

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function hasCoordinatePair(row) {
    var latitude = numberOrNull(row && row.latitude);
    var longitude = numberOrNull(row && row.longitude);
    return latitude !== null && longitude !== null
      && latitude >= -90 && latitude <= 90
      && longitude >= -180 && longitude <= 180;
  }

  function classifyLocation(row) {
    row = row || {};
    var subject = String(row.location_subject_type || 'unresolved_subject');
    var precision = String(row.coordinate_precision || 'unknown');
    var reviewStatus = String(row.review_status || '');
    var hasCoordinates = hasCoordinatePair(row);
    var tier = 'insufficient';

    if (subject === 'multi_site_portfolio' || subject === 'non_physical_vehicle') {
      tier = 'aggregate_only';
    } else if (subject === 'single_site' && hasCoordinates && row.is_map_eligible === true
      && (row.review_status === 'auto_verified' || row.review_status === 'manually_verified')) {
      tier = 'verified';
    } else if (subject === 'single_site' && hasCoordinates && reviewStatus === 'review_required' && (precision === 'address_point' || precision === 'building')) {
      tier = 'candidate_asset';
    } else if (subject === 'single_site' && hasCoordinates && reviewStatus === 'review_required' && (precision === 'street' || precision === 'district')) {
      tier = 'local_area';
    } else if (subject === 'single_site' && hasCoordinates && reviewStatus === 'review_required') {
      tier = 'uncertain_point';
    } else if (subject === 'single_site' && (row.normalized_city || row.raw_city)) {
      tier = 'city_text';
    }

    return Object.assign({ tier: tier }, TIER_META[tier]);
  }

  function maxZoomForPrecision(precision) {
    return MAX_ZOOM[String(precision || 'unknown')] || MAX_ZOOM.unknown;
  }

  function projectWorldPoint(longitude, latitude, width, height) {
    longitude = numberOrNull(longitude);
    latitude = numberOrNull(latitude);
    width = numberOrNull(width);
    height = numberOrNull(height);
    if (longitude === null || latitude === null || width === null || height === null) return null;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 || width <= 0 || height <= 0) return null;
    return {
      x: Math.round((((longitude + 180) / 360) * width) * 100) / 100,
      y: Math.round((((90 - latitude) / 180) * height) * 100) / 100
    };
  }

  function normalizedText(value) {
    return String(value || '').trim().toLocaleLowerCase('en');
  }

  function filterScope(rows, scope) {
    scope = scope || {};
    return (rows || []).filter(function (row) {
      if (scope.countryCode && String(row.country_code_alpha3 || '') !== String(scope.countryCode)) return false;
      if (scope.city && normalizedText(row.normalized_city || row.raw_city) !== normalizedText(scope.city)) return false;
      if (scope.tier && classifyLocation(row).tier !== scope.tier) return false;
      return true;
    });
  }

  function buildCountryClusters(rows) {
    var groups = new Map();
    (rows || []).filter(hasCoordinatePair).forEach(function (row) {
      var code = String(row.country_code_alpha3 || 'UNK');
      if (!groups.has(code)) groups.set(code, { countryCode: code, rows: [], latitude: 0, longitude: 0 });
      var group = groups.get(code);
      group.rows.push(row);
      group.latitude += Number(row.latitude);
      group.longitude += Number(row.longitude);
    });
    return Array.from(groups.values()).map(function (group) {
      return {
        countryCode: group.countryCode,
        count: group.rows.length,
        latitude: group.latitude / group.rows.length,
        longitude: group.longitude / group.rows.length,
        tiers: group.rows.reduce(function (counts, row) {
          var tier = classifyLocation(row).tier;
          counts[tier] = (counts[tier] || 0) + 1;
          return counts;
        }, {})
      };
    }).sort(function (left, right) {
      return right.count - left.count || left.countryCode.localeCompare(right.countryCode);
    });
  }

  function detailBaseFor(row) {
    if (String(row && row.country_code_alpha3 || '') === 'KOR') return 'vworld';
    var precision = String(row && row.coordinate_precision || 'unknown');
    return precision === 'country' || precision === 'region' || precision === 'city'
      ? 'maplibre-region'
      : 'maplibre-detail';
  }

  function summarize(rows) {
    var counts = {};
    Object.keys(TIER_META).forEach(function (tier) { counts[tier] = 0; });
    (rows || []).forEach(function (row) { counts[classifyLocation(row).tier] += 1; });
    return counts;
  }

  return {
    TIER_META: TIER_META,
    hasCoordinatePair: hasCoordinatePair,
    classifyLocation: classifyLocation,
    maxZoomForPrecision: maxZoomForPrecision,
    projectWorldPoint: projectWorldPoint,
    filterScope: filterScope,
    buildCountryClusters: buildCountryClusters,
    detailBaseFor: detailBaseFor,
    summarize: summarize
  };
});