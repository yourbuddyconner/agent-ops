import * as React from 'react';
import type { WorkflowStep, Workflow, WorkflowData } from '@/api/workflows';
import { useUpdateWorkflow } from '@/api/workflows';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

const STEP_TYPES = [
  { value: 'agent', label: 'Agent' },
  { value: 'tool', label: 'Tool' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'loop', label: 'Loop' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'subworkflow', label: 'Subworkflow' },
  { value: 'approval', label: 'Approval' },
] as const;

interface EditWorkflowStepDialogProps {
  workflow: Workflow;
  step: WorkflowStep;
  stepIndex: number;
  trigger?: React.ReactNode;
}

interface StepFormData {
  id: string;
  name: string;
  type: WorkflowStep['type'];
  tool: string;
  goal: string;
  context: string;
  outputVariable: string;
  argumentsJson: string;
  conditionJson: string;
  thenJson: string;
  elseJson: string;
  stepsJson: string;
}

function stringifyJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Invalid JSON: ${message}` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function EditWorkflowStepDialog({
  workflow,
  step,
  stepIndex,
  trigger,
}: EditWorkflowStepDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [formData, setFormData] = React.useState<StepFormData>({
    id: step.id,
    name: step.name,
    type: step.type,
    tool: step.tool || '',
    goal: step.goal || '',
    context: step.context || '',
    outputVariable: step.outputVariable || '',
    argumentsJson: stringifyJson(step.arguments),
    conditionJson: stringifyJson(step.condition),
    thenJson: stringifyJson(step.then),
    elseJson: stringifyJson(step.else),
    stepsJson: stringifyJson(step.steps),
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const updateWorkflow = useUpdateWorkflow();

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setFormData({
        id: step.id,
        name: step.name,
        type: step.type,
        tool: step.tool || '',
        goal: step.goal || '',
        context: step.context || '',
        outputVariable: step.outputVariable || '',
        argumentsJson: stringifyJson(step.arguments),
        conditionJson: stringifyJson(step.condition),
        thenJson: stringifyJson(step.then),
        elseJson: stringifyJson(step.else),
        stepsJson: stringifyJson(step.steps),
      });
      setErrors({});
    }
  }, [open, step]);

  const handleChange = <K extends keyof StepFormData>(field: K, value: StepFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const newErrors: Record<string, string> = {};
    if (!formData.id.trim()) {
      newErrors.id = 'Step ID is required';
    }
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (formData.type === 'tool' && !formData.tool.trim()) {
      newErrors.tool = 'Tool name is required for tool steps';
    }

    let parsedArguments: Record<string, unknown> | undefined;
    if (formData.argumentsJson.trim()) {
      const parsed = parseJson(formData.argumentsJson);
      if (!parsed.ok) {
        newErrors.argumentsJson = parsed.error;
      } else if (!isRecord(parsed.value)) {
        newErrors.argumentsJson = 'Arguments must be a JSON object';
      } else {
        parsedArguments = parsed.value;
      }
    }

    let parsedCondition: unknown = undefined;
    if (formData.conditionJson.trim()) {
      const parsed = parseJson(formData.conditionJson);
      if (!parsed.ok) {
        newErrors.conditionJson = parsed.error;
      } else {
        parsedCondition = parsed.value;
      }
    }

    const parseStepArray = (
      raw: string,
      field: 'thenJson' | 'elseJson' | 'stepsJson',
      label: string,
    ): WorkflowStep[] | undefined => {
      if (!raw.trim()) return undefined;
      const parsed = parseJson(raw);
      if (!parsed.ok) {
        newErrors[field] = parsed.error;
        return undefined;
      }
      if (!Array.isArray(parsed.value)) {
        newErrors[field] = `${label} must be a JSON array`;
        return undefined;
      }
      return parsed.value as WorkflowStep[];
    };

    const parsedThen = parseStepArray(formData.thenJson, 'thenJson', 'Then branch');
    const parsedElse = parseStepArray(formData.elseJson, 'elseJson', 'Else branch');
    const parsedSteps = parseStepArray(formData.stepsJson, 'stepsJson', 'Nested steps');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Build updated step
    const updatedStep: WorkflowStep = {
      ...step,
      id: formData.id.trim(),
      name: formData.name,
      type: formData.type as WorkflowStep['type'],
      tool: formData.tool || undefined,
      goal: formData.goal || undefined,
      context: formData.context || undefined,
      outputVariable: formData.outputVariable || undefined,
      arguments: parsedArguments,
      condition: parsedCondition,
      then: parsedThen,
      else: parsedElse,
      steps: parsedSteps,
    };

    // Build updated data with the modified step
    const updatedSteps = [...(workflow.data.steps || [])];
    updatedSteps[stepIndex] = updatedStep;

    const updatedData: WorkflowData = {
      ...workflow.data,
      steps: updatedSteps,
    };

    try {
      await updateWorkflow.mutateAsync({
        workflowId: workflow.id,
        data: updatedData,
      });
      setOpen(false);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
            aria-label="Edit step"
          >
            <EditIcon className="size-4" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Step</DialogTitle>
            <DialogDescription>
              Modify the step configuration.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="step-id"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Step ID
                </label>
                <Input
                  id="step-id"
                  value={formData.id}
                  onChange={(e) => handleChange('id', e.target.value)}
                  placeholder="check_environment"
                  className={cn(errors.id && 'border-red-500')}
                />
                {errors.id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.id}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="step-name"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Name
                </label>
                <Input
                  id="step-name"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Step name"
                  className={cn(errors.name && 'border-red-500')}
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.name}</p>
                )}
              </div>
            </div>

            <div>
              <label
                htmlFor="step-type"
                className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Type
              </label>
              <select
                id="step-type"
                value={formData.type}
                onChange={(e) => handleChange('type', e.target.value as WorkflowStep['type'])}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:ring-neutral-100"
              >
                {STEP_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {(formData.type === 'tool') && (
              <div>
                <label
                  htmlFor="step-tool"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Tool
                </label>
                <Input
                  id="step-tool"
                  value={formData.tool}
                  onChange={(e) => handleChange('tool', e.target.value)}
                  placeholder="github.getPullRequest"
                  className={cn(errors.tool && 'border-red-500')}
                />
                {errors.tool && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.tool}</p>
                )}
              </div>
            )}

            {formData.type === 'tool' && (
              <div>
                <label
                  htmlFor="step-arguments"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Arguments (JSON)
                </label>
                <textarea
                  id="step-arguments"
                  value={formData.argumentsJson}
                  onChange={(e) => handleChange('argumentsJson', e.target.value)}
                  placeholder='{"command":"echo hello"}'
                  rows={4}
                  className={cn(
                    'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100',
                    errors.argumentsJson && 'border-red-500',
                  )}
                />
                {errors.argumentsJson && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.argumentsJson}</p>
                )}
              </div>
            )}

            {(formData.type === 'agent' || formData.type === 'tool') && (
              <div>
                <label
                  htmlFor="step-goal"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Goal
                </label>
                <textarea
                  id="step-goal"
                  value={formData.goal}
                  onChange={(e) => handleChange('goal', e.target.value)}
                  placeholder="What should this step accomplish?"
                  rows={2}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100"
                />
              </div>
            )}

            {formData.type === 'conditional' && (
              <>
                <div>
                  <label
                    htmlFor="step-condition"
                    className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Condition (JSON)
                  </label>
                  <textarea
                    id="step-condition"
                    value={formData.conditionJson}
                    onChange={(e) => handleChange('conditionJson', e.target.value)}
                    placeholder='{"variable":"deploy","equals":true}'
                    rows={3}
                    className={cn(
                      'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100',
                      errors.conditionJson && 'border-red-500',
                    )}
                  />
                  {errors.conditionJson && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.conditionJson}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="step-then"
                    className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Then Branch Steps (JSON array)
                  </label>
                  <textarea
                    id="step-then"
                    value={formData.thenJson}
                    onChange={(e) => handleChange('thenJson', e.target.value)}
                    placeholder='[{"id":"step_a","name":"A","type":"tool","tool":"bash","arguments":{"command":"echo then"}}]'
                    rows={4}
                    className={cn(
                      'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100',
                      errors.thenJson && 'border-red-500',
                    )}
                  />
                  {errors.thenJson && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.thenJson}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="step-else"
                    className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Else Branch Steps (JSON array)
                  </label>
                  <textarea
                    id="step-else"
                    value={formData.elseJson}
                    onChange={(e) => handleChange('elseJson', e.target.value)}
                    placeholder='[{"id":"step_b","name":"B","type":"tool","tool":"bash","arguments":{"command":"echo else"}}]'
                    rows={4}
                    className={cn(
                      'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100',
                      errors.elseJson && 'border-red-500',
                    )}
                  />
                  {errors.elseJson && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.elseJson}</p>
                  )}
                </div>
              </>
            )}

            {(formData.type === 'parallel' || formData.type === 'loop' || formData.type === 'subworkflow') && (
              <div>
                <label
                  htmlFor="step-steps"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Nested Steps (JSON array)
                </label>
                <textarea
                  id="step-steps"
                  value={formData.stepsJson}
                  onChange={(e) => handleChange('stepsJson', e.target.value)}
                  placeholder='[{"id":"nested_1","name":"Nested Step","type":"tool","tool":"bash","arguments":{"command":"echo nested"}}]'
                  rows={5}
                  className={cn(
                    'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100',
                    errors.stepsJson && 'border-red-500',
                  )}
                />
                {errors.stepsJson && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.stepsJson}</p>
                )}
              </div>
            )}

            {formData.type === 'agent' && (
              <div>
                <label
                  htmlFor="step-context"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Context
                </label>
                <textarea
                  id="step-context"
                  value={formData.context}
                  onChange={(e) => handleChange('context', e.target.value)}
                  placeholder="Additional context for the agent"
                  rows={2}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="step-output"
                className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Output Variable
              </label>
              <Input
                id="step-output"
                value={formData.outputVariable}
                onChange={(e) => handleChange('outputVariable', e.target.value)}
                placeholder="result"
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Store the step output in this variable for use in later steps.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateWorkflow.isPending}>
              {updateWorkflow.isPending ? 'Saving...' : 'Save Step'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditIcon({ className }: { className?: string }) {
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
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}
