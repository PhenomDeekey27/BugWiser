# GitHub OAuth App sign-in and repository access

BugWiser signs users in with a standard **GitHub OAuth App** and reads
repositories with each user's own OAuth access token. There is no GitHub App
installation, no App private key, and no installation token.

```
Sign in
  GET /api/auth/github/start
  → GitHub /login/oauth/authorize (scopes: read:user repo)
  → /api/auth/callback?code=...&state=...
  → exchange code for a user token
  → GET /user (numeric GitHub id = identity key)
  → seal the session cookie
  → only then write users / github_identities (best effort)

Every later request
  → open the sealed cookie (no database, no network)
  → call GitHub with the token inside it
```

## Why the session is a cookie and not a database row

GitHub is the authentication authority. Once the authorization-code exchange
succeeds, GitHub sign-in must not be able to fail because PostgreSQL (a Neon
compute that can be suspended, asleep, or unreachable) is down.

So the session is a single AES-256-GCM sealed cookie:

- **identity** — `user_id`, GitHub numeric id, login, name, avatar, source;
- **credential** — GitHub access token, refresh token, expiry, scopes;
- **persistence state** — whether the `users` row exists yet, plus the retry
  backoff for writing it.

Reading a session performs zero I/O. The cookie is `HttpOnly` and encrypted, so
the token inside is not readable by browser JavaScript and not readable by anyone
who copies the cookie. It is never logged, never returned by an API, and never
written to `localStorage`.

The database write happens **after** the cookie is issued, and a failure there
never invalidates the session. It is retried: the backoff schedule (30s, 60s,
120s … capped at 15 minutes) lives inside the cookie, so it survives a serverless
cold start — there is no in-memory queue to lose. `/api/auth/session` performs the
retry.

While a row does not exist yet, the user id is a `uuidv5` derived from
`BUGWISER_USER_NAMESPACE` and the GitHub numeric id. That makes the id stable
across outages and the upsert idempotent: the same GitHub account can never
produce two `users` rows.

## 1. Create the OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.

| Setting | Value |
| --- | --- |
| Application name | `BugWiser` |
| Homepage URL | `https://bug-wiser.vercel.app` |
| Authorization callback URL | `https://bug-wiser.vercel.app/api/auth/callback` |

A GitHub OAuth App accepts **exactly one** callback URL. To sign in on both
production and localhost, create a second OAuth App for development and register
`http://localhost:3000/api/auth/callback` there.

There are no permissions to configure: an OAuth App's access comes entirely from
the scopes the user approves. BugWiser requests:

| Scope | Used for |
| --- | --- |
| `read:user` | profile (login, name, avatar) for the app shell |
| `repo` | private repositories, issue reads, and the apply-patch write path |

`repo` is a broad grant. BugWiser keeps it because a fix patch has to be pushed
to a branch on a repository the user already has write access to. A read-only
deployment could drop to `public_repo` plus `read:user`, but private-repository
analysis would stop working.

## 2. Environment variables

Set these on the deployment (Vercel → Project → Settings → Environment
Variables). All values are server-only.

| Name | Required | Notes |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | yes | OAuth App client id, 20 alphanumeric characters |
| `GITHUB_CLIENT_SECRET` | yes | OAuth App client secret; never logged |
| `BUGWISER_SESSION_SECRET` | yes | ≥32 chars; HKDF derives the session encryption key from it |
| `NEXT_PUBLIC_APP_URL` | yes | public origin, e.g. `https://bug-wiser.vercel.app` |
| `GITHUB_CALLBACK_URL` | no | overrides the derived `redirect_uri` |
| `BUGWISER_ENCRYPTION_KEY` | yes | encrypts user-supplied provider keys at rest (Models page) |

Aliases, read only when the names above are empty:

| Preferred | Alias | Legacy fallback |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | `GITHUB_OAUTH_CLIENT_ID` | `GITHUB_APP_CLIENT_ID` |
| `GITHUB_CLIENT_SECRET` | `GITHUB_OAUTH_CLIENT_SECRET` | `GITHUB_APP_CLIENT_SECRET` |
| `GITHUB_CALLBACK_URL` | — | `GITHUB_APP_CALLBACK_URL` |

The fallbacks exist so a deployment that created a GitHub App can switch without
renaming variables. **The App's own credentials are not reused**: an OAuth App has
its own client id and secret, and its client id is 20 alphanumeric characters.
`getGitHubOAuthConfigProblem()` rejects a purely numeric id, because that is an
App id pasted by mistake and produces a GitHub error page instead of a consent
screen.

These are now unused and can be deleted: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_PRIVATE_KEY_BASE64`.

Generate the session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Rotating it invalidates every existing session.

## 3. Database migration

Apply `supabase/migrations/022_github_oauth.sql`. It is additive: two CHECK
constraints are replaced with strict supersets of their former values and the
`analyses.repository_source` default becomes `'github'`. No table, column, row,
or policy is dropped.

- `users.identity_source` now also accepts `'github_oauth'` (new sign-ins);
  `'github_app'` stays valid for rows created before the migration.
- `analyses.repository_source` now also accepts `'github'` (new analyses);
  `'installation'` stays valid so historical analyses keep rendering.
- `sessions` and `oauth_transactions` (migration 021) are marked unused. They are
  retained, not dropped, so no historical data is lost.

Rollback: `supabase/rollback/022_github_oauth.sql`.

## 4. Deployment order

1. Create the OAuth App and register the callback URL.
2. Apply migration 022.
3. Add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BUGWISER_SESSION_SECRET`.
4. Deploy.
5. Confirm `/api/health` reports `github_oauth` and the database probe.
6. Sign in, open the dashboard, confirm the repository list loads (public,
   private, and organization repositories).
