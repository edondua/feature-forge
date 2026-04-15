import { useState } from 'react';
import { Badge, Button } from '@appmirror/ui-kit';
import type { OrchestrationTask } from '../../types';
import { LANE_CONFIG } from './constants';

interface TaskNodeCardProps {
  task: OrchestrationTask;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
  onUpdate?: (updated: OrchestrationTask) => void;
}

export default function TaskNodeCard({ task, selected, compact, onClick, onUpdate }: TaskNodeCardProps) {
  const laneConfig = LANE_CONFIG[task.lane];
  const highRisk = task.riskFlags.some(rf => rf.severity === 'high');
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({ title: task.title, description: task.description, acceptanceCriteria: task.acceptanceCriteria });

  const saveEdit = () => {
    onUpdate?.({ ...task, ...draft });
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft({ title: task.title, description: task.description, acceptanceCriteria: task.acceptanceCriteria });
    setEditing(false);
  };

  const updateAC = (index: number, value: string) => {
    const updated = [...draft.acceptanceCriteria];
    updated[index] = value;
    setDraft(d => ({ ...d, acceptanceCriteria: updated }));
  };

  const addAC = () => {
    setDraft(d => ({ ...d, acceptanceCriteria: [...d.acceptanceCriteria, ''] }));
  };

  const removeAC = (index: number) => {
    setDraft(d => ({ ...d, acceptanceCriteria: d.acceptanceCriteria.filter((_, i) => i !== index) }));
  };

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`
          px-3 py-2 rounded-lg border-2 transition-all cursor-pointer text-left
          ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/30'}
          ${highRisk ? 'ring-1 ring-red-300 dark:ring-red-700' : ''}
        `}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${laneConfig.color}`} />
          <span className="text-xs font-medium truncate">{task.title}</span>
          {highRisk && <span className="text-red-500 text-[10px]">!</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`
        rounded-lg border-2 transition-all text-left
        ${selected && !editing ? 'border-primary bg-primary/5' : 'border-border bg-card'}
        ${highRisk ? 'ring-1 ring-red-300 dark:ring-red-700' : ''}
      `}
    >
      {editing ? (
        /* ── Inline editor ── */
        <div className="p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))}
            className="w-full text-sm font-medium px-2 py-1 rounded border border-border bg-background"
          />
          <textarea
            value={draft.description}
            onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))}
            rows={3}
            className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-muted-foreground resize-y"
          />
          <div>
            <div className="text-[10px] font-medium text-muted-foreground mb-1">Acceptance Criteria</div>
            {draft.acceptanceCriteria.map((ac, i) => (
              <div key={i} className="flex gap-1 mb-1">
                <input
                  value={ac}
                  onChange={(e) => updateAC(i, e.target.value)}
                  className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background"
                  placeholder="Acceptance criterion..."
                />
                <button
                  onClick={() => removeAC(i)}
                  className="text-muted-foreground hover:text-foreground px-1"
                >&times;</button>
              </div>
            ))}
            <button
              onClick={addAC}
              className="text-[10px] text-primary hover:underline"
            >+ Add criterion</button>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save</Button>
          </div>
        </div>
      ) : (
        /* ── Read view ── */
        <div
          onClick={onClick}
          className={`p-3 ${onClick ? 'cursor-pointer hover:bg-muted/30' : ''}`}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-sm font-medium">{task.title}</span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {highRisk && (
                <span className="text-red-500 text-xs font-bold">HIGH RISK</span>
              )}
              {onUpdate && (
                <button
                  onClick={(e) => { e.stopPropagation(); setDraft({ title: task.title, description: task.description, acceptanceCriteria: task.acceptanceCriteria }); setEditing(true); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  Edit
                </button>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>

          {task.acceptanceCriteria.length > 0 && (
            <div className="mb-2">
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {expanded ? '▾' : '▸'} {task.acceptanceCriteria.length} acceptance criteria
              </button>
              {expanded && (
                <ul className="mt-1 space-y-0.5">
                  {task.acceptanceCriteria.map((ac, i) => (
                    <li key={i} className="text-[10px] text-muted-foreground flex gap-1.5">
                      <span className="text-primary">✓</span> {ac}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className={`text-[10px] ${laneConfig.textColor}`}>
              {laneConfig.label}
            </Badge>
            {task.serviceId && task.serviceId !== 'none' && (
              <Badge variant="secondary" className="text-[10px]">{task.serviceId}</Badge>
            )}
            {task.designAnnotation && (
              <span className="text-[10px] px-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" title="Has design spec">
                Design
              </span>
            )}
            {task.techAnnotation && (
              <span className="text-[10px] px-1 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" title="Has tech notes">
                Tech{task.techAnnotation.estimateHours ? ` ${task.techAnnotation.estimateHours}h` : ''}
              </span>
            )}
            {task.dependsOn.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{task.dependsOn.length} deps</span>
            )}
            {task.riskFlags.map((rf, i) => (
              <span
                key={i}
                className={`text-[10px] px-1 rounded ${
                  rf.severity === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                  rf.severity === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {rf.type}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
