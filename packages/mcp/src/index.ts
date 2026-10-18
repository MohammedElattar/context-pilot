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
import { handleResearchFetch } from './tools/research-fetch.js';
import { handleResearchExpand } from './tools/research-expand.js';
import { handleResearchState } from './tools/research-state.js';
import { handleResearch } from './tools/research.js';

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
    {
      name: 'contextpilot_research',
      description: 'Research a question across one or more URLs you provide (web/doc pages and GitHub issue/PR URLs or owner/repo#n) in a single call. Fetches each through the gateway, merges and ranks the evidence under one token budget with per-source provenance, long GitHub threads compacted. For open-web discovery first use native WebSearch, then pass the URLs here. Recover omitted evidence with contextpilot_expand.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'The question or error to research; ranks sections and protects exact-error matches.' },
          urls: { type: 'array', items: { type: 'string' }, description: 'URLs/refs to research: web/doc pages, GitHub issue/PR URLs, or owner/repo#number.' },
          budget_tokens: { type: 'number', description: 'Max estimated tokens of merged evidence (default 3000, max 8000).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'contextpilot_fetch',
      description: 'Fetch a URL through the local Research Gateway instead of native WebFetch when bug-hunting. Returns ranked, token-budgeted evidence (exact errors/code preserved) with stable evidence_ids, cached locally so repeat fetches cost no network and no new tokens. Use `focus` with the error text or question to keep the most relevant sections. Recover anything omitted with contextpilot_expand.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'The URL to fetch (http/https only).' },
          focus: { type: 'string', description: 'Error text or question to rank sections by; essential error matches are never dropped.' },
          budget_tokens: { type: 'number', description: 'Max estimated tokens of evidence to return (default 2000, max 8000).' },
        },
        required: ['url'],
      },
    },
    {
      name: 'contextpilot_expand',
      description: 'Recover fuller or omitted research evidence by its stable evidence_id from the local cache — no network request. mode "section" returns the full section; mode "full" returns the entire original page body.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          evidence_id: { type: 'string', description: 'The evidence_id returned by contextpilot_fetch.' },
          mode: { type: 'string', enum: ['section', 'full'], description: 'section (default) or full.' },
        },
        required: ['evidence_id'],
      },
    },
    {
      name: 'contextpilot_research_state',
      description: 'Summarize this session\'s research gateway usage: routed gateway calls vs native WebFetch/WebSearch (routing adoption), cache hit-rate, and estimated tokens saved. Read-only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID (defaults to most recent).' },
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
      case 'contextpilot_research':
        result = await handleResearch(args as any ?? {});
        break;
      case 'contextpilot_fetch':
        result = await handleResearchFetch(args as any ?? {});
        break;
      case 'contextpilot_expand':
        result = await handleResearchExpand(args as any ?? {});
        break;
      case 'contextpilot_research_state':
        result = await handleResearchState(args as any ?? {});
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
