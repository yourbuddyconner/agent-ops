import * as React from 'react';
import type { Workflow } from '@/api/workflows';
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

interface EditWorkflowDialogProps {
  workflow: Workflow;
  trigger?: React.ReactNode;
}

export function EditWorkflowDialog({ workflow, trigger }: EditWorkflowDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: workflow.name,
    description: workflow.description || '',
    version: workflow.version,
    slug: workflow.slug || '',
    enabled: workflow.enabled,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const updateWorkflow = useUpdateWorkflow();

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setFormData({
        name: workflow.name,
        description: workflow.description || '',
        version: workflow.version,
        slug: workflow.slug || '',
        enabled: workflow.enabled,
      });
      setErrors({});
    }
  }, [open, workflow]);

  const handleChange = (field: string, value: string | boolean) => {
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
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      await updateWorkflow.mutateAsync({
        workflowId: workflow.id,
        name: formData.name,
        description: formData.description || null,
        version: formData.version,
        slug: formData.slug || null,
        enabled: formData.enabled,
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
          <Button variant="secondary" size="sm">
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Workflow</DialogTitle>
            <DialogDescription>
              Update the workflow settings and metadata.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label
                htmlFor="name"
                className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Name
              </label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Workflow name"
                className={cn(errors.name && 'border-red-500')}
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.name}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="description"
                className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Description
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="What does this workflow do?"
                rows={3}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="version"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Version
                </label>
                <Input
                  id="version"
                  value={formData.version}
                  onChange={(e) => handleChange('version', e.target.value)}
                  placeholder="1.0.0"
                />
              </div>

              <div>
                <label
                  htmlFor="slug"
                  className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Slug
                </label>
                <Input
                  id="slug"
                  value={formData.slug}
                  onChange={(e) => handleChange('slug', e.target.value)}
                  placeholder="my-workflow"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={formData.enabled}
                onClick={() => handleChange('enabled', !formData.enabled)}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                  formData.enabled
                    ? 'bg-neutral-900 dark:bg-neutral-100'
                    : 'bg-neutral-200 dark:bg-neutral-700'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg ring-0 dark:bg-neutral-900',
                    formData.enabled ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {formData.enabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateWorkflow.isPending}>
              {updateWorkflow.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
