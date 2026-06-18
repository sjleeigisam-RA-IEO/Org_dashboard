const NOTION_VERSION = "2022-06-28";
const IOTA_TARGET_STAFF_IDS = new Set([
  "staff_10268",
  "staff_ext_000007",
  "staff_ext_000111",
  "staff_ext_000037",
  "staff_ext_000027",
]);
const IOTA_TARGET_EMAILS = new Set([
  "sykang@igisam.com",
  "ksoonil@igisam.com",
  "jghong@igisam.com",
  "junhopark@igisam.com",
  "hyunsoo.kim@igisam.com",
]);
const IOTA_TARGET_NAMES = [
  "\uac15\uc21c\uc6a9",
  "\uad8c\uc21c\uc77c",
  "\ud64d\uc7a5\uad70",
  "\ubc15\uc900\ud638",
  "\uae40\ud604\uc218",
];
const IOTA_TARGET_STAFF_NAMES = new Map([
  ["staff_10268", "\uac15\uc21c\uc6a9"],
  ["staff_ext_000007", "\uad8c\uc21c\uc77c"],
  ["staff_ext_000111", "\ud64d\uc7a5\uad70"],
  ["staff_ext_000037", "\ubc15\uc900\ud638"],
  ["staff_ext_000027", "\uae40\ud604\uc218"],
]);
const IOTA_TARGET_EMAIL_NAMES = new Map([
  ["sykang@igisam.com", "\uac15\uc21c\uc6a9"],
  ["ksoonil@igisam.com", "\uad8c\uc21c\uc77c"],
  ["jghong@igisam.com", "\ud64d\uc7a5\uad70"],
  ["junhopark@igisam.com", "\ubc15\uc900\ud638"],
  ["hyunsoo.kim@igisam.com", "\uae40\ud604\uc218"],
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type T5TPayload = {
  writer_staff_id?: string | null;
  writer_email?: string | null;
  writer_name?: string | null;
  work_date?: string | null;
  week_key?: string | null;
  week_label?: string | null;
  org_id?: string | null;
  org_name?: string | null;
  line?: string | null;
  source_system?: string | null;
  mode?: string | null;
  items?: T5TItem[];
};

type T5TItem = {
  item_no?: number;
  task_type?: string | null;
  project_ids?: string[];
  review_project_ids?: string[];
  fund_ids?: string[];
  asset_ids?: string[];
  relation_texts?: string[];
  relation_labels?: string[];
  counterparty_ids?: string[];
  counterparty_candidates?: string[];
  counterparty_labels?: string[];
  summary?: string | null;
  raw_text?: string | null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const payload = await request.json() as T5TPayload;
    const mode = new URL(request.url).searchParams.get("mode") || payload.mode;
    if (mode === "draft-save") {
      const draft = await saveDraft(payload);
      return jsonResponse({ ok: true, ...draft });
    }
    if (mode === "draft-load") {
      const draft = await loadDraft(payload);
      return jsonResponse({ ok: true, ...draft });
    }
    if (mode === "last-week-load") {
      const lastWeek = await loadLastWeekItems(payload);
      return jsonResponse({ ok: true, ...lastWeek });
    }

    validatePayload(payload);
    const notionPage = await createNotionPage(payload);
    if (mode === "notion") {
      return jsonResponse({
        ok: true,
        notion_page_id: notionPage.id,
        notion_url: notionPage.url,
      });
    }

    const submissionId = await saveToSupabase(payload, notionPage);
    return jsonResponse({
      ok: true,
      submission_id: submissionId,
      notion_page_id: notionPage.id,
      notion_url: notionPage.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("VALIDATION:") ? 400 : 500;
    return jsonResponse({ ok: false, error: message.replace(/^VALIDATION:\s*/, "") }, status);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getSupabaseKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed).find(Boolean);
      if (typeof first === "string") return first;
    } catch {
      // Fall back to legacy variables below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    "";
}

function validatePayload(payload: T5TPayload) {
  if (!payload.writer_name) throw new Error("VALIDATION: 작성자 이름이 확인되지 않았습니다.");
  if (!payload.writer_email) throw new Error("VALIDATION: 작성자 이메일이 필요합니다.");
  if (!payload.work_date) throw new Error("VALIDATION: 작성일이 필요합니다.");
  const items = payload.items || [];
  if (!items.length) throw new Error("VALIDATION: 업무 항목이 1개 이상 필요합니다.");
  items.forEach((item, index) => {
    if (!(item.raw_text || "").trim()) throw new Error(`VALIDATION: ${index + 1}번 업무 내용이 비어 있습니다.`);
    const hasRelation = Boolean((item.relation_labels || []).length || (item.relation_texts || []).length);
    if (!hasRelation && !item.task_type) {
      throw new Error(`VALIDATION: ${index + 1}번 업무의 프로젝트/펀드/자산 또는 분류가 필요합니다.`);
    }
  });
}

function validateDraftIdentity(payload: T5TPayload) {
  if (!payload.writer_staff_id) throw new Error("VALIDATION: 작성자 확인 후 서버 초안을 사용할 수 있습니다.");
  if (!payload.writer_email) throw new Error("VALIDATION: 작성자 이메일이 필요합니다.");
}

function textBlock(text: string, blockType = "paragraph", bold = false) {
  return {
    object: "block",
    type: blockType,
    [blockType]: {
      rich_text: [{
        type: "text",
        text: { content: String(text || "").slice(0, 2000) },
        annotations: { bold },
      }],
    },
  };
}

function cleanRelationLabel(label: string) {
  const text = String(label || "").trim();
  for (const prefix of ["프로젝트 · ", "검토프로젝트 · ", "펀드 · ", "자산 · ", "직접입력 · "]) {
    if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
  }
  return text;
}

function taskTypeLabel(taskType?: string | null) {
  return ({
    New: "신규",
    General: "일반업무",
    Mission: "Mission",
  } as Record<string, string>)[taskType || ""] || taskType || "";
}

function relationLabel(item: T5TItem) {
  const labels = item.relation_labels || [];
  if (labels.length) return labels.map(cleanRelationLabel).join(" / ");

  const parts: string[] = [];
  for (const [key, label] of [
    ["project_ids", "프로젝트"],
    ["review_project_ids", "검토프로젝트"],
    ["fund_ids", "펀드"],
    ["asset_ids", "자산"],
  ] as const) {
    const values = item[key] || [];
    if (values.length) parts.push(`${label}: ${values.join(", ")}`);
  }
  if (item.relation_texts?.length) parts.push(`직접입력: ${item.relation_texts.join(", ")}`);
  return parts.join(" / ");
}

function relationTypeLabel(item: T5TItem) {
  if (item.task_type) return taskTypeLabel(item.task_type);
  if (item.project_ids?.length) return "프로젝트";
  if (item.review_project_ids?.length) return "검토프로젝트";
  if (item.fund_ids?.length) return "펀드";
  if (item.asset_ids?.length) return "자산";
  if (item.relation_texts?.length) return "직접입력";

  const label = item.relation_labels?.[0] || "";
  for (const prefix of ["프로젝트", "검토프로젝트", "펀드", "자산", "직접입력"]) {
    if (label.startsWith(prefix)) return prefix;
  }
  return "분류";
}

function classificationLine(item: T5TItem) {
  const relation = relationLabel(item);
  const label = relationTypeLabel(item);
  if (relation) return `${label}: ${relation}`;
  if (label) return `${label}: -`;
  return "";
}

function counterpartyLabel(item: T5TItem) {
  if (item.counterparty_labels?.length) return item.counterparty_labels.join(" / ");
  const parts: string[] = [];
  if (item.counterparty_ids?.length) parts.push(`DB: ${item.counterparty_ids.join(", ")}`);
  if (item.counterparty_candidates?.length) parts.push(`직접입력: ${item.counterparty_candidates.join(", ")}`);
  return parts.join(" / ");
}

function notionChildren(payload: T5TPayload) {
  return (payload.items || []).flatMap((item) => {
    const blocks = [textBlock(`T5T - ${item.item_no}`, "heading_3")];
    const classification = classificationLine(item);
    if (classification) blocks.push(textBlock(classification));
    const counterparty = counterpartyLabel(item);
    if (counterparty) blocks.push(textBlock(`관계자: ${counterparty}`));
    blocks.push(textBlock(`업무: ${item.raw_text || ""}`));
    return blocks;
  });
}

async function createNotionPage(payload: T5TPayload) {
  const notionApiKey = requireEnv("NOTION_API_KEY");
  const rawDbId = requireEnv("RAW_T5T_DB_ID");
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: rawDbId },
      properties: {
        "작성자": {
          title: [{ type: "text", text: { content: payload.writer_name || "Unknown" } }],
        },
        "이메일": { email: payload.writer_email },
        Date: { date: { start: payload.work_date } },
      },
      children: notionChildren(payload),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Notion API error ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as { id: string; url?: string };
}

function submissionId(payload: T5TPayload) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const writer = payload.writer_staff_id || (payload.writer_email || "unknown").split("@")[0];
  return `t5t-input-${writer}-${payload.work_date}-${stamp}`;
}

async function upsertRows(table: string, rows: unknown[], conflictTarget: string) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = getSupabaseKey();
  if (!supabaseKey) throw new Error("Missing Supabase write key.");

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${conflictTarget}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${table} upsert failed ${response.status}: ${body}`);
  }
  return body ? JSON.parse(body) : [];
}

async function deleteRows(table: string, filters: Record<string, string>) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = getSupabaseKey();
  if (!supabaseKey) throw new Error("Missing Supabase write key.");

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) query.set(key, `eq.${value}`);

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, {
    method: "DELETE",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "return=minimal",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${table} delete failed ${response.status}: ${body}`);
  }
}

