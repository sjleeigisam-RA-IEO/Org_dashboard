const assert = require('node:assert/strict');
const Core = require('../js/global-asset-map-core.js');

const base = {
  asset_id: 'A1',
  location_subject_type: 'single_site',
  review_status: 'review_required',
  latitude: 40.7,
  longitude: -74,
  country_code_alpha3: 'USA',
  normalized_city: 'New York'
};

assert.equal(Core.classifyLocation({ ...base, is_map_eligible: true, review_status: 'auto_verified', coordinate_precision: 'address_point' }).tier, 'verified');
assert.equal(Core.classifyLocation({ ...base, coordinate_precision: 'building' }).tier, 'candidate_asset');
assert.equal(Core.classifyLocation({ ...base, review_status: 'manually_rejected', coordinate_precision: 'building' }).tier, 'city_text');
assert.equal(Core.classifyLocation({ ...base, coordinate_precision: 'street' }).tier, 'local_area');
assert.equal(Core.classifyLocation({ ...base, coordinate_precision: 'district' }).tier, 'local_area');
assert.equal(Core.classifyLocation({ ...base, coordinate_precision: 'unknown' }).tier, 'uncertain_point');
assert.equal(Core.classifyLocation({ ...base, latitude: null, longitude: null, raw_city: 'Paris' }).tier, 'city_text');
assert.equal(Core.classifyLocation({ ...base, location_subject_type: 'multi_site_portfolio', latitude: null, longitude: null }).tier, 'aggregate_only');
assert.equal(Core.classifyLocation({ ...base, location_subject_type: 'unresolved_subject', latitude: null, longitude: null }).tier, 'insufficient');

assert.equal(Core.hasCoordinatePair({ latitude: 1, longitude: 2 }), true);
assert.equal(Core.hasCoordinatePair({ latitude: 1, longitude: null }), false);
assert.equal(Core.hasCoordinatePair({ latitude: 91, longitude: 2 }), false);

assert.equal(Core.maxZoomForPrecision('address_point'), 17);
assert.equal(Core.maxZoomForPrecision('building'), 16);
assert.equal(Core.maxZoomForPrecision('street'), 14);
assert.equal(Core.maxZoomForPrecision('district'), 11);
assert.equal(Core.maxZoomForPrecision('city'), 8);
assert.equal(Core.maxZoomForPrecision('region'), 5);
assert.equal(Core.maxZoomForPrecision('country'), 4);
assert.equal(Core.maxZoomForPrecision('unknown'), 8);

const projected = Core.projectWorldPoint(0, 0, 1000, 500);
assert.deepEqual(projected, { x: 500, y: 250 });
assert.deepEqual(Core.projectWorldPoint(180, 90, 1000, 500), { x: 1000, y: 0 });
assert.equal(Core.projectWorldPoint(181, 0, 1000, 500), null);

const rows = [
  { ...base, asset_id: 'A1', country_code_alpha3: 'USA' },
  { ...base, asset_id: 'A2', latitude: 34, longitude: -118, country_code_alpha3: 'USA' },
  { ...base, asset_id: 'A3', latitude: 48.8, longitude: 2.3, country_code_alpha3: 'FRA' }
];
const clusters = Core.buildCountryClusters(rows);
assert.equal(clusters.length, 2);
assert.equal(clusters.find((row) => row.countryCode === 'USA').count, 2);
assert.deepEqual(Core.filterScope(rows, { countryCode: 'FRA' }).map((row) => row.asset_id), ['A3']);
assert.deepEqual(Core.filterScope(rows, { countryCode: 'USA', city: 'new york' }).map((row) => row.asset_id), ['A1', 'A2']);

assert.equal(Core.detailBaseFor({ country_code_alpha3: 'KOR', coordinate_precision: 'address_point' }), 'vworld');
assert.equal(Core.detailBaseFor({ country_code_alpha3: 'USA', coordinate_precision: 'address_point' }), 'maplibre-detail');
assert.equal(Core.detailBaseFor({ country_code_alpha3: 'USA', coordinate_precision: 'country' }), 'maplibre-region');

console.log('global-asset-map-core tests passed');