const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let allStaff = [];
let allOrgs = [];
let filteredStaff = [];
let sortConfig = { key: 'custom', direction: 'asc' }; // 'custom' is the default hierarchical sort

// DOM Elements
const staffTableBody = document.getElementById('staffTableBody');
const staffSearch = document.getElementById('staffSearch');
const totalCount = document.getElementById('totalCount');
const activeCount = document.getElementById('activeCount');
const inactiveCount = document.getElementById('inactiveCount');
const loadingOverlay = document.getElementById('loadingOverlay');

const staffModal = document.getElementById('staffModal');
const staffForm = document.getElementById('staffForm');
const addStaffBtn = document.getElementById('addStaffBtn');
const closeModalBtns = document.querySelectorAll('.close-modal');
const modalTitle = document.getElementById('modalTitle');
const statusToggle = document.getElementById('status_toggle');
const statusText = document.getElementById('status_text');
const sectionFilter = document.getElementById('sectionFilter');
const statusFilter = document.getElementById('statusFilter');
const sortableHeaders = document.querySelectorAll('.sortable');

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await loadInitialData();
    setupEventListeners();
});

async function loadInitialData() {
    showLoading(true);
    try {
        const [staffRes, orgsRes] = await Promise.all([
            _supabase.from('staff').select('*, orgs(*)'), 
            _supabase.from('orgs').select('*').order('org_name')
        ]);

        if (staffRes.error) throw staffRes.error;
        if (orgsRes.error) throw orgsRes.error;

        allStaff = staffRes.data || [];
        allOrgs = orgsRes.data || [];
        
        applyCustomSort();
        filteredStaff = [...allStaff];

        populateOrgDropdown();
        renderStaffTable();
        updateStats();
    } catch (error) {
        console.error('Error loading data:', error);
        alert('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

function applyCustomSort() {
    const sectionPriority = {
        '투자+펀딩': 1,
        '사업+개발': 2,
        '관리+운영': 3,
        '부문외': 4
    };

    const titlePriority = {
        '본부장': 1,
        '이사': 2,
        '디렉터': 3,
        '시니어매니저': 4,
        '매니저': 5,
        '전문위원': 6,
        '어드바이저': 7
    };

    allStaff.sort((a, b) => {
        // 0. Is Main (Excel based) Priority - Main first
        const isMainA = a.metadata?.is_main !== false;
        const isMainB = b.metadata?.is_main !== false;
        if (isMainA !== isMainB) return isMainA ? -1 : 1;

        // 1. Section Priority
        const getSecPrio = (s) => {
            const path = s.orgs?.metadata?.full_path || '';
            if (path.includes('투자+펀딩')) return 1;
            if (path.includes('사업+개발')) return 2;
            if (path.includes('관리+운영')) return 3;
            if (path.includes('부문')) return 4;
            return 99;
        };
        
        const prioA = getSecPrio(a);
        const prioB = getSecPrio(b);
        if (prioA !== prioB) return prioA - prioB;

        // 2. Org Name
        const orgA = a.orgs?.org_name || 'ZZZ';
        const orgB = b.orgs?.org_name || 'ZZZ';
        if (orgA !== orgB) return orgA.localeCompare(orgB, 'ko');

        // 3. Title Priority
        const tA = titlePriority[a.title] || 99;
        const tB = titlePriority[b.title] || 99;
        if (tA !== tB) return tA - tB;

        // 4. Name
        return a.name.localeCompare(b.name, 'ko');
    });
}


function setupEventListeners() {
    // Search & Filter
    staffSearch.addEventListener('input', filterAndRender);
    sectionFilter.addEventListener('change', filterAndRender);
    statusFilter.addEventListener('change', filterAndRender);

    // Sorting
    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const key = header.getAttribute('data-sort');
            handleSort(key);
            
            // Update icons
            sortableHeaders.forEach(h => {
                const icon = h.querySelector('i');
                if (!icon) return;
                if (h === header) {
                    icon.className = sortConfig.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                } else {
                    icon.className = 'fas fa-sort';
                }
            });
        });
    });

    // Modal
    addStaffBtn.addEventListener('click', () => openModal());
    closeModalBtns.forEach(btn => btn.addEventListener('click', closeModal));
    
    // Status Toggle Text
    statusToggle.addEventListener('change', (e) => {
        statusText.innerText = e.target.checked ? '재직 중' : '퇴사 (비활성)';
        statusText.style.color = e.target.checked ? 'var(--success)' : 'var(--danger)';
    });

    // Form Submit
    staffForm.addEventListener('submit', handleFormSubmit);
}

function filterAndRender() {
    const term = staffSearch.value.toLowerCase();
    const section = sectionFilter.value;
    const status = statusFilter.value;

    filteredStaff = allStaff.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(term) || 
                            (s.email && s.email.toLowerCase().includes(term)) ||
                            (s.orgs?.org_name && s.orgs.org_name.toLowerCase().includes(term));
        
        const matchesSection = !section || (s.orgs?.metadata?.full_path || '').includes(section);
        const matchesStatus = !status || s.status === status;

        return matchesSearch && matchesSection && matchesStatus;
    });

    renderStaffTable();
    updateStats();
}

