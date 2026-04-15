import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join as joinPath } from 'path';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Static files ────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')));
app.use(express.static(join(__dirname, 'dist/assets')));

// ── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Orchestration API ───────────────────────────────────────────

// Lazy-load SDK clients (only initialized when first called)
let anthropicClient = null;
let linearClient = null;

async function getAnthropicClient() {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

async function getLinearClient() {
  if (!linearClient) {
    const { LinearClient } = await import('@linear/sdk');
    linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
  }
  return linearClient;
}

// ── Stitch SDK (lazy-loaded) ───────────────────────────────────
let stitchModule = null;

async function getStitchModule() {
  if (!process.env.STITCH_API_KEY) return null;
  if (!stitchModule) {
    try {
      stitchModule = await import('@google/stitch-sdk');
    } catch (err) {
      console.warn('Stitch SDK not available:', err.message);
      return null;
    }
  }
  return stitchModule;
}

function generateId() {
  return `ot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── GitNexus service auto-detection ────────────────────────────

// Surface → keywords to match against repo names/descriptions/topics
const SURFACE_REPO_PATTERNS = {
  backend:   ['service', 'api', 'server', 'backend', 'grpc', 'worker', 'gateway', 'queue',
               'users', 'user', 'chat', 'notifications', 'notification', 'recommender',
               'websocket', 'socket', 'reports', 'report', 'counters', 'counter',
               'trails', 'monitoring', 'monitor', 'download', 'video', 'calls'],
  ios:       ['ios', 'iphone', 'swift', 'apple', 'xcode'],
  android:   ['android', 'kotlin', 'gradle'],
  web:       ['web', 'frontend', 'dashboard', 'portal', 'admin', 'webapp', 'react'],
  auth:      ['auth', 'identity', 'login', 'oauth', 'sso', 'session', 'cognito', 'jwt'],
  billing:   ['billing', 'payment', 'subscription', 'stripe', 'revenue', 'purchase',
               'purchases', 'in-app', 'iap'],
  analytics: ['analytics', 'tracking', 'tracker', 'metrics', 'data', 'events',
               'event', 'appsflyer', 'facebook', 'collector', 'lake', 'bridge'],
  infra:     ['infra', 'infrastructure', 'k8s', 'kubernetes', 'terraform', 'helm',
               'ops', 'deploy', 'pipeline', 'ci', 'scripts', 'certs', 'certs'],
  docs:      ['docs', 'documentation', 'wiki', 'guide', 'contributing'],
  security:  ['security', 'vault', 'secret', 'crypt', 'certs', 'certificates'],
  design:    ['design', 'figma', 'ui-kit', 'storybook', 'components', 'icons'],
  qa:        ['test', 'qa', 'e2e', 'selenium', 'playwright', 'cypress'],
  release:   ['release', 'cd', 'ci', 'pipeline', 'fastlane'],
  shared:    ['shared', 'lib', 'libs', 'common', 'proto', 'protobuf', 'types', 'sdk', 'utils'],
};

// Scan a local monorepo directory to discover services (fast, no API needed)
async function detectServicesFromLocalPath(localPath, affectedSurfaces) {
  if (!localPath || !existsSync(localPath)) return null;

  try {
    const entries = readdirSync(localPath, { withFileTypes: true });
    const services = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = joinPath(localPath, entry.name);

      // Read package.json for name/description
      let pkgName = entry.name;
      let pkgDescription = '';
      let pkgKeywords = [];
      const pkgPath = joinPath(dir, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          pkgName = pkg.name || entry.name;
          pkgDescription = pkg.description || '';
          pkgKeywords = pkg.keywords || [];
        } catch { /* ignore parse errors */ }
      }

      // Read CLAUDE.md for richer description
      let claudeDesc = '';
      const claudePath = joinPath(dir, 'CLAUDE.md');
      if (existsSync(claudePath)) {
        try {
          const content = readFileSync(claudePath, 'utf8');
          // Grab first non-empty line after the title
          const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
          claudeDesc = lines[0]?.trim().slice(0, 120) || '';
        } catch { /* ignore */ }
      }

      const description = claudeDesc || pkgDescription || '';
      const text = [entry.name, pkgName, description, ...pkgKeywords].join(' ').toLowerCase();

      // Infer lane from name/description
      let lane = 'backend';
      if (/ios|swift|iphone|apple/.test(text)) lane = 'ios';
      else if (/android|kotlin|gradle/.test(text)) lane = 'android';
      else if (/web|frontend|dashboard|admin|react/.test(text)) lane = 'web';
      else if (/infra|infrastructure|k8s|terraform|scripts|certs/.test(text)) lane = 'infra';
      else if (/lib|libs|shared|proto|sdk|icons/.test(text)) lane = 'shared-lib';

      services.push({ id: entry.name, name: pkgName, description, lane, repoUrl: '' });
    }

    // Return all services — let Claude determine which are relevant to the feature
    return services.length > 0 ? services : null;
  } catch (err) {
    console.warn('Local path scan failed:', err.message);
    return null;
  }
}

async function detectServicesFromGitNexus(affectedSurfaces) {
  // Try local path first (faster, no network)
  const localPath = process.env.GITNEXUS_LOCAL_PATH;
  if (localPath) {
    const local = await detectServicesFromLocalPath(localPath, affectedSurfaces);
    if (local) return local;
  }

  const baseUrl = process.env.GITNEXUS_URL;
  const token = process.env.GITNEXUS_TOKEN;
  const org = process.env.GITNEXUS_ORG;

  if (!baseUrl || !token) return null; // Not configured — fall back to hardcoded services

  try {
    const headers = { Authorization: `token ${token}`, Accept: 'application/json' };

    // Fetch all repos (paginate up to 3 pages of 50)
    let allRepos = [];
    for (let page = 1; page <= 3; page++) {
      const url = org
        ? `${baseUrl}/api/v1/orgs/${org}/repos?limit=50&page=${page}`
        : `${baseUrl}/api/v1/repos/search?limit=50&page=${page}`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) break;
      const json = await resp.json();
      const repos = Array.isArray(json) ? json : (json.data || []);
      if (!repos.length) break;
      allRepos = allRepos.concat(repos);
      if (repos.length < 50) break;
    }

    if (!allRepos.length) return null;

    // Build relevance keywords from the selected surfaces
    const surfaceKeywords = new Set();
    for (const surface of (affectedSurfaces || [])) {
      const patterns = SURFACE_REPO_PATTERNS[surface] || [];
      patterns.forEach(p => surfaceKeywords.add(p));
    }
    // Always include shared/lib repos — they're always potentially relevant
    SURFACE_REPO_PATTERNS.shared.forEach(p => surfaceKeywords.add(p));

    // Score each repo by how many keywords match its name/description/topics
    const scored = allRepos.map(repo => {
      const text = [
        repo.name || '',
        repo.description || '',
        ...(repo.topics || []),
      ].join(' ').toLowerCase();

      let score = 0;
      let matchedKeywords = [];
      for (const kw of surfaceKeywords) {
        if (text.includes(kw)) {
          score++;
          matchedKeywords.push(kw);
        }
      }
      return { repo, score, matchedKeywords };
    });

    // Keep repos with at least 1 keyword match, sorted by score desc.
    // If fewer than 5 matched (narrow org with non-standard names), return all repos —
    // Claude can infer relevance better than keyword matching can.
    const matched = scored.filter(s => s.score > 0);
    const relevant = (matched.length >= 5 ? matched : scored)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    // Map to service descriptors
    const services = relevant.map(({ repo, matchedKeywords }) => {
      // Infer lane from keywords
      let lane = 'backend';
      if (matchedKeywords.some(k => ['ios', 'swift', 'iphone', 'apple'].includes(k))) lane = 'ios';
      else if (matchedKeywords.some(k => ['android', 'kotlin'].includes(k))) lane = 'android';
      else if (matchedKeywords.some(k => ['web', 'frontend', 'dashboard', 'portal', 'admin', 'webapp'].includes(k))) lane = 'web';
      else if (matchedKeywords.some(k => ['infra', 'k8s', 'terraform', 'helm', 'ops'].includes(k))) lane = 'infra';
      else if (matchedKeywords.some(k => ['shared', 'lib', 'common', 'proto', 'types', 'sdk'].includes(k))) lane = 'shared-lib';

      return {
        id: repo.name,
        name: repo.name,
        description: repo.description || '',
        lane,
        repoUrl: repo.html_url || repo.clone_url || '',
        defaultBranch: repo.default_branch || 'main',
        stars: repo.stars_count || 0,
      };
    });

    return services;
  } catch (err) {
    console.warn('GitNexus detection failed, falling back to defaults:', err.message);
    return null;
  }
}

const FALLBACK_SERVICES = [
  { id: 'user-service', name: 'user-service', description: 'Authentication, profiles, permissions', lane: 'backend' },
  { id: 'notification-service', name: 'notification-service', description: 'Email, push, SMS notifications', lane: 'backend' },
  { id: 'payment-service', name: 'payment-service', description: 'Billing, subscriptions, payments', lane: 'backend' },
  { id: 'api-gateway', name: 'api-gateway', description: 'Request routing, rate limiting, API contracts', lane: 'backend' },
  { id: 'ios-app', name: 'ios-app', description: 'iPhone & iPad application', lane: 'ios' },
  { id: 'android-app', name: 'android-app', description: 'Android application', lane: 'android' },
  { id: 'web-app', name: 'web-app', description: 'Main web frontend', lane: 'web' },
  { id: 'shared-lib', name: 'shared-lib', description: 'Shared types, utilities, protocol buffers', lane: 'shared-lib' },
];

// ── Knowledge Context Extraction (Source of Truth) ──────────────

async function extractKnowledgeFromLocal(localPath, services) {
  const contexts = [];
  for (const svc of services) {
    const dir = joinPath(localPath, svc.id);
    if (!existsSync(dir)) continue;

    const ctx = { serviceId: svc.id, techStack: [], fileTree: [], apiRoutes: [], schemas: [] };

    // Full CLAUDE.md
    const claudePath = joinPath(dir, 'CLAUDE.md');
    if (existsSync(claudePath)) {
      try { ctx.claudeMd = readFileSync(claudePath, 'utf8').slice(0, 3000); } catch {}
    }

    // README (first 500 chars)
    const readmePath = joinPath(dir, 'README.md');
    if (existsSync(readmePath)) {
      try { ctx.readme = readFileSync(readmePath, 'utf8').slice(0, 500); } catch {}
    }

    // Tech stack from package.json
    const pkgPath = joinPath(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const deps = Object.keys(pkg.dependencies || {});
        const devDeps = Object.keys(pkg.devDependencies || {});
        ctx.techStack = [...deps, ...devDeps].slice(0, 40);
      } catch {}
    }

    // Scan for key directories and files
    try {
      const scanDir = (base, depth = 0) => {
        if (depth > 2) return;
        const entries = readdirSync(base, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
          const rel = joinPath(base, e.name).replace(dir + '/', '');
          if (e.isDirectory()) {
            // Track key dirs
            if (/routes|api|controllers|handlers|endpoints/i.test(e.name)) {
              ctx.apiRoutes.push(rel + '/');
              // List files in route dirs
              try {
                const files = readdirSync(joinPath(base, e.name));
                files.filter(f => /\.(ts|js|swift|kt)$/.test(f)).forEach(f => ctx.apiRoutes.push(rel + '/' + f));
              } catch {}
            }
            if (/migrations?|schema|models?|entities|prisma|drizzle/i.test(e.name)) {
              ctx.schemas.push(rel + '/');
              try {
                const files = readdirSync(joinPath(base, e.name));
                files.filter(f => /\.(ts|js|sql|prisma|swift|kt)$/.test(f)).forEach(f => ctx.schemas.push(rel + '/' + f));
              } catch {}
            }
            ctx.fileTree.push(rel + '/');
            scanDir(joinPath(base, e.name), depth + 1);
          } else if (/\.(ts|js|swift|kt|sql|prisma|proto)$/.test(e.name) && depth <= 1) {
            ctx.fileTree.push(rel);
          }
        }
      };
      scanDir(dir);
    } catch {}

    // Trim
    ctx.fileTree = ctx.fileTree.slice(0, 60);
    ctx.apiRoutes = ctx.apiRoutes.slice(0, 30);
    ctx.schemas = ctx.schemas.slice(0, 20);

    contexts.push(ctx);
  }
  return contexts;
}

async function extractKnowledgeFromGitNexus(services) {
  const baseUrl = process.env.GITNEXUS_URL;
  const token = process.env.GITNEXUS_TOKEN;
  const org = process.env.GITNEXUS_ORG;
  if (!baseUrl || !token) return [];

  const headers = { Authorization: `token ${token}`, Accept: 'application/json' };
  const contexts = [];

  for (const svc of services.slice(0, 10)) {
    const ctx = { serviceId: svc.id, techStack: [], fileTree: [], apiRoutes: [], schemas: [] };
    const repoPath = org ? `${org}/${svc.id}` : svc.id;

    // Fetch CLAUDE.md
    try {
      const r = await fetch(`${baseUrl}/api/v1/repos/${repoPath}/contents/CLAUDE.md`, { headers, signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const data = await r.json();
        ctx.claudeMd = Buffer.from(data.content, 'base64').toString('utf8').slice(0, 3000);
      }
    } catch {}

    // Fetch README
    try {
      const r = await fetch(`${baseUrl}/api/v1/repos/${repoPath}/contents/README.md`, { headers, signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const data = await r.json();
        ctx.readme = Buffer.from(data.content, 'base64').toString('utf8').slice(0, 500);
      }
    } catch {}

    // Fetch package.json
    try {
      const r = await fetch(`${baseUrl}/api/v1/repos/${repoPath}/contents/package.json`, { headers, signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const data = await r.json();
        const pkg = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
        ctx.techStack = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})].slice(0, 40);
      }
    } catch {}

    // Fetch file tree
    try {
      const branch = svc.defaultBranch || 'main';
      const r = await fetch(`${baseUrl}/api/v1/repos/${repoPath}/git/trees/${branch}?recursive=true`, { headers, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        const entries = (data.tree || []).filter(e => e.type === 'blob').map(e => e.path);
        ctx.fileTree = entries.filter(f => /\.(ts|js|swift|kt|sql|prisma|proto)$/.test(f)).slice(0, 60);
        ctx.apiRoutes = entries.filter(f => /routes?|api|controllers?|handlers?|endpoints?/i.test(f)).slice(0, 30);
        ctx.schemas = entries.filter(f => /migrations?|schema|models?|entities|prisma|drizzle/i.test(f)).slice(0, 20);
      }
    } catch {}

    contexts.push(ctx);
  }
  return contexts;
}

async function extractKnowledgeContext(services) {
  const localPath = process.env.GITNEXUS_LOCAL_PATH;

  // Try local first (much faster)
  let serviceContexts = [];
  if (localPath && existsSync(localPath)) {
    serviceContexts = await extractKnowledgeFromLocal(localPath, services);
  }
  // Fall back to GitNexus API
  if (serviceContexts.length === 0) {
    serviceContexts = await extractKnowledgeFromGitNexus(services);
  }

  // Check for design system output from swift-mirror
  let designSystem = undefined;
  const schemaPath = joinPath(__dirname, 'src/generated/prototype-schema.json');
  if (existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      designSystem = {
        components: (schema.components || schema.screens || []).map(c => c.name || c.id || '').filter(Boolean).slice(0, 30),
        patterns: (schema.patterns || []).map(p => p.name || p).filter(Boolean).slice(0, 20),
      };
    } catch {}
  }

  return { services: serviceContexts, designSystem };
}

function buildSystemPrompt(services, knowledgeContext, clarifyingAnswers) {
  const serviceLines = services.map(s =>
    `- ${s.id} (${s.lane}): ${s.description}${s.repoUrl ? ` — ${s.repoUrl}` : ''}`
  ).join('\n');

  // Build knowledge sections from extracted context
  let knowledgeSections = '';
  if (knowledgeContext?.services?.length) {
    const svcSections = knowledgeContext.services
      .filter(s => s.claudeMd || s.techStack?.length || s.fileTree?.length)
      .map(s => {
        const parts = [`### ${s.serviceId}`];
        if (s.claudeMd) parts.push(`**Context:**\n${s.claudeMd}`);
        if (s.techStack?.length) parts.push(`**Tech stack:** ${s.techStack.slice(0, 20).join(', ')}`);
        if (s.fileTree?.length) parts.push(`**Key files:**\n${s.fileTree.slice(0, 25).map(f => `- ${f}`).join('\n')}`);
        if (s.apiRoutes?.length) parts.push(`**API routes:**\n${s.apiRoutes.slice(0, 15).map(f => `- ${f}`).join('\n')}`);
        if (s.schemas?.length) parts.push(`**Schemas/Models:**\n${s.schemas.slice(0, 10).map(f => `- ${f}`).join('\n')}`);
        return parts.join('\n');
      }).join('\n\n');

    if (svcSections) {
      knowledgeSections += `\n\n## Codebase Knowledge (Source of Truth)\nThe following is extracted from the actual codebase. Use this to write precise tasks with correct file paths, function names, and patterns.\n\n${svcSections}`;
    }
  }

  if (knowledgeContext?.designSystem?.components?.length) {
    knowledgeSections += `\n\n## Design System Components\nAvailable components: ${knowledgeContext.designSystem.components.join(', ')}`;
    if (knowledgeContext.designSystem.patterns?.length) {
      knowledgeSections += `\nPatterns: ${knowledgeContext.designSystem.patterns.join(', ')}`;
    }
  }

  // Build approach decisions from clarifying answers
  let approachSection = '';
  if (clarifyingAnswers?.length) {
    const answered = clarifyingAnswers.filter(q => q.answer);
    if (answered.length) {
      approachSection = `\n\n## Approach Decisions (team confirmed)\n${answered.map(q => `- **${q.question}** → ${q.answer}`).join('\n')}\n\nYou MUST follow these decisions when generating tasks. Do not contradict them.`;
    }
  }

  return `You are a senior engineering manager who decomposes work items (features, bugs, maintenance, migrations, improvements, infrastructure) into execution plans across a multi-service tech stack. Adapt your decomposition style to the work type — a bug fix needs precise root-cause tasks, a migration needs data safety steps, a feature needs full user-flow coverage.

## Available Services
${serviceLines}${knowledgeSections}${approachSection}

## Execution Lanes
- backend: API, database, business logic changes
- ios: iOS app changes
- android: Android app changes
- web: Web frontend changes
- design: UI/UX design tasks
- qa: Testing, regression plans, test automation
- analytics: Event tracking, dashboards, metrics
- docs: Documentation updates
- infra: Infrastructure, CI/CD, deployment changes
- release: Rollout coordination, feature flags, staged release

## Important context
Tasks generated here will be pushed to Linear where **Cyrus**, an AI coding agent, picks them up and implements them autonomously. This means every task must be written for an AI executor, not a human:
- **No vague instructions** like "update the backend" — every task must state WHAT to change, WHERE (repo + file path if known), and WHAT the expected behavior is
- **Description must be a brief implementation guide**: mention the endpoint/function/schema to create or modify, the expected input/output, and any constraints
- **Acceptance criteria must be testable assertions** that Cyrus can verify programmatically (e.g. "GET /api/users/:id returns 404 when user is soft-deleted", not "users are handled correctly")
- If a task involves a database change, describe the migration in the description
- If a task involves an API change, describe the new endpoint signature

## Rules
1. Every task MUST have at least 2 acceptance criteria — both human-readable and machine-testable
2. Dependencies must form a DAG — no cycles
3. Backend tasks come before frontend/mobile tasks that depend on them
4. Design tasks are unblocked (can start immediately, in parallel)
5. QA tasks depend on the implementation tasks they verify
6. Release tasks depend on all other tasks
7. Docs tasks depend on implementation being finalized
8. Analytics tasks can often run in parallel with implementation
9. Each task needs a concrete serviceId from the available services (use "none" for design/qa/docs/release/analytics tasks that don't map to a service)
10. Flag any task touching auth, billing, data migrations, or shared libraries as high-risk
11. Keep tasks focused — one task should not span multiple services
12. Descriptions must include: which repo/service to edit, what function/endpoint/file to create or modify, exact behavior

## Platform coverage — CRITICAL
- If the feature description mentions iOS, Android, or mobile: you MUST generate separate implementation tasks for EACH platform (ios lane + android lane). Do NOT skip a platform.
- QA tasks should be split per platform (iOS QA, Android QA) rather than a single generic QA task.
- If the feature changes pricing/subscription logic, include a separate task for each payment provider (Apple, Google, Stripe).

## Lane inclusion rules
- **DO NOT include release lane** — release coordination is handled separately outside this system
- **DO NOT include web lane** unless the feature explicitly requires web app changes (admin dashboard or web-app)
- **Design lane**: Only include if the feature introduces a NEW screen, a new user-facing component, or a major visual change. Pure backend logic, rate limiting, data migration, or API changes do NOT need design tasks. When included, design tasks should be the FIRST unblocked tasks (everything else depends on design being approved).
- Focus on: backend, ios, android, qa, analytics, infra, docs. Only add other lanes when the feature genuinely requires them.

## Output Format
Return a JSON object with this exact structure:
{
  "laneDecisions": [
    { "lane": "backend", "needed": true, "reasoning": "...", "services": ["user-service"], "repos": ["user-service"], "files": [] }
  ],
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "serviceId": "user-service",
      "lane": "backend",
      "acceptanceCriteria": ["..."],
      "riskFlags": [{ "type": "breaking-change", "description": "...", "severity": "high" }],
      "dependsOn": [],
      "order": 0
    }
  ],
  "taskGraph": [
    { "fromTaskId": "TASK_0", "toTaskId": "TASK_1", "type": "blocks" }
  ]
}

Use TASK_0, TASK_1, TASK_2, etc. as placeholder task IDs — the server will replace them with real IDs.
For taskGraph, reference tasks by their placeholder IDs.
Only include lanes that are actually needed.`;
}

