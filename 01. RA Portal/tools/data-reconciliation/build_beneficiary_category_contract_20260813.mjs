import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "beneficiary_category_cleanup_20260813");
const sourcePath = path.join(outputDir, "beneficiary_name_category_audit.json");
const rows = JSON.parse(await fs.readFile(sourcePath, "utf8"));

const CATEGORY_DEFINITIONS = [
  ["연기금·공공기금", "기관", "연금 및 정부·공공 목적 기금"],
  ["공제회", "기관", "법정 공제회 및 공제조합"],
  ["정부·공공기관", "기관", "정부부처, 공사, 공단 및 공공기관"],
  ["재단·협회", "기관", "비영리 재단, 협회 및 유사 기관"],
  ["협동조합·중앙회", "기관", "비금융 협동조합 및 중앙회"],
  ["해외기관", "기관", "해외 연기금, 국부펀드 및 기관투자자"],
  ["기타기관", "기관", "세부 유형을 확정하지 못한 기관투자자"],
  ["은행", "금융기관", "국내외 은행"],
  ["보험사", "금융기관", "생명보험, 손해보험 및 재보험사"],
  ["증권사", "금융기관", "증권회사 및 투자은행"],
  ["자산운용사", "금융기관", "자산운용, 투자운용 및 투자자문사"],
  ["부동산신탁사", "금융기관", "부동산 및 토지 신탁회사"],
  ["캐피탈·리스사", "금융기관", "캐피탈, 리스 및 여신전문금융사"],
  ["저축은행", "금융기관", "저축은행"],
  ["상호금융", "금융기관", "신협, 새마을금고 및 금융 협동조합"],
  ["카드·할부금융", "금융기관", "카드 및 할부금융사"],
  ["종합금융회사", "금융기관", "종합금융회사"],
  ["벤처캐피탈·투자사", "금융기관", "벤처캐피탈 및 전문 투자회사"],
  ["기타금융기관", "금융기관", "기타 금융투자 및 금융 서비스 기관"],
  ["일반기업", "일반기업", "비금융 일반 법인"],
  ["개인", "개인", "개인 또는 개인 공모 집합"],
  ["펀드", "펀드·리츠·SPC", "집합투자기구 및 펀드"],
  ["리츠", "펀드·리츠·SPC", "상장·사모 리츠 및 위탁관리부동산투자회사"],
  ["SPC", "펀드·리츠·SPC", "PFV, 특수목적회사 및 투자 보유 법인"],
  ["비공개", "미분류", "공개되지 않은 투자자"],
  ["미분류", "미분류", "현재 증거로 확정할 수 없는 투자자"],
].map(([categoryName, broadClass, description], index) => ({
  categoryName,
  broadClass,
  description,
  displayOrder: index + 1,
}));

const CATEGORY_BY_NAME = new Map(CATEGORY_DEFINITIONS.map((item) => [item.categoryName, item]));
const SOURCE_CATEGORY_MAP = new Map([
  ["연기금", "연기금·공공기금"],
  ["공제회", "공제회"],
  ["정부기관", "정부·공공기관"],
  ["조합", "협동조합·중앙회"],
  ["기타 투자기관", "기타기관"],
  ["은행", "은행"],
  ["보험사", "보험사"],
  ["증권사", "증권사"],
  ["자산운용사", "자산운용사"],
  ["리스사", "캐피탈·리스사"],
  ["상호 저축은행 및 기타 저축기관", "저축은행"],
  ["신용카드 및 할부금융업", "카드·할부금융"],
  ["여신금융업", "캐피탈·리스사"],
  ["종합금융회사", "종합금융회사"],
  ["금융투자업", "기타금융기관"],
  ["일반기업", "일반기업"],
  ["개인", "개인"],
  ["펀드", "펀드"],
  ["상장공모리츠", "리츠"],
  ["사모리츠", "리츠"],
  ["SPC", "SPC"],
  ["비공개", "비공개"],
]);

