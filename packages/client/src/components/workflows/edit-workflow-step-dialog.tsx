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

export function EditWorkflowStepDialog({
  workflow,
  step,
  stepIndex,
  trigger,
}: EditWorkflowStepDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: step.name,
    type: step.type,
    tool: step.tool || '',
    goal: step.goal || '',
    context: step.context || '',
    outputVariable: step.outputVariable || '',
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const updateWorkflow = useUpdateWorkflow();

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setFormData({
        name: step.name,
        type: step.type,
        tool: step.tool || '',
        goal: step.goal || '',
        context: step.context || '',
        outputVariable: step.outputVariable || '',
      });
      setErrors({});
    }
  }, [open, step]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (formData.type === 'tool' && !formData.tool.trim()) {
      newErrors.tool = 'Tool name is required for tool steps';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Build updated step
    const updatedStep: WorkflowStep = {
      ...step,
      name: formData.name,
      type: formData.type as WorkflowStep['type'],
      tool: formData.tool || undefined,
      goal: formData.goal || undefined,
      context: formData.context || undefined,
      outputVariable: formData.outputVariable || undefined,
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
      <DialogContent className="sm:max-w-lg">
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
                  onChange={(e) => handleChange('type', e.target.value)}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:ring-neutral-100"
                >
                  {STEP_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
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