app.post('/api/orchestrate/decompose', async (req, res) => {
  try {
    const { intake, featureId, knowledgeContext, clarifyingAnswers } = req.body;

    if (!intake?.title || !intake?.problem) {
      return res.status(400).json({ error: 'Intake must include at least title and problem' });
    }

    // Auto-detect services from GitNexus based on affected surfaces
    const detectedServices = await detectServicesFromGitNexus(intake.affectedSurfaces);
    const services = detectedServices || FALLBACK_SERVICES;
    const systemPrompt = buildSystemPrompt(services, knowledgeContext, clarifyingAnswers);

    const client = await getAnthropicClient();

    const workType = intake.workType || 'feature';
    const userMessage = `Decompose this ${workType} into an execution plan:

## ${workType.charAt(0).toUpperCase() + workType.slice(1)} Intake
- Title: ${intake.title}
- Type: ${workType}
- Problem: ${intake.problem}
- Goal: ${intake.goal}
- User Impact: ${intake.userImpact || '(not specified)'}
- Business Impact: ${intake.businessImpact || '(not specified)'}
- Success Metric: ${intake.successMetric || '(not specified)'}
- In Scope: ${(intake.inScope || []).join(', ') || '(not specified)'}
- Out of Scope: ${(intake.outOfScope || []).join(', ') || '(not specified)'}
- Affected Surfaces: ${(intake.affectedSurfaces || []).join(', ')}
${intake.linkedReferences?.length ? `- References: ${intake.linkedReferences.map(r => `${r.label}: ${r.url}`).join(', ')}` : ''}
${detectedServices ? `- Services detected from GitNexus: ${detectedServices.map(s => s.id).join(', ')}` : ''}

For each task: write the description as a concise implementation brief (what to build, in which service, with what exact behavior). Acceptance criteria must be specific and testable by an AI agent. Generate the complete execution plan as JSON.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract JSON from response
    const textContent = response.content.find(c => c.type === 'text');
    const jsonMatch = textContent?.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const aiPlan = JSON.parse(jsonMatch[0]);

    // Replace placeholder IDs with real IDs and build the plan
    const idMap = {};
    const tasks = (aiPlan.tasks || []).map((task, i) => {
      const realId = generateId();
      idMap[`TASK_${i}`] = realId;
      return {
        ...task,
        id: realId,
        status: 'pending',
        mode: 'production',
        debtTags: [],
        blockedBy: [],
        dependsOn: [],
        acceptanceCriteria: task.acceptanceCriteria || [],
        riskFlags: task.riskFlags || [],
        order: task.order ?? i,
      };
    });

    // Resolve dependency placeholder IDs
    const taskGraph = (aiPlan.taskGraph || []).map(edge => ({
      fromTaskId: idMap[edge.fromTaskId] || edge.fromTaskId,
      toTaskId: idMap[edge.toTaskId] || edge.toTaskId,
      type: edge.type || 'blocks',
    }));

    // Set dependsOn/blockedBy from the graph
    for (const edge of taskGraph) {
      if (edge.type === 'blocks') {
        const blocked = tasks.find(t => t.id === edge.toTaskId);
        const blocker = tasks.find(t => t.id === edge.fromTaskId);
        if (blocked && blocker) {
          if (!blocked.dependsOn.includes(edge.fromTaskId)) blocked.dependsOn.push(edge.fromTaskId);
          if (!blocked.blockedBy.includes(edge.fromTaskId)) blocked.blockedBy.push(edge.fromTaskId);
        }
      }
    }

    // Also resolve dependsOn placeholder references in tasks
    for (const task of tasks) {
      task.dependsOn = task.dependsOn.map(id => idMap[id] || id);
      task.blockedBy = task.blockedBy.map(id => idMap[id] || id);
    }

    const plan = {
      id: generateId(),
      featureId: featureId || generateId(),
      step: 'review',
      intake,
      laneDecisions: aiPlan.laneDecisions || [],
      tasks,
      taskGraph,
      reviewNotes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentPhase: 'product-definition',
      phases: [
        { phase: 'product-definition', status: 'in-progress' },
        { phase: 'design-specification', status: 'pending' },
        { phase: 'technical-definition', status: 'pending' },
        { phase: 'approval', status: 'pending' },
      ],
      activityLog: [{
        id: generateId(),
        actor: 'system',
        action: 'Plan created via AI decomposition',
        timestamp: new Date().toISOString(),
      }],
    };

    res.json({ plan });
  } catch (err) {
    console.error('Decompose error:', err);
    res.status(500).json({ error: err.message || 'Decomposition failed' });
  }
});

// ── Enrich: expand a plain-text description into a full intake ──
app.post('/api/orchestrate/enrich', async (req, res) => {
  try {
    const { description, workType } = req.body;
    if (!description?.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const client = await getAnthropicClient();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a product engineering assistant. Given a plain-text description of work, produce a structured feature intake brief. Return ONLY valid JSON matching this shape:
{
  "title": "short imperative title",
  "workType": "feature|bug|improvement|maintenance|migration|infrastructure|other",
  "problem": "clear problem statement",
  "goal": "what success looks like when shipped",
  "userImpact": "how end users are affected",
  "businessImpact": "revenue, retention, compliance, etc.",
  "successMetric": "one measurable signal of success",
  "inScope": ["thing 1", "thing 2"],
  "outOfScope": ["thing 1"],
  "affectedSurfaces": [],
  "linkedReferences": []
}
Be concise but specific. Infer workType from context if not given.`,
      messages: [{
        role: 'user',
        content: `Work type hint: ${workType || 'auto-detect'}\n\nDescription:\n${description}`,
      }],
    });

    const text = response.content.find(c => c.type === 'text')?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Failed to parse AI response' });

    const intake = JSON.parse(match[0]);
    res.json({ intake });
  } catch (err) {
    console.error('Enrich error:', err);
    res.status(500).json({ error: err.message || 'Enrichment failed' });
  }
});

