import pandas as pd
import sys

# Redirect stdout to a file with utf-8 encoding
sys.stdout = open('scratch/detect_results.txt', 'w', encoding='utf-8')

corrupted_strings = [
    '󿡼ºι', 
    'ڻ2Ʈ4',
]

encodings = ['cp949', 'utf-8', 'latin-1', 'cp1252', 'iso-8859-1', 'euc-kr', 'windows-1252', 'windows-1253', 'mac_roman']

for s in corrupted_strings:
    print(f"\nTarget: {repr(s)}")
    for enc1 in encodings:
        try:
            b = s.encode(enc1, errors='replace')
            for enc2 in encodings:
                try:
                    decoded = b.decode(enc2)
                    # Check for Korean keywords in decoded string
                    if any(k in decoded for k in ['부문', '부동산', '투자', '팀', '리얼에셋']):
                        print(f"  Success: {enc1} -> {enc2} => {decoded}")
                except: pass
        except: pass

print("\n--- Deep Fix Test ---")
def deep_fix(s):
    try:
        return s.encode('latin-1').decode('cp949')
    except:
        try:
            return s.encode('iso-8859-1').decode('cp949')
        except:
            return s

for s in corrupted_strings:
    print(f"Deep Fix {repr(s)}: {deep_fix(s)}")
