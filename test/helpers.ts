import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig, type Config } from '../src/config';
import type { Facts, LinkedIssue, PullRequestFacts } from '../src/types';

export function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

export function json<T>(name: string): T {
  return JSON.parse(fixture(name)) as T;
}

export function config(inputs: Record<string, string> = {}): Config {
  return parseConfig((name) => inputs[name] ?? '');
}

export function issue(overrides: Partial<LinkedIssue> = {}): LinkedIssue {
  return { ...json<LinkedIssue>('issue-17.json'), ...overrides };
}

export function prFacts(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    number: 42,
    body: 'Closes #17',
    author: 'new-contributor',
    authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
    authorType: 'User',
    createdAt: '2026-10-01T12:00:00Z',
    additions: 24,
    deletions: 3,
    changedFiles: 2,
    owner: 'acme',
    repo: 'widget',
    ...overrides,
  };
}

export function facts(overrides: Partial<Facts> = {}): Facts {
  return { now: '2026-10-01T12:05:00Z', pr: prFacts(), closingRefs: [], ...overrides };
}
