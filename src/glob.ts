/**
 * Small glob matcher for repo paths. Supports `**`, `*`, `?` and `{a,b}`.
 * A pattern ending in `/` matches everything under that directory.
 */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/^\.\//, '').replace(/^\//, '');
  if (p.endsWith('/')) p += '**';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const slash = p[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      const end = p.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
      } else {
        const alts = p
          .slice(i + 1, end)
          .split(',')
          .map((a) => a.replace(/[.+^$()|[\]\\]/g, '\\$&'));
        re += `(?:${alts.join('|')})`;
        i = end;
      }
    } else {
      re += ch.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}
