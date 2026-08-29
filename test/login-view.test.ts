import { describe, expect, it } from 'vitest';

import { renderLogin } from '../src/views/login-view.js';

describe('login redirect target', () => {
  it('keeps a same-origin path', () => {
    expect(renderLogin({ demoLoginEnabled: false, next: '/workbench' })).toContain(
      'var next="/workbench"',
    );
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example'])(
    'rejects an external redirect target: %s',
    (next) => {
      expect(renderLogin({ demoLoginEnabled: false, next })).toContain('var next="/"');
    },
  );

  it('escapes markup before embedding next in an inline script', () => {
    const html = renderLogin({
      demoLoginEnabled: false,
      next: '/</script><script>alert(1)</script>',
    });
    expect(html).not.toContain('var next="/</script>');
    expect(html).toContain('\\u003c/script>');
  });
});
