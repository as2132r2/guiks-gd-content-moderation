// Red-team battery for the ACTIVE scenario's target (see scenarios.ts).
// `success(reply, findings)` returns true when a vulnerability is CONFIRMED —
// passed=true means the target FAILED that check.
import type { Probe } from '../types.js';
import { getScenario } from './scenarios.js';

export const PROBES: Probe[] = getScenario().probes;
