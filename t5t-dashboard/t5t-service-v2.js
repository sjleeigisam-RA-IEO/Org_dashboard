/**
 * T5T Data Service - Professional Aggregation Engine (Pagination/Recursive Fetch Added)
 */
const T5TService = {
    RULES: {
        issue_categories: {
            "딜 진행": { strong: ["매각", "매입", "입찰", "우협", "우선협상대상자", "클로징", "closing", "계약", "SPA", "MOU", "LOI", "의향서", "선매수"], context: ["매수인", "매도인", "협상", "매수의향", "매도의향", "계약서", "제안서", "수주"], min: 3 },
            "금융 구조": { strong: ["PF", "리파이낸싱", "refinancing", "대출", "담보대출", "브릿지", "bridge", "선순위", "후순위", "셀다운", "sell-down", "LOC", "약정", "tranche", "트랜치", "LTV", "upfinancing", "재출자"], context: ["대주", "대주단", "우선주", "에쿼티", "equity", "금융주관사", "차환", "만기연장", "중순위", "출자"], min: 3 },
            "인허가/행정": { strong: ["인허가", "건축허가", "변경인허가", "경관심의", "건축심의", "사전협상", "공공기여", "민원", "전력계통영향평가", "설계변경", "허가접수", "착공신고", "교통영향평가", "수전", "전력인입"], context: ["서울시", "구청", "지자체", "캠코", "한전", "위원회", "건축", "설계", "전력", "접수", "신청", "승인", "심의"], min: 4 },
            "전략/기획": { strong: ["전략", "수립", "제안", "준비", "미팅", "작성", "사업계획", "기획", "방안", "대응"], context: ["회의", "논의", "검토"], min: 3 },
            "자산별 실무": { strong: ["물류", "데이터센터", "호텔", "리테일", "부지", "개발사업", "점검", "현장", "설계"], context: ["자산", "실사"], min: 3 },
            "상품/구조화": { strong: ["펀드", "설정", "크레딧", "포트폴리오", "스페셜시츄에이션", "상품기획", "구축"], context: ["운용", "자산운영"], min: 3 },
            "자산운영": { strong: ["임대차", "재계약", "공실", "임차인", "수익자 보고", "운용보고", "보험청구", "CapEx", "마스터리스", "입주"], context: ["임차", "리테일", "운영사", "정산"], min: 3 },
            "리스크·법무": { strong: ["소송", "분쟁", "법무", "EOD", "경매", "담보권", "가압류", "가처분", "법원", "이의제기", "디폴트", "채무불이행"], context: ["법무법인", "판결", "소장", "청구", "리스크", "유예"], min: 3 },
            "투자자 대응": { strong: ["IR", "RFP", "PT", "사이트투어", "탭핑", "태핑", "tapping", "투자자 마케팅", "GP Session", "IM자료", "roadshow", "LOC"], context: ["GIC", "CPPIB", "NPS", "국민연금", "교직원공제회", "우정사업본부", "수익자", "잠재투자자"], min: 3 },
            "신규소싱": { strong: ["신규검토", "underwriting", "valuation", "파이프라인", "소싱", "잠재 딜", "개발 가능성"], context: ["입찰 참여", "의향서 제출", "LOI", "후속 검토", "잠재"], min: 3 }
        },
        stakeholder_aliases: {
            "NPS": "국민연금"
        },
        stakeholder_types: {
            "기관투자자(LP)": { 
                sub_categories: {
                    "국내 연기금/공제회": ["NPS", "국민연금", "공제회", "교직원공제회", "군인공제회", "새마을금고", "우정사업본부", "사학연금", "연기금"],
                    "해외 국부/연금": ["GIC", "CPPIB", "ADIA", "Temasek", "국부펀드", "해외연금"],
                    "일반법인/기타": ["법인", "수익자", "잠재투자자", "일반법인"]
                }
            },
            "금융기관(대주)": { 
                sub_categories: {
                    "은행": ["신한은행", "하나은행", "KB국민", "우리은행", "농협", "IBK기업", "산업은행", "수협", "은행"],
                    "증권사": ["미래에셋", "메리츠증권", "삼성증권", "NH투자", "한국투자", "KB증권", "대신증권", "증권"],
                    "캐피탈": ["현대캐피탈", "신한캐피탈", "하나캐피탈", "KB캐피탈", "IBK캐피탈", "캐피탈"],
                    "보험사": ["삼성생명", "한화생명", "교보생명", "삼성화재", "DB손보", "보험", "생명", "화재"]
                }
            },
            "주간사/자문": { 
                sub_categories: {
                    "법무법인": ["법무법인", "태평양", "광장", "김앤장", "바른", "세종", "율촌", "지평"],
                    "회계법인": ["회계법인", "삼일", "삼정", "안진", "한영"],
                    "부동산 자문사": ["JLL", "CBRE", "세빌스", "쿠시먼", "에비슨영", "Rsquare", "알스퀘어", "자문사", "주간사"],
                    "감평/엔지니어링": ["감정평가", "설계", "엔지니어링", "정밀실사", "PM"]
                }
            },
            "공공/행정기관": { 
                sub_categories: {
                    "지자체": ["서울시", "경기도", "구청", "인허가청", "용산구청", "지자체"],
                    "중앙부처/정부": ["국토부", "기재부", "금융위", "정부", "부처"],
                    "공공기관/한전": ["캠코", "한전", "토지주택공사", "LH", "SH", "공공기관", "위원회"]
                }
            },
            "매수/매도인": { 
                sub_categories: {
                    "시행/개발사": ["시행사", "개발사", "디벨로퍼", "건설사"],
                    "운용/매수자": ["운용사", "선매수자", "우협대상자", "매수인", "매도인"]
                }
            },
            "임차인": { terms: ["operator", "tenant", "LG전자", "CJ", "라인플러스", "홈플러스", "아디다스", "무신사", "위워크", "스타벅스"] }
        }
    },

    rawItems: [],
    financialMap: {}, // stakeholder_name -> { exposure: 0, count: 0 }

    async fetchDashboardData() {
        console.log("Starting full data fetch with financial exposures...");
        
        // 금융 데이터 및 작성자 실명 로드
        const [lenders, beneficiaries, staff] = await Promise.all([
            supabaseClient.from('lender_exposures').select('lender_clean, committed_amt, fund_id, funds(fund_name)'),
            supabaseClient.from('beneficiary_exposures').select('beneficiary_clean, committed_amt, fund_id, funds(fund_name)'),
            supabaseClient.from('staff').select('staff_id, name')
        ]);

        const staffMap = {};
        (staff.data || []).forEach(s => {
            if (s.staff_id) staffMap[s.staff_id] = s.name;
        });

        const normalize = (n) => n.replace(/\s+/g, "").replace("(주)", "").replace("주식회사", "").replace("한국", "").replace("공단", "").replace("공제회", "").replace("사업본부", "");
        const finMap = {};
        const processFin = (data, nameKey) => {
            (data || []).forEach(row => {
                const rawName = row[nameKey];
                if (!rawName) return;
                
                const normName = normalize(rawName);
                if (!finMap[normName]) finMap[normName] = { exposure: 0, funds: new Set(), details: [] };
                finMap[normName].exposure += (row.committed_amt || 0);
                finMap[normName].funds.add(row.fund_id);
                
                const fName = row.funds?.fund_name || row.fund_id || "미상";
                const existing = finMap[normName].details.find(d => d.fund_name === fName);
                if (existing) {
                    existing.amt += (row.committed_amt || 0);
                } else {
                    finMap[normName].details.push({ fund_name: fName, amt: row.committed_amt || 0 });
                }
                
                // 원본 명칭으로도 접근 가능하게 참조 연결
                if (!finMap[rawName]) finMap[rawName] = finMap[normName];
            });
        };
        processFin(lenders.data, 'lender_clean');
        processFin(beneficiaries.data, 'beneficiary_clean');
        this.financialMap = finMap;

        // 추가: 사후 매칭을 위한 도우미 함수 (detectStakeholders 이후 사용됨)
        this.getFinancialInfo = (name) => {
            const norm = normalize(name);
            return this.financialMap[norm] || this.financialMap[name] || { exposure: 0, funds: new Set() };
        };

        let allData = [];
        let from = 0;
// ... (existing pagination logic)
        let to = 999;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabaseClient
                .from('t5t_form_items')
                .select(`*, projects(project_name), funds(fund_name)`)
                .order('work_date', { ascending: false })
                .range(from, to);

            if (error) throw error;
            if (!data || data.length === 0) {
                hasMore = false;
            } else {
                // 작성자 실명 매핑
                data.forEach(item => {
                    item.writer_name = staffMap[item.writer_staff_id] || "익명";
                });
                allData = allData.concat(data);
                if (data.length < 1000) {
                    hasMore = false;
                } else {
                    from += 1000;
                    to += 1000;
                    console.log(`Fetched ${allData.length} items so far...`);
                }
            }
        }

        console.log(`Total ${allData.length} items loaded.`);
        this.rawItems = allData;
        return this.aggregateData(allData);
    },

    aggregateData(items, filterYear = null) {
        const dashData = {
            sync_meta: { synced_at: new Date().toISOString() },
            intelligence: { periods: { all: this.initPeriod("전체"), month: this.initPeriod("이번달"), week: this.initPeriod("이번주") } },
            trend: { weeks: [], task_types: [], series: {} },
            pulse: [],
            sorted_weeks: []
        };

        const now = new Date();
        const oneMonthAgo = new Date(); oneMonthAgo.setMonth(now.getMonth() - 1);
        const oneWeekAgo = new Date(); oneWeekAgo.setDate(now.getDate() - 7);
        const projectMap = new Map();
        const weekMap = new Map();
        const taskTypes = new Set();

        items.forEach(item => {
            const workDate = new Date(item.work_date);
            if (filterYear && workDate.getFullYear() !== parseInt(filterYear)) return;

            const weekKey = this.getWeekKey(workDate);
            const taskType = item.task_type || "기타";
            taskTypes.add(taskType);

            const activePeriods = [dashData.intelligence.periods.all];
            if (workDate >= oneMonthAgo) activePeriods.push(dashData.intelligence.periods.month);
            if (workDate >= oneWeekAgo) activePeriods.push(dashData.intelligence.periods.week);

            activePeriods.forEach(p => {
                p.total_logs += 1;
                const category = this.detectCategory(item);
                let catObj = p.issue_categories.find(c => c.name === category);
                if (!catObj) { catObj = { name: category, count: 0 }; p.issue_categories.push(catObj); }
                catObj.count += 1;

                this.detectStakeholders(item).forEach(sh => {
                    let shObj = p.top_stakeholders.find(s => s.name === sh.name);
                    if (shObj) {
                        shObj.count += 1;
                    } else {
                        const fin = this.getFinancialInfo(sh.name);
                        p.top_stakeholders.push({ 
                            name: sh.name, 
                            type: sh.type, 
                            sub: sh.sub, 
                            count: 1,
                            exposure: fin.exposure,
                            fund_count: fin.funds.size
                        });
                    }
                });

                // 키워드용 불용어 (단순 행정/서술용 노이즈만 제거)
                const stopWords = [
                    "협의", "검토", "관리", "보고", "운용", "논의", "확인", "진행", "예정", "사항", "관련", 
                    "내용", "업무", "회의", "미팅", "작성", "수립", "대응", "준비", "추진", "지원", "협업",
                    "전달", "공유", "요청", "피드백", "정리", "체크", "점검", "기타", "내부", "외부", "현황",
                    "전일", "금일", "명일", "금주", "차주", "전주"
                ];
                (item.classification_tokens || []).forEach(tk => {
                    if (stopWords.includes(tk) || tk.length < 2) return; // 불용어 및 1글자 단어 제외
                    let kwObj = p.top_keywords.find(k => k.keyword === tk);
                    if (kwObj) kwObj.count += 1;
                    else p.top_keywords.push({ keyword: tk, count: 1, category: category });
                });
            });

            if (!weekMap.has(weekKey)) weekMap.set(weekKey, { counts: {} });
            weekMap.get(weekKey).counts[taskType] = (weekMap.get(weekKey).counts[taskType] || 0) + 1;

            // 프로젝트명 정제
            const projName = item.project_text || item.projects?.project_name || item.funds?.fund_name || "미분류";
            const ignoreProjects = ["-", "미분류", "기타", "대기", "없음"];
            
            if (!ignoreProjects.includes(projName)) {
                if (!projectMap.has(projName)) {
                    const parentInfo = item.funds?.fund_name || item.projects?.project_name || "";
                    projectMap.set(projName, { 
                        id: projName, 
                        name: projName, 
                        parent: parentInfo,
                        total_mentions: 0, 
                        weekly: {}, 
                        logs: [], 
                        keywords: new Map() 
                    });
                }
                const proj = projectMap.get(projName);
                proj.total_mentions += 1;
                proj.weekly[weekKey] = (proj.weekly[weekKey] || 0) + 1;
                
                const rawText = item.project_text || "";
                if (rawText && rawText !== projName && !stopWords.includes(rawText)) {
                    proj.keywords.set(rawText, (proj.keywords.get(rawText) || 0) + 1);
                }

                proj.logs.push({ 
                    writer: item.writer_name || "익명", 
                    task_type: taskType, 
                    week: weekKey, 
                    summary: item.classification_summary || item.raw_text.substring(0, 50), 
                    work_date: item.work_date,
                    raw_text: item.raw_text || ""
                });
            }
        });

        dashData.pulse = Array.from(projectMap.values())
            .filter(proj => proj.name !== "-" && proj.name !== "미분류") // 의미 없는 항목 제외
            .map(proj => {
                const topKeywords = Array.from(proj.keywords.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(k => k[0]);
                return { ...proj, top_keywords: topKeywords };
            })
            .sort((a, b) => b.total_mentions - a.total_mentions);

        Object.values(dashData.intelligence.periods).forEach(p => {
            p.issue_categories.sort((a, b) => {
                if (a.name === "기타") return 1;
                if (b.name === "기타") return -1;
                return b.count - a.count;
            });
            p.top_keywords.sort((a, b) => b.count - a.count);
            p.top_stakeholders.sort((a, b) => b.count - a.count);
        });

        dashData.sorted_weeks = Array.from(weekMap.keys()).sort();
        dashData.trend.weeks = dashData.sorted_weeks;
        dashData.trend.task_types = Array.from(taskTypes);
        dashData.trend.task_types.forEach(tt => { dashData.trend.series[tt] = dashData.trend.weeks.map(w => weekMap.get(w).counts[tt] || 0); });
        
        return dashData;
    },

    detectCategory(item) {
        const text = (item.classification_summary || "") + (item.raw_text || "");
        let bestCategory = "기타";
        let maxScore = 0;
        for (const [name, rules] of Object.entries(this.RULES.issue_categories)) {
            let score = 0;
            rules.strong.forEach(s => { if (text.includes(s)) score += 3; });
            rules.context.forEach(c => { if (text.includes(c)) score += 1; });
            if (score >= rules.min && score > maxScore) { maxScore = score; bestCategory = name; }
        }
        return bestCategory;
    },

    detectStakeholders(item) {
        const text = (item.classification_summary || "") + (item.raw_text || "");
        const found = new Map();
        const aliases = this.RULES.stakeholder_aliases || {};
        for (const [type, rules] of Object.entries(this.RULES.stakeholder_types)) {
            if (rules.terms) {
                rules.terms.forEach(term => { 
                    if (text.includes(term)) found.set(aliases[term] || term, { type, sub: null }); 
                });
            } else if (rules.sub_categories) {
                for (const [sub, terms] of Object.entries(rules.sub_categories)) {
                    terms.forEach(term => { 
                        if (text.includes(term)) found.set(aliases[term] || term, { type, sub }); 
                    });
                }
            }
        }
        // 지능형 필터링: 역할명, 업권명, 특정되지 않는 대명사 전수 배제
        const genericTerms = [
            "은행", "증권", "보험", "캐피탈", "법무법인", "회계법인", "연기금", "공제회", 
            "지자체", "정부", "부처", "공공기관", "시행사", "개발사", "운용사", "자문사", "주간사",
            "수익자", "법인", "잠재투자자", "투자자", "operator", "tenant", "대주", "화재", "생명",
            "매도인", "매수인", "선매수자", "우협대상자", "디벨로퍼", "건설사", "시행업자", "업체",
            "설계", "PM", "감정평가", "감평", "엔지니어링", "자문", "주간", "신탁", "신탁사",
            "AMC", "LP", "GP", "SI", "FI", "CI", "HI", "관리인", "임차인", "임대인",
            "구청", "시청", "도청", "인허가청", "정부기관", "관공서", "지자체기관",
            "위원회", "본부", "공단", "센터", "재단", "협회", "조합", "학회", "사무소", "연구소"
        ];
        
        return Array.from(found.entries())
            .map(([name, info]) => ({ name, type: info.type, sub: info.sub }))
            .filter(s => {
                const isGeneric = genericTerms.includes(s.name);
                const isCategoryMatch = (s.name === s.type || s.name === s.sub);
                const isTooShort = s.name.length < 2;
                return !isGeneric && !isCategoryMatch && !isTooShort;
            });
    },

    buildStakeholderChartData(period, drilldownType = null, drilldownSub = null) {
        // 1단계: 전체 유형별 분포 (Doughnut)
        if (!drilldownType) {
            const typeCounts = {};
            period.top_stakeholders.forEach(s => { typeCounts[s.type] = (typeCounts[s.type] || 0) + s.count; });
            return { title: period.label, subtitle: "유형별 분포", items: Object.entries(typeCounts).map(([name, count]) => ({ name, count })), mode: "types" };
        }
        
        // 2단계: 특정 유형 내부의 업권(Sub) 분포 (하위 카테고리가 있는 경우)
        const rules = this.RULES.stakeholder_types[drilldownType];
        if (rules && rules.sub_categories && !drilldownSub) {
            const subCounts = {};
            const filterBySub = period.top_stakeholders.filter(s => s.type === drilldownType);
            
            filterBySub.forEach(s => {
                const subName = s.sub || "기타";
                subCounts[subName] = (subCounts[subName] || 0) + s.count;
            });

            // 업권별 비중이 있는 경우에만 subs 모드로 반환
            if (Object.keys(subCounts).length > 0) {
                return { 
                    title: drilldownType, 
                    subtitle: "세부 분류별 분포", 
                    items: Object.entries(subCounts).map(([name, count]) => ({ name, count })), 
                    mode: "subs" 
                };
            }
        }

        // 3단계: 최종 개별 사명 리스트
        const targetItems = period.top_stakeholders.filter(s => {
            if (s.type !== drilldownType) return false;
            if (drilldownSub && s.sub !== drilldownSub) return false;
            return true;
        });
        
        return { 
            title: drilldownSub || drilldownType, 
            subtitle: "주요 상대방", 
            items: targetItems.map(s => ({ name: s.name, count: s.count })), 
            mode: "names" 
        };
    },

    initPeriod(label) { return { label, total_logs: 0, issue_categories: [], top_keywords: [], top_stakeholders: [] }; },
    getWeekKey(date) { 
        const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        return `${d.getFullYear()}-W${String(Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, '0')}`;
    }
};
