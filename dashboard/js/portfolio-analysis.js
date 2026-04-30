function initAnalysisFilters() {
    const filterSections = [
        {
            title: '포트폴리오 필터',
            cols: [
                { key: 'division', label: '부문' },
                { key: 'vehicle_type', label: 'Vehicle 구분' },
                { key: 'legal_form', label: '법적형태' },
                { key: 'fund_class', label: '펀드분류' },
                { key: 'domestic_overseas', label: '국내/해외' },
                { key: 'fund_type', label: '펀드유형' },
                { key: 'investment_strategy', label: '투자전략' },
                { key: 'base_asset_class', label: '기초자산' },
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
        if (!activeFilterKeys.has(key)) delete analysisFilters[key];
    });

    filterSections.forEach(section => {
        const group = document.createElement('div');
        group.className = 'filter-group active'; // Default open
        
        const header = document.createElement('div');
        header.className = 'filter-group-header';
        header.innerHTML = `<span>${section.title}</span><span class="filter-count-badge">0</span>`;
        header.onclick = () => group.classList.toggle('active');
        
        const content = document.createElement('div');
        content.className = 'filter-group-content';
        
        section.cols.forEach(col => {
            const filterItem = document.createElement('div');
            filterItem.className = 'filter-item';
            filterItem.style.marginBottom = '16px';

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
            const rawValues = allFunds.map(f => {
                let v = getFieldValue(f, col.key);
                return (v && String(v).trim()) ? String(v).trim() : null;
            });

            const hasNulls = rawValues.some(v => v === null);
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

        group.appendChild(header);
        group.appendChild(content);
        grid.appendChild(group);
        updateGroupBadge(group, section.cols);
    });

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
    let filteredFunds = [...allFunds];

    Object.keys(analysisFilters).forEach(key => {
        const selectedValues = analysisFilters[key];
        if (selectedValues && selectedValues.length > 0) {
            filteredFunds = filteredFunds.filter(f => {
                let val = getFieldValue(f, key);
                if (!val || String(val).trim() === '') val = '미분류';
                return selectedValues.includes(String(val).trim());
            });
        }
    });

    return filteredFunds;
}

window.initAnalysisFilters = initAnalysisFilters;
window.resetAnalysisFilters = resetAnalysisFilters;
window.getFilteredData = getFilteredData;
