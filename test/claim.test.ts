import { describe, expect, it } from 'vitest';
import { checkClaim, findClaims, isClaimComment, type ClaimInput } from '../src/checks/claim';
import { DEFAULT_CLAIM_PHRASES } from '../src/config';
import type { IssueComment } from '../src/types';
import { config, issue } from './helpers';

const phrases = config().claimPhrases;
const MAINT = ['OWNER', 'MEMBER', 'COLLABORATOR'];

function input(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    author: 'new-contributor',
    prCreatedAt: '2026-10-01T12:00:00Z',
    linkedIssue: { ok: true, value: issue() },
    owner: 'acme',
    repo: 'widget',
    phrases,
    maintainerAssociations: MAINT,
    expiryDays: 7,
    requiresAck: true,
    requireClaim: false,
    severity: 'warn',
    ...overrides,
  };
}

const c = (author: string, body: string, createdAt: string, association = 'NONE'): IssueComment => ({
  author,
  body,
  createdAt,
  association,
});

describe('isClaimComment', () => {
  it.each([
    "I'd like to work on this",
    'I’d love to take this one!',
    'Can I take this?',
    'could i please work on this issue',
    'Please assign me',
    'assign this to me',
    "I'll pick this up",
    "I'm working on it",
    'let me try this',
    '/assign',
    'Hey, I want to work on this.',
  ])('matches %j', (body) => {
    expect(isClaimComment(body, phrases)).toBe(true);
  });

  it.each([
    'This also happens on Windows.',
    '> I would like to work on this\n\nAny update?',
    'Can I ask how to reproduce this?',
    '```\n/assign\n```',
  ])('does not match %j', (body) => {
    expect(isClaimComment(body, phrases)).toBe(false);
  });

  it('has all default phrases compile', () => {
    expect(DEFAULT_CLAIM_PHRASES.length).toBeGreaterThan(5);
  });
});

describe('findClaims', () => {
  it('marks a claim acknowledged when a maintainer replies mentioning the claimer', () => {
    const claims = findClaims(issue(), { phrases, maintainerAssociations: MAINT, before: '2026-10-01T12:00:00Z' });
    expect(claims.find((x) => x.user === 'early-bird')).toMatchObject({ acknowledged: true, source: 'comment' });
    expect(claims.find((x) => x.user === 'new-contributor')).toMatchObject({ acknowledged: false });
  });

  it('does not count a maintainer reply addressed to someone else', () => {
    const i = issue({
      comments: [
        c('a', "I'd like to work on this", '2026-09-28T10:00:00Z'),
        c('mo', '@b thanks for the report', '2026-09-28T11:00:00Z', 'OWNER'),
      ],
    });
    expect(
      findClaims(i, { phrases, maintainerAssociations: MAINT, before: '2026-10-01T00:00:00Z' })[0].acknowledged,
    ).toBe(false);
  });

  it('stops looking for an ack once someone else claims', () => {
    const i = issue({
      comments: [
        c('a', "I'd like to work on this", '2026-09-28T10:00:00Z'),
        c('b', 'can I take this?', '2026-09-28T10:30:00Z'),
        c('mo', 'ok go ahead', '2026-09-28T11:00:00Z', 'MEMBER'),
      ],
    });
    const claims = findClaims(i, { phrases, maintainerAssociations: MAINT, before: '2026-10-01T00:00:00Z' });
    expect(claims.find((x) => x.user === 'a')?.acknowledged).toBe(false);
    expect(claims.find((x) => x.user === 'b')?.acknowledged).toBe(true);
  });

  it('ignores claims made after the PR was opened', () => {
    const i = issue({ comments: [c('late', 'can I take this?', '2026-10-02T00:00:00Z')] });
    expect(findClaims(i, { phrases, maintainerAssociations: MAINT, before: '2026-10-01T00:00:00Z' })).toEqual([]);
  });

  it('ignores claim phrases from maintainers', () => {
    const i = issue({ comments: [c('mo', "I'll take this", '2026-09-28T00:00:00Z', 'OWNER')] });
    expect(findClaims(i, { phrases, maintainerAssociations: MAINT, before: '2026-10-01T00:00:00Z' })).toEqual([]);
  });

  it('refreshes activity when the claimer comments again', () => {
    const i = issue({
      comments: [
        c('a', "I'd like to work on this", '2026-09-01T00:00:00Z'),
        c('a', 'still on it, almost done', '2026-09-29T00:00:00Z'),
      ],
    });
    const [claim] = findClaims(i, { phrases, maintainerAssociations: MAINT, before: '2026-10-01T00:00:00Z' });
    expect(claim.at).toBe('2026-09-01T00:00:00Z');
    expect(claim.lastActivity).toBe('2026-09-29T00:00:00Z');
  });
});

