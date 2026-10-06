import { describe, expect, it } from 'vitest';
import { checkLinkedIssue, parseClosingRefs } from '../src/checks/linked-issue';

const run = (body: string, closingRefs = [] as { owner: string; repo: string; number: number }[]) =>
  checkLinkedIssue({ body, owner: 'acme', repo: 'widget', closingRefs, severity: 'warn' });

describe('parseClosingRefs', () => {
  it.each([
    ['Closes #12', 12],
    ['fixes #3', 3],
    ['Resolved #99.', 99],
    ['FIXES: #7', 7],
    ['This PR closes #5 and more', 5],
  ])('finds the issue in %j', (body, number) => {
    expect(parseClosingRefs(body, 'acme', 'widget')).toEqual([{ owner: 'acme', repo: 'widget', number }]);
  });

  it('handles cross-repo references and URLs', () => {
    const body = 'Fixes other/lib#8\nCloses https://github.com/acme/widget/issues/9';
    expect(parseClosingRefs(body, 'acme', 'widget')).toEqual([
      { owner: 'other', repo: 'lib', number: 8 },
      { owner: 'acme', repo: 'widget', number: 9 },
    ]);
  });

  it('ignores code blocks, inline code and HTML comments', () => {
    const body = '```\nCloses #1\n```\n`fixes #2`\n<!-- Closes #3 -->';
    expect(parseClosingRefs(body, 'acme', 'widget')).toEqual([]);
  });

  it('does not match words that only contain a keyword', () => {
    expect(parseClosingRefs('prefixes #4', 'acme', 'widget')).toEqual([]);
  });

  it('dedupes repeated references', () => {
    expect(parseClosingRefs('Closes #4, fixes #4', 'acme', 'widget')).toHaveLength(1);
  });
});

describe('checkLinkedIssue', () => {
  it('passes with a closing keyword in the body', () => {
    expect(run('Closes #17')).toMatchObject({ status: 'pass', detail: 'Closes #17.' });
  });

  it('passes with a sidebar link reported by GraphQL', () => {
    expect(run('no keyword here', [{ owner: 'acme', repo: 'widget', number: 3 }])).toMatchObject({ status: 'pass' });
  });

  it('flags an empty body', () => {
    expect(run('')).toMatchObject({ status: 'flag', labelKey: 'needs-issue' });
  });

  it('suggests a closing keyword when only a bare mention exists', () => {
    const r = run('Related to #17');
    expect(r?.status).toBe('flag');
    expect(r?.fix).toContain('`Closes #17`');
  });

  it('returns null when turned off', () => {
    expect(checkLinkedIssue({ body: '', owner: 'a', repo: 'b', closingRefs: [], severity: 'off' })).toBeNull();
  });
});
