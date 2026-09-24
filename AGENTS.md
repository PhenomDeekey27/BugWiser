# BugWiser — Engineering & UI Source of Truth

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product Purpose

BugWiser is an AI-powered GitHub issue investigation tool. It connects to GitHub, selects a repository and issue, then traces the relevant code, identifies root cause, and generates an actionable patch.

## Application Flow

```
Landing Page
    ↓
GitHub Authentication (/auth/github)
    ↓
Dashboard (/dashboard)
    ↓
New Analysis (/analysis/new)
    ↓
Repository Selection (state in analysis flow)
    ↓
Issue Selection (state in analysis flow)
    ↓
Investigation Workspace (/analysis/[id])
    ↓
Root Cause → Evidence → Solution → Patch
```

### First Iteration Scope (Current)

- Landing Page (/)
- GitHub Authentication (/auth/github)
- Dashboard (/dashboard)
- Investigation Workspace (/analysis/new)

### Future Iterations (Not Yet)

- Analysis history
- Repository details
- Settings
- Separate root-cause/evidence/solution/patch pages
- Billing
- Team management
- Notifications
- Real AI analysis
- Real code patch generation
- Repository mutation/write-back

## UI Architecture

### Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- shadcn/ui (primitives, customized to design system)
- sonner (toast notifications)
- Inter (headings, UI)
- JetBrains Mono (code, technical metadata)

### File Organization

```
app/
    page.tsx                    # Landing Page
    layout.tsx                  # Root layout
    globals.css                 # Design tokens + Tailwind
    auth/
        github/
            page.tsx            # GitHub Auth Page
        callback/
            route.ts            # OAuth callback handler
    dashboard/
        page.tsx                # Dashboard
    analysis/
        new/
            page.tsx            # New Analysis (repo/issue selection)
        [id]/
            page.tsx            # Investigation Workspace
    api/
        github/
            repos/
                route.ts        # GitHub repos API endpoint
            issues/
                route.ts        # GitHub issues API endpoint

components/
    layout/                     # App shell components
        AppShell.tsx
        Sidebar.tsx
        TopBar.tsx
        Logo.tsx
    landing/                    # Landing page components
        Hero.tsx
        ProductPreview.tsx
        FeatureSteps.tsx
        HomepageHeader.tsx
    auth/                       # Auth page components
        AuthCard.tsx
    dashboard/                  # Dashboard components
        DashboardHeader.tsx
        StatsGrid.tsx
        RecentAnalyses.tsx
        WelcomeToast.tsx
    analysis/                   # Investigation workspace components
        AnalysisStepper.tsx
        AnalysisHeader.tsx
        RepositorySelector.tsx
        IssueSelector.tsx
        RelevantFilesPanel.tsx
        RootCausePanel.tsx
        EvidencePanel.tsx
        SolutionPanel.tsx
        PatchViewer.tsx
    code/                       # Code presentation components
        CodeViewer.tsx
        DiffViewer.tsx
    ui/                         # Shared UI primitives (shadcn-based)
        Button.tsx
        Badge.tsx
        Card.tsx
        Input.tsx
        Separator.tsx
        Tooltip.tsx

lib/
    mock/                       # Centralized mock data
        repositories.ts
        issues.ts
        analyses.ts
    supabase/                   # Supabase client configuration
        client.ts               # Browser client
        server.ts               # Server client
    github/                     # GitHub API layer
        client.ts               # API fetch utilities
        users.ts                # User fetching
        repositories.ts         # Repository fetching
        issues.ts               # Issue fetching
    utils.ts                    # Utility functions (cn, etc.)

types/
    index.ts                    # Shared TypeScript types

proxy.ts                        # Next.js 16 middleware (route protection)
```

### Component Size Limit

Every React component must remain below 350–400 lines. If a component exceeds this, split it into smaller components.

## Design System — High-Contrast Glassmorphism with Technical Edge

### Visual Personality

- Command center aesthetic
- Deep technical immersion
- High-density information display
- Professional capability
- Futuristic efficiency
- High-stakes focus

### Style

The style is **High-Contrast Glassmorphism with a Technical Edge**. It utilizes pitch-black voids to eliminate visual noise, punctuated by razor-sharp metallic borders and glowing accent points. The interface leverages translucent layers and backdrop blurs to maintain context while stacking complex data views.

### Avoid

- Generic SaaS dashboard styling
- Cartoon AI graphics
- Chatbot-style UI
- Excessive shadows (use ambient glows instead)
- Oversized typography
- Marketing-heavy layouts inside the application
- Heavy drop shadows (replaced by ambient glows)

## Color Tokens