describe('checkClaim', () => {
  it('flags when someone else claimed first and a maintainer agreed', () => {
    const r = checkClaim(input());
    expect(r).toMatchObject({ status: 'flag', labelKey: 'claimed-by-other' });
    expect(r?.detail).toContain('@early-bird');
    expect(r?.detail).toContain('a maintainer replied');
  });

  it('passes when the author claimed before the other person', () => {
    const r = checkClaim(
      input({
        linkedIssue: {
          ok: true,
          value: issue({
            comments: [
              c('new-contributor', 'can I take this?', '2026-09-27T00:00:00Z'),
              c('early-bird', "I'd like to work on this", '2026-09-28T00:00:00Z'),
              c('mo', 'sure @early-bird', '2026-09-28T01:00:00Z', 'MEMBER'),
            ],
          }),
        },
      }),
    );
    expect(r?.status).toBe('pass');
  });

  it('ignores unacknowledged claims by default', () => {
    const i = issue({ comments: [c('early-bird', "I'd like to work on this", '2026-09-28T00:00:00Z')] });
    expect(checkClaim(input({ linkedIssue: { ok: true, value: i } }))?.status).toBe('pass');
  });

  it('counts unacknowledged claims when claim-requires-ack is false', () => {
    const i = issue({ comments: [c('early-bird', "I'd like to work on this", '2026-09-28T00:00:00Z')] });
    const r = checkClaim(input({ linkedIssue: { ok: true, value: i }, requiresAck: false }));
    expect(r?.status).toBe('flag');
    expect(r?.detail).not.toContain('maintainer replied');
  });

  it('lets old claims expire', () => {
    const i = issue({
      comments: [
        c('early-bird', "I'd like to work on this", '2026-09-01T00:00:00Z'),
        c('mo', 'go ahead', '2026-09-01T01:00:00Z', 'OWNER'),
      ],
    });
    expect(checkClaim(input({ linkedIssue: { ok: true, value: i } }))?.status).toBe('pass');
    expect(checkClaim(input({ linkedIssue: { ok: true, value: i }, expiryDays: 60 }))?.status).toBe('flag');
  });

  it('passes when the author is assigned', () => {
    const r = checkClaim(input({ linkedIssue: { ok: true, value: issue({ assignees: ['New-Contributor'] }) } }));
    expect(r?.status).toBe('pass');
  });

  it('flags when someone else is assigned, regardless of age', () => {
    const r = checkClaim(input({ linkedIssue: { ok: true, value: issue({ assignees: ['someone'], comments: [] }) } }));
    expect(r).toMatchObject({ status: 'flag', title: 'Issue is assigned to someone else' });
  });

  it('flags a missing claim only when require-claim is on', () => {
    const i = issue({ comments: [] });
    expect(checkClaim(input({ linkedIssue: { ok: true, value: i } }))?.status).toBe('pass');
    expect(checkClaim(input({ linkedIssue: { ok: true, value: i }, requireClaim: true }))).toMatchObject({
      status: 'flag',
      labelKey: 'not-claimed',
    });
  });

  it('accepts an own unacknowledged claim for require-claim', () => {
    const i = issue({ comments: [c('new-contributor', 'can I take this?', '2026-09-30T00:00:00Z')] });
    expect(checkClaim(input({ linkedIssue: { ok: true, value: i }, requireClaim: true }))?.status).toBe('pass');
  });

  it('skips without a linked issue or when the fetch failed', () => {
    expect(checkClaim(input({ linkedIssue: { ok: true, value: null } }))?.status).toBe('skip');
    expect(checkClaim(input({ linkedIssue: { ok: false, reason: 'boom' } }))?.detail).toContain('boom');
  });

  it('returns null when off or not fetched', () => {
    expect(checkClaim(input({ severity: 'off' }))).toBeNull();
    expect(checkClaim(input({ linkedIssue: undefined }))).toBeNull();
  });
});
