/**
 * 广电稿件生成的确定性 mock。
 *
 * 无需 API Key 即可跑通整条主链，彩排时不靠网络。它刻意在产物里埋四处东西，
 * 好让输出预检那一屏有东西可演 (方案 §十 的 1:20 镜头):
 *
 *   1. 一处禁用词 —— 一般性会议写成「隆重召开」
 *   2. 一处与原通稿不符的数字 —— 幻觉最典型的样子
 *   3. 不带 AI 生成内容标识 —— 由预检自动补
 *
 * 接真实模型时（设 UPSTREAM_URL）本文件自动让位，一行都不用改。
 */
import type { ChatMessage } from '../lib/upstream.js';

export const BROADCAST_TASK = {
  script: '【任务：播报稿】',
  shortVideo: '【任务：短视频文案】',
} as const;

export const SOURCE_MARKER = '【原通稿】';

/** Units worth checking against the 通稿 — the ones a 幻觉 actually damages. */
const QUANTITY = /(\d+(?:\.\d+)?)\s*(亿元|万元|亿|万|元|人次|人|公里|千米|吨|平方米|家|户)/;

const trimTo = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);

function firstSentence(text: string): string {
  const match = text.split(/[。！？\n]/).map((part) => part.trim()).find(Boolean);
  return match ?? text.trim();
}

/**
 * Take the first quantity in the 通稿 and get it slightly wrong.
 *
 * Deterministic on purpose: the same 通稿 always produces the same wrong
 * number, so the 预检 demo lands the same way every rehearsal.
 */
function misquoteQuantity(sourceText: string): { original: string; altered: string } | null {
  const match = QUANTITY.exec(sourceText);
  if (!match) return null;

  const [full, rawValue, unit] = match;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;

  const decimals = rawValue!.includes('.') ? rawValue!.split('.')[1]!.length : 0;
  const altered =
    decimals > 0
      ? (value + 0.4).toFixed(decimals)
      : String(value + Math.max(1, Math.round(value * 0.15)));

  return { original: full, altered: `${altered}${unit}` };
}

function extractSource(text: string): string {
  const at = text.indexOf(SOURCE_MARKER);
  return at === -1 ? text.trim() : text.slice(at + SOURCE_MARKER.length).trim();
}

/**
 * 生成稿里多一位原通稿没有的领导 —— 模型最常见的一种编造。
 *
 * 原通稿里真有的那一位**照抄**（比对时不该报），后面再挂一位**虚构的**（该报）。
 * 一真一假摆在同一句里，1:20 那一镜才说得清：系统比的是「原稿里有没有」，
 * 不是「有没有人名」。
 */
const INVENTED_LEADER = '副市长李国强';

/** 从原通稿里取第一位领导。写法与 src/rules 的实体提取保持一致。 */
const SOURCE_LEADER_PATTERN =
  /(?:省委书记|市委书记|县委书记|党组书记|党委书记|副省长|副市长|副县长|省长|市长|县长|局长)[一-鿿]{2,3}/;

function attendeeLine(sourceText: string): string {
  const real = sourceText.match(SOURCE_LEADER_PATTERN)?.[0];
  const attendees = real ? `${real}、${INVENTED_LEADER}` : INVENTED_LEADER;
  return `会议在市融媒体中心隆重召开，${attendees}亲自出席并讲话。`;
}

function broadcastScript(sourceText: string): string {
  const lead = firstSentence(sourceText);
  const misquote = misquoteQuantity(sourceText);
  const lines = [
    `各位听众，${trimTo(lead, 60)}。`,
    attendeeLine(sourceText),
    misquote
      ? `据介绍，该项目总投资 ${misquote.altered}，建成后将惠及全市群众。`
      : '据介绍，该项目预计带动就业 1200 人，建成后将惠及全市群众。',
    '下一步，相关部门将按照会议部署抓好落实，确保各项任务落地见效。',
  ];
  return lines.join('\n');
}

function shortVideoCopy(sourceText: string): string {
  const lead = firstSentence(sourceText);
  const misquote = misquoteQuantity(sourceText);
  const lines = [
    `${trimTo(lead, 28)}！`,
    misquote ? `总投资 ${misquote.altered}，这件事和你有关。` : '这件事和你有关。',
    '现场直击，一起来看。',
  ];
  return lines.join('\n');
}

/**
 * Answer a broadcast-production prompt, or return null so the caller falls
 * back to the active AuditGate scenario mock.
 */
export function broadcastMockReply(messages: readonly ChatMessage[]): string | null {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  if (lastUser.includes(BROADCAST_TASK.script)) return broadcastScript(extractSource(lastUser));
  if (lastUser.includes(BROADCAST_TASK.shortVideo)) return shortVideoCopy(extractSource(lastUser));
  return null;
}
