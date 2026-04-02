# 자리배치 단계별 구현 순서

## 현재 상태
- `seat-layout-data.json`, `seat-layout-data.js` 생성 가능
- 엑셀 기반 좌석/공용부/현재·수정안 기본 파서 존재
- 대시보드에 `자리배치` 탭 기본 골격 추가 중

## Step 1. 시트 구조 확정
완료 기준:
- `seat_layout_sheet_schema.md` 기준으로 탭/컬럼 확정
- 운영 대상 탭:
  - `seat_master`
  - `seat_versions`
  - `seat_assignments`
  - `seat_zone_map`
  - `seat_admin_log`(선택)

## Step 2. 로컬 데이터 계약
완료 기준:
- 로컬 대시보드가 아래 구조를 읽을 수 있음
  - `seat_master`
  - `seat_versions`
  - `seat_assignments`
  - `seat_zone_map`
- 비교 헤드는 `current_version_code`, `plan_version_code`로 구성

## Step 3. 보기 모드 완성
완료 기준:
- 2F/12F/13F 2.5D 레이어
- 공용부 포함 전체 도면
- 좌석코드 표시
- `현재 / 변경안` 토글
- 이동 인원 계산
- 타 부문 회색 처리

## Step 4. 관리자 모드
완료 기준:
- 관리자 비밀번호 입력 시 편집 활성화
- `기존 변경안 수정` / `새 변경안 추가` 선택
- 새 변경안 추가 시 기준 버전 복제
- 저장 시 구글시트 `seat_assignments`, `seat_zone_map` 갱신

## Step 5. 배포 전 검증
완료 기준:
- 로컬에서 보기 모드/관리자 모드 동작 확인
- 비교 시점 전환 확인
- 새 버전 생성 확인
- 이후 GitHub Pages 배포
