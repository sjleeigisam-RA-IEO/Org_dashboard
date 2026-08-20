-- Remove asset-code suffixes from non-physical asset display labels.
-- Apply after relationship search cache has been created.
--
-- Non-physical asset titles should read like "instrument + fund short label".
-- Asset codes stay available in asset_code/provenance fields, but they should
-- not make short numeric dashboard searches noisy.

set statement_timeout = '5min';

update public.asset_master
set
    non_physical_asset_label = nullif(
        btrim(
            regexp_replace(
                non_physical_asset_label,
                ('\s*' || chr(183) || '\s*A[0-9A-Za-z_-]+\s*$'),
                '',
                'i'
            )
        ),
        ''
    ),
    asset_name_cleanup_reason = concat_ws(
        '; ',
        nullif(asset_name_cleanup_reason, ''),
        'removed asset-code suffix from non-physical dashboard label'
    ),
    asset_name_cleaned_at = now()
where non_physical_asset_label ~* ('\s*' || chr(183) || '\s*A[0-9A-Za-z_-]+\s*$');

refresh materialized view public.relationship_index_search_results_cache;