async function selectRows(table: string, queryString: string) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = getSupabaseKey();
  if (!supabaseKey) throw new Error("Missing Supabase write key.");

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${queryString}`, {
    method: "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: "application/json",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${table} select failed ${response.status}: ${body}`);
  }
  return body ? JSON.parse(body) : [];
}

async function saveDraft(payload: T5TPayload) {
  validateDraftIdentity(payload);
  const savedAt = new Date().toISOString();
  await deleteRows("t5t_input_drafts", {
    writer_staff_id: payload.writer_staff_id || "",
    input_status: "draft",
  });

  const firstItem = (payload.items || [])[0] || {};
  const itemCount = (payload.items || []).length;
  const draftRows = await upsertRows("t5t_input_drafts", [{
    writer_staff_id: payload.writer_staff_id,
    work_date: payload.work_date || new Date().toISOString().slice(0, 10),
    task_type: "draft",
    summary: `T5T 입력 초안 (${itemCount}개 항목)`,
    raw_text: firstItem.raw_text || null,
    selected_project_ids: firstItem.project_ids || [],
    selected_fund_ids: firstItem.fund_ids || [],
    input_status: "draft",
    metadata: {
      draft_payload: payload,
      draft_saved_at: savedAt,
      writer_email: payload.writer_email,
      writer_name: payload.writer_name,
      item_count: itemCount,
      source: "t5t-input-edge",
    },
  }], "draft_id");

  const draftId = draftRows?.[0]?.draft_id || null;
  return { draft_id: draftId, saved_at: savedAt, item_count: itemCount };
}

