# T5T Automation Policy

## Scope

- Weekly window: previous Tuesday through current Monday
- Activity-log jobs only process source entries whose `업무일자` falls inside that weekly window

## Activity Log Deduplication

- Primary dedupe group: `작성자 + 업무일자 + 원문 URL`
- If an exact activity signature already exists in the log DB, update that row
- If the title changed but the same dedupe group already exists, try to update the most similar existing row using:
  - title similarity
  - summary similarity
  - token overlap from `classification_tokens`
- If the same dedupe group exists but no reliable target row can be identified, do not create a new row
  - mark the run as `skipped`
- Only create a new activity-log row when no existing row is found for the same dedupe group in the current weekly window

## Classification Fields

- Always write:
  - `classification_summary`
  - `classification_tokens`
- Use these fields together with the original summary when attempting:
  - `Project & Mission` matching
  - `신규 프로젝트` matching
  - dashboard keyword clustering

## Funding Classification

- Even when a row remains unmatched, classify it as `펀딩관련 업무` if the content clearly includes funding-related signals such as:
  - 투자자
  - LP
  - 수익자
  - 잠재수익자
  - 블라인드펀드 / Blind Fund
  - 코어펀드 / Core Fund / Core+
  - 펀딩 / fundraising / capital raising
- Exclude obvious internal HR or organization cases such as:
  - 채용
  - 인력
  - 인사
  - 이동발령
  - 조직
  - 부서

## Codex Automation Cards

The Codex app automations were aligned to this policy for:

- `T5T 로그DB 1차`
- `T5T 로그DB 보완`

Those card prompts now state:

- the same weekly window
- the same dedupe rule
- update-before-create behavior
- pass instead of duplicate create when an existing weekly group already exists
- token-aware matching and funding classification
