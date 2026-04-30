# 🚀 CRM Dashboard Integration Handoff Guide

## 1. Project Context
*   **Goal**: Integrate the CRM Portfolio Analysis Dashboard into the `Org_dashboard` unified repository.
*   **Current Status**: 
    *   **Address Standardization**: Completed (493+ assets geocoded to Parcel addresses).
    *   **Asset Classification**: Completed (**100% AUM coverage** achieved).
    *   **UI**: Filter Basket implemented and verified.
*   **Database**: Supabase (`fund_assets`, `funds` tables populated).

## 2. Technical Specs
*   **Backend**: Supabase REST API.
*   **APIs Used**: V-World (Geocoding), Building Ledger (Architecture specs).
*   **Main Logic**: `portfolio-analysis.js` (handles map & chart rendering).

## 3. Directory Structure (Expected)
This dashboard is now located at: `./portfolio-analysis/` (relative to this file).
*   `./portfolio-analysis/index.html`: Entry point.
*   `./portfolio-analysis/js/`: Logic files (`app.js`, `portfolio-analysis.js`, etc.).
*   `./portfolio-analysis/css/`: Styles.

## 4. Next Step: Deployment to GitHub
When resuming, please instruct the AI to:
1.  **Initialize/Link Git**: Link this root directory to `https://github.com/sjleeigisam-RA-IEO/Org_dashboard.git`.
2.  **Verify Relative Paths**: Check if `index.html` correctly points to `./js/` and `./css/` within the subfolder.
3.  **Update Portal Index**: Add a link to `portfolio-analysis/index.html` in the main `Org_dashboard/index.html` (if exists).
4.  **Final Push**: Deploy the consolidated tree to GitHub Pages.

---
**Note to AI**: If you see this file, you are in the middle of a deployment task. The data cleanup is 100% done. Focus on Git integration and path verification.
