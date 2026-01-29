import { memo, useMemo, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import { CodeBlock } from './code-block';
import { MarkdownImage } from './markdown-image';

// Extend default sanitize schema to allow data: URIs on img src (for base64 screenshots)
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), ['src', /^data:image\//i, /^https?:\/\//i]],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data'],
  },
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema]] as ComponentProps<typeof ReactMarkdown>['rehypePlugins'];

const components: Components = {
  // Route fenced code blocks through our CodeBlock component
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children, ...rest }) {
    const match = /language-(\w+)/.exec(className || '');
    const isBlock = Boolean(match);
    const code = String(children).replace(/\n$/, '');

    if (isBlock) {
      return <CodeBlock language={match![1]}>{code}</CodeBlock>;
    }

    return (
      <code
        className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
        {...rest}
      >
        {children}
      </code>
    );
  },
  img({ src, alt }) {
    return <MarkdownImage src={src} alt={alt} />;
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:text-accent/80"
      >
        {children}
      </a>
    );
  },
};

interface MarkdownContentProps {
  content: string;
}

export const MarkdownContent = memo(function MarkdownContent({ content }: MarkdownContentProps) {
  // Memoize to avoid recreating the markdown tree on parent re-renders
  const element = useMemo(
    () => (
      <div className="markdown-body mt-1 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    ),
    [content]
  );

  return element;
});
