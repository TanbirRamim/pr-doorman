import type { CheckResult, Fetched, IssueComment, LinkedIssue, Severity } from '../types';
import { formatRef } from './linked-issue';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Claim {
  user: string;
  /** When the claim was made. Empty for assignees (assignment has no expiry). */
  at: string;
  /** Last time the claimer commented on the issue. Used for expiry. */
  lastActivity: string;
  source: 'assignee' | 'comment';
  acknowledged: boolean;
}

export interface ClaimOptions {
  phrases: RegExp[];
  /** Phrases that give a claim back. A match by the claimer after their claim ends it. */
  releasePhrases?: RegExp[];
  maintainerAssociations: string[];
  /** Only comments made before this time can count as claims (the PR's creation time). */
  before: string;
}

function normalize(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'");
}

/** Does this comment ask for the issue? Quoted lines and code are ignored. */
export function isClaimComment(body: string, phrases: RegExp[]): boolean {
  const lines = normalize(body)
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'));
  const text = lines.join('\n');
  return phrases.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

function mentions(body: string): string[] {
  return [...body.matchAll(/(?:^|[^\w`])@([a-z\d](?:[a-z\d-]{0,38}))/gi)].map((m) => m[1].toLowerCase());
}

const byTime = (a: IssueComment, b: IssueComment): number => Date.parse(a.createdAt) - Date.parse(b.createdAt);

/**
 * Finds claims on an issue. A comment claim is acknowledged when a maintainer
 * replies after it, either mentioning the claimer or (with no mentions) before
 * anyone else asks for the issue.
 */
export function findClaims(issue: LinkedIssue, opts: ClaimOptions): Claim[] {
  const maintainers = new Set(opts.maintainerAssociations.map((a) => a.toUpperCase()));
  const isMaintainer = (c: IssueComment): boolean => maintainers.has(c.association.toUpperCase());
  const cutoff = Date.parse(opts.before);
  const comments = [...issue.comments].sort(byTime);

  const claims = new Map<string, Claim>();

  for (const login of issue.assignees) {
    const user = login.toLowerCase();
    claims.set(user, { user, at: '', lastActivity: '', source: 'assignee', acknowledged: true });
  }

  comments.forEach((c, i) => {
    const user = c.author.toLowerCase();
    if (isMaintainer(c) || Date.parse(c.createdAt) > cutoff) return;
    if (opts.releasePhrases?.length && isClaimComment(c.body, opts.releasePhrases)) {
      if (claims.get(user)?.source === 'comment') claims.delete(user);
      return;
    }
    if (!isClaimComment(c.body, opts.phrases)) return;
    if (claims.has(user)) return; // keep the earliest claim (or the assignment)

    let acknowledged = false;
    for (let j = i + 1; j < comments.length; j++) {
      const reply = comments[j];
      if (isMaintainer(reply)) {
        const m = mentions(reply.body);
        if (m.includes(user) || m.length === 0) {
          acknowledged = true;
          break;
        }
        continue;
      }
      const other = reply.author.toLowerCase();
      if (other !== user && isClaimComment(reply.body, opts.phrases)) break;
    }

    claims.set(user, { user, at: c.createdAt, lastActivity: c.createdAt, source: 'comment', acknowledged });
  });

  // Any later comment by the claimer before the PR keeps their claim fresh.
  for (const c of comments) {
    const claim = claims.get(c.author.toLowerCase());
    if (!claim || claim.source !== 'comment' || Date.parse(c.createdAt) > cutoff) continue;
    if (Date.parse(c.createdAt) > Date.parse(claim.lastActivity)) claim.lastActivity = c.createdAt;
  }

  return [...claims.values()];
}

/** Latest of `since` and the user's comments on the issue before the PR. */
function lastActivityBefore(issue: LinkedIssue, login: string, since: string, prTime: number): string {
  let last = since;
  for (const c of issue.comments) {
    const t = Date.parse(c.createdAt);
    if (c.author.toLowerCase() === login.toLowerCase() && t <= prTime && t > Date.parse(last)) last = c.createdAt;
  }
  return last;
}

export interface ClaimInput {
  author: string;
  prCreatedAt: string;
  linkedIssue: Fetched<LinkedIssue | null> | undefined;
  owner: string;
  repo: string;
  phrases: RegExp[];
  releasePhrases?: RegExp[];
  maintainerAssociations: string[];
  expiryDays: number;
  requiresAck: boolean;
  /** Let assignments expire like comment claims, using issue.assignedAt. */
  assignmentExpiry?: boolean;
  requireClaim: boolean;
  severity: Severity;
}

export function checkClaim(input: ClaimInput): CheckResult | null {
  if (input.severity === 'off' || input.linkedIssue === undefined) return null;
  const base = { id: 'claim' as const, severity: input.severity, title: 'Issue claim' };

  if (!input.linkedIssue.ok) {
    return { ...base, status: 'skip', detail: `Couldn't read the linked issue (${input.linkedIssue.reason}).` };
  }
  const issue = input.linkedIssue.value;
  if (!issue) return { ...base, status: 'skip', detail: 'No linked issue, so there is no claim to check.' };

  const ref = formatRef(issue.ref, input.owner, input.repo);
  const author = input.author.toLowerCase();
  const prTime = Date.parse(input.prCreatedAt);
  const expired = (lastActivity: string): boolean => prTime - Date.parse(lastActivity) > input.expiryDays * DAY_MS;

  if (issue.assignees.some((a) => a.toLowerCase() === author)) {
    return { ...base, status: 'pass', detail: `${ref} is assigned to @${input.author}.` };
  }
  const stale: string[] = [];
  const active = issue.assignees.filter((a) => {
    const when = input.assignmentExpiry ? issue.assignedAt?.[a.toLowerCase()] : undefined;
    if (!when) return true; // no timeline data: assignment never expires
    const last = lastActivityBefore(issue, a, when, prTime);
    if (!expired(last)) return true;
    stale.push(a);
    return false;
  });
  if (active.length > 0) {
    const who = active.map((a) => `@${a}`).join(', ');
    return {
      ...base,
      status: 'flag',
      title: 'Issue is assigned to someone else',
      detail: `${ref} is assigned to ${who}, so they may already be working on it.`,
      fix: `Please check with them on ${ref} before continuing. If they've stopped, a maintainer can reassign it to you and this check will pass on the next push or edit.`,
      labelKey: 'claimed-by-other',
    };
  }

  const claims = findClaims(
    { ...issue, assignees: [] },
    {
      phrases: input.phrases,
      releasePhrases: input.releasePhrases,
      maintainerAssociations: input.maintainerAssociations,
      before: input.prCreatedAt,
    },
  );
  const own = claims.find((c) => c.user === author);
  const others = claims
    .filter((c) => c.user !== author)
    .filter((c) => !input.requiresAck || c.acknowledged)
    .filter((c) => !expired(c.lastActivity))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const first = others[0];
  if (first && (!own || Date.parse(first.at) < Date.parse(own.at))) {
    const original = issue.comments.find((c) => c.author.toLowerCase() === first.user);
    const name = original?.author ?? first.user;
    const when = first.at.slice(0, 10);
    return {
      ...base,
      status: 'flag',
      title: 'Issue was already claimed',
      detail: `@${name} asked to work on ${ref} on ${when}${first.acknowledged ? ' and a maintainer replied' : ''}, before this pull request was opened.`,
      fix: `Please coordinate on ${ref} first. If @${name} has moved on, say so there and a maintainer can sort it out. Claims expire after ${input.expiryDays} days without activity.`,
      labelKey: 'claimed-by-other',
    };
  }

  if (input.requireClaim && !own) {
    return {
      ...base,
      status: 'flag',
      title: 'Issue was not claimed first',
      detail: `This project asks contributors to claim an issue before opening a pull request, and there's no claim from @${input.author} on ${ref}.`,
      fix: `Leave a comment on ${ref} saying you'd like to work on it and wait for a maintainer to reply.`,
      labelKey: 'not-claimed',
    };
  }

  const staleNote = stale.length
    ? ` The assignment of ${stale.map((a) => `@${a}`).join(', ')} expired after ${input.expiryDays} days without activity.`
    : '';
  return {
    ...base,
    status: 'pass',
    detail: (own ? `@${input.author} claimed ${ref}.` : `Nobody else has an active claim on ${ref}.`) + staleNote,
  };
}
