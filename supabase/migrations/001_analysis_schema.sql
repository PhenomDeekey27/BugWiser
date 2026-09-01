-- BugWiser Analysis Schema
-- Run this in your Supabase SQL Editor to create the required tables.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Analysis records
CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'initializing', 'indexing', 'ready_for_analysis', 'failed', 'completed')),
  current_stage TEXT NOT NULL DEFAULT 'issue_context'
    CHECK (current_stage IN ('issue_context', 'issue_comments', 'repository_tree', 'file_filtering', 'repository_fingerprint', 'ready')),
  error_message TEXT,
  total_files INTEGER DEFAULT 0,
  filtered_files INTEGER DEFAULT 0,
  fingerprint JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Repository file metadata
CREATE TABLE IF NOT EXISTS repository_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'file',
  size INTEGER DEFAULT 0,
  sha TEXT,
  language TEXT,
  is_ignored BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Issue context artifacts
CREATE TABLE IF NOT EXISTS analysis_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL
    CHECK (artifact_type IN ('issue_context', 'issue_comments', 'repository_tree', 'fingerprint')),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX IF NOT EXISTS idx_repository_files_analysis_id ON repository_files(analysis_id);
CREATE INDEX IF NOT EXISTS idx_repository_files_path ON repository_files(analysis_id, path);
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_analysis_id ON analysis_artifacts(analysis_id);

-- Row Level Security
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE repository_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_artifacts ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own data
CREATE POLICY "Users can view their own analyses"
  ON analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own analyses"
  ON analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own analyses"
  ON analyses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own analyses"
  ON analyses FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own repository files"
  ON repository_files FOR SELECT
  USING (
    analysis_id IN (
      SELECT id FROM analyses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own repository files"
  ON repository_files FOR INSERT
  WITH CHECK (
    analysis_id IN (
      SELECT id FROM analyses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own repository files"
  ON repository_files FOR DELETE
  USING (
    analysis_id IN (
      SELECT id FROM analyses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view their own analysis artifacts"
  ON analysis_artifacts FOR SELECT
  USING (
    analysis_id IN (
      SELECT id FROM analyses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own analysis artifacts"
  ON analysis_artifacts FOR INSERT
  WITH CHECK (
    analysis_id IN (
      SELECT id FROM analyses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own analysis artifacts"
  ON analysis_artifacts FOR DELETE
  USING (
    analysis_id IN (
      SELECT id FROM analyses WHERE user_id = auth.uid()
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_analyses_updated_at
  BEFORE UPDATE ON analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
