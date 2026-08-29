/**
 * 生产层: 通稿 → 播报稿 + 短视频文案。
 *
 * 硬约束: 模型只能经网关出去。This module calls `throughGateway()` and never
 * touches a provider URL or key — that is what makes 审计零遗漏 and what gives
 * 入口准入 its teeth (绕不过网关就绕不过准入).
 */
import { throughGateway } from '../routes/gateway.js';
import type { ArtifactKind } from '../domain/contracts.js';
import type { ChatMessage } from '../lib/upstream.js';
import { BROADCAST_TASK, SOURCE_MARKER } from './broadcast-mock.js';

const SYSTEM_PROMPT = [
  '你是融媒体中心的稿件助手，按本台风格把上级通稿改写成可播出的稿件。',
  '要求：口语化、句子短、信息不增不减，不要编造原通稿里没有的人名、职务、地名、数字和日期。',
].join('\n');

export interface GeneratedArtifact {
  kind: Extract<ArtifactKind, 'broadcast-script' | 'short-video-copy'>;
  label: string;
  content: string;
  model: string;
}

interface GenerationTask {
  kind: GeneratedArtifact['kind'];
  label: string;
  marker: string;
  instruction: string;
}

const TASKS: readonly GenerationTask[] = [
  {
    kind: 'broadcast-script',
    label: '播报稿',
    marker: BROADCAST_TASK.script,
    instruction: '改写成 150 字左右的广播播报稿，开头一句导语，结尾一句落实表述。',
  },
  {
    kind: 'short-video-copy',
    label: '短视频文案',
    marker: BROADCAST_TASK.shortVideo,
    instruction: '改写成 60 字以内的短视频文案，三行以内，第一行是钩子。',
  },
];

function buildMessages(task: GenerationTask, sourceText: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${task.marker}${task.instruction}\n${SOURCE_MARKER}\n${sourceText}`,
    },
  ];
}

/**
 * Produce both artifacts for one manuscript.
 *
 * Sequential rather than parallel: the audit stream is the demo, and two
 * interleaved gateway calls make the 留痕 timeline unreadable.
 */
export async function generateBroadcastArtifacts(input: {
  manuscriptId: string;
  title: string;
  sourceText: string;
  actor: string;
  model?: string;
  /** 配额按账号记，不按显示名——显示名可改，改了就能重置额度。 */
  userId?: string;
}): Promise<GeneratedArtifact[]> {
  const out: GeneratedArtifact[] = [];
  for (const task of TASKS) {
    const { reply, telemetry } = await throughGateway(buildMessages(task, input.sourceText), {
      target: `把关人·生产层（${input.actor}）`,
      ...(input.model ? { model: input.model } : {}),
      trace: {
        manuscriptId: input.manuscriptId,
        actor: input.actor,
        operation: task.kind,
      },
      governanceUser: input.actor,
      // 一篇稿子产两份产物，就是两次调用，各记一次——配额算的是模型调用次数，
      // 不是稿件数。第二次撞上限时第一份产物已经生成，工作台会整体回滚状态。
      ...(input.userId ? { quota: { userId: input.userId, actor: input.actor } } : {}),
    });
    out.push({
      kind: task.kind,
      label: task.label,
      content: reply.trim(),
      model: telemetry.servedModel,
    });
  }
  return out;
}
