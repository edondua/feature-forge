import { useState, useEffect, useCallback } from 'react';
import { useToolContext } from '@appmirror/ui-kit';
import type { Feature, FeatureTask, ViewRoute, OrchestrationPlan, PlanRole } from './types';
import FeatureList from './components/FeatureList';
import FeatureDetail from './components/FeatureDetail';
import OrchestrationWizard from './components/orchestration/OrchestrationWizard';
import SharedPlanView from './components/orchestration/SharedPlanView';

// ── Helpers ──────────────────────────────────────────────────────
function generateId(): string {
  return `ff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Main Tool ────────────────────────────────────────────────────
export default function Tool() {
  const {
    projectId,
    api,
    showToast,
  } = useToolContext();

  const [route, setRoute] = useState<ViewRoute>({ view: 'list' });
  const [features, setFeatures] = useState<Feature[]>([]);
  const [plans, setPlans] = useState<OrchestrationPlan[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Load features from toolsDb ─────────────────────────────────
  const loadFeatures = useCallback(async () => {
    try {
      const response = await api.get<{ data: Feature[] }>(`/feature-forge/features?project_id=${projectId}`);
      setFeatures(response.data || []);
    } catch {
      setFeatures([]);
    }
  }, [projectId, api]);

  // ── Load plans from toolsDb ────────────────────────────────────
  const loadPlans = useCallback(async () => {
    try {
      const response = await api.get<{ data: OrchestrationPlan[] }>(`/feature-forge/plans?project_id=${projectId}`);
      setPlans(response.data || []);
    } catch {
      setPlans([]);
    }
  }, [projectId, api]);

  useEffect(() => {
    Promise.all([loadFeatures(), loadPlans()]).finally(() => setLoading(false));
  }, [loadFeatures, loadPlans]);

  // ── Check URL params for shareable plan links ──────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const planId = params.get('planId');
    const role = params.get('role') as PlanRole | null;
    if (planId) {
      setRoute({ view: 'plan', planId, role: role || undefined });
    }
  }, []);

  // ── Persist a feature ──────────────────────────────────────────
  const saveFeature = async (feature: Feature) => {
    try {
      await api.put(`/feature-forge/features/${feature.id}`, feature);
    } catch {
      try {
        await api.post('/feature-forge/features', feature);
      } catch (err) {
        console.error('Failed to save feature:', err);
        showToast('Failed to save feature', 'error');
      }
    }
  };

  // ── Persist a plan ─────────────────────────────────────────────
  const savePlan = useCallback(async (plan: OrchestrationPlan) => {
    const planWithProject = { ...plan, project_id: projectId, updatedAt: new Date().toISOString() };
    // Update local state
    setPlans(prev => {
      const idx = prev.findIndex(p => p.id === plan.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = planWithProject;
        return next;
      }
      return [...prev, planWithProject];
    });
    // Persist to toolsDb
    try {
      await api.put(`/feature-forge/plans/${plan.id}`, planWithProject);
    } catch {
      try {
        await api.post('/feature-forge/plans', planWithProject);
      } catch (err) {
        console.error('Failed to save plan:', err);
      }
    }
  }, [api, projectId]);

  // ── Feature CRUD ───────────────────────────────────────────────
  const handleUpdateFeature = async (featureId: string, updates: Partial<Feature>) => {
    setFeatures(prev =>
      prev.map(f =>
        f.id === featureId
          ? { ...f, ...updates, updatedAt: new Date().toISOString() }
          : f
      )
    );

    const updated = features.find(f => f.id === featureId);
    if (updated) {
      await saveFeature({ ...updated, ...updates, updatedAt: new Date().toISOString() });
    }
  };

  // ── Task operations ────────────────────────────────────────────
  const handleAddTask = (featureId: string) => (taskData: Omit<FeatureTask, 'id' | 'order'>) => {
    const feature = features.find(f => f.id === featureId);
    if (!feature) return;

    const task: FeatureTask = {
      ...taskData,
      id: generateId(),
      order: feature.tasks.length,
    };

    const updatedTasks = [...feature.tasks, task];
    handleUpdateFeature(featureId, { tasks: updatedTasks });
  };

  const handleUpdateTask = (featureId: string) => (taskId: string, updates: Partial<FeatureTask>) => {
    const feature = features.find(f => f.id === featureId);
    if (!feature) return;

    const updatedTasks = feature.tasks.map(t =>
      t.id === taskId ? { ...t, ...updates } : t
    );
    handleUpdateFeature(featureId, { tasks: updatedTasks });
  };

  const handleRemoveTask = (featureId: string) => (taskId: string) => {
    const feature = features.find(f => f.id === featureId);
    if (!feature) return;

    const updatedTasks = feature.tasks.filter(t => t.id !== taskId);
    handleUpdateFeature(featureId, { tasks: updatedTasks });
  };

  // ── Orchestration ──────────────────────────────────────────────
  // In standalone dev (port 5175) the API runs separately on 3000.
  // In production (served by server.js, or via a tunnel), use relative URLs.
  const orchestrationApiBase = typeof window !== 'undefined' && window.location.port === '5175'
    ? 'http://localhost:3000'
    : '';

  const handleOrchestrationComplete = (plan: OrchestrationPlan) => {
    // Add generated tasks to the feature
    if (plan.featureId) {
      const feature = features.find(f => f.id === plan.featureId);
      if (feature) {
        handleUpdateFeature(plan.featureId, {
          tasks: [...feature.tasks, ...plan.tasks],
          intake: plan.intake,
          orchestrationPlanId: plan.id,
          status: 'planning',
        });
      }
    }
    showToast('Orchestration complete — tasks generated!', 'success');
  };

  // ── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading Feature Forge...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 min-w-0 overflow-hidden text-foreground max-w-7xl mx-auto">
      {route.view === 'list' && (
        <FeatureList
          features={features}
          onSelect={(id) => setRoute({ view: 'detail', featureId: id })}
          onOrchestrate={() => setRoute({ view: 'orchestrate' })}
        />
      )}

      {route.view === 'orchestrate' && (
        <OrchestrationWizard
          featureId={route.featureId}
          apiBase={orchestrationApiBase}
          onSavePlan={savePlan}
          onComplete={(plan) => {
            handleOrchestrationComplete(plan);
            if (plan.featureId) {
              setRoute({ view: 'detail', featureId: plan.featureId });
            } else {
              setRoute({ view: 'list' });
            }
          }}
          onCancel={() => setRoute({ view: 'list' })}
        />
      )}

      {route.view === 'plan' && (() => {
        const plan = plans.find(p => p.id === route.planId);
        if (!plan) {
          return (
            <div className="text-center py-16">
              <p className="text-muted-foreground">Plan not found</p>
              <button onClick={() => setRoute({ view: 'list' })} className="text-primary mt-2 text-sm">
                Back to list
              </button>
            </div>
          );
        }
        // Determine if the user can edit based on role matching current phase
        const rolePhaseMap: Record<string, string> = {
          po: 'product-definition',
          designer: 'design-specification',
          dev: 'technical-definition',
        };
        const canEdit = route.role && plan.currentPhase === rolePhaseMap[route.role];

        if (canEdit) {
          return (
            <OrchestrationWizard
              featureId={plan.featureId}
              apiBase={orchestrationApiBase}
              initialPlan={plan}
              currentRole={route.role}
              onSavePlan={savePlan}
              onComplete={(updated) => {
                handleOrchestrationComplete(updated);
                if (updated.featureId) {
                  setRoute({ view: 'detail', featureId: updated.featureId });
                } else {
                  setRoute({ view: 'list' });
                }
              }}
              onCancel={() => setRoute({ view: 'list' })}
            />
          );
        }
        return (
          <SharedPlanView
            plan={plan}
            role={route.role}
            onBack={() => setRoute({ view: 'list' })}
          />
        );
      })()}

      {route.view === 'detail' && (() => {
        const feature = features.find(f => f.id === route.featureId);
        if (!feature) {
          return (
            <div className="text-center py-16">
              <p className="text-muted-foreground">Feature not found</p>
              <button onClick={() => setRoute({ view: 'list' })} className="text-primary mt-2 text-sm">
                Back to list
              </button>
            </div>
          );
        }
        return (
          <FeatureDetail
            feature={feature}
            onBack={() => setRoute({ view: 'list' })}
            onUpdate={(updates) => handleUpdateFeature(feature.id, updates)}
            onAddTask={handleAddTask(feature.id)}
            onUpdateTask={handleUpdateTask(feature.id)}
            onRemoveTask={handleRemoveTask(feature.id)}
            onOrchestrate={() => setRoute({ view: 'orchestrate', featureId: feature.id })}
          />
        );
      })()}
    </div>
  );
}
