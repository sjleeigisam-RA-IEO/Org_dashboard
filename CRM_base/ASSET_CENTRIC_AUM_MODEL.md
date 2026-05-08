# 자산 중심 AUM 산정 및 포트폴리오 관계 모델

## 1. 목적

현재 포트폴리오 대시보드의 AUM은 `funds` row를 기준으로 합산하는 구조에 가깝다. 그러나 실제 분석 목적은 특정 자산군, 예를 들어 물류센터, 오피스, 데이터센터 등으로 포트폴리오를 볼 때 그 자산에 귀속되는 펀드와 투자 구조를 기준으로 약정기준/투입기준 AUM을 계산하는 것이다.

따라서 AUM 산정의 기준 축은 `funds`가 아니라 `asset_master`가 되어야 한다.

```text
asset_master
  -> asset_fund_links
  -> funds
  -> fund_fund_links
```

## 2. 핵심 원칙

### 2.1 자산은 물리적 건물만 의미하지 않는다

`asset_master`는 실물 부동산만 담는 테이블이 아니라 투자 대상 단위의 canonical master로 본다.

자산 유형은 다음 네 가지를 허용한다.

```text
physical_asset       실제 주소/PNU/건축물 정보가 있는 실물 자산
portfolio_asset      유럽 오피스 포트폴리오, 글로벌 물류 포트폴리오 같은 묶음형 투자 대상
fund_interest        특정 외부 펀드/재간접 비히클 지분
synthetic_bucket     메자닌, 공모주, 채권, 리츠 등 실물 자산으로 특정하기 어려운 투자 바스켓
```

이렇게 하면 자산을 특정할 수 없는 재간접 또는 포트폴리오 투자도 결측치가 아니라 `포트폴리오형 가상 자산`으로 관리할 수 있다.

### 2.2 필터는 자산 기준으로 먼저 적용한다

예를 들어 `물류센터` 필터를 적용하면 다음 순서로 계산한다.

```text
1. asset_master에서 물류센터 성격의 asset_id를 선택
2. asset_fund_links에서 해당 asset_id에 연결된 fund_id를 추출
3. 직접 자산 보유 펀드와 포트폴리오형 가상 자산 연결 펀드를 구분
4. fund_fund_links가 있으면 재간접/상위 투자 관계를 look-through
5. 약정기준/투입기준 금액을 asset-fund relation 단위로 합산
```

펀드명에 `유럽 오피스`, `US Logistics`, `Global Data Center`, `Secondary`, `Fund`, `Portfolio` 같은 단서가 있고 실제 건물 정보가 없으면 `portfolio_asset` 또는 `fund_interest`를 생성해 연결한다.

### 2.3 포트폴리오 펀드 전체를 잘못 끌고 오지 않는다

포트폴리오 펀드가 다양한 자산군을 담고 있을 때 특정 자산군 필터에 펀드 전체 AUM을 포함하면 과대 계산이 된다.

따라서 다음 원칙을 둔다.

```text
동일 자산군만 담은 멀티에셋 펀드
  -> allocation_ratio가 없으면 100% 포함 가능

복수 자산군 혼합 펀드
  -> allocation_ratio 또는 allocated_aum이 없으면 배분불가로 표시

재간접/포트폴리오 펀드
  -> 직접 실물 자산으로 억지 매핑하지 않고 portfolio_asset/fund_interest로 연결
  -> 하위 직접 보유 펀드 관계가 확인되면 fund_fund_links로 look-through
```

### 2.4 개발 자산은 최소 수동 입력 + API 보강 구조로 관리한다

개발 자산은 현재 건축물대장 정보가 없을 수 있다. 이 경우 모든 정보를 수동 입력하지 않는다.

주소/PNU로 받을 수 있는 정보는 API로 보강하고, 사람이 입력하는 값은 API로 얻기 어려운 예정 정보로 제한한다.

수동 입력 최소 항목:

```text
development_project_name
planned_main_usage
planned_gross_floor_area
expected_completion_date
development_stage
notes
```

API 또는 향후 준공 후 마이그레이션으로 보강할 항목:

```text
pnu
latitude / longitude
법정동 / 시군구
site_area
zoning
building_register_exists
main_usage
gross_floor_area
floors_up / floors_down
completion_date
```

준공 후에는 동일 `asset_id`를 유지하고 API 재조회로 `asset_master`와 `asset_building_ledger`를 업데이트한다.

## 3. AUM 산정 로직

### 3.1 relation 단위 계산

AUM은 `funds` 전체 단순합이 아니라 `asset_fund_links`의 relation 단위로 계산한다.

기본 컬럼:

```text
allocation_ratio
benchmark_aum_allocated
invested_aum_allocated
equity_won_allocated
loan_won_allocated
deposit_won_allocated
allocation_status
include_in_asset_aum
```

계산 규칙:

```text
allocated 금액이 있으면 allocated 금액 사용
allocation_ratio가 있으면 fund AUM * allocation_ratio 사용
둘 다 없고 단일 자산군 펀드면 100% 포함
둘 다 없고 혼합 자산군이면 배분불가
```

### 3.2 약정기준/투입기준

약정기준:

```text
benchmark_aum
equity_won
loan_won
deposit_won
```

투입기준:

```text
invested_aum
invested_equity_won
invested_loan_won
invested_deposit_won
```

### 3.3 중복 방지

같은 `asset_id + fund_id + relation_type`은 한 번만 계산한다.

모자구조나 재간접 관계는 `fund_fund_links`로 별도 표현한다.

```text
investor_fund_id -> target_fund_id
```

이 관계는 포트폴리오/재간접 펀드가 직접 자산 보유 펀드의 투자자인 경우를 표현한다.

## 4. 화면 기능

### 4.1 정보입력 버튼

개발 자산이면서 건축개요가 부족한 경우 자산 상세 화면에 `정보입력` 버튼을 노출한다.

버튼을 누르면 모달을 띄운다.

모달 구성:

```text
자동 조회 영역
  주소, PNU, 좌표, 대지면적, 건축물대장 존재 여부

수동 입력 영역
  사업명, 예정 주용도, 예정 연면적, 예정 준공일, 사업 단계, 비고
```

저장 대상:

```text
asset_master
asset_development_details
asset_manual_input_log
```

### 4.2 자산군 필터

자산군 필터는 `funds.notion_base_asset_class`가 아니라 우선 `asset_master.asset_type`, `asset_master.main_usage`, `asset_master.portfolio_theme`를 기준으로 동작해야 한다.

## 5. 우선 적용 범위

1. 기존 `asset_master` 확장
2. 기존 `asset_fund_links`에 AUM 배분 컬럼 추가
3. `fund_fund_links` 신설
4. 개발 자산 입력용 `asset_development_details`, `asset_manual_input_log` 신설
5. 자산 중심 AUM view 제공
6. 대시보드 계산 로직은 이후 `asset_aum_summary` view를 기준으로 교체