7. Run one analysis end to end (file discovery → patch) and apply a patch on a
   scratch repository.

## 5. Rollback

1. Restore the previous build and its environment variables.
2. Optionally run `supabase/rollback/022_github_oauth.sql` once no build writes
   `'github_oauth'` or `'github'`.
3. Users who signed in only through the OAuth App sign in again through the old
   build. Their analyses are unaffected: `github_identities` maps the GitHub
   numeric id onto the same `users` UUID.

## 6. Security properties

- Session cookie `bw_session`: `HttpOnly`, `Secure` in production,
  `SameSite=Lax`, 7-day absolute expiry, re-sealed once less than a day remains.
  AES-256-GCM with an HKDF-derived key; any modified byte fails the auth tag.
- An expiring GitHub token shortens the session so the cookie never outlives the
  credential it carries.
- OAuth `state` is a signed, `HttpOnly`, 10-minute `bw_oauth_state` cookie bound
  to the browser that started the flow; a callback whose `state` does not match
  is rejected. No PKCE — GitHub OAuth Apps do not support it.
- The client-supplied GitHub id is never trusted: the numeric id always comes
  from `GET /user` with the exchanged token.
- The client secret never leaves the server. Logs redact token-shaped strings
  and any `Authorization:` header value (`sanitizeGitHubMessage`).
- Cross-site `POST`/`PUT`/`PATCH`/`DELETE` to `/api/*` is rejected by the proxy
  when `Origin` does not match the request host.
- Repository access is decided by `GET /repos/{owner}/{repo}` with the user's
  token. A `404` returns `not_found` ("not available to your GitHub account");
  a `401` returns `401` and forces a fresh authorization. No repository list is
  cached in the database.

Known trade-off: the session is stateless, so logout clears the cookie but a
copied cookie stays valid until it expires. Rotating `BUGWISER_SESSION_SECRET`
revokes every session at once.

## 7. Token expiry and revocation

OAuth Apps issue non-expiring tokens by default, so for most deployments the
credential never expires. Access is revoked by the user at
`https://github.com/settings/connections/applications/<client_id>`
(`githubOAuthManageUrl()` builds this link for the dashboard).

If the OAuth App is configured with expiring user tokens, the response carries a
`refresh_token`. `lib/auth/github-token.ts` refreshes on demand and writes the
rotated credential back into the cookie immediately — GitHub invalidates the old
refresh token, so a dropped write-back would sign the user out on the next
request. A refresh rejected by GitHub renders `reauth_required`; a network error
is a `502`, never a silent sign-out.

## 8. Tests

Unit specs run directly with Node:

```bash
npm test
```

The authentication-relevant specs are:

| Spec | Covers |
| --- | --- |
| `lib/auth/session-token.spec.ts` | seal/open, tampering, expiry, type confusion |
| `lib/auth/signed-cookie.spec.ts` | OAuth state cookie signing and open-redirect rejection |
| `lib/auth/oauth-state-core.spec.ts` | state creation, verification, mismatch handling |
| `lib/auth/identity-core.spec.ts` | numeric-id validation, uuidv5 id derivation, email shape |
| `lib/auth/persistence-core.spec.ts` | retry backoff schedule and due-time |
| `lib/github/oauth/authorize.spec.ts` | authorize URL, scopes, callback encoding |
| `lib/github/oauth/config.spec.ts` | env alias resolution, rejected numeric id |
| `lib/github/oauth/token.spec.ts` | code exchange parsing and error shapes |
| `lib/github/repositories-core.spec.ts` | pagination, access resolution, truncation |
| `lib/github/errors.spec.ts` | 401/403/404/429 mapping, log redaction |

Not covered automatically (needs live credentials): the real GitHub authorization
roundtrip, an organization's private repositories, and the apply-patch write
path. Use the checklist in section 4.

## 9. Troubleshooting

### Sign-in redirects back with `unconfigured`

`GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is missing or the id is numeric.
`getGitHubOAuthConfigProblem()` names the problem without printing the value; it
is also surfaced at `/api/health`.

### GitHub shows "redirect_uri is not associated with this application"

The `redirect_uri` sent to GitHub does not match the App's registered callback.
Either register the exact URL (`https://host/api/auth/callback`), or set
`GITHUB_CALLBACK_URL` to the registered value. A trailing slash or a different
host (www vs apex) is enough to fail.

### GitHub shows its own 404 page on `/login/oauth/authorize`

GitHub answered before BugWiser was contacted, so this is decided by the App
registration — most often a callback URL that belongs to a different deployment.
An anonymous `curl` always redirects to `/login` and does **not** prove the App is
usable: check by signing in with the failing account.

### Dashboard shows "Reconnect GitHub"

The stored credential was rejected by GitHub (`401`) or expired without a refresh
token. The user revokes and re-authorizes from `/api/auth/github/start`. Nothing is
cached server-side to clear.

### Repositories load but an analysis says the repository is unavailable

Repository access is checked per request with the user's token, so a `404` means
GitHub itself denies access: the repository was renamed, deleted, or the user lost
membership. Re-authorize if the user's organization membership changed — the
`repo` scope is re-evaluated on a fresh token.

### A user is signed in but missing from `users`

The database was unavailable during sign-in. The session is valid and the row is
written by a later `/api/auth/session` call on the backoff schedule. Check
`identity_source` and `github_identities` before assuming a provisioning bug.