// ── Extract Context: pull knowledge from repos (Source of Truth) ─
app.post('/api/orchestrate/extract-context', async (req, res) => {
  try {
    const { affectedSurfaces } = req.body;

    const detectedServices = await detectServicesFromGitNexus(affectedSurfaces);
    const services = detectedServices || FALLBACK_SERVICES;
    const context = await extractKnowledgeContext(services);

    res.json({ context, source: process.env.GITNEXUS_LOCAL_PATH ? 'local' : process.env.GITNEXUS_URL ? 'gitnexus' : 'fallback' });
  } catch (err) {
    console.error('Extract context error:', err);
    res.status(500).json({ error: err.message || 'Context extraction failed' });
  }
});

// ── Clarify: generate approach questions from codebase knowledge ─
app.post('/api/orchestrate/clarify', async (req, res) => {
  try {
    const { intake, context } = req.body;

    if (!intake?.title) {
      return res.status(400).json({ error: 'Intake is required' });
    }

    const client = await getAnthropicClient();

    // Build knowledge summary for the prompt
    const knowledgeSummary = (context?.services || []).map(s => {
      const parts = [`**${s.serviceId}**`];
      if (s.claudeMd) parts.push(s.claudeMd.slice(0, 800));
      if (s.techStack?.length) parts.push(`Tech: ${s.techStack.slice(0, 15).join(', ')}`);
      if (s.apiRoutes?.length) parts.push(`API routes: ${s.apiRoutes.slice(0, 10).join(', ')}`);
      if (s.schemas?.length) parts.push(`Schemas: ${s.schemas.slice(0, 8).join(', ')}`);
      return parts.join('\n');
    }).join('\n\n');

    const designSummary = context?.designSystem?.components?.length
      ? `\nDesign system components: ${context.designSystem.components.join(', ')}`
      : '';

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a senior tech lead reviewing a feature before work begins. You have access to the actual codebase context below. Your job is to generate 3-6 critical approach questions that the team must answer before implementation begins.

Each question should:
- Present 2-3 concrete options based on what you see in the codebase
- Focus on architecture, data modeling, integration patterns, or rollout strategy — NOT requirements clarification
- Reference actual services, files, tables, or components you see in the codebase
- Include tradeoffs for each option

Return ONLY valid JSON:
{
  "questions": [
    {
      "id": "q1",
      "question": "Where should we store user preferences?",
      "category": "data",
      "options": [
        { "label": "Extend user_profiles table", "description": "Simpler, but couples preferences to profile schema" },
        { "label": "New preferences table", "description": "Clean separation, but adds a join for every profile fetch" }
      ]
    }
  ]
}

Categories: architecture, data, ui, integration, rollout`,
      messages: [{
        role: 'user',
        content: `## Feature to implement
- Title: ${intake.title}
- Problem: ${intake.problem}
- Goal: ${intake.goal}
- Affected surfaces: ${(intake.affectedSurfaces || []).join(', ')}
- In scope: ${(intake.inScope || []).join(', ')}

## Codebase Knowledge
${knowledgeSummary || '(No codebase context available — generate questions based on general best practices)'}
${designSummary}

Generate 3-6 approach questions that will lead to better implementation decisions.`,
      }],
    });

    const text = response.content.find(c => c.type === 'text')?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Failed to parse AI response' });

    const parsed = JSON.parse(match[0]);
    res.json({ questions: parsed.questions || [] });
  } catch (err) {
    console.error('Clarify error:', err);
    res.status(500).json({ error: err.message || 'Clarification failed' });
  }
});

// ── Refine: modify plan based on human feedback ─────────────────
app.post('/api/orchestrate/refine', async (req, res) => {
  try {
    const { plan, feedback } = req.body;

    if (!plan || !feedback) {
      return res.status(400).json({ error: 'Plan and feedback are required' });
    }

    const client = await getAnthropicClient();

    const userMessage = `Here is the current execution plan:

${JSON.stringify(plan, null, 2)}

The reviewer provided this feedback:
${feedback}

Update the plan based on this feedback. Return the complete updated plan as JSON with the same structure (laneDecisions, tasks, taskGraph).`;

    // Rebuild prompt using the same services that were used during decomposition
    const detectedServices = await detectServicesFromGitNexus(plan.intake?.affectedSurfaces);
    const services = detectedServices || FALLBACK_SERVICES;
    const systemPrompt = buildSystemPrompt(services);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    const jsonMatch = textContent?.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const refined = JSON.parse(jsonMatch[0]);

    // Rebuild with fresh IDs for any new tasks
    const idMap = {};
    const tasks = (refined.tasks || []).map((task, i) => {
      const realId = task.id?.startsWith('ot_') ? task.id : generateId();
      idMap[`TASK_${i}`] = realId;
      if (task.id) idMap[task.id] = realId;
      return {
        ...task,
        id: realId,
        status: task.status || 'pending',
        mode: task.mode || 'production',
        debtTags: task.debtTags || [],
        blockedBy: [],
        dependsOn: [],
        acceptanceCriteria: task.acceptanceCriteria || [],
        riskFlags: task.riskFlags || [],
        order: task.order ?? i,
      };
    });

    const taskGraph = (refined.taskGraph || []).map(edge => ({
      fromTaskId: idMap[edge.fromTaskId] || edge.fromTaskId,
      toTaskId: idMap[edge.toTaskId] || edge.toTaskId,
      type: edge.type || 'blocks',
    }));

    for (const edge of taskGraph) {
      if (edge.type === 'blocks') {
        const blocked = tasks.find(t => t.id === edge.toTaskId);
        const blocker = tasks.find(t => t.id === edge.fromTaskId);
        if (blocked && blocker) {
          if (!blocked.dependsOn.includes(edge.fromTaskId)) blocked.dependsOn.push(edge.fromTaskId);
          if (!blocked.blockedBy.includes(edge.fromTaskId)) blocked.blockedBy.push(edge.fromTaskId);
        }
      }
    }

    for (const task of tasks) {
      task.dependsOn = task.dependsOn.map(id => idMap[id] || id);
      task.blockedBy = task.blockedBy.map(id => idMap[id] || id);
    }

    const updatedPlan = {
      ...plan,
      laneDecisions: refined.laneDecisions || plan.laneDecisions,
      tasks,
      taskGraph,
      reviewNotes: [...(plan.reviewNotes || []), feedback],
      updatedAt: new Date().toISOString(),
    };

    res.json({ plan: updatedPlan });
  } catch (err) {
    console.error('Refine error:', err);
    res.status(500).json({ error: err.message || 'Refinement failed' });
  }
});

// ── GitNexus: preview detected services ────────────────────────
app.post('/api/orchestrate/detect-services', async (req, res) => {
  const { affectedSurfaces } = req.body || {};
  const detected = await detectServicesFromGitNexus(affectedSurfaces);
  res.json({
    source: detected ? 'gitnexus' : 'fallback',
    configured: !!(process.env.GITNEXUS_URL && process.env.GITNEXUS_TOKEN),
    services: detected || FALLBACK_SERVICES,
  });
});

// ── Linear: get configuration / available teams ─────────────────
app.get('/api/orchestrate/linear-config', async (req, res) => {
  try {
    if (!process.env.LINEAR_API_KEY) {
      return res.json({ configured: false, teams: [] });
    }

    const client = await getLinearClient();
    const teamsResponse = await client.teams();
    const teams = teamsResponse.nodes.map(t => ({
      id: t.id,
      name: t.name,
      key: t.key,
    }));

    res.json({ configured: true, teams });
  } catch (err) {
    console.error('Linear config error:', err);
    res.json({ configured: false, teams: [], error: err.message });
  }
});

// ── Linear: push approved plan ──────────────────────────────────

// Map execution lanes to Linear team keys
// Tasks go to the team that owns the lane, not all to one team
const LANE_TO_TEAM_KEY = {
  backend:   'BAC',
  ios:       'IOS',
  android:   'AND',
  qa:        'QA',
  design:    'UXU',
  web:       'BAC',      // web frontend tasks go to backend team for now
  analytics: 'BAC',      // analytics tasks go to backend
  docs:      'BAC',      // docs tasks go to backend
  infra:     'BAC',      // infra tasks go to backend
  release:   'BAC',      // release tasks go to backend
};

app.post('/api/orchestrate/push-to-linear', async (req, res) => {
  try {
    const { plan, teamId, projectId } = req.body;

    if (!plan || !teamId) {
      return res.status(400).json({ error: 'Plan and teamId are required' });
    }

    const client = await getLinearClient();
    const results = [];

    // ── Build team key → ID map so we can route tasks to the right team ──
    const teamKeyMap = {};
    try {
      const teamsResp = await client.teams();
      for (const t of teamsResp.nodes) {
        teamKeyMap[t.key] = t.id;
      }
    } catch (err) {
      console.warn('Could not fetch teams, all issues go to selected team:', err.message);
    }

    function getTeamIdForLane(lane) {
      const teamKey = LANE_TO_TEAM_KEY[lane];
      return (teamKey && teamKeyMap[teamKey]) || teamId; // fallback to selected team
    }

    // ── Create a Linear project (the project IS the container — no parent issue) ──
    const workType = plan.intake.workType || 'feature';
    let resolvedProjectId = projectId;
    if (!resolvedProjectId) {
      try {
        // Collect all team IDs that will receive issues
        const involvedTeamIds = new Set([teamId]);
        for (const task of plan.tasks) {
          involvedTeamIds.add(getTeamIdForLane(task.lane));
        }

        // Build a rich project description from the full intake
        const activeLanes = plan.laneDecisions.filter(l => l.needed);
        const projectDescription = [
          `## Problem`,
          plan.intake.problem || '(not specified)',
          '',
          `## Goal`,
          plan.intake.goal || '(not specified)',
          '',
          plan.intake.userImpact ? `## User Impact\n${plan.intake.userImpact}\n` : '',
          plan.intake.businessImpact ? `## Business Impact\n${plan.intake.businessImpact}\n` : '',
          plan.intake.successMetric ? `## Success Metric\n${plan.intake.successMetric}\n` : '',
          `## Execution Plan`,
          `**${plan.tasks.length} tasks** across **${activeLanes.length} lanes**`,
          '',
          ...activeLanes.map(l => {
            const laneTasks = plan.tasks.filter(t => t.lane === l.lane);
            const teamKey = LANE_TO_TEAM_KEY[l.lane] || 'BAC';
            return `### ${l.lane.charAt(0).toUpperCase() + l.lane.slice(1)} (${teamKey}) — ${laneTasks.length} tasks\n${l.reasoning}\n${laneTasks.map(t => `- ${t.title}`).join('\n')}`;
          }),
          '',
          plan.intake.inScope?.length ? `## In Scope\n${plan.intake.inScope.map(s => `- ${s}`).join('\n')}\n` : '',
          plan.intake.outOfScope?.length ? `## Out of Scope\n${plan.intake.outOfScope.map(s => `- ${s}`).join('\n')}\n` : '',
          plan.intake.linkedReferences?.length ? `## References\n${plan.intake.linkedReferences.map(r => `- [${r.label}](${r.url})`).join('\n')}\n` : '',
          '---',
          '*Generated by Feature Forge Orchestration*',
        ].filter(Boolean).join('\n');

        const project = await client.createProject({
          name: plan.intake.title,
          description: projectDescription,
          teamIds: [...involvedTeamIds],
        });
        const projectData = await project.project;
        resolvedProjectId = projectData?.id;
        // Linear projects use slugified URL: /project/<slug>-<short-id>
        const projectUrl = projectData?.url || (projectData?.slugId ? `https://linear.app/appmirror/project/${projectData.slugId}` : null);
        results.push({ type: 'project', id: resolvedProjectId, url: projectUrl, success: true });
      } catch (err) {
        console.warn('Could not create Linear project, continuing with issues only:', err.message);
      }
    }

    // ── Ensure lane labels exist ──
    const laneLabels = {};
    try {
      // Fetch existing labels for this team
      const labelsResp = await client.issueLabels({ filter: { team: { id: { eq: teamId } } } });
      const existingLabels = new Map(labelsResp.nodes.map(l => [l.name.toLowerCase(), l.id]));

      const LANE_COLORS = {
        backend: '#3B82F6', ios: '#6B7280', android: '#10B981', web: '#22C55E',
        design: '#EC4899', qa: '#F97316', analytics: '#06B6D4', docs: '#EAB308',
        infra: '#EF4444', release: '#8B5CF6',
      };

      const activeLanes = [...new Set(plan.tasks.map(t => t.lane))];
      for (const lane of activeLanes) {
        const labelName = `lane:${lane}`;
        if (existingLabels.has(labelName)) {
          laneLabels[lane] = existingLabels.get(labelName);
        } else {
          try {
            const created = await client.createIssueLabel({
              name: labelName,
              color: LANE_COLORS[lane] || '#6B7280',
              teamId,
            });
            const labelData = await created.issueLabel;
            laneLabels[lane] = labelData?.id;
          } catch { /* label might already exist from race condition */ }
        }
      }
    } catch (err) {
      console.warn('Could not create lane labels:', err.message);
    }

    // Create tasks directly in the project (no parent issue — the project IS the container)
    const linearIdMap = {};
    for (const task of plan.tasks) {
      try {
        const acList = task.acceptanceCriteria.map(ac => `- [ ] ${ac}`).join('\n');
        const riskList = task.riskFlags.map(rf => `- **${rf.severity.toUpperCase()}** [${rf.type}]: ${rf.description}`).join('\n');

        // Build design & tech annotation sections if present
        const designSection = task.designAnnotation ? [
          `### Design Spec`,
          task.designAnnotation.figmaUrl ? `**Figma:** ${task.designAnnotation.figmaUrl}` : '',
          task.designAnnotation.uiSpecs ? `**UI Specs:**\n${task.designAnnotation.uiSpecs}` : '',
          task.designAnnotation.interactionNotes ? `**Interaction Notes:**\n${task.designAnnotation.interactionNotes}` : '',
        ].filter(Boolean).join('\n') : '';

        const techSection = task.techAnnotation ? [
          `### Tech Notes`,
          task.techAnnotation.implementationNotes ? task.techAnnotation.implementationNotes : '',
          task.techAnnotation.estimateHours ? `**Estimate:** ${task.techAnnotation.estimateHours}h` : '',
          task.techAnnotation.challengesRaised?.length ? `**Challenges:**\n${task.techAnnotation.challengesRaised.map(c => `- ${c}`).join('\n')}` : '',
        ].filter(Boolean).join('\n') : '';

        const description = [
          task.description,
          '',
          `### Acceptance Criteria`,
          acList,
          riskList ? `\n### Risk Flags\n${riskList}` : '',
          designSection ? `\n${designSection}` : '',
          techSection ? `\n${techSection}` : '',
          '',
          `**Lane:** ${task.lane}`,
          task.serviceId !== 'none' ? `**Service:** ${task.serviceId}` : '',
        ].filter(Boolean).join('\n');

        // Map risk severity to Linear priority
        const maxRisk = task.riskFlags.reduce((max, rf) =>
          rf.severity === 'high' ? 'high' : (rf.severity === 'medium' && max !== 'high') ? 'medium' : max
        , 'low');
        const priority = maxRisk === 'high' ? 1 : maxRisk === 'medium' ? 2 : 3;

        const taskTeamId = getTeamIdForLane(task.lane);
        // Lane labels are per-team — get or create in the task's team
        let labelIds = [];
        if (laneLabels[task.lane]) {
          labelIds = [laneLabels[task.lane]];
        }

        const childIssue = await client.createIssue({
          teamId: taskTeamId,
          projectId: resolvedProjectId || undefined,
          title: task.title,
          description,
          priority,
          labelIds: labelIds.length > 0 ? labelIds : undefined,
        });

        const childData = await childIssue.issue;
        linearIdMap[task.id] = childData.id;
        results.push({ type: 'task', taskId: task.id, linearId: childData.id, url: childData.url, success: true });

        // Attach Stitch design proposals to design-lane issues
        if (task.lane === 'design' && plan.designProposals) {
          const selectedProposal = plan.designProposals.proposals.find(p => p.selected);
          if (selectedProposal) {
            try {
              const commentLines = [
                `## 🎨 Selected Design Proposal: ${selectedProposal.label}`,
                `*${selectedProposal.rationale}*`,
                '',
              ];
              if (plan.designProposals.stitchProjectUrl) {
                commentLines.push(`**Stitch Project:** [Open in Stitch](${plan.designProposals.stitchProjectUrl})`);
                commentLines.push('');
              }
              for (const screen of selectedProposal.screens) {
                commentLines.push(`### ${screen.name}`);
                if (screen.imageUrl) commentLines.push(`![${screen.name}](${screen.imageUrl})`);
                if (screen.htmlUrl) commentLines.push(`[Import to Figma (HTML)](${screen.htmlUrl})`);
                commentLines.push('');
              }
              await client.createComment({
                issueId: childData.id,
                body: commentLines.join('\n'),
              });
            } catch (commentErr) {
              console.warn('Failed to attach design proposal comment:', commentErr.message);
            }
          }
        }
      } catch (err) {
        results.push({ type: 'task', taskId: task.id, success: false, error: err.message });
      }
    }

    // Create dependency relations
    for (const edge of plan.taskGraph) {
      if (edge.type === 'blocks' && linearIdMap[edge.fromTaskId] && linearIdMap[edge.toTaskId]) {
        try {
          await client.createIssueRelation({
            issueId: linearIdMap[edge.toTaskId],
            relatedIssueId: linearIdMap[edge.fromTaskId],
            type: 'blocks',
          });
        } catch (err) {
          console.error('Failed to create relation:', err.message);
        }
      }
    }

    // Find the project result to return its URL
    const projectResult = results.find(r => r.type === 'project');
    const successCount = results.filter(r => r.success).length;
    res.json({
      success: true,
      project: projectResult ? { id: projectResult.id, url: projectResult.url } : null,
      results,
      summary: `Created ${successCount}/${results.length} items`,
    });
  } catch (err) {
    console.error('Linear push error:', err);
    res.status(500).json({ error: err.message || 'Failed to push to Linear' });
  }
});

