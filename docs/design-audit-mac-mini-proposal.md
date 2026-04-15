# Design System Audit — Mac Mini Architecture Proposal

## Context

We built a Design System Audit tool inside Feature Forge (our internal feature orchestration platform). It works like Uber's uSpec — scans a Figma design system, cross-references components against actual iOS (SwiftUI) and Android (Kotlin/Compose) code, identifies gaps, auto-generates specs using Claude AI, and creates Linear tickets for missing specs.

We have a Mac Mini that runs 24/7 and already hosts:
- **Feature Forge** server (Express.js on port 3000, exposed via Cloudflare tunnel)
- **Cyrus** — our AI coding agent that picks up Linear tasks and implements them autonomously
- All our repos are cloned on the Mac Mini (Cyrus works on them)
- Cyrus uses **git worktrees** for each task so multiple tasks can run in parallel without conflicting

## The Problem

The Design Audit scanner needs to read the latest code from our iOS and Android repos to cross-reference against Figma. But Cyrus is actively working on those repos — creating worktrees, committing, pushing, rebasing. We need a scanning approach that:

1. **Never interferes with Cyrus** — no shared git locks, no working tree conflicts
2. **Always reads the latest main branch code** — not whatever feature branch Cyrus is on
3. **Works when accessed remotely** — we access Feature Forge from our browsers, not from the Mac Mini directly
4. **Is fast** — scanning should take seconds, not minutes

## What We Built

We implemented a **bare clone** approach. The scanner maintains its own separate bare git repositories in `~/.feature-forge-scanner/` that are completely isolated from Cyrus's repos:

```
Mac Mini
├── Cyrus's repos (scanner never touches these)
│   ├── ios-app/           + worktrees for each Linear task
│   └── android-app/       + worktrees for each Linear task
│
└── ~/.feature-forge-scanner/  (Cyrus never touches these)
    ├── ios-app.git/        ← bare clone, no working tree
    └── android-app.git/    ← bare clone, no working tree
```

When you click "Scan":
1. `git fetch origin` on the bare clone (downloads latest, ~1 second)
2. `git show origin/main:path/to/file.swift` to read files (from git objects, not disk)
3. Parse SwiftUI Views and Kotlin Composables with regex
4. Cross-reference against Figma components

We also have a **GitHub API fallback** — if no local repos exist, it fetches files directly from GitHub via their REST API.

## What We Want Your Input On

Given that you have access to this Mac Mini and understand the full setup, we want your assessment on:

### 1. Architecture Validation
- Is the bare clone approach the right call for isolation from Cyrus?
- Are there edge cases we're missing? (e.g., repo renames, force pushes, large binary files)
- Should the bare clones be created at server startup or lazily on first scan?

### 2. Scaling & Performance
- We have ~15 repos in our monorepo. Should the scanner pre-clone all of them, or only iOS/Android?
- For large repos (50k+ files), should we use sparse checkout or shallow clones to reduce fetch time?
- Should we cache scan results (e.g., only re-scan if the remote HEAD changed since last scan)?

### 3. Integration with Cyrus
- Cyrus creates Linear tickets when it finds issues. The Design Audit also creates Linear tickets for missing specs. Should these be coordinated to avoid duplicates?
- When the audit generates a spec and creates a Linear ticket, should Cyrus auto-pick it up and implement the component?
- Could the audit run automatically after Cyrus merges a PR, to verify the design system coverage improved?

### 4. Scanning Depth
Currently we scan for:
- **iOS**: `struct Foo: View` (SwiftUI), `class Foo: UIView` (UIKit), `@State/@Binding` props
- **Android**: `@Composable fun Foo(...)` (Compose), `class Foo: View` (traditional), XML layout custom views

Should we also scan:
- Design tokens (colors, typography, spacing constants)?
- Storybook/preview files?
- Test coverage for design system components?
- Accessibility modifiers (.accessibilityLabel, contentDescription)?

### 5. Automation
- Should the audit run on a schedule (e.g., nightly) and post results to a Slack channel or Linear project?
- Should it run as a CI check on PRs that touch design system components?
- Could it generate a weekly "Design System Health Report"?

## Technical Details

### Stack
- **Backend**: Express.js (server.js), runs on Mac Mini port 3000
- **Frontend**: React 19 + TypeScript + Tailwind, served via Vite
- **AI**: Anthropic Claude API for spec generation
- **Integrations**: Figma REST API, Linear SDK, GitHub API
- **Access**: Cloudflare tunnel for remote browser access

### Env Config on Mac Mini
```
FIGMA_ACCESS_TOKEN=figd_...
IOS_REPO_PATH=/Users/cyrus/repos/ios-app
ANDROID_REPO_PATH=/Users/cyrus/repos/android-app
ANTHROPIC_API_KEY=sk-ant-...
LINEAR_API_KEY=lin_api_...
GITHUB_TOKEN=ghp_...    # fallback only
```

### Key Files
- `server.js` — Backend with scan, spec generation, and Linear push endpoints
- `src/components/design-audit/` — React frontend (DesignAudit, AuditDashboard, ComponentSpecCard, SpecViewer)
- `src/types/design-audit.ts` — TypeScript types
- `scripts/swift-mirror.mjs` — Existing SwiftUI parser (used for prototypes, separate from audit)

## What We're Looking For

Tell us:
1. What would you change about the current architecture?
2. What's the highest-impact improvement we should make next?
3. What risks do you see that we haven't considered?
4. How would you wire the audit into our existing Cyrus + Linear workflow for maximum automation?
