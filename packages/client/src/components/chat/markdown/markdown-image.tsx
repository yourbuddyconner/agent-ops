import { useState, useCallback, memo } from 'react';

interface MarkdownImageProps {
  src?: string;
  alt?: string;
}

export const MarkdownImage = memo(function MarkdownImage({ src, alt }: MarkdownImageProps) {
  const [expanded, setExpanded] = useState(false);

  const handleOpen = useCallback(() => setExpanded(true), []);
  const handleClose = useCallback(() => setExpanded(false), []);

  if (!src) return null;

  return (
    <>
      <img
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        onClick={handleOpen}
        className="my-2 max-h-[400px] max-w-full cursor-pointer rounded-md border border-neutral-200 object-contain dark:border-neutral-700"
      />

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onClick={handleClose}
        >
          <img
            src={src}
            alt={alt ?? ''}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      )}
    </>
  );
});
