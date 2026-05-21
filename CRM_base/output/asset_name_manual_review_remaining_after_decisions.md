# 자산명 수동 판단 반영 후 잔여 대상

- 반영된 사용자 판단: 17개 asset_id
- 잔여 확인 대상: 0개 asset_id

## 반영된 판단

| asset_id | 기존명 | 최종 자산명 | 성격 | 메모 |
|---|---|---|---|---|
| `ast_30efc1e2c218` | 이지스경산물류제1호일반사모부동산투자회사의 1종 종류주식 | 경산 쿠팡물류센터 | underlying_asset | 종류주는 보유 형태이고 기초자산은 경산 쿠팡물류센터 |
| `ast_b0956b6f4029` | 이지스산업단지환경개선일반사모부동산투자신탁제1호 | 부산송정물류센터 | underlying_asset | 542호 제1종은 기존 542호 자산 승계로 판단 |
| `ast_808ae65372f4` | 오시리아타워레지던스 | 오시리아타워레지던스 | underlying_asset | 명칭 자체가 자산 |
| `ast_34e35d0dff33` | 이지스부동산일반사모투자회사제543호 | 분당야탑물류센터 | underlying_asset | 기존 후보 채택 |
| `ast_4a2972f3fd4f` | 주식회사 석암물류(SPC) | 양산 유산동 물류센터 | underlying_asset | 기존 후보 채택 |
| `ast_616c3d79da75` | 이지스경산로지스제1호일반사모부동산투자회사(운용) | 경산 쿠팡물류센터 | underlying_asset | 기존 후보 채택 |
| `ast_428853fb1dec` | 글로벌 리츠 | Global REITs(삼성OCIO) | security_or_portfolio_asset | 글로벌 리츠는 괄호 구분 후보명 채택 |
| `ast_f5220c768a13` | 글로벌 리츠 | Global REITs (수협) | security_or_portfolio_asset | 글로벌 리츠는 괄호 구분 후보명 채택 |
| `ast_9bf678a7d2ae` | 글로벌 리츠 | Global REITs(리츠섹터SMA1호) | security_or_portfolio_asset | 글로벌 리츠는 괄호 구분 후보명 채택 |
| `ast_fbe13b6b1e0a` | 글로벌 리츠 | Global REITs(셀렉리츠1호) | security_or_portfolio_asset | 글로벌 리츠는 괄호 구분 후보명 채택 |
| `ast_b4ff0851baae` | 이지스국내PF재구조화일반사모부동산모투자신탁제1-3호 | 이지스용산PF재구조화일반사모1호(2종) | vehicle_or_restructured_pf_asset | 잔여 후보도 우선 채택 |
| `ast_0555a6694264` | 이지스제572호부동산일반사모투자회사(1종) | 이지스제572호부동산일반사모투자회사(1종) | vehicle_or_share_class_asset | 잔여 후보도 우선 채택 |
| `ast_4ae20e9370ca` | 이지스아디안유럽인프라일반사모혼합자산투자신탁제494호(재간접) | ARDIAN Infrastructure Fund VI | fund_interest_or_indirect_asset | 잔여 후보도 우선 채택 |
| `ast_4d1430b5f175` | 공모주 | 전환사채 <br> 공모주 <br> 비상장RCPS <br> 상장리츠 <br> AA+ 회사채 | security_or_portfolio_asset_list | 잔여 후보도 우선 채택. UI에서는 목록형/포트폴리오형으로 표시 |
| `ast_4ffe4ac306f2` | 이지스 멀티인컴 일반사모투자신탁 제1호(운용) | 상장리츠 <br> 공모주 <br> AA+ 회사채 | security_or_portfolio_asset_list | 잔여 후보도 우선 채택. UI에서는 목록형/포트폴리오형으로 표시 |
| `ast_02f2fb35a743` | 이지스글로벌세컨더리일반사모혼합자산투자신탁제1호 | Pantheon Viking Co-Invest LP <br> NMP V <br> PGSF VII <br> PSD III | fund_interest_or_indirect_asset_list | 잔여 후보도 우선 채택. UI에서는 재간접 하위 보유목록으로 표시 |
| `ast_dc11f9b4f515` | 이지스글로벌세컨더리일반사모혼합자산투자신탁제1호 | Pantheon Viking Co-Invest LP <br> NMP V <br> PGSF VII <br> PSD III | fund_interest_or_indirect_asset_list | 잔여 후보도 우선 채택. UI에서는 재간접 하위 보유목록으로 표시 |

## 잔여 요약

| review_bucket | 건수 |
|---|---:|

## 잔여 상세

| bucket | asset_id | 현재 자산명 | 채택 후보 | 후보 수 | 위치/PNU/좌표 | 확인 이유 |
|---|---|---|---|---:|---|---|