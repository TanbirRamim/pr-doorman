import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluate';
import { MARKER, renderComment, renderSummary } from '../src/render';
import { skipReason } from '../src/skip';
import { config, facts, issue, prFacts } from './helpers';

describe('evaluate', () => {
  it('passes a clean PR', () => {
    const ev = evaluate(
      facts({
        pr: prFacts({ body: 'Closes #17' }),
        linkedIssue: { ok: true, value: issue({ comments: [] }) },
        recentPrCount: { ok: true, value: 1 },
      }),
      config({ template: 'off', account: 'off' }),
    );
    expect(ev.outcome).toBe('pass');
    expect(ev.labelsToAdd).toEqual([]);
    expect(ev.labelsToRemove).toContain('doorman: needs-issue');
  });

  it('takes the worst severity as the outcome and labels warn/fail only', () => {
    const ev = evaluate(
      facts({
        pr: prFacts({ body: 'no link' }),
        account: { ok: true, value: { createdAt: '2026-09-30T00:00:00Z', mergedPrs: 0 } },
      }),
      config({ 'linked-issue': 'fail', claim: 'off', 'pr-burst': 'off', template: 'off' }),
    );
    expect(ev.outcome).toBe('fail');
    expect(ev.flagged.map((r) => r.id)).toEqual(['linked-issue', 'account']);
    expect(ev.labelsToAdd).toEqual(['doorman: needs-issue']);
    expect(ev.shouldClose).toBe(false);
  });

  it('closes only when close-on-fail is set and a fail check flagged', () => {
    const f = facts({ pr: prFacts({ body: '' }) });
    expect(evaluate(f, config({ 'linked-issue': 'fail', 'close-on-fail': 'true' })).shouldClose).toBe(true);
    expect(evaluate(f, config({ 'close-on-fail': 'true' })).shouldClose).toBe(false);
  });

  it('manages no labels when add-labels is false', () => {
    const ev = evaluate(facts({ pr: prFacts({ body: '' }) }), config({ 'add-labels': 'false' }));
    expect(ev.labelsToAdd).toEqual([]);
    expect(ev.labelsToRemove).toEqual([]);
  });

  it('runs the claim scenario from the fixtures end to end', () => {
    const ev = evaluate(
      facts({ linkedIssue: { ok: true, value: issue() }, recentPrCount: { ok: true, value: 2 } }),
      config(),
    );
    expect(ev.outcome).toBe('warn');
    expect(ev.labelsToAdd).toEqual(['doorman: claimed-by-other']);
  });
});

describe('renderComment', () => {
  it('lists warn and fail items with fixes, hides notes, and carries the marker', () => {
    const ev = evaluate(
      facts({
        pr: prFacts({ body: 'no link' }),
        account: { ok: true, value: { createdAt: '2026-09-30T00:00:00Z', mergedPrs: 0 } },
      }),
      config({ claim: 'off', 'pr-burst': 'off', template: 'off' }),
    );
    const body = renderComment(ev, { author: 'new-contributor', closed: false, dryRun: false });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('Needs a linked issue');
    expect(body).toContain('Closes #123');
    expect(body).not.toContain('New account');
    expect(body).toContain("doesn't use AI");
    expect(body).toMatchSnapshot();
  });

  it('says so when the PR was closed', () => {
    const ev = evaluate(facts({ pr: prFacts({ body: '' }) }), config({ 'linked-issue': 'fail' }));
    expect(renderComment(ev, { author: 'x', closed: true, dryRun: false })).toContain('was closed');
  });

  it('renders an all-clear message', () => {
    const ev = evaluate(facts(), config({ claim: 'off', template: 'off', account: 'off', 'pr-burst': 'off' }));
    expect(renderComment(ev, { author: 'x', closed: false, dryRun: true })).toContain(
      'all the automated checks look good',
    );
  });
});

describe('renderSummary', () => {
  it('includes every check, notes too', () => {
    const ev = evaluate(
      facts({ account: { ok: true, value: { createdAt: '2026-09-30T00:00:00Z', mergedPrs: 0 } } }),
      config({ claim: 'off', 'pr-burst': 'off', template: 'off' }),
    );
    const md = renderSummary(ev, { author: 'x', dryRun: false });
    expect(md).toContain('| account | flagged | note |');
    expect(md).toContain('| linked-issue | passed | warn |');
  });

  it('explains skips', () => {
    const ev = evaluate(facts(), config());
    expect(renderSummary(ev, { author: 'x', skippedReason: 'bot', dryRun: false })).toContain('Skipped: bot');
  });
});

describe('skipReason', () => {
  it('skips bots, maintainers and allowlisted users', () => {
    expect(skipReason(prFacts({ author: 'dependabot[bot]', authorType: 'Bot' }), config())).toContain('bot');
    expect(skipReason(prFacts({ author: 'renovate[bot]' }), config())).toContain('bot');
    expect(skipReason(prFacts({ authorAssociation: 'MEMBER' }), config())).toContain('member');
    expect(skipReason(prFacts({ author: 'Friend' }), config({ allowlist: 'friend' }))).toContain('allowlist');
  });

  it('runs for regular contributors', () => {
    expect(skipReason(prFacts({ authorAssociation: 'CONTRIBUTOR' }), config())).toBeNull();
  });

  it('respects custom skip-associations', () => {
    expect(
      skipReason(prFacts({ authorAssociation: 'COLLABORATOR' }), config({ 'skip-associations': 'OWNER' })),
    ).toBeNull();
  });
});
