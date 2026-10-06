import type { CheckResult, Fetched, Severity } from '../types';

export interface PrBurstInput {
  author: string;
  recentPrCount: Fetched<number> | undefined;
  threshold: number;
  allowlist: string[];
  severity: Severity;
}

export function checkPrBurst(input: PrBurstInput): CheckResult | null {
  if (input.severity === 'off' || input.recentPrCount === undefined) return null;
  const base = { id: 'pr-burst' as const, severity: input.severity, title: 'Recent pull requests' };

  if (input.allowlist.includes(input.author.toLowerCase())) {
    return { ...base, status: 'skip', detail: `@${input.author} is on the pr-burst allowlist.` };
  }
  if (!input.recentPrCount.ok) {
    return { ...base, status: 'skip', detail: `Couldn't count recent pull requests (${input.recentPrCount.reason}).` };
  }

  const count = input.recentPrCount.value;
  const plural = count === 1 ? 'pull request' : 'pull requests';
  if (count > input.threshold) {
    return {
      ...base,
      status: 'flag',
      title: 'Lots of pull requests in a short time',
      detail: `@${input.author} opened ${count} ${plural} across GitHub in the last 24 hours. The limit set for this repo is ${input.threshold}.`,
      fix: 'Nothing to change in this PR. A maintainer will take a closer look before reviewing. Fewer, well-tested pull requests usually get merged faster.',
      labelKey: 'pr-burst',
    };
  }
  return { ...base, status: 'pass', detail: `${count} ${plural} opened in the last 24 hours.` };
}
