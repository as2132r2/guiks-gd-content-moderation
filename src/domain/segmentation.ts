/**
 * 句级来源标记的两件事: 把稿子切成句子, 和在人改稿之后判定每一句的来源。
 *
 * The provenance verdict lives here — on the server — and never comes from the
 * client. AI 参与度 is the number a 台领导 uses to spot 走过场的审核
 * (business-process.md §四); if the person being measured could label their own
 * sentences 「我改过」, the number would measure nothing.
 */
import type { CreateSegmentInput, SentenceOrigin } from './contracts.js';

/** Sentence terminators kept with the sentence they close. */
const TERMINATORS = /[。！？!?；;]/;

/**
 * Split Chinese prose into sentences.
 *
 * Newlines break a sentence too: a 通稿 is full of headings and one-line
 * paragraphs that never carry a full stop.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buffer = '';

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) out.push(trimmed);
    buffer = '';
  };

  for (const char of text) {
    if (char === '\n' || char === '\r') {
      flush();
      continue;
    }
    buffer += char;
    if (TERMINATORS.test(char)) {
      // Keep a run of closing quotes/brackets with the sentence they end.
      flush();
    }
  }
  flush();
  return out;
}

const normalize = (text: string) => text.replace(/\s+/g, '').trim();

/** Character bigrams; falls back to single characters for very short input. */
function bigrams(text: string): string[] {
  const chars = [...normalize(text)];
  if (chars.length < 2) return chars;
  const grams: string[] = [];
  for (let i = 0; i < chars.length - 1; i += 1) grams.push(chars[i]! + chars[i + 1]!);
  return grams;
}

/**
 * Dice coefficient over character bigrams, 0..1.
 *
 * Used only to answer one question: is this sentence a rewrite of that one, or
 * a brand new sentence? A cheap deterministic measure is the right tool — this
 * runs on every keystroke-save and must never call a model.
 */
export function similarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const pool = new Map<string, number>();
  for (const gram of left) pool.set(gram, (pool.get(gram) ?? 0) + 1);

  let shared = 0;
  for (const gram of right) {
    const available = pool.get(gram) ?? 0;
    if (available > 0) {
      shared += 1;
      pool.set(gram, available - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/** Above this, a sentence counts as a rewrite of the old one rather than a new one. */
export const REWRITE_THRESHOLD = 0.5;

/** An AI sentence that a human touched is no longer wholly the model's. */
function degrade(previous: SentenceOrigin): SentenceOrigin {
  return previous === 'ai' ? 'ai-edited' : previous;
}

export interface PriorSegment {
  text: string;
  origin: SentenceOrigin;
  sourceRef?: string;
}

/**
 * Decide the provenance of every sentence in a revised artifact.
 *
 * | 情况 | 判定 |
 * | --- | --- |
 * | 与旧句文本完全一致 | 保留原 origin |
 * | 改写自某句 AI 生成 | `ai-edited` |
 * | 改写自人写的句子 | 保持原 origin |
 * | 新句，且在原通稿里能整句找到 | `source` |
 * | 新句，其余 | `human` |
 */
export function deriveSegmentOrigins(
  previous: readonly PriorSegment[],
  sentences: readonly string[],
  sourceText = '',
): CreateSegmentInput[] {
  const unclaimed = previous.map((segment, index) => ({ segment, index, taken: false }));
  const byText = new Map<string, number[]>();
  for (const entry of unclaimed) {
    const key = normalize(entry.segment.text);
    const bucket = byText.get(key);
    if (bucket) bucket.push(entry.index);
    else byText.set(key, [entry.index]);
  }

  const resolved: Array<CreateSegmentInput | null> = sentences.map(() => null);

  // Pass 1 — untouched sentences keep exactly what they were.
  sentences.forEach((text, position) => {
    const bucket = byText.get(normalize(text));
    const match = bucket?.find((index) => !unclaimed[index]!.taken);
    if (match === undefined) return;
    unclaimed[match]!.taken = true;
    const prior = unclaimed[match]!.segment;
    resolved[position] = {
      text,
      origin: prior.origin,
      ...(prior.sourceRef ? { sourceRef: prior.sourceRef } : {}),
    };
  });

  // Pass 2 — whatever is left is either a rewrite of a leftover sentence or new.
  const leftovers = unclaimed.filter((entry) => !entry.taken);
  const normalizedSource = normalize(sourceText);

  sentences.forEach((text, position) => {
    if (resolved[position]) return;

    let best: (typeof leftovers)[number] | undefined;
    let bestScore = REWRITE_THRESHOLD;
    for (const candidate of leftovers) {
      if (candidate.taken) continue;
      const score = similarity(candidate.segment.text, text);
      if (score >= bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (best) {
      best.taken = true;
      const prior = best.segment;
      resolved[position] = {
        text,
        origin: degrade(prior.origin),
        ...(prior.sourceRef ? { sourceRef: prior.sourceRef } : {}),
      };
      return;
    }

    const quoted = normalizedSource.length > 0 && normalizedSource.includes(normalize(text));
    resolved[position] = quoted
      ? { text, origin: 'source', sourceRef: '原通稿' }
      : { text, origin: 'human' };
  });

  return resolved.map((segment, position) => segment ?? { text: sentences[position]!, origin: 'human' });
}
