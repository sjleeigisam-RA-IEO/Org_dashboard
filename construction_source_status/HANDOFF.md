# Construction Information Dashboard Handoff

작성일: 2026-07-06 KST

대상 경로: `construction_source_status/`

현재 공개 URL: `https://sjleeigisam-ra-ieo.github.io/Org_dashboard/construction_source_status/`

포탈 진입점: 루트 로그인 화면 `index.html`과 로그인 후 포탈 `portal.html`에는 이 공개 URL을 새 탭으로 여는 `시공사 정보` 외부 링크 버튼을 둔다. 이 대시보드는 시공사 정보 전용 로그인 화면을 거친 사용자만 열람하도록 운영한다.

## 1. 목적

`Construction Information`은 공사 관련 회사의 공개 순위/실적 자료를 한 화면에서 비교하고, 각 회사의 최근 수주, 기사/전략 신호, 신용등급, 코멘트를 함께 확인하기 위한 정적 GitHub Pages 대시보드다.

최초 요청은 시공능력평가순위, 흔히 말하는 도급공사 순위를 2026년 최신 자료로 확인하고 계속 업데이트할 수 있는 공개 사이트/API가 있는지 찾는 것이었다. 이후 범위가 CM, 설계/엔지니어링, 건설엔지니어링 통계로 확장되었고, 최종적으로 아래 네 계열의 공개 소스를 중심으로 정리했다.

- 대한건설협회 공시/업체검색
- 한국CM협회/KISCON CM능력평가공시
- ETIS 엔지니어링종합정보시스템
- 한국건설엔지니어링협회(KACEM) 통계

그 뒤 회사별 세부 정보 요구가 붙으면서 OpenDART, 나라장터, Google News, KIS/NICE 신용등급 검색, 사내 참고 PDF, Supabase 댓글 저장소가 보조 데이터로 추가되었다.

## 2. 현재 산출물

- `index.html`: GitHub Pages에 그대로 배포되는 정적 대시보드.
- `login.html`: 포탈로 보내지 않는 시공사 정보 전용 로그인 화면. 같은 RA 인증 API를 쓰지만 성공 후 기본 리다이렉트는 이 대시보드다.
- `README.md`: 폴더 구성과 현재 스냅샷 요약.
- `HANDOFF.md`: 이 문서.
- `data/construction_source_status_data.json`: 순위표와 각 행의 수주/기사/신용등급이 합쳐진 렌더링용 스냅샷.
- `data/construction_company_source_map.json`: 회사명/별칭/수동 소스 매핑.
- `data/construction_dart_awards_cache.json`: OpenDART 단일판매ㆍ공급계약체결 수주 캐시.
- `data/construction_nara_contracts_cache.json`: 나라장터 공사 계약정보 캐시.
- `data/construction_company_news_cache.json`: Google News RSS 기사 캐시.
- `data/construction_dart_strategy_cache.json`: OpenDART 투자/출자/시설투자/M&A/자금조달/계열거래성 공시 캐시.
- `data/construction_credit_ratings_cache.json`: KIS/NICE 공개 검색 + OpenDART 채무증권 보조 신용등급 캐시.
- `data/construction_online_update_marks.json`: 직전 캐시 대비 새 기사/계약/공시 항목이 추가된 회사 표시용 스냅샷.
- `data/construction_pdf_comments.json`: `시공사_동향_20260703.pdf`에서 추린 초기 코멘트.
- `scripts/`: 위 데이터를 다시 수집하고 HTML을 재생성하는 Python 스크립트 복사본.
- `시공사_동향_20260703.pdf`: 초기 코멘트 작성에 사용한 사내 참고 PDF.

## 3. 데이터 출처와 사용 방식

### 3.1 순위/실적 탭

| 탭 | 출처 | 현재 구현 |
| --- | --- | --- |
| 시공능력 | 대한건설협회 건설업체 검색 + 공시자료 xlsx | 현재 순위는 CAK 공개 AJAX JSON에서 상위 30개를 읽는다. 전년순위는 전년도 공시자료 xlsx의 토건 순위를 등록번호 우선, 회사명 보조로 매칭한다. |
| CM | 한국CM협회/KISCON CM능력평가공시 | 공시연도별 업체 데이터를 읽어 용역형 CM 실적 기준으로 정렬한다. 전년도 공시연도를 같은 방식으로 읽어 전년순위와 변동을 붙인다. |
| ETIS 전체 | ETIS 통계 PDF | 최신 연도 전체 엔지니어링 실적 PDF를 표 추출한다. 원자력/정보통신 등 비건설 분야도 포함될 수 있다. |
| ETIS 건설 | ETIS 통계 PDF | 건설부문 PDF만 표 추출한다. 공사 관련 설계/엔지니어링사를 볼 때 더 적합하다. |
| KACEM 분기 | 한국건설엔지니어링협회 통계 PDF | 분기 통계 PDF를 표 추출해 건설엔지니어링 실적 순위를 보여준다. |

