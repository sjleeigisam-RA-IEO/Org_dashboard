"""
T5T Dashboard - Web Server
로컬 JSON 캐시를 읽어 API로 제공하고 대시보드 HTML 서빙
"""
import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime
from collections import defaultdict
import re

sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
STATIC_DIR = os.path.dirname(__file__)
PORT = 8050


def load_data(name):
    filepath = os.path.join(DATA_DIR, f"{name}.json")
    if not os.path.exists(filepath):
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_week_key(wk):
    """주차키를 정규화해서 종료일 기준으로 통일"""
    if not wk:
        return None
    # Handle "2026-03-16~2026-03-23" format
    if "~" in wk:
        return wk.split("~")[1].strip()
    # Handle "2026-W03" format -> approximate
    m = re.match(r"(\d{4})-W(\d{2})", wk)
    if m:
        year, week = int(m.group(1)), int(m.group(2))
        from datetime import timedelta
        jan1 = datetime(year, 1, 1)
        d = jan1 + timedelta(weeks=week-1)
        # Find next Sunday
        d += timedelta(days=(6 - d.weekday()))
        return d.strftime("%Y-%m-%d")
    # Handle plain date "2026-03-16"
    if re.match(r"\d{4}-\d{2}-\d{2}", wk):
        return wk
    return wk


