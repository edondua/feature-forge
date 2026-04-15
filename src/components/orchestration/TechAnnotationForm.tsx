import { useState } from 'react';
import { Button } from '@appmirror/ui-kit';
import type { TechAnnotation } from '../../types';

interface TechAnnotationFormProps {
  annotation?: TechAnnotation;
  onSave: (annotation: TechAnnotation) => void;
  readOnly?: boolean;
}

export default function TechAnnotationForm({ annotation, onSave, readOnly }: TechAnnotationFormProps) {
  const [implementationNotes, setImplementationNotes] = useState(annotation?.implementationNotes || '');
  const [estimateHours, setEstimateHours] = useState<string>(annotation?.estimateHours?.toString() || '');
  const [challenges, setChallenges] = useState<string[]>(annotation?.challengesRaised || []);
  const [newChallenge, setNewChallenge] = useState('');

  const handleSave = () => {
    onSave({
      implementationNotes: implementationNotes || undefined,
      estimateHours: estimateHours ? Number(estimateHours) : undefined,
      challengesRaised: challenges.length > 0 ? challenges : undefined,
      addedBy: 'dev',
      addedAt: new Date().toISOString(),
    });
  };

  const addChallenge = () => {
    if (newChallenge.trim()) {
      setChallenges(prev => [...prev, newChallenge.trim()]);
      setNewChallenge('');
    }
  };

  const removeChallenge = (index: number) => {
    setChallenges(prev => prev.filter((_, i) => i !== index));
  };

  const hasContent = implementationNotes || estimateHours || challenges.length > 0;

  if (readOnly) {
    if (!annotation) return null;
    return (
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-xs font-medium text-purple-600 dark:text-purple-400">Tech Notes</div>
        {annotation.implementationNotes && (
          <div>
            <div className="text-[10px] text-muted-foreground font-medium">Implementation Notes</div>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{annotation.implementationNotes}</p>
          </div>
        )}
        {annotation.estimateHours != null && (
          <p className="text-xs text-muted-foreground">Estimate: <strong>{annotation.estimateHours}h</strong></p>
        )}
        {annotation.challengesRaised && annotation.challengesRaised.length > 0 && (
          <div>
            <div className="text-[10px] text-muted-foreground font-medium">Challenges Raised</div>
            {annotation.challengesRaised.map((c, i) => (
              <p key={i} className="text-xs text-orange-600 dark:text-orange-400">- {c}</p>
            ))}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground">
          Added by {annotation.addedBy} on {new Date(annotation.addedAt).toLocaleDateString()}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="text-xs font-medium text-purple-600 dark:text-purple-400">Tech Notes</div>

      <div>
        <label className="text-[10px] text-muted-foreground font-medium block mb-0.5">Implementation Notes</label>
        <textarea
          value={implementationNotes}
          onChange={(e) => setImplementationNotes(e.target.value)}
          placeholder="Approach, patterns, libraries, edge cases to handle..."
          rows={4}
          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground resize-y"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground font-medium block mb-0.5">Estimate (hours)</label>
        <input
          type="number"
          min="0"
          step="0.5"
          value={estimateHours}
          onChange={(e) => setEstimateHours(e.target.value)}
          placeholder="e.g. 4"
          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground font-medium block mb-0.5">Challenges / Concerns</label>
        {challenges.map((c, i) => (
          <div key={i} className="flex items-center gap-1 mb-1">
            <span className="text-xs text-orange-600 dark:text-orange-400 flex-1">- {c}</span>
            <button onClick={() => removeChallenge(i)} className="text-muted-foreground hover:text-foreground text-xs">&times;</button>
          </div>
        ))}
        <div className="flex gap-1">
          <input
            value={newChallenge}
            onChange={(e) => setNewChallenge(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChallenge(); } }}
            placeholder="Add a concern..."
            className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background text-foreground"
          />
          <button
            onClick={addChallenge}
            disabled={!newChallenge.trim()}
            className="text-xs text-primary hover:underline disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <Button
        variant="primary"
        onClick={handleSave}
        disabled={!hasContent}
        className="text-xs w-full"
      >
        {annotation ? 'Update Tech Notes' : 'Save Tech Notes'}
      </Button>
    </div>
  );
}
