const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index-v2.html'), 'utf8');
const ux = fs.readFileSync(path.join(root, 'ux-v2.js'), 'utf8');
const map = fs.readFileSync(path.join(root, 'global-asset-map.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'global-asset-map.css'), 'utf8');

assert.match(html, /data-v2-mode="map"[^>]*>자산지도</);
assert.match(html, /global-asset-map\.css/);
assert.ok(html.indexOf('js/global-asset-map-core.js') < html.indexOf('global-asset-map.js'));
assert.ok(html.indexOf('global-asset-map.js') < html.indexOf('ux-v2.js'));
assert.match(ux, /global-asset-map-mode/);
assert.match(ux, /GlobalAssetMap\.activate/);
assert.match(ux, /GlobalAssetMap\.deactivate/);
assert.match(ux, /'portfolio', 'map', 'capital', 'search'/);
assert.match(ux, /mode !== 'search'.*delete\('query'\)/);
assert.match(map, /국경·도로·지형을 생략한 개념도/);
assert.match(map, /maplibre-gl@5\.7\.1/);
assert.match(map, /sha384-[A-Za-z0-9+/=]+/);
assert.match(map, /basemaps\.cartocdn\.com/);
assert.match(map, /AbortController/);
assert.match(map, /generation !== state\.generation/);
assert.doesNotMatch(map, /_state:\s*state/, 'protected rows must not be exposed as a production debug API');
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /min-height: 48px/);
assert.match(css, /prefers-reduced-motion:[^}]+\)[\s\S]*?animation:\s*none/);

console.log('global-asset-map integration tests passed');