async function loadDraft(payload: T5TPayload) {
  validateDraftIdentity(payload);
  const query = new URLSearchParams({
    select: "draft_id,metadata,updated_at,created_at",
    writer_staff_id: `eq.${payload.writer_staff_id}`,
    input_status: "eq.draft",
    order: "updated_at.desc",
    limit: "1",
  });
  const rows = await selectRows("t5t_input_drafts", query.toString());
  const row = rows?.[0];
  if (!row) return { draft: null };
  return {
    draft_id: row.draft_id,
    draft: row.metadata?.draft_payload || null,
    saved_at: row.metadata?.draft_saved_at || row.updated_at || row.created_at,
  };
}

function parseDateOnly(value?: string | null) {
  const text = value || new Date().toISOString().slice(0, 10);
  const [year, month, day] = text.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function previousWorkWeek(value?: string | null) {
  const date = parseDateOnly(value);
  const day = date.getUTCDay();
  const daysSinceTuesday = (day + 5) % 7;
  const currentStart = new Date(date);
  currentStart.setUTCDate(date.getUTCDate() - daysSinceTuesday);
  const previousStart = new Date(currentStart);
  previousStart.setUTCDate(currentStart.getUTCDate() - 7);
  const previousEnd = new Date(previousStart);
  previousEnd.setUTCDate(previousStart.getUTCDate() + 6);
  return {
    week_start: formatDateOnly(previousStart),
    week_end: formatDateOnly(previousEnd),
  };
}

function splitTextList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  return String(value).split(/\s*[,/]\s*/).map(text => text.trim()).filter(text => text && text !== "-");
}