// ── Design System Context (injected into proposal prompts) ──────

function buildDesignSystemContext() {
  return `## iOS Design System Reference

### Color Tokens
- Primary Blue: #007AFF (interactive elements, links, tint)
- Success Green: #34C759 (toggles on, confirmations)
- Destructive Red: #FF3B30 (delete, error, destructive buttons)
- Warning Orange: #FF9500 (warnings, attention)
- Gray: #8E8E93 (secondary text, captions)
- Gray3: #C7C7CC (light borders)
- Gray5: #E5E5EA (subtle backgrounds)
- Gray6 / Grouped BG: #F2F2F7 (screen background, section bg)
- Separator: #C6C6C8 (0.5px hairline dividers)
- Card BG: #FFFFFF
- Black: #000000 (primary text)

### Typography (SF Pro family)
- Large Title: 34px, weight 700, letter-spacing -0.4px
- Title: 17px, weight 600 (NavBar titles, section headers)
- Body: 17px, weight 400 (standard text)
- Caption: 13px, weight 400, gray color
- Section Header: 13px, weight 400, uppercase, letter-spacing 0.5px

### Component Library
1. **Screen** — Full-screen container, background #F2F2F7
2. **NavBar** — Top bar with back button, center title (17px semibold), optional right action
3. **LargeTitle** — 34px bold header, 16px horizontal padding
4. **Section** — Grouped list container with optional header/footer captions, 12px radius white cards
5. **Row** — List cell: optional icon (29x29, 6px radius) + label + detail text/chevron/toggle/image(40px circle). Padding 11px 16px, gap 12px
6. **TextField** — Text input, placeholder in gray, optional secure mode
7. **IOSButton** — Styles: filled (blue bg, white text) | tinted (18% opacity bg) | plain (text only). Radius 12px, padding 14px 20px. Can be destructive (red) or full-width
8. **SearchBar** — Search icon + input field, gray6 bg, radius 10px
9. **TabBar** — Bottom nav with frosted glass bg (blur 20px). Tabs have icon + label. Active: #007AFF, inactive: #8E8E93
10. **SegmentedControl** — Pill selector, radius 8px outer / 6px segment
11. **IOSCard** — Card wrapper, optional 16px padding
12. **Alert** — Modal dialog, backdrop blur 20px, max-width 270px, radius 14px. Buttons: default/cancel/destructive
13. **EmptyState** — Centered: 56px icon + title + message + optional action button
14. **Spacer** — Vertical spacing, default 16px

### Layout Patterns
- Screen horizontal padding: 16px
- Section margin bottom: 24px
- Row gap (icon to text): 12px
- Card/section border radius: 12px
- Standard spacing rhythm: 4/8/12/16/20/24px
- Device target: iPhone 15 Pro (390x844 logical points)

### Interaction Patterns
- Navigation: push/pop stack with back button in NavBar
- Toggles: 51x31px switch, #34C759 when on
- Chevron rows: indicate drill-down navigation
- Bottom TabBar: 3-5 tabs for primary navigation
- Pull-to-refresh on scrollable lists
- Swipe-to-delete on list rows
- Grouped sections for settings-style layouts`;
}

