# BugWiser

## 🔗 Links

- **Live Demo:**  https://BugWiser-nine.vercel.app/
- **Source Code:** https://github.com/PhenomDeekey27/BugWiser
- **Demo Video:**  https://drive.google.com/file/d/1P1AcylAB4JAaG7QHiw6dKXRNJWhYIgvd/view?pli=1

**AI-powered GitHub issue investigation — from issue to pull request.**

BugWiser connects to your GitHub account, analyzes a repository issue using a multi-stage AI pipeline, identifies the root cause, generates a code patch, and automatically creates a fix branch with a pull request. Developers get an actionable fix without manually tracing code across the repository.

---

## The Problem

When a developer encounters a GitHub issue, the investigation workflow is slow and manual:

1. Read and understand the issue
2. Search the repository for relevant code
3. Identify which files are involved
4. Trace the root cause through the codebase
5. Collect evidence linking the bug to specific code
6. Design a solution
7. Implement the fix
8. Create a branch
9. Commit the changes
10. Open a pull request

BugWiser automates steps 2 through 10 using AI.

---

## How It Works

```
GitHub OAuth
     ↓
Repository Selection
     ↓
Issue Selection
     ↓
┌─────────────────────────────────────┐
│   BugWiser Analysis Pipeline      │
│                                     │
│   Repository Index & Fingerprint    │
│            ↓                        │
│   Relevant File Discovery           │
│            ↓                        │
│   Root Cause Analysis               │
│            ↓                        │
│   Evidence Extraction               │
│            ↓                        │
│   Solution Generation               │
│            ↓                        │
│   Patch Generation                  │
└─────────────────────────────────────┘
     ↓
Create Fix Branch
     ↓
Apply Patch & Commit
     ↓
Create Pull Request
```

### Step-by-Step

| Step | What Happens |
|------|-------------|
| **GitHub OAuth** | User authenticates via GitHub. BugWiser receives a token with repository read access. |
| **Repository Selection** | BugWiser lists the user's accessible repositories. |
| **Issue Selection** | User picks a GitHub issue to investigate. |
| **Repository Index** | BugWiser fetches the repository file tree, filters irrelevant files, and builds a fingerprint (language, framework, project type). |
| **Relevant File Discovery** | AI identifies which source files are most likely related to the issue, using the issue description and repository structure. |
| **Root Cause Analysis** | AI analyzes the relevant source code and issue context to identify the underlying cause of the bug. |
| **Evidence Extraction** | AI extracts concrete code references — specific files, line ranges, and explanations — that support the root cause. |
| **Solution Generation** | AI proposes an actionable solution with implementation steps, affected files, and risk assessment. |
| **Patch Generation** | AI generates a unified diff patch that implements the proposed solution. |
| **Create Fix Branch** | BugWiser creates a new branch from the repository's default branch. |
| **Apply Patch & Commit** | The generated patch is applied to the fix branch. Each file is fetched, patched, and committed via the GitHub Contents API. |
| **Create Pull Request** | A pull request is automatically created on GitHub, linking the fix branch to the default branch. |

---

## AI Pipeline

BugWiser uses a context-aware, multi-stage AI pipeline. Each stage receives context from previous stages, building toward a complete investigation.

### Stage 1: Relevant File Discovery

- **Input:** Issue title/body, repository file tree, repository fingerprint
- **Output:** Ranked list of relevant source files with relevance scores
- **Storage:** `relevant_files` artifact in `analysis_artifacts` table
- **Fallback:** Deterministic keyword-based pre-filter if AI returns no valid results

### Stage 2: Root Cause Analysis

- **Input:** Issue context, relevant files, source code (truncated to fit context window)
- **Output:** Root cause summary, explanation, confidence score, affected files
- **Storage:** `root_cause` artifact in `analysis_artifacts` table

### Stage 3: Evidence Extraction

- **Input:** Issue context, root cause analysis, source code
- **Output:** Concrete evidence references (file paths, line ranges, explanations)
- **Storage:** `evidence` artifact in `analysis_artifacts` table

### Stage 4: Solution Generation

- **Input:** Issue context, root cause, evidence, source code
- **Output:** Solution summary, implementation steps, affected files, risks, confidence
- **Storage:** `solution` artifact in `analysis_artifacts` table

