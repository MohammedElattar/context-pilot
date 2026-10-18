import { describe, it, expect } from 'vitest';
import { parseGitHubRef, fetchGitHubMarkdown } from './github.js';

describe('parseGitHubRef', () => {
  it('parses issue and PR URLs and shorthand', () => {
    expect(parseGitHubRef('https://github.com/nodejs/node/issues/123')).toMatchObject({ owner: 'nodejs', repo: 'node', number: 123, kind: 'issue' });
    expect(parseGitHubRef('https://github.com/a/b/pull/7')).toMatchObject({ kind: 'pull', number: 7 });
    expect(parseGitHubRef('vitest-dev/vitest#99')).toMatchObject({ owner: 'vitest-dev', repo: 'vitest', number: 99 });
  });
  it('returns null for non-GitHub input', () => {
    expect(parseGitHubRef('https://example.com/x')).toBeNull();
    expect(parseGitHubRef('just text')).toBeNull();
  });
});

describe('fetchGitHubMarkdown (stubbed gh)', () => {
  const ref = parseGitHubRef('https://github.com/o/r/issues/5')!;

  it('keeps body, head/tail and maintainer comments verbatim, compacts the middle', async () => {
    const issue = { title: 'Crash on start', state: 'open', user: { login: 'reporter' }, labels: ['bug', { name: 'p1' }], body: 'TypeError: boom at index.js:10' };
    const comments: { user: { login: string }; body: string; author_association: string }[] = [];
    for (let i = 0; i < 20; i++) {
      comments.push({ user: { login: `u${i}` }, body: `comment ${i}`, author_association: i === 10 ? 'OWNER' : 'NONE' });
    }
    const ghExec = async (args: string[]) =>
      args[1].includes('/comments') ? JSON.stringify(comments) : JSON.stringify(issue);

    const { markdown, url } = await fetchGitHubMarkdown(ref, { ghExec });
    expect(url).toBe('https://github.com/o/r/issues/5');
    expect(markdown).toContain('TypeError: boom at index.js:10'); // body verbatim
    expect(markdown).toContain('Labels: bug, p1');
    expect(markdown).toContain('comment 0');   // head kept
    expect(markdown).toContain('comment 19');  // tail kept
    expect(markdown).toContain('@u10 (OWNER)'); // maintainer kept
    expect(markdown).toContain('comment 10');
    expect(markdown).toMatch(/\d+ middle comment\(s\) omitted/); // middle compacted
    expect(markdown).not.toContain('comment 7'); // a middle non-maintainer comment dropped
  });
});
