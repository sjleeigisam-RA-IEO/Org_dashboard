// T5T Dashboard - Main Application
const COLORS = {
  blue: '#284b63', purple: '#4c7091', teal: '#5b7961',
  orange: '#b85c38', rose: '#c98a58', green: '#7a9e7e',
  types: {
    '운용/관리': '#284b63', '신규검토': '#b85c38', '프로젝트': '#5b7961',
    '펀드/투자자': '#c98a58', '리스크/법무': '#3e5a7a', '내부/기타': '#8e95a3'
  },
  heatScale: ['#f6f1e8','#e8dac4','#d88b5d','#b85c38','#8b4022','#5a2612']
};

let dashData = null;
let charts = {};

// Init
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  loadData();

  // Modal Close Event
  document.getElementById('projectModalClose').addEventListener('click', () => {
    document.getElementById('projectModal').hidden = true;
  });
  document.getElementById('projectModal').addEventListener('click', (e) => {
    if(e.target.id === 'projectModal') {
      document.getElementById('projectModal').hidden = true;
    }
  });

  // Sync Button Event
  const btnSync = document.getElementById('btn-sync');
  if (btnSync) {
    btnSync.addEventListener('click', async () => {
      // 로컬 환경인지 확인
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      
      if (isLocal) {
        btnSync.innerHTML = '<span class="icon">⏳</span> 동기화 중...';
        btnSync.disabled = true;
        try {
          const res = await fetch('/api/sync');
          const data = await res.json();
          if (data.status === 'success') {
            await loadData();
            alert('데이터가 최신 상태로 업데이트되었습니다.');
          } else {
            alert('동기화 실패: ' + data.message);
          }
        } catch(e) {
          alert('동기화 중 오류 발생: ' + e.message);
        }
        btnSync.innerHTML = '<span class="icon">🔄</span> 최신 데이터 가져오기';
        btnSync.disabled = false;
      } else {
        // 온라인 배포 환경: Github Actions 페이지로 연결하여 수동 트리거 유도
        const githubUrl = "https://github.com/sjleeigisam-RA-IEO/Org_dashboard/actions/workflows/sync.yml";
        alert('온라인 환경에서는 보안 상 직접 동기화가 제한됩니다.\\n\\n확인을 누르시면 [Github Actions] 페이지로 이동합니다. 우측의 "Run workflow" 버튼을 눌러 데이터를 수동으로 갱신할 수 있습니다.\\n(자동 갱신은 매일 정해진 시간에 알아서 실행됩니다.)');
        window.open(githubUrl, '_blank');
      }
    });
  }
});

function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.view).classList.add('active');
    });
  });
}

async function loadData() {
  try {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const dataUrl = isLocal ? '/api/dashboard' : 'data/dashboard.json';

    const resp = await fetch(dataUrl);
    dashData = await resp.json();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('view-overview').classList.add('active');
    renderOverview();
    renderPulse();
    renderSummary();
    updateSyncInfo();
  } catch (e) {
    document.getElementById('loading').innerHTML =
      `<div style="color:var(--accent-rose)">데이터 로드 실패. 서버를 확인하세요.<br><small>${e.message}</small></div>`;
  }
}

function updateSyncInfo() {
  const meta = dashData.sync_meta;
  if (meta) {
    const d = new Date(meta.synced_at);
    document.getElementById('sync-time').textContent =
      `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} 동기화`;
  }
}

// ===== VIEW 1: OVERVIEW =====
function renderOverview() {
  renderTrendChart();
}

function formatWeek(w) {
  if (!w) return '-';
  const parts = w.split('-');
  return `${parts[1]}/${parts[2]}`;
}