모든 탭은 검토 편의상 상위 30위까지만 표시한다. 소스 설명은 화면 하단의 안내/디스클레이머 영역으로 모았고, 탭 상단에는 표 자체에 필요한 최소 정보만 남겼다.

### 3.2 최근 수주/계약

회사 행을 열면 왼쪽 영역에 최근 수주/계약 5건이 표시된다.

사용 소스는 세 갈래다.

- 수동/보도 기반 캐시: `construction_company_source_map.json` 및 기존 수동 캐시를 통해 보완.
- OpenDART: 단일판매ㆍ공급계약체결 공시를 최근 5년 범위로 조회.
- 나라장터: `조달청_나라장터 계약정보서비스`의 공사 계약현황 API를 회사명 기준으로 필터링.

표시 기준은 회사별 최신 5건이다. 공사 연면적이 원문에서 추출되는 경우에는 `계약금액 / 연면적`으로 공사비 단가를 계산해 함께 표시한다. 연면적이 없으면 단가를 억지로 만들지 않는다.

### 3.3 기사/전략 정보

회사 행을 열면 오른쪽 영역에 기사/전략 정보 5건이 표시된다.

사용 소스는 두 갈래다.

- Google News RSS: 회사명과 수주, 계약, 실적, 경영, 투자, 계열사, 신사업, 인프라 등 키워드를 조합해 조회.
- OpenDART 전략공시: 투자판단, 출자, 시설투자, M&A/구조개편, 자금조달, 특수관계인 거래성 공시를 조회.

같은 프로젝트나 같은 이벤트로 보이는 유사 기사군은 대표 1건만 남기도록 제목 정규화와 이벤트 키워드 기반 중복 제거를 적용했다. 완전한 의미 기반 중복 제거는 아니므로 주요 회사는 수동 검토가 필요하다.

OpenDART 전략공시의 내부 카테고리 값은 필터링과 중복 제거 보조용으로만 사용한다. 화면과 렌더링 데이터의 기사 제목에는 `투자판단:`, `자금조달:` 같은 분류 접두어를 붙이지 않는다.

### 3.4 온라인 업데이트 표시

회사명 옆의 `UPDATE` 카드는 `outputs/construction_online_update_marks.json`에 기록된 회사에만 표시한다. 이 파일은 갱신 전 캐시 백업과 갱신 후 `outputs/` 캐시를 비교해 만든다.

판정 대상은 Google News 기사, 나라장터 계약, OpenDART 수주공시, OpenDART 전략공시다. 단순히 캐시 생성 시각이 바뀐 회사가 아니라, 이전 캐시에 없던 기사 제목, 공시 접수번호, 또는 계약/프로젝트 키가 추가된 회사만 표시한다. 신용등급은 표의 등급 pill 자체가 변경 상태를 보여주므로 `UPDATE` 판정에는 넣지 않는다.

갱신 마크 파일은 회사 단위 `added_count`와 함께 개별 항목 `item_keys`도 저장한다. 회사명 옆 `UPDATE` 카드는 회사 단위 알림이고, 펼친 상세 카드 안에서는 이번 갱신으로 새로 추가된 개별 수주/기사 카드의 최상단 메타 텍스트만 노란색으로 표시한다. 기존 항목의 메타 텍스트는 파란색이다. 다음 갱신 때 `mark_construction_online_updates.py`를 다시 실행하면 이전 노란색 항목은 새 diff 대상에서 빠져 파란색으로 돌아가고, 새로 추가된 항목만 노란색이 된다.

### 3.5 신용등급

신용등급은 별도 큰 카드로 공간을 쓰지 않고, 회사 기본 정보와 표의 `신용등급` 컬럼에 함께 표시한다.

수집 우선순위는 다음과 같다.

