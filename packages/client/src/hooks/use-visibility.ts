import { useState, useEffect } from 'react';

/**
 * Custom hook that tracks page visibility using the Page Visibility API.
 * Returns true when the page/tab is visible, false when hidden.
 */
export function useVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() => {
    // Default to true on server or if API not available
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
