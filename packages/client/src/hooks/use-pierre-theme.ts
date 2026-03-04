import { useTheme } from './use-theme';

export function usePierreTheme(): 'pierre-dark' | 'pierre-light' {
  const { isDark } = useTheme();
  return isDark ? 'pierre-dark' : 'pierre-light';
}
