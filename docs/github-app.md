# GitHub App authentication and repository access

BugWiser no longer calls GitHub with the Supabase `provider_token`. Sign-in and
repository access now go through a GitHub App:

```
Sign in (GitHub App user authorization)
  → bugwiser session cookie (HttpOnly, signed)
  → Install / update the App on selected repositories
  → setup callback verifies the installation with the user's GitHub token
  → repositories stored per installation
  → every API request resolves an installation token on the server
```

The Supabase GitHub sign-in remains available as a temporary fallback during
rollout (`/auth/callback`). It bridges the Supabase user into the same signed
cookie, so nothing in the app reads `provider_token` anymore.

## 1. Create the GitHub App

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.

| Setting | Value |
| --- | --- |
| Homepage URL | `https://bug-wiser.vercel.app` |
| User authorization callback URL | `https://bug-wiser.vercel.app/api/auth/callback` |
| Setup URL | `https://bug-wiser.vercel.app/api/auth/github/setup` |
| Redirect on update | enabled |
| Request user authorization (OAuth) during installation | enabled |
| Webhook | not required for this flow |

Repository permissions (least privilege — do not widen without a code change
and a review of `assertTokenPermissions` callers):

| Permission | Access | Used for |
| --- | --- | --- |
| Contents | Read and write | repository files, fix branches and commits |
| Issues | Read | issue selection and issue context |
| Metadata | Read | repository lookup (mandatory) |
| Pull requests | Read and write | opening the fix pull request |

No organisation, account, or other permissions are requested.

## 2. Environment variables

Set these on the deployment (Vercel → Project → Settings → Environment
Variables). Values are server-only; none are exposed to browser code.

| Name | Required | Notes |
| --- | --- | --- |
| `GITHUB_APP_ID` | yes | numeric App id |
| `GITHUB_APP_CLIENT_ID` | yes | App client id |
| `GITHUB_APP_CLIENT_SECRET` | yes | App client secret |
| `GITHUB_APP_PRIVATE_KEY` | one of these | full PEM, `\n` escapes accepted; a multi-line value **must be quoted** in `.env*` or only the first line is read |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | one of these | base64 of the PEM (preferred on Vercel and in `.env.local`) |
| `GITHUB_APP_SLUG` | yes | App **slug** only, e.g. `bugwiser-devassistant` |
| `BUGWISER_SESSION_SECRET` | yes | HMAC key for the session cookie, ≥32 chars |
| `NEXT_PUBLIC_APP_URL` | yes | public origin, e.g. `https://bug-wiser.vercel.app` |
| `GITHUB_APP_CALLBACK_URL` | no | overrides the derived callback URL |
| `BUGWISER_ENCRYPTION_KEY` | yes | encrypts stored GitHub user tokens at rest |

### `GITHUB_APP_SLUG` — slug only, never a URL