1. KIS 공개 회사별 등급검색
2. NICE 공개 회사별 등급검색
3. OpenDART 채무증권 API의 최근 5년 신용등급 필드

한국기업평가 유효등급 List와 NICE 유효등급 리스트처럼 로그인/유료/제한 영역에 가까운 데이터는 자동 수집 대상에서 제외했다. 따라서 공개 검색에 잡히지 않는 회사는 `미확인`으로 남을 수 있다.

### 3.6 코멘트

코멘트는 두 종류를 화면에서는 하나로 합쳐 표시한다.

- 초기 코멘트: `시공사_동향_20260703.pdf`에서 추린 내용. 작성자는 `개발솔루션센터 센터장`으로 유지했다.
- 온라인 코멘트: Supabase `construction_company_comments` 테이블에 저장되는 사용자 입력.

UI에는 출처 구분 라벨을 두지 않고 `Comment`로만 담백하게 표시한다. PDF에서 가져온 코멘트도 온라인 코멘트와 같은 목록에 섞여 보인다. PDF 안에 있는 사람 이름은 블라인드 처리했고, 신빙성을 위해 부서/직책 수준의 인터뷰 역할만 남겼다.

코멘트 본문은 줄바꿈을 보존해 표시한다. 초기 코멘트는 빌드 시 문장 단위 줄바꿈을 적용하고, 온라인 코멘트는 사용자가 입력한 실제 줄바꿈과 `\n` 형태의 줄바꿈을 모두 인식한다.

`Comment` 컬럼의 숫자는 현재 로드된 코멘트 개수다. `New` 컬럼의 `N` 배지는 최근 31일 이내에 새 코멘트가 있는 경우에만 표시한다. 수주/기사/전략 정보가 최근이라는 이유로 `N`을 붙이지 않는다.

온라인 코멘트는 `CRM_base/portfolio-analysis/config.js`의 Supabase 공개 URL/키를 읽어 정적 HTML 안에 반영한다. 이 키는 브라우저에서 쓰는 publishable key이며, 운영 시에는 Supabase RLS 정책을 반드시 유지해야 한다.

코멘트 입력에는 `우리회사 협업사` 체크와 `관련 프로젝트` 입력을 함께 둔다. 현재 Supabase 스키마를 즉시 늘리지 않기 위해 이 정보는 기존 `body` 컬럼 앞부분에 `협업: 예`, `프로젝트: ...` 줄로 저장하고, 화면에서는 이를 파싱해 코멘트 본문 위의 태그로 분리 표시한다. 향후 `is_partner`, `project_name` 같은 별도 컬럼을 추가할 경우 이 앞줄을 기준으로 마이그레이션할 수 있다.

대시보드 조회와 코멘트 작성은 로그인 사용자에게만 열리도록 했다. 로그인은 루트 포탈 로그인 화면으로 보내지 않고 `construction_source_status/login.html`에서 처리한다. 이 화면은 `shared/ra-auth.js`와 Supabase `ra-auth` Edge Function을 공유하지만, 로그인 성공 후 `portal.html`이 아니라 시공사 정보 대시보드로 돌아간다. 설정 코드는 별도 채널로 안내하며 화면과 운영 문서에 직접 노출하지 않는다. 로그인 화면에는 비로그인 사용자가 대시보드로 돌아가는 링크를 두지 않는다. 로그인 후 헤더 우상단에는 `이름 (이메일)`과 로그아웃 버튼을 표시하고, 새 코멘트 작성자 칸에도 같은 값이 미리 들어가며, 기존에 저장된 코멘트의 `author_name`은 그대로 유지한다. 현재 단계의 접근 제한은 브라우저 UI 기준이며, DB 레벨에서 RA 세션을 강제하려면 댓글 저장을 별도 Edge Function으로 프록시하고 `construction_company_comments`의 anon insert 정책을 닫아야 한다.

## 4. 화면 표현 방식

