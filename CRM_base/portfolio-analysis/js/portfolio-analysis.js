function normalizeAnalysisFilterValue(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).replace(/\u00a0/g, ' ').trim();
    const invalid = new Set(['', '-', 'null', 'undefined', 'n/a', 'none', 'nan']);
    return invalid.has(text.toLowerCase()) ? null : text;
}

const BASE_ASSET_FILTER_OPTIONS = [
    { label: '오피스', terms: ['오피스'] },
    { label: '물류센터', terms: ['물류'] },
    { label: '리테일', terms: ['리테일', '상업시설'] },
    { label: '호텔', terms: ['호텔'] },
    { label: '주거', terms: ['주거', '공동주택', '오피스텔'] },
    { label: '데이터센터', terms: ['데이터센터', 'IDC'] },
    { label: '금융상품', terms: ['금융상품', '예금', '증권'] },
    { label: '기업주식', terms: ['기업주식', 'Equity'] },
    { label: '특별자산', terms: ['특별자산', 'Special'] },
    { label: 'NPL', terms: ['NPL'] }
];

function getAnalysisFilterTokens(key, value) {
    const text = normalizeAnalysisFilterValue(value);
    if (!text) return [];

    if (key === 'base_asset_class') {
        const matched = BASE_ASSET_FILTER_OPTIONS
            .filter(option => option.terms.some(term => text.toLowerCase().includes(term.toLowerCase())))
            .map(option => option.label);
        if (matched.length > 0) return matched;
    }

    return text
        .split(/[,，、;|/]+/)
        .map(normalizeAnalysisFilterValue)
        .filter(Boolean);
}

function doesAnalysisValueMatch(key, rawValue, selectedValue) {
    const selected = normalizeAnalysisFilterValue(selectedValue);
    const raw = normalizeAnalysisFilterValue(rawValue);
    if (!selected || !raw) return false;
    const tokens = getAnalysisFilterTokens(key, raw);
    return tokens.includes(selected) || raw.toLowerCase().includes(selected.toLowerCase());
}