def compute_dashboard_data():
    """대시보드에 필요한 모든 집계 데이터를 계산"""
    t5t = load_data("t5t_log")
    pm = load_data("project_mission")
    proj_master = load_data("project_master")
    staff = load_data("staff_master")
    
    # Build staff lookup
    staff_lookup = {}
    for s in staff:
        staff_lookup[s["_id"]] = s.get("이름", "Unknown")

    # Build PM lookup from relation_map (resolved page titles)
    relation_map = {}
    rmap_path = os.path.join(DATA_DIR, "relation_map.json")
    if os.path.exists(rmap_path):
        with open(rmap_path, "r", encoding="utf-8") as f:
            relation_map = json.load(f)
    
    # Also build direct PM lookup and director lookup
    pm_lookup = {}
    pm_directors = {}
    for p in pm:
        pid = p["_id"]
        pm_lookup[pid] = p.get("Project & Mission 이름", "Unknown")
        dir_ids = p.get("Director", []) or []
        pm_directors[pid] = [staff_lookup.get(did, "Unknown") for did in dir_ids if did]
    
    # Merge: relation_map takes priority, filter out "Untitled"
    project_names_global = {}
    for rid, name in relation_map.items():
        if name and name != "Untitled":
            project_names_global[rid] = name
    for pid, name in pm_lookup.items():
        if pid not in project_names_global and name != "Unknown":
            project_names_global[pid] = name
    
    # Build project master lookup
    proj_lookup = {}
    for p in proj_master:
        proj_lookup[p["_id"]] = p.get("프로젝트명", "Unknown")
    
    # --- KPI ---
    total_logs = len(t5t)
    
    # Normalize weeks
    weeks_set = set()
    for entry in t5t:
        nw = normalize_week_key(entry.get("주차키", ""))
        if nw:
            weeks_set.add(nw)
    sorted_weeks = sorted(weeks_set)
    
    # Latest week
    latest_week = sorted_weeks[-1] if sorted_weeks else None
    latest_week_logs = [e for e in t5t if normalize_week_key(e.get("주차키", "")) == latest_week]
    
    # Match rate
    matched = sum(1 for e in t5t if e.get("매칭 상태") in ["Project & Mission 매칭", "신규 프로젝트 매칭"])
    match_rate = round(matched / total_logs * 100, 1) if total_logs > 0 else 0
    
    # New review ratio
    new_review = sum(1 for e in t5t if e.get("업무유형") == "신규검토")
    new_review_rate = round(new_review / total_logs * 100, 1) if total_logs > 0 else 0
    
    # Manual check needed
    manual_check = sum(1 for e in t5t if e.get("수동 확인 필요", False))
    
    # Unmatched count
    unmatched = sum(1 for e in t5t if e.get("매칭 상태") == "미매칭")
    
    kpi = {
        "total_logs": total_logs,
        "latest_week": latest_week,
        "latest_week_count": len(latest_week_logs),
        "match_rate": match_rate,
        "new_review_rate": new_review_rate,
        "manual_check_needed": manual_check,
        "unmatched_count": unmatched,
        "total_weeks": len(sorted_weeks),
        "unique_writers": len(set(e.get("작성자", "") for e in t5t if e.get("작성자"))),
    }
    
    # --- 업무유형 트렌드 (주차별 스택) ---
    task_type_by_week = defaultdict(lambda: defaultdict(int))
    for entry in t5t:
        nw = normalize_week_key(entry.get("주차키", ""))
        tt = entry.get("업무유형", "기타") or "기타"
        if nw:
            task_type_by_week[nw][tt] += 1
    
    task_types_list = ["운용/관리", "신규검토", "프로젝트", "펀드/투자자", "리스크/법무", "내부/기타"]
    trend_data = {
        "weeks": sorted_weeks,
        "task_types": task_types_list,
        "series": {}
    }
    for tt in task_types_list:
        trend_data["series"][tt] = [task_type_by_week[w].get(tt, 0) for w in sorted_weeks]
    
    # --- 라인별 히트맵 ---
    lines_list = sorted(set(e.get("라인", "Unknown") or "Unknown" for e in t5t))
    heatmap = {
        "weeks": sorted_weeks,
        "lines": lines_list,
        "data": []
    }
    line_week_counts = defaultdict(lambda: defaultdict(int))
    for entry in t5t:
        nw = normalize_week_key(entry.get("주차키", ""))
        line = entry.get("라인", "Unknown") or "Unknown"
        if nw:
            line_week_counts[line][nw] += 1
    
    for li, line in enumerate(lines_list):
        for wi, week in enumerate(sorted_weeks):
            count = line_week_counts[line].get(week, 0)
            heatmap["data"].append({"x": wi, "y": li, "v": count})
    
    # --- 라인별 총계 ---
    line_totals = defaultdict(int)
    for entry in t5t:
        line = entry.get("라인", "Unknown") or "Unknown"
        line_totals[line] += 1
    line_summary = [{"line": k, "count": v} for k, v in sorted(line_totals.items(), key=lambda x: -x[1])]
    
    # --- Project Pulse: 프로젝트별 타임라인 ---
    project_timeline = defaultdict(lambda: defaultdict(list))
    for entry in t5t:
        nw = normalize_week_key(entry.get("주차키", ""))
        pm_rels = entry.get("Project & Mission", []) or []
        writer = entry.get("작성자", "Unknown")
        task_type = entry.get("업무유형", "기타")
        summary = entry.get("원문 요약", "")
        log_name = entry.get("업무 로그명", "")
        for pm_id in pm_rels:
            if nw:
                project_timeline[pm_id][nw].append({
                    "writer": writer,
                    "task_type": task_type,
                    "summary": summary,
                    "log_name": log_name,
                    "line": entry.get("라인", "Unknown"),
                })
    
    pulse_data = []
    for pid, weeks_data in project_timeline.items():
        pname = project_names_global.get(pid, "Unknown")
        total = sum(len(v) for v in weeks_data.values())
        writers_set = set()
        lines_set = set()
        weekly = {}
        for w, entries in weeks_data.items():
            weekly[w] = len(entries)
            for e in entries:
                writers_set.add(e["writer"])
                lines_set.add(e["line"])
        last_activity = max(weeks_data.keys()) if weeks_data else None
        
        # Gather all logs for this project
        all_logs = []
        writer_counts = defaultdict(int)
        for w, entries in weeks_data.items():
            for e in entries:
                log_with_week = dict(e)
                log_with_week["week"] = w
                all_logs.append(log_with_week)
                writer_counts[e["writer"]] += 1
                
        all_logs.sort(key=lambda x: x["week"], reverse=True)
        top_writers = [w for w, c in sorted(writer_counts.items(), key=lambda item: -item[1])][:4]
        
        pulse_data.append({
            "id": pid,
            "name": pname,
            "total_mentions": total,
            "unique_writers": len(writers_set),
            "writers": list(writers_set),
            "top_writers": top_writers,
            "lines": list(lines_set),
            "weekly": weekly,
            "last_activity": last_activity,
            "logs": all_logs
        })
    
    pulse_data.sort(key=lambda x: -x["total_mentions"])
    
    # --- 주요 프로젝트 (T5T 언급 빈도) ---
    project_mentions = defaultdict(int)
    for entry in t5t:
        pm_rels = entry.get("Project & Mission", []) or []
        for pm_id in pm_rels:
            project_mentions[pm_id] += 1
    
    top_projects = sorted(project_mentions.items(), key=lambda x: -x[1])[:20]
    
    top_projects_data = []
    for pid, cnt in top_projects:
        # Find corresponding pulse data for logs and top_writers
        p_pulse = next((p for p in pulse_data if p["id"] == pid), None)
        top_projects_data.append({
            "id": pid, 
            "name": project_names_global.get(pid, "Unknown"), 
            "count": cnt,
            "top_writers": p_pulse["top_writers"] if p_pulse else [],
            "logs": p_pulse["logs"] if p_pulse else []
        })
    
    # --- 작성자별 통계 ---
    writer_stats = defaultdict(lambda: {"count": 0, "projects": set(), "task_types": defaultdict(int), "lines": set()})
    for entry in t5t:
        writer = entry.get("작성자", "Unknown")
        ws = writer_stats[writer]
        ws["count"] += 1
        ws["lines"].add(entry.get("라인", "Unknown"))
        tt = entry.get("업무유형", "기타") or "기타"
        ws["task_types"][tt] += 1
        for pm_id in (entry.get("Project & Mission", []) or []):
            ws["projects"].add(pm_id)
    
    writer_summary = []
    for writer, stats in writer_stats.items():
        writer_summary.append({
            "name": writer,
            "count": stats["count"],
            "project_count": len(stats["projects"]),
            "line": list(stats["lines"])[0] if stats["lines"] else "Unknown",
            "task_types": dict(stats["task_types"]),
        })
    writer_summary.sort(key=lambda x: -x["count"])
    
    # --- 매칭 상태 분포 ---
    match_dist = defaultdict(int)
    for entry in t5t:
        ms = entry.get("매칭 상태", "Unknown") or "Unknown"
        match_dist[ms] += 1
        
    # --- 요약본 블록 ---
    summary_blocks = []
    summary_path = os.path.join(DATA_DIR, "summary_blocks.json")
    if os.path.exists(summary_path):
        with open(summary_path, "r", encoding="utf-8") as f:
            summary_blocks = json.load(f)
    
    return {
        "kpi": kpi,
        "trend": trend_data,
        "heatmap": heatmap,
        "line_summary": line_summary,
        "top_projects": top_projects_data,
        "pulse": pulse_data[:30],  # Top 30
        "writer_summary": writer_summary,
        "match_distribution": dict(match_dist),
        "sorted_weeks": sorted_weeks,
        "summary_blocks": summary_blocks,
        "sync_meta": load_sync_meta(),
    }


