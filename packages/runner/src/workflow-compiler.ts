export interface WorkflowCompileError {
  message: string;
  path?: string;
}

export interface NormalizedWorkflowStep extends Record<string, unknown> {
  id: string;
  type: string;
}

export interface NormalizedWorkflowDefinition extends Record<string, unknown> {
  steps: NormalizedWorkflowStep[];
}

export interface CompileWorkflowResult {
  ok: boolean;
  workflow: NormalizedWorkflowDefinition | null;
  workflowHash: string | null;
  stepOrder: string[];
  errors: WorkflowCompileError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStep(stepValue: unknown, path: string, errors: WorkflowCompileError[]): NormalizedWorkflowStep | null {
  if (!isRecord(stepValue)) {
    errors.push({ message: 'Step must be an object', path });
    return null;
  }

  const type = stepValue.type;
  if (typeof type !== 'string' || !type.trim()) {
    errors.push({ message: 'Step type is required', path: `${path}.type` });
    return null;
  }

  const providedId = stepValue.id;
  const id = typeof providedId === 'string' && providedId.trim() ? providedId.trim() : path.replace(/\./g, '_');

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stepValue)) {
    if (key === 'then' || key === 'else' || key === 'steps') {
      if (Array.isArray(value)) {
        const nested = value
          .map((entry, index) => normalizeStep(entry, `${path}.${key}[${index}]`, errors))
          .filter((entry): entry is NormalizedWorkflowStep => entry !== null);
        normalized[key] = nested;
      } else if (value !== undefined && value !== null) {
        errors.push({ message: `${key} must be an array`, path: `${path}.${key}` });
      }
      continue;
    }
    normalized[key] = deepSort(value);
  }

  normalized.id = id;
  normalized.type = type.trim();

  return deepSort(normalized) as NormalizedWorkflowStep;
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepSort(item));
  }
  if (!isRecord(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = deepSort(value[key]);
  }
  return out;
}

function collectStepOrder(steps: NormalizedWorkflowStep[], order: string[]): void {
  for (const step of steps) {
    order.push(step.id);

    const branches = ['then', 'else', 'steps'] as const;
    for (const branch of branches) {
      const nested = step[branch];
      if (Array.isArray(nested)) {
        const nestedSteps = nested
          .filter((entry): entry is NormalizedWorkflowStep => isRecord(entry) && typeof entry.id === 'string' && typeof entry.type === 'string')
          .sort((a, b) => a.id.localeCompare(b.id));
        collectStepOrder(nestedSteps, order);
      }
    }
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function compileWorkflowDefinition(workflowValue: unknown): Promise<CompileWorkflowResult> {
  const errors: WorkflowCompileError[] = [];
  if (!isRecord(workflowValue)) {
    return {
      ok: false,
      workflow: null,
      workflowHash: null,
      stepOrder: [],
      errors: [{ message: 'Workflow must be an object', path: 'workflow' }],
    };
  }

  const rootSteps = workflowValue.steps;
  if (!Array.isArray(rootSteps)) {
    return {
      ok: false,
      workflow: null,
      workflowHash: null,
      stepOrder: [],
      errors: [{ message: 'workflow.steps must be an array', path: 'workflow.steps' }],
    };
  }

  const normalizedSteps = rootSteps
    .map((step, index) => normalizeStep(step, `step[${index}]`, errors))
    .filter((step): step is NormalizedWorkflowStep => step !== null);

  if (errors.length > 0) {
    return {
      ok: false,
      workflow: null,
      workflowHash: null,
      stepOrder: [],
      errors,
    };
  }

  const normalizedRoot = {
    ...workflowValue,
    steps: normalizedSteps,
  } satisfies Record<string, unknown>;

  const workflow = deepSort(normalizedRoot) as NormalizedWorkflowDefinition;
  const serialized = JSON.stringify(workflow);
  const digest = await sha256Hex(serialized);
  const stepOrder: string[] = [];
  collectStepOrder(workflow.steps, stepOrder);

  return {
    ok: true,
    workflow,
    workflowHash: `sha256:${digest}`,
    stepOrder,
    errors: [],
  };
}
