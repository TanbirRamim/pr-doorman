import { checkAccount } from './checks/account';
import { checkClaim } from './checks/claim';
import { checkDiffScope } from './checks/diff-scope';
import { checkLinkedIssue } from './checks/linked-issue';
import { checkPrBurst } from './checks/pr-burst';
import { checkTemplate } from './checks/template';
import type { Config } from './config';
import type { ActiveSeverity, CheckResult, Facts } from './types';

export type Outcome = 'pass' | ActiveSeverity;

export interface Evaluation {
  results: CheckResult[];
  flagged: CheckResult[];
  outcome: Outcome;
  /** Labels this run wants on the PR. */
  labelsToAdd: string[];
  /** Labels managed by this action that no longer apply. */
  labelsToRemove: string[];
  shouldClose: boolean;
}

const RANK: Record<Outcome, number> = { pass: 0, note: 1, warn: 2, fail: 3 };

export function runChecks(facts: Facts, config: Config): CheckResult[] {
  const { pr } = facts;
  const s = config.severity;
  const results = [
    checkLinkedIssue({
      body: pr.body,
      owner: pr.owner,
      repo: pr.repo,
      closingRefs: facts.closingRefs,
      severity: s['linked-issue'],
    }),
    checkClaim({
      author: pr.author,
      prCreatedAt: pr.createdAt,
      linkedIssue: facts.linkedIssue,
      owner: pr.owner,
      repo: pr.repo,
      phrases: config.claimPhrases,
      maintainerAssociations: config.maintainerAssociations,
      expiryDays: config.claimExpiryDays,
      requiresAck: config.claimRequiresAck,
      requireClaim: config.requireClaim,
      severity: s.claim,
    }),
    checkPrBurst({
      author: pr.author,
      recentPrCount: facts.recentPrCount,
      threshold: config.burstThreshold,
      allowlist: config.burstAllowlist,
      severity: s['pr-burst'],
    }),
    checkTemplate({ body: pr.body, template: facts.template, severity: s.template }),
    checkAccount({
      author: pr.author,
      now: facts.now,
      account: facts.account,
      minAgeDays: config.accountMinAgeDays,
      severity: s.account,
    }),
    checkDiffScope({
      authorAssociation: pr.authorAssociation,
      additions: pr.additions,
      deletions: pr.deletions,
      owner: pr.owner,
      repo: pr.repo,
      linkedIssue: facts.linkedIssue,
      files: facts.files,
      pathMap: config.diffScopePaths,
      largeDiffLines: config.largeDiffLines,
      severity: s['diff-scope'],
    }),
  ];
  return results.filter((r): r is CheckResult => r !== null);
}

export function evaluate(facts: Facts, config: Config): Evaluation {
  const results = runChecks(facts, config);
  const flagged = results.filter((r) => r.status === 'flag');

  let outcome: Outcome = 'pass';
  for (const r of flagged) if (RANK[r.severity] > RANK[outcome]) outcome = r.severity;

  // Notes are for maintainers' eyes in the step summary, not labels or comments.
  const labelled = flagged.filter((r) => r.severity !== 'note' && r.labelKey);
  const wanted = new Set(labelled.map((r) => config.labels[r.labelKey as string]).filter(Boolean));
  const managed = new Set(Object.values(config.labels));
  const labelsToAdd = config.addLabels ? [...wanted] : [];
  const labelsToRemove = config.addLabels ? [...managed].filter((l) => !wanted.has(l)) : [];

  return {
    results,
    flagged,
    outcome,
    labelsToAdd,
    labelsToRemove,
    shouldClose: config.closeOnFail && outcome === 'fail',
  };
}
