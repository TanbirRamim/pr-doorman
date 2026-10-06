import type { AccountFacts, CheckResult, Fetched, Severity } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountInput {
  author: string;
  now: string;
  account: Fetched<AccountFacts> | undefined;
  minAgeDays: number;
  severity: Severity;
}

export function checkAccount(input: AccountInput): CheckResult | null {
  if (input.severity === 'off' || input.account === undefined) return null;
  const base = { id: 'account' as const, severity: input.severity, title: 'Account history' };

  if (!input.account.ok) {
    return { ...base, status: 'skip', detail: `Couldn't read account details (${input.account.reason}).` };
  }
  const { createdAt, mergedPrs } = input.account.value;
  const ageDays = Math.floor((Date.parse(input.now) - Date.parse(createdAt)) / DAY_MS);
  const days = ageDays === 1 ? 'day' : 'days';

  if (ageDays < input.minAgeDays && mergedPrs === 0) {
    return {
      ...base,
      status: 'flag',
      title: 'New account',
      detail: `@${input.author}'s account is ${ageDays} ${days} old and has no merged pull requests on GitHub yet.`,
      fix: "That's fine on its own, everyone starts somewhere. It just tells maintainers this may be a first contribution.",
      labelKey: 'new-account',
    };
  }
  return {
    ...base,
    status: 'pass',
    detail: `Account is ${ageDays} ${days} old with ${mergedPrs} merged pull request${mergedPrs === 1 ? '' : 's'}.`,
  };
}
