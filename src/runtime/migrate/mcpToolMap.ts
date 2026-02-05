export interface McpMigrationEntry {
  mcpTool: string;
  cliCommand: string;
  notes?: string;
}

export function getMcpToolMigrationMap(): McpMigrationEntry[] {
  return [
    { mcpTool: 'local_context', cliCommand: 'context', notes: 'Primary workflow command' },
    { mcpTool: 'local_project_hints', cliCommand: 'hints' },
    { mcpTool: 'local_file_summary', cliCommand: 'summary <file>' },
    { mcpTool: 'frontend_insights', cliCommand: 'frontend' },
    { mcpTool: 'local_debug_context', cliCommand: 'debug "<log text>"' },
    { mcpTool: 'ast_grep_search', cliCommand: 'grep "<pattern>"' },
    { mcpTool: 'manage_embeddings', cliCommand: 'embeddings <action>' },
    {
      mcpTool: 'context pack tools',
      cliCommand: 'packs <create|list|get|delete|template|ui>',
      notes: 'Context pack workflows (local presets for context generation)',
    },
    {
      mcpTool: 'AI tools',
      cliCommand: 'compare (or future ai subcommands)',
      notes: 'Key-gated behavior',
    },
  ];
}
