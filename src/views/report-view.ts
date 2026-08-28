// Printable one-page readiness report. Light, clean, meant to be printed to PDF
// straight from the browser (Ctrl/Cmd-P). The artifact an enterprise files.
import type { Scorecard, Severity } from '../types.js';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const SEV_LABEL: Record<Severity, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '提示',
};

export function renderReport(sc: Scorecard | undefined, target: string): string {
  const head = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>安全就绪度报告 · ${esc(target)}</title>
<style>
  :root{--ink:#16211D;--muted:#59685F;--faint:#8A978F;--line:#DCE5E0;--bg:#EFF2F0;--surface:#fff;
    --accent:#0C8F68;--accent-deep:#08624A;--accent-soft:#E1F1EA;--critical:#BE4438;--warn:#B7791F;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.6;
    font-variant-numeric:tabular-nums;}
  .page{max-width:760px;margin:0 auto;padding:40px 34px 60px}
  h1,h2{font-family:'Songti SC','Noto Serif SC',serif;margin:0}
  .eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-deep)}
  h1{font-size:1.7rem;margin:8px 0 2px}
  .meta{font-family:ui-monospace,Menlo,monospace;font-size:.8rem;color:var(--muted);margin-top:6px}
  .hero{display:flex;gap:24px;align-items:center;margin:26px 0;padding:22px;background:var(--surface);border:1px solid var(--line);border-radius:14px}
  .grade{font-family:'Songti SC',serif;font-weight:700;font-size:3.4rem;line-height:1;width:96px;height:96px;display:flex;align-items:center;justify-content:center;border-radius:16px;border:2px solid}
  .g-A,.g-B{color:var(--accent-deep);border-color:var(--accent);background:var(--accent-soft)}
  .g-C{color:var(--warn);border-color:var(--warn);background:#F7EEDD}
  .g-D,.g-F{color:var(--critical);border-color:var(--critical);background:#F7E4E1}
  .score .n{font-size:2.2rem;font-weight:700}
  .score .n small{font-size:1rem;color:var(--muted);font-weight:400}
  .score .verdict{color:var(--muted);margin-top:2px}
  h2{font-size:1.05rem;margin:26px 0 12px}
  .dims{display:flex;flex-direction:column;gap:12px}
  .dim{display:grid;grid-template-columns:130px 1fr 44px;gap:12px;align-items:center}
  .dim .lab{font-size:.9rem}
  .dim .bar{height:9px;border-radius:6px;background:#E4EAE6;overflow:hidden}
  .dim .fill{height:100%;border-radius:6px}
  .dim .val{font-family:ui-monospace,Menlo,monospace;font-size:.85rem;text-align:right}
  .dim .note{grid-column:1 / -1;font-size:.78rem;color:var(--faint);margin-top:-6px}
  .counts{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
  .chip{font-family:ui-monospace,Menlo,monospace;font-size:.76rem;border:1px solid var(--line);border-radius:999px;padding:4px 10px;background:var(--surface)}
  .chip b{font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:.84rem;margin-top:6px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-family:ui-monospace,Menlo,monospace;font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:500}
  td.id{font-family:ui-monospace,Menlo,monospace;color:var(--accent-deep);white-space:nowrap}
  .v-bad{color:var(--critical);font-weight:600}
  .v-ok{color:var(--accent-deep);font-weight:600}
  .disclaimer{margin-top:26px;padding:16px 18px;border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:10px;background:var(--surface);font-size:.82rem;color:var(--muted)}
  .foot{margin-top:22px;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:var(--faint);border-top:1px solid var(--line);padding-top:14px}
  .print-hint{position:fixed;top:14px;right:14px;font-size:.8rem;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer}
  @media print{.print-hint{display:none}@page{size:A4;margin:14mm}body{background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.hero,.disclaimer,.chip{break-inside:avoid}}
</style></head><body>
<button class="print-hint" onclick="window.print()">打印 / 存为 PDF</button>
<div class="page">`;

  if (!sc) {
    return (
      head +
      `<span class="eyebrow">薄荷监理台 · AuditGate</span>
      <h1>安全就绪度报告</h1>
      <p class="meta">目标：${esc(target)}</p>
      <div class="disclaimer">尚未运行红队体检。请先在控制台点「跑红队」，再回到本页导出报告。</div>
      </div></body></html>`
    );
  }

  const dimHtml = sc.dimensions
    .map((d) => {
      const color = d.score >= 70 ? 'var(--accent)' : d.score >= 40 ? 'var(--warn)' : 'var(--critical)';
      return `<div class="dim">
        <span class="lab">${esc(d.label)}</span>
        <span class="bar"><span class="fill" style="width:${d.score}%;background:${color}"></span></span>
        <span class="val">${d.score}</span>
        <span class="note">${esc(d.note)}</span>
      </div>`;
    })
    .join('');

  const countHtml = (Object.keys(sc.findingCounts) as Severity[])
    .filter((k) => sc.findingCounts[k] > 0)
    .map((k) => `<span class="chip">${SEV_LABEL[k]} <b>${sc.findingCounts[k]}</b></span>`)
    .join('') || '<span class="chip">无风险发现</span>';

  const rows = sc.probeResults
    .map(
      (r) => `<tr>
      <td class="id">${esc(r.probe.id)}</td>
      <td>${esc(r.probe.title)}<br><span style="color:var(--faint);font-size:.78rem">${esc(r.probe.rationale)}</span></td>
      <td>${r.passed ? '<span class="v-bad">命中 · 有洞</span>' : '<span class="v-ok">未命中 · 安全</span>'}</td>
    </tr>`,
    )
    .join('');

  return (
    head +
    `<span class="eyebrow">薄荷监理台 · AuditGate</span>
    <h1>安全就绪度报告</h1>
    <p class="meta">目标：${esc(sc.target)} ｜ 生成时间：${fmtDate(sc.ts)} ｜ 签发：薄荷科技</p>

    <div class="hero">
      <div class="grade g-${sc.grade}">${sc.grade}</div>
      <div class="score">
        <div class="n">${sc.overall}<small> / 100</small></div>
        <div class="verdict">${sc.grade === 'A' || sc.grade === 'B' ? '基本具备上线条件，仍建议持续监理。' : sc.grade === 'C' ? '存在明显缺口，修复后方可上线。' : '安全缺口严重，当前不具备上线条件。'}</div>
        <div class="counts">${countHtml}</div>
      </div>
    </div>

    <h2>五维评分</h2>
    <div class="dims">${dimHtml}</div>

    <h2>红队探针结果</h2>
    <table>
      <thead><tr><th>ID</th><th>探针</th><th>结论</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="disclaimer">
      本报告由薄荷监理台在<b>受控演示环境</b>下对自有靶子生成，用于展示监理能力。正式体检仅针对<b>已授权 / 同意接入</b>的目标进行；红队以“帮助方案达到上线标准”为目的，结论附修复方向。
    </div>
    <div class="foot">薄荷科技 · 安全监理 · 你的 AI 供应商，谁能上线，由这台说了算。</div>
    </div></body></html>`
  );
}
