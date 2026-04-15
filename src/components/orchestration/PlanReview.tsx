import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@appmirror/ui-kit';
import type { OrchestrationPlan, DesignAnnotation, TechAnnotation } from '../../types';
import { LANE_CONFIG, LANE_ORDER } from './constants';
import LaneColumn from './LaneColumn';
import TaskGraphView from './TaskGraphView';
import TaskNodeCard from './TaskNodeCard';
import DesignAnnotationForm from './DesignAnnotationForm';
import TechAnnotationForm from './TechAnnotationForm';
import ActivityFeed from './ActivityFeed';

export type PhaseMode = 'review' | 'design' | 'tech';

interface PlanReviewProps {
  plan: OrchestrationPlan;
  onApprove: () => void;
  onRefine: (feedback: string) => void;
  onUpdatePlan: (plan: OrchestrationPlan) => void;
  refining: boolean;
  approveLabel?: string;
  phaseMode?: PhaseMode;
}

type Tab = 'summary' | 'lanes' | 'graph';

export default function PlanReview({ plan, onApprove, onRefine, onUpdatePlan, refining, approveLabel, phaseMode = 'review' }: PlanReviewProps) {
  const [tab, setTab] = useState<Tab>('lanes');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const activeLanes = plan.laneDecisions.filter(l => l.needed);
  const totalTasks = plan.tasks.length;
  const highRiskTasks = plan.tasks.filter(t => t.riskFlags.some(rf => rf.severity === 'high'));

  // Dependency depth (longest path)
  const depthMap = new Map<string, number>();
  const getDepth = (id: string, visited = new Set<string>()): number => {
    if (depthMap.has(id)) return depthMap.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const task = plan.tasks.find(t => t.id === id);
    if (!task || task.dependsOn.length === 0) { depthMap.set(id, 0); return 0; }
    const d = 1 + Math.max(...task.dependsOn.map(dep => getDepth(dep, visited)));
    depthMap.set(id, d);
    return d;
  };
  plan.tasks.forEach(t => getDepth(t.id));
  const maxDepth = Math.max(...Array.from(depthMap.values()), 0);

  const selectedTask = selectedTaskId ? plan.tasks.find(t => t.id === selectedTaskId) : null;

  const handleToggleLane = (lane: string, enabled: boolean) => {
    onUpdatePlan({
      ...plan,
      laneDecisions: plan.laneDecisions.map(d =>
        d.lane === lane ? { ...d, needed: enabled } : d
      ),
    });
  };

  const handleUpdateTask = (updated: import('../../types').OrchestrationTask) => {
    onUpdatePlan({
      ...plan,
      tasks: plan.tasks.map(t => t.id === updated.id ? updated : t),
    });
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'lanes', label: 'Lanes' },
    { key: 'graph', label: 'Graph' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">
            {phaseMode === 'design' ? 'Design Specification' : phaseMode === 'tech' ? 'Technical Definition' : 'Review Execution Plan'}
          </h2>
          <p className="text-muted-foreground text-sm">{plan.intake.title}</p>
          {phaseMode === 'design' && (
            <p className="text-xs text-blue-500 mt-1">Add Figma links, UI specs, and interaction notes to relevant tasks</p>
          )}
          {phaseMode === 'tech' && (
            <p className="text-xs text-purple-500 mt-1">Add implementation notes, estimates, and raise technical challenges</p>
          )}
        </div>
        <div className="flex gap-2">
          {phaseMode !== 'review' && (
            <Badge variant="secondary" className="text-xs">
              {phaseMode === 'design' ? 'Design Phase' : 'Tech Phase'}
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          {tab === 'summary' && (
            <div className="space-y-4">
              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{totalTasks}</div>
                    <div className="text-xs text-muted-foreground">Total Tasks</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{activeLanes.length}</div>
                    <div className="text-xs text-muted-foreground">Active Lanes</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{maxDepth + 1}</div>
                    <div className="text-xs text-muted-foreground">Dependency Depth</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className={`text-2xl font-bold ${highRiskTasks.length > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {highRiskTasks.length}
                    </div>
                    <div className="text-xs text-muted-foreground">High Risk</div>
                  </CardContent>
                </Card>
              </div>

              {/* Lane breakdown */}
              <Card>
                <CardHeader><CardTitle>Lane Breakdown</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {LANE_ORDER.map(lane => {
                    const decision = plan.laneDecisions.find(d => d.lane === lane);
                    if (!decision?.needed) return null;
                    const laneTasks = plan.tasks.filter(t => t.lane === lane);
                    const config = LANE_CONFIG[lane];
                    return (
                      <div key={lane} className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${config.color}`} />
                        <span className="text-sm font-medium w-24">{config.label}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${config.color} rounded-full`}
                            style={{ width: `${(laneTasks.length / Math.max(totalTasks, 1)) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{laneTasks.length} tasks</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* High risk items */}
              {highRiskTasks.length > 0 && (
                <Card className="border-red-200 dark:border-red-800">
                  <CardHeader>
                    <CardTitle className="text-red-600 dark:text-red-400">High Risk Items</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {highRiskTasks.map(task => (
                      <TaskNodeCard key={task.id} task={task} onClick={() => setSelectedTaskId(task.id)} />
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Intake summary */}
              <Card>
                <CardHeader><CardTitle>Feature Intake</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div><strong>Problem:</strong> {plan.intake.problem}</div>
                  <div><strong>Goal:</strong> {plan.intake.goal}</div>
                  {plan.intake.successMetric && <div><strong>Metric:</strong> {plan.intake.successMetric}</div>}
                  {plan.intake.inScope.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      <strong>In scope:</strong>
                      {plan.intake.inScope.map((s, i) => <Badge key={i} variant="secondary">{s}</Badge>)}
                    </div>
                  )}
                  {plan.intake.outOfScope.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      <strong>Out of scope:</strong>
                      {plan.intake.outOfScope.map((s, i) => <Badge key={i} variant="secondary" className="opacity-60">{s}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'lanes' && (
            <div className="space-y-3">
              {LANE_ORDER.map(lane => {
                const decision = plan.laneDecisions.find(d => d.lane === lane);
                if (!decision) return null;
                const laneTasks = plan.tasks.filter(t => t.lane === lane);
                if (!decision.needed && laneTasks.length === 0) return null;
                return (
                  <LaneColumn
                    key={lane}
                    decision={decision}
                    tasks={laneTasks}
                    selectedTaskId={selectedTaskId ?? undefined}
                    onSelectTask={setSelectedTaskId}
                    onToggleLane={handleToggleLane}
                    onUpdateTask={handleUpdateTask}
                  />
                );
              })}
            </div>
          )}

          {tab === 'graph' && (
            <TaskGraphView
              tasks={plan.tasks}
              edges={plan.taskGraph}
              selectedTaskId={selectedTaskId ?? undefined}
              onSelectTask={setSelectedTaskId}
            />
          )}
        </div>

        {/* Right sidebar: selected task detail + feedback */}
        <div className="w-80 flex-shrink-0 space-y-4 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
          {/* Selected task detail */}
          {selectedTask && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Task Detail</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="text-sm font-semibold">{selectedTask.title}</div>
                  <p className="text-xs text-muted-foreground mt-1">{selectedTask.description}</p>
                </div>

                <div className="flex gap-1 flex-wrap">
                  <Badge variant="secondary" className={LANE_CONFIG[selectedTask.lane].textColor}>
                    {LANE_CONFIG[selectedTask.lane].label}
                  </Badge>
                  {selectedTask.serviceId !== 'none' && (
                    <Badge variant="secondary">{selectedTask.serviceId}</Badge>
                  )}
                </div>

                {selectedTask.acceptanceCriteria.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">Acceptance Criteria</div>
                    <ul className="space-y-1">
                      {selectedTask.acceptanceCriteria.map((ac, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                          <span className="text-muted-foreground/50">-</span>
                          {ac}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedTask.riskFlags.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">Risk Flags</div>
                    {selectedTask.riskFlags.map((rf, i) => (
                      <div key={i} className={`text-xs p-1.5 rounded mb-1 ${
                        rf.severity === 'high' ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' :
                        rf.severity === 'medium' ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300' :
                        'bg-gray-50 text-gray-600 dark:bg-gray-900 dark:text-gray-400'
                      }`}>
                        <strong>{rf.type}</strong>: {rf.description}
                      </div>
                    ))}
                  </div>
                )}

                {selectedTask.dependsOn.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">Depends On</div>
                    {selectedTask.dependsOn.map(depId => {
                      const dep = plan.tasks.find(t => t.id === depId);
                      return dep ? (
                        <button
                          key={depId}
                          onClick={() => setSelectedTaskId(depId)}
                          className="text-xs text-primary hover:underline block"
                        >
                          {dep.title}
                        </button>
                      ) : null;
                    })}
                  </div>
                )}

                {/* Design annotation — show editable in design phase, read-only if annotation exists in other phases */}
                {(phaseMode === 'design' || selectedTask.designAnnotation) && (
                  <DesignAnnotationForm
                    annotation={selectedTask.designAnnotation}
                    readOnly={phaseMode !== 'design'}
                    onSave={(annotation: DesignAnnotation) => {
                      handleUpdateTask({ ...selectedTask, designAnnotation: annotation });
                    }}
                  />
                )}

                {/* Tech annotation — show editable in tech phase, read-only if annotation exists in other phases */}
                {(phaseMode === 'tech' || selectedTask.techAnnotation) && (
                  <TechAnnotationForm
                    annotation={selectedTask.techAnnotation}
                    readOnly={phaseMode !== 'tech'}
                    onSave={(annotation: TechAnnotation) => {
                      handleUpdateTask({ ...selectedTask, techAnnotation: annotation });
                    }}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Feedback / refine */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Request Changes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Describe what should be different..."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm min-h-[100px] resize-y"
              />
              <Button
                variant="secondary"
                onClick={() => { if (feedback.trim()) { onRefine(feedback); setFeedback(''); } }}
                disabled={!feedback.trim() || refining}
                className="w-full"
              >
                {refining ? 'Refining...' : 'Submit Feedback'}
              </Button>

              {plan.reviewNotes.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border">
                  <div className="text-[10px] text-muted-foreground font-medium">Previous feedback</div>
                  {plan.reviewNotes.map((note, i) => (
                    <p key={i} className="text-xs text-muted-foreground italic">"{note}"</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity feed */}
          {plan.activityLog && plan.activityLog.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <ActivityFeed activities={plan.activityLog} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {/* Sticky bottom approve bar */}
      <div className="sticky bottom-0 bg-background border-t border-border p-4 -mx-6 -mb-6 px-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalTasks} tasks · {activeLanes.length} lanes
          {highRiskTasks.length > 0 && (
            <span className="text-red-500 ml-2">· {highRiskTasks.length} high-risk</span>
          )}
        </p>
        <Button variant="primary" onClick={onApprove}>
          {approveLabel || 'Approve & Push to Linear'}
        </Button>
      </div>
    </div>
  );
}
