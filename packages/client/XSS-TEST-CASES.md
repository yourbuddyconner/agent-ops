# XSS Test Cases for Markdown Rendering

## Overview
This document outlines XSS attack vectors to verify that the markdown rendering pipeline (without `rehypeRaw`) properly prevents execution of malicious payloads.

## Test Cases

### 1. Script Tag Injection
```markdown
<script>alert('XSS')</script>
```
**Expected**: Script tags are not parsed/executed. Text rendered as literal markdown.

### 2. IMG onerror Handler
```markdown
<img src="invalid" onerror="alert('XSS')">
```
**Expected**: HTML not parsed; rendered as text or stripped.

### 3. SVG with Script
```markdown
<svg onload="alert('XSS')">
```
**Expected**: SVG not parsed/executed.

### 4. JavaScript Protocol in Link
```markdown
[Click me](javascript:alert('XSS'))
```
**Expected**: Link href sanitized; javascript: protocol blocked.

### 5. Data URI with Script
```markdown
<iframe src="data:text/html,<script>alert('XSS')</script>">
```
**Expected**: iframe not rendered.

### 6. Style Injection
```markdown
<div style="background:url('javascript:alert(1)')">
```
**Expected**: Style attribute with javascript: blocked or not parsed.

### 7. Object/Embed Tags
```markdown
<object data="javascript:alert('XSS')">
<embed src="javascript:alert('XSS')">
```
**Expected**: Tags not parsed/executed.

### 8. HTML Event Handlers
```markdown
<div onclick="alert('XSS')">Click me</div>
<body onload="alert('XSS')">
```
**Expected**: Event handler attributes stripped or not parsed.

## Legitimate Use Cases (Should Still Work)

### 1. Safe Markdown Images
```markdown
![Alt text](https://example.com/image.png)
```
**Expected**: Image renders correctly via custom `MarkdownImage` component.

### 2. Data URI Images (Base64)
```markdown
![Base64](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)
```
**Expected**: Base64 images allowed per sanitize schema.

### 3. Code Blocks
```markdown
\`\`\`javascript
console.log('This is code, not execution');
\`\`\`
```
**Expected**: Rendered in `CodeBlock` component with syntax highlighting.

### 4. Mermaid Diagrams
```markdown
\`\`\`mermaid
graph TD;
    A-->B;
\`\`\`
```
**Expected**: Rendered via `MermaidBlock` component.

### 5. Safe Links
```markdown
[Safe link](https://example.com)
```
**Expected**: Link opens in new tab with `rel="noopener noreferrer"`.

### 6. Inline Code
```markdown
This is `inline code` in a sentence.
```
**Expected**: Styled inline code span.

### 7. Standard Markdown Formatting
```markdown
**Bold**, *italic*, ~~strikethrough~~

- List item 1
- List item 2

> Blockquote
```
**Expected**: All standard markdown features work correctly.

## Manual Verification Steps

1. Start dev server: `pnpm dev` from root
2. Navigate to a chat interface
3. Send messages containing each test case above
4. Verify:
   - No JavaScript execution (no alert dialogs)
   - No console errors related to XSS attempts
   - Legitimate markdown renders correctly
   - Malicious payloads are either stripped or rendered as plain text

## Future Automated Testing

To add automated tests, the client package needs:
- Testing library setup (vitest + @testing-library/react)
- jsdom or happy-dom environment
- React component test utilities

Test file location: `packages/client/src/components/chat/markdown/__tests__/markdown-content.test.tsx`

Example test structure:
```typescript
import { render } from '@testing-library/react';
import { MarkdownContent } from '../markdown-content';

describe('MarkdownContent XSS Protection', () => {
  it('should not execute script tags', () => {
    const xssPayload = '<script>alert("XSS")</script>';
    const { container } = render(<MarkdownContent content={xssPayload} />);
    
    // Verify no script tag in DOM
    expect(container.querySelector('script')).toBeNull();
  });
  
  // Additional test cases...
});
```

## Sanitization Schema

Current schema (in `markdown-content.tsx`):
- Extends `defaultSchema` from `rehype-sanitize`
- Allows `data:image/*` URIs on `img.src` for base64 screenshots
- Allows `https?://` protocols on `img.src`

The schema should be reviewed periodically against:
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [rehype-sanitize documentation](https://github.com/rehypejs/rehype-sanitize)
