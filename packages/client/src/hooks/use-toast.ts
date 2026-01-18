import { create } from 'zustand';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
    return id;
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  clearToasts: () => set({ toasts: [] }),
}));

export function useToast() {
  return useToastStore();
}

// Convenience function for showing toasts outside of React components
export function toast(options: Omit<Toast, 'id'>) {
  useToastStore.getState().addToast(options);
}

export const toastSuccess = (title: string, description?: string) =>
  toast({ title, description, variant: 'success' });

export const toastError = (title: string, description?: string) =>
  toast({ title, description, variant: 'error' });

export const toastWarning = (title: string, description?: string) =>
  toast({ title, description, variant: 'warning' });