// ── Design Proposals API ───────────────────────────────────────

app.post('/api/orchestrate/design-proposals', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan?.intake) {
      return res.status(400).json({ error: 'Plan with intake is required' });
    }

    const designTasks = (plan.tasks || []).filter(t => t.lane === 'design');
    const intake = plan.intake;

    // Build Claude prompt for 3 UX proposals
    const client = await getAnthropicClient();
    const designContext = buildDesignSystemContext();

    const systemPrompt = `You are a senior UX/UI designer specializing in iOS mobile applications. You create detailed, production-ready screen designs that adhere strictly to an established design system.

${designContext}

## Your Task
Given a feature description, create exactly 3 distinct UX/UI proposals. Each proposal takes a different design philosophy:

1. **Minimal** — Clean, focused, fewer screens. Prioritizes simplicity and speed. Uses the fewest components necessary. Best for power users who want efficiency.

2. **Feature-rich** — Comprehensive, detailed, more screens. Surfaces all functionality upfront. Uses sections, cards, toggles, and detailed rows. Best for users who want full control.

3. **Conversational** — Guided, step-by-step, wizard-like. Breaks complex tasks into simple steps. Uses large titles, spacers, focused inputs per screen. Best for new users or complex onboarding.

## Output Format
Return a JSON object:
{
  "proposals": [
    {
      "style": "minimal",
      "label": "Minimal — [2-3 word summary]",
      "rationale": "[1-2 sentences explaining why this approach works for this feature]",
      "screens": [
        {
          "name": "[Screen Name]",
          "prompt": "[Detailed Stitch prompt: describe the EXACT layout using the iOS components above. Reference specific components by name (NavBar, Section, Row, TabBar, etc.), specify colors by hex code, describe each element's content and state. Be extremely specific — this prompt drives an AI design tool to generate the actual screen.]"
        }
      ]
    }
  ]
}

## Prompt Writing Rules
- Each screen prompt MUST reference specific iOS components from the design system
- Include exact text content for labels, placeholders, button titles
- Specify icon emojis for Row icons and TabBar items
- Describe the full visual hierarchy from top (NavBar) to bottom (TabBar or button)
- For navigation flows, mention what screen each button/row leads to
- Keep prompts under 500 words but be precise about every visible element`;

    const userMessage = `## Feature: ${intake.title}

**Problem:** ${intake.problem}
**Goal:** ${intake.goal}
**User Impact:** ${intake.userImpact}
**Affected Surfaces:** ${intake.affectedSurfaces.join(', ')}
**In Scope:** ${intake.inScope.join('; ')}
${intake.outOfScope.length > 0 ? `**Out of Scope:** ${intake.outOfScope.join('; ')}` : ''}

${designTasks.length > 0 ? `## Existing Design Tasks\n${designTasks.map(t => `- **${t.title}**: ${t.description}\n  Acceptance: ${(t.acceptanceCriteria || []).join('; ')}`).join('\n')}` : ''}

