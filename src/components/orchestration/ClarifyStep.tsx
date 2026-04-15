import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@appmirror/ui-kit';
import type { ClarifyingQuestion, QuestionCategory } from '../../types';

interface ClarifyStepProps {
  questions: ClarifyingQuestion[];
  onComplete: (answered: ClarifyingQuestion[]) => void;
  onSkip: () => void;
  loading?: boolean;
}

const CATEGORY_CONFIG: Record<QuestionCategory, { label: string; color: string }> = {
  architecture: { label: 'Architecture', color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950' },
  data: { label: 'Data', color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950' },
  ui: { label: 'UI/UX', color: 'text-pink-600 bg-pink-50 dark:text-pink-400 dark:bg-pink-950' },
  integration: { label: 'Integration', color: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950' },
  rollout: { label: 'Rollout', color: 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950' },
};

export default function ClarifyStep({ questions, onComplete, onSkip, loading }: ClarifyStepProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({});

  const answeredCount = Object.keys(answers).filter(k => answers[k]).length;
  const canProceed = answeredCount >= 1;

  const selectOption = (questionId: string, label: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: label }));
    setShowCustom(prev => ({ ...prev, [questionId]: false }));
  };

  const selectCustom = (questionId: string) => {
    setShowCustom(prev => ({ ...prev, [questionId]: true }));
    setAnswers(prev => ({ ...prev, [questionId]: customInputs[questionId] || '' }));
  };

  const updateCustom = (questionId: string, value: string) => {
    setCustomInputs(prev => ({ ...prev, [questionId]: value }));
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleComplete = () => {
    const answered = questions.map(q => ({
      ...q,
      answer: answers[q.id] || undefined,
    }));
    onComplete(answered);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <h3 className="text-lg font-semibold">Analyzing your codebase...</h3>
          <p className="text-sm text-muted-foreground mt-1">Extracting knowledge from repos and generating approach questions</p>
        </div>
        {[1, 2, 3].map(i => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Approach Questions</h2>
          <p className="text-sm text-muted-foreground">
            Based on your codebase, answer these before we generate tasks. {answeredCount}/{questions.length} answered.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onSkip} className="text-xs">
            Skip Questions
          </Button>
          <Button
            variant="primary"
            onClick={handleComplete}
            disabled={!canProceed}
          >
            Generate Plan
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${(answeredCount / Math.max(questions.length, 1)) * 100}%` }}
        />
      </div>

      {/* Question cards */}
      {questions.length === 0 && !loading && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No approach questions were generated. This can happen if codebase context is unavailable.
            </p>
            <Button variant="primary" onClick={onSkip}>
              Continue to Plan Generation
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {questions.map((q, idx) => {
          const catConfig = CATEGORY_CONFIG[q.category] || CATEGORY_CONFIG.architecture;
          const isAnswered = !!answers[q.id];
          const isCustom = showCustom[q.id];

          return (
            <Card key={q.id} className={isAnswered ? 'border-primary/30' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-muted-foreground">{idx + 1}.</span>
                  <CardTitle className="text-sm">{q.question}</CardTitle>
                </div>
                <Badge variant="secondary" className={`text-[10px] w-fit ${catConfig.color}`}>
                  {catConfig.label}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {q.options.map((opt, i) => {
                  const isSelected = answers[q.id] === opt.label && !isCustom;
                  return (
                    <button
                      key={i}
                      onClick={() => selectOption(q.id, opt.label)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/30 hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                          isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                        }`}>
                          {isSelected && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{opt.label}</div>
                          <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Custom answer */}
                <button
                  onClick={() => selectCustom(q.id)}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                    isCustom
                      ? 'border-primary bg-primary/5'
                      : 'border-dashed border-border hover:border-primary/30'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                      isCustom ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                    }`}>
                      {isCustom && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-sm text-muted-foreground">Different approach...</span>
                  </div>
                </button>
                {isCustom && (
                  <textarea
                    autoFocus
                    value={customInputs[q.id] || ''}
                    onChange={(e) => updateCustom(q.id, e.target.value)}
                    placeholder="Describe your preferred approach..."
                    className="w-full text-sm px-3 py-2 rounded-md border border-border bg-background text-foreground min-h-[60px] resize-y"
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="sticky bottom-0 bg-background border-t border-border p-4 -mx-6 -mb-6 px-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {answeredCount}/{questions.length} questions answered
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onSkip} className="text-xs">
            Skip
          </Button>
          <Button
            variant="primary"
            onClick={handleComplete}
            disabled={!canProceed}
          >
            Generate Plan with Decisions
          </Button>
        </div>
      </div>
    </div>
  );
}