function lastWeekItemFromRow(row: Record<string, any>) {
  const metadata = row.metadata || {};
  const relationLabels = metadata.relation_labels || [];
  const counterpartyLabels = metadata.counterparty_labels || splitTextList(row.stakeholder_text);
  const projectIds = row.matched_project_id ? [row.matched_project_id] : [];
  const reviewProjectIds = row.matched_review_project_id ? [row.matched_review_project_id] : (metadata.review_project_ids || []);
  const fundIds = row.matched_fund_id ? [row.matched_fund_id] : (metadata.fund_ids || []);
  const assetIds = metadata.asset_ids || [];
  const hasDbRelation = projectIds.length || reviewProjectIds.length || fundIds.length || assetIds.length;
  const fallbackRelationText = !hasDbRelation && row.project_text ? [String(row.project_text)] : (metadata.relation_texts || []);

  return {
    source_item_id: row.form_item_id,
    source_work_date: row.work_date,
    item_no: row.item_no,
    task_type: hasDbRelation ? null : (row.task_type || null),
    project_ids: projectIds,
    review_project_ids: reviewProjectIds,
    fund_ids: fundIds,
    asset_ids: assetIds,
    relation_texts: fallbackRelationText,
    relation_labels: relationLabels.length ? relationLabels : (row.project_text ? [String(row.project_text)] : []),
    counterparty_ids: row.stakeholder_ids || [],
    counterparty_candidates: metadata.counterparty_candidates || [],
    counterparty_labels: counterpartyLabels,
    summary: row.classification_summary || null,
    raw_text: row.raw_text || "",
  };
}

async function loadLastWeekItems(payload: T5TPayload) {
  validateDraftIdentity(payload);
  const week = previousWorkWeek(payload.work_date);
  let rows = await selectLastWeekItemsByStaffId(payload.writer_staff_id || "", week);
  if (!rows.length) rows = await selectLastWeekItemsBySubmissionIdentity(payload, week);
  return {
    ...week,
    items: rows.map(lastWeekItemFromRow),
  };
}

function itemSelectColumns() {
  return "form_item_id,item_no,writer_staff_id,work_date,raw_text,project_text,stakeholder_text,matched_project_id,matched_review_project_id,matched_fund_id,stakeholder_ids,task_type,classification_summary,metadata";
}

async function selectLastWeekItemsByStaffId(writerStaffId: string, week: { week_start: string; week_end: string }) {
  const query = new URLSearchParams({
    select: itemSelectColumns(),
    writer_staff_id: `eq.${writerStaffId}`,
    work_date: `gte.${week.week_start}`,
    order: "work_date.desc,item_no.asc",
    limit: "50",
  });
  query.append("work_date", `lte.${week.week_end}`);
  return await selectRows("t5t_form_items", query.toString());
}

async function selectLastWeekItemsBySubmissionIdentity(payload: T5TPayload, week: { week_start: string; week_end: string }) {
  const submissionQuery = new URLSearchParams({
    select: "submission_id",
    work_date: `gte.${week.week_start}`,
    order: "work_date.desc",
    limit: "20",
  });
  submissionQuery.append("work_date", `lte.${week.week_end}`);
  if (payload.writer_email) submissionQuery.append("writer_email", `eq.${payload.writer_email}`);
  else if (payload.writer_name) submissionQuery.append("writer_name", `eq.${payload.writer_name}`);
  else return [];

  const submissions = await selectRows("t5t_form_submissions", submissionQuery.toString());
  const submissionIds = submissions.map((row: Record<string, any>) => row.submission_id).filter(Boolean);
  if (!submissionIds.length) return [];

  const itemQuery = new URLSearchParams({
    select: itemSelectColumns(),
    submission_id: `in.(${submissionIds.join(",")})`,
    order: "work_date.desc,item_no.asc",
    limit: "50",
  });
  return await selectRows("t5t_form_items", itemQuery.toString());
}