Create 3 proposals with appropriate screen flows for this feature.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract JSON from Claude's response
    const text = response.content[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse Claude response as JSON' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const proposals = parsed.proposals || [];

    // Build the result
    const result = {
      planId: plan.id,
      featureTitle: intake.title,
      stitchProjectId: null,
      stitchProjectUrl: null,
      proposals: [],
      designSystemSynced: false,
      createdAt: new Date().toISOString(),
    };

    // Try to generate screens in Stitch
    const stitchMod = await getStitchModule();
    let stitchProject = null;

    if (stitchMod) {
      try {
        const { stitch } = stitchMod;

        // Create a Stitch project for this feature
        const projectResult = await stitch.callTool('create_project', {
          title: `${intake.title} — UX Proposals`,
        });
        const projectId = projectResult?.projectId || projectResult?.id;

        if (projectId) {
          stitchProject = stitch.project(projectId);
          result.stitchProjectId = projectId;
          result.stitchProjectUrl = `https://stitch.withgoogle.com/project/${projectId}`;

          // Sync design system tokens
          try {
            await stitchProject.createDesignSystem({
              name: 'iOS Design System',
              colors: {
                primary: '#007AFF',
                success: '#34C759',
                destructive: '#FF3B30',
                warning: '#FF9500',
                secondary: '#8E8E93',
                background: '#F2F2F7',
                card: '#FFFFFF',
                separator: '#C6C6C8',
              },
              typography: {
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
                scale: {
                  largeTitle: { size: '34px', weight: '700' },
                  title: { size: '17px', weight: '600' },
                  body: { size: '17px', weight: '400' },
                  caption: { size: '13px', weight: '400' },
                },
              },
              spacing: { unit: '8px', scale: [4, 8, 12, 16, 20, 24, 32] },
              borderRadius: { card: '12px', button: '12px', input: '10px', alert: '14px' },
            });
            result.designSystemSynced = true;
          } catch (dsErr) {
            console.warn('Stitch design system sync failed (non-blocking):', dsErr.message);
          }
        }
      } catch (projErr) {
        console.warn('Stitch project creation failed (falling back to prompts only):', projErr.message);
      }
    }

    // Process each proposal: assign IDs and optionally generate Stitch screens
    for (let pi = 0; pi < proposals.length; pi++) {
      const raw = proposals[pi];
      const proposal = {
        id: generateId(),
        style: raw.style,
        label: raw.label,
        rationale: raw.rationale,
        screens: [],
        selected: false,
      };

      // Generate each screen (in parallel within a proposal if Stitch is available)
      const screenPromises = (raw.screens || []).map(async (rawScreen, si) => {
        const screen = {
          screenId: `${proposal.id}_s${si}`,
          name: rawScreen.name,
          prompt: rawScreen.prompt,
          stitchScreenId: null,
          imageUrl: null,
          htmlUrl: null,
        };

        if (stitchProject) {
          try {
            const generated = await stitchProject.generate(rawScreen.prompt, 'iphone-15-pro');
            if (generated) {
              screen.stitchScreenId = generated.id || generated.screenId;
              const [imgResult, htmlResult] = await Promise.all([
                generated.getImage().catch(() => null),
                generated.getHtml().catch(() => null),
              ]);
              screen.imageUrl = imgResult;
              screen.htmlUrl = htmlResult;
            }
          } catch (genErr) {
            console.warn(`Stitch generation failed for ${rawScreen.name}:`, genErr.message);
          }
        }

        return screen;
      });

      proposal.screens = await Promise.all(screenPromises);
      result.proposals.push(proposal);
    }

    res.json({ designProposals: result });
  } catch (err) {
    console.error('Design proposals error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate design proposals' });
  }
});