function initAnalysisFilters() {
    const filterSections = [
        {
            title: '포트폴리오 필터',
            cols: [
                { key: 'domestic_overseas', label: '국내/해외' },
                { key: 'division', label: '부문' },
                { key: 'vehicle_type', label: 'Vehicle 구분' },
                { key: 'base_asset_class', label: '기초자산' },
                { key: 'legal_form', label: '법적형태' },
                { key: 'fund_class', label: '펀드분류' },
                { key: 'investment_strategy', label: '투자전략' },
                { key: 'fund_type', label: '펀드유형' },
                { key: 'asset_nature_class', label: '자산성격' },
                { key: 'business_stage_class', label: '사업단계' }
            ]
        }
    ];

    const grid = document.getElementById('filterGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const activeFilterKeys = new Set(filterSections.flatMap(section => section.cols.map(col => col.key)));
    Object.keys(analysisFilters).forEach(key => {
        if (!activeFilterKeys.has(key)) {
            delete analysisFilters[key];
            return;
        }
        analysisFilters[key] = (analysisFilters[key] || [])
            .map(normalizeAnalysisFilterValue)
            .filter(Boolean);
        if (analysisFilters[key].length === 0) delete analysisFilters[key];
    });

    filterSections.forEach(section => {
        const group = document.createElement('div');
        group.className = 'filter-group active'; // Default open
        
        const header = document.createElement('div');
        header.className = 'filter-group-header';
        header.innerHTML = `<span>${section.title}</span><span class="filter-count-badge">0</span>`;
        header.onclick = () => group.classList.toggle('active');
        group.appendChild(header);

        // Global Basket for this group (placed below title)
        const basket = document.createElement('div');
        basket.id = 'activeFilterBasket';
        basket.className = 'basket-container';
        basket.style.cssText = 'display:none; margin: 12px 16px; border-style:dashed; background: #f8fafc;';
        basket.innerHTML = `
            <div class="basket-header" style="margin-bottom:8px;">
                <span style="font-size:11px;">적용된 필터</span>
            </div>
            <div id="activeFilterChips" class="basket-items"></div>
        `;
        group.appendChild(basket);
        
        const content = document.createElement('div');
        content.className = 'filter-group-content';
        
        section.cols.forEach(col => {
            const filterItem = document.createElement('div');
            filterItem.className = 'filter-item';

            const label = document.createElement('label');
            label.innerText = col.label;
            filterItem.appendChild(label);

            const container = document.createElement('div');
            container.className = 'multi-select-container';
            
            const trigger = document.createElement('div');
            trigger.className = 'multi-select-trigger';
            updateTriggerText(trigger, col.key);
            
            const dropdown = document.createElement('div');
            dropdown.className = 'multi-select-dropdown';
            
            // Search Input
            const searchDiv = document.createElement('div');
            searchDiv.className = 'multi-select-search';
            const searchInput = document.createElement('input');
            searchInput.placeholder = `${col.label} 검색...`;
            searchInput.onclick = (e) => e.stopPropagation();
            searchInput.oninput = (e) => {
                const term = e.target.value.toLowerCase();
                dropdown.querySelectorAll('.multi-select-option').forEach(opt => {
                    const txt = opt.innerText.toLowerCase();
                    opt.style.display = txt.includes(term) ? 'flex' : 'none';
                });
            };
            searchDiv.appendChild(searchInput);
            dropdown.appendChild(searchDiv);

            // Options container
            const optionsWrapper = document.createElement('div');
            optionsWrapper.className = 'options-wrapper';
            
            // Extract unique values
            const fundsToScan = window.allFunds || [];
            const rawValues = fundsToScan.flatMap(f => {
                let v = getFieldValue(f, col.key);
                return getAnalysisFilterTokens(col.key, v);
            });

            const hasNulls = allFunds.some(f => getAnalysisFilterTokens(col.key, getFieldValue(f, col.key)).length === 0);
            const uniqueValues = [...new Set(rawValues.filter(Boolean))].sort();
            const optionsToRender = [...uniqueValues];
            if (hasNulls) optionsToRender.push('미분류');

            optionsToRender.forEach(v => {
                const option = document.createElement('div');
                option.className = 'multi-select-option';
                if (analysisFilters[col.key] && analysisFilters[col.key].includes(v)) {
                    option.classList.add('selected');
                }
                
                option.innerHTML = `
                    <div class="multi-select-checkbox"></div>
                    <span>${v}</span>
                `;
                
                option.onclick = (e) => {
                    e.stopPropagation();
                    if (!analysisFilters[col.key]) analysisFilters[col.key] = [];
                    
                    const idx = analysisFilters[col.key].indexOf(v);
                    if (idx > -1) {
                        analysisFilters[col.key].splice(idx, 1);
                        option.classList.remove('selected');
                    } else {
                        analysisFilters[col.key].push(v);
                        option.classList.add('selected');
                    }
                    
                    updateTriggerText(trigger, col.key);
                    updateGroupBadge(group, section.cols);
                    renderFilterBasket();
                    if (window.renderAnalytics) window.renderAnalytics();
                };
                
                optionsWrapper.appendChild(option);
            });

            dropdown.appendChild(optionsWrapper);

            trigger.onclick = (e) => {
                e.stopPropagation();
                const isActive = dropdown.classList.contains('active');
                document.querySelectorAll('.multi-select-dropdown').forEach(d => {
                    d.classList.remove('active', 'open-up');
                    d.style.maxHeight = '';
                });
                if (!isActive) {
                    dropdown.classList.add('active');
                    const triggerBox = trigger.getBoundingClientRect();
                    const spaceBelow = window.innerHeight - triggerBox.bottom - 16;
                    const spaceAbove = triggerBox.top - 16;
                    if (spaceBelow < 260 && spaceAbove > spaceBelow) {
                        dropdown.classList.add('open-up');
                        dropdown.style.maxHeight = `${Math.max(180, Math.min(320, spaceAbove))}px`;
                    } else {
                        dropdown.style.maxHeight = `${Math.max(180, Math.min(320, spaceBelow))}px`;
                    }
                    searchInput.focus();
                }
            };

            container.appendChild(trigger);
            container.appendChild(dropdown);
            filterItem.appendChild(container);

            // Chips for selected items
            const chipsContainer = document.createElement('div');
            chipsContainer.className = 'filter-chips-container';
            filterItem.appendChild(chipsContainer);
            updateChips(chipsContainer, col.key);

            content.appendChild(filterItem);
        });

        group.appendChild(content);
        grid.appendChild(group);
        updateGroupBadge(group, section.cols);
    });

    renderFilterBasket();

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
        document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('active'));
    });
}