### Stage 5: Patch Generation

- **Input:** Issue context, root cause, evidence, solution, source code
- **Output:** Unified diff with file paths, hunks, and line-level changes
- **Storage:** `patch` artifact in `analysis_artifacts` table

### Context Budget Management

Each context builder estimates token usage and truncates source code to fit within model context windows. A 70% safety threshold ensures models have room to generate output.

---

## AI Provider Architecture

BugWiser supports multiple AI providers with intelligent fallback. The system tries free models first, then falls back to paid providers if needed.

### Configured Providers

| Provider | Models | Cost | Context Window |
|----------|--------|------|----------------|
| **OpenCode Zen** | mimo-v2.5-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free, and 4 more | Free | 128K |
| **OpenRouter** | DeepSeek V4 Flash, Qwen3 Coder, GLM 5.2, Kimi K2.5, and 14 more | Free | 128K |
| **Chutes** | Qwen3.5-397B-TEE, DeepSeek V4 Flash TEE, Kimi K2.6 TEE | Free | 131K |
| **Z.AI / GLM** | GLM 4.7 Flash, GLM FlashX | Free | 128K |
| **DeepSeek** | deepseek-v4-flash, deepseek-v4-pro | Paid | 131K |
| **Gemini** | gemini-2.5-flash, gemini-3.7-flash | Paid | 1M |

### Model Selection

Models are scored on five dimensions (0-5 scale): coding ability, reasoning, speed, context window, and cost. Each analysis task (root cause, evidence, solution, patch) has different scoring weights, so the optimal model varies by stage.

### Fallback Behavior

1. If Chutes is configured, try Chutes models first for the task
2. Score all configured models by task-specific weights
3. Filter models that can't fit the estimated context
4. Try models in score order (free models prioritized)
5. On failure, classify the error (auth, rate limit, timeout, context too large, etc.)
6. Auth errors throw immediately; other errors trigger fallback to next model

### Environment Variables

All AI provider keys are server-side only (no `NEXT_PUBLIC_` prefix). Set only the providers you want to use — unconfigured providers are automatically skipped.

---

## GitHub Integration

### OAuth Flow

BugWiser uses Supabase's GitHub OAuth provider. The flow:

1. User clicks "Continue with GitHub"
2. Redirected to GitHub OAuth authorization
3. GitHub redirects back to Supabase callback
4. Supabase exchanges code for session
5. Session contains `provider_token` (GitHub access token)
6. Token is used server-side for all GitHub API calls

### Repository Access

- Lists user's accessible repositories via `GET /user/repos`
- Fetches repository file tree via `GET /git/trees/{tree_sha}?recursive=1`
- Retrieves source file contents via `GET /contents/{path}?ref={sha}`
- Fetches issue details and comments via GitHub REST API

### Branch Creation and PR

- Creates a new branch from the default branch HEAD: `BugWiser/fix/issue-{number}-{randomId}`
- Applies patches using the GitHub Contents API (`PUT /contents/{path}`)
- Each file is fetched from the fix branch, patched in-memory, and committed
- A pull request is automatically created via `POST /repos/{owner}/{repo}/pulls`
- The default branch is never directly modified

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, shadcn/ui |
| Language | TypeScript 5 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase GitHub OAuth |
| AI | OpenCode Zen, OpenRouter, Chutes, Z.AI, DeepSeek, Gemini |
| API | GitHub REST API v3 |
| Deployment | Vercel |

---

## Architecture

```
Frontend (React Server/Client Components)
     ↓
API Routes (Next.js App Router)
     ↓
Analysis Orchestrator (lib/analysis/)
     ├── runner.ts          — Initialization
     ├── relevant-files.ts  — File discovery
     ├── root-cause.ts      — Root cause analysis
     ├── evidence.ts        — Evidence extraction
     ├── solution.ts        — Solution generation
     ├── patch.ts           — Patch generation
     └── apply-patch.ts     — Branch/commit/PR creation
     ↓
AI Model Router (lib/ai/model-router/)
     ├── Fallback chain execution
     ├── Error classification
     └── Context budget management
     ↓
AI Providers (lib/ai/providers/)
     ├── OpenCode Zen
     ├── OpenRouter
     ├── Chutes
     ├── Z.AI
     ├── DeepSeek
     └── Gemini
     ↓
GitHub API (lib/github/)
     ├── Repositories, issues, file trees
     └── Branches, commits, pull requests
     ↓
Database (Supabase)
     ├── analyses           — Analysis records
     ├── repository_files   — Indexed file metadata
     └── analysis_artifacts — AI outputs (11 artifact types)
```

