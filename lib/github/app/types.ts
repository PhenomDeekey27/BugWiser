export interface GitHubAppInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    type: 'User' | 'Organization' | string;
    avatar_url?: string;
  };
  repository_selection: 'all' | 'selected' | string;
  access_tokens_url: string;
  repositories_url: string;
  html_url: string;
  permissions: Record<string, string>;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubInstallationToken {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
  repository_selection: 'all' | 'selected' | string;
}

export interface GitHubInstallationRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  pushed_at: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export interface GitHubUserInstallationsResponse {
  total_count: number;
  installations: GitHubAppInstallation[];
}

export interface GitHubInstallationRepositoriesResponse {
  total_count: number;
  repositories: GitHubInstallationRepository[];
}

export interface GitHubOAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GitHubApiUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email?: string | null;
}
