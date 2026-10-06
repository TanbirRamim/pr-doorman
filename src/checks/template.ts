import type { CheckResult, Fetched, Severity } from '../types';

const CHECKBOX_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/gm;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;

export interface Checkbox {
  checked: boolean;
  text: string;
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function parseCheckboxes(markdown: string): Checkbox[] {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, '');
  return [...text.matchAll(CHECKBOX_RE)].map((m) => ({ checked: m[1] !== ' ', text: norm(m[2]) }));
}

function headings(markdown: string): string[] {
  return [...markdown.replace(/<!--[\s\S]*?-->/g, '').matchAll(HEADING_RE)].map((m) => norm(m[1]));
}

export interface TemplateInput {
  body: string;
  template: Fetched<string | null> | undefined;
  severity: Severity;
}

export function checkTemplate(input: TemplateInput): CheckResult | null {
  if (input.severity === 'off' || input.template === undefined) return null;
  const base = { id: 'template' as const, severity: input.severity, title: 'Pull request template' };

  if (!input.template.ok) {
    return { ...base, status: 'skip', detail: `Couldn't read the PR template (${input.template.reason}).` };
  }
  const template = input.template.value;
  if (template === null) return { ...base, status: 'skip', detail: 'This repo has no PR template.' };

  const boxes = parseCheckboxes(template);
  if (boxes.length === 0) {
    return { ...base, status: 'skip', detail: 'The PR template has no checkboxes.' };
  }

  const bodyBoxes = parseCheckboxes(input.body);
  const bodyBoxTexts = new Set(bodyBoxes.map((b) => b.text));
  const kept = boxes.filter((b) => bodyBoxTexts.has(b.text));
  const templateHeadings = headings(template);
  const bodyHeadings = new Set(headings(input.body));
  const keptHeadings = templateHeadings.filter((h) => bodyHeadings.has(h));

  // Treat the template as removed when most of its checkboxes are gone and
  // none of its headings survived. Rewording one or two items is fine.
  const removed = kept.length * 2 < boxes.length && (templateHeadings.length === 0 || keptHeadings.length === 0);
  if (removed) {
    return {
      ...base,
      status: 'flag',
      title: 'PR template was removed',
      detail: "The description doesn't follow this repo's pull request template.",
      fix: 'Please edit the description and paste the template back in, then fill it out. You can find it in the repo under `.github/`.',
      labelKey: 'template-missing',
    };
  }

  const ticked = kept.filter((b) => bodyBoxes.some((x) => x.text === b.text && x.checked));
  if (ticked.length === 0) {
    return {
      ...base,
      status: 'flag',
      title: 'Template checklist is empty',
      detail: 'None of the checklist items in the description are ticked.',
      fix: 'Go through the checklist and tick the items that apply (change `[ ]` to `[x]`).',
      labelKey: 'template-unchecked',
    };
  }

  return { ...base, status: 'pass', detail: `${ticked.length} of ${boxes.length} checklist items ticked.` };
}
