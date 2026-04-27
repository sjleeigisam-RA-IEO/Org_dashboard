# Dashboard DB Number Loading Issue Report

작성 기준: 2026-04-27

## 1. 증상

대시보드 글로벌 화면에서 운용 펀드 수는 표시되지만 다음 금액 지표가 `0억`으로 표시되었다.

- 전체 AUM
- 에쿼티
- 대출
- 기타

## 2. 확인 결과

Supabase `funds` 응답에는 `metadata.benchmark_aum`, `metadata.committed_equity`, `metadata.committed_debt`, `metadata.lease_deposit` 값이 존재한다.

다만 현재 live DB의 `funds.metadata` 금액은 원 단위가 아니라 **억원 단위**로 저장되어 있다.

예시 구조:

```text
metadata.benchmark_aum = 2223.82
metadata.committed_equity = 463.82
metadata.committed_debt = 1760.0
metadata.lease_deposit = 0.0
```

반면 `dashboard/app.js`의 `formatNumber()`는 입력값을 원 단위로 가정하고 `100,000,000`으로 나눈다.  
따라서 `754,746억`으로 해석해야 할 값을 `754,746원`으로 처리하면서 화면에 `0억`이 표시되었다.

이후 단위 보정 후에는 live DB의 청산 제외 합계가 약 `75.47조`로 표시되었다.  
하지만 이 값도 내부 현황판 기준으로는 과대 집계다.

원인은 live DB `funds`에 최신 AUM 파일에는 없는 과거/잔존 운용 row가 남아 있기 때문이다.

| 기준 | 운용 펀드 수 | AUM |
|---|---:|---:|
| live DB `funds` 청산 제외 | 580 | 75.475조 |
| `_archive/펀드 AUM 관리_20260427.xlsx` 청산 제외 | 495 | 55.988조 |
| `_archive/펀드 관리_20260424.xlsx` lifecycle 제외 기준 | 490 | 54.915조 |

live DB에는 최신 `펀드 AUM 관리_20260427.xlsx`에 없는 운용 row 86개가 있으며, 이들의 AUM 합계가 약 `19.487조`다. 이 금액이 최신 AUM 기준과 live DB 기준의 핵심 차이다.

## 3. 추가 구조 이슈

섹터/지역 도넛도 `metadata.sector`, `metadata.region`을 우선 사용하고 있었다.  
하지만 실제 DB에서는 대부분의 분류가 `funds.sector`, `funds.location` 컬럼에 있으며, `metadata.sector`, `metadata.region`은 일부 row에만 존재한다.

결과적으로 화면에서는 섹터가 `기타`, 지역이 `국내`에 과도하게 몰리는 현상이 발생했다.

## 4. 적용한 수정

수정 파일: `dashboard/app.js`

1. `metadataAmountToWon()` 추가
   - metadata 금액이 억원 단위로 보이면 원 단위로 환산한다.
   - 이미 원 단위로 들어온 값은 그대로 사용한다.

2. `renderAnalytics()`의 글로벌 DB 조회 컬럼 확장
   - 기존: `metadata`
   - 변경: `fund_id, status, sector, location, metadata`

3. active fund 판정 보강
   - `funds.status` 우선
   - 없으면 `metadata.status` fallback

4. 섹터/지역 분류 보강
   - 섹터: `funds.sector` 우선, 없으면 `metadata.sector`
   - 지역: `funds.location` 우선, 없으면 `metadata.region`

5. 시계열 차트 집계 오류 수정
   - 기존 `find()`는 같은 연도/분류의 첫 행만 사용했다.
   - `filter()` + `reduce()`로 같은 연도/분류 전체 행을 합산하도록 변경했다.

6. 글로벌 대시보드 집계 원천 변경
   - 기존: live DB `funds` 전체에서 청산 제외 합산
   - 변경: `dashboard/data/current_aum_snapshot.json` 우선 사용
   - 원천: `_archive/펀드 AUM 관리_20260427.xlsx`
   - 목적: live DB에 남아 있는 과거/잔존 row가 현재 AUM에 섞이지 않도록 차단

## 5. 남은 리스크

- `metadata`는 현재 메인 적재 파이프라인에서 항상 채워지는 구조가 아니다.
- 장기적으로는 AUM/Equity/Debt를 `metadata`가 아니라 명시적 snapshot 테이블에서 읽는 구조가 맞다.
- 청산 제외 기준을 `funds.status`로 볼지 `metadata.status`로 볼지에 따라 합계가 달라질 수 있으므로, canonical status 기준을 `funds.status` 또는 lifecycle table로 고정해야 한다.
- 현재 `current_aum_snapshot.json`은 응급 조치다. 운영 구조에서는 Supabase에 `fund_aum_snapshots` 테이블을 만들고, 대시보드가 최신 active snapshot만 조회해야 한다.