async function saveToSupabase(payload: T5TPayload, notionPage: { id: string; url?: string }) {
  const sid = submissionId(payload);
  const sourceUrl = notionPage.url || null;
  const notionPageId = notionPage.id;
  const nowIso = new Date().toISOString();

  await upsertRows("t5t_form_submissions", [{
    submission_id: sid,
    submitted_at: nowIso,
    writer_staff_id: payload.writer_staff_id || null,
    writer_name: payload.writer_name || null,
    writer_email: payload.writer_email || null,
    work_date: payload.work_date || null,
    line: payload.line || null,
    source_file: "T5T-input-edge",
    metadata: {
      source_system: payload.source_system || "t5t_input_edge",
      notion_page_id: notionPageId,
      source_url: sourceUrl,
      week_key: payload.week_key,
      week_label: payload.week_label,
      org_id: payload.org_id,
      org_name: payload.org_name,
    },
  }], "submission_id");

  const itemRows = (payload.items || []).map((item) => {
    const projectIds = item.project_ids || [];
    const reviewProjectIds = item.review_project_ids || [];
    const fundIds = item.fund_ids || [];
    const assetIds = item.asset_ids || [];
    const counterpartyIds = item.counterparty_ids || [];
    const itemNo = item.item_no || 1;
    return {
      form_item_id: `${sid}-${itemNo}`,
      submission_id: sid,
      item_no: itemNo,
      writer_staff_id: payload.writer_staff_id || null,
      work_date: payload.work_date || null,
      line: payload.line || null,
      raw_text: item.raw_text || "",
      project_text: relationLabel(item),
      stakeholder_text: (item.counterparty_labels || item.counterparty_candidates || []).join(", "),
      matched_project_id: projectIds[0] || null,
      matched_review_project_id: reviewProjectIds[0] || null,
      matched_fund_id: fundIds[0] || null,
      stakeholder_ids: counterpartyIds,
      task_type: item.task_type || null,
      match_status: item.task_type || "input_linked",
      classification_summary: item.summary || null,
      metadata: {
        notion_page_id: notionPageId,
        source_url: sourceUrl,
        review_project_ids: reviewProjectIds,
        fund_ids: fundIds,
        asset_ids: assetIds,
        relation_texts: item.relation_texts || [],
        relation_labels: item.relation_labels || [],
        counterparty_candidates: item.counterparty_candidates || [],
        counterparty_labels: item.counterparty_labels || [],
        submitted_from: "t5t-input-edge",
      },
    };
  });

  if (itemRows.length) await upsertRows("t5t_form_items", itemRows, "form_item_id");
  const iotaRows = iotaRowsFromSubmission(payload, sid, itemRows, sourceUrl);
  if (iotaRows.length) await upsertIotaRows(iotaRows);
  return sid;
}

async function upsertIotaRows(rows: unknown[]) {
  try {
    await upsertRows("iota_t5t_logs", rows, "iota_log_id");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const tableMissing = lower.includes("iota_t5t_logs") &&
      (lower.includes("does not exist") || lower.includes("could not find the table") || lower.includes("pgrst205"));
    if (!tableMissing) throw error;
    console.warn("iota_t5t_logs table is not available yet; skipped IOTA copy.");
  }
}

