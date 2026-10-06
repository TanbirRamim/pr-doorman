import * as core from '@actions/core';
import * as github from '@actions/github';
import { ConfigError, parseConfig, type Config } from './config';
import { evaluate, type Evaluation } from './evaluate';
import { gatherFacts, type Octokit } from './github';
import { MARKER, renderComment, renderSummary } from './render';
import { skipReason } from './skip';
import type { PullRequestFacts } from './types';

interface PullRequestPayload {
  number: number;
  body?: string | null;
  user: { login: string; type: string };
  author_association: string;
  created_at: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  labels?: { name: string }[];
  base: { ref: string };
}

export function toPullRequestFacts(pr: PullRequestPayload, owner: string, repo: string): PullRequestFacts {
  return {
    number: pr.number,
    body: pr.body ?? '',
    author: pr.user.login,
    authorAssociation: pr.author_association,
    authorType: pr.user.type,
    createdAt: pr.created_at,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changed_files ?? 0,
    owner,
    repo,
  };
}

async function upsertComment(
  octokit: Octokit,
  pr: PullRequestFacts,
  body: string,
  createIfMissing: boolean,
): Promise<void> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const existing = comments.find((c) => c.body?.includes(MARKER));
  if (existing) {
    if (existing.body === body) return;
    await octokit.rest.issues.updateComment({ owner: pr.owner, repo: pr.repo, comment_id: existing.id, body });
  } else if (createIfMissing) {
    await octokit.rest.issues.createComment({ owner: pr.owner, repo: pr.repo, issue_number: pr.number, body });
  }
}

async function syncLabels(octokit: Octokit, pr: PullRequestFacts, ev: Evaluation): Promise<void> {
  const { data: current } = await octokit.rest.issues.listLabelsOnIssue({
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const have = new Set(current.map((l) => l.name));
  const add = ev.labelsToAdd.filter((l) => !have.has(l));
  if (add.length) {
    await octokit.rest.issues.addLabels({ owner: pr.owner, repo: pr.repo, issue_number: pr.number, labels: add });
  }
  for (const name of ev.labelsToRemove.filter((l) => have.has(l))) {
    try {
      await octokit.rest.issues.removeLabel({ owner: pr.owner, repo: pr.repo, issue_number: pr.number, name });
    } catch (err) {
      core.warning(`Couldn't remove label "${name}": ${String(err)}`);
    }
  }
}

function setOutputs(result: string, ev?: Evaluation): void {
  core.setOutput('result', result);
  core.setOutput(
    'failed-checks',
    ev
      ? ev.flagged
          .filter((r) => r.severity === 'fail')
          .map((r) => r.id)
          .join(',')
      : '',
  );
  core.setOutput('flagged-checks', ev ? ev.flagged.map((r) => r.id).join(',') : '');
  core.setOutput('labels', ev ? ev.labelsToAdd.join(',') : '');
}

export async function run(): Promise<void> {
  try {
    const config: Config = parseConfig((name) => core.getInput(name));
    const { context } = github;
    const payloadPr = context.payload.pull_request as PullRequestPayload | undefined;
    if (!payloadPr) {
      core.warning(`pr-doorman only works on pull_request_target or pull_request events, not "${context.eventName}".`);
      setOutputs('skipped');
      return;
    }

    const pr = toPullRequestFacts(payloadPr, context.repo.owner, context.repo.repo);
    const skip = skipReason(pr, config);
    if (skip) {
      core.info(`Skipping: ${skip}`);
      setOutputs('skipped');
      await core.summary
        .addRaw(renderSummary(evaluateEmpty(), { author: pr.author, skippedReason: skip, dryRun: config.dryRun }))
        .write();
      return;
    }

    const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
    const facts = await gatherFacts(octokit, pr, payloadPr.base.ref, config, new Date());
    const ev = evaluate(facts, config);

    for (const r of ev.results) core.info(`${r.id}: ${r.status} (${r.severity}) ${r.detail}`);
    core.info(`Result: ${ev.outcome}`);

    const willClose = ev.shouldClose && !config.dryRun;
    const body = renderComment(ev, { author: pr.author, closed: willClose, dryRun: config.dryRun });
    const hasVisible = ev.flagged.some((r) => r.severity !== 'note');

    if (config.dryRun) {
      core.info('Dry run: not commenting, labelling or closing. The comment would be:');
      core.info(body);
    } else {
      if (config.comment) await upsertComment(octokit, pr, body, hasVisible || config.commentOnPass);
      if (config.addLabels) await syncLabels(octokit, pr, ev);
      if (willClose) {
        await octokit.rest.pulls.update({ owner: pr.owner, repo: pr.repo, pull_number: pr.number, state: 'closed' });
        core.info('Closed the pull request because a fail-level check was flagged.');
      }
    }

    setOutputs(ev.outcome, ev);
    await core.summary.addRaw(renderSummary(ev, { author: pr.author, dryRun: config.dryRun })).write();

    if (config.failJob && ev.outcome === 'fail') {
      const failed = ev.flagged.filter((r) => r.severity === 'fail').map((r) => r.id);
      core.setFailed(`Required checks flagged: ${failed.join(', ')}`);
    }
  } catch (err) {
    if (err instanceof ConfigError) core.setFailed(`Configuration error: ${err.message}`);
    else core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

function evaluateEmpty(): Evaluation {
  return { results: [], flagged: [], outcome: 'pass', labelsToAdd: [], labelsToRemove: [], shouldClose: false };
}
