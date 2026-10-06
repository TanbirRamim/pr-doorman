import type { getOctokit } from '@actions/github';
import { allClosingRefs } from './checks/linked-issue';
import type { Config } from './config';
import type { AccountFacts, Facts, Fetched, IssueRef, LinkedIssue, PullRequestFacts } from './types';

export type Octokit = ReturnType<typeof getOctokit>;

const TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
];

const MAX_COMMENT_PAGES = 10;
const MAX_FILE_PAGES = 30;

function status(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : undefined;
}

export function describeError(err: unknown): string {
  const code = status(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 429 || (code === 403 && /rate limit/i.test(msg))) return 'GitHub API rate limit reached';
  if (code === 404) return 'not found or no access';
  return code ? `HTTP ${code}: ${msg}` : msg;
}

async function fetched<T>(fn: () => Promise<T>): Promise<Fetched<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

interface ClosingRefsResponse {
  repository: {
    pullRequest: {
      closingIssuesReferences: { nodes: { number: number; repository: { name: string; owner: { login: string } } }[] };
    } | null;
  } | null;
}

export async function getClosingRefs(octokit: Octokit, pr: PullRequestFacts): Promise<IssueRef[]> {
  try {
    const res = await octokit.graphql<ClosingRefsResponse>(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            closingIssuesReferences(first: 10) {
              nodes { number repository { name owner { login } } }
            }
          }
        }
      }`,
      { owner: pr.owner, repo: pr.repo, number: pr.number },
    );
    const nodes = res.repository?.pullRequest?.closingIssuesReferences.nodes ?? [];
    return nodes.map((n) => ({ owner: n.repository.owner.login, repo: n.repository.name, number: n.number }));
  } catch {
    // Body parsing still works without GraphQL, so this is not fatal.
    return [];
  }
}

export async function getLinkedIssue(octokit: Octokit, ref: IssueRef): Promise<LinkedIssue | null> {
  const { data: issue } = await octokit.rest.issues.get({ owner: ref.owner, repo: ref.repo, issue_number: ref.number });
  if (issue.pull_request) return null; // "Closes #N" pointing at another PR

  let pages = 0;
  const comments = await octokit.paginate(
    octokit.rest.issues.listComments,
    { owner: ref.owner, repo: ref.repo, issue_number: ref.number, per_page: 100 },
    (response, done) => {
      if (++pages >= MAX_COMMENT_PAGES) done();
      return response.data;
    },
  );

  return {
    ref,
    state: issue.state === 'closed' ? 'closed' : 'open',
    author: issue.user?.login ?? '',
    assignees: (issue.assignees ?? []).map((a) => a.login),
    labels: issue.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
    comments: comments.map((c) => ({
      author: c.user?.login ?? '',
      association: c.author_association,
      body: c.body ?? '',
      createdAt: c.created_at,
    })),
  };
}

async function searchCount(octokit: Octokit, q: string): Promise<number> {
  const { data } = await octokit.request('GET /search/issues', { q, per_page: 1 });
  return data.total_count;
}

export async function getRecentPrCount(octokit: Octokit, author: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  return searchCount(octokit, `type:pr author:${author} created:>=${since}`);
}

export async function getAccount(octokit: Octokit, author: string): Promise<AccountFacts> {
  const { data } = await octokit.rest.users.getByUsername({ username: author });
  const mergedPrs = await searchCount(octokit, `type:pr author:${author} is:merged`);
  return { createdAt: data.created_at, mergedPrs };
}

export async function getTemplate(
  octokit: Octokit,
  pr: PullRequestFacts,
  ref: string,
  path: string,
): Promise<string | null> {
  const paths = path ? [path] : TEMPLATE_PATHS;
  for (const p of paths) {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner: pr.owner, repo: pr.repo, path: p, ref });
      if (!Array.isArray(data) && data.type === 'file' && 'content' in data) {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
    } catch (err) {
      if (status(err) !== 404) throw err;
    }
  }
  return null;
}

export async function getFiles(octokit: Octokit, pr: PullRequestFacts): Promise<string[]> {
  let pages = 0;
  const files = await octokit.paginate(
    octokit.rest.pulls.listFiles,
    { owner: pr.owner, repo: pr.repo, pull_number: pr.number, per_page: 100 },
    (response, done) => {
      if (++pages >= MAX_FILE_PAGES) done();
      return response.data;
    },
  );
  return files.map((f) => f.filename);
}

/** Collects only the data the enabled checks need. */
export async function gatherFacts(
  octokit: Octokit,
  pr: PullRequestFacts,
  baseRef: string,
  config: Config,
  now: Date,
): Promise<Facts> {
  const on = (id: keyof Config['severity']): boolean => config.severity[id] !== 'off';
  const facts: Facts = { now: now.toISOString(), pr, closingRefs: [] };

  if (on('linked-issue') || on('claim') || on('diff-scope')) {
    facts.closingRefs = await getClosingRefs(octokit, pr);
  }

  const needsIssue = on('claim') || (on('diff-scope') && Object.keys(config.diffScopePaths).length > 0);
  if (needsIssue) {
    const [first] = allClosingRefs({ body: pr.body, owner: pr.owner, repo: pr.repo, closingRefs: facts.closingRefs });
    facts.linkedIssue = first ? await fetched(() => getLinkedIssue(octokit, first)) : { ok: true, value: null };
  }

  if (on('diff-scope') && Object.keys(config.diffScopePaths).length > 0) {
    facts.files = await fetched(() => getFiles(octokit, pr));
  }
  if (on('pr-burst')) facts.recentPrCount = await fetched(() => getRecentPrCount(octokit, pr.author, now));
  if (on('template')) facts.template = await fetched(() => getTemplate(octokit, pr, baseRef, config.templatePath));
  if (on('account')) facts.account = await fetched(() => getAccount(octokit, pr.author));

  return facts;
}
