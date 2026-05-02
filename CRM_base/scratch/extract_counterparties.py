import os
from dotenv import dotenv_values
from supabase import create_client

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

def get_unique_counterparties():
    # Get unique lenders
    lenders = supabase.table('lender_exposures').select('lender_clean').execute()
    unique_lenders = sorted(list(set([r['lender_clean'] for r in lenders.data if r['lender_clean']])))
    
    # Get unique beneficiaries
    beneficiaries = supabase.table('beneficiary_exposures').select('beneficiary_clean').execute()
    unique_beneficiaries = sorted(list(set([r['beneficiary_clean'] for r in beneficiaries.data if r['beneficiary_clean']])))
    
    print(f"Unique Lenders ({len(unique_lenders)}): {unique_lenders[:10]}...")
    print(f"Unique Beneficiaries ({len(unique_beneficiaries)}): {unique_beneficiaries[:10]}...")
    
    # All unique counterparties
    all_cp = sorted(list(set(unique_lenders + unique_beneficiaries)))
    print(f"Total Unique Counterparties: {len(all_cp)}")
    
    # Save to a file for reference
    with open('scratch/unique_counterparties.txt', 'w', encoding='utf-8') as f:
        for cp in all_cp:
            f.write(cp + '\n')

if __name__ == "__main__":
    get_unique_counterparties()
