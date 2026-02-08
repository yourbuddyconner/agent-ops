export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateStep(step: unknown, path: string, errors: string[]): void {
  if (!isRecord(step)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const type = step.type;
  if (typeof type !== 'string' || !type.trim()) {
    errors.push(`${path}.type is required`);
  }

  const nestedKeys = ['then', 'else', 'steps'] as const;
  for (const key of nestedKeys) {
    if (!(key in step)) continue;
    const value = step[key];
    if (value == null) continue;
    if (!Array.isArray(value)) {
      errors.push(`${path}.${key} must be an array`);
      continue;
    }

    for (let i = 0; i < value.length; i += 1) {
      validateStep(value[i], `${path}.${key}[${i}]`, errors);
    }
  }
}

export function validateWorkflowDefinition(value: unknown): WorkflowValidationResult {
  if (!isRecord(value)) {
    return { valid: false, errors: ['Workflow definition must be an object'] };
  }

  const steps = value.steps;
  if (!Array.isArray(steps)) {
    return { valid: false, errors: ['workflow.steps must be an array'] };
  }

  if (steps.length === 0) {
    return { valid: false, errors: ['workflow.steps must not be empty'] };
  }

  const errors: string[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    validateStep(steps[i], `workflow.steps[${i}]`, errors);
  }

  return { valid: errors.length === 0, errors };
}
