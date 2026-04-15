// ── Re-export orchestration types ────────────────────────────────
export type {
  AffectedSurface,
  ExecutionLane,
  LinkedReference,
  WorkType,
  FeatureIntake,
  LaneDecision,
  RiskFlag,
  OrchestrationTask,
  TaskGraphEdge,
  OrchestrationStep,
  OrchestrationPlan,
  ProposalStyle,
  DesignScreen,
  DesignProposal,
  DesignProposalsResult,
} from './orchestration';

// ── Execution Modes ──────────────────────────────────────────────
export type FeatureMode = 'spike' | 'prototype' | 'mvp' | 'production';

export const MODE_CONFIG: Record<FeatureMode, { label: string; description: string; color: string }> = {
  spike:      { label: 'Spike',      description: 'Is this even possible? Throwaway exploration.',            color: 'bg-yellow-500' },
  prototype:  { label: 'Prototype',  description: 'Working UI + mock data. Testable on mobile.',             color: 'bg-blue-500' },
  mvp:        { label: 'MVP',        description: 'Real implementation, happy path only.',                    color: 'bg-purple-500' },
  production: { label: 'Production', description: 'Full work — tests, errors, monitoring, rollout.',         color: 'bg-green-500' },
};

export const MODE_ORDER: FeatureMode[] = ['spike', 'prototype', 'mvp', 'production'];

// ── Figma Input ──────────────────────────────────────────────────
export interface FigmaInput {
  url: string;
  thumbnailUrl?: string;
  frames?: FigmaFrame[];
}

export interface FigmaFrame {
  id: string;
  name: string;
  imageUrl?: string;
  states: ScreenState[];
}

export type ScreenState = 'happy' | 'empty' | 'loading' | 'error' | 'offline';

// ── Services / Repos ─────────────────────────────────────────────
export interface Service {
  id: string;
  name: string;
  repo: string;
  type: 'backend' | 'frontend' | 'mobile-ios' | 'mobile-android' | 'shared-lib' | 'infra';
  description?: string;
}

// ── Impact Analysis ──────────────────────────────────────────────
export interface ImpactItem {
  serviceId: string;
  impactType: 'api-change' | 'db-migration' | 'new-endpoint' | 'ui-screen' | 'event' | 'config' | 'shared-lib';
  description: string;
  risk: 'low' | 'medium' | 'high';
}

export interface BlastRadius {
  score: number; // 1-10
  servicesAffected: number;
  migrationsNeeded: number;
  sharedLibChanges: number;
  summary: string;
}

// ── Tasks ────────────────────────────────────────────────────────
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export type DebtTag = 'mocked' | 'hardcoded' | 'no-validation' | 'no-error-handling' | 'no-tests' | 'no-monitoring' | 'skip-edge-case';

export interface FeatureTask {
  id: string;
  title: string;
  description: string;
  serviceId: string;
  status: TaskStatus;
  dependsOn: string[];       // task IDs
  blockedBy: string[];       // task IDs
  mode: FeatureMode;         // which mode created this task
  debtTags: DebtTag[];       // shortcuts taken (prototype phase)
  linearTicketId?: string;
  assignee?: string;
  order: number;
}

// ── Prototype ────────────────────────────────────────────────────
export interface PrototypeScreen {
  id: string;
  name: string;
  figmaFrameId?: string;
  componentTree: string;     // serialized JSX / component definition
  mockData: Record<string, unknown>;
  navigation: { action: string; targetScreenId: string }[];
  states: Record<ScreenState, { mockData: Record<string, unknown>; visible: boolean }>;
}

export interface PrototypeConfig {
  screens: PrototypeScreen[];
  entryScreenId: string;
  shareUrl?: string;
  testResults?: TestSession[];
}

export interface TestSession {
  id: string;
  testerName: string;
  device: string;
  startedAt: string;
  completedAt?: string;
  screenVisits: { screenId: string; duration: number; taps: number }[];
  feedback?: string;
  approved?: boolean;
}

// ── Approval ─────────────────────────────────────────────────────
export interface Approval {
  approvedBy: string;
  approvedAt: string;
  screenshotUrls: string[];
  scope: string;             // what exactly was approved
  notes?: string;
}

// ── Feature (top-level entity) ───────────────────────────────────
export type FeatureStatus = 'draft' | 'planning' | 'in_progress' | 'review' | 'approved' | 'shipped';

export interface Feature {
  id: string;
  name: string;
  description: string;
  figma?: FigmaInput;
  currentMode: FeatureMode;
  targetMode: FeatureMode;
  status: FeatureStatus;
  services: string[];        // service IDs
  impact: ImpactItem[];
  blastRadius?: BlastRadius;
  tasks: FeatureTask[];
  prototype?: PrototypeConfig;
  approvals: Approval[];
  debtLedger: { taskId: string; tag: DebtTag; description: string }[];
  intake?: import('./orchestration').FeatureIntake;
  orchestrationPlanId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  project_id: string;
}

// ── View routing ─────────────────────────────────────────────────
export type ViewRoute =
  | { view: 'list' }
  | { view: 'detail'; featureId: string }
  | { view: 'prototype-builder'; featureId: string }
  | { view: 'prototype-preview'; featureId: string; state?: ScreenState }
  | { view: 'tasks'; featureId: string }
  | { view: 'orchestrate'; featureId?: string }
  | { view: 'orchestrate-review'; planId: string };
