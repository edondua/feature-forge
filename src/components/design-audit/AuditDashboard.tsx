import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@appmirror/ui-kit';
import type { AuditResult, DesignComponent, ComponentSpec, PlatformStatus } from '../../types/design-audit';
import ComponentSpecCard from './ComponentSpecCard';

interface AuditDashboardProps {
  audit: AuditResult;
  specs: ComponentSpec[];
  onGenerateSpec: (component: DesignComponent, platform: 'ios' | 'android') => void;
  onGenerateAllMissing: () => void;
  onPushToLinear: () => void;
  generatingSpec: { componentKey: string; platform: string } | null;
  pushingToLinear: boolean;
}

type FilterPlatform = 'all' | 'ios' | 'android';
type FilterStatus = 'all' | 'covered' | 'partial' | 'missing';

export default function AuditDashboard({
  audit,
  specs,
  onGenerateSpec,
  onGenerateAllMissing,
  onPushToLinear,
  generatingSpec,
  pushingToLinear,
}: AuditDashboardProps) {
  const [filterPlatform, setFilterPlatform] = useState<FilterPlatform>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const { stats } = audit;

  // Filter components
  const filteredComponents = audit.components.filter(comp => {
    if (filterPlatform === 'all' && filterStatus === 'all') return true;

    const matchesPlatform = (_platform: FilterPlatform, status: PlatformStatus) => {
      if (filterStatus === 'all') return true;
      return status === filterStatus;
    };

    if (filterPlatform === 'ios') return matchesPlatform('ios', comp.platform.ios);
    if (filterPlatform === 'android') return matchesPlatform('android', comp.platform.android);

    // "all" platform — match if either platform matches the status filter
    if (filterStatus === 'all') return true;
    return comp.platform.ios === filterStatus || comp.platform.android === filterStatus;
  });

  const missingCount = audit.components.filter(
    c => c.platform.ios !== 'covered' || c.platform.android !== 'covered'
  ).length;

  return (
    <div className="space-y-6">
      {/* Coverage overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Components</div>
          </CardContent>
        </Card>

        {/* iOS coverage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              iOS Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-600">{stats.iosCovered} covered</span>
              <span className="text-yellow-600">{stats.iosPartial} partial</span>
              <span className="text-red-600">{stats.iosMissing} missing</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-2 flex">
              {stats.total > 0 && (
                <>
                  <div className="h-full bg-green-500" style={{ width: `${(stats.iosCovered / stats.total) * 100}%` }} />
                  <div className="h-full bg-yellow-500" style={{ width: `${(stats.iosPartial / stats.total) * 100}%` }} />
                  <div className="h-full bg-red-500" style={{ width: `${(stats.iosMissing / stats.total) * 100}%` }} />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Android coverage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85 1.23 12.95 1 12 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31C6.97 3.26 6 5.01 6 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/>
              </svg>
              Android Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-600">{stats.androidCovered} covered</span>
              <span className="text-yellow-600">{stats.androidPartial} partial</span>
              <span className="text-red-600">{stats.androidMissing} missing</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-2 flex">
              {stats.total > 0 && (
                <>
                  <div className="h-full bg-green-500" style={{ width: `${(stats.androidCovered / stats.total) * 100}%` }} />
                  <div className="h-full bg-yellow-500" style={{ width: `${(stats.androidPartial / stats.total) * 100}%` }} />
                  <div className="h-full bg-red-500" style={{ width: `${(stats.androidMissing / stats.total) * 100}%` }} />
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters + bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Platform filter */}
          {(['all', 'ios', 'android'] as FilterPlatform[]).map(p => (
            <button
              key={p}
              onClick={() => setFilterPlatform(p)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                filterPlatform === p
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {p === 'all' ? 'All Platforms' : p === 'ios' ? 'iOS' : 'Android'}
            </button>
          ))}

          <div className="w-px h-5 bg-border mx-1" />

          {/* Status filter */}
          {(['all', 'covered', 'partial', 'missing'] as FilterStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                filterStatus === s
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={onGenerateAllMissing}
            disabled={missingCount === 0 || !!generatingSpec}
          >
            {generatingSpec
              ? 'Generating...'
              : `Generate All Missing (${missingCount})`
            }
          </Button>
          <Button
            variant="primary"
            onClick={onPushToLinear}
            disabled={missingCount === 0 || pushingToLinear}
          >
            {pushingToLinear
              ? 'Pushing...'
              : `Push to Linear (${missingCount})`
            }
          </Button>
        </div>
      </div>

      {/* Component list */}
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Showing {filteredComponents.length} of {audit.components.length} components
        </div>

        {filteredComponents.map(comp => (
          <ComponentSpecCard
            key={comp.key}
            component={comp}
            specs={specs.filter(s => s.componentKey === comp.key)}
            onGenerateSpec={onGenerateSpec}
            generating={
              generatingSpec?.componentKey === comp.key
                ? generatingSpec.platform
                : null
            }
          />
        ))}

        {filteredComponents.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <Badge variant="secondary" className="mb-2">No matches</Badge>
              <p className="text-sm text-muted-foreground">
                No components match the current filters.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
