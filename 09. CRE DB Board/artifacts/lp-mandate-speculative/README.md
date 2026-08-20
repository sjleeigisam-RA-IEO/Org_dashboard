# LP mandate 추측성·검증대기 정보

이 폴더는 기사·리서치·검색 결과에서 발견했지만 공식 공고·선정결과·공시·당사자 원문으로 아직 검증되지 않은 claim을 보관한다.

## 기본 원칙

- 이 폴더의 정보는 canonical 사실이 아니며 live authority DB에 import하지 않는다.
- 기사에서 발견한 운용사·금액·vehicle·deal 연결을 삭제하지 않고 확인 과제로 남긴다.
- 동일 보도자료를 전재한 복수 기사는 하나의 `source_family`로 묶는다.
- 공식 원문이 발견되면 공식 claim을 승인 manifest로 승격하고, candidate에는 `PROMOTED`와 `promoted_manifest_id`를 기록한다.
- 공식 원문과 충돌하면 삭제하지 않고 `CONTRADICTED`와 반증 URL을 기록한다.
- 검색 snippet만 있는 경우 query와 확인 시각을 남기며 사실 claim으로 인용하지 않는다.

## 상태

- `NEWS_ONLY_PENDING_PRIMARY`
- `MULTISOURCE_CORROBORATED_PENDING_PRIMARY`
- `OFFICIAL_PLAN_RESULT_PENDING`
- `CONFLICT_REVIEW_REQUIRED`
- `PROMOTED`
- `CONTRADICTED`
- `WITHDRAWN`
- `FALSE_POSITIVE`
- `OUT_OF_SCOPE`

Schema: `config/lp-mandate-verification-candidate.schema.json`
