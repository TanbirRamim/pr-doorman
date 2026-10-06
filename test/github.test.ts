import { describe, expect, it, vi } from 'vitest';
import { describeError, gatherFacts, getTemplate, type Octokit } from '../src/github';
import { toPullRequestFacts } from '../src/main';
import { config, fixture, json, prFacts } from './helpers';

function httpError(status: number, message = 'error'): Error {
  return Object.assign(new Error(message), { status });
}

function fakeOctokit(overrides: Record<string, unknown> = {}) {
  const listComments = vi.fn();
  const listFiles = vi.fn();
  const rest = {
    issues: {
      get: vi.fn().mockResolvedValue({
        data: { state: 'open', user: { login: 'reporter' }, assignees: [], labels: ['bug', { name: 'area: cli' }] },
      }),
      listComments,
    },
    pulls: { listFiles },
    users: { getByUsername: vi.fn().mockResolvedValue({ data: { created_at: '2026-09-29T00:00:00Z' } }) },
    repos: {
      getContent: vi.fn().mockImplementation(({ path }: { path: string }) =>
        path === '.github/PULL_REQUEST_TEMPLATE.md'
          ? Promise.resolve({
              data: { type: 'file', content: Buffer.from(fixture('pull_request_template.md')).toString('base64') },
            })
          : Promise.reject(httpError(404)),
      ),
    },
  };
  const paginate = vi.fn().mockImplementation((fn: unknown) => {
    if (fn === listComments) {
      return Promise.resolve([
        {
          user: { login: 'early-bird' },
          author_association: 'NONE',
          body: 'can I take this?',
          created_at: '2026-09-30T00:00:00Z',
        },
      ]);
    }
    if (fn === listFiles) return Promise.resolve([{ filename: 'src/cli/main.ts' }]);
    return Promise.resolve([]);
  });
  const request = vi
    .fn()
    .mockImplementation((_route: string, { q }: { q: string }) =>
      Promise.resolve({ data: { total_count: q.includes('is:merged') ? 0 : 3 } }),
    );
  const graphql = vi.fn().mockResolvedValue({
    repository: {
      pullRequest: {
        closingIssuesReferences: { nodes: [{ number: 17, repository: { name: 'widget', owner: { login: 'acme' } } }] },
      },
    },
  });
  return { octokit: { rest, paginate, request, graphql, ...overrides } as unknown as Octokit, rest, request };
}

describe('gatherFacts', () => {
  it('collects everything the default checks need', async () => {
    const { octokit, request } = fakeOctokit();
    const f = await gatherFacts(
      octokit,
      prFacts({ body: 'no keyword' }),
      'main',
      config(),
      new Date('2026-10-01T12:00:00Z'),
    );

    expect(f.closingRefs).toEqual([{ owner: 'acme', repo: 'widget', number: 17 }]);
    expect(f.linkedIssue).toMatchObject({ ok: true, value: { labels: ['bug', 'area: cli'], assignees: [] } });
    expect(f.recentPrCount).toEqual({ ok: true, value: 3 });
    expect(f.account).toEqual({ ok: true, value: { createdAt: '2026-09-29T00:00:00Z', mergedPrs: 0 } });
    expect(f.template).toMatchObject({ ok: true });
    expect(f.files).toBeUndefined(); // no diff-scope-paths configured
    expect(request).toHaveBeenCalledWith('GET /search/issues', {
      q: 'type:pr author:new-contributor created:>=2026-09-30T12:00:00Z',
      per_page: 1,
    });
  });

  it('skips API calls for checks that are off', async () => {
    const { octokit, rest, request } = fakeOctokit();
    const off = { claim: 'off', 'pr-burst': 'off', template: 'off', account: 'off', 'diff-scope': 'off' };
    const f = await gatherFacts(octokit, prFacts(), 'main', config(off), new Date());
    expect(f.linkedIssue).toBeUndefined();
    expect(rest.issues.get).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('turns API failures into skip reasons instead of throwing', async () => {
    const { octokit } = fakeOctokit({
      request: vi.fn().mockRejectedValue(httpError(403, 'API rate limit exceeded')),
      graphql: vi.fn().mockRejectedValue(new Error('graphql down')),
    });
    const f = await gatherFacts(octokit, prFacts({ body: 'Closes #17' }), 'main', config(), new Date());
    expect(f.closingRefs).toEqual([]);
    expect(f.linkedIssue?.ok).toBe(true); // body parsing still found #17
    expect(f.recentPrCount).toEqual({ ok: false, reason: 'GitHub API rate limit reached' });
  });

  it('lists files when diff-scope paths are configured', async () => {
    const { octokit } = fakeOctokit();
    const f = await gatherFacts(octokit, prFacts(), 'main', config({ 'diff-scope-paths': 'bug: src/**' }), new Date());
    expect(f.files).toEqual({ ok: true, value: ['src/cli/main.ts'] });
  });

  it('treats a "closes" link to a pull request as no issue', async () => {
    const { octokit, rest } = fakeOctokit();
    rest.issues.get.mockResolvedValueOnce({ data: { pull_request: {}, labels: [] } });
    const f = await gatherFacts(octokit, prFacts(), 'main', config(), new Date());
    expect(f.linkedIssue).toEqual({ ok: true, value: null });
  });
});

describe('getTemplate', () => {
  it('returns null when no template exists', async () => {
    const { octokit, rest } = fakeOctokit();
    rest.repos.getContent.mockRejectedValue(httpError(404));
    expect(await getTemplate(octokit, prFacts(), 'main', '')).toBeNull();
  });

  it('rethrows errors other than 404', async () => {
    const { octokit, rest } = fakeOctokit();
    rest.repos.getContent.mockRejectedValue(httpError(500));
    await expect(getTemplate(octokit, prFacts(), 'main', '')).rejects.toThrow();
  });
});

describe('describeError', () => {
  it('recognises rate limits', () => {
    expect(describeError(httpError(429))).toBe('GitHub API rate limit reached');
    expect(describeError(httpError(403, 'You have exceeded a secondary rate limit'))).toBe(
      'GitHub API rate limit reached',
    );
    expect(describeError(httpError(404))).toBe('not found or no access');
  });
});

describe('toPullRequestFacts', () => {
  it('maps a real-looking event payload', () => {
    const payload = json<{ pull_request: Parameters<typeof toPullRequestFacts>[0] }>('pull_request_target.opened.json');
    expect(toPullRequestFacts(payload.pull_request, 'acme', 'widget')).toMatchObject({
      number: 42,
      author: 'new-contributor',
      authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
      additions: 24,
    });
  });
});
