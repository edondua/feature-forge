import { useState, useEffect } from 'react';
import { Card, CardContent } from '@appmirror/ui-kit';

const PROGRESS_MESSAGES = [
  'Reading design system tokens...',
  'Analyzing feature requirements...',
  'Brainstorming UX approaches...',
  'Crafting minimal proposal...',
  'Crafting feature-rich proposal...',
  'Crafting conversational proposal...',
  'Writing screen descriptions...',
  'Generating designs in Stitch...',
  'Rendering preview images...',
  'Finalizing proposals...',
];

const PROPOSAL_CARDS = [
  { label: 'Minimal', description: 'Clean & focused' },
  { label: 'Feature-rich', description: 'Comprehensive & detailed' },
  { label: 'Conversational', description: 'Guided & step-by-step' },
];

export default function DesignGeneratingState() {
  const [messageIndex, setMessageIndex] = useState(0);
  const [revealedCards, setRevealedCards] = useState(0);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % PROGRESS_MESSAGES.length);
    }, 2500);

    const cardTimer = setInterval(() => {
      setRevealedCards(prev => Math.min(prev + 1, PROPOSAL_CARDS.length));
    }, 1200);

    return () => { clearInterval(msgTimer); clearInterval(cardTimer); };
  }, []);

  return (
    <div className="space-y-6">
      <div className="text-center py-8">
        <div className="w-12 h-12 border-3 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Generating Design Proposals...</h2>
        <p className="text-muted-foreground text-sm animate-pulse">
          {PROGRESS_MESSAGES[messageIndex]}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PROPOSAL_CARDS.map((card, i) => {
          const revealed = i < revealedCards;
          return (
            <Card
              key={card.label}
              className={`transition-all duration-500 ${revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
            >
              <CardContent className="p-4 text-center">
                <div className="w-3 h-3 rounded-full bg-pink-500 mx-auto mb-3" />
                <div className="text-sm font-semibold mb-1">{card.label}</div>
                <div className="text-xs text-muted-foreground mb-3">{card.description}</div>
                {revealed && (
                  <div className="space-y-2">
                    <div className="h-32 bg-muted rounded-lg animate-pulse" />
                    <div className="h-2 bg-muted rounded animate-pulse" />
                    <div className="h-2 bg-muted rounded animate-pulse w-3/4 mx-auto" />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
