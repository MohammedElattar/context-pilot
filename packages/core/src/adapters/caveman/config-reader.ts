import { readFile, access } from 'node:fs/promises';
import { paths } from '../../config/paths.js';
import { CavemanCloudSchema, type CavemanCloud } from '../../schema/caveman.js';

export interface CavemanConfig {
  installed: boolean;
  cloud: CavemanCloud | null;
  version: string | null;
  plan: string | null;
  entitled: boolean;
  expiresAt: string | null;
  modules: Record<string, boolean>;
  telemetryTokens: { tokensIn: number; tokensSaved: number } | null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readCavemanConfig(): Promise<CavemanConfig> {
  const dirExists = await fileExists(paths.caveman.dir);
  if (!dirExists) {
    return {
      installed: false,
      cloud: null,
      version: null,
      plan: null,
      entitled: false,
      expiresAt: null,
      modules: {},
      telemetryTokens: null,
    };
  }

  let cloud: CavemanCloud | null = null;
  try {
    const raw = await readFile(paths.caveman.cloud, 'utf-8');
    cloud = CavemanCloudSchema.parse(JSON.parse(raw));
  } catch {
    // cloud.json missing or malformed
  }

  return {
    installed: true,
    cloud,
    version: cloud?.wrapEntitlement ? 'detected' : null,
    plan: cloud?.wrapEntitlement?.plan ?? null,
    entitled: cloud?.wrapEntitlement?.entitled ?? false,
    expiresAt: cloud?.wrapEntitlement?.expires_at ?? null,
    modules: cloud?.modules ?? {},
    telemetryTokens: cloud?.telemetryTokens
      ? { tokensIn: cloud.telemetryTokens.tokensIn, tokensSaved: cloud.telemetryTokens.tokensSaved }
      : null,
  };
}
