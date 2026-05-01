import os
from dotenv import dotenv_values
from supabase import create_client

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

def check_master_data():
    # Check staff
    staff = supabase.table('staff').select('staff_id, name, email').limit(10).execute()
    print(f"Staff Sample ({len(staff.data)}): {staff.data}")
    
    # Check projects
    projects = supabase.table('projects').select('project_id, project_name').limit(10).execute()
    print(f"Projects Sample ({len(projects.data)}): {projects.data}")

    # Check funds
    funds = supabase.table('funds').select('fund_id, fund_name, short_name').limit(10).execute()
    print(f"Funds Sample ({len(funds.data)}): {funds.data}")

if __name__ == "__main__":
    check_master_data()
