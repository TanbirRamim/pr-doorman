import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_LABELS, parsePathMap } from '../src/config';
import { config } from './helpers';

describe('parseConfig', () => {
  it('has useful defaults with no inputs', () => {
    const c = config();
    expect(c.severity).toEqual({
      'linked-issue': 'warn',
      claim: 'warn',
      'pr-burst': 'warn',
      template: 'warn',
      account: 'note',
      'diff-scope': 'note',
    });
    expect(c.claimExpiryDays).toBe(7);
    expect(c.burstThreshold).toBe(10);
    expect(c.closeOnFail).toBe(false);
    expect(c.dryRun).toBe(false);
    expect(c.skipAssociations).toEqual(['OWNER', 'MEMBER', 'COLLABORATOR']);
    expect(c.labels).toEqual(DEFAULT_LABELS);
  });

  it('parses severities, including off', () => {
    const c = config({ 'linked-issue': 'FAIL', account: 'off', template: 'false' });
    expect(c.severity['linked-issue']).toBe('fail');
    expect(c.severity.account).toBe('off');
    expect(c.severity.template).toBe('off');
  });

  it('rejects bad values with a clear message', () => {
    expect(() => config({ claim: 'loud' })).toThrow(ConfigError);
    expect(() => config({ 'claim-expiry-days': '-1' })).toThrow(/whole number/);
    expect(() => config({ 'dry-run': 'maybe' })).toThrow(/true or false/);
    expect(() => config({ 'claim-phrases': '(unclosed' })).toThrow(/invalid regex/);
    expect(() => config({ labels: 'nope: x' })).toThrow(/unknown key/);
  });

  it('lowercases allowlists and accepts commas or newlines', () => {
    expect(config({ allowlist: 'Alice, bob\n# comment\ncarol' }).allowlist).toEqual(['alice', 'bob', 'carol']);
  });

  it('adds custom claim phrases to the defaults, or replaces them', () => {
    const added = config({ 'claim-phrases': String.raw`\bdibs\b` });
    expect(added.claimPhrases.some((r) => r.test('dibs!'))).toBe(true);
    expect(added.claimPhrases.length).toBeGreaterThan(1);
    const replaced = config({ 'claim-phrases': String.raw`\bdibs{1,3}\b`, 'claim-phrases-replace': 'true' });
    expect(replaced.claimPhrases).toHaveLength(1);
  });

  it('overrides individual label names', () => {
    expect(config({ labels: 'needs-issue: needs issue' }).labels['needs-issue']).toBe('needs issue');
  });
});

describe('parsePathMap', () => {
  it('parses label: glob lines and merges duplicates', () => {
    expect(parsePathMap('area: cli: src/cli/**, test/cli/**\ndocs: docs/**\n\ndocs: README.md')).toEqual({
      'area: cli': ['src/cli/**', 'test/cli/**'],
      docs: ['docs/**', 'README.md'],
    });
  });

  it('rejects lines without a colon', () => {
    expect(() => parsePathMap('src/**')).toThrow(ConfigError);
  });
});