The install link is built as `https://github.com/apps/<slug>/installations/new`.
Give it the slug (the last segment of the App's public URL), not any GitHub
settings or callback URL:

| Wrong | Right |
| --- | --- |
| `https://github.com/settings/apps/bugwiser-devassistant` | `bugwiser-devassistant` |
| `https://github.com/apps/bugwiser-devassistant` | `bugwiser-devassistant` |
| `apps/bugwiser-devassistant` | `bugwiser-devassistant` |

Values containing `://`, `/`, `\`, `?`, `#`, `@`, `:`, `%`, whitespace, or
consecutive hyphens are rejected by `normalizeGitHubAppSlug()`. When the slug is
missing or invalid, `githubAppInstallUrl()` returns `null`, the dashboard hides
the install button and explains why, and `/api/auth/github/install` redirects
with `reason=slug_missing` or `reason=slug_invalid` instead of sending the user
to a 404 page.

Generate the secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # session secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # encryption key
```

Generate the base64 private key:

```bash
base64 -w0 bugwiser.private-key.pem     # macOS: base64 -i bugwiser.private-key.pem | tr -d '\n'
```

Never commit the `.pem`. Keep it out of the repository and out of build logs.

## 3. Database migration

Apply `supabase/migrations/018_github_app_auth.sql` before enabling the new
sign-in. It is additive:

- new tables `github_identities`, `github_installations`,
  `github_installation_users`, `github_installation_repositories`
- nullable `analyses.github_installation_id`
- `find_auth_user_by_github_id(text)` (service-role only)

It does not touch existing analyses, users, or policies. Existing analyses keep
their `user_id`; a GitHub App login is mapped onto the same `auth.users` UUID
when the GitHub numeric id already belongs to a Supabase user. New users are
created with `github-<id>@accounts.bugwiser.invalid`, which is never matched by
email and can never receive mail.

Rollback: `supabase/rollback/018_github_app_auth.sql`.

## 4. Deployment order

1. Apply migration 018.
2. Add the environment variables (including `BUGWISER_SESSION_SECRET`).
3. Deploy the new build.
4. Sign in with the GitHub App, install it on a test repository, confirm the
   dashboard shows the installation and the repository count.
5. Run one analysis end to end (file discovery → patch) and apply a patch on a
   scratch repository.
6. Keep the Supabase GitHub provider configured until all users have moved. The
   legacy button stays on the sign-in card during this period.

## 5. Rollback

1. Restore the previous build. The legacy Supabase sign-in and `provider_token`
   path are intact in the old build.
2. Optionally run `supabase/rollback/018_github_app_auth.sql` once no build reads
   the new tables.
3. Users signed in only through the GitHub App must sign in through Supabase
   again; their analyses are unaffected because the UUID is unchanged.

## 6. Security properties

- Session cookie: `bw_session`, HttpOnly, `Secure` in production, `SameSite=Lax`,
  7-day expiry, rotated after 24 hours of use. Signed with HMAC-SHA256.
- The cookie never contains a GitHub token, installation token, client secret,
  or private key.
- OAuth uses `state` bound to an HttpOnly cookie plus PKCE (S256).
- Installation association is verified with `/user/installations` using the
  signed-in user's GitHub token; `installation_id` from the setup URL is never
  trusted on its own.
- Installation tokens are cached in process memory only, refreshed 5 minutes
  before expiry, and never persisted.
- Cross-site `POST`/`PUT`/`PATCH`/`DELETE` requests to `/api/*` are rejected by
  the proxy when `Origin` does not match the request host.
- Logs redact token-shaped strings (`sanitizeGitHubMessage`).

Known trade-off: the session is stateless, so logout clears the cookie but an
already-stolen cookie stays valid until its 7-day expiry. Rotating
`BUGWISER_SESSION_SECRET` invalidates every session.

## 7. Tests

Unit specs run directly with Node (no runner configured):

```bash
node lib/auth/signed-cookie.spec.ts
node lib/github/app/config.spec.ts
node lib/github/app/jwt.spec.ts
node lib/github/app/token-cache.spec.ts
node lib/github/app/errors.spec.ts
node lib/github/app/repository-sync.spec.ts
```

Covered: cookie signing, tampering, expiry, type confusion, open-redirect
rejection, config/private-key shape, RS256 App JWT shape/signature, token cache
reuse/refresh/dedup, error sanitisation/rate-limit handling, repository row
mapping and stale-repo removal, and the empty-vs-error repository response.

Not covered by automated tests (requires live credentials): real GitHub OAuth
exchange, installation verification, installation token issuance, and the
apply-patch write path. Verify these manually with the checklist in section 4.

## 8. Troubleshooting

### Dashboard/New Analysis shows no repositories after installing

Look at the server log for the install roundtrip:

```
[github-setup] callback entered ...
[github-setup] pending installation read installation=... action=install
[github-setup] installation ownership verified installation=... account=...
[github-access] repositories synchronized installation=... count=N
[github-setup] installation synchronized installation=... repositories=N
```

If the flow stops at `installation setup failed` with `code=not_configured`,
the private key is not a usable PEM. A common cause is an unquoted multi-line
`GITHUB_APP_PRIVATE_KEY`: the env loader keeps only the first line, so the key
is either missing or a `-----BEGIN CERTIFICATE-----` header. Put the base64 of
the **private key** in `GITHUB_APP_PRIVATE_KEY_BASE64` instead, then restart the
dev server. `getGitHubAppConfigProblem()` reports the exact shape without
printing the value.

A failed sync is returned as a `5xx` with `code` in the JSON body; it is never
rendered as an empty repository list.
