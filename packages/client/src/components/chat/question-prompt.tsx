import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useInterval } from '@/hooks/use-interval';

interface QuestionPromptProps {
  questionId: string;
  text: string;
  options?: string[];
  expiresAt?: number;
  onAnswer: (questionId: string, answer: string | boolean) => void;
}

export function QuestionPrompt({ questionId, text, options, expiresAt, onAnswer }: QuestionPromptProps) {
  const [freeformValue, setFreeformValue] = useState('');
  const [answered, setAnswered] = useState(false);
  const [nowSecs, setNowSecs] = useState(() => Math.floor(Date.now() / 1000));

  useInterval(
    () => setNowSecs(Math.floor(Date.now() / 1000)),
    expiresAt ? 1000 : null
  );

  const isExpired = expiresAt !== undefined && nowSecs >= expiresAt;
  const expiresInText = useMemo(() => {
    if (expiresAt === undefined) return null;
    const remaining = Math.max(0, expiresAt - nowSecs);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }, [expiresAt, nowSecs]);

  const handleAnswer = (answer: string | boolean) => {
    if (answered || isExpired) return;
    setAnswered(true);
    onAnswer(questionId, answer);
  };

  if (answered) {
    return null;
  }

  return (
    <div className="mx-3 my-2 animate-fade-in rounded-md border border-amber-300/40 bg-amber-500/[0.06] p-3 dark:border-amber-700/30 dark:bg-amber-500/[0.06]">
      <div className="mb-2 flex items-center gap-2">
        <QuestionIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="label-mono text-amber-700 dark:text-amber-300">
          Agent Question
        </span>
      </div>

      <p className="mb-3 text-[13px] text-neutral-900 dark:text-neutral-100">{text}</p>
      {expiresInText && (
        <p className="mb-3 font-mono text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">
          {isExpired ? 'Expired' : `Expires in ${expiresInText}`}
        </p>
      )}

      {options && options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <Button
              key={option}
              variant="outline"
              size="sm"
              onClick={() => handleAnswer(option)}
              disabled={isExpired}
              className="text-[11px]"
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (freeformValue.trim()) {
              handleAnswer(freeformValue.trim());
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={freeformValue}
            onChange={(e) => setFreeformValue(e.target.value)}
            placeholder="Type your answer..."
            disabled={isExpired}
            className="flex-1 rounded-md border border-neutral-300 bg-surface-0 px-2.5 py-1.5 text-[13px] text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-400/40 dark:border-neutral-600 dark:bg-surface-1 dark:text-neutral-100"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={!freeformValue.trim() || isExpired}>
            Answer
          </Button>
        </form>
      )}
    </div>
  );
}

function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}
