import { cn } from '@/lib/cn';

interface ButtonVariantProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
}

export function buttonVariants({
  variant = 'primary',
  size = 'md',
}: ButtonVariantProps = {}) {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    {
      'bg-neutral-900 text-white hover:bg-neutral-800': variant === 'primary',
      'border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50':
        variant === 'secondary',
      'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900':
        variant === 'ghost',
      'bg-red-600 text-white hover:bg-red-700': variant === 'destructive',
    },
    {
      'h-8 px-3 text-sm': size === 'sm',
      'h-9 px-4 text-sm': size === 'md',
      'h-10 px-5 text-base': size === 'lg',
    }
  );
}
