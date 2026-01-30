import type { ToolCallData } from './types';
import { ReadCard } from './read-card';
import { EditCard } from './edit-card';
import { WriteCard } from './write-card';
import { BashCard } from './bash-card';
import { GlobCard } from './glob-card';
import { GrepCard } from './grep-card';
import { TodoWriteCard, TodoReadCard } from './todo-card';
import { ListCard } from './list-card';
import { GenericCard } from './generic-card';

export type { ToolCallData, ToolCallStatus } from './types';

/** Route a tool call to its specialized card component */
export function ToolCard({ tool }: { tool: ToolCallData }) {
  const name = tool.toolName.toLowerCase();

  // Exact matches
  switch (name) {
    case 'read':
    case 'file_read':
    case 'read_file':
      return <ReadCard tool={tool} />;

    case 'edit':
    case 'file_edit':
    case 'edit_file':
      return <EditCard tool={tool} />;

    case 'write':
    case 'file_write':
    case 'write_file':
    case 'create_file':
      return <WriteCard tool={tool} />;

    case 'bash':
    case 'shell':
    case 'execute':
    case 'run':
      return <BashCard tool={tool} />;

    case 'glob':
    case 'find_files':
    case 'file_search':
      return <GlobCard tool={tool} />;

    case 'grep':
    case 'search':
    case 'ripgrep':
    case 'content_search':
      return <GrepCard tool={tool} />;

    case 'todowrite':
    case 'todo_write':
    case 'write_todos':
      return <TodoWriteCard tool={tool} />;

    case 'todoread':
    case 'todo_read':
    case 'read_todos':
    case 'list_todos':
      return <TodoReadCard tool={tool} />;

    case 'ls':
    case 'list':
    case 'list_dir':
    case 'list_directory':
      return <ListCard tool={tool} />;
  }

  // Fuzzy matches for tools with prefixes like "mcp__ide__" or "namespace.tool"
  const baseName = name.split('__').pop()?.split('.').pop() ?? name;

  switch (baseName) {
    case 'read':
    case 'readfile':
      return <ReadCard tool={tool} />;
    case 'edit':
    case 'editfile':
      return <EditCard tool={tool} />;
    case 'write':
    case 'writefile':
    case 'createfile':
      return <WriteCard tool={tool} />;
    case 'bash':
    case 'shell':
    case 'execute':
    case 'executecode':
      return <BashCard tool={tool} />;
    case 'glob':
    case 'find':
      return <GlobCard tool={tool} />;
    case 'grep':
    case 'search':
      return <GrepCard tool={tool} />;
    case 'todowrite':
      return <TodoWriteCard tool={tool} />;
    case 'todoread':
      return <TodoReadCard tool={tool} />;
    case 'ls':
    case 'list':
      return <ListCard tool={tool} />;
  }

  return <GenericCard tool={tool} />;
}
