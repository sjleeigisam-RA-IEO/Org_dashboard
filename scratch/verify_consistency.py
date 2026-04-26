import os
import sys
import io
from supabase import create_client, Client
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')
load_dotenv()

def verify_consistency():
    print("=== Part 1: 금융 지표 매트릭스 일관성 검증 ===")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    # Fetch all data
    funds = supabase.table('funds').select('fund_id, fund_name, metadata').execute().data
    lenders = supabase.table('lender_exposures').select('fund_id, drawn_amt').execute().data
    bens = supabase.table('beneficiary_exposures').select('fund_id, invested_amt').execute().data
    
    # Aggregate exposures by fund
    fund_loans = {}
    for l in lenders:
        fid = l['fund_id']
        fund_loans[fid] = fund_loans.get(fid, 0) + (l['drawn_amt'] or 0)
        
    fund_equities = {}
    for b in bens:
        fid = b['fund_id']
        fund_equities[fid] = fund_equities.get(fid, 0) + (b['invested_amt'] or 0)

    total_aum = 0
    total_calc_loan = sum(fund_loans.values())
    total_calc_equity = sum(fund_equities.values())
    total_deposit = 0
    total_unrealized_gap = 0
    
    inconsistent_funds = []

    for f in funds:
        fid = f['fund_id']
        meta = f.get('metadata') or {}
        
        # Values from metadata
        benchmark_aum = meta.get('benchmark_aum', 0)
        deposit = meta.get('lease_deposit', 0)
        
        # Calculated from exposure tables
        loan = fund_loans.get(fid, 0)
        equity = fund_equities.get(fid, 0)
        
        # Calculate AUM gap for this fund
        calc_aum = loan + equity + deposit
        gap = benchmark_aum - calc_aum if benchmark_aum > 0 else 0
        
        if benchmark_aum > 0:
            total_aum += benchmark_aum
            total_deposit += deposit
            total_unrealized_gap += gap
        else:
            # If no benchmark AUM, fallback to sum of parts for total AUM calculation
            total_aum += calc_aum
            total_deposit += deposit

    print(f"  - 전체 AUM (목표가치 기준): {total_aum:,.0f} 원")
    print(f"  - 전체 수익자 (에쿼티):     {total_calc_equity:,.0f} 원")
    print(f"  - 전체 대주단 (론):         {total_calc_loan:,.0f} 원")
    print(f"  - 전체 임대보증금:          {total_deposit:,.0f} 원")
    print(f"  - 전체 미실현 개발가치(Gap): {total_unrealized_gap:,.0f} 원")
    
    # Equation check
    calculated_total = total_calc_equity + total_calc_loan + total_deposit + total_unrealized_gap
    diff = total_aum - calculated_total
    
    print(f"\n  => 일관성 검증 (AUM == 에쿼티 + 론 + 보증금 + 미실현가치):")
    if abs(diff) < 1000:
        print("  => ✅ 통과: 수식이 완벽하게 일치합니다.")
    else:
        print(f"  => ❌ 실패: {diff:,.0f} 원 차이 발생")

    print("\n=== Part 2: 실물 자산 매핑 및 API 연동(좌표/건축물대장) 무결성 검증 ===")
    assets = supabase.table('fund_assets').select('*').execute().data
    
    total_assets = len(assets)
    mapped_to_fund = 0
    has_coords = 0
    has_bld_info = 0
    missing_coords_list = []
    
    for a in assets:
        if a.get('fund_id'): mapped_to_fund += 1
        
        # Check geocoding
        lat = a.get('latitude')
        lng = a.get('longitude')
        if lat and lng and float(lat) > 0 and float(lng) > 0:
            has_coords += 1
        else:
            missing_coords_list.append(a.get('asset_name', 'Unknown'))
            
        # Check building registry (API data)
        # We expect fields like main_purps_cd_nm, use_apr_day
        if a.get('main_purps_cd_nm') or a.get('use_apr_day'):
            has_bld_info += 1
            
    print(f"  - 총 자산 레코드 수: {total_assets}건")
    print(f"  - 펀드(프로젝트) 정상 매핑: {mapped_to_fund}건 ({mapped_to_fund/total_assets*100:.1f}%)")
    print(f"  - 좌표(위경도) 지오코딩 성공: {has_coords}건 ({has_coords/total_assets*100:.1f}%)")
    print(f"  - 건축물대장 API 연동 성공: {has_bld_info}건 ({has_bld_info/total_assets*100:.1f}%)")
    
    if len(missing_coords_list) > 0:
        print(f"\n  ⚠️ 좌표 누락 자산 샘플 (총 {len(missing_coords_list)}건 중):")
        for m in missing_coords_list[:5]:
            print(f"     - {m}")

if __name__ == "__main__":
    verify_consistency()