function updateGroupBadge(group, cols) {
    let totalSelected = 0;
    cols.forEach(col => {
        totalSelected += (analysisFilters[col.key] || []).length;
    });
    
    const badge = group.querySelector('.filter-count-badge');
    if (badge) {
        badge.innerText = totalSelected;
        if (totalSelected > 0) group.classList.add('has-selected');
        else group.classList.remove('has-selected');
    }
}

function updateChips(container, key) {
    container.innerHTML = '';
    const selected = analysisFilters[key] || [];
    selected.forEach(v => {
        const chip = document.createElement('div');
        chip.className = 'filter-chip-item';
        chip.innerHTML = `
            <span>${v}</span>
            <span class="filter-chip-remove">×</span>
        `;
        chip.querySelector('.filter-chip-remove').onclick = (e) => {
            e.stopPropagation();
            analysisFilters[key] = analysisFilters[key].filter(i => i !== v);
            initAnalysisFilters(); // Re-render all to sync
            if (window.renderAnalytics) window.renderAnalytics();
        };
        container.appendChild(chip);
    });
}

function renderFilterBasket() {
    const basket = document.getElementById('activeFilterBasket');
    const container = document.getElementById('activeFilterChips');
    if (!basket || !container) return;

    container.innerHTML = '';
    let total = 0;

    Object.keys(analysisFilters).forEach(key => {
        const selected = analysisFilters[key] || [];
        selected.forEach(v => {
            total++;
            const chip = document.createElement('div');
            chip.className = 'basket-chip';
            chip.innerHTML = `
                <span style="color:var(--muted); font-size:10px; margin-right:4px;">${getFilterLabel(key)}:</span>
                <span>${v}</span>
                <span class="basket-remove">×</span>
            `;
            chip.querySelector('.basket-remove').onclick = (e) => {
                e.stopPropagation();
                analysisFilters[key] = analysisFilters[key].filter(i => i !== v);
                if (analysisFilters[key].length === 0) delete analysisFilters[key];
                initAnalysisFilters();
                if (window.renderAnalytics) window.renderAnalytics();
            };
            container.appendChild(chip);
        });
    });

    basket.style.display = total > 0 ? 'block' : 'none';
}

function getFilterLabel(key) {
    const labels = {
        division: '부문', vehicle_type: '비히클', legal_form: '법적형태', fund_class: '분류',
        domestic_overseas: '국내외', fund_type: '유형', investment_strategy: '전략',
        base_asset_class: '기초자산', asset_nature_class: '성격', business_stage_class: '단계'
    };
    return labels[key] || key;
}

function updateTriggerText(trigger, key) {
    const selected = analysisFilters[key] || [];
    if (selected.length === 0) {
        trigger.innerHTML = '<span style="color:var(--muted)">전체</span>';
    } else {
        trigger.innerHTML = `<span style="font-weight:700; color:var(--accent)">${selected.length}개 선택됨</span>`;
    }
}

function resetAnalysisFilters() {
    analysisFilters = {};
    window.analysisFilters = analysisFilters;
    initAnalysisFilters();
    if (window.renderAnalytics) window.renderAnalytics();
}

function getFilteredData() {
    // 모든 펀드를 검색 및 노출되도록 대상에 포함 (실물 자산이 매핑된 운용 펀드 검색 누락 방지)
    let filteredFunds = allFunds;

    Object.keys(analysisFilters).forEach(key => {
        const selectedValues = (analysisFilters[key] || [])
            .map(normalizeAnalysisFilterValue)
            .filter(Boolean);
        if (selectedValues && selectedValues.length > 0) {
            filteredFunds = filteredFunds.filter(f => {
                const rawValue = getFieldValue(f, key);
                const normalized = normalizeAnalysisFilterValue(rawValue);
                if (!normalized) return selectedValues.includes('미분류');
                return selectedValues.some(selected => doesAnalysisValueMatch(key, normalized, selected));
            });
        }
    });

    return filteredFunds;
}

window.initAnalysisFilters = initAnalysisFilters;
window.resetAnalysisFilters = resetAnalysisFilters;
window.getFilteredData = getFilteredData;
