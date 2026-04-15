import { useState } from 'react';
import { Badge, Button } from '@appmirror/ui-kit';
import type { OrchestrationPlan, PlanRole } from '../../types';

interface PlanHeaderProps {
  plan: OrchestrationPlan;
}

const PHASE_LABELS: Record<string, string> = {
  'product-definition': 'Product Definition',
  'design-specification': 'Design Specification',
  'technical-definition': 'Technical Definition',
  'approval': 'Approval',
  'pushed': 'Pushed to Linear',
};

const ROLE_OPTIONS: { value: PlanRole; label: string }[] = [
  { value: 'po', label: 'Product Owner' },
  { value: 'designer', label: 'Designer' },
  { value: 'dev', label: 'Developer' },
];

export default function PlanHeader({ plan }: PlanHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [shareRole, setShareRole] = useState<PlanRole>('dev');

  const copyLink = (role: PlanRole) => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = `${base}?planId=${plan.id}&role=${role}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const phases = plan.phases || [];

  return (
    <div className="space-y-3">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{plan.intake.title}</h2>
          {plan.currentPhase && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Phase: <span className="font-medium text-foreground">{PHASE_LABELS[plan.currentPhase] || plan.currentPhase}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={shareRole}
            onChange={(e) => setShareRole(e.target.value as PlanRole)}
            className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground"
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => copyLink(shareRole)}
            className="text-xs px-3 py-1 h-auto"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
        </div>
      </div>

      {/* Phase stepper */}
      {phases.length > 0 && (
        <div className="flex items-center gap-1">
          {phases.map((p, i) => {
            const isComplete = p.status === 'complete';
            const isActive = p.status === 'in-progress';
            return (
              <div key={p.phase} className="flex items-center gap-1">
                {i > 0 && (
                  <div className={`w-6 h-0.5 ${isComplete ? 'bg-green-500' : isActive ? 'bg-primary' : 'bg-muted'}`} />
                )}
                <div className="flex items-center gap-1">
                  <div className={`
                    w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                    ${isComplete ? 'bg-green-500 text-white' : isActive ? 'bg-primary/20 text-primary border border-primary' : 'bg-muted text-muted-foreground'}
                  `}>
                    {isComplete ? (
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : i + 1}
                  </div>
                  <span className={`text-[10px] font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {PHASE_LABELS[p.phase]?.split(' ')[0] || p.phase}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity summary */}
      {plan.activityLog && plan.activityLog.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          Last activity: {plan.activityLog[plan.activityLog.length - 1].action}
          {' '}({new Date(plan.activityLog[plan.activityLog.length - 1].timestamp).toLocaleDateString()})
        </div>
      )}
    </div>
  );
}
