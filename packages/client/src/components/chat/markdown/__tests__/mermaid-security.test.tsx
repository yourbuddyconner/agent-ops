/**
 * Security tests for MermaidBlock component
 * 
 * These tests verify that malicious Mermaid diagrams cannot execute
 * scripts or event handlers when securityLevel is set to 'strict'.
 * 
 * NOTE: Requires React testing environment setup in vitest.config.ts
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MermaidBlock } from '../mermaid-block';

describe('MermaidBlock security', () => {
  it('should prevent XSS via onclick handlers', async () => {
    const maliciousInput = `
graph TD
    A[Start] -->|<img src=x onerror=alert(1)>| B[End]
    `;
    
    const { container } = render(<MermaidBlock>{maliciousInput}</MermaidBlock>);
    
    // Wait for rendering
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify no onerror attribute exists in rendered output
    const allElements = container.querySelectorAll('*');
    allElements.forEach(el => {
      expect(el.getAttribute('onerror')).toBeNull();
      expect(el.getAttribute('onclick')).toBeNull();
    });
  });

  it('should prevent script injection via labels', async () => {
    const maliciousInput = `
graph LR
    A["<script>alert('XSS')</script>"] --> B[Safe]
    `;
    
    const { container } = render(<MermaidBlock>{maliciousInput}</MermaidBlock>);
    
    // Wait for rendering
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify no script tags exist
    const scripts = container.querySelectorAll('script');
    expect(scripts).toHaveLength(0);
  });

  it('should prevent javascript: protocol in links', async () => {
    const maliciousInput = `
graph TD
    A[Start] --> B[End]
    click A "javascript:alert('XSS')"
    `;
    
    const { container } = render(<MermaidBlock>{maliciousInput}</MermaidBlock>);
    
    // Wait for rendering
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify no javascript: protocols exist in href attributes
    const links = container.querySelectorAll('a');
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      expect(href.toLowerCase()).not.toContain('javascript:');
    });
  });

  it('should prevent SVG-based XSS attacks', async () => {
    const maliciousInput = `
graph TD
    A["<svg onload=alert(1)>"] --> B[End]
    `;
    
    const { container } = render(<MermaidBlock>{maliciousInput}</MermaidBlock>);
    
    // Wait for rendering
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify no nested SVG elements with onload exist
    const svgElements = container.querySelectorAll('svg');
    svgElements.forEach(svg => {
      expect(svg.getAttribute('onload')).toBeNull();
    });
  });

  it('should render valid diagrams without errors', async () => {
    const validInput = `
graph LR
    A[Start] --> B{Decision}
    B -->|Yes| C[Do Thing]
    B -->|No| D[Do Other Thing]
    C --> E[End]
    D --> E
    `;
    
    const { container, queryByText } = render(<MermaidBlock>{validInput}</MermaidBlock>);
    
    // Wait for rendering
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should not show error state
    expect(queryByText(/error/i)).toBeNull();
    
    // Should contain SVG
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });
});
