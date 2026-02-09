import type { WorkflowStep } from '@/api/workflows';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

export interface StepFormData {
  id: string;
  name: string;
  type: WorkflowStep['type'];
  tool: string;
  goal: string;
  context: string;
  awaitResponse: boolean;
  awaitTimeoutMs: string;
  outputVariable: string;
  argumentsJson: string;
  conditionJson: string;
  thenJson: string;
  elseJson: string;
  stepsJson: string;
}

interface StepBehaviorEditorsProps {
  formData: StepFormData;
  errors: Record<string, string>;
  onChange: <K extends keyof StepFormData>(field: K, value: StepFormData[K]) => void;
}

const labelClassName = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-300';
const jsonAreaClassName =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-accent/30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500';
const textAreaClassName =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-accent/30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500';

export function StepBehaviorEditors({ formData, errors, onChange }: StepBehaviorEditorsProps) {
  if (formData.type === 'tool') {
    return <ToolStepEditor formData={formData} errors={errors} onChange={onChange} />;
  }

  if (formData.type === 'agent') {
    return <AgentStepEditor formData={formData} onChange={onChange} />;
  }

  if (formData.type === 'agent_message') {
    return <AgentMessageStepEditor formData={formData} errors={errors} onChange={onChange} />;
  }

  if (formData.type === 'conditional') {
    return <ConditionalStepEditor formData={formData} errors={errors} onChange={onChange} />;
  }

  if (formData.type === 'parallel' || formData.type === 'loop' || formData.type === 'subworkflow') {
    return <CompositeStepEditor formData={formData} errors={errors} onChange={onChange} />;
  }

  if (formData.type === 'approval') {
    return <ApprovalStepEditor formData={formData} onChange={onChange} />;
  }

  return null;
}

function ToolStepEditor({
  formData,
  errors,
  onChange,
}: {
  formData: StepFormData;
  errors: Record<string, string>;
  onChange: StepBehaviorEditorsProps['onChange'];
}) {
  return (
    <BehaviorShell
      title="Tool Step"
      description="Configure deterministic tool execution and JSON payload arguments."
      tone="cyan"
    >
      <div>
        <label htmlFor="step-tool" className={labelClassName}>
          Tool
        </label>
        <Input
          id="step-tool"
          value={formData.tool}
          onChange={(e) => onChange('tool', e.target.value)}
          placeholder="bash"
          className={cn(errors.tool && 'border-red-500')}
        />
        <FieldError message={errors.tool} />
      </div>

      <JsonField
        id="step-arguments"
        label="Arguments (JSON)"
        value={formData.argumentsJson}
        placeholder='{"command":"echo hello"}'
        rows={7}
        error={errors.argumentsJson}
        onChange={(value) => onChange('argumentsJson', value)}
      />

      <TextField
        id="step-goal"
        label="Goal"
        value={formData.goal}
        placeholder="What should this step accomplish?"
        rows={3}
        onChange={(value) => onChange('goal', value)}
      />
    </BehaviorShell>
  );
}

function AgentStepEditor({
  formData,
  onChange,
}: {
  formData: StepFormData;
  onChange: StepBehaviorEditorsProps['onChange'];
}) {
  return (
    <BehaviorShell
      title="Agent Step"
      description="Define the mission and supporting context used by the orchestrator persona."
      tone="amber"
    >
      <TextField
        id="step-goal"
        label="Goal"
        value={formData.goal}
        placeholder="What should this step accomplish?"
        rows={3}
        onChange={(value) => onChange('goal', value)}
      />

      <TextField
        id="step-context"
        label="Context"
        value={formData.context}
        placeholder="Additional context for the agent"
        rows={4}
        onChange={(value) => onChange('context', value)}
      />
    </BehaviorShell>
  );
}

function AgentMessageStepEditor({
  formData,
  errors,
  onChange,
}: {
  formData: StepFormData;
  errors: Record<string, string>;
  onChange: StepBehaviorEditorsProps['onChange'];
}) {
  return (
    <BehaviorShell
      title="Agent Message Step"
      description="Send a message to the current workflow session agent without manually specifying a target session."
      tone="amber"
    >
      <TextField
        id="step-agent-message"
        label="Message"
        value={formData.goal}
        placeholder="Summarize current execution status and propose next actions."
        rows={4}
        error={errors.goal}
        onChange={(value) => onChange('goal', value)}
      />

      <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
        <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
          <input
            type="checkbox"
            checked={formData.awaitResponse}
            onChange={(e) => onChange('awaitResponse', e.target.checked)}
            className="size-4 rounded border-neutral-300 text-accent focus:ring-accent/30"
          />
          Wait for agent response before continuing
        </label>
      </div>

      {formData.awaitResponse && (
        <div>
          <label htmlFor="step-agent-await-timeout" className={labelClassName}>
            Await Timeout (ms)
          </label>
          <Input
            id="step-agent-await-timeout"
            value={formData.awaitTimeoutMs}
            onChange={(e) => onChange('awaitTimeoutMs', e.target.value)}
            placeholder="120000"
            className={cn(errors.awaitTimeoutMs && 'border-red-500')}
          />
          <FieldError message={errors.awaitTimeoutMs} />
        </div>
      )}
    </BehaviorShell>
  );
}