```css
/* Core Surface */
background: #0b0b0e          /* Pitch Black - base canvas */
surface: #131316             /* Deep charcoal */
surface-dim: #131316
surface-bright: #39393c

/* Container Layers */
surface-container-lowest: #0e0e11
surface-container-low: #1b1b1e
surface-container: #1f1f22
surface-container-high: #2a2a2d
surface-container-highest: #353438

/* Text */
on-surface: #e5e1e6          /* Primary text */
on-surface-variant: #e7bdb2 /* Secondary text - warm peach */

/* Borders */
outline: #ad887e             /* Warm metallic */
outline-variant: #5d4038     /* Subtle border */

/* Primary - Ignition Orange */
primary: #ffb5a0             /* Light orange */
on-primary: #601400          /* Dark text on primary */
primary-container: #ff5625   /* Vibrant orange - main CTA */
on-primary-container: #fff0ec

/* Secondary */
secondary: #ffb4a4
on-secondary: #630e00
secondary-container: #ff5633

/* Tertiary */
tertiary: #c1c6d4            /* Steel blue-gray */
on-tertiary: #2b313b
tertiary-container: #8b919d

/* Error */
error: #ffb4ab
on-error: #690005
error-container: #93000a
on-error-container: #ffdad6
```

### Tonal Layering

- **Level 0 (Base):** `#0b0b0e` — Pitch Black void
- **Level 1 (Cards/Containers):** `rgba(20, 28, 36, 0.75)` with `backdrop-filter: blur(12px)` and 1px solid `#5d4038` border
- **Level 2 (Modals/Popovers):** `rgba(28, 38, 49, 0.9)` with glowing 1px border `rgba(255, 69, 0, 0.4)`

### Ambient Glows

Shadows are replaced by **Ambient Glows**: a soft, 64px-wide radial gradient of the primary accent color placed behind the most critical active element to "lift" it from the black void.

- `glow-primary`: `box-shadow: 0 0 64px rgba(255, 86, 37, 0.15)`
- `glow-primary-sm`: `box-shadow: 0 0 32px rgba(255, 86, 37, 0.1)`

### Gradients

- **Primary Button:** `linear-gradient(135deg, #ff4500, #ff3300)` — Ignition Orange
- **Surface Background:** `linear-gradient(180deg, #131316 0%, #0b0b0e 100%)`

## Typography

- **Inter**: headings, navigation, buttons, labels, descriptions, general UI
- **JetBrains Mono**: file paths, repository names, issue IDs, commit hashes, technical metadata, code, code snippets, status labels

### Type Scale

| Name          | Font          | Size | Weight | Line Height | Letter Spacing |
|---------------|---------------|------|--------|-------------|----------------|
| Display       | Inter         | 48px | 700    | 56px        | -0.02em        |
| Headline MD   | Inter         | 24px | 600    | 32px        | -0.01em        |
| Headline SM   | Inter         | 18px | 600    | 24px        | -              |
| Body Base     | Inter         | 14px | 400    | 20px        | -              |
| Code SM       | JetBrains Mono| 12px | 400    | 18px        | -              |
| Label Caps    | JetBrains Mono| 11px | 700    | 16px        | 0.05em (uppercase) |

Default application body text: 14px Inter.

## Spacing (4px base)

| Token | Value |
|-------|-------|
| xs    | 4px   |
| sm    | 8px   |
| md    | 16px  |
| lg    | 24px  |
| xl    | 32px  |

- Small component internal spacing: 8px
- Related content: 12px
- Major sections: 24px
- Container max width: 1440px

## Border Radius

| Token | Value |
|-------|-------|
| sm    | 2px   |
| default| 4px  |
| md    | 6px   |
| lg    | 8px   |
| xl    | 12px  |
| full  | pill  |

- Buttons & Inputs: 4px radius
- Investigation Cards: 8px radius (rounded-lg)
- Status Pills: Fully rounded (pill-shaped)

## Layout

### Desktop

- Sidebar: 240px (glassmorphic)
- Main content: fluid
- Maximum content width: 1440px
- 12-column grid with 16px gutters

```
┌───────────────┬─────────────────────────────────────┐
│               │                                     │
│   Sidebar     │           Main Workspace            │
│   240px       │           Fluid                     │
│   (glass)     │                                     │
│               │                                     │
└───────────────┴─────────────────────────────────────┘
```

### Tablet

- 8-column grid
- Collapse sidebar to icons or hide behind toggle
- Context panel becomes a drawer
- Preserve workspace usability

### Mobile

- 4-column grid with 16px margins
- Single-column layout
- Collapsible navigation
- Context panel becomes a drawer/sheet
- Code viewer supports horizontal scrolling
- Buttons remain accessible
- No clipped content
- No horizontal page overflow
- Headers above 32px reduced by 20%

## Component Rules

