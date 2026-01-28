import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface QuestionPromptProps {
  questionId: string;
  text: string;
  options?: string[];
  expiresAt?: number;
  onAnswer: (questionId: string, answer: string | boolean) => void;
}

export function QuestionPrompt({ questionId, text, options, onAnswer }: QuestionPromptProps) {
  const [freeformValue, setFreeformValue] = useState('');
  const [answered, setAnswered] = useState(false);

  const handleAnswer = (answer: string | boolean) => {
    if (answered) return;
    setAnswered(true);
    onAnswer(questionId, answer);
  };

  if (answered) {
    return null;
  }

  return (
    <div className="mx-4 my-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <div className="mb-2 flex items-center gap-2">
        <QuestionIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
          Agent Question
        </span>
      </div>

      <p className="mb-3 text-sm text-neutral-900 dark:text-neutral-100">{text}</p>

      {options && options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Button
              key={option}
              variant="outline"
              size="sm"
              onClick={() => handleAnswer(option)}
              className="text-xs"
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
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-neutral-600 dark:bg-neutral-800"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={!freeformValue.trim()}>
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
