import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Hook to detect if the current viewport is mobile-sized.
 * Uses the `md` breakpoint (768px) as the threshold.
 * Returns true when viewport width is below 768px.
 *
 * Note: Always starts with `false` to avoid SSR hydration mismatch.
 * The correct value is set on first effect run (client-side only).
 */
export function useIsMobile(): boolean {
  // Always start with false to match SSR and avoid hydration mismatch
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    // Initial check - runs only on client
    handleChange(query);

    // Listen for changes
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}
