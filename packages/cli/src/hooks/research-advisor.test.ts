import { describe, it, expect } from 'vitest';
import { suggestionFor, SUGGEST_FETCH, SUGGEST_SEARCH, SUGGEST_BASH } from './research-advisor-logic.js';

describe('research advisor logic', () => {
  it('suggests the gateway for WebFetch and WebSearch', () => {
    expect(suggestionFor('WebFetch', {})).toBe(SUGGEST_FETCH);
    expect(suggestionFor('WebSearch', {})).toBe(SUGGEST_SEARCH);
  });

  it('suggests for network Bash commands only', () => {
    expect(suggestionFor('Bash', { command: 'curl https://x.test' })).toBe(SUGGEST_BASH);
    expect(suggestionFor('Bash', { command: 'gh api repos/o/r/issues/1' })).toBe(SUGGEST_BASH);
    expect(suggestionFor('Bash', { command: 'ls -la' })).toBeNull();
  });

  it('parses a stringified tool_input', () => {
    expect(suggestionFor('Bash', JSON.stringify({ command: 'wget http://x.test' }))).toBe(SUGGEST_BASH);
  });

  it('stays silent on unrelated tools', () => {
    expect(suggestionFor('Read', { file_path: '/a' })).toBeNull();
    expect(suggestionFor('Edit', {})).toBeNull();
    expect(suggestionFor(undefined, undefined)).toBeNull();
  });
});
