import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', asChild = false, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-md text-[13px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
          'disabled:pointer-events-none disabled:opacity-40',
          {
            'bg-accent text-white hover:bg-accent/90':
              variant === 'primary',
            'border border-neutral-200 bg-surface-0 text-neutral-900 hover:bg-surface-2 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-surface-2':
              variant === 'secondary',
            'text-neutral-500 hover:bg-surface-2 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-surface-2 dark:hover:text-neutral-100':
              variant === 'ghost',
            'bg-red-600 text-white hover:bg-red-700': variant === 'destructive',
            'border border-neutral-300 bg-transparent text-neutral-700 hover:bg-surface-2 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-surface-2':
              variant === 'outline',
          },
          {
            'h-7 gap-1 px-2.5': size === 'sm',
            'h-8 gap-1.5 px-3.5': size === 'md',
            'h-9 gap-2 px-5': size === 'lg',
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
export type { ButtonProps };
