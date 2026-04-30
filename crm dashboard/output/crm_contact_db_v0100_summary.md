# CRM Contact DB v0100

## 구성

- contact db rows: 837건
- unique groups: 796건
- grouped entities: 48건
- group rules version: `v0100`

## 기준

- 1차 CRM 적재와 집계는 그룹명 기준으로 수행합니다.
- 세부 법인명은 `canonical_name`으로 유지하고, 그룹 집계는 `group_name`으로 수행합니다.
- 그룹 규칙이 없는 엔티티는 우선 자기 이름을 그룹명으로 유지합니다.

## 상위 그룹

- 공제회: entity 12건 / role 14건 / 대표유형 펀드 수익자
- KB: entity 8건 / role 12건 / 대표유형 금융기관(대주)
- 신한: entity 7건 / role 12건 / 대표유형 금융기관(대주)
- 하나: entity 7건 / role 9건 / 대표유형 펀드 수익자
- 메리츠: entity 5건 / role 7건 / 대표유형 금융기관(대주)
- 미래에셋: entity 5건 / role 6건 / 대표유형 금융기관(대주)
- 검토대상: entity 4건 / role 4건 / 대표유형 매수/매도인
- 116-2(산재기금): entity 1건 / role 1건 / 대표유형 펀드 수익자
- 116-3(신협중앙회): entity 1건 / role 1건 / 대표유형 펀드 수익자
- 116-3(주택도시기금): entity 1건 / role 1건 / 대표유형 펀드 수익자
