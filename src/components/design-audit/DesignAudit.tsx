import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Input, Button, Badge } from '@appmirror/ui-kit';
import type { AuditResult, DesignComponent, ComponentSpec } from '../../types/design-audit';
import AuditDashboard from './AuditDashboard';

interface DesignAuditProps {
  apiBase: string;
  onBack: () => void;
}

type Phase = 'input' | 'scanning' | 'results' | 'error';

export default function DesignAudit({ apiBase, onBack }: DesignAuditProps) {
  const [figmaUrl, setFigmaUrl] = useState('');
  const [iosPath, setIosPath] = useState('');
  const [androidPath, setAndroidPath] = useState('');
  const [showRepoPaths, setShowRepoPaths] = useState(false);
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState('');
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [specs, setSpecs] = useState<ComponentSpec[]>([]);
  const [generatingSpec, setGeneratingSpec] = useState<{ componentKey: string; platform: string } | null>(null);
  const [pushingToLinear, setPushingToLinear] = useState(false);
  const [linearResults, setLinearResults] = useState<{ summary: string; results: unknown[] } | null>(null);

  const handleScan = useCallback(async () => {
    if (!figmaUrl.includes('figma.com')) {
      setError('Please enter a valid Figma URL');
      return;
    }

    setPhase('scanning');
    setError('');

    try {
      const resp = await fetch(`${apiBase}/api/design-audit/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figmaUrl,
          ...(iosPath ? { iosPath } : {}),
          ...(androidPath ? { androidPath } : {}),
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.error || 'Scan failed');
      }

      const data = await resp.json();
      setAudit(data);
      setPhase('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
      setPhase('error');
    }
  }, [figmaUrl, apiBase]);

  const handleGenerateSpec = useCallback(async (component: DesignComponent, platform: 'ios' | 'android') => {
    setGeneratingSpec({ componentKey: component.key, platform });

    try {
      const resp = await fetch(`${apiBase}/api/design-audit/generate-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component, platform }),
      });

      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.error || 'Spec generation failed');
      }

      const data = await resp.json();
      setSpecs(prev => [...prev.filter(s =>
        !(s.componentKey === component.key && s.platform === platform)
      ), data.spec]);
    } catch (err) {
      console.error('Spec generation error:', err);
    } finally {
      setGeneratingSpec(null);
    }
  }, [apiBase]);

  const handleGenerateAllMissing = useCallback(async () => {
    if (!audit) return;

    const missing = audit.components.filter(
      c => c.platform.ios !== 'covered' || c.platform.android !== 'covered'
    );

    for (const comp of missing) {
      if (comp.platform.ios !== 'covered') {
        await handleGenerateSpec(comp, 'ios');
      }
      if (comp.platform.android !== 'covered') {
        await handleGenerateSpec(comp, 'android');
      }
    }
  }, [audit, handleGenerateSpec]);

  const handlePushToLinear = useCallback(async () => {
    if (!audit) return;

    setPushingToLinear(true);
    setLinearResults(null);

    try {
      // Get Linear config to find team
      const configResp = await fetch(`${apiBase}/api/orchestrate/linear-config`);
      const config = await configResp.json();

      if (!config.configured || !config.teams.length) {
        setError('Linear is not configured. Set LINEAR_API_KEY in .env');
        setPushingToLinear(false);
        return;
      }

      const teamId = config.teams[0].id;
      const missing = audit.components.filter(
        c => c.platform.ios !== 'covered' || c.platform.android !== 'covered'
      );

      const resp = await fetch(`${apiBase}/api/design-audit/push-to-linear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: missing, teamId, specs }),
      });

      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.error || 'Push to Linear failed');
      }

      const data = await resp.json();
      setLinearResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push to Linear failed');
    } finally {
      setPushingToLinear(false);
    }
  }, [audit, specs, apiBase]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              aria-label="Back to feature list"
              className="p-2 -m-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold">Design System Audit</h1>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground opacity-60">Beta</span>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5 ml-7">
            Scan your Figma design system, audit iOS + Android coverage, auto-generate specs
          </p>
        </div>
      </div>

      {/* Input phase */}
      {(phase === 'input' || phase === 'error') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
                <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
                <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
                <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
                <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
              </svg>
              Connect your Figma Design System
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste your Figma design system URL. We'll scan all components and cross-reference
              them against your actual iOS and Android code repos to find what's implemented and what's missing.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                placeholder="https://www.figma.com/file/..."
                aria-label="Figma file URL"
                className="flex-1 min-w-0"
                onKeyDown={(e) => { if (e.key === 'Enter' && figmaUrl.includes('figma.com')) { e.preventDefault(); handleScan(); } }}
              />
              <Button variant="primary" onClick={handleScan} disabled={!figmaUrl.includes('figma.com')}>
                Scan
              </Button>
            </div>

            {/* Repo path toggle */}
            <button
              onClick={() => setShowRepoPaths(!showRepoPaths)}
              aria-expanded={showRepoPaths}
              aria-controls="repo-paths-section"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <svg className={`w-3 h-3 transition-transform ${showRepoPaths ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Repo paths {!showRepoPaths && <span className="text-muted-foreground">(optional)</span>}
            </button>

            {showRepoPaths && (
              <div id="repo-paths-section" className="space-y-3 pl-4 border-l-2 border-border">
                <p className="text-xs text-muted-foreground">
                  Paste GitHub repo URLs to scan your code remotely. We'll fetch Swift and Kotlin files
                  via the GitHub API and cross-reference against Figma components.
                </p>
                <div className="flex items-center gap-2">
                  <label htmlFor="ios-repo-path" className="text-xs font-medium w-16 flex-shrink-0">iOS</label>
                  <Input
                    id="ios-repo-path"
                    value={iosPath}
                    onChange={(e) => setIosPath(e.target.value)}
                    placeholder="https://github.com/org/ios-app"
                    className="flex-1 min-w-0 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="android-repo-path" className="text-xs font-medium w-16 flex-shrink-0">Android</label>
                  <Input
                    id="android-repo-path"
                    value={androidPath}
                    onChange={(e) => setAndroidPath(e.target.value)}
                    placeholder="https://github.com/org/android-app"
                    className="flex-1 min-w-0 text-xs"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Set GITHUB_TOKEN in .env for private repos. Also accepts local paths or env vars (IOS_REPO_URL, ANDROID_REPO_URL).
                </p>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Scanning phase */}
      {phase === 'scanning' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <div className="text-lg font-medium">Scanning Figma file...</div>
            <p className="text-sm text-muted-foreground mt-1">
              Crawling components, detecting platform coverage, analyzing specs
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results phase */}
      {phase === 'results' && audit && (
        <>
          {/* File info bar */}
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="primary">{audit.fileName}</Badge>
            <span className="text-muted-foreground">
              Scanned {new Date(audit.scannedAt).toLocaleString()}
            </span>
            <button
              onClick={() => { setPhase('input'); setAudit(null); setSpecs([]); setLinearResults(null); }}
              className="text-xs text-primary hover:underline ml-auto"
            >
              Scan different file
            </button>
          </div>

          {/* Code scan info */}
          {audit.codeScan && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className={`text-xs rounded-md px-3 py-2 border ${
                audit.codeScan.ios.path
                  ? 'bg-green-500/5 border-green-500/20 text-green-700'
                  : 'bg-muted border-border text-muted-foreground'
              }`}>
                <span className="font-medium">iOS repo:</span>{' '}
                {audit.codeScan.ios.path
                  ? `${audit.codeScan.ios.componentCount} components found in ${audit.codeScan.ios.path.split('/').slice(-2).join('/')}`
                  : 'Not connected — set IOS_REPO_PATH or configure repo paths above'
                }
              </div>
              <div className={`text-xs rounded-md px-3 py-2 border ${
                audit.codeScan.android.path
                  ? 'bg-green-500/5 border-green-500/20 text-green-700'
                  : 'bg-muted border-border text-muted-foreground'
              }`}>
                <span className="font-medium">Android repo:</span>{' '}
                {audit.codeScan.android.path
                  ? `${audit.codeScan.android.componentCount} components found in ${audit.codeScan.android.path.split('/').slice(-2).join('/')}`
                  : 'Not connected — set ANDROID_REPO_PATH or configure repo paths above'
                }
              </div>
            </div>
          )}

          {/* Linear push results */}
          {linearResults && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium">{linearResults.summary}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <AuditDashboard
            audit={audit}
            specs={specs}
            onGenerateSpec={handleGenerateSpec}
            onGenerateAllMissing={handleGenerateAllMissing}
            onPushToLinear={handlePushToLinear}
            generatingSpec={generatingSpec}
            pushingToLinear={pushingToLinear}
          />
        </>
      )}
    </div>
  );
}
