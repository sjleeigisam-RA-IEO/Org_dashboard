# 포트폴리오 통합 검색 인덱스 설계

- 후보 CSV: `portfolio_search_index_candidates.csv`
- 검색 토큰 후보: 14897행

## 검색 범위

- 자산명: `final_asset_name`
- 프로젝트명/업무 라벨: 실제 프로젝트명 또는 fund context label
- 펀드명/비히클명: `fund_name`, `short_name`
- 수익자명: `beneficiary_exposures.beneficiary_clean`
- 대주명: `lender_exposures.lender_clean`
- 주소/지역명: 자산 주소에서 시/도, 구/군 등 토큰 추출

## 엔티티 타입별 토큰

| entity_type | count |
|---|---:|
| `address` | 5043 |
| `project_context` | 3758 |
| `fund` | 1930 |
| `asset` | 1647 |
| `beneficiary` | 1100 |
| `project` | 843 |
| `lender` | 576 |

## 토큰 타입별 건수

| token_type | count |
|---|---:|
| `address_region` | 5043 |
| `project_or_business_label` | 4601 |
| `asset_name` | 1647 |
| `beneficiary_name` | 1100 |
| `fund_name` | 965 |
| `fund_short_name` | 965 |
| `lender_name` | 576 |

## 표시 원칙

- 검색은 넓게 잡되, 결과 클릭 후에는 entity_type에 맞는 drawer를 연다.
- 프로젝트명은 필수 정식명칭이 아니라 검색 가능한 업무 라벨로 취급한다.
- `project_context` 결과는 실제 프로젝트가 아니라 자산+펀드 맥락 drawer로 연다.
- 주소/지역 검색은 자산 drawer로 연결한다.
- 수익자/대주 검색은 해당 투자/대출 익스포저 drawer에서 연결 자산·펀드를 보여준다.