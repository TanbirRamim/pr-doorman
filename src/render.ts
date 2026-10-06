import type { Evaluation } from './evaluate';
import type { CheckResult } from './types';

export const MARKER = '<!-- pr-doorman:sticky -->';
const DOCS = 'https://github.com/TanbirRamim/pr-doorman#readme';

const STATUS_TEXT: Record<string, string> = {
  pass: 'passed',
  skip: 'skipped',
};

function item(r: CheckResult): string {
  const tag = r.severity === 'fail' ? '**[required]**' : '**[please check]**';
  const lines = [`#### ${r.title} ${tag}`, '', r.detail];
  if (r.fix) lines.push('', r.fix);
  return lines.join('\n');
}

export interface CommentContext {
  author: string;
  closed: boolean;
  dryRun: boolean;
}

/** The sticky comment. Only warn and fail results are shown to the contributor. */
export function renderComment(ev: Evaluation, ctx: CommentContext): string {
  const visible = ev.flagged.filter((r) => r.severity !== 'note');
  const passed = ev.results.filter((r) => r.status === 'pass').map((r) => r.title.toLowerCase());
  const out: string[] = [MARKER];

  if (visible.length === 0) {
    out.push(`Thanks @${ctx.author}, all the automated checks look good. A maintainer will review this when they can.`);
  } else {
    const n = visible.length;
    out.push(
      `Thanks for the pull request, @${ctx.author}. Before a maintainer reviews it, ${n === 1 ? 'one thing needs' : `${n} things need`} a look:`,
      '',
      visible.map(item).join('\n\n'),
    );
    if (ctx.closed) {
      out.push(
        '',
        'This pull request was closed because a required check failed. Once you have fixed it, you can reopen it or open a new one.',
      );
    }
    if (passed.length) out.push('', `Passed: ${passed.join(', ')}.`);
  }

  out.push(
    '',
    `<sub>This comment is from [pr-doorman](${DOCS}), a set of plain rules the maintainers turned on. It doesn't use AI. It updates itself when you edit or push to the pull request.${ctx.dryRun ? ' (dry run: no labels or closing)' : ''}</sub>`,
  );
  return out.join('\n');
}

/** Markdown for the job's step summary. Includes notes and skipped checks. */
export function renderSummary(
  ev: Evaluation,
  ctx: { author: string; skippedReason?: string; dryRun: boolean },
): string {
  const out = ['## pr-doorman', ''];
  if (ctx.skippedReason) {
    out.push(`Skipped: ${ctx.skippedReason}`);
    return out.join('\n');
  }
  out.push(`Result: **${ev.outcome}** for @${ctx.author}${ctx.dryRun ? ' (dry run)' : ''}`, '');
  out.push('| Check | Status | Severity | Details |', '| --- | --- | --- | --- |');
  for (const r of ev.results) {
    const status = r.status === 'flag' ? 'flagged' : STATUS_TEXT[r.status];
    out.push(`| ${r.id} | ${status} | ${r.severity} | ${r.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  }
  if (ev.labelsToAdd.length) out.push('', `Labels: ${ev.labelsToAdd.map((l) => `\`${l}\``).join(', ')}`);
  return out.join('\n');
}
