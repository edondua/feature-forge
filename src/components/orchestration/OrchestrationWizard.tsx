import { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Badge } from '@appmirror/ui-kit';
import type { FeatureIntake, OrchestrationPlan, PlanRole, PlanPhase, KnowledgeContext, ClarifyingQuestion } from '../../types';
import IntakeForm from './IntakeForm';
import AnalyzingState from './AnalyzingState';
import ClarifyStep from './ClarifyStep';
import PlanReview from './PlanReview';
import DesignProposalsPanel from './DesignProposalsPanel';
import LinearPushPanel from './LinearPushPanel';

interface OrchestrationWizardProps {
  featureId?: string;
  apiBase: string;
  initialPlan?: OrchestrationPlan;
  currentRole?: PlanRole;
  onSavePlan?: (plan: OrchestrationPlan) => void;
  onComplete: (plan: OrchestrationPlan) => void;
  onCancel: () => void;
}

type Step = 'intake' | 'analyzing' | 'clarify' | 'review' | 'design-proposals' | 'design-input' | 'tech-input' | 'push' | 'done';

function phaseToStep(phase?: PlanPhase): Step {
  switch (phase) {
    case 'product-definition': return 'review';
    case 'design-specification': return 'design-input';
    case 'technical-definition': return 'tech-input';
    case 'approval': return 'push';
    case 'pushed': return 'done';
    default: return 'review';
  }
}

