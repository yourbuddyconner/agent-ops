#!/usr/bin/env bun
import { parseArgs } from 'util';
import { compileWorkflowDefinition } from './workflow-compiler.js';
import { executeWorkflowRun, executeWorkflowResume, type WorkflowRunPayload } from './workflow-engine.js';

type WorkflowCommand = 'run' | 'resume' | 'validate' | 'propose';
type WorkflowStatus = 'ok' | 'needs_approval' | 'cancelled' | 'failed';

interface RunResumeEnvelope {
  ok: boolean;
  status: WorkflowStatus;
  executionId: string;
  output: Record<string, unknown>;
  steps: Array<{
    stepId: string;
    status: string;
    attempt?: number;
    startedAt?: string;
    completedAt?: string;
    output?: unknown;
    error?: string;
  }>;
  requiresApproval: null | {
    stepId: string;
    prompt: string;
    items: unknown[];
    resumeToken: string;
  };
  error: string | null;
}

function emitEvent(event: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function printJson(value: unknown): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, () => resolve());
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeHash(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('sha256:') ? trimmed : `sha256:${trimmed}`;
}

async function handleRun(flags: Record<string, string | boolean | undefined>): Promise<void> {
  const executionId = String(flags['execution-id'] || '');
  const workflowHash = normalizeHash(String(flags['workflow-hash'] || ''));
  const workspace = String(flags['workspace'] || '');

  if (!executionId || !workflowHash || !workspace) {
    fail('Missing required flags for run: --execution-id --workflow-hash --workspace', 20);
  }

  const rawInput = (await readStdin()).trim();
  if (!rawInput) {
    fail('run requires JSON payload on stdin', 10);
  }

  let payload: WorkflowRunPayload & { workflow?: unknown };
  try {
    payload = JSON.parse(rawInput) as WorkflowRunPayload & { workflow?: unknown };
  } catch {
    fail('Invalid JSON input for run payload', 10);
  }

  if (!payload.workflow) {
    fail('run payload must include workflow object', 10);
  }

  const compiled = await compileWorkflowDefinition(payload.workflow);
  if (!compiled.ok || !compiled.workflow || !compiled.workflowHash) {
    await printJson({
      ok: false,
      status: 'failed',
      executionId,
      output: {},
      steps: [],
      requiresApproval: null,
      error: compiled.errors[0]?.message || 'Workflow compilation failed',
    });
    process.exit(10);
  }

  if (normalizeHash(compiled.workflowHash) !== workflowHash) {
    fail(`Workflow hash mismatch: expected ${workflowHash}, got ${compiled.workflowHash}`, 20);
  }

  const result = await executeWorkflowRun(
    executionId,
    compiled.workflow,
    {
      trigger: payload.trigger,
      variables: payload.variables,
      runtime: payload.runtime,
    },
    undefined,
    (event) => emitEvent(event),
  );

  await printJson(result);
  process.exit(result.status === 'failed' ? 40 : 0);
}

async function handleResume(flags: Record<string, string | boolean | undefined>): Promise<void> {
  const executionId = String(flags['execution-id'] || '');
  const resumeToken = String(flags['resume-token'] || '');
  const decision = String(flags['decision'] || 'approve');
  const workflowHash = normalizeHash(String(flags['workflow-hash'] || ''));
  const workspace = String(flags.workspace || '');

  if (!executionId || !resumeToken) {
    fail('Missing required flags for resume: --execution-id --resume-token', 20);
  }

  if (decision !== 'approve' && decision !== 'deny') {
    fail('Invalid --decision value. Expected approve|deny', 10);
  }

  if (decision === 'deny') {
    emitEvent({ type: 'execution.resumed', executionId, decision, ts: nowIso() });
    const result: RunResumeEnvelope = {
      ok: true,
      status: 'cancelled',
      executionId,
      output: {},
      steps: [],
      requiresApproval: null,
      error: 'approval_denied',
    };
    emitEvent({ type: 'execution.finished', executionId, status: result.status, ts: nowIso() });
    await printJson(result);
    process.exit(0);
  }

  if (!workflowHash || !workspace) {
    fail('Missing required flags for resume approval: --workflow-hash --workspace', 20);
  }

  const rawInput = (await readStdin()).trim();
  if (!rawInput) {
    fail('resume approve requires JSON payload on stdin', 20);
  }

  let payload: WorkflowRunPayload & { workflow?: unknown };
  try {
    payload = JSON.parse(rawInput) as WorkflowRunPayload & { workflow?: unknown };
  } catch {
    fail('Invalid JSON input for resume payload', 10);
  }

  if (!payload.workflow) {
    fail('resume payload must include workflow object', 10);
  }

  const compiled = await compileWorkflowDefinition(payload.workflow);
  if (!compiled.ok || !compiled.workflow || !compiled.workflowHash) {
    await printJson({
      ok: false,
      status: 'failed',
      executionId,
      output: {},
      steps: [],
      requiresApproval: null,
      error: compiled.errors[0]?.message || 'Workflow compilation failed',
    });
    process.exit(10);
  }

  if (normalizeHash(compiled.workflowHash) !== workflowHash) {
    fail(`Workflow hash mismatch: expected ${workflowHash}, got ${compiled.workflowHash}`, 20);
  }

  const result = await executeWorkflowResume(
    executionId,
    compiled.workflow,
    {
      trigger: payload.trigger,
      variables: payload.variables,
      runtime: payload.runtime,
    },
    resumeToken,
    'approve',
    undefined,
    (event) => emitEvent(event),
  );

  await printJson(result);
  process.exit(result.status === 'failed' ? 40 : 0);
}

