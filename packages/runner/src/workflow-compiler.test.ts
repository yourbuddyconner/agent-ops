import { describe, expect, it } from 'bun:test';
import { compileWorkflowDefinition } from './workflow-compiler.js';

describe('workflow-compiler', () => {
  it('produces a stable hash regardless of object key order', async () => {
    const workflowA = {
      name: 'deploy',
      steps: [
        { id: 'lint', type: 'tool', arguments: { level: 'strict', retries: 1 }, tool: 'npm_lint' },
      ],
    };

    const workflowB = {
      steps: [
        { type: 'tool', tool: 'npm_lint', id: 'lint', arguments: { retries: 1, level: 'strict' } },
      ],
      name: 'deploy',
    };

    const compiledA = await compileWorkflowDefinition(workflowA);
    const compiledB = await compileWorkflowDefinition(workflowB);

    expect(compiledA.ok).toBe(true);
    expect(compiledB.ok).toBe(true);
    expect(compiledA.workflowHash).toBe(compiledB.workflowHash);
  });

  it('collects deterministic step order including nested branches', async () => {
    const workflow = {
      steps: [
        {
          id: 'main',
          type: 'conditional',
          then: [
            { id: 'then-b', type: 'tool' },
            { id: 'then-a', type: 'tool' },
          ],
          else: [
            { id: 'else-1', type: 'tool' },
          ],
        },
      ],
    };

    const compiled = await compileWorkflowDefinition(workflow);
    expect(compiled.ok).toBe(true);
    expect(compiled.stepOrder).toEqual(['main', 'then-a', 'then-b', 'else-1']);
  });
});