function handleSort(key) {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = 'asc';
    }

    const dir = sortConfig.direction === 'asc' ? 1 : -1;

    filteredStaff.sort((a, b) => {
        let valA, valB;

        switch (key) {
            case 'status':
                valA = a.status;
                valB = b.status;
                break;
            case 'name':
                valA = a.name;
                valB = b.name;
                break;
            case 'email':
                valA = a.email || '';
                valB = b.email || '';
                break;
            case 'org':
                valA = a.orgs?.org_name || '';
                valB = b.orgs?.org_name || '';
                break;
            case 'title':
                valA = a.title || '';
                valB = b.title || '';
                break;
            default:
                return 0;
        }

        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });

    renderStaffTable();
}

function renderStaffTable() {
    // Filter out duplicates (Concurrent positions) - Keep only the 'main' one
    const uniqueStaffMap = new Map();
    
    // Sort to ensure is_main: true comes last to overwrite, or process explicitly
    filteredStaff.forEach(s => {
        const key = s.email || s.name;
        if (!uniqueStaffMap.has(key) || s.metadata?.is_main === true) {
            uniqueStaffMap.set(key, s);
        }
    });

    const uniqueStaff = Array.from(uniqueStaffMap.values());

    staffTableBody.innerHTML = uniqueStaff.map(s => {
        const isInactive = s.status !== 'active';
        return `
        <tr data-id="${s.staff_id}" class="${isInactive ? 'row-inactive' : ''} ${s.metadata?.is_main === false ? 'row-external' : ''}">
            <td>
                <span class="status-badge ${s.status === 'active' ? 'active' : 'inactive'}">
                    ${s.status === 'active' ? '재직' : '퇴사'}
                </span>
            </td>
            <td style="font-weight: 700;">${s.name}</td>
            <td style="color: var(--text-muted); font-size: 0.85em;">${s.email || '-'}</td>
            <td>
                <div style="font-weight: 500;">${s.orgs?.org_name || '<span style="color:var(--danger)">미지정</span>'}</div>
                <div style="font-size: 0.75em; color: var(--text-muted);">${s.orgs?.metadata?.full_path?.split(' > ')[0] || ''}</div>
            </td>
            <td>${s.title || ''} ${s.level ? '/ ' + s.level : ''}</td>
            <td>
                <button class="btn-secondary" onclick="openModal('${s.staff_id}')">수정</button>
            </td>
        </tr>
    `).join('');
}

function updateStats() {
    const total = filteredStaff.length;
    const active = filteredStaff.filter(s => s.status === 'active').length;
    const inactive = total - active;

    totalCount.innerText = `전체: ${total}명`;
    activeCount.innerText = `재직: ${active}명`;
    inactiveCount.innerText = `퇴사: ${inactive}명`;
}

function populateOrgDropdown() {
    const orgSelect = document.getElementById('org_id');
    orgSelect.innerHTML = '<option value="">부서 선택...</option>' + 
        allOrgs.map(o => `<option value="${o.org_id}">${o.org_name} (${o.org_type})</option>`).join('');
}

function openModal(staffId = null) {
    staffForm.reset();
    document.getElementById('editStaffId').value = staffId || '';
    
    if (staffId) {
        modalTitle.innerText = '사원 정보 수정';
        const staff = allStaff.find(s => s.staff_id === staffId);
        if (staff) {
            document.getElementById('name').value = staff.name;
            document.getElementById('email').value = staff.email || '';
            document.getElementById('org_id').value = staff.org_id || '';
            document.getElementById('title').value = staff.title || '';
            document.getElementById('level').value = staff.level || '';
            statusToggle.checked = staff.status === 'active';
            statusToggle.dispatchEvent(new Event('change'));
        }
    } else {
        modalTitle.innerText = '신규 사원 등록';
        statusToggle.checked = true;
        statusToggle.dispatchEvent(new Event('change'));
    }
    
    staffModal.classList.add('active');
}

function closeModal() {
    staffModal.classList.remove('active');
}

async function handleFormSubmit(e) {
    e.preventDefault();
    showLoading(true);

    const staffId = document.getElementById('editStaffId').value;
    const formData = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        org_id: document.getElementById('org_id').value || null,
        title: document.getElementById('title').value,
        level: document.getElementById('level').value,
        status: statusToggle.checked ? 'active' : 'inactive'
    };

    try {
        let res;
        if (staffId) {
            // Update
            res = await _supabase.from('staff').update(formData).eq('staff_id', staffId);
        } else {
            // Insert
            // Generate a simple ID if not provided (usually staff_emp_<no> or uuid)
            const newId = formData.employee_no ? `staff_emp_${formData.employee_no}` : `staff_new_${Date.now()}`;
            res = await _supabase.from('staff').insert([{ ...formData, staff_id: newId }]);
        }

        if (res.error) throw res.error;

        alert(staffId ? '수정되었습니다.' : '등록되었습니다.');
        closeModal();
        await loadInitialData(); // Reload list
    } catch (error) {
        console.error('Save error:', error);
        alert('저장 중 오류가 발생했습니다: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    loadingOverlay.classList.toggle('active', show);
}

function deleteStaff(staffId) {
    if (confirm('정말로 이 사원 정보를 삭제하시겠습니까? (이력 관리를 위해 가급적 퇴사 처리를 권장합니다)')) {
        // Implementation for hard delete if needed
    }
}
