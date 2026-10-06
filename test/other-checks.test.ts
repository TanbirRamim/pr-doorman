import { describe, expect, it } from 'vitest';
import { checkAccount } from '../src/checks/account';
import { checkDiffScope, type DiffScopeInput } from '../src/checks/diff-scope';
import { checkPrBurst } from '../src/checks/pr-burst';
import { checkTemplate, parseCheckboxes } from '../src/checks/template';
import { fixture, issue } from './helpers';

describe('checkPrBurst', () => {
  const base = { author: 'Spammy', threshold: 10, allowlist: [] as string[], severity: 'warn' as const };

  it('passes at the threshold and flags above it', () => {
    expect(checkPrBurst({ ...base, recentPrCount: { ok: true, value: 10 } })?.status).toBe('pass');
    expect(checkPrBurst({ ...base, recentPrCount: { ok: true, value: 11 } })).toMatchObject({
      status: 'flag',
      labelKey: 'pr-burst',
    });
  });

  it('skips allowlisted users case-insensitively', () => {
    expect(checkPrBurst({ ...base, allowlist: ['spammy'], recentPrCount: { ok: true, value: 50 } })?.status).toBe(
      'skip',
    );
  });

  it('skips when the search failed', () => {
    const r = checkPrBurst({ ...base, recentPrCount: { ok: false, reason: 'GitHub API rate limit reached' } });
    expect(r?.status).toBe('skip');
    expect(r?.detail).toContain('rate limit');
  });

  it('uses singular wording for one PR', () => {
    expect(checkPrBurst({ ...base, recentPrCount: { ok: true, value: 1 } })?.detail).toContain('1 pull request opened');
  });
});

describe('checkTemplate', () => {
  const template = { ok: true as const, value: fixture('pull_request_template.md') };
  const filled = fixture('pull_request_template.md').replace('- [ ] I ran', '- [x] I ran');

  it('parses checkboxes, ignoring ones inside HTML comments', () => {
    expect(parseCheckboxes('- [x] a\n* [ ] b\n<!-- - [ ] c -->')).toEqual([
      { checked: true, text: 'a' },
      { checked: false, text: 'b' },
    ]);
  });

  it('passes when at least one item is ticked', () => {
    expect(checkTemplate({ body: filled, template, severity: 'warn' })).toMatchObject({ status: 'pass' });
  });

  it('flags a template with nothing ticked', () => {
    expect(checkTemplate({ body: template.value, template, severity: 'warn' })).toMatchObject({
      status: 'flag',
      labelKey: 'template-unchecked',
    });
  });

  it('flags a deleted template', () => {
    expect(checkTemplate({ body: 'I fixed the bug.', template, severity: 'warn' })).toMatchObject({
      status: 'flag',
      labelKey: 'template-missing',
    });
  });

  it('tolerates a reworded item as long as headings survive', () => {
    const body = '## What does this change?\nstuff\n## Checklist\n- [x] Tests run locally\n';
    expect(checkTemplate({ body, template, severity: 'warn' })?.status).not.toBe('pass');
    expect(checkTemplate({ body, template, severity: 'warn' })?.labelKey).toBe('template-unchecked');
  });

  it('accepts uppercase X', () => {
    const body = template.value.replace('- [ ] This PR', '- [X] This PR');
    expect(checkTemplate({ body, template, severity: 'warn' })?.status).toBe('pass');
  });

  it('skips when there is no template or no checkboxes', () => {
    expect(checkTemplate({ body: '', template: { ok: true, value: null }, severity: 'warn' })?.status).toBe('skip');
    expect(checkTemplate({ body: '', template: { ok: true, value: '## Notes' }, severity: 'warn' })?.status).toBe(
      'skip',
    );
  });
});

describe('checkAccount', () => {
  const base = { author: 'x', now: '2026-10-01T00:00:00Z', minAgeDays: 14, severity: 'note' as const };

  it('flags young accounts with no merged PRs', () => {
    const r = checkAccount({
      ...base,
      account: { ok: true, value: { createdAt: '2026-09-28T00:00:00Z', mergedPrs: 0 } },
    });
    expect(r).toMatchObject({ status: 'flag', severity: 'note' });
    expect(r?.detail).toContain('3 days old');
  });

  it('passes young accounts that already have merged PRs', () => {
    const r = checkAccount({
      ...base,
      account: { ok: true, value: { createdAt: '2026-09-28T00:00:00Z', mergedPrs: 2 } },
    });
    expect(r?.status).toBe('pass');
  });

  it('passes old accounts', () => {
    const r = checkAccount({
      ...base,
      account: { ok: true, value: { createdAt: '2020-01-01T00:00:00Z', mergedPrs: 0 } },
    });
    expect(r?.status).toBe('pass');
  });

  it('skips on fetch errors', () => {
    expect(checkAccount({ ...base, account: { ok: false, reason: 'nope' } })?.status).toBe('skip');
  });
});

describe('checkDiffScope', () => {
  const base: DiffScopeInput = {
    authorAssociation: 'CONTRIBUTOR',
    additions: 10,
    deletions: 2,
    owner: 'acme',
    repo: 'widget',
    linkedIssue: { ok: true, value: issue() },
    files: { ok: true, value: ['src/cli/main.ts', 'src/cli/args.ts'] },
    pathMap: { 'area: cli': ['src/cli/**', 'test/cli/**'] },
    largeDiffLines: 1000,
    severity: 'warn',
  };

  it('passes when every file is inside the mapped paths', () => {
    expect(checkDiffScope(base)?.status).toBe('pass');
  });

  it('flags files outside the mapped paths', () => {
    const r = checkDiffScope({ ...base, files: { ok: true, value: ['src/cli/main.ts', 'README.md', 'src/web/x.ts'] } });
    expect(r).toMatchObject({ status: 'flag', labelKey: 'out-of-scope' });
    expect(r?.detail).toContain('`README.md`');
  });

  it('ignores labels without a mapping', () => {
    const r = checkDiffScope({ ...base, pathMap: { docs: ['docs/**'] }, files: { ok: true, value: ['anything.ts'] } });
    expect(r?.status).toBe('pass');
  });

  it('flags very large diffs from first-time contributors only', () => {
    const big = { ...base, additions: 1500, deletions: 10 };
    expect(checkDiffScope({ ...big, authorAssociation: 'FIRST_TIME_CONTRIBUTOR' })).toMatchObject({
      status: 'flag',
      labelKey: 'large-diff',
    });
    expect(checkDiffScope({ ...big, authorAssociation: 'NONE' })?.status).toBe('flag');
    expect(checkDiffScope(big)?.status).toBe('pass');
  });

  it('works with no linked issue', () => {
    expect(checkDiffScope({ ...base, linkedIssue: undefined, files: undefined })?.status).toBe('pass');
  });

  it('notes when files could not be listed', () => {
    const r = checkDiffScope({ ...base, files: { ok: false, reason: 'HTTP 500' } });
    expect(r?.status).toBe('pass');
    expect(r?.detail).toContain('HTTP 500');
  });
});
