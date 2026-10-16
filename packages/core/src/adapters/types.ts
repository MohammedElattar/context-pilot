export type Capability =
  | 'compression'
  | 'recovery'
  | 'proxy'
  | 'hook-observer'
  | 'hook-modifier'
  | 'mcp-tools'
  | 'analytics'
  | 'memory'
  | 'code-navigation';

export interface ConflictDeclaration {
  withTool: string;
  layer: string;
  severity: 'high' | 'medium' | 'low';
  reason: string;
}

export type AdapterStatus = 'installed' | 'detected' | 'not-found' | 'error';

export interface HealthResult {
  healthy: boolean;
  message: string;
}

export interface OptimizerAdapter {
  id: string;
  name: string;
  version: string | null;
  detect(): Promise<AdapterStatus>;
  capabilities: Capability[];
  conflicts: ConflictDeclaration[];
  healthCheck(): Promise<HealthResult>;
}
