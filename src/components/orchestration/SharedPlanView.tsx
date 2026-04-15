import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@appmirror/ui-kit';
import type { OrchestrationPlan, PlanRole } from '../../types';
import { LANE_CONFIG, LANE_ORDER } from './constants';
import LaneColumn from './LaneColumn';
import TaskGraphView from './TaskGraphView';
import TaskNodeCard from './TaskNodeCard';
import PlanHeader from './PlanHeader';

interface SharedPlanViewProps {
  plan: OrchestrationPlan;
  role?: PlanRole;
  onBack: () => void;
}

type Tab = 'summary' | 'lanes' | 'graph';

const DESIGN_LANES = new Set(['design', 'ios', 'android', 'web']);

export default function SharedPlanView({ plan, role, onBack }: SharedPlanViewProps) {
  const [tab, setTab] = useState<Tab>('lanes');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Filter tasks based on role
  const visibleTasks = role === 'designer'
    ? plan.tasks.filter(t => DESIGN_LANES.has(t.lane))
    : plan.tasks;

  const visibleLaneDecisions = role === 'designer'
    ? plan.laneDecisions.filter(d => DESIGN_LANES.has(d.lane))
    : plan.laneDecisions;

  const activeLanes = visibleLaneDecisions.filter(l => l.needed);
  const highRiskTasks = visibleTasks.filter(t => t.riskFlags.some(rf => rf.severity === 'high'));
  const selectedTask = selectedTaskId ? visibleTasks.find(t => t.id === selectedTaskId) : null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'lanes', label: 'Lanes' },
    { key: 'graph', label: 'Graph' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back
        </button>
        {role && (
          <Badge variant="secondary" className="text-[10px]">
            Viewing as: {role === 'po' ? 'Product Owner' : role === 'designer' ? 'Designer' : 'Developer'}
          </Badge>
        )}
      </div>

      <PlanHeader plan={plan} />

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

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          {tab === 'summary' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{visibleTasks.length}</div>
                    <div className="text-xs text-muted-foreground">Tasks</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{activeLanes.length}</div>
                    <div className="text-xs text-muted-foreground">Lanes</div>
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
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">
                      {visibleTasks.reduce((sum, t) => sum + (t.techAnnotation?.estimateHours || 0), 0) || '—'}
                    </div>
                    <div className="text-xs text-muted-foreground">Est. Hours</div>
                  </CardContent>
                </Card>
              </div>

              {/* Intake summary (PO and dev see this) */}
              {role !== 'designer' && (
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
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {tab === 'lanes' && (
            <div className="space-y-3">
              {LANE_ORDER.map(lane => {
                const decision = visibleLaneDecisions.find(d => d.lane === lane);
                if (!decision) return null;
                const laneTasks = visibleTasks.filter(t => t.lane === lane);
                if (!decision.needed && laneTasks.length === 0) return null;
                return (
                  <LaneColumn
                    key={lane}
                    decision={decision}
                    tasks={laneTasks}
                    selectedTaskId={selectedTaskId ?? undefined}
                    onSelectTask={setSelectedTaskId}
                  />
                );
              })}
            </div>
          )}

          {tab === 'graph' && (
            <TaskGraphView
              tasks={visibleTasks}
              edges={plan.taskGraph.filter(e =>
                visibleTasks.some(t => t.id === e.fromTaskId) && visibleTasks.some(t => t.id === e.toTaskId)
              )}
              selectedTaskId={selectedTaskId ?? undefined}
              onSelectTask={setSelectedTaskId}
            />
          )}
        </div>

        {/* Right sidebar: selected task detail */}
        {selectedTask && (
          <div className="w-80 flex-shrink-0 space-y-4 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
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
                          <span className="text-primary">&#10003;</span> {ac}
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

                {/* Design annotation (read-only) */}
                {selectedTask.designAnnotation && (
                  <div className="border-t border-border pt-3">
                    <div className="text-xs font-medium mb-1 text-blue-600 dark:text-blue-400">Design Spec</div>
                    {selectedTask.designAnnotation.figmaUrl && (
                      <a href={selectedTask.designAnnotation.figmaUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline block mb-1">
                        Figma Link
                      </a>
                    )}
                    {selectedTask.designAnnotation.uiSpecs && (
                      <p className="text-xs text-muted-foreground">{selectedTask.designAnnotation.uiSpecs}</p>
                    )}
                    {selectedTask.designAnnotation.interactionNotes && (
                      <p className="text-xs text-muted-foreground mt-1">{selectedTask.designAnnotation.interactionNotes}</p>
                    )}
                  </div>
                )}

                {/* Tech annotation (read-only) */}
                {selectedTask.techAnnotation && (
                  <div className="border-t border-border pt-3">
                    <div className="text-xs font-medium mb-1 text-purple-600 dark:text-purple-400">Tech Notes</div>
                    {selectedTask.techAnnotation.implementationNotes && (
                      <p className="text-xs text-muted-foreground">{selectedTask.techAnnotation.implementationNotes}</p>
                    )}
                    {selectedTask.techAnnotation.estimateHours != null && (
                      <p className="text-xs text-muted-foreground mt-1">Estimate: {selectedTask.techAnnotation.estimateHours}h</p>
                    )}
                    {selectedTask.techAnnotation.challengesRaised && selectedTask.techAnnotation.challengesRaised.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[10px] font-medium text-muted-foreground">Challenges</div>
                        {selectedTask.techAnnotation.challengesRaised.map((c, i) => (
                          <p key={i} className="text-xs text-orange-600 dark:text-orange-400">- {c}</p>
                        ))}
                      </div>
                    )}
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
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
