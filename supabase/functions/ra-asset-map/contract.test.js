const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const config = fs.readFileSync(path.resolve(__dirname, '../../config.toml'), 'utf8');

assert.match(config, /\[functions\.ra-asset-map\][\s\S]*?verify_jwt\s*=\s*false/);
assert.match(config, /\[functions\.ra-capital-exposure\][\s\S]*?verify_jwt\s*=\s*false/, 'existing capital gateway policy must be preserved');

assert.match(source, /requireValidSession\(token\)/, 'asset data must require a valid RA session');
assert.match(source, /asset_map_location_progressive_v1/, 'must read the service-only projection');
assert.doesNotMatch(source, /raw_address|evidence|candidate_fingerprint|geocoder_place_id/, 'sensitive review lineage must not leave the edge function');
assert.match(source, /limit=\$\{PAGE_SIZE\}&offset=\$\{offset\}/, 'complete bounded pagination required');
assert.match(source, /MAX_ASSETS/, 'hard population ceiling required');
assert.doesNotMatch(source, /select=\*/, 'session and map reads must use explicit columns');
assert.doesNotMatch(source, /"asset_kind"|"business_stage"|"country_code_alpha2"|"location_updated_at"/, 'unused map fields must not leave the edge function');
assert.match(source, /order=location_tier\.asc,asset_id\.asc/, 'stable output order required');
assert.match(source, /Cache-Control.*no-store/, 'authenticated location payload must not be cached');
assert.match(source, /Number\.isFinite\(value\.getTime\(\)\)/, 'corrupt session timestamps must fail closed');

console.log('ra-asset-map contract tests passed');