app.post('/api/orchestrate/design-proposals/regenerate', async (req, res) => {
  try {
    const { stitchProjectId, screenPrompt, deviceType } = req.body;
    if (!screenPrompt) {
      return res.status(400).json({ error: 'screenPrompt is required' });
    }

    const stitchMod = await getStitchModule();
    if (!stitchMod || !stitchProjectId) {
      return res.status(400).json({ error: 'Stitch is not configured or no projectId provided' });
    }

    const { stitch } = stitchMod;
    const project = stitch.project(stitchProjectId);
    const generated = await project.generate(screenPrompt, deviceType || 'iphone-15-pro');

    const [imageUrl, htmlUrl] = await Promise.all([
      generated.getImage().catch(() => null),
      generated.getHtml().catch(() => null),
    ]);

    res.json({
      stitchScreenId: generated.id || generated.screenId,
      imageUrl,
      htmlUrl,
    });
  } catch (err) {
    console.error('Screen regeneration error:', err);
    res.status(500).json({ error: err.message || 'Failed to regenerate screen' });
  }
});

// ── Linear Webhook — External Design Trigger ───────────────────

app.post('/api/webhooks/linear-design', async (req, res) => {
  try {
    // Verify webhook signature if configured
    const secret = process.env.LINEAR_WEBHOOK_SECRET;
    if (secret) {
      const { createHmac } = await import('crypto');
      const signature = req.headers['linear-signature'];
      const expected = createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const { action, type, data } = req.body;

    // Only handle new issue creation
    if (type !== 'Issue' || action !== 'create') {
      return res.json({ ignored: true, reason: 'Not an issue creation event' });
    }

    // Check for design lane label
    const labels = data?.labels || [];
    const isDesignLane = labels.some(l => l.name === 'lane:design');
    if (!isDesignLane) {
      return res.json({ ignored: true, reason: 'No lane:design label found' });
    }

    // Build a synthetic plan from the issue data
    const syntheticIntake = {
      title: data.title || 'Untitled',
      workType: 'feature',
      problem: data.description || '',
      goal: data.description || '',
      userImpact: '',
      businessImpact: '',
      successMetric: '',
      inScope: [],
      outOfScope: [],
      linkedReferences: [],
      affectedSurfaces: ['design', 'ios'],
    };

    const syntheticPlan = {
      id: generateId(),
      featureId: data.id,
      step: 'review',
      intake: syntheticIntake,
      laneDecisions: [{ lane: 'design', needed: true, reasoning: 'Triggered via Linear webhook', services: [], repos: [] }],
      tasks: [{
        id: generateId(),
        title: data.title,
        description: data.description || '',
        serviceId: 'none',
        lane: 'design',
        status: 'pending',
        dependsOn: [],
        blockedBy: [],
        mode: 'production',
        debtTags: [],
        acceptanceCriteria: [],
        riskFlags: [],
        order: 0,
      }],
      taskGraph: [],
      reviewNotes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Generate proposals using the same pipeline
    const proposalRes = await fetch(`http://localhost:${PORT}/api/orchestrate/design-proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: syntheticPlan }),
    });

    const proposalData = await proposalRes.json();
    const proposals = proposalData?.designProposals;

    if (proposals && proposals.proposals?.length > 0) {
      // Post results as a comment on the Linear issue
      const linearClient = await getLinearClient();
      const commentLines = [
        `## 🎨 Design Proposals (Auto-generated)`,
        ``,
        `**Feature:** ${syntheticIntake.title}`,
        proposals.stitchProjectUrl ? `**Stitch Project:** [Open in Stitch](${proposals.stitchProjectUrl})` : '',
        ``,
      ];

      for (const proposal of proposals.proposals) {
        commentLines.push(`### ${proposal.label}`);
        commentLines.push(`*${proposal.rationale}*`);
        commentLines.push('');
        for (const screen of proposal.screens) {
          commentLines.push(`**${screen.name}**`);
          if (screen.imageUrl) {
            commentLines.push(`![${screen.name}](${screen.imageUrl})`);
          }
          if (screen.htmlUrl) {
            commentLines.push(`[Import to Figma (HTML)](${screen.htmlUrl})`);
          }
          commentLines.push('');
        }
        commentLines.push('---');
      }

      await linearClient.createComment({
        issueId: data.id,
        body: commentLines.filter(Boolean).join('\n'),
      });
    }

    res.json({ success: true, proposals: proposals?.proposals?.length || 0 });
  } catch (err) {
    console.error('Linear webhook error:', err);
    res.status(500).json({ error: err.message || 'Webhook handler failed' });
  }
});

// ── SPA catch-all ────────────────────────────────────────────────
app.get('*', (req, res) => {
  const indexPath = join(__dirname, 'dist', 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// ── Start server ────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tool server running on port ${PORT}`);
  console.log(`remoteEntry.js available at:`);
  console.log(`  - http://localhost:${PORT}/remoteEntry.js`);
  console.log(`  - http://localhost:${PORT}/assets/remoteEntry.js`);
  console.log(`Orchestration API at http://localhost:${PORT}/api/orchestrate/`);
});