function ConditionalStepEditor({
  formData,
  errors,
  onChange,
}: {
  formData: StepFormData;
  errors: Record<string, string>;
  onChange: StepBehaviorEditorsProps['onChange'];
}) {
  return (
    <BehaviorShell
      title="Conditional Step"
      description="Define a runtime condition and both branch paths using explicit JSON step arrays."
      tone="neutral"
    >
      <JsonField
        id="step-condition"
        label="Condition (JSON)"
        value={formData.conditionJson}
        placeholder='{"variable":"deploy","equals":true}'
        rows={4}
        error={errors.conditionJson}
        onChange={(value) => onChange('conditionJson', value)}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <JsonField
          id="step-then"
          label="Then Branch Steps (JSON array)"
          value={formData.thenJson}
          placeholder='[{"id":"step_a","name":"A","type":"tool","tool":"bash","arguments":{"command":"echo then"}}]'
          rows={7}
          error={errors.thenJson}
          onChange={(value) => onChange('thenJson', value)}
        />

        <JsonField
          id="step-else"
          label="Else Branch Steps (JSON array)"
          value={formData.elseJson}
          placeholder='[{"id":"step_b","name":"B","type":"tool","tool":"bash","arguments":{"command":"echo else"}}]'
          rows={7}
          error={errors.elseJson}
          onChange={(value) => onChange('elseJson', value)}
        />
      </div>
    </BehaviorShell>
  );
}

function CompositeStepEditor({
  formData,
  errors,
  onChange,
}: {
  formData: StepFormData;
  errors: Record<string, string>;
  onChange: StepBehaviorEditorsProps['onChange'];
}) {
  const titleByType: Record<'parallel' | 'loop' | 'subworkflow', string> = {
    parallel: 'Parallel Step',
    loop: 'Loop Step',
    subworkflow: 'Subworkflow Step',
  };

  const descriptionByType: Record<'parallel' | 'loop' | 'subworkflow', string> = {
    parallel: 'Provide child steps that can execute concurrently.',
    loop: 'Provide child steps that run repeatedly under loop control.',
    subworkflow: 'Provide child steps that represent the called subworkflow body.',
  };

  const type = formData.type as 'parallel' | 'loop' | 'subworkflow';

  return (
    <BehaviorShell title={titleByType[type]} description={descriptionByType[type]} tone="neutral">
      <JsonField
        id="step-steps"
        label="Nested Steps (JSON array)"
        value={formData.stepsJson}
        placeholder='[{"id":"nested_1","name":"Nested Step","type":"tool","tool":"bash","arguments":{"command":"echo nested"}}]'
        rows={10}
        error={errors.stepsJson}
        onChange={(value) => onChange('stepsJson', value)}
      />
    </BehaviorShell>
  );
}

function ApprovalStepEditor({
  formData,
  onChange,
}: {
  formData: StepFormData;
  onChange: StepBehaviorEditorsProps['onChange'];
}) {
  return (
    <BehaviorShell
      title="Approval Step"
      description="Add a human checkpoint message that explains what is being approved."
      tone="amber"
    >
      <TextField
        id="step-goal"
        label="Approval Prompt"
        value={formData.goal}
        placeholder="Describe what the reviewer should verify before approving."
        rows={3}
        onChange={(value) => onChange('goal', value)}
      />
    </BehaviorShell>
  );
}

function BehaviorShell({
  title,
  description,
  tone,
  children,
}: {
  title: string;
  description: string;
  tone: 'cyan' | 'amber' | 'neutral';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border p-3.5',
        tone === 'cyan' && 'border-cyan-200 bg-cyan-50/60 dark:border-cyan-900/40 dark:bg-cyan-950/10',
        tone === 'amber' && 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/10',
        tone === 'neutral' && 'border-neutral-200 bg-neutral-50/80 dark:border-neutral-700 dark:bg-neutral-900/70',
      )}
    >
      <div>
        <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h4>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
      </div>
      {children}
    </div>
  );
}

function JsonField({
  id,
  label,
  value,
  placeholder,
  rows,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  rows: number;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(jsonAreaClassName, error && 'border-red-500')}
      />
      <FieldError message={error} />
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  rows,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  rows: number;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(textAreaClassName, error && 'border-red-500')}
      />
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-red-600 dark:text-red-400">{message}</p>;
}