async function handleValidate(flags: Record<string, string | boolean | undefined>): Promise<void> {
  const workflowPath = String(flags['workflow-path'] || '');
  const workflowJsonStdin = flags['workflow-json'] === '-';

  if (!workflowPath && !workflowJsonStdin) {
    fail('validate requires --workflow-path <path> or --workflow-json -', 10);
  }

  let workflowRaw = '';
  if (workflowJsonStdin) {
    workflowRaw = (await readStdin()).trim();
  } else {
    try {
      workflowRaw = await Bun.file(workflowPath).text();
    } catch (error) {
      fail(`Failed to read workflow file: ${String(error)}`, 10);
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(workflowRaw) as Record<string, unknown>;
  } catch {
    await printJson({
      ok: false,
      status: 'invalid',
      workflowHash: null,
      errors: [{ message: 'Invalid JSON' }],
    });
    process.exit(10);
  }

  const compiled = await compileWorkflowDefinition(parsed);
  if (!compiled.ok || !compiled.workflowHash) {
    await printJson({
      ok: false,
      status: 'invalid',
      workflowHash: null,
      errors: compiled.errors,
    });
    process.exit(10);
  }

  await printJson({
    ok: true,
    status: 'valid',
    workflowHash: compiled.workflowHash,
    stepOrder: compiled.stepOrder,
    errors: [],
  });
  process.exit(0);
}

async function handlePropose(flags: Record<string, string | boolean | undefined>): Promise<void> {
  const workflowId = String(flags['workflow-id'] || '');
  const baseHash = String(flags['base-hash'] || '');
  const intent = String(flags.intent || '');

  if (!workflowId || !baseHash || !intent) {
    fail('propose requires --workflow-id --base-hash --intent', 20);
  }

  const proposal = {
    ok: true,
    status: 'proposal_created',
    proposal: {
      baseHash,
      proposedWorkflow: {},
      summary: intent,
      riskLevel: 'medium',
      diff: '--- old\n+++ new\n# proposal stub',
    },
    error: null,
  };

  emitEvent({ type: 'proposal.created', workflowId, ts: nowIso() });
  await printJson(proposal);
  process.exit(0);
}

function usage(): string {
  return [
    'workflow <command> [flags]',
    '',
    'Commands:',
    '  run       --execution-id <id> --workflow-hash <hash> --workspace <path>',
    '  resume    --execution-id <id> --resume-token <token> [--decision approve|deny] [--workflow-hash <hash> --workspace <path>]',
    '  validate  --workflow-path <path> | --workflow-json -',
    '  propose   --workflow-id <id> --base-hash <hash> --intent "<text>"',
  ].join('\n');
}

async function main(): Promise<void> {
  const [commandRaw, ...rest] = Bun.argv.slice(2);
  if (!commandRaw || commandRaw === '--help' || commandRaw === '-h') {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const command = commandRaw as WorkflowCommand;
  const { values } = parseArgs({
    args: rest,
    options: {
      'execution-id': { type: 'string' },
      'workflow-hash': { type: 'string' },
      workspace: { type: 'string' },
      'resume-token': { type: 'string' },
      decision: { type: 'string' },
      'workflow-path': { type: 'string' },
      'workflow-json': { type: 'string' },
      'workflow-id': { type: 'string' },
      'base-hash': { type: 'string' },
      intent: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  switch (command) {
    case 'run':
      await handleRun(values);
      return;
    case 'resume':
      await handleResume(values);
      return;
    case 'validate':
      await handleValidate(values);
      return;
    case 'propose':
      await handlePropose(values);
      return;
    default:
      fail(`Unknown command: ${commandRaw}\n\n${usage()}`, 10);
  }
}

main().catch((error) => {
  process.stderr.write(`workflow CLI internal error: ${String(error)}\n`);
  process.exit(40);
});
