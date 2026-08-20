import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent


def env_path():
    root_env = ROOT_DIR / ".env"
    if root_env.exists():
        return root_env
    return BASE_DIR / ".env"


def load_dashboard_env():
    values = dotenv_values(env_path())
    values.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return values


def load_dashboard_dotenv():
    return load_dotenv(env_path())


def get_required_supabase_config():
    cfg = load_dashboard_env()
    url = cfg.get("SUPABASE_URL")
    key = cfg.get("SUPABASE_KEY") or cfg.get("SUPABASE_SERVICE_ROLE_KEY") or cfg.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError(f"SUPABASE_URL and SUPABASE_KEY must be set in {env_path()}")
    return url, key
