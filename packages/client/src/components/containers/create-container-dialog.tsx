import * as React from 'react';
import { useCreateContainer } from '@/api/containers';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

const INSTANCE_SIZES = [
  { value: 'dev', label: 'Dev', memory: '256 MB', description: 'For light tasks', price: '~$0.009/hr' },
  { value: 'basic', label: 'Basic', memory: '1 GB', description: 'General development', price: '~$0.025/hr' },
  { value: 'standard', label: 'Standard', memory: '4 GB', description: 'Complex projects', price: '~$0.045/hr' },
] as const;

const SLEEP_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
] as const;

interface CreateContainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateContainerDialog({
  open,
  onOpenChange,
}: CreateContainerDialogProps) {
  const [formData, setFormData] = React.useState({
    name: '',
    instanceSize: 'basic' as 'dev' | 'basic' | 'standard',
    autoSleepMinutes: 15,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const createContainer = useCreateContainer();

  React.useEffect(() => {
    if (open) {
      setFormData({ name: '', instanceSize: 'basic', autoSleepMinutes: 15 });
      setErrors({});
    }
  }, [open]);

  const handleChange = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    } else if (formData.name.length > 64) {
      newErrors.name = 'Name must be 64 characters or less';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.name)) {
      newErrors.name = 'Name can only contain letters, numbers, hyphens, and underscores';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      await createContainer.mutateAsync({
        name: formData.name,
        instanceSize: formData.instanceSize,
        autoSleepMinutes: formData.autoSleepMinutes,
      });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        setErrors({ name: 'A container with this name already exists' });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Container</DialogTitle>
            <DialogDescription>
              Set up a new OpenCode development environment.
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
                placeholder="my-project"
                className={cn(errors.name && 'border-red-500')}
              />
              {errors.name ? (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.name}</p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Letters, numbers, hyphens, and underscores only
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Instance Size
              </label>
              <div className="grid grid-cols-3 gap-2">
                {INSTANCE_SIZES.map((size) => (
                  <button
                    key={size.value}
                    type="button"
                    onClick={() => handleChange('instanceSize', size.value)}
                    className={cn(
                      'rounded-lg border p-3 text-left',
                      formData.instanceSize === size.value
                        ? 'border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800'
                        : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                    )}
                  >
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">
                      {size.label}
                    </p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {size.memory}
                    </p>
                    <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                      {size.price}
                    </p>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-pretty text-neutral-500 dark:text-neutral-400">
                You only pay while the container is running. It automatically sleeps after inactivity.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Auto-sleep after
              </label>
              <div className="flex flex-wrap gap-2">
                {SLEEP_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleChange('autoSleepMinutes', option.value)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium',
                      formData.autoSleepMinutes === option.value
                        ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-pretty text-neutral-500 dark:text-neutral-400">
                Container will stop automatically after this period of inactivity to save costs.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createContainer.isPending}>
              {createContainer.isPending ? 'Creating...' : 'Create Container'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