### Key API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/analyses` | POST | Create a new analysis |
| `/api/analyses/[id]` | GET | Fetch analysis status |
| `/api/analyses/[id]/run` | POST | Start initialization |
| `/api/analyses/[id]/relevant-files` | POST | Start file discovery |
| `/api/analyses/[id]/root-cause` | POST | Start root cause analysis |
| `/api/analyses/[id]/evidence` | POST | Start evidence extraction |
| `/api/analyses/[id]/solution` | POST | Start solution generation |
| `/api/analyses/[id]/patch` | POST | Start patch generation |
| `/api/analyses/[id]/apply` | POST | Apply patch to GitHub |
| `/api/github/repos` | GET | List user repositories |
| `/api/github/issues` | GET | List repository issues |

---

## Setup

### Prerequisites

- Node.js 18+
- npm
- A Supabase project
- A GitHub OAuth app (configured in Supabase)
- At least one AI provider API key

### Installation

```bash
git clone https://github.com/your-org/BugWiser.git
cd BugWiser
npm install
```

### Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env.local
```

See [`.env.example`](.env.example) for all required variables.

### Database Setup

Run the Supabase migrations in order:

```bash
# If using Supabase CLI
supabase db push

# Or apply migrations manually via the Supabase Dashboard SQL Editor
# Apply files in order: 001 through 008 in supabase/migrations/
```

### Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

See [`.env.example`](.env.example) for the complete template.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `OPENCODE_ZEN_API_KEY` | No | OpenCode Zen API key (primary free provider) |
| `OPENROUTER_API_KEY` | No | OpenRouter API key (free model gateway) |
| `CHUTES_API_KEY` | No | Chutes API key (free testing provider) |
| `ZAI_API_KEY` | No | Z.AI API key (free GLM models) |
| `DEEPSEEK_API_KEY` | No | DeepSeek API key (paid fallback) |
| `GEMINI_API_KEY` | No | Google Gemini API key (emergency fallback) |

At least one AI provider key must be configured. The system automatically skips unconfigured providers.

---

## GitHub OAuth Setup

1. Go to [GitHub Settings > Developer settings > OAuth Apps](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name:** BugWiser
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `https://{your-project-ref}.supabase.co/auth/v1/callback`
4. Register the application
5. Copy the Client ID and Client Secret
6. In your [Supabase Dashboard](https://supabase.com/dashboard), go to Authentication > Providers > GitHub
7. Enable GitHub provider and paste the Client ID and Client Secret
8. BugWiser requests `repo read:user user:email` scopes through Supabase

---

## Database Schema

### Tables

**`analyses`** — Core analysis records
- Tracks status, stage, AI metadata, patch application state
- Row-level security: users can only access their own analyses

**`repository_files`** — Indexed file metadata per analysis
- Stores file paths, sizes, SHAs, languages
- Used by relevant file discovery

**`analysis_artifacts`** — AI pipeline outputs (11 types)
- `issue_context`, `issue_comments`, `repository_tree`, `fingerprint`
- `relevant_files`, `source_files`
- `root_cause`, `evidence`, `solution`, `patch`
- `model_execution`

### Setup

Apply all 8 migrations in `supabase/migrations/` via the Supabase SQL Editor or CLI.

---

## How to Use BugWiser

1. **Sign in with GitHub** — Click "Continue with GitHub" on the landing page
2. **Select a repository** — From your accessible repositories, choose one to analyze
3. **Select an issue** — Pick a GitHub issue to investigate
4. **Start analysis** — BugWiser begins the multi-stage AI pipeline
5. **Review relevant files** — See which files the AI identified as related to the issue
6. **Review root cause** — Understand the underlying cause with confidence score
7. **Review evidence** — See concrete code references supporting the root cause
8. **Review proposed solution** — Read the implementation steps and risk assessment
9. **Review generated patch** — Inspect the unified diff before applying
10. **Create fix branch** — Click "Apply Fix to New Branch" to create a branch, commit changes, and open a PR
11. **Review the Pull Request** — Review the generated PR on GitHub before merging

---

## Patch / Pull Request Flow

BugWiser does not simply output an AI-generated answer. It produces a working pull request on GitHub.

### What Happens

1. AI generates a unified diff for each affected file
2. BugWiser creates a new branch: `repolens/fix/issue-{number}-{randomId}`
3. For each file in the patch:
   - Fetches the current file content from the fix branch
   - Applies the generated hunks to produce the patched content
   - Commits the change via the GitHub Contents API
4. A pull request is automatically created linking the fix branch to the default branch
5. The developer can review the PR on GitHub and merge when satisfied

### Why This Matters

- The fix is real, testable, and reviewable on GitHub
- The developer can run CI/CD checks on the generated PR
- The default branch is never directly modified
- The developer retains full control over what gets merged

---

## Example End-to-End Test

### Test Scenario

Use a repository with a known bug. For example:

- **Repository:** A project with an intentional calculation error
- **Issue:** A bug report describing incorrect behavior
- **Expected:** BugWiser identifies the buggy file, explains the root cause, and generates a patch that fixes the calculation

### Expected Flow

```
GitHub Issue: "Calculator returns wrong total for discount codes"
     ↓
BugWiser Relevant Files: src/services/calculator.ts
     ↓
Root Cause: The discount amount is subtracted from the subtotal
            before tax calculation, but the code subtracts it
            after tax, resulting in an overcharge.
     ↓
Evidence: src/services/calculator.ts lines 45-52 —
          applyDiscount() called after calculateTax()
     ↓
Solution: Move applyDiscount() call before calculateTax()
     ↓
Patch: Reorder function calls in calculateTotal()
     ↓
Branch: repolens/fix/issue-42-a1b2c3
     ↓
Commit: "fix: resolve issue #42"
     ↓
Pull Request: Created on GitHub
```

---

## Project Structure

```
app/
  layout.tsx                    Root layout
  page.tsx                      Landing page
  auth/github/page.tsx          GitHub OAuth page
  auth/callback/route.ts        OAuth callback handler
  dashboard/page.tsx            Dashboard
  analysis/new/page.tsx         New analysis (repo/issue selection)
  analysis/[id]/page.tsx        Investigation workspace
  api/
    analyses/                   Analysis CRUD + pipeline stages
    github/                     GitHub API proxies

components/
  ui/                           shadcn/ui primitives
  layout/                       AppShell, Sidebar, TopBar
  landing/                      Hero, FeatureSteps, ProductPreview
  auth/                         AuthCard
  dashboard/                    StatsGrid, RecentAnalyses
  analysis/                     All pipeline stage UIs
  code/                         CodeViewer, DiffViewer

lib/
  ai/
    config.ts                   Task-to-model mapping
    model-registry.ts           35+ models across 6 providers
    model-router/               Fallback chain with error classification
    providers/                  6 AI provider implementations
    context/                    Stage-specific context builders
    validation/                 AI response parsing + validation
  analysis/                     Pipeline orchestration (10 modules)
  github/                       GitHub API integration (7 modules)
  supabase/                     Client, server, background clients
  mock/                         Mock data for development

supabase/migrations/            8 database migrations
types/index.ts                  TypeScript type definitions
```

---

## Security

- OAuth tokens and API keys are never exposed to the client
- All AI provider keys are server-side only
- Row-level security ensures users can only access their own analyses
- The default branch is never directly modified — only fix branches are created
- Generated patches should be reviewed before merging
- Never commit `.env.local` or any file containing secrets

---

## Known Limitations

- AI-generated analysis may be incorrect for complex or ambiguous issues
- Model availability and rate limits can affect analysis speed
- Issues with insufficient description may produce lower-quality results
- Complex repositories with many large files may exceed context windows
- Generated patches should always be reviewed before merging
- The system requires at least one configured AI provider to function

---

## License

MIT