- 첫 화면 제목은 `Construction Information`이다.
- 탭은 `시공능력`, `CM`, `ETIS 전체`, `ETIS 건설`, `KACEM 분기`로 구성한다.
- 표는 현재 순위를 가장 강조하고, 전년순위/변동은 보조 정보로 둔다.
- 회사명 행을 클릭하면 세부 정보가 펼쳐진다.
- 한 회사를 열고 다른 회사를 열면 기존 열린 행은 닫힌다.
- 열린 행은 배경, 경계선, 행 상태로 닫힌 행과 시각적으로 구분한다.
- 세부 정보 상단에는 회사 기본 정보와 신용등급을 압축 표시한다.
- 신용등급 pill은 등급군별로 색을 달리한다. AA 이상은 초록, A는 파랑, BBB는 노랑, BB/B는 주황, C/D 계열은 빨강, 미확인은 회색으로 표시한다.
- 세부 정보 본문은 데스크톱에서 좌우 2열이다.
  - 왼쪽: 최근 수주/계약 5건
  - 오른쪽: 기사/전략 정보 5건
- 상세 수주/기사 카드의 상단 날짜/출처 메타는 기존 항목은 파란색, 이번 온라인 갱신에서 새로 추가된 항목은 노란색으로 표시한다. 제목과 본문 색은 바꾸지 않는다.
- 모바일에서는 세부 정보가 1열로 내려온다.
- 하단에는 코멘트 입력/목록이 있다.
- 코멘트 영역은 수주/기사 카드보다 더 잘 보이도록 앰버 계열 테두리, 헤더, 본문 강조색을 사용한다.
- Org_dashboard 계열의 어두운 테마를 강하게 승계했다.

현재는 수주와 기사를 별도 토글로 접고 펴는 기능은 구현하지 않았다. 사용자가 이 방향을 검토하다가 대시보드 제목의 `Information` 정비로 의도를 수정했기 때문에, 엉뚱한 기능 변경을 피하고 현재 구조를 유지했다.

## 5. 주요 스크립트

루트에서 실행하는 것을 기준으로 한다.

```powershell
# 갱신 전 캐시 백업. 이후 UPDATE 카드 판정의 비교 기준으로 사용한다.
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backup = Join-Path .\outputs "construction_refresh_before_$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Get-ChildItem .\outputs -Filter 'construction_*cache.json' | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $backup $_.Name) -Force
}

# OpenDART 단일판매ㆍ공급계약체결 수주 캐시
python .\construction_source_status\scripts\update_construction_dart_awards.py --lookback-years 5 --per-company 5

# 나라장터 공사 계약정보 캐시
$today = Get-Date
$naraStart = $today.AddDays(-14).ToString('yyyyMMdd')
$naraEnd = $today.ToString('yyyyMMdd')
python .\construction_source_status\scripts\update_construction_nara_contracts.py --start-date $naraStart --end-date $naraEnd --per-company 5 --max-pages 5 --rows-per-page 50

# Google News RSS 기사 캐시
python .\construction_source_status\scripts\update_construction_company_news.py --days 365 --per-company 5

# OpenDART 투자/전략 공시 캐시
python .\construction_source_status\scripts\update_construction_dart_strategy.py --lookback-years 5 --per-company 5

# KIS/NICE + OpenDART 보조 신용등급 캐시
python .\construction_source_status\scripts\update_construction_credit_ratings.py --scope cak --dart-mode off

# 이번 갱신에서 새 온라인 항목이 추가된 회사 표시 파일 생성
python .\construction_source_status\scripts\mark_construction_online_updates.py --before-dir $backup --after-dir .\outputs

# 순위 원천 수집 + 캐시 결합 + HTML/JSON 생성
python .\construction_source_status\scripts\build_construction_source_status.py
```

각 수집 스크립트는 기본적으로 루트 `outputs/`에 캐시를 쓴다. 빌더도 `outputs/construction_source_status.html`과 `outputs/construction_source_status_data.json`을 만든다. Pages에 올릴 번들은 아래처럼 `construction_source_status/`로 복사한다.

```powershell
Copy-Item .\outputs\construction_source_status.html .\construction_source_status\index.html -Force
Copy-Item .\outputs\construction_source_status_data.json .\construction_source_status\data\construction_source_status_data.json -Force
Copy-Item .\outputs\construction_company_news_cache.json .\construction_source_status\data\construction_company_news_cache.json -Force
Copy-Item .\outputs\construction_credit_ratings_cache.json .\construction_source_status\data\construction_credit_ratings_cache.json -Force
Copy-Item .\outputs\construction_dart_awards_cache.json .\construction_source_status\data\construction_dart_awards_cache.json -Force
Copy-Item .\outputs\construction_dart_strategy_cache.json .\construction_source_status\data\construction_dart_strategy_cache.json -Force
Copy-Item .\outputs\construction_nara_contracts_cache.json .\construction_source_status\data\construction_nara_contracts_cache.json -Force
Copy-Item .\outputs\construction_online_update_marks.json .\construction_source_status\data\construction_online_update_marks.json -Force
Copy-Item .\outputs\construction_refresh_run_log.json .\construction_source_status\data\construction_refresh_run_log.json -Force
```

