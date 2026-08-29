import { describe, expect, it } from 'vitest';

import { renderWorkbench } from '../src/views/workbench-view.js';

describe('authenticated workbench shell', () => {
  it('shows stable Chinese labels for all human workflow statuses and stages', () => {
    const html = renderWorkbench({ demoToolsEnabled: true });
    expect(html).toContain("'countersign':'待会签'");
    expect(html).toContain("'revision':'复核修改'");
    expect(html).toContain("'countersign':'会签 · 部门主任'");
  });

  it('renders both display name and username in the account control', () => {
    const html = renderWorkbench({ demoToolsEnabled: true });
    expect(html).toContain("user.displayName + ' · @' + user.username");
    expect(html.match(/class="role-btn"[^>]* hidden/g)).toHaveLength(3);
    expect(html).toContain('id="new-btn" hidden');
  });

  it('keeps the demo fixture controls in a demo build', () => {
    const html = renderWorkbench({ demoToolsEnabled: true });
    expect(html).toContain('id="present-open"');
    expect(html).toContain('id="seed-btn"');
    expect(html).toContain('var DEMO_TOOLS = true;');
  });

  it('drops them in a production build, instead of rendering a button that 404s', () => {
    // 这两个控件都以「清空整库」开头。渲染出来再靠后端 404 挡，等于在生产
    // 工作台上摆一个点了就报错的按钮；`?present=1` 也不能绕过去。
    const html = renderWorkbench({ demoToolsEnabled: false });
    expect(html).not.toContain('id="present-open"');
    expect(html).not.toContain('id="present-seed"');
    expect(html).not.toContain('id="seed-btn"');
    expect(html).toContain("present:DEMO_TOOLS && query.get('present') === '1'");
    // 「填入示例通稿」不在此列——手册第 2 步就要点它。
    expect(html).toContain('id="nf-sample"');
    expect(html).toContain("api('/api/fixtures')");
  });

  it('renders a read-only landing instead of the create form for non-editors', () => {
    const html = renderWorkbench({ demoToolsEnabled: true });
    expect(html).toContain(
      'host.innerHTML = canCreate ? newForm() : (state.role ? reviewerLanding() : readOnlyLanding())',
    );
    expect(html).toContain('当前账号可查看稿件、追溯与分析，但不能新建、改稿或推进流程。');
    expect(html).toContain('系统会在轮到当前职责时显示复审、会签、终审或签发动作');
  });
});
