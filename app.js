(function () {
  const data = window.ORG_DASHBOARD_DATA;

  if (!data) {
    document.body.innerHTML = "<p>대시보드 데이터를 불러오지 못했습니다.</p>";
    return;
  }

  const ROLE_ORDER = ["디렉터", "그룹장", "파트장/센터장", "담당디렉터", "시니어매니저", "매니저"];
  const ROLE_FILTER_ORDER = ["그룹장", "파트장/센터장", "담당디렉터", "시니어매니저", "매니저"];

  const state = {
    activeSection: "all",
    search: "",
    role: "all",
  };

  const heroMeta = document.getElementById("heroMeta");
  const sectionTabs = document.getElementById("sectionTabs");
  const kpiGrid = document.getElementById("kpiGrid");
  const sectionChart = document.getElementById("sectionChart");
  const roleChart = document.getElementById("roleChart");
  const orgBoard = document.getElementById("orgBoard");
  const searchInput = document.getElementById("searchInput");
  const roleFilter = document.getElementById("roleFilter");
  const roleModal = document.getElementById("roleModal");
  const roleModalClose = document.getElementById("roleModalClose");
  const roleModalTitle = document.getElementById("roleModalTitle");
  const roleModalSummary = document.getElementById("roleModalSummary");
  const roleModalList = document.getElementById("roleModalList");

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const fmt = (value) => new Intl.NumberFormat("ko-KR").format(value);

  function normalizeDisplayLabel(value) {
    return String(value ?? "")
      .replace("론파이낸스센터", "론파이낸스센터(LFC)")
      .replace("개발솔루션센터", "개발솔루션센터(DSC)")
      .replace("공간솔루션센터", "공간솔루션센터(SSC)")
      .replace("리테일솔루션센터", "리테일솔루션센터(RSC)")
      .replace("기업마케팅센터", "기업마케팅센터(EMC)")
      .replace("기획추진센터", "기획추진센터(IEC)")
      .replace("로지스틱스 / 매니지먼트", "로지스틱스 매니지먼트")
      .replace("리빙 / 매니지먼트", "리빙 매니지먼트");
  }

  function getTfConfig(groupName) {
    if (groupName === "IOTA CFT") {
      return {
        leaderLabel: "TF장",
        leaderName: "이철승",
        organizations: [
          "사업2파트",
          "국내자산관리그룹",
          "LFC",
          "SSC",
          "DSC",
          "EMC",
          "디지털사업그룹",
          "개발PFV TF",
        ],
      };
    }

    if (groupName === "SS&C TF") {
      return {
        leaderLabel: "TF장",
        leaderRole: "그룹장",
        roleMap: {
          "그룹장": "TF장",
          "파트장/센터장": "담당디렉터",
          "담당디렉터": "서포트디렉터",
        },
      };
    }

    if (groupName === "개발PFV TF") {
      return {
        leaderLabel: "TF장",
        leaderRole: "파트장/센터장",
        roleMap: {
          "파트장/센터장": "TF장",
          "담당디렉터": "시니어매니저",
        },
      };
    }

    return null;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function filterMembers(members) {
    return members.filter((member) => {
      if (member.tags.includes("외부영입")) {
        return false;
      }
      return state.role === "all" || member.role === state.role;
    });
  }

  function buildFilteredSections() {
    const sections = [];
    for (const section of data.sections) {
      if (state.activeSection !== "all" && section.name !== state.activeSection) {
        continue;
      }

      const sectionCopy = clone(section);
      sectionCopy.groups = sectionCopy.groups
        .map((group) => {
          group.parts = group.parts
            .map((part) => {
              part.teams = part.teams
                .map((team) => {
                  const keyword = state.search.trim().toLowerCase();
                  const scopedMembers = filterMembers(team.members);
                  const teamMatch = `${team.displayName} ${team.path}`.toLowerCase().includes(keyword);
                  const members = !keyword
                    ? scopedMembers
                    : teamMatch
                      ? scopedMembers
                      : scopedMembers.filter((member) =>
                          `${member.rawName} ${member.name}`.toLowerCase().includes(keyword)
                        );

                  return {
                    ...team,
                    members,
                    assignmentCount: members.length,
                    uniquePeopleCount: new Set(members.map((member) => member.name)).size,
                  };
                })
                .filter((team) => team.members.length > 0);

              const members = part.teams.flatMap((team) => team.members);
              return {
                ...part,
                teams: part.teams,
                assignmentCount: members.length,
                uniquePeopleCount: new Set(members.map((member) => member.name)).size,
              };
            })
            .filter((part) => part.teams.length > 0);

          const members = group.parts.flatMap((part) => part.teams.flatMap((team) => team.members));
          return {
            ...group,
            assignmentCount: members.length,
            uniquePeopleCount: new Set(members.map((member) => member.name)).size,
          };
        })
        .filter((group) => group.parts.length > 0);

      const members = sectionCopy.groups.flatMap((group) =>
        group.parts.flatMap((part) => part.teams.flatMap((team) => team.members))
      );

      if (members.length > 0) {
        sectionCopy.assignmentCount = members.length;
        sectionCopy.uniquePeopleCount = new Set(members.map((member) => member.name)).size;
        sections.push(sectionCopy);
      }
    }
    return sections;
  }

  function buildSummary(sections) {
    const members = sections.flatMap((section) =>
      section.groups.flatMap((group) =>
        group.parts.flatMap((part) => part.teams.flatMap((team) => team.members))
      )
    );

    const uniquePeople = new Set(members.map((member) => member.name));
    const groupSet = new Set();
    const centerSet = new Set();
    const tfSet = new Set();
    const partSet = new Set();

    sections.forEach((section) => {
      section.groups.forEach((group) => {
        const groupKey = `${section.name}|${group.name}`;
        if (group.name.includes("그룹")) {
          groupSet.add(groupKey);
        }
        if (group.name.includes("센터")) {
          centerSet.add(groupKey);
        }
        if (group.name.includes("TF") || group.name.includes("CFT")) {
          tfSet.add(groupKey);
        }
        group.parts.forEach((part) => {
          if (part.name && part.name !== "미지정" && group.name.includes("그룹")) {
            partSet.add(`${section.name}|${group.name}|${part.name}`);
          }
        });
      });
    });

    return {
      uniquePeopleCount: uniquePeople.size,
      sectionCount: sections.length,
      groupCount: groupSet.size,
      partCount: partSet.size,
      centerCount: centerSet.size,
      tfCount: tfSet.size,
      sectionCounts: sections.map((section) => ({
        name: section.name,
        count: section.uniquePeopleCount,
      })),
      roleSeatCounts: buildRoleSeatCounts(sections),
    };
  }

  function buildRoleSeatCounts(sections) {
    const seatsByRole = Object.fromEntries(ROLE_FILTER_ORDER.map((role) => [role, new Set()]));
    const groupLeaderByGroup = new Map();

    sections.forEach((section) => {
      section.groups.forEach((group) => {
        group.parts.forEach((part) => {
          part.teams.forEach((team) => {
            team.members.forEach((member) => {
              if (member.role === "그룹장") {
                groupLeaderByGroup.set(`${section.name}|${group.name}`, member.name);
              }
            });
          });
        });
      });
    });

    sections.forEach((section) => {
      section.groups.forEach((group) => {
        const groupLeaderName = groupLeaderByGroup.get(`${section.name}|${group.name}`);
        group.parts.forEach((part) => {
          part.teams.forEach((team) => {
            team.members.forEach((member) => {
              if (!seatsByRole[member.role] || member.tags.includes("외부영입")) {
                return;
              }

              let seatKey = "";
              if (member.role === "디렉터") {
                seatKey = `${team.path}|${member.name}|${member.role}`;
              } else if (member.role === "그룹장") {
                seatKey = `${section.name}|${group.name}|${member.role}`;
              } else if (member.role === "파트장/센터장") {
                if (member.name && member.name === groupLeaderName) {
                  return;
                }
                seatKey = `${section.name}|${group.name}|${part.name}|${member.role}`;
              } else {
                seatKey = `${team.path}|${member.name}|${member.role}`;
              }
              seatsByRole[member.role].add(seatKey);
            });
          });
        });
      });
    });

    return ROLE_FILTER_ORDER
      .map((role) => ({ role, count: seatsByRole[role].size }))
      .filter((item) => state.role === "all" || item.role === state.role);
  }

  function renderHero() {
    heroMeta.innerHTML = `
      <article class="meta-card">
        <div class="meta-label">데이터 생성 시각</div>
        <div class="meta-value">${escapeHtml(data.meta.generatedAt.replace("T", " "))}</div>
      </article>
    `;
  }

  function renderTabs() {
    const buttons = [
      `<button class="section-tab ${state.activeSection === "all" ? "active" : ""}" data-section="all">전체</button>`,
      ...data.sections.map(
        (section) =>
          `<button class="section-tab ${state.activeSection === section.name ? "active" : ""}" data-section="${escapeHtml(
            section.name
          )}">${escapeHtml(section.name)}</button>`
      ),
    ];
    sectionTabs.innerHTML = buttons.join("");
    sectionTabs.querySelectorAll("[data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeSection = button.dataset.section;
        render();
      });
    });
  }

  function renderKPIs(summary) {
    kpiGrid.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">고유 인원 수</div>
        <div class="kpi-value">${fmt(summary.uniquePeopleCount)}</div>
        <div class="kpi-sub">중복 이름 제거 기준</div>
      </article>
      <article class="kpi-card wide">
        <div class="kpi-label">조직 수</div>
        <div class="kpi-split">
          <div class="kpi-mini">
            <div class="kpi-mini-label">그룹</div>
            <div class="kpi-mini-value">${fmt(summary.groupCount)}</div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">파트</div>
            <div class="kpi-mini-value">${fmt(summary.partCount)}</div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">센터</div>
            <div class="kpi-mini-value">${fmt(summary.centerCount)}</div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">TF</div>
            <div class="kpi-mini-value">${fmt(summary.tfCount)}</div>
          </div>
        </div>
        <div class="kpi-sub">그룹은 이름에 '그룹'이 있는 조직만 집계</div>
      </article>
    `;
  }

  function renderBars(target, rows, alt) {
    const max = Math.max(...rows.map((row) => row.count), 1);
    target.innerHTML = rows
      .map((row) => {
        const ratio = (row.count / max) * 100;
        return `
          <div class="bar-row ${alt ? "clickable" : ""}" ${alt ? `data-role="${escapeHtml(row.role)}"` : ""}>
            <div class="bar-label">${escapeHtml(row.role || row.name)}</div>
            <div class="bar-track">
              <div class="bar-fill ${alt ? "alt" : ""}" style="width:${ratio}%"></div>
            </div>
            <div class="bar-value">${fmt(row.count)}</div>
          </div>
        `;
      })
      .join("");

    if (alt) {
      target.querySelectorAll("[data-role]").forEach((row) => {
        row.addEventListener("click", () => {
          openRoleModal(row.dataset.role);
        });
      });
    }
  }

  function buildRoleRoster(sections, role) {
    const rosterMap = new Map();
    const groupLeaderByGroup = new Map();

    sections.forEach((section) => {
      section.groups.forEach((group) => {
        group.parts.forEach((part) => {
          part.teams.forEach((team) => {
            team.members.forEach((member) => {
              if (member.role === "그룹장") {
                groupLeaderByGroup.set(`${section.name}|${group.name}`, member.name);
              }
            });
          });
        });
      });
    });

    sections.forEach((section) => {
      section.groups.forEach((group) => {
        const groupLeaderName = groupLeaderByGroup.get(`${section.name}|${group.name}`);
        group.parts.forEach((part) => {
          part.teams.forEach((team) => {
            team.members.forEach((member) => {
              if (member.role !== role) {
                return;
              }

              if (member.tags.includes("외부영입")) {
                return;
              }

              if (role === "파트장/센터장" && member.name && member.name === groupLeaderName) {
                return;
              }

              const key =
                role === "그룹장"
                  ? `${section.name}|${group.name}|${member.name}`
                  : `${member.name}|${role}`;

              if (!rosterMap.has(key)) {
                rosterMap.set(key, {
                  name: member.name,
                  rawName: member.rawName,
                  role: member.role,
                  paths: new Set(),
                });
              }
              const scopePath = [section.name, group.name, part.name]
                .filter((value) => value && value !== "미지정")
                .join(" > ");
              rosterMap.get(key).paths.add(scopePath || team.displayName);
            });
          });
        });
      });
    });

    return [...rosterMap.values()]
      .map((item) => ({
        ...item,
        paths: [...item.paths].sort((a, b) => a.localeCompare(b, "ko-KR")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  }

  function openRoleModal(role) {
    const filteredSections = buildFilteredSections();
    const roster = buildRoleRoster(filteredSections, role);
    roleModalTitle.textContent = `${role} 명단`;
    roleModalSummary.textContent = `현재 화면 필터 기준 ${fmt(roster.length)}명`;
    roleModalList.innerHTML = roster
      .map(
        (item) => `
          <article class="modal-item">
            <div class="modal-item-name">${escapeHtml(item.name)}</div>
            <div class="modal-item-meta">${escapeHtml(item.paths.join(" / "))}</div>
          </article>
        `
      )
      .join("");

    if (!roster.length) {
      roleModalList.innerHTML = `<div class="empty-state">현재 필터 조건에 맞는 명단이 없습니다.</div>`;
    }

    roleModal.hidden = false;
  }

  function closeRoleModal() {
    roleModal.hidden = true;
  }

  function groupMembersByRole(members) {
    return ROLE_ORDER
      .map((role) => ({
        role,
        members: members
          .filter((member) => member.role === role)
          .sort((a, b) => a.name.localeCompare(b.name, "ko-KR")),
      }))
      .filter((item) => item.members.length > 0);
  }

  function renderMember(member) {
    const tags = member.tags
      .map((tag) => {
        const className =
          tag === "겸직" ? "shared" : tag === "대행" ? "acting" : "external";
        return `<span class="member-tag ${className}">${escapeHtml(tag)}</span>`;
      })
      .join("");

    return `
      <span class="member-chip">
        <span>${escapeHtml(member.name)}</span>
        ${tags}
      </span>
    `;
  }

  function renderTextChip(text) {
    return `
      <span class="member-chip">
        <span>${escapeHtml(text)}</span>
      </span>
    `;
  }

  function uniqueMembers(members) {
    const seen = new Set();
    return members.filter((member) => {
      const key = `${member.name}|${member.role}`;
      if (!member.name || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function collectGroupMembers(group) {
    return uniqueMembers(
      group.parts.flatMap((part) => part.teams.flatMap((team) => team.members))
    );
  }

  function collectPartMembers(part) {
    return uniqueMembers(part.teams.flatMap((team) => team.members));
  }

  function getLeaderByRole(members, role) {
    return uniqueMembers(members).find((member) => member.role === role) || null;
  }

  function isTfGroup(groupName) {
    return groupName.includes("TF") || groupName.includes("CFT");
  }

  function getWorkingMembers(members, excludedNames = []) {
    const excluded = new Set(excludedNames.filter(Boolean));
    return uniqueMembers(
      members.filter(
        (member) =>
          ["담당디렉터", "시니어매니저", "매니저"].includes(member.role) &&
          !excluded.has(member.name)
      )
    );
  }

  function renderLeaderPill(label, member) {
    if (!member) {
      return "";
    }
    return `
      <div class="leader-pill">
        <span class="leader-label">${escapeHtml(label)}</span>
        <span class="leader-name">${escapeHtml(member.name)}</span>
      </div>
    `;
  }

  function getTfLeader(groupName, groupMembers) {
    const config = getTfConfig(groupName);
    if (!config) {
      return null;
    }
    if (config.leaderName) {
      return { name: config.leaderName };
    }
    if (config.leaderRole) {
      return getLeaderByRole(groupMembers, config.leaderRole);
    }
    return null;
  }

  function buildTfRoleBlocks(groupName, members) {
    const config = getTfConfig(groupName);
    if (!config) {
      return [];
    }

    if (groupName === "IOTA CFT") {
      return [
        {
          role: "참여 조직",
          content: config.organizations.map((name) => renderTextChip(name)).join(""),
        },
      ];
    }

    const grouped = new Map();
    uniqueMembers(members).forEach((member) => {
      const role = config.roleMap?.[member.role] || member.role;
      if (!grouped.has(role)) {
        grouped.set(role, []);
      }
      grouped.get(role).push(member);
    });

    return [...grouped.entries()].map(([role, roleMembers]) => ({
      role,
      content: roleMembers
        .sort((a, b) => a.name.localeCompare(b.name, "ko-KR"))
        .map(renderMember)
        .join(""),
    }));
  }

  function isPartLeaderShared(partLeader, groupLeader, centerLeader) {
    if (!partLeader) {
      return false;
    }
    return partLeader.name === groupLeader?.name || partLeader.name === centerLeader?.name;
  }

  function renderGroupCard(section, group) {
    const groupMembers = collectGroupMembers(group);
    const tfMode = isTfGroup(group.name);
    const tfConfig = getTfConfig(group.name);
    const groupLeader = getLeaderByRole(groupMembers, "그룹장");
    const centerLeader = !groupLeader
      ? getLeaderByRole(groupMembers, "파트장/센터장")
      : null;
    const tfLeader = tfMode ? getTfLeader(group.name, groupMembers) : null;

    return `
      <article class="group-card">
        <div class="group-meta">
          <div>
            <h3>${escapeHtml(group.name)}</h3>
            <div class="leader-row">
              ${
                tfMode
                  ? renderLeaderPill(tfConfig?.leaderLabel || "TF장", tfLeader)
                  : renderLeaderPill(
                      group.name.includes("센터") ? "센터장" : "그룹장",
                      groupLeader || centerLeader
                    )
              }
            </div>
          </div>
          <div class="group-count">
            고유 ${fmt(group.uniquePeopleCount)}
          </div>
        </div>
        ${group.parts
          .map((part) => {
                            const partMembers = collectPartMembers(part);
                            const partLeader = tfMode
                              ? null
                              : getLeaderByRole(partMembers, "파트장/센터장");
                            const sharedPartLeader = isPartLeaderShared(
                              partLeader,
                              groupLeader,
                              centerLeader
                            );
                            const workingMembers = tfMode
                              ? uniqueMembers(partMembers)
                              : getWorkingMembers(partMembers, [
                                  groupLeader?.name,
                                  centerLeader?.name,
                  partLeader?.name,
                ]);
                            const grouped = groupMembersByRole(workingMembers);
                            const memberCount = uniqueMembers(workingMembers).length;
                            const isPlainPart = part.name === "미지정";
                            const summaryTitle = isPlainPart ? group.name : "실무 인원";
                            const pathLabel = [section.name, group.name]
                              .filter(Boolean)
                              .join(" > ");
                            const displayBlocks = tfMode
                              ? buildTfRoleBlocks(group.name, workingMembers)
                              : grouped.map((block) => ({
                                  role: block.role,
                                  content: block.members.map(renderMember).join(""),
                                }));
                            const displayCount =
                              group.name === "IOTA CFT"
                                ? (tfConfig?.organizations?.length || 0)
                                : memberCount;

                            return `
              <section class="part-block ${isPlainPart ? "part-block-plain" : ""}">
                <div class="part-header">
                  ${
                    isPlainPart
                      ? ""
                      : `<div class="part-title">${escapeHtml(normalizeDisplayLabel(part.name))}</div>`
                  }
                                  ${
                                    tfMode || isPlainPart
                                      ? ""
                                      : `<div class="leader-row">${renderLeaderPill(
                                          sharedPartLeader ? "파트장(겸)" : "파트장",
                                          partLeader
                                        )}</div>`
                                  }
                                </div>
                <div class="team-grid">
                  <details class="team-card team-card-collapsible">
                    <summary class="team-summary">
                      <div class="team-summary-copy">
                        ${
                          isPlainPart
                            ? `<h4>${escapeHtml(normalizeDisplayLabel(summaryTitle))}</h4>`
                            : ""
                        }
                        <p class="team-path">${escapeHtml(normalizeDisplayLabel(pathLabel))}</p>
                      </div>
                      <div class="team-summary-meta">
                        <span class="team-summary-count">인원 ${fmt(displayCount)}</span>
                        <span class="team-summary-toggle"></span>
                      </div>
                    </summary>
                    <div class="team-detail">
                      <div class="role-stack">
                        ${displayBlocks
                          .map(
                            (block) => `
                              <div class="role-block">
                                <div class="role-label">${escapeHtml(block.role)}</div>
                                <div class="member-list">
                                  ${block.content}
                                </div>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    </div>
                  </details>
                </div>
              </section>
            `;
          })
          .join("")}
      </article>
    `;
  }

  function renderGroupLayout(section) {
    if (section.name !== "투자+펀딩") {
      return section.groups.map((group) => renderGroupCard(section, group)).join("");
    }

    const stackedNames = new Set(["투자2그룹", "투자3그룹"]);
    const stackedGroups = section.groups.filter((group) => stackedNames.has(group.name));
    const otherGroups = section.groups.filter((group) => !stackedNames.has(group.name));

    const items = [];
    for (const group of otherGroups) {
      items.push(renderGroupCard(section, group));
      if (group.name === "투자1그룹" && stackedGroups.length) {
        items.push(`
          <div class="group-stack-column">
            ${stackedGroups.map((stackedGroup) => renderGroupCard(section, stackedGroup)).join("")}
          </div>
        `);
      }
    }

    return items.join("");
  }

  function renderOrgBoard(sections) {
    if (sections.length === 0) {
      orgBoard.innerHTML = `<div class="empty-state">현재 필터 조건에 맞는 조직 정보가 없습니다.</div>`;
      return;
    }

    orgBoard.innerHTML = sections
      .map(
        (section) => `
          <article class="section-card">
            <div class="section-head">
              <div>
                <h2>${escapeHtml(section.name)}</h2>
                <p class="section-stat">고유 인원 ${fmt(section.uniquePeopleCount)}명</p>
              </div>
            </div>
            <div class="group-grid">
              ${renderGroupLayout(section)}
            </div>
          </article>
        `
      )
      .join("");
  }

  function render() {
    const filteredSections = buildFilteredSections();
    const summary = buildSummary(filteredSections);
    renderTabs();
    renderKPIs(summary);
    renderBars(sectionChart, summary.sectionCounts, false);
    renderBars(roleChart, summary.roleSeatCounts, true);
    renderOrgBoard(filteredSections);
  }

  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  roleFilter.addEventListener("change", (event) => {
    state.role = event.target.value;
    render();
  });

  roleModalClose.addEventListener("click", closeRoleModal);
  roleModal.addEventListener("click", (event) => {
    if (event.target === roleModal) {
      closeRoleModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !roleModal.hidden) {
      closeRoleModal();
    }
  });

  renderHero();
  render();
})();
