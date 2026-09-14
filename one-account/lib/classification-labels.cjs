'use strict';
// Patch only Account classification labels; source data and asset sectors stay intact.
module.exports = function classificationLabels(html) {
  return html
    .replace('data-scope-base="미분류">미분류', 'data-scope-base="미Account">미Account')
    .replace('PISCFH 미분류</span>', '미Account</span>')
    .replace("code==='unclassified'?'미분류'", "code==='unclassified'?'미Account'")
    .replace("r.piscfh_code||'미분류'", "r.piscfh_code||'미Account'")
    .replace("piscfh:[...new Set(codes)].join(',')", "piscfh:[...new Set(codes)].join(',')||'미Account'");
};
