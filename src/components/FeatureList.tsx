import { Card, CardContent, Badge, Button } from '@appmirror/ui-kit';
import type { Feature } from '../types';
import { MODE_CONFIG } from '../types';

interface FeatureListProps {
  features: Feature[];
  onSelect: (featureId: string) => void;
  onOrchestrate: () => void;
  onDesignAudit: () => void;
}

const STATUS_LABELS: Record<string, { label: string; variant: 'primary' | 'secondary' }> = {
  draft:       { label: 'Draft',       variant: 'secondary' },
  planning:    { label: 'Planning',    variant: 'secondary' },
  in_progress: { label: 'In Progress', variant: 'primary' },
  review:      { label: 'Review',      variant: 'primary' },
  approved:    { label: 'Approved',    variant: 'primary' },
  shipped:     { label: 'Shipped',     variant: 'primary' },
};

export default function FeatureList({ features, onSelect, onOrchestrate, onDesignAudit }: FeatureListProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Feature Forge</h1>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Futurist Setup
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-muted-foreground text-sm">Idea → Pipeline → Production</p>
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Pipeline connected
            </span>
            <a
              href="http://localhost:5175/futuristic.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline underline-offset-2 hover:opacity-70 transition-opacity"
            >
              futuristic
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={onDesignAudit}>
            Design Audit
          </Button>
          <Button variant="primary" onClick={onOrchestrate}>
            + Orchestrate
          </Button>
        </div>
      </div>

      {/* Feature cards */}
      {features.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <svg className="w-16 h-16 text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <div className="text-lg font-medium">No features yet</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Describe what you want to build and let orchestration map your services, break down tasks, and generate a plan.
            </p>
            <Button variant="primary" onClick={onOrchestrate} className="mt-6">
              Start Orchestrating
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {features.map(feature => {
            const totalTasks = feature.tasks.length;
            const doneTasks = feature.tasks.filter(t => t.status === 'done').length;
            const debtCount = feature.tasks.reduce((sum, t) => sum + t.debtTags.length, 0);
            const statusConfig = STATUS_LABELS[feature.status] || STATUS_LABELS.draft;
            const modeConfig = MODE_CONFIG[feature.currentMode];

            return (
              <Card
                key={feature.id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
              >
                <CardContent className="p-4" onClick={() => onSelect(feature.id)}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold truncate">{feature.name}</h3>
                        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                        <div className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${modeConfig.color}`} />
                          <span className="text-xs text-muted-foreground">{modeConfig.label}</span>
                        </div>
                      </div>
                      {feature.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{feature.description}</p>
                      )}

                      {/* Stats row */}
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span>{feature.services.length} services</span>
                        {totalTasks > 0 && (
                          <span>{doneTasks}/{totalTasks} tasks done</span>
                        )}
                        {debtCount > 0 && (
                          <span className="text-yellow-600 dark:text-yellow-400">{debtCount} debt items</span>
                        )}
                        {feature.figma && <span>Figma attached</span>}
                      </div>

                      {/* Task progress bar */}
                      {totalTasks > 0 && (
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-2">
                          <div
                            className="h-full bg-green-500 rounded-full transition-all"
                            style={{ width: `${(doneTasks / totalTasks) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Blast radius mini */}
                    {feature.blastRadius && (
                      <div className="flex-shrink-0 text-center">
                        <div className={`text-xl font-bold ${
                          feature.blastRadius.score <= 3 ? 'text-green-500' :
                          feature.blastRadius.score <= 6 ? 'text-yellow-500' : 'text-red-500'
                        }`}>
                          {feature.blastRadius.score}
                        </div>
                        <div className="text-[10px] text-muted-foreground">risk</div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
