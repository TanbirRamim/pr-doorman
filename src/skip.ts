import type { Config } from './config';
import type { PullRequestFacts } from './types';

/** Returns why this PR's author is exempt, or null if the checks should run. */
export function skipReason(pr: PullRequestFacts, config: Config): string | null {
  const login = pr.author.toLowerCase();
  if (pr.authorType === 'Bot' || login.endsWith('[bot]')) return `@${pr.author} is a bot.`;
  if (config.allowlist.includes(login)) return `@${pr.author} is on the allowlist.`;
  if (config.skipAssociations.includes(pr.authorAssociation.toUpperCase())) {
    return `@${pr.author} is a ${pr.authorAssociation.toLowerCase()} of this repo.`;
  }
  return null;
}