function renderTrendChart() {
  const t = dashData.trend;
  const ctx = document.getElementById('chart-trend').getContext('2d');
  if (charts.trend) charts.trend.destroy();
  
  const datasets = t.task_types.map(tt => ({
    label: tt,
    data: t.series[tt],
    backgroundColor: COLORS.types[tt] || '#6b7280',
    borderRadius: 4,
    borderSkipped: false,
    maxBarThickness: 32,
  }));

  charts.trend = new Chart(ctx, {
    type: 'bar',
    data: { labels: t.weeks.map(formatWeek), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#667085', font: { size: 12, family: 'Pretendard Variable' }, padding: 16, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: { backgroundColor: 'rgba(255, 253, 249, 0.95)', titleColor: '#1f2a37', bodyColor: '#1f2a37', borderColor: 'rgba(31, 42, 55, 0.1)', borderWidth: 1, titleFont: { family: 'Pretendard Variable' }, bodyFont: { family: 'Pretendard Variable' } }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#667085', font: { size: 11, family: 'Pretendard Variable' } } },
        y: { stacked: true, grid: { color: 'rgba(31, 42, 55, 0.06)' }, ticks: { color: '#667085', font: { size: 11, family: 'Pretendard Variable' } } }
      }
    }
  });
}



function openProjectModal(pid, targetWeek = null) {
  let p = dashData.top_projects.find(x => x.id === pid);
  if (!p) p = dashData.pulse.find(x => x.id === pid);
  if (!p) return;

  let logsToShow = p.logs || [];
  if (targetWeek) {
    logsToShow = logsToShow.filter(l => l.week === targetWeek);
    document.getElementById('projectModalTitle').textContent = `${p.name} (${formatWeek(targetWeek)} 주차)`;
  } else {
    document.getElementById('projectModalTitle').textContent = p.name;
  }
  
  const topWriters = (p.top_writers || []).length > 0 ? p.top_writers.join(', ') : '-';
  const countToShow = targetWeek ? logsToShow.length : p.count;
  document.getElementById('projectModalSummary').innerHTML = `주요 작성자: <strong>${topWriters}</strong><br>해당 조건에 총 ${countToShow}회의 T5T 기록이 있습니다.`;

  const listContainer = document.getElementById('projectModalList');
  
  if (logsToShow.length === 0) {
    listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">관련 업무 로그가 없습니다.</div>';
  } else {
    // Group logs by week + writer
    const grouped = {};
    logsToShow.forEach(log => {
      const key = log.week + '|' + log.writer;
      if (!grouped[key]) {
        grouped[key] = { week: log.week, writer: log.writer, logs: [] };
      }
      grouped[key].logs.push(log);
    });

    listContainer.innerHTML = Object.values(grouped).map(group => {
      const weekFmt = formatWeek(group.week);
      
      const detailsHtml = group.logs.map(log => {
        const typeColor = COLORS.types[log.task_type] || COLORS.blue;
        let cleanLogName = (log.log_name || '').trim();
        if (cleanLogName.includes('|')) {
            let parts = cleanLogName.split('|');
            cleanLogName = parts[parts.length - 1].trim();
        }
        
        return `
          <div style="margin-top: 8px; padding-left: 8px; border-left: 2px solid ${typeColor}40;">
            <div class="modal-item-subrole" style="color:${typeColor}; margin-top:0;">[${log.task_type}] ${cleanLogName}</div>
            <div class="modal-item-meta" style="margin-top:2px;">${log.summary || '<i>내용 요약 없음</i>'}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="modal-item" style="flex-direction:column; align-items:stretch; gap:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="modal-item-name" style="font-weight:800; font-size:15px; color:var(--accent-2);">${group.writer}</div>
            <div style="font-size:12px; font-weight:700; color:var(--accent);">${weekFmt}</div>
          </div>
          ${detailsHtml}
        </div>
      `;
    }).join('');
  }

  document.getElementById('projectModal').hidden = false;
}

// ===== VIEW 2: PROJECT PULSE =====
function renderPulse() {
  const weeks = dashData.sorted_weeks;
  const pulse = dashData.pulse;

  // Group weeks by month for the header
  const monthGroups = [];
  let currentMonth = '';
  let currentCount = 0;
  
  const isFirstWeekOfMonth = {};
  weeks.forEach(w => {
    const m = parseInt(w.split('-')[1], 10) + '월';
    if (m !== currentMonth) {
      if (currentMonth) monthGroups.push({ month: currentMonth, count: currentCount });
      currentMonth = m;
      currentCount = 1;
      isFirstWeekOfMonth[w] = true;
    } else {
      currentCount++;
    }
  });
  if (currentMonth) monthGroups.push({ month: currentMonth, count: currentCount });

  // Timeline header
  const headerHtml = `<div class="timeline-row" style="padding-left:240px; padding-bottom: 4px; margin-bottom: 0;">
    ${monthGroups.map(g => `<div style="width:${g.count * 28}px; text-align:center; font-size:12px; font-weight:700; color:var(--muted); border-left:1px solid rgba(31,42,55,0.15); box-sizing:border-box;">${g.month}</div>`).join('')}
  </div>`;

  // Timeline rows
  const rowsHtml = pulse.slice(0, 20).map((p, idx) => {
    const dots = weeks.map(w => {
      const isFirst = isFirstWeekOfMonth[w];
      const borderLeft = isFirst ? 'border-left:1px solid rgba(31,42,55,0.15);' : '';
      
      const count = p.weekly[w] || 0;
      if (count === 0) return `<div style="width:28px;height:36px;display:flex;justify-content:center;align-items:center;flex-shrink:0;box-sizing:border-box;${borderLeft}"><div class="timeline-dot empty" style="cursor:pointer" title="${w} (0건)" onclick="event.stopPropagation(); openProjectModal('${p.id}', '${w}')"></div></div>`;
      
      const weekLogs = (p.logs || []).filter(l => l.week === w);
      
      let logNames = weekLogs.map(l => {
          let text = (l.summary || '').trim();
          if (!text) text = (l.log_name || '').trim();
          if (!text) return '내용없음';
          
          if (text.includes('|')) {
              let parts = text.split('|');
              text = parts[parts.length - 1].trim();
          }
          
          let words = text.split(' ');
          if (words.length > 3) return words.slice(0, 3).join(' ');
          return text;
      });
      const keywords = [...new Set(logNames)].join(' / ');
      
      const intensity = Math.min(count / 5, 1);
      const size = 10 + intensity * 6;
      const alpha = 0.4 + intensity * 0.6;
      return `<div style="width:28px;height:36px;display:flex;justify-content:center;align-items:center;flex-shrink:0;box-sizing:border-box;${borderLeft}"><div class="timeline-dot" style="background:rgba(40, 75, 99,${alpha});width:${size}px;height:${size}px;cursor:pointer" title="${w} (${count}건)\n내용: ${keywords}" onclick="event.stopPropagation(); openProjectModal('${p.id}', '${w}')"></div></div>`;
    }).join('');

    const rankClass = idx < 1 ? 'rank-1' : idx < 2 ? 'rank-2' : idx < 3 ? 'rank-3' : 'rank-n';
    return `<div class="timeline-row clickable-row" style="border-bottom:1px solid rgba(31, 42, 55, 0.06);padding:0;height:36px;cursor:pointer" onclick="openProjectModal('${p.id}')">
      <div style="width:240px;display:flex;align-items:center;gap:8px;flex-shrink:0;height:100%">
        <span class="rank ${rankClass}" style="transform:scale(0.85);margin-left:-4px;flex-shrink:0;">${idx+1}</span>
        <span class="project-name-cell" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-grow:1;" title="${p.name}">${p.name}</span>
        <span style="font-size:12px;font-weight:700;color:var(--accent);flex-shrink:0;width:24px;text-align:right;margin-right:8px;">${p.total_mentions}</span>
      </div>
      <div style="display:flex;align-items:center;height:100%">${dots}</div>
    </div>`;
  }).join('');

  document.getElementById('pulse-timeline').innerHTML = `<div style="min-width:max-content; padding-right: 24px;">` + headerHtml + rowsHtml + `</div>`;

  // Silent projects section removed.

}

// ===== VIEW 3: SUMMARY =====
function renderSummary() {
  const blocks = dashData.summary_blocks || [];
  const container = document.getElementById('summary-content');
  if (!container) return;
  
  if (blocks.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);text-align:center;">요약본 데이터가 없습니다. 노션과 동기화를 확인해주세요.</div>';
    return;
  }

  let html = '';
  blocks.forEach(b => {
    const type = b.type;
    const content = b[type];
    if (!content) return;

    let textHtml = '';
    if (content.rich_text) {
      textHtml = content.rich_text.map(rt => {
        let t = rt.plain_text || '';
        if (rt.annotations) {
          if (rt.annotations.bold) t = `<strong>${t}</strong>`;
          if (rt.annotations.italic) t = `<em>${t}</em>`;
          if (rt.annotations.strikethrough) t = `<del>${t}</del>`;
          if (rt.annotations.underline) t = `<u>${t}</u>`;
          if (rt.annotations.code) t = `<code style="background:rgba(31,42,55,0.05);padding:2px 4px;border-radius:4px;font-family:monospace;font-size:0.9em;color:#e83e8c;">${t}</code>`;
          if (rt.annotations.color && rt.annotations.color !== 'default') {
            const isBg = rt.annotations.color.endsWith('_background');
            const colorName = rt.annotations.color.replace('_background', '');
            t = `<span style="${isBg ? 'background-color' : 'color'}: ${colorName === 'gray' ? '#6b7280' : colorName === 'brown' ? '#b85c38' : colorName === 'orange' ? '#e67e22' : colorName === 'yellow' ? 'rgba(241,196,15,0.2)' : colorName === 'green' ? '#27ae60' : colorName === 'blue' ? '#2980b9' : colorName === 'purple' ? '#8e44ad' : colorName === 'pink' ? '#fd79a8' : colorName === 'red' ? '#e74c3c' : 'inherit'}; ${isBg ? 'padding:2px 4px; border-radius:4px;' : ''}">${t}</span>`;
          }
        }
        if (rt.href) t = `<a href="${rt.href}" target="_blank" style="color:var(--accent);text-decoration:underline;">${t}</a>`;
        return t;
      }).join('');
      // Handle newlines
      textHtml = textHtml.replace(/\n/g, '<br>');
    }

    switch (type) {
      case 'paragraph':
        html += `<p style="margin-bottom:12px;min-height:1em;">${textHtml}</p>`;
        break;
      case 'heading_1':
        html += `<h1 style="font-size:24px;font-weight:800;margin:32px 0 16px;color:var(--text);border-bottom:1px solid var(--line);padding-bottom:8px;">${textHtml}</h1>`;
        break;
      case 'heading_2':
        html += `<h2 style="font-size:20px;font-weight:800;margin:24px 0 12px;color:var(--text);">${textHtml}</h2>`;
        break;
      case 'heading_3':
        html += `<h3 style="font-size:16px;font-weight:800;margin:16px 0 8px;color:var(--text);">${textHtml}</h3>`;
        break;
      case 'bulleted_list_item':
        html += `<ul><li style="margin-bottom:6px;">${textHtml}</li></ul>`;
        break;
      case 'numbered_list_item':
        html += `<ol><li style="margin-bottom:6px;">${textHtml}</li></ol>`;
        break;
      case 'quote':
        html += `<blockquote style="border-left:4px solid var(--accent);padding-left:16px;margin:16px 0;color:var(--muted);font-style:italic;">${textHtml}</blockquote>`;
        break;
      case 'callout':
        html += `<div style="background:rgba(31,42,55,0.03);border:1px solid rgba(31,42,55,0.08);padding:16px;border-radius:var(--radius-sm);margin:16px 0;display:flex;gap:12px;">
                  <div style="font-size:20px;">${content.icon?.emoji || '💡'}</div>
                  <div style="flex-grow:1;">${textHtml}</div>
                </div>`;
        break;
      case 'divider':
        html += `<hr style="border:none;border-top:1px solid var(--line);margin:32px 0;">`;
        break;
      default:
        if (textHtml) html += `<div style="margin-bottom:12px;">${textHtml}</div>`;
        break;
    }
  });

  // Basic cleanup for consecutive ul/ol tags
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  html = html.replace(/<\/ol>\s*<ol>/g, '');
  
  // Wrapper for lists
  html = html.replace(/<ul>/g, '<ul style="margin:4px 0 16px;padding-left:24px;">');
  html = html.replace(/<ol>/g, '<ol style="margin:4px 0 16px;padding-left:24px;">');

  container.innerHTML = html;
}
