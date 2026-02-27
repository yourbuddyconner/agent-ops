# Mermaid Security Hardening

## Change Summary

Switched Mermaid's `securityLevel` from `'loose'` to `'strict'` to prevent XSS-like attacks from untrusted diagram content.

## Security Impact

### Before (loose mode)
- Allowed arbitrary HTML/SVG injection in labels
- Permitted `javascript:` protocol in click handlers
- Enabled event handlers (onclick, onerror, onload) in diagram elements
- Created XSS attack surface when rendering untrusted LLM/user content

### After (strict mode)
- Blocks script execution in diagram content
- Sanitizes labels and node text
- Prevents event handler injection
- Restricts potentially dangerous SVG features

## Compatibility

### Diagrams that still work
All standard Mermaid diagram types continue to render:
- Flowcharts
- Sequence diagrams
- Class diagrams
- State diagrams
- ER diagrams
- Gantt charts
- Pie charts
- Git graphs
- User journey diagrams

### Potentially restricted features
The following features may be restricted in strict mode:
- Custom HTML in node labels (use plain text instead)
- Click handlers with `javascript:` protocol (use `http://` or `https://` only)
- Inline SVG styling that includes event handlers

### Fallback
The component includes a "Source" toggle button that allows users to view the raw Mermaid syntax if a diagram fails to render under strict mode.

## Attack Vectors Mitigated

1. **Label injection**: `graph TD; A["<img src=x onerror=alert(1)>"]`
2. **Script tags**: `graph TD; A["<script>alert('XSS')</script>"]`
3. **JavaScript protocol**: `click A "javascript:alert('XSS')"`
4. **Event handlers**: `graph TD; A["<svg onload=alert(1)>"]`
5. **SVG-based XSS**: Nested SVG elements with malicious attributes

## Testing

Security tests are provided in `__tests__/mermaid-security.test.tsx` but require React testing environment setup. To enable:

1. Add `packages/client` to `vitest.config.ts` projects array
2. Install `@testing-library/react` and `@testing-library/jest-dom`
3. Configure JSDOM environment for React component testing
4. Run: `pnpm test packages/client`

## References

- [Mermaid Security Documentation](https://mermaid.js.org/config/setup/modules/mermaidAPI.html#securitylevel)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)

## Verification

To verify the fix is working:

1. Try rendering a valid flowchart - should work normally
2. Try rendering a malicious diagram with script injection - should either fail to render or strip dangerous content
3. Use the "Source" toggle to view raw diagram syntax if rendering fails

The security posture is now defense-in-depth:
1. Mermaid strict mode blocks dangerous features
2. React's rendering is already XSS-safe
3. Source fallback ensures usability is maintained
