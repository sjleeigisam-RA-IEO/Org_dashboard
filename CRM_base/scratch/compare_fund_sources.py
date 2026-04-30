from pathlib import Path
import json

import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[1]
ARCHIVE_DIR = BASE_DIR / "_archive"
OUTPUT_JSON = BASE_DIR / "scratch" / "fund_source_comparison.json"
OUTPUT_MD = BASE_DIR / "scratch" / "fund_source_comparison.md"

FILES = {
    "fund_management_20260424": ARCHIVE_DIR / "펀드 관리_20260424.xlsx",
    "aum_all_20251224": ARCHIVE_DIR / "펀드 AUM 관리_20251224_all.xlsx",
    "aum_active_20260112": ARCHIVE_DIR / "펀드 AUM 관리_20260112.xlsx",
}

COLS = {
    "fund_id": "펀드코드",
    "short_name": "약칭",
    "fund_name": "펀드명",
    "status": "운용상태",
    "setup_date": "설정일",
    "maturity_date": "만기일",
    "termination_date": "해지일",
    "aum_include": "AUM합산대상여부",
    "aum_input_date": "AUM\n입력일자",
    "aum": "AUM(원)",
}


def find_col(df, target, startswith=False):
    if startswith:
        matches = [c for c in df.columns if str(c).startswith(target)]
    else:
        matches = [c for c in df.columns if str(c) == target]
    return matches[0] if matches else None


def read_normalized(path):
    df = pd.read_excel(path, header=1)
    out = pd.DataFrame()

    for key, label in COLS.items():
        col = find_col(df, label, startswith=(key == "aum"))
        if col is not None:
            out[key] = df[col]

    out["fund_id"] = out["fund_id"].astype(str).str.strip()
    out = out[out["fund_id"].notna() & (out["fund_id"] != "nan") & (out["fund_id"] != "")]

    for col in ["setup_date", "maturity_date", "termination_date", "aum_input_date"]:
        if col in out:
            out[col] = pd.to_datetime(out[col], errors="coerce")

    if "aum" in out:
        out["aum_num"] = pd.to_numeric(out["aum"], errors="coerce")

    return out


def status_counts(df):
    if "status" not in df:
        return {}
    return df["status"].fillna("(blank)").astype(str).value_counts().to_dict()


def aum_summary(df):
    if "aum_num" not in df:
        return {"nonnull": 0, "positive": 0, "sum": 0, "by_status": {}}

    aum = df["aum_num"]
    by_status = {}
    if "status" in df:
        by_status = (
            df.assign(_aum=aum.fillna(0))
            .groupby("status", dropna=False)["_aum"]
            .sum()
            .astype("int64")
            .to_dict()
        )

    return {
        "nonnull": int(aum.notna().sum()),
        "positive": int((aum.fillna(0) > 0).sum()),
        "sum": int(aum.fillna(0).sum()),
        "by_status": {str(k): int(v) for k, v in by_status.items()},
    }


def date_summary(df, col):
    if col not in df:
        return None
    s = pd.to_datetime(df[col], errors="coerce")
    if not s.notna().any():
        return {"nonnull": 0, "min": None, "max": None}
    return {
        "nonnull": int(s.notna().sum()),
        "min": str(s.min().date()),
        "max": str(s.max().date()),
    }


def main():
    dfs = {name: read_normalized(path) for name, path in FILES.items()}
    ids = {name: set(df["fund_id"]) for name, df in dfs.items()}

    result = {"files": {}, "intersections": {}, "status_mismatches": {}}

    for name, df in dfs.items():
        result["files"][name] = {
            "file": FILES[name].name,
            "rows": len(df),
            "unique_funds": int(df["fund_id"].nunique()),
            "status_counts": status_counts(df),
            "aum_include_counts": df["aum_include"].fillna("(blank)").astype(str).value_counts().to_dict()
            if "aum_include" in df
            else {},
            "aum": aum_summary(df),
            "dates": {
                col: date_summary(df, col)
                for col in ["setup_date", "maturity_date", "termination_date", "aum_input_date"]
                if col in df
            },
        }

    names = list(dfs)
    for i, left in enumerate(names):
        for right in names[i + 1 :]:
            key = f"{left}__{right}"
            result["intersections"][key] = {
                "intersection": len(ids[left] & ids[right]),
                f"only_{left}": len(ids[left] - ids[right]),
                f"only_{right}": len(ids[right] - ids[left]),
                f"sample_only_{left}": sorted(ids[left] - ids[right])[:20],
                f"sample_only_{right}": sorted(ids[right] - ids[left])[:20],
            }

            if "status" in dfs[left] and "status" in dfs[right]:
                merged = (
                    dfs[left][["fund_id", "status"]]
                    .drop_duplicates("fund_id")
                    .merge(
                        dfs[right][["fund_id", "status"]].drop_duplicates("fund_id"),
                        on="fund_id",
                        suffixes=(f"_{left}", f"_{right}"),
                    )
                )
                left_col = f"status_{left}"
                right_col = f"status_{right}"
                diff = merged[merged[left_col].astype(str) != merged[right_col].astype(str)]
                result["status_mismatches"][key] = {
                    "overlap": len(merged),
                    "diff_count": len(diff),
                    "sample": diff.head(30).to_dict("records"),
                }

    OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# 펀드 원천 파일 비교",
        "",
        "## 요약",
        "",
        "| 원천 | 행수 | 고유 펀드 | 상태 분포 | AUM 합계 | AUM 양수 건수 |",
        "|---|---:|---:|---|---:|---:|",
    ]
    for name, info in result["files"].items():
        lines.append(
            f"| {name} | {info['rows']:,} | {info['unique_funds']:,} | "
            f"{info['status_counts']} | {info['aum']['sum']:,} | {info['aum']['positive']:,} |"
        )

    lines.extend(["", "## 교집합/차집합", ""])
    for key, info in result["intersections"].items():
        lines.append(f"- `{key}`: {info}")

    lines.extend(["", "## 상태 불일치", ""])
    for key, info in result["status_mismatches"].items():
        lines.append(f"- `{key}`: overlap {info['overlap']:,}, diff {info['diff_count']:,}")

    lines.extend(
        [
            "",
            "## 실무 해석",
            "",
            "- `펀드 관리` 파일은 전체 펀드 universe와 lifecycle 상태의 총괄 원천으로 보는 것이 적합하다.",
            "- `펀드 AUM 관리_*_all` 파일은 청산 펀드를 포함한 AUM snapshot 원천으로 사용한다.",
            "- 최신 `펀드 AUM 관리` 파일은 운용 펀드 AUM snapshot 원천으로 사용한다.",
            "- 상태 불일치 펀드는 다음 업데이트 파일 수령 후 재검증해야 한다.",
        ]
    )
    OUTPUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote {OUTPUT_MD}")


if __name__ == "__main__":
    main()
