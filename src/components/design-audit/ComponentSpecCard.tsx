import { useState } from 'react';
import { Card, CardContent, Badge, Button } from '@appmirror/ui-kit';
import type { DesignComponent, ComponentSpec } from '../../types/design-audit';
import SpecViewer from './SpecViewer';

interface ComponentSpecCardProps {
  component: DesignComponent;
  specs: ComponentSpec[];
  onGenerateSpec: (component: DesignComponent, platform: 'ios' | 'android') => void;
  generating: string | null; // "ios" | "android" | null
}

const STATUS_STYLES = {
  covered: 'bg-green-500/10 text-green-600 border-green-500/20',
  partial: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  missing: 'bg-red-500/10 text-red-600 border-red-500/20',
};

function getStatusLabel(status: string, hasCode: boolean) {
  if (status === 'covered') return 'Has Spec';
  if (status === 'partial' && hasCode) return 'In Code';
  if (status === 'partial') return 'No Spec';
  return 'Missing';
}

export default function ComponentSpecCard({ component, specs, onGenerateSpec, generating }: ComponentSpecCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'ios' | 'android'>('ios');

  const iosSpec = specs.find(s => s.platform === 'ios');
  const androidSpec = specs.find(s => s.platform === 'android');

  return (
    <Card className={expanded ? 'ring-1 ring-primary/20' : ''}>
      <CardContent className="p-4">
        {/* Header row */}
        <div
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Thumbnail */}
          {component.thumbnailUrl ? (
            <img
              src={component.thumbnailUrl}
              alt={component.name}
              className="w-10 h-10 rounded border border-border object-contain bg-white flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded border border-border bg-muted flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{component.name}</span>
              {component.variants.length > 0 && (
                <span className="text-xs text-muted-foreground">{component.variants.length} variants</span>
              )}
            </div>
            {component.description && (
              <p className="text-xs text-muted-foreground truncate">{component.description}</p>
            )}
          </div>

          {/* Platform badges */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLES[component.platform.ios]}`}>
              iOS: {getStatusLabel(component.platform.ios, (component.codeMatches?.ios?.length ?? 0) > 0)}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLES[component.platform.android]}`}>
              Android: {getStatusLabel(component.platform.android, (component.codeMatches?.android?.length ?? 0) > 0)}
            </span>
          </div>

          {/* Expand chevron */}
          <svg
            className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-border">
            {/* Platform tabs */}
            <div className="flex items-center gap-1 mb-4">
              <button
                onClick={() => setActiveTab('ios')}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeTab === 'ios'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                iOS
              </button>
              <button
                onClick={() => setActiveTab('android')}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeTab === 'android'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Android
              </button>
            </div>

            {/* Code matches for active tab */}
            {component.codeMatches && (() => {
              const matches = activeTab === 'ios' ? component.codeMatches.ios : component.codeMatches.android;
              if (matches && matches.length > 0) {
                return (
                  <div className="mb-4 p-3 rounded-md bg-green-500/5 border border-green-500/20">
                    <div className="text-xs font-medium text-green-700 mb-1 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Found in code
                    </div>
                    {matches.map((m, i) => (
                      <div key={i} className="text-xs text-green-800 mt-1">
                        <span className="font-mono font-medium">{m.name}</span>
                        <span className="text-green-600"> ({m.type})</span>
                        <span className="text-green-600 ml-1">in {m.file}</span>
                        {m.props && m.props.length > 0 && (
                          <div className="text-green-600 mt-0.5 pl-2">
                            Props: {m.props.slice(0, 5).join(', ')}{m.props.length > 5 ? ` +${m.props.length - 5} more` : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              }
              return null;
            })()}

            {/* Spec content for active tab */}
            {activeTab === 'ios' && (
              iosSpec ? (
                <SpecViewer spec={iosSpec} />
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  {component.codeMatches?.ios?.length ? (
                    <Badge variant="primary" className="mb-2">Code exists, no spec</Badge>
                  ) : (
                    <Badge variant="secondary" className="mb-2">Not implemented</Badge>
                  )}
                  <p className="text-xs text-muted-foreground mb-3">
                    {component.codeMatches?.ios?.length
                      ? 'This component exists in your iOS codebase but has no formal spec.'
                      : 'No iOS implementation or specification found for this component.'
                    }
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => onGenerateSpec(component, 'ios')}
                    disabled={generating === 'ios'}
                  >
                    {generating === 'ios' ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                        Generating...
                      </span>
                    ) : (
                      'Generate iOS Spec'
                    )}
                  </Button>
                </div>
              )
            )}

            {activeTab === 'android' && (
              androidSpec ? (
                <SpecViewer spec={androidSpec} />
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  {component.codeMatches?.android?.length ? (
                    <Badge variant="primary" className="mb-2">Code exists, no spec</Badge>
                  ) : (
                    <Badge variant="secondary" className="mb-2">Not implemented</Badge>
                  )}
                  <p className="text-xs text-muted-foreground mb-3">
                    {component.codeMatches?.android?.length
                      ? 'This component exists in your Android codebase but has no formal spec.'
                      : 'No Android implementation or specification found for this component.'
                    }
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => onGenerateSpec(component, 'android')}
                    disabled={generating === 'android'}
                  >
                    {generating === 'android' ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                        Generating...
                      </span>
                    ) : (
                      'Generate Android Spec'
                    )}
                  </Button>
                </div>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
