# CRE Market Intelligence Explorer

Supabase PostgreSQL의 `market_intelligence` schema를 읽기 전용으로 검색·색인 탐색·테이블 조회하는 Next.js 대시보드입니다.

## 주요 화면

- **통합검색**: 키워드·자료유형·기간 검색과 상세 drawer
- **카테고리 테이블**: 실제 DB category key로 필터링한 행·열 조회
- **DB 색인**: 이벤트 카테고리, 자산 유형, 문서 유형, 기관 유형, LP 상태, 매각 상태 탐색

색인에서 분류를 선택하면 해당 category table로 바로 이동합니다.

## 구조

```text
Browser
  → POST /api/auth/login {email}
  → approved-email allowlist lookup
  → PostgreSQL shared IP/account rate limit
  → signed 12-hour cre_db_session cookie
  → GET /api/search (allowlisted filters only)
  → Next.js Node runtime
  → BEGIN READ ONLY + 15s statement_timeout
  → Supabase PostgreSQL / market_intelligence
```

- 브라우저는 DB URI나 Supabase service credential을 받지 않습니다.
- 승인 이메일과 login throttle state는 PostgreSQL `app_security` schema에만 있고 세션·SQLite에 복제하지 않습니다.

- 보호 요청은 opaque subject ID의 승인 성공만 함수 메모리에 30초간 보관합니다. 거부·DB 오류는 캐시하지 않고 fail closed하며, 권한 철회와 `access_expires_at` 반영은 이미 승인된 warm instance에서 최대 30초 지연될 수 있습니다.
- raw SQL endpoint는 없습니다.
- 검색어·유형·기간·페이지 값은 고정 SQL의 bind parameter로만 전달됩니다.
- raw document body는 반환하지 않고 최신 version의 title과 snippet만 사용합니다.
- 쓰기·승인·검수 기능은 제공하지 않습니다.

## 로컬 실행

로컬에서는 다음 중앙 파일만 서버 runtime에서 읽습니다.

```text
C:\10137_WorkSpace\env\.env.supabase.local
```

앱 폴더로 `.env.supabase.local`을 복사하지 않습니다.

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다.

## 품질 검증

```bash
npm test
npm run lint
npm run build
node scripts/visual-qa.mjs
```

`visual-qa.mjs`의 기본 대상은 `http://127.0.0.1:3001`이며 다른 주소는 `BASE_URL`로 지정할 수 있습니다.

## 운영 환경변수

운영 runtime에는 DB 연결 설정 중 하나와 세션 secret을 서버 전용으로 제공합니다.

- `SUPABASE_DB_URL`: dashboard 전용 PostgreSQL connection string
- `SUPABASE_ENV_FILE`: 로컬 중앙 env 파일을 사용할 때만 지정
- `DASHBOARD_SESSION_SECRET`: 12시간 `cre_db_session` HMAC 서명용 32-byte 이상 server secret


`NEXT_PUBLIC_` 접두사로 DB 설정을 만들지 않습니다.

Vercel Node 함수와 Node proxy는 `vercel.json`의 project-level `regions: ["icn1"]`을 함께 상속해 서울 Supabase와 같은 권역에서 실행합니다. Next.js 16에서 deprecated된 route별 `preferredRegion` export는 사용하지 않습니다.

## 권장 read-only PostgreSQL role

아래 SQL은 관리자 검토 후 `market_intelligence` schema에만 적용합니다. `<runtime-role>`과 비밀번호는 secret manager에서 별도로 생성하며 source나 문서에 기록하지 않습니다.

```sql
CREATE ROLE market_dashboard_reader NOLOGIN;
GRANT CONNECT ON DATABASE postgres TO market_dashboard_reader;
GRANT USAGE ON SCHEMA market_intelligence TO market_dashboard_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA market_intelligence TO market_dashboard_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA market_intelligence TO market_dashboard_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA market_intelligence
  GRANT SELECT ON TABLES TO market_dashboard_reader;

-- 별도로 생성한 LOGIN role에 market read 권한을 상속
GRANT market_dashboard_reader TO <runtime-role>;

-- 인증 경로에 필요한 최소 권한만 직접 부여
GRANT USAGE ON SCHEMA app_security TO <runtime-role>;
GRANT SELECT (access_subject_id, email_normalized, is_enabled, revoked_at, access_expires_at)
  ON app_security.dashboard_access_allowlist TO <runtime-role>;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON app_security.dashboard_login_rate_limits TO <runtime-role>;

-- role 전체를 read-only로 설정하면 rate-limit write도 차단되므로 사용하지 않음
ALTER ROLE <runtime-role> SET statement_timeout = '15s';
```

market 검색은 앱이 `BEGIN READ ONLY` transaction으로 강제하고, 인증 rate-limit 경로만 별도 write transaction을 사용합니다. 운영에서는 위 최소권한 role과 실제 grant readback을 함께 적용하는 것이 원칙입니다.
현재 중앙 connection이 owner/admin 계열이면 운영에 재사용하지 말고, 위 전용 role의 별도 DSN과 실제 grant readback을 먼저 준비합니다.

## 팀 접근제어 배포

DB migration → runtime role의 최소 allowlist SELECT 및 rate-limit write 권한 → 승인 이메일 등록 → web/API 배포 → Android 배포 순서를 지킵니다. 상세 권한·승인·해제 절차는 [`docs/dashboard-email-access.md`](../docs/dashboard-email-access.md)에 기록했습니다. Production migration과 배포는 명시 승인 전 실행하지 않습니다.

## Supabase 운영 주의

- 이 앱은 Supabase Data API나 browser SDK가 아니라 server-side PostgreSQL Session pooler 연결을 사용합니다.
- 따라서 custom schema exposed setting이나 RLS에 의존하지 않습니다.
- 현재 계약은 사전 등록된 승인 이메일만 사용하는 allowlist 방식이며 메일함 OTP/SSO 계약은 아닙니다.
- login rate limit은 PostgreSQL 공유 저장소에서 IP와 account를 각각 제한하고, 인증 DB 장애 시 fail closed 처리합니다.
- `public` schema를 변경하거나 초기화하지 않습니다.
