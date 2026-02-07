import { describe, expect, it } from 'bun:test';
import { compileWorkflowDefinition } from './workflow-compiler.js';
import { executeWorkflowRun } from './workflow-engine.js';

describe('workflow-engine', () => {
  it('returns needs_approval with resume token for approval steps', async () => {
    const compiled = await compileWorkflowDefinition({
      steps: [
        { id: 'lint', type: 'tool', tool: 'npm_lint' },
        { id: 'approve', type: 'approval', prompt: 'Ship?' },
      ],
    });

    if (!compiled.ok || !compiled.workflow) {
      throw new Error('compile failed');
    }

    const events: string[] = [];
    const result = await executeWorkflowRun(
      'ex_approval',
      compiled.workflow,
      { variables: {} },
      (event) => events.push(event.type),
    );

    expect(result.status).toBe('needs_approval');
    expect(result.requiresApproval?.stepId).toBe('approve');
    expect(result.requiresApproval?.resumeToken).toStartWith('wrf_rt_');
    expect(events).toContain('approval.required');
  });

  it('evaluates conditional branches deterministically', async () => {
    const compiled = await compileWorkflowDefinition({
      steps: [
        {
          id: 'gate',
          type: 'conditional',
          condition: { variable: 'deploy', equals: true },
          then: [
            { id: 'deploy-step', type: 'tool', tool: 'deploy' },
          ],
          else: [
            { id: 'skip-step', type: 'tool', tool: 'noop' },
          ],
        },
      ],
    });

    if (!compiled.ok || !compiled.workflow) {
      throw new Error('compile failed');
    }

    const result = await executeWorkflowRun('ex_conditional', compiled.workflow, {
      variables: { deploy: true },
    });

    expect(result.status).toBe('ok');
    const stepIds = result.steps.map((step) => step.stepId);
    expect(stepIds).toEqual(['gate', 'deploy-step']);
  });
});
