// In-memory demo state: recent audit events, findings, and the last scorecard.
// Every mutation also publishes an SSE event so the console updates live.
import { config } from '../config.js';
import type {
  AuditEvent,
  Finding,
  GuardrailEvent,
  Scorecard,
  UsageSnapshot,
  UserUsage,
} from '../types.js';
import { publish } from './bus.js';

const audits: AuditEvent[] = [];
const findings: Finding[] = [];
let lastScore: Scorecard | undefined;

// ——— runtime usage state ———
const usage = new Map<string, UserUsage>();
const guardrailEvents: GuardrailEvent[] = [];

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}`;
}

export function recordAudit(ev: AuditEvent): void {
  audits.push(ev);
  if (audits.length > config.maxAudits) audits.splice(0, audits.length - config.maxAudits);
  publish('audit', ev);
  for (const f of ev.findings) recordFinding(f, false);
}

export function recordFinding(f: Finding, emit = true): void {
  findings.push(f);
  if (findings.length > config.maxAudits) findings.splice(0, findings.length - config.maxAudits);
  if (emit) publish('finding', f);
}

export function setScore(sc: Scorecard): void {
  lastScore = sc;
  publish('score', sc);
}

export function snapshot(): {
  target: string;
  audits: AuditEvent[];
  findings: Finding[];
  lastScore?: Scorecard;
} {
  return {
    target: config.targetLabel,
    // newest first for the stream
    audits: [...audits].reverse(),
    findings: [...findings].reverse(),
    lastScore,
  };
}

// ——— runtime usage ———

export function recordUsage(
  user: string,
  tokensIn: number,
  tokensOut: number,
  guardrailHits: number,
): void {
  const u = usage.get(user) ?? {
    user,
    requests: 0,
    tokensIn: 0,
    tokensOut: 0,
    guardrailHits: 0,
    lastActive: 0,
  };
  u.requests += 1;
  u.tokensIn += tokensIn;
  u.tokensOut += tokensOut;
  u.guardrailHits += guardrailHits;
  u.lastActive = Date.now();
  usage.set(user, u);
  publish('usage', usageSnapshot());
}

export function recordGuardrail(ev: GuardrailEvent): void {
  guardrailEvents.push(ev);
  if (guardrailEvents.length > config.maxAudits) {
    guardrailEvents.splice(0, guardrailEvents.length - config.maxAudits);
  }
  publish('guardrail', ev);
}

export function usageSnapshot(): UsageSnapshot {
  const users = [...usage.values()].sort(
    (a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut),
  );
  const totals = users.reduce(
    (acc, u) => {
      acc.requests += u.requests;
      acc.tokensIn += u.tokensIn;
      acc.tokensOut += u.tokensOut;
      acc.guardrailHits += u.guardrailHits;
      return acc;
    },
    { users: users.length, requests: 0, tokensIn: 0, tokensOut: 0, guardrailHits: 0 },
  );
  return { users, totals, guardrailEvents: [...guardrailEvents].reverse() };
}

export function reset(): void {
  audits.length = 0;
  findings.length = 0;
  lastScore = undefined;
  usage.clear();
  guardrailEvents.length = 0;
}
