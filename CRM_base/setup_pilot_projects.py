from pathlib import Path
from supabase import create_client
from env_utils import get_required_supabase_config

BASE_DIR = Path(__file__).resolve().parent

def get_client():
    url, key = get_required_supabase_config()
    return create_client(url, key)

def setup_pilot():
    client = get_client()
    
    # 1. Define Projects
    projects = [
        {
            "project_id": "iota-seoul",
            "project_name": "이오타서울 (IOTA Seoul)",
            "project_type": "Parent Project",
            "status": "active",
            "source_system": "pilot_setup",
            "metadata": {"aliases": ["IOTA Seoul"]}
        },
        {
            "project_id": "iota-427",
            "project_name": "와이디427",
            "parent_project_id": "iota-seoul",
            "project_type": "Child Project",
            "status": "active",
            "source_system": "pilot_setup",
            "metadata": {"aliases": ["IOTA427"]}
        },
        {
            "project_id": "iota-816",
            "project_name": "와이드816",
            "parent_project_id": "iota-seoul",
            "project_type": "Child Project",
            "status": "active",
            "source_system": "pilot_setup",
            "metadata": {"aliases": ["IOTA816", "와이드816"]}
        },
        {
            "project_id": "iota-421f",
            "project_name": "421호펀드",
            "parent_project_id": "iota-seoul",
            "project_type": "Child Project",
            "status": "active",
            "source_system": "pilot_setup",
            "metadata": {"aliases": ["421호"]}
        }
    ]

    print("Upserting pilot projects...")
    for p in projects:
        result = client.table("projects").upsert(p).execute()
        print(f"Registered: {p['project_name']} ({p['project_id']})")

if __name__ == "__main__":
    setup_pilot()
