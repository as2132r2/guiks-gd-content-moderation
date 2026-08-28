import { describe, expect, it } from 'vitest';
import { extractReply } from '../src/routes/target.js';

describe('extractReply', () => {
  it('parses an OpenAI-style chat completion', () => {
    const json = { choices: [{ message: { role: 'assistant', content: '你好' } }] };
    expect(extractReply(json, 'openai')).toBe('你好');
  });

  it('parses a legacy OpenAI text completion', () => {
    expect(extractReply({ choices: [{ text: 'hi' }] }, 'openai')).toBe('hi');
  });

  it('parses a simple {reply} shape and common aliases', () => {
    expect(extractReply({ reply: 'r' }, 'simple')).toBe('r');
    expect(extractReply({ output: 'o' }, 'simple')).toBe('o');
    expect(extractReply({ content: 'c' }, 'simple')).toBe('c');
  });

  it('returns empty string on unexpected shapes instead of throwing', () => {
    expect(extractReply({}, 'openai')).toBe('');
    expect(extractReply(null, 'simple')).toBe('');
    expect(extractReply(42, 'simple')).toBe('');
  });
});
