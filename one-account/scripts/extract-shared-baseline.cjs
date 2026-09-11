'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('Usage: node scripts/extract-shared-baseline.cjs <source.html> <private-output.json>');
const bytes = fs.readFileSync(sourcePath), html = bytes.toString('utf8');
function embedded(id) {
  const match = html.match(new RegExp('<script id="'+id+'" type="application/json">([\\s\\S]*?)</script>'));
  if (!match) throw new Error('Missing '+id);
  return JSON.parse(match[1]);
}
const data = embedded('embedded-data'), assignments = embedded('sharedTeamState');
const cm = new Set(data.meta.account_team_operating_policy.cm_senior_manager_person_ids);
const sponsor = new Set(data.meta.account_team_contract.sponsor_candidate_ids);
const catalogs = { accounts:Object.fromEntries(data.accounts.map(a=>[a.account_id,a.display_name])), rms:{} };
for (const rm of data.rm_candidates) {
  const roles=[];
  if (['전무','상무'].includes(rm.executive_rank)) roles.push('primary');
  if (['전무','상무','이사'].includes(rm.executive_rank) || cm.has(rm.person_id)) roles.push('backup');
  if (sponsor.has(rm.person_id)) roles.push('sponsor');
  catalogs.rms[rm.person_id]={name:rm.name,roles};
}
const fields={primary:'primaryRmId',backup:'backupRmId',sponsor:'sponsorRmId'};
for (const [id,team] of Object.entries(assignments)) {
  if (!Object.hasOwn(catalogs.accounts,id)) throw new Error('Unknown baseline Account');
  const assigned=[];
  for (const [role,field] of Object.entries(fields)) {
    const person=team[field] || '';
    if (person && !catalogs.rms[person]?.roles.includes(role)) throw new Error('Invalid baseline role for '+id);
    if (person) assigned.push(person);
  }
  if (new Set(assigned).size!==assigned.length) throw new Error('Duplicate baseline roles');
}
const baseline={dataset_id:'rm-v1.7',snapshot_id:html.match(/id="snapshotMeta"[^>]*content="([^"]+)"/)[1],baseline_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),assignments,catalogs};
fs.writeFileSync(outputPath,JSON.stringify(baseline));
console.log(JSON.stringify({accounts:Object.keys(catalogs.accounts).length,rms:Object.keys(catalogs.rms).length,assignedAccounts:Object.keys(assignments).length,sha256:baseline.baseline_sha256}));