const EXPLICIT = new Map([
  ["신협중앙회", ["상호금융", "사용자확정: 신협중앙회는 금융기관"]],
  ["신용협동조합중앙회", ["상호금융", "사용자확정: 신협중앙회는 금융기관"]],
  ["새마을금고중앙회", ["상호금융", "상호금융 중앙회"]],
  ["농업협동조합중앙회", ["상호금융", "상호금융 중앙회"]],
  ["수협중앙회", ["상호금융", "금융 협동조합 중앙회"]],
  ["산림조합중앙회", ["협동조합·중앙회", "비금융 협동조합 중앙회"]],
  ["중소기업중앙회", ["협동조합·중앙회", "법정 중앙회"]],
  ["엽연초생산협동조합중앙회", ["협동조합·중앙회", "협동조합 중앙회"]],
  ["이지스자산운용", ["자산운용사", "고유는 투자맥락이며 기관 성격은 자산운용사"]],
  ["이지스자산운용 고유자금", ["자산운용사", "고유는 투자맥락이며 기관 성격은 자산운용사"]],
  ["삼성자산운용OCIO", ["자산운용사", "법인명 기준 자산운용사"]],
  ["주택도시보증공사(주택도시기금)", ["정부·공공기관", "공사 및 공공기금 운용 주체"]],
  ["우정사업본부(보험)", ["정부·공공기관", "보험은 계정 맥락이며 기관 성격은 정부기관"]],
  ["고용노동부 산재보험기금", ["연기금·공공기금", "보험은 기금 명칭의 일부이며 기관 성격은 공공기금"]],
  ["교보생명보험(연금)", ["보험사", "연금은 계정 맥락이며 기관 성격은 보험사"]],
  ["개인(공모)", ["개인", "개인 공모 집합"]],
  ["개인(정석우)", ["개인", "개인 명칭"]],
  ["엔에이치헤지자산운용", ["자산운용사", "법인명 기준 자산운용사"]],
  ["케이리츠투자운용", ["자산운용사", "법인명 기준 투자운용사"]],
  ["M&G(TS ASIA)", ["자산운용사", "기존 보고서 확정: 금융기관"]],
  ["GIC", ["해외기관", "해외 국부펀드"]],
  ["Blackstone", ["자산운용사", "글로벌 대체투자 운용사"]],
  ["Morgan stanley", ["증권사", "글로벌 투자은행"]],
  ["Actis", ["자산운용사", "글로벌 대체투자 운용사"]],
  ["연초생산안정화재단", ["재단·협회", "재단 명칭"]],
  ["아산나눔재단", ["재단·협회", "재단 명칭"]],
  ["현대차정몽구재단", ["재단·협회", "재단 명칭"]],
  ["인천도시공사", ["정부·공공기관", "지방공기업"]],
  ["키움에프앤아이", ["기타금융기관", "부실채권 투자·관리 금융회사"]],
  ["유진투자선물", ["기타금융기관", "선물회사"]],
  ["푸른인베스트먼트", ["벤처캐피탈·투자사", "투자회사 명칭"]],
  ["에이티넘인베스트먼트", ["벤처캐피탈·투자사", "벤처캐피탈"]],
  ["아이언투자파트너스", ["벤처캐피탈·투자사", "투자회사 명칭"]],
  ["안다인베스트먼트파트너스", ["벤처캐피탈·투자사", "투자회사 명칭"]],
  ["신한금융플러스", ["기타금융기관", "금융 서비스 법인 명칭"]],
  ["아시아에프앤아이", ["기타금융기관", "F&I 투자·관리 법인 명칭"]],
  ["엠디엠플러스", ["일반기업", "사용자확정: 일반기업"]],
  ["넥슨코리아", ["일반기업", "사용자확정: 일반기업"]],
  ["구봉산업", ["일반기업", "사용자확정: 일반기업"]],
  ["제이에스티나", ["일반기업", "사용자확정: 일반기업"]],
  ["세종텔레콤", ["일반기업", "사용자확정: 일반기업"]],
  ["성담", ["일반기업", "사용자확정 계열: 일반기업"]],
  ["성담솔트베이", ["일반기업", "사용자확정 계열: 일반기업"]],
  ["448-3호", ["펀드", "사용자확정: 호수형 펀드"]],
  ["448-4", ["펀드", "호수형 펀드"]],
  ["이지스미국일반사모부동산투자신탁448-3호", ["펀드", "사용자확정: 호수형 펀드"]],
  ["이지스미국일반사모부동산투자신탁448-4호", ["펀드", "호수형 펀드"]],
  ["이지스인컴앤그로스 2-4-4호", ["펀드", "사용자확정 계열: 인컴앤그로스 펀드"]],
  ["개인투자자 포함(공모펀드)", ["개인", "원천 투자자 성격 기준 개인 공모 집합"]],
  ["Pinnacle Eagle Ltd.", ["SPC", "기존 보고서 확정: 투자 보유 법인"]],
  ["양지로지스특시", ["SPC", "기존 보고서 확정: 투자 보유 법인"]],
  ["쿠거인더주피에프브이", ["SPC", "PFV 명칭"]],
  ["쿠거인더주피에프브이(PFV)", ["SPC", "PFV 명칭"]],
  ["에셀", ["SPC", "에셀유한회사 축약명"]],
  ["메리츠화재", ["보험사", "보험사 법인명"]],
  ["메리츠증권", ["증권사", "증권사 법인명"]],
  ["메리츠캐피탈", ["캐피탈·리스사", "캐피탈사 법인명"]],
  ["투자자1", ["미분류", "식별 불충분 명칭"]],
  ["기관투자자", ["기타기관", "기존 보고서 확정: 기관 집계 명칭"]],
  ["I.O.IV", ["미분류", "식별 근거 부족"]],
  ["우리", ["미분류", "식별 근거 부족"]],
  ["미정", ["미분류", "미정 명칭"]],
]);

