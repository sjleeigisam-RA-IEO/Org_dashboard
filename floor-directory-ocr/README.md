# 층별현황판 OCR 웹앱

건물 1층에 붙어 있는 층별현황판 사진을 업로드하거나 촬영한 뒤, OCR 결과를 층별 입주사 표로 정리하는 정적 웹앱입니다.

## 실행

PowerShell에서 다음 명령으로 로컬 서버를 실행합니다.

```powershell
cd "C:\grus.py\org\floor-directory-ocr"
py -m http.server 5178 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:5178`을 엽니다.

## 현재 기능

- 모바일 카메라 촬영 입력
- 저장된 사진 불러오기 입력
- 이미지 고대비 전처리
- Google Cloud Vision `DOCUMENT_TEXT_DETECTION` 기반 OCR
- 층/회사명 자동 파싱 및 결과 표 표시
- 촬영 전 건물명 직접 입력 및 저장 태그 처리
- 공용 Google Apps Script Web App URL을 통한 구글시트 행 추가 저장

## 구글시트 연결

1. 저장할 Google Sheet를 엽니다.
2. `확장 프로그램` > `Apps Script`를 엽니다.
3. `google-apps-script.gs` 내용을 붙여넣습니다.
4. Google Cloud 프로젝트에서 Cloud Vision API를 사용 설정하고 API 키를 발급합니다.
5. Apps Script의 `프로젝트 설정` > `스크립트 속성`에 OCR 키와 월별 제한값을 저장합니다.
   - `GOOGLE_VISION_API_KEY_1`: 1번 Google Vision API 키
   - `GOOGLE_VISION_API_KEY_2`: 2번 Google Vision API 키
   - `OCR_MONTHLY_LIMIT_PER_KEY`: 키별 월 사용 제한값. 기본 권장값은 `990`입니다.
6. `배포` > `새 배포` > `웹 앱`을 선택합니다.
7. 실행 계정은 본인, 접근 권한은 사용할 범위에 맞게 설정합니다.
8. 배포된 Web App URL을 `app.js`의 `googleSheetWebAppUrl` 값으로 설정합니다.

저장 방식은 한 촬영 건을 `floor_directory_log` 시트 탭의 한 행에 추가하는 방식입니다. 컬럼은 `captured_at`, `building_name`, `source_name`, `raw_text`, `parsed_json`, `B5`~`B1`, `1F`~`100F` 순서입니다. 한 층에 여러 입주사가 있으면 콤마로 연결됩니다.

## 제약

- OCR 요청은 Apps Script가 Google Vision API로 중계합니다. API 키를 웹앱 코드에 직접 넣지 마십시오.
- Apps Script Web App URL에 접속하면 `ocrQuota` 응답에서 키별 설정 여부와 현재 월 사용량을 확인할 수 있습니다. 실제 API 키 값은 응답에 포함되지 않습니다.
- Google Vision API 사용량에 따라 Google Cloud 과금이 발생할 수 있습니다.
- Apps Script 저장 요청은 브라우저 CORS 제한 때문에 화면에서 응답 본문을 확인하지 않습니다. 실제 저장 여부는 구글시트에서 확인하십시오.
- 촬영 각도, 반사, 조명, 현황판 글꼴에 따라 인식률이 크게 달라질 수 있습니다.
- 1차 파서는 `10F 회사명`, `10층 회사명`, `B1 주차장` 같은 일반적인 표기부터 안정적으로 처리합니다.
