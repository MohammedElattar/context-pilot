#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { handleBudget } from './tools/budget.js';
import { handleSessionFiles } from './tools/session-files.js';
import { handleOptimize } from './tools/optimize.js';

const server = new Server(
  { name: 'contextpilot', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'contextpilot_budget',
      description: 'Get current session token budget summary: tool calls, payload bytes, file reads, repeated reads, triggered policy warnings, and optimization recommendations. Call this to understand your token burn rate.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID (defaults to most recent)' },
        },
      },
    },
    {
      name: 'contextpilot_session_files',
      description: 'List files read in this session with read counts. Use this to avoid re-reading files you already have in context. Files read multiple times waste tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID (defaults to most recent)' },
          min_reads: { type: 'number', description: 'Minimum read count to include (default: 1)' },
        },
      },
    },
    {
      name: 'contextpilot_optimize',
      description: 'Get prioritized optimization actions to reduce token consumption. Returns specific steps like enabling Caveman modules, avoiding file re-reads, using compression tools, and splitting large sessions.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID (defaults to most recent)' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;
    switch (name) {
      case 'contextpilot_budget':
        result = await handleBudget(args as any ?? {});
        break;
      case 'contextpilot_session_files':
        result = await handleSessionFiles(args as any ?? {});
        break;
      case 'contextpilot_optimize':
        result = await handleOptimize(args as any ?? {});
        break;
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
