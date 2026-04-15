import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
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

function buildSystemPrompt(services) {
  const serviceLines = services.map(s =>
    `- ${s.id} (${s.lane}): ${s.description}${s.repoUrl ? ` — ${s.repoUrl}` : ''}`
  ).join('\n');

  return `You are a senior engineering manager who decomposes work items (features, bugs, maintenance, migrations, improvements, infrastructure) into execution plans across a multi-service tech stack. Adapt your decomposition style to the work type — a bug fix needs precise root-cause tasks, a migration needs data safety steps, a feature needs full user-flow coverage.

## Available Services
${serviceLines}

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
    const { intake, featureId } = req.body;

    if (!intake?.title || !intake?.problem) {
      return res.status(400).json({ error: 'Intake must include at least title and problem' });
    }

    // Auto-detect services from GitNexus based on affected surfaces
    const detectedServices = await detectServicesFromGitNexus(intake.affectedSurfaces);
    const services = detectedServices || FALLBACK_SERVICES;
    const systemPrompt = buildSystemPrompt(services);

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

        const description = [
          task.description,
          '',
          `### Acceptance Criteria`,
          acList,
          riskList ? `\n### Risk Flags\n${riskList}` : '',
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

// ── Design System Audit ─────────────────────────────────────────

const FIGMA_API = 'https://api.figma.com/v1';

function getFigmaToken() {
  return process.env.FIGMA_ACCESS_TOKEN;
}

function extractFileKey(url) {
  // Handles: figma.com/file/KEY/..., figma.com/design/KEY/...
  const match = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

const SPEC_KEYWORDS = ['spec', 'specification', 'documentation', 'docs', 'anatomy', 'usage', 'guidelines'];

// ── Code Scanners: find real components in iOS/Android repos ─────

/** Recursively walk a directory, yielding files that match a filter */
function walkDir(dir, filter, skipDirs = ['.', 'Pods', 'build', 'node_modules', '.git', 'DerivedData']) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = joinPath(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.some(s => entry.name.startsWith(s))) {
          results.push(...walkDir(fullPath, filter, skipDirs));
        }
      } else if (entry.isFile() && filter(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

/**
 * Scan an iOS repo for SwiftUI Views and UIKit components.
 * Returns a map of component names found in code.
 * Each entry: { name, filePath, type: 'view'|'component', props: string[] }
 */
function scanIOSComponents(repoPath) {
  const components = [];
  const swiftFiles = walkDir(repoPath, f => f.endsWith('.swift'));

  for (const filePath of swiftFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');

      // SwiftUI Views: struct Foo: View
      const viewRegex = /struct\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*View\b/g;
      let m;
      while ((m = viewRegex.exec(content)) !== null) {
        const name = m[1];
        // Extract @State/@Binding properties as "props"
        const bodyStart = content.indexOf('{', m.index);
        const bodySlice = bodyStart > -1 ? content.slice(bodyStart, bodyStart + 2000) : '';
        const props = [];
        const propRegex = /@(?:State|Binding|ObservedObject|EnvironmentObject|StateObject)\s+(?:private\s+)?var\s+(\w+)\s*(?::\s*([^\n=]+))?/g;
        let pm;
        while ((pm = propRegex.exec(bodySlice)) !== null) {
          props.push(pm[1] + (pm[2] ? `: ${pm[2].trim()}` : ''));
        }
        // Also capture init parameters
        const initRegex = /(?:let|var)\s+(\w+)\s*:\s*([^\n{=]+)/g;
        while ((pm = initRegex.exec(bodySlice)) !== null) {
          if (!pm[1].startsWith('_') && !props.some(p => p.startsWith(pm[1]))) {
            props.push(`${pm[1]}: ${pm[2].trim()}`);
          }
        }
        components.push({ name, filePath: filePath.replace(repoPath + '/', ''), type: 'view', props });
      }

      // UIKit: class Foo: UIView / UIViewController / UIControl
      const uikitRegex = /class\s+(\w+)\s*:\s*(?:UI(?:View|ViewController|Control|CollectionViewCell|TableViewCell)\b)/g;
      while ((m = uikitRegex.exec(content)) !== null) {
        components.push({ name: m[1], filePath: filePath.replace(repoPath + '/', ''), type: 'component', props: [] });
      }
    } catch { /* skip unreadable */ }
  }
  return components;
}

/**
 * Scan an Android repo for Jetpack Compose composables and Android Views.
 * Returns a map of component names found in code.
 */
function scanAndroidComponents(repoPath) {
  const components = [];
  const kotlinFiles = walkDir(repoPath, f => f.endsWith('.kt') || f.endsWith('.kts'));

  for (const filePath of kotlinFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');

      // Jetpack Compose: @Composable fun Foo(...)
      const composableRegex = /@Composable\s+(?:(?:private|internal|public)\s+)?fun\s+([A-Z]\w*)\s*\(([^)]*)\)/g;
      let m;
      while ((m = composableRegex.exec(content)) !== null) {
        const name = m[1];
        const paramsStr = m[2].trim();
        const props = paramsStr
          ? paramsStr.split(',').map(p => p.trim()).filter(p => p && !p.startsWith('modifier'))
          : [];
        components.push({ name, filePath: filePath.replace(repoPath + '/', ''), type: 'composable', props });
      }

      // Traditional Android Views: class Foo : View / FrameLayout / LinearLayout etc.
      const viewRegex = /class\s+(\w+)\s*(?:\([\s\S]*?\))?\s*:\s*(?:View|FrameLayout|LinearLayout|RelativeLayout|ConstraintLayout|RecyclerView|CardView|AppCompatActivity|Fragment)\b/g;
      while ((m = viewRegex.exec(content)) !== null) {
        components.push({ name: m[1], filePath: filePath.replace(repoPath + '/', ''), type: 'view', props: [] });
      }

      // XML layout components (check layout dirs for custom views)
    } catch { /* skip unreadable */ }
  }

  // Also scan XML layouts for custom view references
  const xmlFiles = walkDir(repoPath, f => f.endsWith('.xml'), ['.', 'build', 'node_modules', '.git']);
  for (const filePath of xmlFiles) {
    if (!filePath.includes('/layout') && !filePath.includes('/layout-')) continue;
    try {
      const content = readFileSync(filePath, 'utf8');
      // Custom views: <com.foo.bar.CustomView or <CustomView with capital letter
      const customViewRegex = /<(?:[\w.]+\.)?([A-Z]\w+)(?:\s|\/|>)/g;
      let m;
      while ((m = customViewRegex.exec(content)) !== null) {
        const name = m[1];
        // Skip standard Android/Material widgets
        const stdWidgets = new Set(['View', 'TextView', 'ImageView', 'Button', 'EditText', 'LinearLayout',
          'RelativeLayout', 'FrameLayout', 'ConstraintLayout', 'RecyclerView', 'ScrollView',
          'CardView', 'AppBarLayout', 'Toolbar', 'FloatingActionButton', 'BottomNavigationView',
          'TabLayout', 'ViewPager', 'Fragment', 'include', 'merge', 'Space', 'ProgressBar',
          'CheckBox', 'RadioButton', 'Switch', 'Spinner', 'SeekBar', 'WebView',
          'NavigationView', 'DrawerLayout', 'CoordinatorLayout', 'CollapsingToolbarLayout',
          'MaterialButton', 'MaterialCardView', 'TextInputLayout', 'TextInputEditText',
          'ChipGroup', 'Chip', 'MaterialToolbar', 'BottomAppBar']);
        if (!stdWidgets.has(name) && !components.some(c => c.name === name)) {
          components.push({ name, filePath: filePath.replace(repoPath + '/', ''), type: 'xml-view', props: [] });
        }
      }
    } catch { /* skip */ }
  }

  return components;
}

/**
 * Detect iOS and Android repo paths from GITNEXUS_LOCAL_PATH or direct env vars.
 */
function detectRepoPaths() {
  const paths = { ios: null, android: null };

  // Direct paths (highest priority)
  if (process.env.IOS_REPO_PATH && existsSync(process.env.IOS_REPO_PATH)) {
    paths.ios = process.env.IOS_REPO_PATH;
  }
  if (process.env.ANDROID_REPO_PATH && existsSync(process.env.ANDROID_REPO_PATH)) {
    paths.android = process.env.ANDROID_REPO_PATH;
  }

  // Fall back to monorepo auto-detection
  const monoPath = process.env.GITNEXUS_LOCAL_PATH;
  if (monoPath && existsSync(monoPath)) {
    try {
      const entries = readdirSync(monoPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirName = entry.name.toLowerCase();
        const fullPath = joinPath(monoPath, entry.name);

        if (!paths.ios && /ios|iphone|swift|apple/.test(dirName)) {
          paths.ios = fullPath;
        }
        if (!paths.android && /android|kotlin/.test(dirName)) {
          paths.android = fullPath;
        }
      }
    } catch { /* ignore */ }
  }

  return paths;
}

/**
 * Dedicated bare clone for the Design Audit scanner.
 *
 * Creates a separate bare repo (no working tree, ~50% smaller) that ONLY the scanner uses.
 * This is completely isolated from Cyrus's repos and worktrees — different .git directory,
 * no shared locks, zero interference no matter how many Cyrus agents are running.
 *
 * Layout:
 *   ~/.feature-forge-scanner/
 *     ios-app.git/     ← bare clone, scanner only
 *     android-app.git/ ← bare clone, scanner only
 */

const SCANNER_DIR = joinPath(process.env.HOME || '/tmp', '.feature-forge-scanner');

function ensureScannerDir() {
  if (!existsSync(SCANNER_DIR)) {
    mkdirSync(SCANNER_DIR, { recursive: true });
  }
}

/**
 * Get or create a bare clone for scanning. Returns the path to the bare repo.
 * First call clones, subsequent calls just fetch.
 */
function getOrCreateBareClone(repoPath) {
  ensureScannerDir();

  // Derive a stable name from the repo path
  const repoName = repoPath.split('/').filter(Boolean).pop() || 'repo';
  const barePath = joinPath(SCANNER_DIR, `${repoName}.git`);

  if (existsSync(barePath)) {
    // Already exists — just fetch latest
    try {
      execSync('git fetch origin', { cwd: barePath, timeout: 30000, stdio: 'pipe' });
      console.log(`[Design Audit] Fetched into bare clone: ${barePath}`);
    } catch (err) {
      console.warn(`[Design Audit] Bare fetch failed: ${err.message}`);
    }
    return barePath;
  }

  // First time — figure out the remote URL from the source repo
  let remoteUrl;
  try {
    remoteUrl = execSync('git remote get-url origin', { cwd: repoPath, timeout: 5000, stdio: 'pipe' }).toString().trim();
  } catch {
    // If we can't get remote URL, clone from the local repo itself
    remoteUrl = repoPath;
  }

  // Create bare clone
  try {
    console.log(`[Design Audit] Creating bare clone: ${remoteUrl} → ${barePath}`);
    execSync(`git clone --bare "${remoteUrl}" "${barePath}"`, { timeout: 60000, stdio: 'pipe' });
    return barePath;
  } catch (err) {
    console.error(`[Design Audit] Bare clone failed: ${err.message}`);
    return null;
  }
}

/**
 * Get the default branch ref from a bare repo.
 */
function getDefaultRef(barePath) {
  const candidates = ['origin/main', 'origin/master', 'main', 'master', 'HEAD'];
  for (const ref of candidates) {
    try {
      execSync(`git rev-parse --verify ${ref}`, { cwd: barePath, timeout: 5000, stdio: 'pipe' });
      return ref;
    } catch { /* try next */ }
  }
  return 'HEAD';
}

/**
 * Full safe scan flow:
 * 1. Get or create a bare clone (isolated from Cyrus)
 * 2. Fetch latest from origin
 * 3. Read files from the ref
 * Returns { barePath, ref } or null on failure.
 */
function prepareScannerRepo(repoPath) {
  if (!repoPath || !existsSync(repoPath)) return null;

  const barePath = getOrCreateBareClone(repoPath);
  if (!barePath) return null;

  const ref = getDefaultRef(barePath);
  console.log(`[Design Audit] Scanner repo ready: ${barePath} @ ${ref}`);
  return { barePath, ref };
}

/**
 * List all files from a git ref (e.g. origin/main) without touching the working tree.
 */
function gitListFiles(repoPath, ref, filterFn) {
  try {
    const output = execSync(`git ls-tree -r --name-only ${ref}`, { cwd: repoPath, timeout: 15000, maxBuffer: 10 * 1024 * 1024, stdio: 'pipe' }).toString();
    return output.split('\n').filter(f => f && filterFn(f));
  } catch {
    return [];
  }
}

/**
 * Read a file from a git ref without touching the working tree.
 * e.g. git show origin/main:Sources/Views/ButtonView.swift
 */
function gitReadFile(repoPath, ref, filePath) {
  try {
    return execSync(`git show ${ref}:${filePath}`, { cwd: repoPath, timeout: 10000, maxBuffer: 5 * 1024 * 1024, stdio: 'pipe' }).toString();
  } catch {
    return null;
  }
}

/**
 * Scan an iOS repo from a git ref (origin/main) — reads Swift files without
 * touching Cyrus's working tree. Falls back to filesystem if no ref.
 */
function scanIOSFromRef(repoPath, ref) {
  const SKIP = ['Pods/', 'build/', '.build/', 'DerivedData/', 'Tests/', 'Packages/'];
  const swiftFiles = gitListFiles(repoPath, ref, f => f.endsWith('.swift') && !SKIP.some(s => f.includes(s)));
  const components = [];

  for (const filePath of swiftFiles) {
    const content = gitReadFile(repoPath, ref, filePath);
    if (!content || !content.includes(': View')) continue;

    const viewRegex = /struct\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*View\b/g;
    let m;
    while ((m = viewRegex.exec(content)) !== null) {
      const name = m[1];
      const bodyStart = content.indexOf('{', m.index);
      const bodySlice = bodyStart > -1 ? content.slice(bodyStart, bodyStart + 2000) : '';
      const props = [];
      const propRegex = /@(?:State|Binding|ObservedObject|EnvironmentObject|StateObject)\s+(?:private\s+)?var\s+(\w+)\s*(?::\s*([^\n=]+))?/g;
      let pm;
      while ((pm = propRegex.exec(bodySlice)) !== null) {
        props.push(pm[1] + (pm[2] ? `: ${pm[2].trim()}` : ''));
      }
      const initRegex = /(?:let|var)\s+(\w+)\s*:\s*([^\n{=]+)/g;
      while ((pm = initRegex.exec(bodySlice)) !== null) {
        if (!pm[1].startsWith('_') && !props.some(p => p.startsWith(pm[1]))) {
          props.push(`${pm[1]}: ${pm[2].trim()}`);
        }
      }
      components.push({ name, filePath, type: 'view', props });
    }

    const uikitRegex = /class\s+(\w+)\s*:\s*(?:UI(?:View|ViewController|Control|CollectionViewCell|TableViewCell)\b)/g;
    while ((m = uikitRegex.exec(content)) !== null) {
      components.push({ name: m[1], filePath, type: 'component', props: [] });
    }
  }
  return components;
}

/**
 * Scan an Android repo from a git ref (origin/main).
 */
function scanAndroidFromRef(repoPath, ref) {
  const SKIP = ['build/', '.gradle/', '/test/', '/androidTest/'];
  const kotlinFiles = gitListFiles(repoPath, ref, f => (f.endsWith('.kt') || f.endsWith('.kts')) && !SKIP.some(s => f.includes(s)));
  const components = [];

  for (const filePath of kotlinFiles) {
    const content = gitReadFile(repoPath, ref, filePath);
    if (!content) continue;

    const composableRegex = /@Composable\s+(?:(?:private|internal|public)\s+)?fun\s+([A-Z]\w*)\s*\(([^)]*)\)/g;
    let m;
    while ((m = composableRegex.exec(content)) !== null) {
      const paramsStr = m[2].trim();
      const props = paramsStr
        ? paramsStr.split(',').map(p => p.trim()).filter(p => p && !p.startsWith('modifier'))
        : [];
      components.push({ name: m[1], filePath, type: 'composable', props });
    }

    const viewRegex = /class\s+(\w+)\s*(?:\([\s\S]*?\))?\s*:\s*(?:View|FrameLayout|LinearLayout|RelativeLayout|ConstraintLayout)\b/g;
    while ((m = viewRegex.exec(content)) !== null) {
      components.push({ name: m[1], filePath, type: 'view', props: [] });
    }
  }
  return components;
}

// ── GitHub API Scanner ──────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

function getGithubToken() {
  return process.env.GITHUB_TOKEN;
}

/**
 * Parse a GitHub repo URL into { owner, repo }.
 * Handles: github.com/owner/repo, github.com/owner/repo.git, github.com/owner/repo/tree/...
 */
function parseGithubUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

/**
 * Fetch all files from a GitHub repo via the Trees API (recursive).
 * Returns array of { path, sha } for files matching the filter.
 */
async function listGithubFiles(owner, repo, filterFn, token) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Get default branch
  const repoResp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers, signal: AbortSignal.timeout(10000),
  });
  if (!repoResp.ok) throw new Error(`GitHub repo fetch failed: ${repoResp.status}`);
  const repoData = await repoResp.json();
  const branch = repoData.default_branch || 'main';

  // Get full file tree
  const treeResp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!treeResp.ok) throw new Error(`GitHub tree fetch failed: ${treeResp.status}`);
  const treeData = await treeResp.json();

  if (treeData.truncated) {
    console.warn(`[GitHub] Tree was truncated for ${owner}/${repo} — large repo, some files may be missed`);
  }

  return (treeData.tree || [])
    .filter(entry => entry.type === 'blob' && filterFn(entry.path))
    .map(entry => ({ path: entry.path, sha: entry.sha }));
}

