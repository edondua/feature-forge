import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@appmirror/ui-kit';
import type { OrchestrationPlan, DesignProposal, DesignProposalsResult } from '../../types';
import DesignGeneratingState from './DesignGeneratingState';
import PhoneFrame from '../ios-kit/PhoneFrame';

interface DesignProposalsPanelProps {
  plan: OrchestrationPlan;
  apiBase: string;
  onProposalSelected: (updatedPlan: OrchestrationPlan) => void;
  onSkip: () => void;
}

const STYLE_COLORS: Record<string, string> = {
  minimal: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  'feature-rich': 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  conversational: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
};

export default function DesignProposalsPanel({ plan, apiBase, onProposalSelected, onSkip }: DesignProposalsPanelProps) {
  const [result, setResult] = useState<DesignProposalsResult | null>(null);
  const [generating, setGenerating] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeScreenIndex, setActiveScreenIndex] = useState<Record<string, number>>({});
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Generate proposals on mount
  useEffect(() => {
    let cancelled = false;

    async function generate() {
      try {
        const res = await fetch(`${apiBase}/api/orchestrate/design-proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate proposals');
        if (cancelled) return;

        setResult(data.designProposals);
        setGenerating(false);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message);
        setGenerating(false);
      }
    }

    generate();
    return () => { cancelled = true; };
  }, [apiBase, plan]);

  const handleSelect = useCallback((proposalId: string) => {
    setSelectedId(proposalId);
  }, []);

  const handleContinue = useCallback(() => {
    if (!result || !selectedId) return;

    const updatedProposals = result.proposals.map(p => ({
      ...p,
      selected: p.id === selectedId,
    }));

    const updatedResult = { ...result, proposals: updatedProposals };
    const updatedPlan: OrchestrationPlan = {
      ...plan,
      designProposals: updatedResult,
    };

    onProposalSelected(updatedPlan);
  }, [result, selectedId, plan, onProposalSelected]);

  const handleRegenerate = useCallback(async (proposalId: string, screenIndex: number) => {
    if (!result?.stitchProjectId) return;

    const proposal = result.proposals.find(p => p.id === proposalId);
    const screen = proposal?.screens[screenIndex];
    if (!screen) return;

    const regenKey = `${proposalId}_${screenIndex}`;
    setRegenerating(prev => ({ ...prev, [regenKey]: true }));

    try {
      const res = await fetch(`${apiBase}/api/orchestrate/design-proposals/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stitchProjectId: result.stitchProjectId,
          screenPrompt: screen.prompt,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Regeneration failed');

      // Update the screen in state
      setResult(prev => {
        if (!prev) return prev;
        const updated = { ...prev };
        updated.proposals = updated.proposals.map(p => {
          if (p.id !== proposalId) return p;
          return {
            ...p,
            screens: p.screens.map((s, i) => {
              if (i !== screenIndex) return s;
              return {
                ...s,
                stitchScreenId: data.stitchScreenId,
                imageUrl: data.imageUrl,
                htmlUrl: data.htmlUrl,
              };
            }),
          };
        });
        return updated;
      });
    } catch (err: any) {
      console.error('Regeneration failed:', err);
    } finally {
      setRegenerating(prev => {
        const next = { ...prev };
        delete next[`${proposalId}_${screenIndex}`];
        return next;
      });
    }
  }, [result, apiBase]);

  const getActiveScreen = (proposal: DesignProposal) => {
    const idx = activeScreenIndex[proposal.id] || 0;
    return proposal.screens[idx] || proposal.screens[0];
  };

  const navigateScreen = (proposalId: string, delta: number, totalScreens: number) => {
    setActiveScreenIndex(prev => {
      const current = prev[proposalId] || 0;
      const next = Math.max(0, Math.min(totalScreens - 1, current + delta));
      return { ...prev, [proposalId]: next };
    });
  };

  // Generating state
  if (generating) return <DesignGeneratingState />;

  // Error state
  if (error) {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          <p className="font-medium mb-1">Design proposal generation failed</p>
          <p>{error}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onSkip}>Skip Design Proposals</Button>
        </div>
      </div>
    );
  }

  if (!result || result.proposals.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No design proposals were generated.</p>
        <Button variant="secondary" onClick={onSkip} className="mt-4">Continue</Button>
      </div>
    );
  }

  const totalScreens = result.proposals.reduce((sum, p) => sum + p.screens.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Design Proposals</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {plan.intake.title} — {totalScreens} screens across 3 proposals
            {result.stitchProjectUrl && (
              <> &middot; <a href={result.stitchProjectUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open in Stitch</a></>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onSkip}>Skip</Button>
      </div>

      {/* DS sync indicator */}
      {result.designSystemSynced && (
        <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Design system tokens synced to Stitch
        </div>
      )}

      {/* Proposals grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {result.proposals.map((proposal) => {
          const isSelected = selectedId === proposal.id;
          const currentIdx = activeScreenIndex[proposal.id] || 0;
          const activeScreen = getActiveScreen(proposal);
          const regenKey = `${proposal.id}_${currentIdx}`;
          const isRegenerating = regenerating[regenKey];

          return (
            <Card
              key={proposal.id}
              className={`transition-all ${isSelected ? 'ring-2 ring-pink-500 shadow-lg' : 'hover:shadow-md'}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className={STYLE_COLORS[proposal.style] || 'bg-pink-100 text-pink-700'}>
                    {proposal.style}
                  </Badge>
                  {isSelected && (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                      Selected
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-base">{proposal.label}</CardTitle>
                <p className="text-xs text-muted-foreground italic mt-1">{proposal.rationale}</p>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* Screen preview */}
                <div className="relative" style={{ transform: 'scale(0.55)', transformOrigin: 'top center', height: '400px' }}>
                  <PhoneFrame>
                    {activeScreen?.imageUrl ? (
                      <img
                        src={activeScreen.imageUrl}
                        alt={activeScreen.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="p-4 h-full flex flex-col">
                        <div className="text-sm font-semibold mb-2 text-black">{activeScreen?.name}</div>
                        <div className="flex-1 overflow-hidden">
                          <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">
                            {activeScreen?.prompt?.slice(0, 300)}
                            {(activeScreen?.prompt?.length || 0) > 300 ? '...' : ''}
                          </p>
                        </div>
                      </div>
                    )}
                  </PhoneFrame>
                </div>

                {/* Screen name */}
                <div className="text-center">
                  <span className="text-xs font-medium">{activeScreen?.name}</span>
                </div>

                {/* Screen navigation dots */}
                {proposal.screens.length > 1 && (
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => navigateScreen(proposal.id, -1, proposal.screens.length)}
                      disabled={currentIdx === 0}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      &larr;
                    </button>
                    <div className="flex gap-1">
                      {proposal.screens.map((_, si) => (
                        <button
                          key={si}
                          onClick={() => setActiveScreenIndex(prev => ({ ...prev, [proposal.id]: si }))}
                          className={`w-2 h-2 rounded-full transition-all ${si === currentIdx ? 'bg-pink-500 scale-125' : 'bg-muted hover:bg-muted-foreground/30'}`}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => navigateScreen(proposal.id, 1, proposal.screens.length)}
                      disabled={currentIdx === proposal.screens.length - 1}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      &rarr;
                    </button>
                    <span className="text-xs text-muted-foreground ml-1">
                      {currentIdx + 1}/{proposal.screens.length}
                    </span>
                  </div>
                )}

                {/* Figma export link */}
                {activeScreen?.htmlUrl && (
                  <a
                    href={activeScreen.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs text-primary hover:underline"
                  >
                    Export HTML for Figma &rarr;
                  </a>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {result.stitchProjectId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 text-xs"
                      disabled={isRegenerating}
                      onClick={() => handleRegenerate(proposal.id, currentIdx)}
                    >
                      {isRegenerating ? 'Regenerating...' : 'Regenerate'}
                    </Button>
                  )}
                  <Button
                    variant={isSelected ? 'primary' : 'secondary'}
                    size="sm"
                    className={`flex-1 text-xs ${isSelected ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    onClick={() => handleSelect(proposal.id)}
                  >
                    {isSelected ? '✓ Selected' : 'Select'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Figma transfer info */}
      <Card className="bg-muted/50">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <span className="text-sm">💡</span>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Transfer to Figma:</span> Use the "Export HTML" links above, then import into Figma using the{' '}
              <a href="https://html.to.design" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                html.to.design
              </a>{' '}
              plugin. All screens use your iOS design system tokens for consistent styling.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bottom action bar */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="text-sm text-muted-foreground">
          {selectedId ? (
            <span className="text-green-600 dark:text-green-400 font-medium">
              ✓ Proposal selected — ready to continue
            </span>
          ) : (
            'Select a proposal to continue'
          )}
        </div>
        <Button
          variant="primary"
          disabled={!selectedId}
          onClick={handleContinue}
        >
          Continue with Selected
        </Button>
      </div>
    </div>
  );
}
