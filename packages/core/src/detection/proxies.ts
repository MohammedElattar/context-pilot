import { readFile, access } from 'node:fs/promises';
import { paths } from '../config/paths.js';
import { CavemanRunSchema, type CavemanRun } from '../schema/caveman.js';

export interface ProxyInfo {
  detected: boolean;
  url: string | null;
  owner: 'caveman' | 'unknown';
  pid: number | null;
  port: number | null;
  mode: string | null;
  version: string | null;
  running: boolean;
  upstreams: Record<string, string>;
}

export async function detectProxy(): Promise<ProxyInfo> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? null;
  const cavemanRun = await readCavemanRuntime();

  if (!baseUrl && !cavemanRun) {
    return {
      detected: false,
      url: null,
      owner: 'unknown',
      pid: null,
      port: null,
      mode: null,
      version: null,
      running: false,
      upstreams: {},
    };
  }

  const isCaveman = baseUrl?.includes('127.0.0.1:8787') || cavemanRun !== null;
  const running = cavemanRun ? await isProcessRunning(cavemanRun.pid) : false;

  return {
    detected: true,
    url: baseUrl,
    owner: isCaveman ? 'caveman' : 'unknown',
    pid: cavemanRun?.pid ?? null,
    port: cavemanRun?.port ?? null,
    mode: cavemanRun?.mode ?? null,
    version: cavemanRun?.version ?? null,
    running,
    upstreams: cavemanRun?.provider_upstreams ?? {},
  };
}

async function readCavemanRuntime(): Promise<CavemanRun | null> {
  try {
    const runPath = paths.caveman.runJson(8787);
    await access(runPath);
    const raw = await readFile(runPath, 'utf-8');
    return CavemanRunSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
