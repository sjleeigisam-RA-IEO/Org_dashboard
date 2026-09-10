const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let allStaff = [];
let allOrgs = [];
let filteredStaff = [];
let accessSnapshot = { connected: false, generatedAt: null, onlineWindowMinutes: 5 };
let accessRefreshTimer = null;
let sortConfig = { key: 'last_login', direction: 'desc' };

// DOM Elements
const staffTableBody = document.getElementById('staffTableBody');
const staffSearch = document.getElementById('staffSearch');
const totalCount = document.getElementById('totalCount');
const onlineCount = document.getElementById('onlineCount');
const sessionCount = document.getElementById('sessionCount');
const historyCount = document.getElementById('historyCount');
const presenceUpdatedAt = document.getElementById('presenceUpdatedAt');
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
const accessFilter = document.getElementById('accessFilter');
const refreshAccessBtn = document.getElementById('refreshAccessBtn');
const sortableHeaders = document.querySelectorAll('.sortable');

// Init
document.addEventListener('DOMContentLoaded', async () => {
    if (window.__RA_ADMIN_READY__) {
        const allowed = await window.__RA_ADMIN_READY__;
        if (!allowed) return;
    }
    setupEventListeners();
    updateSortIndicators();
    window.RAAuth?.startPresence?.();
    await loadInitialData();
    startAccessAutoRefresh();
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

        if (window.__RA_ADMIN_ACCESS_SNAPSHOT__) {
            applyAccessSnapshot(window.__RA_ADMIN_ACCESS_SNAPSHOT__);
            delete window.__RA_ADMIN_ACCESS_SNAPSHOT__;
        } else {
            await refreshAccessSnapshot({ silent: true, rerender: false });
        }

        populateOrgDropdown();
        filterAndRender();
    } catch (error) {
        console.error('Error loading data:', error);
        alert('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

async function refreshAccessSnapshot({ silent = false, rerender = true } = {}) {
    const token = window.RAAuth?.getSessionToken?.();
    refreshAccessBtn?.classList.add('is-loading');
    if (refreshAccessBtn) refreshAccessBtn.disabled = true;

    try {
        const data = await requestAccessSnapshot(token);
        applyAccessSnapshot(data);
        if (rerender) filterAndRender();
        return true;
    } catch (error) {
        accessSnapshot.connected = false;
        if (presenceUpdatedAt) presenceUpdatedAt.textContent = '실시간 연결 전';
        if (!silent) console.warn(error.message || '접속 현황을 갱신하지 못했습니다.');
        if (rerender) updateStats();
        return false;
    } finally {
        refreshAccessBtn?.classList.remove('is-loading');
        if (refreshAccessBtn) refreshAccessBtn.disabled = false;
    }
}

async function requestAccessSnapshot(token) {
    if (['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)) {
        const response = await fetch('/__ra_access_snapshot', { cache: 'no-store' });
        if (response.ok) return await response.json();
    }
    if (!token) throw new Error('접속 현황을 보려면 다시 로그인해야 합니다.');
    return await window.RAAuth.request('admin-access-list', { session_token: token });
}

function applyAccessSnapshot(data) {
    const byId = new Map();
    const byEmail = new Map();

    (data?.visitors || []).forEach(visitor => {
        const email = String(visitor.email || '').trim().toLowerCase();
        const existing = (email && byEmail.get(email)) || byId.get(visitor.staff_id);
        const merged = existing ? {
            ...existing,
            online: Boolean(existing.online || visitor.online),
            session_active: Boolean(existing.session_active || visitor.session_active),
            login_count: Math.max(Number(existing.login_count || 0), Number(visitor.login_count || 0)),
            last_login_at: latestTimestamp(existing.last_login_at, visitor.last_login_at),
            last_seen_at: latestTimestamp(existing.last_seen_at, visitor.last_seen_at),
        } : visitor;

        if (visitor.staff_id) byId.set(visitor.staff_id, merged);
        if (email) byEmail.set(email, merged);
    });

    allStaff.forEach(staff => {
        const email = String(staff.email || '').trim().toLowerCase();
        const access = (email ? byEmail.get(email) : null) || byId.get(staff.staff_id) || null;
        staff._access = access;
        if (access?.last_login_at) staff.last_login = access.last_login_at;
        if (access) staff.login_count = Math.max(Number(staff.login_count || 0), Number(access.login_count || 0));
    });

    accessSnapshot = {
        connected: true,
        generatedAt: data?.generated_at || new Date().toISOString(),
        onlineWindowMinutes: Number(data?.online_window_minutes || 5),
    };
}

function latestTimestamp(left, right) {
    if (!left) return right || null;
    if (!right) return left;
    return new Date(left) >= new Date(right) ? left : right;
}

function startAccessAutoRefresh() {
    if (accessRefreshTimer) window.clearInterval(accessRefreshTimer);
    accessRefreshTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') refreshAccessSnapshot({ silent: true });
    }, 30 * 1000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshAccessSnapshot({ silent: true });
    });
}


function setupEventListeners() {
    // Search & Filter
    staffSearch.addEventListener('input', filterAndRender);
    sectionFilter.addEventListener('change', filterAndRender);
    statusFilter.addEventListener('change', filterAndRender);
    accessFilter.addEventListener('change', filterAndRender);
    refreshAccessBtn.addEventListener('click', () => refreshAccessSnapshot());

    // Sorting
    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const key = header.getAttribute('data-sort');
            handleSort(key);
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
    const access = accessFilter.value;

    filteredStaff = allStaff.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(term) ||
                            (s.email && s.email.toLowerCase().includes(term)) ||
                            (s.orgs?.org_name && s.orgs.org_name.toLowerCase().includes(term));

        const matchesSection = !section || (s.orgs?.metadata?.full_path || '').includes(section);
        const matchesStatus = !status || s.status === status;
        const matchesAccess = !access ||
                            (access === 'online' && isStaffOnline(s)) ||
                            (access === 'accessed' && hasStaffAccess(s)) ||
                            (access === 'never' && !hasStaffAccess(s));

        return matchesSearch && matchesSection && matchesStatus && matchesAccess;
    });

    sortStaffRows(filteredStaff);
    renderStaffTable();
    updateStats();
}

