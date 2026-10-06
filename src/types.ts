export type Severity = 'off' | 'note' | 'warn' | 'fail';
export type ActiveSeverity = Exclude<Severity, 'off'>;

export const CHECK_IDS = ['linked-issue', 'claim', 'pr-burst', 'template', 'account', 'diff-scope'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export type CheckStatus = 'pass' | 'flag' | 'skip';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  severity: ActiveSeverity;
  /** Short heading shown in the comment, e.g. "Needs a linked issue". */
  title: string;
  /** Plain-language explanation of what was found. */
  detail: string;
  /** What the contributor can do about it. Only used when flagged. */
  fix?: string;
  /** Key into the label map, e.g. "needs-issue". Only used when flagged. */
  labelKey?: string;
}

/** Result of an API lookup: either a value or a reason it could not be fetched. */
export type Fetched<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

export interface IssueComment {
  author: string;
  /** GitHub author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ... */
  association: string;
  body: string;
  createdAt: string;
}

export interface LinkedIssue {
  ref: IssueRef;
  state: 'open' | 'closed';
  author: string;
  assignees: string[];
  labels: string[];
  comments: IssueComment[];
}

export interface PullRequestFacts {
  number: number;
  body: string;
  author: string;
  authorAssociation: string;
  authorType: string;
  createdAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  owner: string;
  repo: string;
}

export interface AccountFacts {
  createdAt: string;
  mergedPrs: number;
}

/**
 * Everything the checks need, collected up front by the I/O layer.
 * A field is undefined when the check that needs it is disabled.
 */
export interface Facts {
  now: string;
  pr: PullRequestFacts;
  /** Closing references reported by GitHub (GraphQL closingIssuesReferences). */
  closingRefs: IssueRef[];
  linkedIssue?: Fetched<LinkedIssue | null>;
  recentPrCount?: Fetched<number>;
  template?: Fetched<string | null>;
  account?: Fetched<AccountFacts>;
  files?: Fetched<string[]>;
}
