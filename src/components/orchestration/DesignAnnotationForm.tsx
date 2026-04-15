import { useState } from 'react';
import { Button } from '@appmirror/ui-kit';
import type { DesignAnnotation } from '../../types';

interface DesignAnnotationFormProps {
  annotation?: DesignAnnotation;
  onSave: (annotation: DesignAnnotation) => void;
  readOnly?: boolean;
}

export default function DesignAnnotationForm({ annotation, onSave, readOnly }: DesignAnnotationFormProps) {
  const [figmaUrl, setFigmaUrl] = useState(annotation?.figmaUrl || '');
  const [uiSpecs, setUiSpecs] = useState(annotation?.uiSpecs || '');
  const [interactionNotes, setInteractionNotes] = useState(annotation?.interactionNotes || '');

  const handleSave = () => {
    onSave({
      figmaUrl: figmaUrl || undefined,
      uiSpecs: uiSpecs || undefined,
      interactionNotes: interactionNotes || undefined,
      addedBy: 'designer',
      addedAt: new Date().toISOString(),
    });
  };

  const hasContent = figmaUrl || uiSpecs || interactionNotes;

  if (readOnly) {
    if (!annotation) return null;
    return (
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-xs font-medium text-blue-600 dark:text-blue-400">Design Spec</div>
        {annotation.figmaUrl && (
          <a href={annotation.figmaUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline block">
            Figma Link
          </a>
        )}
        {annotation.uiSpecs && (
          <div>
            <div className="text-[10px] text-muted-foreground font-medium">UI Specs</div>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{annotation.uiSpecs}</p>
          </div>
        )}
        {annotation.interactionNotes && (
          <div>
            <div className="text-[10px] text-muted-foreground font-medium">Interaction Notes</div>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{annotation.interactionNotes}</p>
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
      <div className="text-xs font-medium text-blue-600 dark:text-blue-400">Design Spec</div>

      <div>
        <label className="text-[10px] text-muted-foreground font-medium block mb-0.5">Figma URL</label>
        <input
          value={figmaUrl}
          onChange={(e) => setFigmaUrl(e.target.value)}
          placeholder="https://figma.com/..."
          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground font-medium block mb-0.5">UI Specs</label>
        <textarea
          value={uiSpecs}
          onChange={(e) => setUiSpecs(e.target.value)}
          placeholder="Layout, spacing, typography, colors..."
          rows={3}
          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground resize-y"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground font-medium block mb-0.5">Interaction Notes</label>
        <textarea
          value={interactionNotes}
          onChange={(e) => setInteractionNotes(e.target.value)}
          placeholder="Animations, transitions, hover states, gestures..."
          rows={2}
          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground resize-y"
        />
      </div>

      <Button
        variant="primary"
        onClick={handleSave}
        disabled={!hasContent}
        className="text-xs w-full"
      >
        {annotation ? 'Update Design Spec' : 'Save Design Spec'}
      </Button>
    </div>
  );
}