- Use shared components from `components/ui/`
- Use shadcn/ui primitives where useful (Button, Input, Badge, Card, Dialog, Tabs, Tooltip, Separator)
- Do NOT blindly use shadcn components everywhere
- Final visual appearance must follow the BugWiser design system
- Do not duplicate buttons, badges, cards, status indicators, search inputs, code containers, repository rows, issue rows, navigation, or analysis progress indicators
- Cards use glassmorphic background with top-weighted "Status Bar"
- Input fields: dark backgrounds with 1px borders, orange glow on focus
- Technical lists: monospaced font, no background, 1px bottom dividers

## Glassmorphism Utilities

Available in `globals.css`:

- `.glass` — `background: rgba(20, 28, 36, 0.75); backdrop-filter: blur(12px)`
- `.glass-strong` — `background: rgba(28, 38, 49, 0.9); backdrop-filter: blur(16px)`
- `.glass-sidebar` — `background: rgba(20, 28, 36, 0.85); backdrop-filter: blur(12px)`
- `.glow-primary` — `box-shadow: 0 0 64px rgba(255, 86, 37, 0.15)`
- `.glow-primary-sm` — `box-shadow: 0 0 32px rgba(255, 86, 37, 0.1)`
- `.gradient-primary` — `background: linear-gradient(135deg, #ff4500, #ff3300)`
- `.gradient-surface` — `background: linear-gradient(180deg, #131316 0%, #0b0b0e 100%)`

## Accessibility

- Use semantic HTML
- Keyboard navigation
- Visible focus states
- Accessible button labels
- Sufficient color contrast
- ARIA labels where appropriate
- Dialogs/drawers are keyboard accessible
- Code areas are readable
- Status information is not communicated through color alone

## Animation

### Allowed

- Subtle hover transitions
- Button loading state
- Progress transitions
- Small fade/slide transitions
- Copy success feedback
- Pulse animation for active scanning states

### Avoid

- Excessive page animations
- Distracting background animations
- Flashy AI animations

The application should feel fast.

## Toast Notifications

Use `sonner` for toast notifications:

```tsx
import { toast } from 'sonner';

// Success
toast.success('Welcome back! You are now connected to GitHub.');

// Error
toast.error('Something went wrong');

// Info
toast.info('Repository loaded');
```

Toasts should use the glassmorphic style:
```tsx
<Toaster
  position="top-right"
  toastOptions={{
    style: {
      background: 'rgba(28, 38, 49, 0.9)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(93, 64, 56, 0.5)',
      color: '#e5e1e6',
    },
  }}
/>
```

## Coding Conventions

- TypeScript with strict typing
- Reusable React components
- Clear props interfaces/types
- Server/client boundaries intentional
- Semantic naming
- Small components (max 350–400 lines)
- No `any` unless unavoidable
- No giant components
- No duplicated markup or styling
- No unnecessary abstraction
- No premature architecture
- No unnecessary dependencies

## Large File Writing Rules

When creating or modifying a source file, follow these guidelines:

- Write files in manageable chunks rather than producing one huge write operation.
- Prefer incremental edits/patches over rewriting an entire large file.
- Keep each individual write operation reasonably small (around 100–150 lines when practical).
- For files that require more content, continue with multiple sequential writes/edits.
- Never split code merely to satisfy a write-size limit — split only when it improves clarity or maintainability.
- Preserve existing code and behavior unless the task explicitly requires a change.
- If a file is large but logically cohesive, it is acceptable to write it in one go; split only when the file contains distinct responsibilities that would benefit from separation.

## Mock Data

Use centralized mock data in `lib/mock/`. Do NOT scatter mock objects throughout components. Mock data should resemble real GitHub repositories and issues. Keep mock data clearly separated from future API/database code.

## State Design

Create UI state models that map to backend analysis stages:

### Analysis Status

- `idle`
- `indexing`
- `analyzing`
- `completed`
- `failed`

### Analysis Stages

- `REPOSITORY`
- `ISSUE`
- `RELEVANT_FILES`
- `ROOT_CAUSE`
- `EVIDENCE`
- `SOLUTION`
- `PATCH`

Keep the analysis UI driven by structured state so it can later consume backend events.

## GitHub OAuth Architecture

The flow:

```
User → Continue with GitHub → GitHub OAuth → Authorization → Callback → Session → Dashboard
```

- GitHub authorization/token handling must remain server-side
- Do NOT expose GitHub OAuth secrets or access tokens in client-side code
- Create correct buttons, routes, loading states, error states, and callback boundaries
- Do NOT pretend OAuth is already working if it is not implemented

## Supabase Direction

The project should be architected so Supabase can be used as the application database/backend infrastructure. Expected future data model:

- users
- repositories
- repository_indexes
- repository_files
- issues
- analyses
- analysis_stages
- evidence
- solutions
- patches

Do NOT implement the full database layer during this first UI iteration. Keep components ready to consume server/database data later.

## Dependencies

- Prefer lightweight dependencies
- Do not introduce large frameworks or unnecessary libraries
- Do not modify unrelated application code
