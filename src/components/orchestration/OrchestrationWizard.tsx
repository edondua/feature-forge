import { useState, useCallback, useMemo } from 'react';
import { Button, Badge } from '@appmirror/ui-kit';
import type { FeatureIntake, OrchestrationPlan } from '../../types';
import IntakeForm from './IntakeForm';
import AnalyzingState from './AnalyzingState';
import PlanReview from './PlanReview';
import DesignProposalsPanel from './DesignProposalsPanel';
import LinearPushPanel from './LinearPushPanel';

interface OrchestrationWizardProps {
  featureId?: string;
  apiBase: string;
  onComplete: (plan: OrchestrationPlan) => void;
  onCancel: () => void;
}

type Step = 'intake' | 'analyzing' | 'review' | 'design-proposals' | 'push' | 'done';

export default function OrchestrationWizard({ featureId, apiBase, onComplete, onCancel }: OrchestrationWizardProps) {
  const [step, setStep] = useState<Step>('intake');
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);

  // Dynamic steps — include "Design" only when design lane is active
  const hasDesignLane = plan?.laneDecisions?.some(l => l.lane === 'design' && l.needed) ?? false;

  const steps = useMemo(() => {
    const base: { key: Step; label: string }[] = [
      { key: 'intake', label: 'Intake' },
      { key: 'analyzing', label: 'Analyze' },
      { key: 'review', label: 'Review' },
    ];
    if (hasDesignLane) {
      base.push({ key: 'design-proposals', label: 'Design' });
    }
    base.push({ key: 'push', label: 'Linear' });
    return base;
  }, [hasDesignLane]);

  const handleIntakeSubmit = useCallback(async (intake: FeatureIntake, services: string[], _targetMode: string) => {
    setStep('analyzing');
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/orchestrate/decompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intake, services, featureId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Decomposition failed');

      setPlan(data.plan);
      setStep('review');
    } catch (err: any) {
      setError(err.message);
      setStep('intake');
    }
  }, [apiBase, featureId]);

  const handleRefine = useCallback(async (feedback: string) => {
    if (!plan) return;
    setRefining(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/orchestrate/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, feedback }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refinement failed');

      setPlan(data.plan);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefining(false);
    }
  }, [apiBase, plan]);

  const handleApprove = useCallback(() => {
    if (!plan) return;
    setPlan({ ...plan, step: 'approved' });
    // Route to design proposals if design lane is active, otherwise straight to push
    const needsDesign = plan.laneDecisions.some(l => l.lane === 'design' && l.needed);
    setStep(needsDesign ? 'design-proposals' : 'push');
  }, [plan]);

  const handleDesignProposalSelected = useCallback((updatedPlan: OrchestrationPlan) => {
    setPlan(updatedPlan);
    setStep('push');
  }, []);

  const handleSkipDesign = useCallback(() => {
    setStep('push');
  }, []);

  const handlePushComplete = useCallback((projectUrl: string) => {
    if (!plan) return;
    const updated = { ...plan, step: 'pushed' as const, linearProjectUrl: projectUrl };
    setPlan(updated);
    setStep('done');
    onComplete(updated);
  }, [plan, onComplete]);

  const currentStepIndex = steps.findIndex(s => s.key === step);

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => {
          const isActive = s.key === step;
          const isDone = i < currentStepIndex || step === 'done';
          return (
            <div key={s.key} className="flex items-center gap-2">
              {i > 0 && (
                <div className={`w-8 h-0.5 ${isDone ? 'bg-primary' : 'bg-muted'}`} />
              )}
              <div className="flex items-center gap-1.5">
                <div className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${isDone ? 'bg-primary text-primary-foreground' : isActive ? 'bg-primary/20 text-primary border border-primary' : 'bg-muted text-muted-foreground'}
                `}>
                  {isDone ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : i + 1}
                </div>
                <span className={`text-xs font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
        {step === 'done' && (
          <>
            <div className="w-8 h-0.5 bg-primary" />
            <Badge variant="primary" className="text-xs">Complete</Badge>
          </>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}

      {/* Step content */}
      {step === 'intake' && (
        <IntakeForm onSubmit={handleIntakeSubmit} onCancel={onCancel} apiBase={apiBase} />
      )}

      {step === 'analyzing' && <AnalyzingState />}

      {step === 'review' && plan && (
        <PlanReview
          plan={plan}
          onApprove={handleApprove}
          onRefine={handleRefine}
          onUpdatePlan={setPlan}
          refining={refining}
        />
      )}

      {step === 'design-proposals' && plan && (
        <DesignProposalsPanel
          plan={plan}
          apiBase={apiBase}
          onProposalSelected={handleDesignProposalSelected}
          onSkip={handleSkipDesign}
        />
      )}

      {step === 'push' && plan && (
        <LinearPushPanel
          plan={plan}
          apiBase={apiBase}
          onPushComplete={handlePushComplete}
        />
      )}

      {step === 'done' && plan && (
        <div className="text-center py-12">
          <div className="text-green-500 text-4xl mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2">Orchestration Complete</h2>
          <p className="text-muted-foreground text-sm mb-4">
            {plan.tasks.length} tasks pushed to Linear with dependencies
          </p>
          {plan.linearProjectUrl && (
            <a
              href={plan.linearProjectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm"
            >
              View project in Linear
            </a>
          )}
          <div className="mt-6">
            <Button variant="secondary" onClick={onCancel}>Back to Features</Button>
          </div>
        </div>
      )}
    </div>
  );
}
