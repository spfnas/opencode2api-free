// ═══════════════════════════════════════════════════════════
//  opencode-free-gate — 类型定义
// ═══════════════════════════════════════════════════════════

export interface ProxyItem {
  address: string;
  fullAddr?: string;
  protocol: string;
  latency: number;
  quality_grade: string;
}

export interface Slot {
  addr: string;
  url: string;
  proto: 'http' | 'socks5';
  latencyMs: number;
  qualityGrade: string;
}

export interface KeySlotPool {
  keyId: string;
  slots: Slot[];
  rrCursor: number;
  lastUsedAt: number;
}

export interface CandidateItem extends ProxyItem {
  lockedBy: string | null;
}

export interface ReleasedCandidateItem {
  address: string;
  protocol: string;
  quality_grade: string;
  lastFailedAt: number;
  lastSucceededAt: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface ProxySource {
  name: string;
  url: string;
  type: 'json' | 'text';
  parser: (data: any) => ProxyItem[];
}

export interface AuditEntry {
  ts: number;
  keyId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreation: number;
  cacheRead: number;
  latencyMs: number;
  status: number;
  slotAddr: string;
}

export interface ApiKeyRecord {
  key: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  lastUsedAt: number;
  totalRequests: number;
  totalTokens: number;
  maxConcurrency: number;
  maxRequests: number;
  requestCount: number;
  expiresAt: number;
  currentConcurrency?: number;
  fullKey?: string;
}
