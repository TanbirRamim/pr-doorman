import { matchesAny } from '../glob';
import type { CheckResult, Fetched, LinkedIssue, Severity } from '../types';
import { formatRef } from './linked-issue';

const NEWCOMER = new Set(['FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE']);

export interface DiffScopeInput {
  authorAssociation: string;
  additions: number;
  deletions: number;
  owner: string;
  repo: string;
  linkedIssue: Fetched<LinkedIssue | null> | undefined;
  files: Fetched<string[]> | undefined;
  pathMap: Record<string, string[]>;
  largeDiffLines: number;
  severity: Severity;
}

export function checkDiffScope(input: DiffScopeInput): CheckResult | null {
  if (input.severity === 'off') return null;
  const base = { id: 'diff-scope' as const, severity: input.severity, title: 'Diff scope' };
  const notes: string[] = [];

  // 1. Files outside the paths mapped to the linked issue's labels.
  const issue = input.linkedIssue?.ok ? input.linkedIssue.value : null;
  if (issue && input.files) {
    const allowed = issue.labels.flatMap((l) => input.pathMap[l.toLowerCase()] ?? []);
    if (allowed.length > 0) {
      if (!input.files.ok) {
        notes.push(`couldn't list changed files (${input.files.reason})`);
      } else {
        const outside = input.files.value.filter((f) => !matchesAny(f, allowed));
        if (outside.length > 0) {
          const shown = outside
            .slice(0, 5)
            .map((f) => `\`${f}\``)
            .join(', ');
          const more = outside.length > 5 ? ` and ${outside.length - 5} more` : '';
          const ref = formatRef(issue.ref, input.owner, input.repo);
          return {
            ...base,
            status: 'flag',
            title: 'Changes reach outside the issue',
            detail: `Based on the labels on ${ref}, this change is expected to touch \`${allowed.join('`, `')}\`. It also changes ${shown}${more}.`,
            fix: 'If those extra changes are needed, explain why in the description. Otherwise please move them to a separate pull request.',
            labelKey: 'out-of-scope',
          };
        }
      }
    }
  }

  // 2. Very large diffs from people who haven't contributed here before.
  const lines = input.additions + input.deletions;
  if (NEWCOMER.has(input.authorAssociation.toUpperCase()) && lines > input.largeDiffLines) {
    return {
      ...base,
      status: 'flag',
      title: 'Large first contribution',
      detail: `This pull request changes ${lines} lines, and it looks like your first contribution here.`,
      fix: 'Big changes are hard to review from someone new to the project. Consider splitting it up, or check on the issue that maintainers want a change of this size.',
      labelKey: 'large-diff',
    };
  }

  const detail = notes.length ? `Skipped part of the check: ${notes.join('; ')}.` : `${lines} lines changed.`;
  return { ...base, status: 'pass', detail };
}