필요한 키:

- OpenDART: `.env` 또는 `iota_platform/.env`의 `OPENDART_KEY`, `OPEN_DART_KEY`, `DART_KEY`, `CRTFC_KEY`, `crtfc_key`, `key` 중 하나.
- 나라장터: `.env`의 `DATA_GO_KR_KEY`.
- Supabase 댓글: `CRM_base/portfolio-analysis/config.js`의 publishable URL/key.

## 6. 권장 업데이트 주기

대시보드를 개선하면서 데이터 소스, DB, 캐시 파일, 수집 스크립트, Supabase 테이블, 배포 절차 중 하나라도 바뀌면 이 문서와 `README.md`의 업데이트 관련 내용을 함께 수정한다. 화면만 바꾸는 작업처럼 보여도 `Comment`, `New`, 기사/전략 정보, 신용등급, 수주 캐시의 의미가 달라지면 운영 문서를 같이 갱신해야 한다.

이 대시보드 개선 작업은 로컬 커밋에서 멈추지 않고 `origin/main` 푸시와 GitHub Pages 반영 확인까지 한 세트로 처리한다.

### 매주 월요일 06:00 KST

현재 운영 기준은 Codex 이 스레드의 heartbeat 자동화가 월요일 오전 6시에 실행되는 것이다. OpenDART 공시, Google News 기사, 나라장터 공사 계약정보를 함께 갱신하고, 변경 여부와 무관하게 `data/construction_refresh_run_log.json`에 실행 로그를 남긴다. 실행 로그가 주간 보완 루틴의 기준이므로 화면 변경이 없어도 log-only commit/push를 허용한다.

실행 대상:

- 모든 수집 스크립트
- `build_construction_source_status.py`
- 번들 복사
- `construction_refresh_run_log.json` 작성
- 커밋/푸시
- GitHub Pages 완료 확인

### 매주 화요일 06:00 KST

같은 heartbeat 자동화가 화요일 오전 6시에 다시 깨어 직전 월요일 실행 로그를 검사한다. 월요일 `monday-main` 로그가 있고 `success` 또는 `partial`이며 Pages 확인 기록이 있으면 재실행하지 않고 `tuesday-fallback-check` 로그만 남긴다. 로그가 없거나 실패/미확인 상태라면 즉시 동일한 갱신 절차를 `tuesday-fallback-rerun`으로 실행한다.

### 매월 1회

신용등급 캐시는 월 1회 정도면 충분하다. 단, 특정 회사의 등급 이벤트나 자금조달 이슈가 있으면 즉시 갱신한다.

실행 대상:

- `update_construction_credit_ratings.py`
- `build_construction_source_status.py`

### 분기/연간 또는 원천 공시 직후

CAK, CM, ETIS, KACEM 원천 순위는 연간/분기 공시 성격이 강하다. 공식 사이트에 새 공시가 올라오면 바로 빌더를 돌려 전년순위와 변동을 재확인한다.

실행 대상:

- `build_construction_source_status.py`
- 필요 시 원천 PDF/xlsx 파싱 로직 보정

### 사내 인터뷰/PDF 업데이트 직후

새로운 시공사 동향 PDF나 인터뷰 메모가 있으면 `data/construction_pdf_comments.json`을 갱신한다. 사람 이름은 블라인드 처리하고, 부서/직책 수준의 역할만 남기는 원칙을 유지한다.

`New` 배지는 코멘트 날짜 기준으로 붙으므로, 코멘트 날짜도 실제 작성/확인일로 넣어야 한다.

## 7. 현재 자동화

현재 자동화는 Codex 이 스레드에 붙은 단일 heartbeat로 운영한다. 앱 제약상 한 스레드에 활성 heartbeat는 하나만 붙일 수 있으므로, 하나의 자동화가 월요일 정기 갱신과 화요일 보완 검사를 요일별로 분기한다.

