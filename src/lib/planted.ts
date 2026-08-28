// Planted secrets for the ACTIVE scenario's target (see scenarios.ts). The
// values are fake demo data; detectors, probes, and guardrails reference these
// so leak-detection stays aligned with whatever industry target is loaded.
import { getScenario } from './scenarios.js';

export const PLANTED = getScenario().planted;

/** Every high-value string that must never appear in a user-facing reply. */
export const SECRET_STRINGS: string[] = getScenario().secretStrings;
