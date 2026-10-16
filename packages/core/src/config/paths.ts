import { homedir } from 'node:os';
import { join } from 'node:path';

const home = homedir();

export const paths = {
  home,
  claude: {
    dir: join(home, '.claude'),
    settings: join(home, '.claude', 'settings.json'),
    json: join(home, '.claude.json'),
    pluginsInstalled: join(home, '.claude', 'plugins', 'installed_plugins.json'),
    cavemanActive: join(home, '.claude', '.caveman-active'),
    cavemanHistory: join(home, '.claude', '.caveman-history.jsonl'),
    cavemanModeLog: join(home, '.claude', '.caveman-mode-log.jsonl'),
    cavemanSessions: join(home, '.claude', '.caveman-sessions'),
  },
  caveman: {
    dir: join(home, '.caveman'),
    cloud: join(home, '.caveman', 'cloud.json'),
    db: join(home, '.caveman', 'caveman.db'),
    ccrDb: join(home, '.caveman', 'ccr.db'),
    proxyLog: join(home, '.caveman', 'proxy.log'),
    bin: join(home, '.caveman', 'bin'),
    run: join(home, '.caveman', 'run'),
    runJson: (port: number) => join(home, '.caveman', 'run', `${port}.json`),
    integrations: join(home, '.caveman', 'integrations'),
    claudeIntegration: join(home, '.caveman', 'integrations', 'claude.json'),
  },
  contextPilot: {
    dir: join(home, '.context-pilot'),
    db: join(home, '.context-pilot', 'telemetry.db'),
    config: join(home, '.context-pilot', 'config.json'),
  },
} as const;
