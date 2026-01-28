import * as React from 'react';
import type { Container } from '@/api/containers';
import { useUpdateContainer } from '@/api/containers';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
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

interface EditContainerDialogProps {
  container: Container;
  trigger?: React.ReactNode;
}

export function EditContainerDialog({
  container,
  trigger,
}: EditContainerDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: container.name,
    instanceSize: container.instanceSize,
    autoSleepMinutes: container.autoSleepMinutes,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const updateContainer = useUpdateContainer();

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setFormData({
        name: container.name,
        instanceSize: container.instanceSize,
        autoSleepMinutes: container.autoSleepMinutes,
      });
      setErrors({});
    }
  }, [open, container]);

  const handleChange = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const canChangeInstanceSize = container.status === 'stopped';

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

    // Build update payload - only include changed fields
    const updates: {
      containerId: string;
      name?: string;
      instanceSize?: 'dev' | 'basic' | 'standard';
      autoSleepMinutes?: number;
    } = { containerId: container.id };

    if (formData.name !== container.name) {
      updates.name = formData.name;
    }
    if (formData.instanceSize !== container.instanceSize && canChangeInstanceSize) {
      updates.instanceSize = formData.instanceSize;
    }
    if (formData.autoSleepMinutes !== container.autoSleepMinutes) {
      updates.autoSleepMinutes = formData.autoSleepMinutes;
    }

    // Only submit if there are changes
    if (Object.keys(updates).length === 1) {
      setOpen(false);
      return;
    }

    try {
      await updateContainer.mutateAsync(updates);
      setOpen(false);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        setErrors({ name: 'A container with this name already exists' });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="secondary" size="sm">
            <SettingsIcon className="mr-2 size-4" />
            Settings
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Container Settings</DialogTitle>
            <DialogDescription>
              Update your container configuration.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name */}
            <div>
              <label
                htmlFor="edit-name"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                Name
              </label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="my-project"
                className={cn(errors.name && 'border-red-500')}
              />
              {errors.name ? (
                <p className="mt-1 text-sm text-red-600">{errors.name}</p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">
                  Letters, numbers, hyphens, and underscores only
                </p>
              )}
            </div>

            {/* Instance Size */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700">
                Instance Size
              </label>
              <div className="grid grid-cols-3 gap-2">
                {INSTANCE_SIZES.map((size) => (
                  <button
                    key={size.value}
                    type="button"
                    onClick={() => handleChange('instanceSize', size.value)}
                    disabled={!canChangeInstanceSize}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      formData.instanceSize === size.value
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-neutral-200 hover:border-neutral-300',
                      !canChangeInstanceSize && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <p className="font-medium text-neutral-900">
                      {size.label}
                    </p>
                    <p className="text-sm text-neutral-500">
                      {size.memory}
                    </p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {size.price}
                    </p>
                  </button>
                ))}
              </div>
              {!canChangeInstanceSize && (
                <p className="mt-1.5 text-xs text-yellow-600">
                  Stop the container to change instance size.
                </p>
              )}
            </div>

            {/* Auto-sleep */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700">
                Auto-sleep after
              </label>
              <div className="flex flex-wrap gap-2">
                {SLEEP_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleChange('autoSleepMinutes', option.value)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      formData.autoSleepMinutes === option.value
                        ? 'bg-neutral-900 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">
                Container will stop automatically after this period of inactivity.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateContainer.isPending}>
              {updateContainer.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsIcon({ className }: { className?: string }) {
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
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