def load_sync_meta():
    filepath = os.path.join(DATA_DIR, "_sync_meta.json")
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


class DashboardHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == "/api/dashboard":
            self.send_json_response(compute_dashboard_data())
        elif parsed.path == "/api/sync-meta":
            self.send_json_response(load_sync_meta())
        elif parsed.path == "/api/sync":
            try:
                import subprocess
                subprocess.run([sys.executable, "sync_notion.py"], check=True)
                self.send_json_response({"status": "success"})
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)})
        elif parsed.path == "/" or parsed.path == "/index.html":
            self.serve_file("index.html", "text/html")
        elif parsed.path.endswith(".css"):
            self.serve_file(parsed.path.lstrip("/"), "text/css")
        elif parsed.path.endswith(".js"):
            self.serve_file(parsed.path.lstrip("/"), "application/javascript")
        else:
            self.send_error(404)
    
    def send_json_response(self, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
    
    def serve_file(self, filename, content_type):
        filepath = os.path.join(STATIC_DIR, filename)
        if not os.path.exists(filepath):
            self.send_error(404)
            return
        with open(filepath, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)
    
    def log_message(self, format, *args):
        # Suppress request logs except errors
        if args and "404" not in str(args[0]):
            return


def main():
    if len(sys.argv) > 1 and "build" in sys.argv[1]:
        print("Building static dashboard.json...")
        data = compute_dashboard_data()
        out_path = os.path.join(DATA_DIR, "dashboard.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Build complete: {out_path}")
        return

    server = HTTPServer(("0.0.0.0", PORT), DashboardHandler)
    print(f"T5T Dashboard running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
