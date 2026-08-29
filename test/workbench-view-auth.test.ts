import { describe, expect, it } from 'vitest';

import { renderWorkbench } from '../src/views/workbench-view.js';

describe('authenticated workbench shell', () => {
  it('shows stable Chinese labels for all human workflow statuses and stages', () => {
    const html = renderWorkbench();
    expect(html).toContain("'countersign':'待会签'");
    expect(html).toContain("'revision':'复核修改'");
    expect(html).toContain("'countersign':'会签 · 部门主任'");
  });

  it('renders both display name and username in the account control', () => {
    const html = renderWorkbench();
    expect(html).toContain("user.displayName + ' · @' + user.username");
    expect(html.match(/class="role-btn"[^>]* hidden/g)).toHaveLength(3);
    expect(html).toContain('id="new-btn" hidden');
  });

  it('renders a read-only landing instead of the create form for non-editors', () => {
    const html = renderWorkbench();
    expect(html).toContain(
      'host.innerHTML = canCreate ? newForm() : (state.role ? reviewerLanding() : readOnlyLanding())',
    );
    expect(html).toContain('当前账号可查看稿件、追溯与分析，但不能新建、改稿或推进流程。');
    expect(html).toContain('系统会在轮到当前职责时显示复审、会签、终审或签发动作');
  });
});