function cleanCategories(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && item !== "<NULL>")
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function result(categoryName, basis, confidence = 0.95, method = "rule") {
  const definition = CATEGORY_BY_NAME.get(categoryName);
  if (!definition) throw new Error(`Unknown controlled category: ${categoryName}`);
  return {
    beneficiaryCat: categoryName,
    beneficiaryClass: definition.broadClass,
    classificationBasis: basis,
    classificationConfidence: confidence,
    classificationMethod: method,
  };
}

function classifyName(name, sourceCategories) {
  if (EXPLICIT.has(name)) {
    const [categoryName, basis] = EXPLICIT.get(name);
    return result(categoryName, basis, categoryName === "미분류" ? 0 : 1, "explicit_name");
  }

  const upper = name.normalize("NFKC").toLocaleUpperCase("en-US");

  if (/^개인(?:\(|$)/.test(name)) return result("개인", "개인 명칭 패턴", 0.99, "name_pattern");
  if (/비공개/.test(name)) return result("비공개", "비공개 명칭", 1, "name_pattern");
  if (/제?\d+호\s*펀드|호\s*펀드|자투자신탁|모투자신탁|투자신탁|일반사모|전문사모|사모투자회사|부동산.*사모/i.test(name)) {
    return result("펀드", "명시적 집합투자기구 명칭", 0.99, "name_pattern");
  }
  if (/연금|기금/.test(name)) return result("연기금·공공기금", "연금·공공기금 명칭", 0.94, "name_pattern");
  if (/공사|공단|정부|우정사업본부/.test(name)) return result("정부·공공기관", "정부·공공기관 명칭", 0.94, "name_pattern");
  if (/공제회|공제조합/.test(name)) return result("공제회", "공제회·공제조합 명칭", 0.99, "name_pattern");
  if (/자산운용|투자운용|투자자문|ASSET MANAGEMENT|INVESCO|NUVEEN/i.test(upper)) {
    return result("자산운용사", "자산운용·투자자문 명칭", 0.98, "name_pattern");
  }
  if (/자산신탁|토지신탁|부동산신탁|신탁$/i.test(name)) {
    return result("부동산신탁사", "부동산·토지신탁사 명칭", 0.98, "name_pattern");
  }
  if (/증권|SECURITIES/i.test(upper)) return result("증권사", "증권사 명칭", 0.99, "name_pattern");
  if (/생명보험|손해보험|화재보험|보험|REINSURANCE/i.test(upper)) {
    return result("보험사", "보험사 명칭", 0.98, "name_pattern");
  }
  if (/저축은행/.test(name)) return result("저축은행", "저축은행 명칭", 0.99, "name_pattern");
  if (/신협|신용협동조합|새마을금고/.test(name)) return result("상호금융", "상호금융 명칭", 0.99, "name_pattern");
  if (/은행|\bBANK\b/i.test(upper)) return result("은행", "은행 명칭", 0.98, "name_pattern");
  if (/카드|CARD/i.test(upper)) return result("카드·할부금융", "카드·할부금융 명칭", 0.98, "name_pattern");
  if (/캐피탈|리스|CAPITAL/i.test(upper)) return result("캐피탈·리스사", "캐피탈·리스 명칭", 0.94, "name_pattern");
  if (/위탁관리부동산투자회사|(?:^|[^가-힣])REIT(?:S)?(?:[^A-Z]|$)|(?<!메)리츠(?:$|[^가-힣])/i.test(name)) {
    return result("리츠", "리츠·위탁관리부동산투자회사 명칭", 0.98, "name_pattern");
  }
  if (/투자신탁|투자회사|일반사모|전문사모|사모부동산|부동산.*사모|부동산자투자|자투자회사|모투자회사|\bFUND\b|펀드|SICAV|SIF|\(Blind\)|블라인드|PF재구조화|기회추구\d|코어플랫폼\d*호|KDCIP\s*\d+호|IADC\d*호|NPL\s*\d*호|이지스.*\d+(?:[-의]\d+)*(?:호)(?:\(.*\))?$/i.test(name)) {
    return result("펀드", "집합투자기구·호수형 펀드 명칭", 0.98, "name_pattern");
  }
  if (/PFV|피에프브이|\(SPC\)|\bSPC\b|제[일이삼사오육칠팔구십]+차|제\d+차|유동화|HOLDCO/i.test(name)) {
    return result("SPC", "특수목적·차수형 법인 명칭", 0.96, "name_pattern");
  }
  if (/재단|협회/.test(name)) return result("재단·협회", "재단·협회 명칭", 0.94, "name_pattern");
  if (/협동조합|중앙회|조합/.test(name)) return result("협동조합·중앙회", "협동조합·중앙회 명칭", 0.92, "name_pattern");
  if (/인베스트먼트|투자파트너스|VENTURE|PARTNERS/i.test(upper)) {
    return result("벤처캐피탈·투자사", "투자회사·파트너스 명칭", 0.9, "name_pattern");
  }

  const mappedSourceCategories = [...new Set(sourceCategories.map((item) => SOURCE_CATEGORY_MAP.get(item)).filter(Boolean))];
  if (mappedSourceCategories.length === 1) {
    return result(mappedSourceCategories[0], `원천분류 매핑: ${sourceCategories.join(" / ")}`, 0.9, "source_category");
  }
  if (mappedSourceCategories.length > 1) {
    return result("미분류", `원천분류 충돌: ${sourceCategories.join(" / ")}`, 0.2, "source_conflict");
  }

  if (/PTE\.?\s*LTD|PRIVATE LIMITED|\bB\.V\.|\bC\.V\.|S\.A\.R\.L|\bLIMITED\b|유한회사/i.test(upper)) {
    return result("SPC", "투자 보유법인 형태 명칭", 0.78, "legal_form_pattern");
  }
  if (/주식회사|㈜|\bCORP\b|\bLTD\b|건설|산업|텔레콤|호텔|리조트|개발|로지스|네트웍스|홀딩스|글로벌|상사|솔루션즈|이앤씨|엔피씨|월드/i.test(upper)) {
    return result("일반기업", "일반 법인 명칭", 0.78, "legal_form_pattern");
  }
  return result("미분류", "분류 근거 부족", 0, "unresolved");
}

const candidates = rows.map((row) => {
  const sourceCategories = cleanCategories(row.beneficiary_categories);
  const classification = classifyName(row.beneficiary_clean, sourceCategories);
  const mappedSources = [...new Set(sourceCategories.map((item) => SOURCE_CATEGORY_MAP.get(item)).filter(Boolean))];
  const sourceConflict = mappedSources.length > 1;
  const sourceDisagrees = mappedSources.length === 1 && mappedSources[0] !== classification.beneficiaryCat;
  const needsReview = classification.beneficiaryCat === "미분류"
    || classification.beneficiaryCat === "비공개"
    || classification.classificationConfidence < 0.85
    || (sourceConflict && classification.classificationConfidence < 0.95);
  return {
    beneficiaryName: row.beneficiary_clean,
    canonicalName: row.beneficiary_clean,
    sourceCategories,
    sourceTypes: Array.isArray(row.beneficiary_types) ? row.beneficiary_types.filter((item) => item !== "<NULL>") : [],
    beneficiaryCat: classification.beneficiaryCat,
    beneficiaryClass: classification.beneficiaryClass,
    classificationBasis: classification.classificationBasis,
    classificationConfidence: classification.classificationConfidence,
    classificationMethod: classification.classificationMethod,
    reviewStatus: needsReview ? "review" : "confirmed",
    sourceConflict,
    sourceDisagrees,
    rowCount: Number(row.row_count || 0),
    fundCount: Number(row.fund_count || 0),
    committedAmt: Number(row.committed_amt || 0),
    investedAmt: Number(row.invested_amt || 0),
    remainingAmt: Number(row.remaining_amt || 0),
    minBaseDate: row.min_base_date,
    maxBaseDate: row.max_base_date,
  };
});

function csvCell(value) {
  const text = Array.isArray(value) || (value && typeof value === "object")
    ? JSON.stringify(value)
    : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(items) {
  if (!items.length) return "";
  const headers = Object.keys(items[0]);
  return [headers, ...items.map((item) => headers.map((header) => item[header]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function countBy(key) {
  return Object.fromEntries([...new Set(candidates.map((item) => item[key]))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko"))
    .map((value) => [value, candidates.filter((item) => item[key] === value).length]));
}

const reviewCandidates = candidates
  .filter((item) => item.reviewStatus === "review")
  .sort((a, b) => b.investedAmt - a.investedAmt || a.beneficiaryName.localeCompare(b.beneficiaryName, "ko"));
const changes = candidates
  .filter((item) => item.sourceCategories.length !== 1 || item.sourceCategories[0] !== item.beneficiaryCat)
  .sort((a, b) => b.investedAmt - a.investedAmt || a.beneficiaryName.localeCompare(b.beneficiaryName, "ko"));

const summary = {
  generatedAt: new Date().toISOString(),
  candidateCount: candidates.length,
  confirmedCount: candidates.filter((item) => item.reviewStatus === "confirmed").length,
  reviewCount: reviewCandidates.length,
  sourceConflictCount: candidates.filter((item) => item.sourceConflict).length,
  sourceDisagreesCount: candidates.filter((item) => item.sourceDisagrees).length,
  changedOrFilledCount: changes.length,
  byCategory: countBy("beneficiaryCat"),
  byClass: countBy("beneficiaryClass"),
  byMethod: countBy("classificationMethod"),
  controlledCategories: CATEGORY_DEFINITIONS,
  sourceCategoryMap: Object.fromEntries(SOURCE_CATEGORY_MAP),
};

await Promise.all([
  fs.writeFile(path.join(outputDir, "beneficiary_category_contract_summary.json"), JSON.stringify(summary, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_classification_candidates.json"), JSON.stringify(candidates, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_classification_candidates.csv"), `\uFEFF${toCsv(candidates)}`, "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_classification_review.csv"), `\uFEFF${toCsv(reviewCandidates)}`, "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_classification_changes.csv"), `\uFEFF${toCsv(changes)}`, "utf8"),
]);

console.log(JSON.stringify({
  ...summary,
  reviewCandidates: reviewCandidates.slice(0, 80),
  sourceDisagreements: candidates.filter((item) => item.sourceDisagrees).slice(0, 80),
}, null, 2));
