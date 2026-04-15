import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@appmirror/ui-kit';
import type { OrchestrationPlan } from '../../types';
import { LANE_CONFIG } from './constants';

interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

interface PushResult {
  type: string;
  taskId?: string;
  linearId?: string;
  url?: string;
  success: boolean;
  error?: string;
}

interface LinearPushPanelProps {
  plan: OrchestrationPlan;
  apiBase: string;
  onPushComplete: (parentUrl: string) => void;
}

export default function LinearPushPanel({ plan, apiBase, onPushComplete }: LinearPushPanelProps) {
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [pushing, setPushing] = useState(false);
  const [results, setResults] = useState<PushResult[] | null>(null);
  const [parentUrl, setParentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/orchestrate/linear-config`)
      .then(r => r.json())
      .then(data => {
        setConfigured(data.configured);
        setTeams(data.teams || []);
        // Default parent issue to the "dua" team, fallback to first team
        const duaTeam = data.teams?.find((t: LinearTeam) => t.key === 'DUA');
        if (duaTeam) setSelectedTeamId(duaTeam.id);
        else if (data.teams?.length) setSelectedTeamId(data.teams[0].id);
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, [apiBase]);

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/orchestrate/push-to-linear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, teamId: selectedTeamId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Push failed');
      setResults(data.results);
      setParentUrl(data.project?.url);
      if (data.project?.url) onPushComplete(data.project.url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPushing(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <span className="text-sm text-muted-foreground">Checking Linear connection...</span>
        </CardContent>
      </Card>
    );
  }

  if (!configured) {
    return (
      <Card className="border-yellow-200 dark:border-yellow-800">
        <CardContent className="p-6 text-center">
          <div className="text-yellow-600 dark:text-yellow-400 text-lg font-semibold mb-2">Linear Not Configured</div>
          <p className="text-sm text-muted-foreground mb-3">
            Set the <code className="px-1 py-0.5 bg-muted rounded text-xs">LINEAR_API_KEY</code> environment variable in your <code className="px-1 py-0.5 bg-muted rounded text-xs">.env</code> file to enable Linear integration.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Show results after push
  if (results) {
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return (
      <div className="space-y-4">
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="p-6 text-center">
            <div className="text-green-600 dark:text-green-400 text-lg font-semibold mb-2">
              Pushed to Linear
            </div>
            <p className="text-sm text-muted-foreground">
              {successCount} issues created{failCount > 0 ? `, ${failCount} failed` : ''}
            </p>
            {parentUrl && (
              <a
                href={parentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 text-primary text-sm hover:underline"
              >
                Open project in Linear
              </a>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Issue Results</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={r.success ? 'text-green-500' : 'text-red-500'}>
                  {r.success ? 'OK' : 'FAIL'}
                </span>
                <span className="text-muted-foreground">
                  {r.type === 'project' ? 'Project' : plan.tasks.find(t => t.id === r.taskId)?.title || r.taskId}
                </span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto">
                    View
                  </a>
                )}
                {r.error && <span className="text-red-400 ml-auto">{r.error}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pre-push configuration
  const activeLanes = plan.laneDecisions.filter(l => l.needed);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Push to Linear</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Team selector — project default team */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Project Team</label>
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm"
            >
              {teams.map(team => (
                <option key={team.id} value={team.id}>{team.name} ({team.key})</option>
              ))}
            </select>
          </div>

          {/* What will be created */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Will Create</label>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>1 project: <strong>{plan.intake.title}</strong></div>
              <div>{plan.tasks.length} issues with dependencies</div>
              <div>{plan.taskGraph.length} dependency relations</div>
              {(() => {
                const totalHours = plan.tasks.reduce((sum, t) => sum + (t.techAnnotation?.estimateHours || 0), 0);
                const designCount = plan.tasks.filter(t => t.designAnnotation).length;
                const techCount = plan.tasks.filter(t => t.techAnnotation).length;
                return (
                  <>
                    {totalHours > 0 && <div>Total estimate: <strong>{totalHours}h</strong></div>}
                    {designCount > 0 && <div>{designCount} tasks with design specs</div>}
                    {techCount > 0 && <div>{techCount} tasks with tech notes</div>}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Team routing preview */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Task Routing</label>
            <p className="text-[10px] text-muted-foreground">Tasks are auto-routed to the right team by lane</p>
            <div className="space-y-1">
              {activeLanes.map(l => {
                const teamMap: Record<string, string> = { backend: 'Backend', ios: 'iOS', android: 'Android', qa: 'QA', design: 'UX/UI', web: 'Backend', analytics: 'Backend', docs: 'Backend', infra: 'Backend', release: 'Backend' };
                const taskCount = plan.tasks.filter(t => t.lane === l.lane).length;
                return (
                  <div key={l.lane} className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className={`text-[10px] ${LANE_CONFIG[l.lane].textColor}`}>
                      {LANE_CONFIG[l.lane].label}
                    </Badge>
                    <span className="text-muted-foreground">{taskCount} tasks</span>
                    <span className="text-muted-foreground ml-auto">→ {teamMap[l.lane] || 'Backend'} team</span>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <Button
            variant="primary"
            onClick={handlePush}
            disabled={pushing || !selectedTeamId}
            className="w-full"
          >
            {pushing ? 'Pushing...' : `Push ${plan.tasks.length} Issues to Linear`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
