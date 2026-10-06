import { CHECK_IDS, type CheckId, type Severity } from './types';

export interface Config {
  severity: Record<CheckId, Severity>;
  allowlist: string[];
  skipAssociations: string[];
  maintainerAssociations: string[];

  claimPhrases: RegExp[];
  claimExpiryDays: number;
  claimRequiresAck: boolean;
  requireClaim: boolean;

  burstThreshold: number;
  burstAllowlist: string[];

  templatePath: string;

  accountMinAgeDays: number;

  diffScopePaths: Record<string, string[]>;
  largeDiffLines: number;

  labels: Record<string, string>;
  addLabels: boolean;
  comment: boolean;
  commentOnPass: boolean;
  closeOnFail: boolean;
  failJob: boolean;
  dryRun: boolean;
}

export const DEFAULT_SEVERITY: Record<CheckId, Severity> = {
  'linked-issue': 'warn',
  claim: 'warn',
  'pr-burst': 'warn',
  template: 'warn',
  account: 'note',
  'diff-scope': 'note',
};

/**
 * Phrases people use to ask for an issue. Matched case-insensitively against
 * each comment line, ignoring quoted lines. English only for now.
 */
export const DEFAULT_CLAIM_PHRASES: string[] = [
  String.raw`\b(i'?d|i would) (really )?(like|love|want) to (work on|take|tackle|pick up|handle|fix|try) (this|it)\b`,
  String.raw`\b(can|could|may) i (please )?(work on|take|tackle|pick up|handle|fix|try|grab|be assigned( to)?) (this|it)\b`,
  String.raw`\bassign (this |it )?(issue )?(to )?me\b`,
  String.raw`\bi('ll| will| can| want to) (work on|take|tackle|pick up|handle|grab) (this|it)\b`,
  String.raw`\bi'?m (currently )?(working on|taking|on) (this|it)\b`,
  String.raw`\blet me (work on|take|try|handle|tackle) (this|it)\b`,
  String.raw`\b(i'?ll|i will|i can|let me|can i|could i) pick (this|it) up\b`,
  String.raw`^\s*/(assign|take|claim)\b`,
];

export const DEFAULT_LABELS: Record<string, string> = {
  'needs-issue': 'doorman: needs-issue',
  'claimed-by-other': 'doorman: claimed-by-other',
  'not-claimed': 'doorman: not-claimed',
  'pr-burst': 'doorman: pr-burst',
  'template-missing': 'doorman: template-missing',
  'template-unchecked': 'doorman: template-unchecked',
  'new-account': 'doorman: new-account',
  'out-of-scope': 'doorman: out-of-scope',
  'large-diff': 'doorman: large-diff',
};

type GetInput = (name: string) => string;

const SEVERITIES: Severity[] = ['off', 'note', 'warn', 'fail'];

export class ConfigError extends Error {}

function list(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));
}

function bool(name: string, raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === '') return fallback;
  if (['true', 'yes', '1', 'on'].includes(v)) return true;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  throw new ConfigError(`Input "${name}" must be true or false, got "${raw}".`);
}

function int(name: string, raw: string, fallback: number): number {
  const v = raw.trim();
  if (v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new ConfigError(`Input "${name}" must be a whole number >= 0, got "${raw}".`);
  }
  return n;
}

function severity(name: string, raw: string, fallback: Severity): Severity {
  const v = raw.trim().toLowerCase();
  if (v === '') return fallback;
  if (v === 'false' || v === 'disabled') return 'off';
  if ((SEVERITIES as string[]).includes(v)) return v as Severity;
  throw new ConfigError(`Input "${name}" must be one of off, note, warn, fail. Got "${raw}".`);
}

function regexes(name: string, sources: string[]): RegExp[] {
  return sources.map((src) => {
    try {
      return new RegExp(src, 'im');
    } catch (err) {
      throw new ConfigError(`Input "${name}" has an invalid regex "${src}": ${String(err)}`);
    }
  });
}

/** Parses "label: glob, glob" lines into a map of label -> globs. */
export function parsePathMap(raw: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx <= 0) {
      throw new ConfigError(`Input "diff-scope-paths": expected "label: glob, glob", got "${trimmed}".`);
    }
    const label = trimmed.slice(0, idx).trim().toLowerCase();
    const globs = list(trimmed.slice(idx + 1));
    out[label] = [...(out[label] ?? []), ...globs];
  }
  return out;
}

/** Parses "key: label name" overrides on top of the default label map. */
function parseLabels(raw: string): Record<string, string> {
  const out = { ...DEFAULT_LABELS };
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) throw new ConfigError(`Input "labels": expected "key: label name", got "${trimmed}".`);
    const key = trimmed.slice(0, idx).trim();
    if (!(key in DEFAULT_LABELS)) {
      throw new ConfigError(
        `Input "labels": unknown key "${key}". Known keys: ${Object.keys(DEFAULT_LABELS).join(', ')}.`,
      );
    }
    out[key] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

const lower = (xs: string[]): string[] => xs.map((x) => x.toLowerCase());
const upper = (xs: string[]): string[] => xs.map((x) => x.toUpperCase());

export function parseConfig(getInput: GetInput): Config {
  const sev = {} as Record<CheckId, Severity>;
  for (const id of CHECK_IDS) sev[id] = severity(id, getInput(id), DEFAULT_SEVERITY[id]);

  // Regexes may contain commas, so phrases are split on newlines only.
  const extraPhrases = getInput('claim-phrases')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const replacePhrases = bool('claim-phrases-replace', getInput('claim-phrases-replace'), false);
  const phraseSources = replacePhrases ? extraPhrases : [...DEFAULT_CLAIM_PHRASES, ...extraPhrases];

  const skipRaw = getInput('skip-associations');
  const maintRaw = getInput('maintainer-associations');

  return {
    severity: sev,
    allowlist: lower(list(getInput('allowlist'))),
    // "none" means nobody is skipped by association (NONE is also a real association, so it can't be listed).
    skipAssociations:
      skipRaw.trim().toLowerCase() === 'none'
        ? []
        : skipRaw.trim()
          ? upper(list(skipRaw))
          : ['OWNER', 'MEMBER', 'COLLABORATOR'],
    maintainerAssociations: maintRaw.trim() ? upper(list(maintRaw)) : ['OWNER', 'MEMBER', 'COLLABORATOR'],

    claimPhrases: regexes('claim-phrases', phraseSources),
    claimExpiryDays: int('claim-expiry-days', getInput('claim-expiry-days'), 7),
    claimRequiresAck: bool('claim-requires-ack', getInput('claim-requires-ack'), true),
    requireClaim: bool('require-claim', getInput('require-claim'), false),

    burstThreshold: int('pr-burst-threshold', getInput('pr-burst-threshold'), 10),
    burstAllowlist: lower(list(getInput('pr-burst-allowlist'))),

    templatePath: getInput('template-path').trim(),

    accountMinAgeDays: int('account-min-age-days', getInput('account-min-age-days'), 14),

    diffScopePaths: parsePathMap(getInput('diff-scope-paths')),
    largeDiffLines: int('large-diff-lines', getInput('large-diff-lines'), 1000),

    labels: parseLabels(getInput('labels')),
    addLabels: bool('add-labels', getInput('add-labels'), true),
    comment: bool('comment', getInput('comment'), true),
    commentOnPass: bool('comment-on-pass', getInput('comment-on-pass'), false),
    closeOnFail: bool('close-on-fail', getInput('close-on-fail'), false),
    failJob: bool('fail-job', getInput('fail-job'), true),
    dryRun: bool('dry-run', getInput('dry-run'), false),
  };
}
