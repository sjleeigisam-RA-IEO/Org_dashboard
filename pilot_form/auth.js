(function () {
    const ACCESS_RANK = {
        public: 0,
        internal: 1,
        restricted: 2,
        confidential: 3
    };

    const DEFAULT_PROFILE = {
        display_name: "Guest",
        staff_id: "",
        staff_name: "",
        role_code: "viewer",
        access_level: "internal",
        allowed_project_ids: [],
        default_workspace_code: "WS_PM"
    };

    const state = {
        client: null,
        session: null,
        profile: null,
        options: {}
    };

    function init(options) {
        state.client = options.supabaseClient;
        state.options = options;
        renderAuthPanel();
        wireAuthEvents();
        return refreshSession();
    }

    async function refreshSession() {
        const { data, error } = await state.client.auth.getSession();
        if (error) {
            setStatus("로그인 상태를 확인하지 못했습니다: " + error.message, "error");
            setLocked(true);
            return null;
        }

        state.session = data.session;
        if (!state.session) {
            state.profile = null;
            renderSignedOut();
            setLocked(true);
            return null;
        }

        setLocked(false);
        state.profile = await loadProfile(state.session.user);
        applyProfileToForm();
        renderSignedIn();
        if (typeof state.options.onProfileReady === "function") {
            state.options.onProfileReady(state.profile);
        }
        return state.profile;
    }

    async function loadProfile(user) {
        const { data, error } = await state.client
            .from("pilot_access_profiles")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .maybeSingle();

        if (!error && data) {
            return {
                ...DEFAULT_PROFILE,
                ...data,
                email: data.email || user.email,
                user_id: user.id
            };
        }

        return {
            ...DEFAULT_PROFILE,
            email: user.email,
            user_id: user.id,
            display_name: user.user_metadata?.display_name || user.email,
            staff_name: user.user_metadata?.staff_name || user.email
        };
    }

    function renderAuthPanel() {
        const mount = document.getElementById("auth-panel");
        if (!mount) return;
        mount.innerHTML = `
            <div class="auth-card">
                <div>
                    <div class="auth-title" id="auth-title">로그인 필요</div>
                    <div class="auth-meta" id="auth-meta">승인된 구성원만 입력할 수 있습니다.</div>
                </div>
                <form class="auth-form" id="auth-form">
                    <input type="email" id="auth-email" autocomplete="email" placeholder="email@company.com" required>
                    <input type="password" id="auth-password" autocomplete="current-password" placeholder="password" required>
                    <button type="submit" class="auth-btn">로그인</button>
                </form>
                <button type="button" class="auth-btn auth-btn-secondary" id="auth-signout">로그아웃</button>
            </div>
        `;
    }

    function wireAuthEvents() {
        document.getElementById("auth-form")?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const email = document.getElementById("auth-email").value.trim();
            const password = document.getElementById("auth-password").value;
            setStatus("로그인 중입니다.", "");
            const { error } = await state.client.auth.signInWithPassword({ email, password });
            if (error) {
                setStatus("로그인 실패: " + error.message, "error");
                return;
            }
            setStatus("로그인되었습니다.", "success");
            await refreshSession();
        });

        document.getElementById("auth-signout")?.addEventListener("click", async () => {
            await state.client.auth.signOut();
            setStatus("로그아웃되었습니다.", "");
            await refreshSession();
        });

        state.client.auth.onAuthStateChange(() => {
            refreshSession();
        });
    }

    function renderSignedOut() {
        document.getElementById("auth-title").textContent = "로그인 필요";
        document.getElementById("auth-meta").textContent = "승인된 구성원만 입력할 수 있습니다.";
        document.getElementById("auth-form").style.display = "grid";
        document.getElementById("auth-signout").style.display = "none";
    }

    function renderSignedIn() {
        const profile = state.profile || DEFAULT_PROFILE;
        document.getElementById("auth-title").textContent = profile.display_name || profile.staff_name || profile.email;
        document.getElementById("auth-meta").textContent = `${profile.role_code || "member"} · ${profile.access_level || "internal"}`;
        document.getElementById("auth-form").style.display = "none";
        document.getElementById("auth-signout").style.display = "inline-flex";
    }

    function applyProfileToForm() {
        const profile = state.profile;
        const staffSelect = state.options.staffSelect;
        if (staffSelect && profile?.staff_id) {
            const option = [...staffSelect.options].find(item => item.value === profile.staff_id);
            if (option) {
                staffSelect.value = profile.staff_id;
                staffSelect.disabled = true;
            }
        }
        hydrateProjectSelects(document);
        hydrateVisibilitySelects(document);
    }

    function setLocked(locked) {
        const form = state.options.form;
        if (!form) return;
        form.classList.toggle("is-locked", locked);
        [...form.querySelectorAll("input, select, textarea, button")].forEach((el) => {
            el.disabled = locked;
        });
    }

    function hydrateProjectSelects(root) {
        const profile = state.profile;
        if (!profile) return;
        const allowed = new Set(profile.allowed_project_ids || []);
        root.querySelectorAll(".project-sel").forEach((select) => {
            [...select.options].forEach((option) => {
                if (!option.value) return;
                option.hidden = allowed.size > 0 && !allowed.has(option.value);
            });
            if (select.value && select.selectedOptions[0]?.hidden) select.value = "";
        });
    }

    function hydrateVisibilitySelects(root) {
        const profile = state.profile;
        if (!profile) return;
        root.querySelectorAll(".visibility-sel").forEach((select) => {
            [...select.options].forEach((option) => {
                option.disabled = ACCESS_RANK[option.value] > ACCESS_RANK[profile.access_level || "internal"];
            });
            select.value = clampVisibility(select.value || profile.access_level || "internal");
        });
    }

    function visibilityField() {
        return `
            <div class="form-group">
                <label>공개 레벨</label>
                <select class="visibility-sel" required>
                    <option value="public">전체 공개</option>
                    <option value="internal" selected>내부 공유</option>
                    <option value="restricted">프로젝트 제한</option>
                    <option value="confidential">기밀</option>
                </select>
            </div>
        `;
    }

    function currentProfile() {
        return state.profile;
    }

    function requireProfile() {
        if (!state.profile) throw new Error("로그인이 필요합니다.");
        return state.profile;
    }

    function canUseProject(projectId) {
        const profile = requireProfile();
        const allowed = profile.allowed_project_ids || [];
        return allowed.length === 0 || allowed.includes(projectId);
    }

    function clampVisibility(level) {
        const profileLevel = state.profile?.access_level || "internal";
        return ACCESS_RANK[level] <= ACCESS_RANK[profileLevel] ? level : profileLevel;
    }

    function logAccessPayload(projectId, requestedLevel) {
        const profile = requireProfile();
        if (!canUseProject(projectId)) {
            throw new Error("이 사용자는 선택한 프로젝트에 입력할 권한이 없습니다.");
        }
        const visibilityLevel = clampVisibility(requestedLevel || profile.access_level || "internal");
        return {
            created_by_user_id: profile.user_id,
            writer_staff_id: profile.staff_id || "",
            writer_name: profile.staff_name || profile.display_name || profile.email,
            visibility_level: visibilityLevel,
            access_tags: {
                role_code: profile.role_code,
                access_level: profile.access_level,
                allowed_project_ids: profile.allowed_project_ids || []
            }
        };
    }

    function setStatus(message, type) {
        if (typeof state.options.setStatus === "function") {
            state.options.setStatus(message, type);
        }
    }

    window.IOTA_AUTH = {
        init,
        currentProfile,
        visibilityField,
        hydrateProjectSelects,
        hydrateVisibilitySelects,
        logAccessPayload
    };
})();