/**
 * Fetch file content from GitHub by blob SHA (handles large files).
 */
async function fetchGithubFileContent(owner, repo, sha, token) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${sha}`, {
    headers, signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf8');
  }
  return data.content || null;
}

/**
 * Scan a GitHub repo for iOS (SwiftUI/UIKit) components.
 * Same parsing logic as local scanner, but fetches files via API.
 */
async function scanGithubIOSComponents(owner, repo, token) {
  const components = [];
  const SKIP_DIRS = ['Pods/', 'build/', '.build/', 'DerivedData/', 'Tests/', 'Packages/'];

  const files = await listGithubFiles(owner, repo,
    (path) => path.endsWith('.swift') && !SKIP_DIRS.some(d => path.includes(d)),
    token
  );

  // Fetch content in batches of 10 to avoid rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const contents = await Promise.all(
      batch.map(f => fetchGithubFileContent(owner, repo, f.sha, token).then(c => ({ ...f, content: c })))
    );

    for (const file of contents) {
      if (!file.content || !file.content.includes(': View')) continue;

      // SwiftUI Views
      const viewRegex = /struct\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*View\b/g;
      let m;
      while ((m = viewRegex.exec(file.content)) !== null) {
        const props = [];
        const bodyStart = file.content.indexOf('{', m.index);
        const bodySlice = bodyStart > -1 ? file.content.slice(bodyStart, bodyStart + 2000) : '';
        const propRegex = /@(?:State|Binding|ObservedObject|EnvironmentObject|StateObject)\s+(?:private\s+)?var\s+(\w+)\s*(?::\s*([^\n=]+))?/g;
        let pm;
        while ((pm = propRegex.exec(bodySlice)) !== null) {
          props.push(pm[1] + (pm[2] ? `: ${pm[2].trim()}` : ''));
        }
        components.push({ name: m[1], filePath: file.path, type: 'view', props });
      }

      // UIKit classes
      const uikitRegex = /class\s+(\w+)\s*:\s*(?:UI(?:View|ViewController|Control|CollectionViewCell|TableViewCell)\b)/g;
      while ((m = uikitRegex.exec(file.content)) !== null) {
        components.push({ name: m[1], filePath: file.path, type: 'component', props: [] });
      }
    }
  }
  return components;
}

/**
 * Scan a GitHub repo for Android (Compose/Kotlin) components.
 */
async function scanGithubAndroidComponents(owner, repo, token) {
  const components = [];
  const SKIP_DIRS = ['build/', '.gradle/', 'test/', 'androidTest/'];

  const files = await listGithubFiles(owner, repo,
    (path) => (path.endsWith('.kt') || path.endsWith('.kts')) && !SKIP_DIRS.some(d => path.includes(d)),
    token
  );

  const BATCH_SIZE = 10;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const contents = await Promise.all(
      batch.map(f => fetchGithubFileContent(owner, repo, f.sha, token).then(c => ({ ...f, content: c })))
    );

    for (const file of contents) {
      if (!file.content) continue;

      // Jetpack Compose
      const composableRegex = /@Composable\s+(?:(?:private|internal|public)\s+)?fun\s+([A-Z]\w*)\s*\(([^)]*)\)/g;
      let m;
      while ((m = composableRegex.exec(file.content)) !== null) {
        const paramsStr = m[2].trim();
        const props = paramsStr
          ? paramsStr.split(',').map(p => p.trim()).filter(p => p && !p.startsWith('modifier'))
          : [];
        components.push({ name: m[1], filePath: file.path, type: 'composable', props });
      }

      // Traditional Views
      const viewRegex = /class\s+(\w+)\s*(?:\([\s\S]*?\))?\s*:\s*(?:View|FrameLayout|LinearLayout|RelativeLayout|ConstraintLayout)\b/g;
      while ((m = viewRegex.exec(file.content)) !== null) {
        components.push({ name: m[1], filePath: file.path, type: 'view', props: [] });
      }
    }
  }
  return components;
}

/**
 * Normalize a name for fuzzy matching: lowercase, strip common suffixes/prefixes
 * "ButtonView" → "button", "PrimaryButton" → "primarybutton", "MD3Card" → "card"
 */
function normalizeName(name) {
  return name
    .replace(/View$|Screen$|Component$|Cell$|Widget$|Composable$|Layout$/i, '')
    .replace(/^(?:UI|MD3|Material|Custom|App|Base)/i, '')
    .toLowerCase()
    .trim();
}

/**
 * Cross-reference Figma components against code components.
 * Returns enriched coverage for each Figma component.
 */
function crossReferenceCoverage(figmaComponents, iosCodeComponents, androidCodeComponents) {
  // Build lookup maps from code components (normalized name → component[])
  const iosMap = new Map();
  for (const c of iosCodeComponents) {
    const key = normalizeName(c.name);
    if (!iosMap.has(key)) iosMap.set(key, []);
    iosMap.get(key).push(c);
  }

  const androidMap = new Map();
  for (const c of androidCodeComponents) {
    const key = normalizeName(c.name);
    if (!androidMap.has(key)) androidMap.set(key, []);
    androidMap.get(key).push(c);
  }

  return figmaComponents.map(comp => {
    const figmaKey = normalizeName(comp.name);
    // Also try partial matching: "IconButton" matches "icon" + "button"
    const figmaWords = comp.name.replace(/([A-Z])/g, ' $1').toLowerCase().trim().split(/\s+/);

    // iOS match: exact normalized match OR figma name substring match
    const iosExact = iosMap.get(figmaKey);
    const iosFuzzy = !iosExact ? [...iosMap.entries()].find(([key]) =>
      figmaWords.some(w => w.length > 3 && key.includes(w)) ||
      key.split(/(?=[A-Z])/).some(w => w.length > 3 && figmaKey.includes(w.toLowerCase()))
    ) : null;
    const iosMatch = iosExact || (iosFuzzy ? iosFuzzy[1] : null);

    // Android match
    const androidExact = androidMap.get(figmaKey);
    const androidFuzzy = !androidExact ? [...androidMap.entries()].find(([key]) =>
      figmaWords.some(w => w.length > 3 && key.includes(w)) ||
      key.split(/(?=[A-Z])/).some(w => w.length > 3 && figmaKey.includes(w.toLowerCase()))
    ) : null;
    const androidMatch = androidExact || (androidFuzzy ? androidFuzzy[1] : null);

    // Check Figma-side spec keywords
    const text = `${comp.name} ${comp.description}`.toLowerCase();
    const hasSpec = SPEC_KEYWORDS.some(kw => text.includes(kw));

    return {
      ...comp,
      platform: {
        ios: iosMatch ? (hasSpec ? 'covered' : 'partial') : 'missing',
        android: androidMatch ? (hasSpec ? 'covered' : 'partial') : 'missing',
      },
      hasSpec,
      codeMatches: {
        ios: iosMatch ? iosMatch.map(c => ({ name: c.name, file: c.filePath, type: c.type, props: c.props })) : [],
        android: androidMatch ? androidMatch.map(c => ({ name: c.name, file: c.filePath, type: c.type, props: c.props })) : [],
      },
    };
  });
}

// Scan a Figma file + actual code repos for design system components
app.post('/api/design-audit/scan', async (req, res) => {
  try {
    const { figmaUrl, iosPath, androidPath } = req.body;
    if (!figmaUrl) return res.status(400).json({ error: 'figmaUrl is required' });

    const token = getFigmaToken();
    if (!token) return res.status(400).json({ error: 'FIGMA_ACCESS_TOKEN not configured' });

    const fileKey = extractFileKey(figmaUrl);
    if (!fileKey) return res.status(400).json({ error: 'Could not parse Figma file key from URL' });

    // ── 1. Fetch Figma components ────────────────────────────────
    const headers = { 'X-Figma-Token': token };
    const [fileResp, componentsResp] = await Promise.all([
      fetch(`${FIGMA_API}/files/${fileKey}?depth=1`, { headers, signal: AbortSignal.timeout(15000) }),
      fetch(`${FIGMA_API}/files/${fileKey}/components`, { headers, signal: AbortSignal.timeout(15000) }),
    ]);

    if (!fileResp.ok) {
      const err = await fileResp.text();
      return res.status(fileResp.status).json({ error: `Figma API error: ${err}` });
    }
    if (!componentsResp.ok) {
      const err = await componentsResp.text();
      return res.status(componentsResp.status).json({ error: `Figma components error: ${err}` });
    }

    const fileData = await fileResp.json();
    const componentsData = await componentsResp.json();
    const rawComponents = componentsData.meta?.components || [];

    // Build raw Figma component list
    const figmaComponents = rawComponents.map(c => {
      const variants = [];
      if (c.containing_frame?.name) {
        const parts = c.name.split(',').map(p => p.trim());
        for (const part of parts) {
          const [key, val] = part.split('=').map(s => s?.trim());
          if (key && val) {
            variants.push({ name: key, properties: { [key]: val } });
          }
        }
      }
      return {
        key: c.key,
        name: c.containing_frame?.name || c.name,
        description: c.description || '',
        componentSetName: c.containing_frame?.name || null,
        containingFrame: c.containing_frame?.pageName || null,
        thumbnailUrl: c.thumbnail_url || null,
        variants,
      };
    });

    // Deduplicate by component set name
    const deduped = new Map();
    for (const comp of figmaComponents) {
      const groupKey = comp.componentSetName || comp.name;
      if (!deduped.has(groupKey)) {
        deduped.set(groupKey, { ...comp, variants: [...comp.variants] });
      } else {
        deduped.get(groupKey).variants.push(...comp.variants);
      }
    }
    const dedupedList = [...deduped.values()];

    // ── 2. Scan actual code repos (GitHub API or local filesystem) ─
    const githubToken = getGithubToken();
    const repoPaths = detectRepoPaths();

    let iosCodeComponents = [];
    let androidCodeComponents = [];
    let iosSource = null;
    let androidSource = null;

    // iOS: bare clone (isolated from Cyrus) → GitHub API fallback
    const iosInput = iosPath || process.env.IOS_REPO_PATH || process.env.IOS_REPO_URL || repoPaths.ios;
    if (iosInput) {
      const ghParsed = parseGithubUrl(iosInput);
      const localPath = !ghParsed ? iosInput : null;

      if (localPath && existsSync(localPath)) {
        // Local repo — create isolated bare clone, fetch, and scan from ref
        const scanner = prepareScannerRepo(localPath);
        if (scanner) {
          iosCodeComponents = scanIOSFromRef(scanner.barePath, scanner.ref);
          iosSource = `${localPath} (bare @ ${scanner.ref})`;
        } else {
          // Bare clone failed — fall back to direct filesystem scan
          iosCodeComponents = scanIOSComponents(localPath);
          iosSource = localPath;
        }
        console.log(`[Design Audit] Found ${iosCodeComponents.length} iOS components`);
      } else if (ghParsed) {
        console.log(`[Design Audit] Scanning iOS via GitHub: ${ghParsed.owner}/${ghParsed.repo}`);
        try {
          iosCodeComponents = await scanGithubIOSComponents(ghParsed.owner, ghParsed.repo, githubToken);
          iosSource = `github:${ghParsed.owner}/${ghParsed.repo}`;
          console.log(`[Design Audit] Found ${iosCodeComponents.length} iOS components from GitHub`);
        } catch (err) {
          console.warn(`[Design Audit] GitHub iOS scan failed: ${err.message}`);
        }
      }
    }

    // Android: bare clone (isolated from Cyrus) → GitHub API fallback
    const androidInput = androidPath || process.env.ANDROID_REPO_PATH || process.env.ANDROID_REPO_URL || repoPaths.android;
    if (androidInput) {
      const ghParsed = parseGithubUrl(androidInput);
      const localPath = !ghParsed ? androidInput : null;

      if (localPath && existsSync(localPath)) {
        const scanner = prepareScannerRepo(localPath);
        if (scanner) {
          androidCodeComponents = scanAndroidFromRef(scanner.barePath, scanner.ref);
          androidSource = `${localPath} (bare @ ${scanner.ref})`;
        } else {
          androidCodeComponents = scanAndroidComponents(localPath);
          androidSource = localPath;
        }
        console.log(`[Design Audit] Found ${androidCodeComponents.length} Android components`);
      } else if (ghParsed) {
        console.log(`[Design Audit] Scanning Android via GitHub: ${ghParsed.owner}/${ghParsed.repo}`);
        try {
          androidCodeComponents = await scanGithubAndroidComponents(ghParsed.owner, ghParsed.repo, githubToken);
          androidSource = `github:${ghParsed.owner}/${ghParsed.repo}`;
          console.log(`[Design Audit] Found ${androidCodeComponents.length} Android components from GitHub`);
        } catch (err) {
          console.warn(`[Design Audit] GitHub Android scan failed: ${err.message}`);
        }
      }
    }

    // ── 3. Cross-reference Figma ↔ Code ──────────────────────────
    const enrichedComponents = crossReferenceCoverage(dedupedList, iosCodeComponents, androidCodeComponents);

    // ── 4. Compute stats ─────────────────────────────────────────
    const stats = {
      total: enrichedComponents.length,
      iosCovered: enrichedComponents.filter(c => c.platform.ios === 'covered').length,
      iosPartial: enrichedComponents.filter(c => c.platform.ios === 'partial').length,
      iosMissing: enrichedComponents.filter(c => c.platform.ios === 'missing').length,
      androidCovered: enrichedComponents.filter(c => c.platform.android === 'covered').length,
      androidPartial: enrichedComponents.filter(c => c.platform.android === 'partial').length,
      androidMissing: enrichedComponents.filter(c => c.platform.android === 'missing').length,
    };

    res.json({
      fileKey,
      fileName: fileData.name || fileKey,
      scannedAt: new Date().toISOString(),
      components: enrichedComponents,
      stats,
      codeScan: {
        ios: { path: iosSource, componentCount: iosCodeComponents.length, components: iosCodeComponents.slice(0, 100) },
        android: { path: androidSource, componentCount: androidCodeComponents.length, components: androidCodeComponents.slice(0, 100) },
      },
    });
  } catch (err) {
    console.error('Design audit scan error:', err);
    res.status(500).json({ error: err.message || 'Scan failed' });
  }
});

// Generate a full Uber-style spec for a component
app.post('/api/design-audit/generate-spec', async (req, res) => {
  try {
    const { component, platform } = req.body;
    if (!component?.name || !platform) {
      return res.status(400).json({ error: 'component and platform are required' });
    }

    const client = await getAnthropicClient();

    const variantList = (component.variants || [])
      .map(v => `  - ${v.name}: ${JSON.stringify(v.properties)}`)
      .join('\n') || '  (no variants detected)';

    // Include actual code context if available
    const codeMatches = component.codeMatches?.[platform] || [];
    const codeContext = codeMatches.length > 0
      ? `\n\n## Existing Code Implementation\nThis component HAS a real implementation in the codebase:\n${
        codeMatches.map(c => `- ${c.name} (${c.type}) in ${c.file}${c.props?.length ? `\n  Props: ${c.props.join(', ')}` : ''}`).join('\n')
      }\nUse these real prop names and types in the spec.`
      : '\n\nNo existing code implementation found — generate spec based on Figma design.';

    const platformContext = platform === 'ios'
      ? 'Target: iOS (SwiftUI / UIKit). Follow Apple HIG. Use SF Symbols for icons. Reference Dynamic Type for typography.'
      : 'Target: Android (Jetpack Compose / Material 3). Follow Material Design 3 guidelines. Use Material Icons. Reference Material typography scale.';

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a design system engineer generating comprehensive component specifications in the style of Uber's Base design system (uSpec). Output ONLY valid JSON.

${platformContext}

Generate a complete spec covering:
1. Anatomy — the visual parts of the component
2. Props/API — all configurable properties (use real prop names from code if available)
3. Variants — all visual/behavioral variants
4. Colors — design tokens used
5. Spacing — padding, margins, gaps
6. Accessibility — WCAG requirements, labels, roles`,
      messages: [{
        role: 'user',
        content: `Generate a full ${platform.toUpperCase()} spec for this design system component:

Name: ${component.name}
Description: ${component.description || '(none)'}
Component Set: ${component.componentSetName || '(standalone)'}
Page: ${component.containingFrame || '(unknown)'}
Detected Variants:
${variantList}${codeContext}

Return JSON matching this structure:
{
  "anatomy": [{ "name": "string", "description": "string", "required": boolean }],
  "props": [{ "name": "string", "type": "string", "defaultValue": "string", "description": "string", "platform": "${platform}" }],
  "variants": [{ "name": "string", "values": ["string"], "description": "string" }],
  "colors": [{ "token": "string", "hex": "string", "usage": "string" }],
  "spacing": [{ "property": "string", "value": "string", "description": "string" }],
  "accessibility": [{ "rule": "string", "wcagLevel": "A"|"AA"|"AAA", "description": "string" }],
  "usageGuidelines": "string"
}`,
      }],
    });

    const text = response.content.find(c => c.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse spec from AI response' });
    }

    const specData = JSON.parse(jsonMatch[0]);

    const spec = {
      componentKey: component.key,
      componentName: component.name,
      platform,
      generatedAt: new Date().toISOString(),
      ...specData,
    };

    res.json({ spec });
  } catch (err) {
    console.error('Spec generation error:', err);
    res.status(500).json({ error: err.message || 'Spec generation failed' });
  }
});

