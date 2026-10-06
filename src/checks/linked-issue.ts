import type { CheckResult, IssueRef, Severity } from '../types';

const KEYWORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';

// "Closes #12", "fixes owner/repo#12", "Resolves: https://github.com/owner/repo/issues/12"
const CLOSING_RE = new RegExp(
  String.raw`\b(?:${KEYWORDS})\b:?\s+(?:` +
    String.raw`([\w.-]+)/([\w.-]+)#(\d+)` +
    String.raw`|#(\d+)` +
    String.raw`|https?://github\.com/([\w.-]+)/([\w.-]+)/issues/(\d+)` +
    ')',
  'gi',
);

const BARE_REF_RE = /(?:^|[\s(])#(\d+)\b/;

/** Removes fenced code, inline code and HTML comments so examples don't count as links. */
export function stripNonProse(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

export function parseClosingRefs(body: string, owner: string, repo: string): IssueRef[] {
  const text = stripNonProse(body);
  const refs: IssueRef[] = [];
  for (const m of text.matchAll(CLOSING_RE)) {
    if (m[3]) refs.push({ owner: m[1], repo: m[2], number: Number(m[3]) });
    else if (m[4]) refs.push({ owner, repo, number: Number(m[4]) });
    else if (m[7]) refs.push({ owner: m[5], repo: m[6], number: Number(m[7]) });
  }
  return dedupeRefs(refs);
}

export function dedupeRefs(refs: IssueRef[]): IssueRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.owner.toLowerCase()}/${r.repo.toLowerCase()}#${r.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatRef(ref: IssueRef, owner: string, repo: string): string {
  const same = ref.owner.toLowerCase() === owner.toLowerCase() && ref.repo.toLowerCase() === repo.toLowerCase();
  return same ? `#${ref.number}` : `${ref.owner}/${ref.repo}#${ref.number}`;
}

export interface LinkedIssueInput {
  body: string;
  owner: string;
  repo: string;
  /** Refs reported by GitHub, includes issues linked from the sidebar. */
  closingRefs: IssueRef[];
  severity: Severity;
}

/** All refs this PR closes, GitHub's view first, then anything parsed from the body. */
export function allClosingRefs(input: Pick<LinkedIssueInput, 'body' | 'owner' | 'repo' | 'closingRefs'>): IssueRef[] {
  return dedupeRefs([...input.closingRefs, ...parseClosingRefs(input.body, input.owner, input.repo)]);
}

export function checkLinkedIssue(input: LinkedIssueInput): CheckResult | null {
  if (input.severity === 'off') return null;
  const base = { id: 'linked-issue' as const, severity: input.severity, title: 'Linked issue' };
  const refs = allClosingRefs(input);

  if (refs.length > 0) {
    const shown = refs.map((r) => formatRef(r, input.owner, input.repo)).join(', ');
    return { ...base, status: 'pass', detail: `Closes ${shown}.` };
  }

  const bare = BARE_REF_RE.exec(stripNonProse(input.body));
  const fix = bare
    ? `It mentions #${bare[1]} but doesn't say it closes it. If it does, change that to \`Closes #${bare[1]}\` so GitHub links them.`
    : 'Add a line like `Closes #123` to the description. If there is no issue yet, please open one first so the change can be discussed before you spend time on it.';

  return {
    ...base,
    status: 'flag',
    title: 'Needs a linked issue',
    detail: "This pull request doesn't say which issue it fixes.",
    fix,
    labelKey: 'needs-issue',
  };
}
