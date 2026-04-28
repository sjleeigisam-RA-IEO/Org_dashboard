function initAnalysisFilters() {
    const filterCols = [
        { key: 'notion_division_class', label: '담당부문' },
        { key: 'notion_vehicle_class', label: 'Vehicle 구분' },
        { key: 'notion_fund_class', label: '펀드분류' },
        { key: 'notion_sector_class', label: '투자섹터' },
        { key: 'notion_investment_strategy_class', label: '투자전략' },
        { key: 'notion_business_stage_class', label: '사업단계' }
    ];

    const grid = document.getElementById('filterGrid');
    if (!grid) return;
    grid.innerHTML = '';

    filterCols.forEach(col => {
        // Find all values including nulls
        const rawValues = allFunds.map(f => {
            const v = f[col.key] || f.metadata?.[col.key];
            return (v && v.trim()) ? v : null;
        });

        const hasNulls = rawValues.some(v => v === null);
        const uniqueValues = [...new Set(rawValues.filter(Boolean))].sort();
        
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';

        const label = document.createElement('label');
        label.innerText = col.label;
        filterItem.appendChild(label);

        // Custom Multi-select UI
        const container = document.createElement('div');
        container.className = 'multi-select-container';
        
        const trigger = document.createElement('div');
        trigger.className = 'multi-select-trigger';
        updateTriggerText(trigger, col.key);
        
        const dropdown = document.createElement('div');
        dropdown.className = 'multi-select-dropdown';
        
        // Add options including '미분류' if nulls exist
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
                if (window.renderAnalytics) window.renderAnalytics();
            };
            
            dropdown.appendChild(option);
        });


        trigger.onclick = (e) => {
            e.stopPropagation();
            const isActive = dropdown.classList.contains('active');
            // Close all other dropdowns
            document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('active'));
            if (!isActive) dropdown.classList.add('active');
        };

        container.appendChild(trigger);
        container.appendChild(dropdown);
        filterItem.appendChild(container);
        grid.appendChild(filterItem);
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
        document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('active'));
    });
}

function updateTriggerText(trigger, key) {
    const selected = analysisFilters[key] || [];
    if (selected.length === 0) {
        trigger.innerHTML = '<span style="color:var(--muted)">전체</span>';
    } else if (selected.length === 1) {
        trigger.innerHTML = `<span class="filter-chip">${selected[0]}</span>`;
    } else {
        trigger.innerHTML = `<span class="filter-chip">${selected[0]}</span> <span style="font-size:11px; color:var(--muted); font-weight:700;">외 ${selected.length - 1}</span>`;
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
                let val = f[key] || f.metadata?.[key];
                if (!val || val.trim() === '') val = '미분류';
                return selectedValues.includes(val);
            });
        }
    });

    return filteredFunds;
}

window.initAnalysisFilters = initAnalysisFilters;
window.resetAnalysisFilters = resetAnalysisFilters;
window.getFilteredData = getFilteredData;

