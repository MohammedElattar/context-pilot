import { platform, release, arch, type } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { paths } from '../config/paths.js';
import { ClaudeSettingsSchema, type ClaudeSettings } from '../schema/config.js';

const execFileAsync = promisify(execFile);

export interface EnvironmentInfo {
  os: {
    platform: string;
    release: string;
    arch: string;
    type: string;
  };
  shell: string | null;
  node: {
    version: string;
    path: string;
  };
  claudeCode: {
    installed: boolean;
    version: string | null;
    settingsPath: string;
    settingsExists: boolean;
    model: string | null;
    anthropicBaseUrl: string | null;
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getClaudeVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], {
      timeout: 5000,
    });
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : stdout.trim();
  } catch {
    return null;
  }
}

async function loadClaudeSettings(): Promise<ClaudeSettings | null> {
  try {
    const raw = await readFile(paths.claude.settings, 'utf-8');
    const parsed = JSON.parse(raw);
    return ClaudeSettingsSchema.parse(parsed);
  } catch {
    return null;
  }
}

export async function detectEnvironment(): Promise<EnvironmentInfo> {
  const settingsExists = await fileExists(paths.claude.settings);
  const settings = settingsExists ? await loadClaudeSettings() : null;
  const claudeVersion = await getClaudeVersion();

  return {
    os: {
      platform: platform(),
      release: release(),
      arch: arch(),
      type: type(),
    },
    shell: process.env.SHELL ?? null,
    node: {
      version: process.version,
      path: process.execPath,
    },
    claudeCode: {
      installed: claudeVersion !== null,
      version: claudeVersion,
      settingsPath: paths.claude.settings,
      settingsExists,
      model: settings?.model ?? null,
      anthropicBaseUrl: settings?.env?.ANTHROPIC_BASE_URL ?? null,
    },
  };
}

export { loadClaudeSettings };