- 자동화 ID: `construction-information-monthly-refresh`
- 이름: `Construction Information weekly refresh and retry check`
- 실행 위치: 현재 시공사 정보 대시보드 스레드
- 실행 시각: 매주 월요일 06:00 KST, 매주 화요일 06:00 KST
- 월요일: `monday-main` 갱신 실행
- 화요일: 월요일 로그 확인 후 `tuesday-fallback-check` 또는 `tuesday-fallback-rerun`

자동화가 실행할 때는 기존 무관 dirty 파일을 건드리지 않고, `construction_source_status/` 관련 파일만 stage/commit/push한다. 원격 배포 확인은 항상 포함한다. Pages 확인 뒤에는 같은 run log entry에 `commit`, `pushed`, `pages_verified`, `pages_verified_at`, `pages_url`을 최종 반영하고, 이 로그 변경만 log-only commit/push로 한 번 더 올릴 수 있다.

향후 GitHub Actions로 이전할 수는 있지만, 그 경우에도 현재 run log 계약과 화요일 fallback 조건을 유지해야 한다. Actions secrets에는 `OPENDART_KEY`, `DATA_GO_KR_KEY`만 넣고, 관리자성 Supabase key는 정적 HTML이나 공개 로그에 노출하지 않는다.

## 8. 검증 체크리스트

갱신 후 최소한 아래를 확인한다.

```powershell
python -m py_compile .\construction_source_status\scripts\build_construction_source_status.py
python -m py_compile .\construction_source_status\scripts\update_construction_company_news.py
python -m py_compile .\construction_source_status\scripts\update_construction_credit_ratings.py
python -m py_compile .\construction_source_status\scripts\update_construction_dart_awards.py
python -m py_compile .\construction_source_status\scripts\update_construction_dart_strategy.py
python -m py_compile .\construction_source_status\scripts\update_construction_nara_contracts.py
python -m py_compile .\construction_source_status\scripts\mark_construction_online_updates.py
```

HTML 확인 포인트:

- `<title>`과 `<h1>`이 `Construction Information`인지 확인.
- 새 기사/계약/공시가 추가된 회사명 옆에만 `UPDATE` 카드가 붙는지 확인.
- `Comment (0)`인 행에는 `N`이 붙지 않는지 확인.
- PDF 파일명이나 내부 출처 라벨이 화면 코멘트에 노출되지 않는지 확인.
- 인터뷰 메타는 사람 이름 없이 부서/직책만 보이는지 확인.
- 회사 행을 하나 연 뒤 다른 회사를 열면 기존 행이 닫히는지 확인.
- 데스크톱에서 수주/기사 영역이 좌우 2열로 정렬되는지 확인.
- 모바일에서 1열로 무리 없이 내려오는지 확인.

배포 확인 포인트:

- 원격 커밋이 `origin/main`에 올라갔는지 확인.
- GitHub Pages 배포가 성공했는지 확인.
- 공개 URL에서 캐시를 피하려면 쿼리스트링을 붙여 확인한다.

```text
https://sjleeigisam-ra-ieo.github.io/Org_dashboard/construction_source_status/?v=YYYYMMDDHHMM
```

이 저장소의 Pages 경로는 루트 도메인이 아니라 `/Org_dashboard/` 하위 경로다. URL을 만들 때 이 부분을 빼면 404가 날 수 있다.

## 9. 알려진 한계와 주의사항

- CAK/CM/ETIS/KACEM은 공식 API라기보다 공개 HTML, PDF, xlsx를 읽는 성격이 강하다. 사이트 구조가 바뀌면 파서 보정이 필요하다.
- Google News RSS는 같은 사건을 완전히 의미적으로 병합하지 못한다. 현재는 제목/이벤트 기반 중복 제거로 충분히 줄인 상태다.
- 나라장터는 회사명 기준 필터링이라 동일/유사 법인명 매칭을 주기적으로 확인해야 한다.
- 신용등급은 공개 검색 기반이라 모든 회사가 잡히지 않는다.
- 온라인 코멘트 작성자 정책은 아직 확정되지 않았다. 다만 `개발솔루션센터 센터장` 코멘트는 공식성 있는 초기 기록으로 유지한다.
- Supabase RLS가 풀리면 정적 HTML에서 댓글 테이블이 과도하게 노출될 수 있으므로, 테이블 정책은 별도로 관리해야 한다.
- GitHub Pages는 간헐적으로 배포 실패가 날 수 있다. 코드 변경이 없고 배포만 실패한 경우 빈 커밋으로 재시도한 전례가 있다.
