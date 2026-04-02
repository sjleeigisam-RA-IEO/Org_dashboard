# 구글시트 연결 로컬 테스트 방법

## 목적

기존 GitHub Pages는 그대로 두고, 로컬에서만 구글시트 연동 버전을 먼저 확인합니다.

## 준비 파일

- `sheet-linked.html`
- `sheet-linked.config.js`
- `sheet-loader.js`
- `google_sheet_sync.gs`
- `google_sheet_api.gs`

## 1. 구글시트 Apps Script에 붙일 코드

Apps Script에는 아래 두 파일 내용을 같이 넣습니다.

- `google_sheet_sync.gs`
- `google_sheet_api.gs`

기존 `Code.gs`를 비우고 두 파일 내용을 각각 새 스크립트 파일로 추가하는 방식이 가장 안전합니다.

## 2. 접근 키 설정

`google_sheet_api.gs` 상단의 아래 값을 랜덤 문자열로 바꿉니다.

```javascript
const WEBAPP_ACCESS_KEY = "change-this-to-a-random-secret";
```

## 3. 웹 앱 배포

1. Apps Script에서 `배포 > 새 배포`
2. 유형: `웹 앱`
3. 실행 사용자: `나`
4. 접근 권한: `링크를 아는 모든 사용자`
5. 배포 후 웹 앱 URL 복사

## 4. 로컬 설정

`sheet-linked.config.js`에 아래 두 값을 입력합니다.

- `webAppUrl`
- `accessKey`

예:

```javascript
window.ORG_DASHBOARD_REMOTE = {
  webAppUrl: "https://script.google.com/macros/s/xxxx/exec",
  accessKey: "your-random-secret",
  timeoutMs: 15000,
};
```

## 5. 로컬 실행

```powershell
cd "D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard"
python -m http.server 8787
```

브라우저에서 아래 주소 접속:

- `http://localhost:8787/sheet-linked.html`

## 6. 확인 포인트

- `assignments` 수정 후 `people`, `organizations`, `sections` 자동 반영
- 새로고침 시 로컬 테스트 페이지에 반영
- 조직 신설/이동/직책 수정 반영 여부 확인

## 이후

로컬에서 충분히 확인되면, 같은 연결 방식을 기존 `index.html`에 반영하고 GitHub Pages로 배포하면 됩니다.
