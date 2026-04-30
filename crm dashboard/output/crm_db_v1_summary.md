# CRM DB v1 Summary

## 구성

- entity master: 837건
- entity role bridge: 908건
- alias master: 837건
- taxonomy rows: 11건

## 설계 원칙

- 동일 법인/기관이 여러 역할을 가질 수 있으므로 `entity`와 `role`을 분리했습니다.
- `DB손해보험`, `신한캐피탈`처럼 수익자와 대주 양쪽에 등장하는 경우도 한 엔티티 아래 복수 역할로 적재됩니다.
- `매도인`, `공제회`, `신한`처럼 아직 법인 특정이 덜 된 이름은 우선 엔티티로 보관하고, 추후 alias 또는 병합 규칙으로 정리합니다.
- T5T 분류명은 별도 컬럼(`t5t_type_name`)으로 유지해 현재 대시보드와의 호환성을 남겨둡니다.

## 그룹별 엔티티 수

- 자문/중개 (`advisor_intermediary`): 6건
- 자본 파트너 (`capital_partner`): 481건
- 금융 파트너 (`financing_partner`): 327건
- 임차/사용자 (`occupier_customer`): 11건
- 운영/시공 파트너 (`project_partner`): 64건
- 공공/행정 (`public_authority`): 4건
- 전략/해외 파트너 (`strategic_partner`): 5건
- 거래 상대방 (`transaction_counterparty`): 6건

## 다음 작업 권장

- CRM 수기 입력 시 `entity master`를 기준 테이블로 사용하고, 역할 확장은 `entity role bridge`에 누적합니다.
- T5T 키워드 추출어와 실명 법인을 연결할 alias 규칙을 별도 관리하면 `신한` → `신한캐피탈/신한은행` 같은 모호성 정리가 가능해집니다.
- 추후 `운영사`, `시공사`, `주민단`, `공공기관` 정보를 더 넣을 때는 taxonomy만 확장하고 entity 구조는 그대로 유지하면 됩니다.
