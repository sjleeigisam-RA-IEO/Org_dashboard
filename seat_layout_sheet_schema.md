# 자리배치 구글시트 확장 스키마

## 목적
- 기존 조직구성 구글시트 파일 안에 자리배치용 탭을 추가한다.
- 좌석 코드는 불변으로 유지한다.
- 시점별 배치를 `버전(version)` 단위로 관리한다.
- 보기 모드는 두 버전을 비교하고, 관리자 모드는 특정 변경안을 수정하거나 새 변경안을 추가한다.

## 운영 원칙
- `seat_master`는 고정 마스터다.
- `seat_versions`는 비교 시점 목록이다.
- `seat_assignments`는 사람-좌석 배치 원장이다.
- `seat_zone_map`은 좌석 위에 덧씌우는 구역/조직 오버레이다.
- 현재 배치와 변경안은 `version_code`로 비교한다.
- 예시:
  - `2506` = 2025년 6월 개편 반영본
  - `2604` = 2026년 4월 개편안
  - 차기 안이 생기면 `2611`, `2701` 같은 코드 추가

---

## 1. seat_master
좌석/공간 마스터. 도면 기준의 고정 테이블.

### 필수 컬럼
| 컬럼명 | 설명 | 예시 |
|---|---|---|
| seat_code | 불변 좌석 코드 | `2F-A45` |
| floor_code | 층 코드 | `2F` |
| seat_label | 도면에 보이는 좌석 번호 | `A45` |
| x | 도면 좌표 x | `14` |
| y | 도면 좌표 y | `8` |
| w | 가로 셀 폭 | `1` |
| h | 세로 셀 높이 | `1` |
| seat_type | `seat`, `room`, `common`, `support`, `office` | `seat` |
| base_label | 공용부/회의실 등 이름 | `` 또는 `2.1 회의실` |
| is_active | 현재 사용 좌석 여부 | `Y` |

### 용도
- 자리코드 기준축
- 도면 렌더링
- 나중에 구역/조직/사람을 오버레이할 때 기준

---

## 2. seat_versions
자리배치 시점 관리 테이블.

### 필수 컬럼
| 컬럼명 | 설명 | 예시 |
|---|---|---|
| version_code | 시점 코드 | `2506` |
| version_name | 사용자 표시 이름 | `2025.06 현재배치` |
| version_type | `current`, `plan`, `archive` | `current` |
| base_version_code | 새 변경안의 기준 버전 | `2506` |
| is_current | 현재 기준 여부 | `Y` |
| is_editable | 관리자 수정 가능 여부 | `N` 또는 `Y` |
| sort_order | 표시 순서 | `1` |
| note | 설명 | `2025년 6월 개편 반영본` |

### 운영 규칙
- 항상 `is_current = Y`는 1개만 유지
- 관리자모드에서:
  - 기존 변경안 수정: `is_editable = Y`인 버전 선택
  - 새 변경안 추가: 새 `version_code` 행 추가
- 새 변경안이 확정되면:
  - 기존 `current`는 `archive`
  - 새 버전은 `current`

---

## 3. seat_assignments
사람-좌석 배치 원장. 자리배치 운영의 핵심 테이블.

### 필수 컬럼
| 컬럼명 | 설명 | 예시 |
|---|---|---|
| version_code | 시점 코드 | `2604` |
| person_name | 이름 | `김민지` |
| seat_code | 배치 좌석 코드 | `12F-A59` |
| division_type | `RA`, `other` | `RA` |
| section_name | 부 단위 | `사업+개발` |
| group_name | 그룹/센터/TF | `사업그룹` |
| part_name | 파트 | `2파트` |
| team_name | 세부조직 | `` |
| role_name | 직책 | `시니어매니저` |
| status | `assigned`, `vacant`, `blocked` | `assigned` |
| note | 비고 | `타부문` |

### 운영 규칙
- 한 사람은 같은 `version_code`에서 1개 좌석만 갖는 것을 기본으로 한다.
- `division_type = other`이면 보기모드에서 회색 처리 가능
- 공석은 `person_name` 비우고 `status = vacant`

---

## 4. seat_zone_map
좌석을 구역/조직별로 묶는 오버레이 테이블.

### 필수 컬럼
| 컬럼명 | 설명 | 예시 |
|---|---|---|
| version_code | 시점 코드 | `2604` |
| zone_id | 구역 ID | `12F-BIZ-01` |
| zone_name | 구역명 | `사업그룹 1파트` |
| zone_level | `section`, `group`, `part`, `custom` | `part` |
| floor_code | 층 코드 | `12F` |
| seat_code | 포함 좌석 | `12F-A59` |
| org_name | 조직 표시명 | `사업그룹 1파트` |
| color_key | 색상 키 | `business-1` |

### 운영 규칙
- 구역은 좌석 묶음으로 정의한다.
- 나중에 구획을 더 세분화할 때는 `seat_master`를 건드리지 않고 이 탭만 바꾼다.

---

## 5. seat_admin_log
관리자 수정 이력용 선택 탭.

### 권장 컬럼
| 컬럼명 | 설명 |
|---|---|
| edited_at | 수정 시각 |
| edited_by | 수정자 |
| action_type | `move`, `create_version`, `zone_update` |
| version_code | 대상 버전 |
| person_name | 대상 인원 |
| from_value | 이전값 |
| to_value | 변경값 |
| note | 비고 |

---

## 관리자 모드 동작 설계

### A. 기존 변경안 수정
- 관리자 로그인
- `seat_versions`에서 `is_editable = Y`인 버전 목록 표시
- 예: `2604`
- 해당 버전을 열고 좌석 이동/공석/구역 수정
- 저장 시 `seat_assignments`, 필요하면 `seat_zone_map` 반영

### B. 새 변경안 추가
- 관리자 로그인
- `새 변경안 추가` 선택
- 기준 버전 선택
  - 예: `2604`
- 새 버전 코드 입력
  - 예: `2611`
- 시스템이 기준 버전의 `seat_assignments`, `seat_zone_map`을 복제
- 이후 새 버전만 편집

### C. 현재 버전 승격
- 변경안이 확정되면
  - 기존 `current`의 `is_current = N`
  - 새 버전의 `is_current = Y`
  - `version_type = current`

---

## 보기 모드 기준
- 상단 헤드에 비교 시점 표시
  - `현재 기준: 2506`
  - `변경안: 2604`
- 이동 계산:
  - 동일 인물의 `seat_assignments`를 버전 간 비교
  - `from seat_code -> to seat_code`
- 층간 이동:
  - `2F-A45 -> 12F-A73`
- 층내 이동:
  - 같은 층에서 좌석만 달라진 경우

---

## MVP 구현 순서
1. `seat_master` 생성
2. `seat_versions` 생성
3. `seat_assignments`에 `2506`, `2604` 적재
4. 보기 모드 연결
5. 관리자모드에서 `2604` 수정
6. 새 변경안 `2611` 추가 흐름 구현
7. `seat_zone_map` 편집 기능 연결