function iotaRowsFromSubmission(
  payload: T5TPayload,
  submissionIdValue: string,
  itemRows: Array<Record<string, any>>,
  sourceUrl: string | null,
) {
  if (!isIotaTargetWriter(payload)) return [];
  return itemRows
    .map((row) => {
      const bodyText = iotaBodyText(row);
      const matchTerms = iotaMatchTerms(bodyText);
      if (!matchTerms.length) return null;
      const formItemId = row.form_item_id;
      const logId = `form_item_${formItemId}`;
      const summary = row.classification_summary || row.raw_text || "";
      const week = workWeek(payload.work_date);
      return {
        iota_log_id: logId,
        source_t5t_log_id: logId,
        source_form_item_id: formItemId,
        source_submission_id: submissionIdValue,
        writer_staff_id: payload.writer_staff_id || null,
        writer_name: canonicalIotaWriterName(payload),
        writer_email: normalizeEmail(payload.writer_email),
        line: payload.line || null,
        work_date: payload.work_date || null,
        week_key: payload.week_key || week.weekKey || null,
        week_end_date: week.weekEndDate || null,
        task_type: row.task_type || null,
        log_title: row.project_text || row.classification_summary || `T5T ${row.item_no}`,
        summary: String(summary).slice(0, 120),
        raw_text: row.raw_text || "",
        body_text: bodyText,
        source_url: sourceUrl,
        matching_status: row.match_status || null,
        matching_basis: iotaMatchingBasis(row),
        needs_manual_review: false,
        classification_summary: row.classification_summary || null,
        classification_tokens: [],
        match_terms: matchTerms,
        source_system: "t5t_input_edge_iota_copy",
        metadata: {
          copy_source: "t5t-submit",
          copied_from: "t5t_form_items",
          source_metadata: row.metadata || {},
        },
      };
    })
    .filter(Boolean);
}

function isIotaTargetWriter(payload: T5TPayload) {
  const staffId = payload.writer_staff_id || "";
  const email = normalizeEmail(payload.writer_email);
  const name = String(payload.writer_name || "");
  return IOTA_TARGET_STAFF_IDS.has(staffId) ||
    IOTA_TARGET_EMAILS.has(email) ||
    IOTA_TARGET_NAMES.some((targetName) => name.includes(targetName));
}

function canonicalIotaWriterName(payload: T5TPayload) {
  const staffId = payload.writer_staff_id || "";
  const email = normalizeEmail(payload.writer_email);
  if (IOTA_TARGET_STAFF_NAMES.has(staffId)) return IOTA_TARGET_STAFF_NAMES.get(staffId) || null;
  if (IOTA_TARGET_EMAIL_NAMES.has(email)) return IOTA_TARGET_EMAIL_NAMES.get(email) || null;
  const name = String(payload.writer_name || "");
  for (const targetName of IOTA_TARGET_NAMES) {
    if (name.includes(targetName)) return targetName;
  }
  return name.split("/", 1)[0]?.trim() || null;
}

function normalizeEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function iotaBodyText(row: Record<string, any>) {
  return [
    row.raw_text,
    row.project_text,
    row.stakeholder_text,
    row.classification_summary,
  ].filter(Boolean).join(" ");
}

function iotaMatchTerms(text: string) {
  const terms: string[] = [];
  if (
    /(^|[^A-Za-z])I\s*O\s*T\s*A([^A-Za-z]|$)/i.test(text) ||
    text.includes("\uc774\uc624\ud0c0") ||
    text.includes("\uc544\uc774\uc624\ud0c0")
  ) {
    terms.push("IOTA Seoul");
  }
  if (/(^|[^0-9])427\s*(\ud638)?([^0-9]|$)/.test(text)) terms.push("427");
  if (/(^|[^0-9])816\s*(\ud638)?([^0-9]|$)/.test(text)) terms.push("816");
  if (/(^|[^0-9])421\s*(\ud638)?([^0-9]|$)/.test(text)) terms.push("421");
  return terms;
}

function iotaMatchingBasis(row: Record<string, any>) {
  if (row.matched_project_id) return "project";
  if (row.matched_review_project_id) return "review_project";
  if (row.matched_fund_id) return "fund";
  const assetIds = row.metadata?.asset_ids || [];
  if (Array.isArray(assetIds) && assetIds.length) return "asset";
  return null;
}

function workWeek(value?: string | null) {
  if (!value) return { weekKey: null, weekEndDate: null };
  const date = parseDateOnly(value);
  if (!date) return { weekKey: null, weekEndDate: null };
  const day = date.getUTCDay();
  const mondayBased = day === 0 ? 6 : day - 1;
  const addDays = (7 - mondayBased) % 7;
  const weekEnd = new Date(date.getTime() + addDays * 24 * 60 * 60 * 1000);
  const iso = isoWeek(weekEnd);
  return {
    weekKey: `${iso.year}-W${String(iso.week).padStart(2, "0")}`,
    weekEndDate: formatDateOnly(weekEnd),
  };
}

function isoWeek(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}
