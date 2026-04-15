import type { FeatureTask } from './index';

// ── Affected Surfaces ───────────────────────────────────────────
export type AffectedSurface =
  | 'backend'
  | 'ios'
  | 'android'
  | 'web'
  | 'analytics'
  | 'qa'
  | 'docs'
  | 'release'
  | 'infra'
  | 'auth'
  | 'billing'
  | 'security'
  | 'design';

// ── Execution Lanes ─────────────────────────────────────────────
export type ExecutionLane =
  | 'backend'
  | 'ios'
  | 'android'
  | 'web'
  | 'design'
  | 'qa'
  | 'analytics'
  | 'docs'
  | 'infra'
  | 'release';

// ── Feature Intake ──────────────────────────────────────────────
export interface LinkedReference {
  label: string;
  url: string;
}

export type WorkType = 'feature' | 'bug' | 'maintenance' | 'migration' | 'improvement' | 'infrastructure' | 'other';

export interface FeatureIntake {
  title: string;
  workType: WorkType;
  problem: string;
  goal: string;
  userImpact: string;
  businessImpact: string;
  successMetric: string;
  inScope: string[];
  outOfScope: string[];
  linkedReferences: LinkedReference[];
  affectedSurfaces: AffectedSurface[];
  figmaUrl?: string;
}

// ── Lane Decisions ──────────────────────────────────────────────
export interface LaneDecision {
  lane: ExecutionLane;
  needed: boolean;
  reasoning: string;
  services: string[];
  repos: string[];
  files?: string[];
}

// ── Risk Flags ──────────────────────────────────────────────────
export interface RiskFlag {
  type: 'breaking-change' | 'migration' | 'security' | 'performance' | 'data-loss' | 'cross-team';
  description: string;
  severity: 'low' | 'medium' | 'high';
}

// ── Orchestration Task ──────────────────────────────────────────
export interface OrchestrationTask extends FeatureTask {
  lane: ExecutionLane;
  acceptanceCriteria: string[];
  riskFlags: RiskFlag[];
  linearIssueUrl?: string;
}

// ── Task Graph ──────────────────────────────────────────────────
export interface TaskGraphEdge {
  fromTaskId: string;
  toTaskId: string;
  type: 'blocks' | 'informs';
}

// ── Design Proposals ────────────────────────────────────────────
export type ProposalStyle = 'minimal' | 'feature-rich' | 'conversational';

export interface DesignScreen {
  screenId: string;
  name: string;
  prompt: string;
  stitchScreenId?: string;
  imageUrl?: string;
  htmlUrl?: string;
}

export interface DesignProposal {
  id: string;
  style: ProposalStyle;
  label: string;
  rationale: string;
  screens: DesignScreen[];
  selected: boolean;
}

export interface DesignProposalsResult {
  planId: string;
  featureTitle: string;
  stitchProjectId?: string;
  stitchProjectUrl?: string;
  proposals: DesignProposal[];
  designSystemSynced: boolean;
  createdAt: string;
}

// ── Orchestration Plan ──────────────────────────────────────────
export type OrchestrationStep =
  | 'intake'
  | 'analyzing'
  | 'review'
  | 'design-proposals'
  | 'approved'
  | 'pushing'
  | 'pushed';

export interface OrchestrationPlan {
  id: string;
  featureId: string;
  step: OrchestrationStep;
  intake: FeatureIntake;
  laneDecisions: LaneDecision[];
  tasks: OrchestrationTask[];
  taskGraph: TaskGraphEdge[];
  designProposals?: DesignProposalsResult;
  linearProjectId?: string;
  linearProjectUrl?: string;
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
}