// Push missing specs to Linear as tickets
app.post('/api/design-audit/push-to-linear', async (req, res) => {
  try {
    const { components, teamId, specs } = req.body;
    if (!components?.length || !teamId) {
      return res.status(400).json({ error: 'components and teamId are required' });
    }

    const client = await getLinearClient();
    const results = [];

    for (const comp of components) {
      try {
        const missingPlatforms = [];
        if (comp.platform.ios !== 'covered') missingPlatforms.push('iOS');
        if (comp.platform.android !== 'covered') missingPlatforms.push('Android');

        // Find generated spec for this component if available
        const compSpecs = (specs || []).filter(s => s.componentKey === comp.key);
        let specBody = '';
        if (compSpecs.length > 0) {
          for (const spec of compSpecs) {
            specBody += `\n### ${spec.platform.toUpperCase()} Spec (Auto-Generated)\n`;
            specBody += `\n**Anatomy**\n${spec.anatomy.map(a => `- **${a.name}** ${a.required ? '(required)' : '(optional)'}: ${a.description}`).join('\n')}\n`;
            specBody += `\n**Props**\n| Name | Type | Default | Description |\n|------|------|---------|-------------|\n`;
            specBody += spec.props.map(p => `| ${p.name} | ${p.type} | ${p.defaultValue} | ${p.description} |`).join('\n');
            specBody += `\n\n**Variants**\n${spec.variants.map(v => `- **${v.name}**: ${v.values.join(', ')} — ${v.description}`).join('\n')}\n`;
            specBody += `\n**Colors**\n${spec.colors.map(c => `- \`${c.token}\` (${c.hex}): ${c.usage}`).join('\n')}\n`;
            specBody += `\n**Spacing**\n${spec.spacing.map(s => `- ${s.property}: ${s.value} — ${s.description}`).join('\n')}\n`;
            specBody += `\n**Accessibility**\n${spec.accessibility.map(a => `- [${a.wcagLevel}] ${a.rule}: ${a.description}`).join('\n')}\n`;
            specBody += `\n**Usage Guidelines**\n${spec.usageGuidelines}\n`;
          }
        }

        const description = [
          `## Missing Design Specs`,
          `Component **${comp.name}** is missing specs for: ${missingPlatforms.join(', ')}`,
          '',
          comp.description ? `**Description:** ${comp.description}` : '',
          comp.variants?.length ? `**Known Variants:** ${comp.variants.map(v => v.name).join(', ')}` : '',
          specBody,
          '---',
          '*Generated by Feature Forge Design Audit*',
        ].filter(Boolean).join('\n');

        const issue = await client.createIssue({
          teamId,
          title: `[Design Spec] ${comp.name} — ${missingPlatforms.join(' + ')}`,
          description,
          priority: 3,
        });

        const issueData = await issue.issue;
        results.push({ componentKey: comp.key, linearId: issueData.id, url: issueData.url, success: true });
      } catch (err) {
        results.push({ componentKey: comp.key, success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      results,
      summary: `Created ${results.filter(r => r.success).length}/${results.length} tickets`,
    });
  } catch (err) {
    console.error('Design audit Linear push error:', err);
    res.status(500).json({ error: err.message || 'Failed to push to Linear' });
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
