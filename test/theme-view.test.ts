import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';

import { renderLogin } from '../src/views/login-view.js';
import { renderLanding } from '../src/views/landing-view.js';
import { renderOversight } from '../src/views/oversight-view.js';
import { renderWorkbench, shouldKeepWorkbenchPanel } from '../src/views/workbench-view.js';
import {
  normalizeTheme,
  themeBootstrap,
  themeRuntimeScript,
  themeStorageKey,
  themeStyles,
  themes,
} from '../src/views/theme.js';

const pages = [
  ['landing', renderLanding],
  ['login', () => renderLogin({ demoLoginEnabled: false })],
  ['workbench', () => renderWorkbench({ demoToolsEnabled: true })],
  ['oversight', renderOversight],
] as const;

describe('shared theme shell', () => {
  it('defaults to mono and rejects an invalid stored value instead of silently accepting it', () => {
    expect(normalizeTheme(undefined)).toBe('mono');
    expect(normalizeTheme('mono')).toBe('mono');
    expect(normalizeTheme('glass')).toBe('glass');
    // Negative regression: the old “any non-empty storage value” approach would pass this.
    expect(normalizeTheme('neon')).toBe('mono');
  });

  it('uses the same storage key and pre-style bootstrap on every page', () => {
    for (const [name, render] of pages) {
      const html = render();
      expect(html, name).toContain(themeStorageKey);
      expect(html, name).toContain('data-set-theme="mono"');
      expect(html, name).toContain('data-set-theme="warm"');
      expect(html, name).toContain('data-set-theme="glass"');
      expect(html.indexOf('document.documentElement.dataset.theme'), name).toBeLessThan(
        html.indexOf('<style>'),
      );
      expect(html, name).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    }
  });

  it('keeps the inline runtime parseable and carries motion and glass fallbacks', () => {
    expect(() => new Function(themeRuntimeScript)).not.toThrow();
    const bootstrap = themeBootstrap.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1];
    expect(bootstrap).toBeDefined();
    expect(() => new Function(bootstrap!)).not.toThrow();
    expect(themeStyles).toContain('prefers-reduced-motion:reduce');
    expect(themeStyles).toMatch(/prefers-reduced-motion:reduce[\s\S]*body,header\.topbar[\s\S]*transition-duration:\.001ms/);
    expect(themeStyles).toContain('@supports not ((backdrop-filter:blur(2px))');
    expect(themeStyles).not.toContain('transition:all');
  });

  it('renders warm as a solid near-white paper theme without changing its stable id', () => {
    expect(themes.warm).toEqual({ label: '纸质暖白', description: '暖白书页、柔和护眼' });
    expect(token('warm', '--bg')).toBe('#f7f3ec');
    expect(token('warm', '--bg-effect')).toBe('#f7f3ec');
    expect(token('warm', '--panel')).toBe('#fffdf8');
    expect(token('warm', '--panel-2')).toBe('#f8f3ea');
    expect(token('warm', '--panel-3')).toBe('#eee6da');
    expect(themeBlock('warm')).not.toMatch(/gradient|url\(/);
    expect(themeStyles).toContain('.theme-preview.warm { background:#f7f3ec; }');
  });

  it('elevates the complete topbar stacking context above filtered page surfaces', () => {
    expect(themeStyles).toMatch(/header\.topbar \{ position:relative; z-index:10; \}/);
    expect(renderLanding()).toContain('position:sticky; top:0; z-index:5');
    expect(renderWorkbench({ demoToolsEnabled: true })).toContain('position:sticky; top:0; z-index:40');
    expect(renderWorkbench({ demoToolsEnabled: true })).toContain('z-index:100; display:grid; place-items:center');
  });

  it('closes the theme popover without stealing focus on an outside pointer action', () => {
    const listeners: Record<string, (event: any) => void> = {};
    const option = fakeElement();
    option.attributes['aria-pressed'] = 'true';
    option.attributes['data-set-theme'] = 'mono';
    const trigger = fakeElement();
    const popover = fakeElement();
    popover.querySelectorAll = () => [option];
    const document = {
      activeElement: null as unknown,
      documentElement: { dataset: { theme: 'mono' } },
      getElementById: (id: string) => id === 'theme-trigger' ? trigger : popover,
      addEventListener: (name: string, listener: (event: any) => void) => { listeners[name] = listener; },
    };
    option.onFocus = () => { document.activeElement = option; };
    trigger.onFocus = () => { document.activeElement = trigger; };
    runInNewContext(themeRuntimeScript, {
      document,
      localStorage: { setItem() {} },
      window: { setTimeout: (callback: () => void) => callback() },
    });

    trigger.listeners.click!({});
    expect(popover.classList.contains('open')).toBe(true);
    listeners.pointerdown!({ target: {} });
    expect(popover.classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(option);

    trigger.listeners.click!({});
    listeners.keydown!({ key: 'Escape', preventDefault() {} });
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    ['mono', 'mono'],
    ['warm', 'warm'],
    ['glass', 'glass'],
    ['neon', 'mono'],
    ['constructor', 'mono'],
    ['toString', 'mono'],
    ['__proto__', 'mono'],
    ['', 'mono'],
    [null, 'mono'],
  ])('executes the bootstrap with stored %j as %s', (stored, expected) => {
    const code = themeBootstrap.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1];
    const document = { documentElement: { dataset: {} as Record<string, string> }, addEventListener() {} };
    const localStorage = { getItem: () => stored };
    runInNewContext(code!, { document, localStorage });
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it('executes the bootstrap safely when localStorage read throws', () => {
    const code = themeBootstrap.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1];
    const document = { documentElement: { dataset: {} as Record<string, string> }, addEventListener() {} };
    const localStorage = { getItem: () => { throw new Error('denied'); } };
    expect(() => runInNewContext(code!, { document, localStorage })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('mono');
  });

  it('keeps workbench motion cancelable and skips stage animation for same-stage SSE refreshes', () => {
    const previous = { manuscript: { id: 'm-1' }, stage: 'review' };
    expect(shouldKeepWorkbenchPanel(previous, { manuscript: { id: 'm-1' }, stage: 'review' }, 'sse')).toBe(true);
    expect(shouldKeepWorkbenchPanel(previous, { manuscript: { id: 'm-1' }, stage: 'trace' }, 'sse')).toBe(false);
    expect(shouldKeepWorkbenchPanel(previous, { manuscript: { id: 'm-2' }, stage: 'review' }, 'sse')).toBe(false);
    expect(shouldKeepWorkbenchPanel(previous, { manuscript: { id: 'm-1' }, stage: 'review' }, 'api')).toBe(false);
    const html = renderWorkbench({ demoToolsEnabled: true });
    expect(html).toContain('id="trace-replay"');
    expect(html).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(html).toContain("previous.manuscript.id !== view.manuscript.id || previous.stage !== view.stage");
    expect(html).toContain('var shouldKeepPanel = function shouldKeepWorkbenchPanel');
    expect(html).toContain('if (samePanel) renderWithoutPanel();');
    expect(html).toContain('if (shouldReplayTrace) replayTrace();');
    expect(html).toContain('window.clearTimeout(state.traceAnimationTimer)');
    expect(html).toContain('function renderPanel() {\n    cancelTraceReplay();');
    expect(html).toContain("behavior:prefersReducedMotion() ? 'auto' : 'smooth'");
    expect(html).toContain('if (!prefersReducedMotion())');
    expect(html).toContain('pathLength="1"');
    expect(html).toContain('Math.min(index, 24)');
    expect(html).toContain('main { grid-template-columns:minmax(0,1fr); overflow-y:auto; }');
    expect(html).toContain('aside, section.stage, aside.side { min-width:0; overflow-y:visible; }');
    expect(html).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
  });

  it('uses a dedicated theme-aware login brand surface', () => {
    const html = renderLogin({ demoLoginEnabled: false });
    expect(html).toContain('background:var(--brand-bg);color:var(--brand-ink)');
    expect(themeStyles).toContain('--brand-bg:linear-gradient(145deg');
  });

  it('keeps small semantic text tokens readable against every theme panel', () => {
    for (const theme of ['mono', 'warm', 'glass']) {
      const panel = token(theme, '--panel-solid');
      for (const name of ['--ink', '--muted', '--faint', '--accent', '--accent-deep', '--block', '--warn', '--info', '--ai', '--ai-edited', '--human', '--source']) {
        expect(contrast(token(theme, name), panel), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

function fakeElement() {
  const classes = new Set<string>();
  const element = {
    attributes: {} as Record<string, string>,
    listeners: {} as Record<string, (event: any) => void>,
    onFocus: undefined as undefined | (() => void),
    classList: {
      add: (name: string) => { classes.add(name); },
      remove: (name: string) => { classes.delete(name); },
      contains: (name: string) => classes.has(name),
    },
    addEventListener(name: string, listener: (event: any) => void) { this.listeners[name] = listener; },
    getAttribute(name: string) { return this.attributes[name] ?? null; },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    querySelectorAll: () => [] as any[],
    contains: () => false,
    focus() { this.onFocus?.(); },
  };
  return element;
}

function token(theme: string, name: string): string {
  const block = themeBlock(theme);
  const value = block && new RegExp(`${name}:([^;]+);`).exec(block)?.[1]?.trim();
  if (!value?.startsWith('#')) throw new Error(`missing hex token ${theme} ${name}`);
  return value;
}

function themeBlock(theme: string): string {
  const block = new RegExp(`html\\[data-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`).exec(themeStyles)?.[1];
  if (!block) throw new Error(`missing theme block ${theme}`);
  return block;
}

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const raw = hex.slice(1);
    const expanded = raw.length === 3 ? raw.split('').map((v) => v + v).join('') : raw;
    const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