function handleSort(key) {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = ['presence', 'last_login', 'login_count'].includes(key) ? 'desc' : 'asc';
    }

    sortStaffRows(filteredStaff);
    updateSortIndicators();
    renderStaffTable();
}

function sortStaffRows(rows) {
    const dir = sortConfig.direction === 'asc' ? 1 : -1;

    rows.sort((a, b) => {
        let valA, valB;

        switch (sortConfig.key) {
            case 'presence':
                valA = presenceSortValue(a);
                valB = presenceSortValue(b);
                break;
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
            case 'last_login':
                valA = getStaffLastLogin(a);
                valB = getStaffLastLogin(b);
                break;
            case 'login_count':
                valA = parseInt(a.login_count) || 0;
                valB = parseInt(b.login_count) || 0;
                break;
            default:
                return 0;
        }

        const missingA = valA === '' || valA === null || valA === undefined;
        const missingB = valB === '' || valB === null || valB === undefined;
        if (missingA !== missingB) return missingA ? 1 : -1;
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
}

function updateSortIndicators() {
    sortableHeaders.forEach(header => {
        const active = header.getAttribute('data-sort') === sortConfig.key;
        const icon = header.querySelector('i');
        header.setAttribute('aria-sort', active
            ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending')
            : 'none');
        if (icon) {
            icon.className = active
                ? (sortConfig.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down')
                : 'fas fa-sort';
        }
    });
}

function getStaffLastLogin(staff) {
    return staff?._access?.last_login_at || staff?.last_login || '';
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
        const presence = staffPresence(s);
        const lastLogin = getStaffLastLogin(s);
        const lastActivity = latestTimestamp(s._access?.last_seen_at, lastLogin);
        return `
        <tr data-id="${s.staff_id}" class="${isInactive ? 'row-inactive' : ''} ${s.metadata?.is_main === false ? 'row-external' : ''}">
            <td>
                <span class="presence-badge ${presence.className}" title="${presence.title}">
                    ${presence.label}
                </span>
            </td>
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
                <div class="last-login-cell">
                    <span>${formatKstDateTime(lastLogin)}</span>
                    <span class="last-login-relative">${formatRelativeTime(lastActivity)}</span>
                </div>
            </td>
            <td style="text-align: center; font-weight: 700;"><span class="access-count">${Number(s.login_count || 0).toLocaleString('ko-KR')}</span>회</td>
            <td>
                <button class="btn-secondary" onclick="openModal('${s.staff_id}')">수정</button>
            </td>
        </tr>
        `;
    }).join('');
}

function formatKstDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

function formatRelativeTime(value) {
    if (!value) return '접속 이력 없음';
    const elapsedMs = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(elapsedMs)) return '';
    const minutes = Math.max(0, Math.floor(elapsedMs / 60000));
    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.floor(hours / 24)}일 전`;
}

function isStaffOnline(staff) {
    return staff?._access?.online === true;
}

function staffPresence(staff) {
    if (isStaffOnline(staff)) {
        return {
            className: 'online',
            label: '접속 중',
            title: `최근 ${accessSnapshot.onlineWindowMinutes}분 내 인증 활동`,
        };
    }
    if (staff?._access?.session_active === true) {
        return {
            className: 'session',
            label: '로그인 유지',
            title: '유효한 자동로그인 세션이 남아 있음',
        };
    }
    return { className: 'offline', label: '오프라인', title: '활성 세션 없음' };
}

function presenceSortValue(staff) {
    if (isStaffOnline(staff)) return 3;
    if (staff?._access?.session_active === true) return 2;
    return hasStaffAccess(staff) ? 1 : 0;
}

function hasStaffAccess(staff) {
    return Boolean(staff?.last_login || Number(staff?.login_count || 0) > 0);
}

function uniqueStaffRows(rows) {
    const unique = new Map();
    rows.forEach(staff => {
        const key = String(staff.email || staff.staff_id || staff.name).trim().toLowerCase();
        const current = unique.get(key);
        if (!current || staff.metadata?.is_main === true) unique.set(key, staff);
    });
    return Array.from(unique.values());
}

function updateStats() {
    const visibleStaff = uniqueStaffRows(filteredStaff);
    const allUniqueStaff = uniqueStaffRows(allStaff);
    const online = allUniqueStaff.filter(isStaffOnline).length;
    const maintained = allUniqueStaff.filter(staff => staff?._access?.session_active === true && !isStaffOnline(staff)).length;
    const accessed = allUniqueStaff.filter(hasStaffAccess).length;

    onlineCount.innerText = `접속 중 ${online}명`;
    sessionCount.innerText = `로그인 유지 ${maintained}명`;
    historyCount.innerText = `접속 이력 ${accessed}명`;
    totalCount.innerText = `표시 ${visibleStaff.length}명`;
    presenceUpdatedAt.innerText = accessSnapshot.connected
        ? `${formatKstTime(accessSnapshot.generatedAt)} 기준 · ${accessSnapshot.onlineWindowMinutes}분 내 활동`
        : '실시간 연결 전';
}

function formatKstTime(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(value));
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
