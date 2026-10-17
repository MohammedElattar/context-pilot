import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { paths } from '@contextpilot/core';

export async function runRecover(handle: string, opts: { json?: boolean }) {
  const normalized = handle.replace(/^<<ccr:/, '').replace(/>>$/, '').replace(/^ccr:/, '');

  if (!normalized.startsWith('ccr_')) {
    console.error(chalk.red('Invalid handle. Expected format: ccr_<hash>'));
    process.exitCode = 1;
    return;
  }

  const cavemanMcpBin = `${paths.caveman.bin}/caveman-mcp`;
  if (!existsSync(cavemanMcpBin)) {
    console.error(chalk.red('Caveman MCP binary not found at ' + cavemanMcpBin));
    console.error(chalk.dim('Install Caveman first: https://caveman.so'));
    process.exitCode = 1;
    return;
  }

  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'caveman_retrieve',
      arguments: { recovery_handle: normalized },
    },
  };

  try {
    const result = await callMcpTool(cavemanMcpBin, request);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.error) {
      console.error(chalk.red(`Recovery failed: ${result.error.message || JSON.stringify(result.error)}`));
      process.exitCode = 1;
      return;
    }

    const content = result.result?.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'text') {
          process.stdout.write(item.text);
        }
      }
      process.stdout.write('\n');
    } else {
      console.log(JSON.stringify(result.result, null, 2));
    }
  } catch (err) {
    console.error(chalk.red(`MCP call failed: ${err instanceof Error ? err.message : err}`));
    process.exitCode = 1;
  }
}

function callMcpTool(bin: string, request: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 0 && msg.result) {
            // Got initialize response, send initialized notification then the tool call
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            child.stdin.write(JSON.stringify(request) + '\n');
          } else if (msg.id === 1) {
            resolve(msg);
            child.kill();
          }
        } catch { /* skip non-JSON lines */ }
      }
    });

    child.stderr.on('data', () => { /* ignore */ });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`MCP process exited with code ${code}`));
      }
    });

    const init = JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'contextpilot', version: '0.1.0' },
      },
    });

    child.stdin.write(init + '\n');

    setTimeout(() => {
      child.kill();
      reject(new Error('MCP call timed out after 10s'));
    }, 10000);
  });
}
