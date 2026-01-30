export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ToolCallData {
  toolName: string;
  status: ToolCallStatus;
  args: unknown;
  result: unknown;
}

/** Parsed args for specific tools */

export interface ReadArgs {
  file_path?: string;
  filePath?: string;
  offset?: number;
  limit?: number;
}

export interface EditArgs {
  file_path?: string;
  filePath?: string;
  old_string?: string;
  oldString?: string;
  new_string?: string;
  newString?: string;
  replace_all?: boolean;
  replaceAll?: boolean;
}

export interface WriteArgs {
  file_path?: string;
  filePath?: string;
  content?: string;
}

export interface BashArgs {
  command?: string;
  description?: string;
  timeout?: number;
}

export interface GlobArgs {
  pattern?: string;
  path?: string;
}

export interface GrepArgs {
  pattern?: string;
  path?: string;
  include?: string;
  glob?: string;
}

export interface TodoWriteArgs {
  todos?: Array<{
    id?: string;
    content?: string;
    status?: string;
    priority?: string;
  }>;
}

export interface ListArgs {
  path?: string;
}
