#!/usr/bin/env bun
import { parseArgs } from 'util';

type WorkflowCommand = 'run' | 'resume' | 'validate' | 'propose';
type WorkflowStatus = 'ok' | 'needs_approval' | 'cancelled' | 'failed';

interface RunPayload {
  workflow?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  runtime?: {
    attempt?: number;
    idempotencyKey?: string;
    policy?: Record<string, unknown>;
  };
}

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

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildRunResult(executionId: string): RunResumeEnvelope {
  return {
    ok: true,
    status: 'ok',
    executionId,
    output: {},
    steps: [],
    requiresApproval: null,
    error: null,
  };
}

async function handleRun(flags: Record<string, string | boolean | undefined>): Promise<void> {
  const executionId = String(flags['execution-id'] || '');
  const workflowHash = String(flags['workflow-hash'] || '');
  const workspace = String(flags['workspace'] || '');

  if (!executionId || !workflowHash || !workspace) {
    fail('Missing required flags for run: --execution-id --workflow-hash --workspace', 20);
  }

  emitEvent({ type: 'execution.started', executionId, ts: nowIso() });

  const rawInput = (await readStdin()).trim();
  if (!rawInput) {
    fail('run requires JSON payload on stdin', 10);
  }

  try {
    JSON.parse(rawInput) as RunPayload;
  } catch {
    fail('Invalid JSON input for run payload', 10);
  }

  emitEvent({ type: 'execution.finished', executionId, status: 'ok', ts: nowIso() });
  printJson(buildRunResult(executionId));
  process.exit(0);
}

async function handleResume(flags: Record<string, string | boolean | undefined>): Promise<void> {
  const executionId = String(flags['execution-id'] || '');
  const resumeToken = String(flags['resume-token'] || '');
  const decision = String(flags['decision'] || 'approve');

  if (!executionId || !resumeToken) {
    fail('Missing required flags for resume: --execution-id --resume-token', 20);
  }

  if (decision !== 'approve' && decision !== 'deny') {
    fail('Invalid --decision value. Expected approve|deny', 10);
  }

  emitEvent({ type: 'execution.resumed', executionId, decision, ts: nowIso() });

  const result: RunResumeEnvelope = {
    ok: true,
    status: decision === 'approve' ? 'ok' : 'cancelled',
    executionId,
    output: {},
    steps: [],
    requiresApproval: null,
    error: null,
  };

  emitEvent({ type: 'execution.finished', executionId, status: result.status, ts: nowIso() });
  printJson(result);
  process.exit(0);
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
    printJson({
      ok: false,
      status: 'invalid',
      workflowHash: null,
      errors: [{ message: 'Invalid JSON' }],
    });
    process.exit(10);
  }

  const steps = parsed.steps;
  if (!Array.isArray(steps)) {
    printJson({
      ok: false,
      status: 'invalid',
      workflowHash: null,
      errors: [{ message: 'workflow.steps must be an array' }],
    });
    process.exit(10);
  }

  const workflowHash = await sha256Hex(workflowRaw);
  printJson({
    ok: true,
    status: 'valid',
    workflowHash: `sha256:${workflowHash}`,
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
  printJson(proposal);
  process.exit(0);
}

function usage(): string {
  return [
    'workflow <command> [flags]',
    '',
    'Commands:',
    '  run       --execution-id <id> --workflow-hash <hash> --workspace <path>',
    '  resume    --execution-id <id> --resume-token <token> [--decision approve|deny]',
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
