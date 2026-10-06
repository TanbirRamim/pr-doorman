import { describe, expect, it } from 'vitest';
import { matchesAny } from '../src/glob';

describe('glob', () => {
  it.each([
    ['src/**', 'src/a/b/c.ts', true],
    ['src/**', 'srcx/a.ts', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'docs/a/b.md', true],
    ['docs/', 'docs/x/y.png', true],
    ['./lib/**', 'lib/x.js', true],
    ['file?.txt', 'file1.txt', true],
    ['*.{js,ts}', 'a.ts', true],
    ['*.{js,ts}', 'a.css', false],
    ['a.b', 'axb', false],
  ])('%s vs %s -> %s', (pattern, path, expected) => {
    expect(matchesAny(path, [pattern])).toBe(expected);
  });
});
