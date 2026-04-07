import { useState, useEffect, useCallback } from 'react';
import { useToolContext } from '@appmirror/ui-kit';
import type { Feature, FeatureTask, ViewRoute, OrchestrationPlan } from './types';
import FeatureList from './components/FeatureList';
import FeatureDetail from './components/FeatureDetail';
import OrchestrationWizard from './components/orchestration/OrchestrationWizard';

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
  const [loading, setLoading] = useState(true);

  // ── Load features from toolsDb ─────────────────────────────────
  const loadFeatures = useCallback(async () => {
    try {
      const response = await api.get<{ data: Feature[] }>(`/feature-forge/features?project_id=${projectId}`);
      setFeatures(response.data || []);
    } catch {
      // First load — no data yet, that's fine
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, api]);

  useEffect(() => {
    loadFeatures();
  }, [loadFeatures]);

  // ── Persist a feature ──────────────────────────────────────────
  const saveFeature = async (feature: Feature) => {
    try {
      await api.put(`/feature-forge/features/${feature.id}`, feature);
    } catch {
      // If put fails, try post (new record)
      try {
        await api.post('/feature-forge/features', feature);
      } catch (err) {
        console.error('Failed to save feature:', err);
        showToast('Failed to save feature', 'error');
      }
    }
  };

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
