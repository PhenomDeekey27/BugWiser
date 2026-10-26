-- Schema verification for BugWiser migrations 001–020.
--
-- Run in the Supabase SQL Editor of the project the APP actually uses
-- (NEXT_PUBLIC_SUPABASE_URL -> https://<ref>.supabase.co).
--
-- Output: one row. `problems = 0` and missing_detail = 'ALL OK' means every
-- table, column and index the migrations create is present. Any other value
-- lists exactly what never ran on THIS database.

with expected_columns(table_name, column_name) as (
  values
    -- 001_analysis_schema
    ('analyses', 'id'),
    ('analyses', 'user_id'),
    ('analyses', 'repository_id'),
    ('analyses', 'repository_full_name'),
    ('analyses', 'repository_owner'),
    ('analyses', 'repository_name'),
    ('analyses', 'issue_number'),
    ('analyses', 'issue_title'),
    ('analyses', 'status'),
    ('analyses', 'current_stage'),
    ('analyses', 'error_message'),
    ('analyses', 'total_files'),
    ('analyses', 'filtered_files'),
    ('analyses', 'fingerprint'),
    ('analyses', 'created_at'),
    ('analyses', 'updated_at'),
    ('analyses', 'completed_at'),
    ('repository_files', 'id'),
    ('repository_files', 'analysis_id'),
    ('repository_files', 'path'),
    ('repository_files', 'file_type'),
    ('repository_files', 'size'),
    ('repository_files', 'sha'),
    ('repository_files', 'language'),
    ('repository_files', 'is_ignored'),
    ('repository_files', 'created_at'),
    ('analysis_artifacts', 'id'),
    ('analysis_artifacts', 'analysis_id'),
    ('analysis_artifacts', 'artifact_type'),
    ('analysis_artifacts', 'data'),
    ('analysis_artifacts', 'created_at'),
    -- 002 / 003 / 006 / 007 / 008 / 010 / 012 / 013 / 018 / 019
    ('analyses', 'ai_provider'),
    ('analyses', 'ai_model'),
    ('analyses', 'ai_tier'),
    ('analyses', 'ai_tokens_input'),
    ('analyses', 'ai_tokens_output'),
    ('analyses', 'ai_duration_ms'),
    ('analyses', 'model_config'),
    ('analyses', 'model_strategy'),
    ('analyses', 'patch_status'),
    ('analyses', 'created_branch'),
    ('analyses', 'commit_sha'),
    ('analyses', 'commit_message'),
    ('analyses', 'changed_files'),
    ('analyses', 'applied_at'),
    ('analyses', 'pull_request_url'),
    ('analyses', 'model_selection'),
    ('analyses', 'github_installation_id'),
    ('analyses', 'idempotency_key'),
    -- 020 public repositories and workspaces
    ('analyses', 'repository_source'),
    ('analyses', 'repository_url'),
    ('analyses', 'repository_branch'),
    ('analyses', 'repository_default_branch'),
    ('analyses', 'repository_commit'),
    ('analyses', 'issue_source'),
    ('analyses', 'issue_url'),
    ('analyses', 'issue_description'),
    ('analyses', 'workspace_status'),
    ('analyses', 'workspace_staged_at'),
    ('analysis_workspace_files', 'id'),
    ('analysis_workspace_files', 'analysis_id'),
    ('analysis_workspace_files', 'path'),
    ('analysis_workspace_files', 'base_commit'),
    ('analysis_workspace_files', 'base_content'),
    ('analysis_workspace_files', 'content'),
    ('analysis_workspace_files', 'diff'),
    ('analysis_workspace_files', 'additions'),
    ('analysis_workspace_files', 'deletions'),
    ('analysis_workspace_files', 'created_at'),
    -- 009 / 015 provider connections
    ('provider_connections', 'id'),
    ('provider_connections', 'user_id'),
    ('provider_connections', 'provider'),
    ('provider_connections', 'encrypted_api_key'),
    ('provider_connections', 'status'),
    ('provider_connections', 'connected_at'),
    ('provider_connections', 'updated_at'),
    ('provider_connections', 'base_url'),
    -- 009 / 006b / 012 model preferences
    ('user_model_preferences', 'id'),
    ('user_model_preferences', 'user_id'),
    ('user_model_preferences', 'provider'),
    ('user_model_preferences', 'model'),
    ('user_model_preferences', 'selection_mode'),
    ('user_model_preferences', 'updated_at'),
    ('user_model_preferences', 'selected_strategy'),
    ('user_model_preferences', 'stage_overrides'),
    -- 011 / 014 model catalog
    ('model_catalog', 'id'),
    ('model_catalog', 'user_id'),
    ('model_catalog', 'provider'),
    ('model_catalog', 'model_id'),
    ('model_catalog', 'display_name'),
    ('model_catalog', 'is_free'),
    ('model_catalog', 'input_price'),
    ('model_catalog', 'output_price'),
    ('model_catalog', 'context_window'),
    ('model_catalog', 'max_output_tokens'),
    ('model_catalog', 'supports_reasoning'),
    ('model_catalog', 'supports_tool_calling'),
    ('model_catalog', 'supports_structured_output'),
    ('model_catalog', 'supports_coding'),
    ('model_catalog', 'supports_vision'),
    ('model_catalog', 'coding_score'),
    ('model_catalog', 'reasoning_score'),
    ('model_catalog', 'speed_score'),
    ('model_catalog', 'long_context_score'),
    ('model_catalog', 'value_score'),
    ('model_catalog', 'overall_score'),
    ('model_catalog', 'recommended_categories'),
    ('model_catalog', 'availability'),
    ('model_catalog', 'source'),
    ('model_catalog', 'provider_metadata'),
    ('model_catalog', 'provider_fingerprint'),
    ('model_catalog', 'last_analyzed_at'),
    ('model_catalog', 'created_at'),
    ('model_catalog', 'updated_at'),
    ('model_catalog', 'price_source'),
    ('model_catalog', 'price_fetched_at'),
    ('model_catalog_meta', 'id'),
    ('model_catalog_meta', 'user_id'),
    ('model_catalog_meta', 'provider_fingerprint'),
    ('model_catalog_meta', 'model_count'),
    ('model_catalog_meta', 'free_model_count'),
    ('model_catalog_meta', 'paid_model_count'),
    ('model_catalog_meta', 'classified_by_ai'),
    ('model_catalog_meta', 'classification_model'),
    ('model_catalog_meta', 'last_analyzed_at'),
    ('model_catalog_meta', 'created_at'),
    ('model_catalog_meta', 'updated_at'),
    ('model_catalog_meta', 'price_source'),
    ('model_catalog_meta', 'price_fetched_at'),
    -- 017 relay jobs
    ('local_relay_jobs', 'id'),
    ('local_relay_jobs', 'user_id'),
    ('local_relay_jobs', 'status'),
    ('local_relay_jobs', 'method'),
    ('local_relay_jobs', 'url'),
    ('local_relay_jobs', 'headers'),
    ('local_relay_jobs', 'body'),
    ('local_relay_jobs', 'response_status'),
    ('local_relay_jobs', 'response_headers'),
    ('local_relay_jobs', 'response_body'),
    ('local_relay_jobs', 'error'),
    ('local_relay_jobs', 'attempts'),
    ('local_relay_jobs', 'created_at'),
    ('local_relay_jobs', 'claimed_at'),
    ('local_relay_jobs', 'completed_at'),
    ('local_relay_jobs', 'expires_at'),
    -- 018 GitHub App
    ('github_identities', 'github_user_id'),
    ('github_identities', 'user_id'),
    ('github_identities', 'login'),
    ('github_identities', 'avatar_url'),
    ('github_identities', 'user_token_enc'),
    ('github_identities', 'user_token_expires_at'),
    ('github_identities', 'created_at'),
    ('github_identities', 'updated_at'),
    ('github_installations', 'installation_id'),
    ('github_installations', 'account_id'),
    ('github_installations', 'account_login'),
    ('github_installations', 'account_type'),
    ('github_installations', 'repository_selection'),
    ('github_installations', 'permissions'),
    ('github_installations', 'suspended_at'),
    ('github_installations', 'html_url'),
    ('github_installations', 'created_at'),
    ('github_installations', 'updated_at'),
    ('github_installation_users', 'installation_id'),
    ('github_installation_users', 'user_id'),
    ('github_installation_users', 'created_at'),
    ('github_installation_repositories', 'installation_id'),
    ('github_installation_repositories', 'repo_id'),
    ('github_installation_repositories', 'full_name'),
    ('github_installation_repositories', 'owner'),
    ('github_installation_repositories', 'name'),
    ('github_installation_repositories', 'private'),
    ('github_installation_repositories', 'default_branch'),
    ('github_installation_repositories', 'html_url'),
    ('github_installation_repositories', 'pushed_at'),
    ('github_installation_repositories', 'updated_at')
),
expected_indexes(index_name) as (
  values
    ('idx_analyses_user_id'),
    ('idx_analyses_status'),
    ('idx_repository_files_analysis_id'),
    ('idx_repository_files_path'),
    ('idx_analysis_artifacts_analysis_id'),
    ('idx_provider_connections_user'),
    ('idx_user_model_preferences_user'),
    ('idx_model_catalog_user'),
    ('idx_model_catalog_user_provider'),
    ('idx_model_catalog_user_score'),
    ('idx_model_catalog_meta_user'),
    ('idx_local_relay_jobs_user_status'),
    ('idx_local_relay_jobs_expires'),
    ('idx_github_identities_user'),
    ('idx_github_installation_users_user'),
    ('idx_github_installation_repositories_full_name'),
    ('idx_github_installation_repositories_installation'),
    ('idx_analyses_github_installation'),
    ('idx_analyses_user_idempotency_key'),
    ('idx_analyses_repository_commit'),
    ('idx_analyses_repository_source'),
    ('idx_analysis_workspace_files_analysis')
),
missing_columns as (
  select e.table_name, e.column_name
  from expected_columns e
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = e.table_name
   and c.column_name = e.column_name
  where c.column_name is null
),
missing_indexes as (
  select i.index_name
  from expected_indexes i
  where not exists (
    select 1
    from pg_indexes p
    where p.schemaname = 'public'
      and p.indexname = i.index_name
  )
),
missing as (
  select 'missing column'::text as kind, m.table_name::text as object, m.column_name::text as detail
  from missing_columns m
  union all
  select 'missing index'::text, m.index_name::text, null::text
  from missing_indexes m
)
select
  (select count(distinct table_name) from expected_columns) as tables_checked,
  (select count(*) from expected_columns) as columns_checked,
  (select count(*) from expected_indexes) as indexes_checked,
  (select count(*) from missing) as problems,
  coalesce(
    (select string_agg(kind || ': ' || object || coalesce('.' || detail, ''), E'\n'
                       order by kind, object, detail)
     from missing),
    'ALL OK - schema matches migrations 001-020'
  ) as missing_detail;
