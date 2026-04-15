// ── Design System Audit Types ───────────────────────────────────

export type PlatformStatus = 'covered' | 'partial' | 'missing';

export interface PlatformCoverage {
  ios: PlatformStatus;
  android: PlatformStatus;
}

export interface CodeMatch {
  name: string;
  file: string;
  type: 'view' | 'component' | 'composable' | 'xml-view';
  props: string[];
}

/** A component discovered from the Figma design system file, cross-referenced with code */
export interface DesignComponent {
  key: string;
  name: string;
  description: string;
  componentSetName?: string;
  containingFrame?: string;
  thumbnailUrl?: string;
  variants: DesignVariant[];
  platform: PlatformCoverage;
  hasSpec: boolean;
  codeMatches?: {
    ios: CodeMatch[];
    android: CodeMatch[];
  };
}

export interface DesignVariant {
  name: string;
  properties: Record<string, string>;
}

// ── Generated Spec ──────────────────────────────────────────────

export interface AnatomyPart {
  name: string;
  description: string;
  required: boolean;
}

export interface PropDefinition {
  name: string;
  type: string;
  defaultValue: string;
  description: string;
  platform: 'ios' | 'android' | 'both';
}

export interface VariantSpec {
  name: string;
  values: string[];
  description: string;
}

export interface ColorToken {
  token: string;
  hex: string;
  usage: string;
}

export interface SpacingValue {
  property: string;
  value: string;
  description: string;
}

export interface AccessibilityRequirement {
  rule: string;
  wcagLevel: 'A' | 'AA' | 'AAA';
  description: string;
}

export interface ComponentSpec {
  componentKey: string;
  componentName: string;
  platform: 'ios' | 'android';
  generatedAt: string;
  anatomy: AnatomyPart[];
  props: PropDefinition[];
  variants: VariantSpec[];
  colors: ColorToken[];
  spacing: SpacingValue[];
  accessibility: AccessibilityRequirement[];
  usageGuidelines: string;
}

// ── Audit Result ────────────────────────────────────────────────

export interface CoverageStats {
  total: number;
  iosCovered: number;
  iosPartial: number;
  iosMissing: number;
  androidCovered: number;
  androidPartial: number;
  androidMissing: number;
}

export interface CodeScanResult {
  path: string | null;
  componentCount: number;
  components: CodeMatch[];
}

export interface AuditResult {
  fileKey: string;
  fileName: string;
  scannedAt: string;
  components: DesignComponent[];
  stats: CoverageStats;
  codeScan?: {
    ios: CodeScanResult;
    android: CodeScanResult;
  };
}