function generateActivityId(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function OrchestrationWizard({ featureId, apiBase, initialPlan, currentRole, onSavePlan, onComplete, onCancel }: OrchestrationWizardProps) {
  const [step, setStep] = useState<Step>(initialPlan ? phaseToStep(initialPlan.currentPhase) : 'intake');
  const [plan, setPlan] = useState<OrchestrationPlan | null>(initialPlan || null);
  const [error, setError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);

  // Dynamic steps — include "Design Proposals" only when design lane is active
  const hasDesignLane = plan?.laneDecisions?.some(l => l.lane === 'design' && l.needed) ?? false;

  const steps = useMemo(() => {
    const base: { key: Step; label: string }[] = [
      { key: 'intake', label: 'Define' },
      { key: 'clarify', label: 'Clarify' },
      { key: 'analyzing', label: 'Analyze' },
      { key: 'review', label: 'Review' },
    ];
    if (hasDesignLane) {
      base.push({ key: 'design-proposals', label: 'Design AI' });
    }
    base.push({ key: 'design-input', label: 'Design' });
    base.push({ key: 'tech-input', label: 'Tech' });
    base.push({ key: 'push', label: 'Push' });
    return base;
  }, [hasDesignLane]);

  // Clarify flow state
  const [pendingIntake, setPendingIntake] = useState<FeatureIntake | null>(null);
  const [knowledgeContext, setKnowledgeContext] = useState<KnowledgeContext | null>(null);
  const [clarifyingQuestions, setClarifyingQuestions] = useState<ClarifyingQuestion[]>([]);
  const [clarifyLoading, setClarifyLoading] = useState(false);

  // Auto-save whenever the plan changes
  useEffect(() => {
    if (plan && onSavePlan) {
      onSavePlan(plan);
    }
  }, [plan, onSavePlan]);

  // Step 1: Intake submitted → extract context + generate questions
  const handleIntakeSubmit = useCallback(async (intake: FeatureIntake, _services: string[], _targetMode: string) => {
    setPendingIntake(intake);
    setStep('clarify');
    setClarifyLoading(true);
    setError(null);

    try {
      const ctxRes = await fetch(`${apiBase}/api/orchestrate/extract-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affectedSurfaces: intake.affectedSurfaces }),
      });
      const ctxData = await ctxRes.json();
      const context: KnowledgeContext = ctxData.context || { services: [] };
      setKnowledgeContext(context);

      const clarifyRes = await fetch(`${apiBase}/api/orchestrate/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intake, context }),
      });
      const clarifyData = await clarifyRes.json();
      if (!clarifyRes.ok) throw new Error(clarifyData.error || 'Clarification failed');

      setClarifyingQuestions(clarifyData.questions || []);
    } catch (err: any) {
      setError(err.message);
      setClarifyingQuestions([]);
    } finally {
      setClarifyLoading(false);
    }
  }, [apiBase]);

  // Step 2: Questions answered → decompose with knowledge + answers
  const handleClarifyComplete = useCallback(async (answered: ClarifyingQuestion[]) => {
    if (!pendingIntake) return;
    setStep('analyzing');
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/orchestrate/decompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake: pendingIntake,
          featureId,
          knowledgeContext,
          clarifyingAnswers: answered,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Decomposition failed');

      const planWithPhases: OrchestrationPlan = {
        ...data.plan,
        currentPhase: 'product-definition' as PlanPhase,
        phases: [
          { phase: 'product-definition' as PlanPhase, status: 'in-progress' as const },
          { phase: 'design-specification' as PlanPhase, status: 'pending' as const },
          { phase: 'technical-definition' as PlanPhase, status: 'pending' as const },
          { phase: 'approval' as PlanPhase, status: 'pending' as const },
        ],
        activityLog: [
          { id: generateActivityId(), actor: 'system', action: 'Knowledge extracted from codebase', timestamp: new Date().toISOString() },
          { id: generateActivityId(), actor: 'user', action: `Answered ${answered.filter(q => q.answer).length} approach questions`, timestamp: new Date().toISOString() },
          { id: generateActivityId(), actor: 'system', action: 'Plan created via AI decomposition', timestamp: new Date().toISOString() },
        ],
        knowledgeContext: knowledgeContext || undefined,
        clarifyingQuestions: answered,
      };

      setPlan(planWithPhases);
      setStep('review');
    } catch (err: any) {
      setError(err.message);
      setStep('clarify');
    }
  }, [apiBase, featureId, pendingIntake, knowledgeContext]);

  // Skip clarify → decompose without answers
  const handleClarifySkip = useCallback(() => {
    handleClarifyComplete([]);
  }, [handleClarifyComplete]);

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

      setPlan({
        ...data.plan,
        currentPhase: plan.currentPhase,
        phases: plan.phases,
        activityLog: [
          ...(plan.activityLog || []),
          { id: generateActivityId(), actor: 'user', action: `Refined plan: "${feedback.slice(0, 80)}"`, timestamp: new Date().toISOString() },
        ],
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefining(false);
    }
  }, [apiBase, plan]);

  const advancePhase = useCallback((fromPhase: PlanPhase, toPhase: PlanPhase, nextStep: Step) => {
    if (!plan) return;
    const updatedPhases = (plan.phases || []).map(p => {
      if (p.phase === fromPhase) return { ...p, status: 'complete' as const, completedAt: new Date().toISOString() };
      if (p.phase === toPhase) return { ...p, status: 'in-progress' as const };
      return p;
    });
    setPlan({
      ...plan,
      currentPhase: toPhase,
      phases: updatedPhases,
      activityLog: [
        ...(plan.activityLog || []),
        { id: generateActivityId(), actor: 'user', action: `Completed ${fromPhase.replace(/-/g, ' ')}`, timestamp: new Date().toISOString() },
      ],
    });
    setStep(nextStep);
  }, [plan]);

  const handleApprove = useCallback(() => {
    if (!plan) return;
    if (plan.currentPhase === 'product-definition') {
      // Route to design proposals if design lane is active, otherwise to design-input phase
      const needsDesign = plan.laneDecisions.some(l => l.lane === 'design' && l.needed);
      if (needsDesign) {
        setStep('design-proposals');
      } else {
        advancePhase('product-definition', 'design-specification', 'design-input');
      }
    } else {
      setPlan({ ...plan, step: 'approved' });
      setStep('push');
    }
  }, [plan, advancePhase]);

  const handleDesignComplete = useCallback(() => {
    advancePhase('design-specification', 'technical-definition', 'tech-input');
  }, [advancePhase]);

  const handleTechComplete = useCallback(() => {
    advancePhase('technical-definition', 'approval', 'push');
  }, [advancePhase]);

  const handleDesignProposalSelected = useCallback((updatedPlan: OrchestrationPlan) => {
    setPlan(updatedPlan);
    setStep('push');
  }, []);

  const handleSkipDesign = useCallback(() => {
    setStep('push');
  }, []);

  const handlePushComplete = useCallback((projectUrl: string) => {
    if (!plan) return;
    const updatedPhases = (plan.phases || []).map(p =>
      p.phase === 'approval' ? { ...p, status: 'complete' as const, completedAt: new Date().toISOString() } : p
    );
    const updated: OrchestrationPlan = {
      ...plan,
      step: 'pushed',
      currentPhase: 'pushed',
      phases: updatedPhases,
      linearProjectUrl: projectUrl,
      activityLog: [
        ...(plan.activityLog || []),
        { id: generateActivityId(), actor: 'system', action: 'Plan pushed to Linear', timestamp: new Date().toISOString() },
      ],
    };
    setPlan(updated);
    setStep('done');
    onComplete(updated);
  }, [plan, onComplete]);

  const currentStepIndex = steps.findIndex(s => s.key === step);

  // Phase-aware button label for the review step
  const approveLabel = plan?.currentPhase === 'product-definition'
    ? 'Complete Product Definition'
    : 'Approve & Push to Linear';

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" role="navigation" aria-label="Wizard steps">
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

      {/* Plan ID + Copy Link (when plan exists) */}
      {plan && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Plan: {plan.id.slice(0, 12)}...</span>
          <button
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?planId=${plan.id}`;
              navigator.clipboard.writeText(url);
              // Brief visual feedback via DOM
              const el = document.getElementById('plan-copy-btn');
              if (el) { el.textContent = 'Copied!'; setTimeout(() => { el.textContent = 'Copy Link'; }, 2000); }
            }}
            id="plan-copy-btn"
            className="text-primary hover:underline"
          >
            Copy Link
          </button>
          {plan.currentPhase && (
            <Badge variant="secondary" className="text-[10px]">
              {plan.currentPhase.replace(/-/g, ' ')}
            </Badge>
          )}
        </div>
      )}

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

      {step === 'clarify' && (
        <ClarifyStep
          questions={clarifyingQuestions}
          onComplete={handleClarifyComplete}
          onSkip={handleClarifySkip}
          loading={clarifyLoading}
        />
      )}

      {step === 'analyzing' && <AnalyzingState />}

      {step === 'review' && plan && (
        <PlanReview
          plan={plan}
          onApprove={handleApprove}
          onRefine={handleRefine}
          onUpdatePlan={setPlan}
          refining={refining}
          approveLabel={approveLabel}
        />
      )}

      {step === 'design-input' && plan && (
        <PlanReview
          plan={plan}
          onApprove={handleDesignComplete}
          onRefine={handleRefine}
          onUpdatePlan={setPlan}
          refining={refining}
          approveLabel="Complete Design Specification"
          phaseMode="design"
        />
      )}

      {step === 'tech-input' && plan && (
        <PlanReview
          plan={plan}
          onApprove={handleTechComplete}
          onRefine={handleRefine}
          onUpdatePlan={setPlan}
          refining={refining}
          approveLabel="Complete Technical Definition"
          phaseMode="tech"
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
