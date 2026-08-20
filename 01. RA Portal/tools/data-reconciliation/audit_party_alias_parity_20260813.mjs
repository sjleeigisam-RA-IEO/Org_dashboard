import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries(
  (await fs.readFile(path.join(repoRoot, '.env'), 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [
        line.slice(0, index).trim(),
        line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ''),
      ];
    }),
);

const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Supabase query failed (${response.status}): ${await response.text()}`);
  return response.json();
}

function token(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .toLocaleUpperCase('en-US')
    .replace(/주식회사|\(주\)|㈜/g, '')
    .replace(/\(PFV\)$/i, '')
    .replace(/[\s.·ㆍ,'"`]/g, '');
}

const aliasDefinitions = [
  ['엠디엠플러스', ['엠디엠플러스', 'MDM플러스', 'MDM PLUS']],
  ['디에스네트웍스', ['디에스네트웍스', 'DS네트웍스']],
  ['에스제이더블유인터내셔널', ['에스제이더블유인터내셔널', '에스제이더블유인터네셔널']],
  ['쿠거인더주피에프브이', ['쿠거인더주피에프브이', '쿠거인더주피에프브이(PFV)']],
  ['DL이앤씨', ['DL이앤씨', '디엘이앤씨']],
  ['쿠팡로지스틱스서비스', ['쿠팡로지스틱스', '쿠팡로지스틱스서비스']],
  ['아스테이온제일차', ['아스테이온제일차', '아스테이온제일차(SPC)']],
  ['이지스인컴앤그로스일반사모부동산자투자신탁제2호', [
    '이지스인컴앤그로스일반사모부동산자투자신탁제2호',
    '이지스인컴앤그로스일반사모부동산자투자신탁제2호(Blind)',
  ]],
  ['이지스인컴앤그로스제2의4의4호일반사모부동산자투자회사', [
    '이지스인컴앤그로스 2-4-4호',
    '이지스인컴앤그로스제2의4의4호일반사모부동산자투자회사',
  ]],
  ['이지스밸류플러스위탁관리부동산투자회사', [
    '이지스밸류플러스리츠',
    '이지스밸류플러스위탁관리부동산투자회사',
  ]],
  ['이지스레지던스위탁관리부동산투자회사', [
    '이지스레지던스리츠',
    '이지스레지던스위탁관리부동산투자회사',
  ]],
  ['디앤디플랫폼위탁관리부동산투자회사', [
    '디앤디플랫폼리츠',
    '디앤디플랫폼위탁관리부동산투자회사',
  ]],
  ['이지스미국일반사모부동산투자신탁448-3호', [
    '448-3호',
    '이지스미국일반사모부동산투자신탁448-3호',
  ]],
  ['이지스미국일반사모부동산투자신탁448-4호', [
    '448-4',
    '이지스미국일반사모부동산투자신탁448-4호',
  ]],
];

const aliasMap = new Map();
for (const [displayName, aliases] of aliasDefinitions) {
  for (const alias of aliases) aliasMap.set(token(alias), displayName);
}

const rankings = await query(`
  select party_id, party_name, party_class, party_category,
         committed_amt, primary_amount, remaining_amt
  from public.party_exposure_rankings_v2
  where role_type = 'beneficiary'
  order by party_name;
`);

const originDistribution = await query(`
  select party_origin, count(*)::int as party_count,
         coalesce(sum(primary_amount), 0)::bigint as primary_amount
  from public.party_exposure_rankings_v2
  where role_type = 'beneficiary'
  group by party_origin
  order by party_origin;
`);

const factOriginDistribution = await query(`
  select party_origin, count(distinct party_id)::int as party_count,
         count(*)::int as exposure_count,
         coalesce(sum(primary_amount), 0)::bigint as primary_amount
  from public.party_exposure_analysis_fact_v2
  where role_type = 'beneficiary'
  group by party_origin
  order by party_origin;
`);

const groups = new Map();
for (const row of rankings) {
  const canonicalName = aliasMap.get(token(row.party_name)) || row.party_name;
  const key = token(canonicalName);
  if (!groups.has(key)) groups.set(key, { canonicalName, rows: [] });
  groups.get(key).rows.push(row);
}

const duplicateAliasGroups = Array.from(groups.values())
  .filter((group) => group.rows.length > 1)
  .map((group) => ({
    canonicalName: group.canonicalName,
    sourceNames: group.rows.map((row) => row.party_name),
    partyIds: group.rows.map((row) => row.party_id),
    primaryAmount: group.rows.reduce((sum, row) => sum + Number(row.primary_amount || 0), 0),
  }));

const result = {
  rankingPartyCount: rankings.length,
  canonicalPartyCount: groups.size,
  duplicateAliasGroups,
  countDifference: rankings.length - groups.size,
  originDistribution,
  factOriginDistribution,
};

const outputDir = path.join(repoRoot, 'outputs', 'party_exposure_analysis_20260813');
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, 'party_alias_parity.json'),
  JSON.stringify(result, null, 2),
  'utf8',
);
console.log(JSON.stringify(result, null, 2));
