import type { Section } from './extract.js';

export interface RankedSection extends Section {
  /** Original position in the document (stable id component). */
  index: number;
  score: number;
  /** Section holds the focus phrase verbatim — must survive budget trimming. */
  hasErrorMatch: boolean;
}

const ERROR_SIGNALS = /\b(error|exception|traceback|stack\s*trace|failed|failure|cannot|unexpected|undefined|null|panic|fatal|deprecated)\b/gi;

const CVE_RE = /CVE-\d{4}-\d+/i;
const ADVISORY_TERMS = /\b(security advisory|vulnerability|exploit|affected versions?|fixed in|patch|remediation|cvss)\b/i;

function terms(focus: string): string[] {
  return Array.from(
    new Set(
      focus
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter(t => t.length >= 2),
    ),
  );
}

function countMatches(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * Score sections for relevance. With a focus string, term overlap dominates
 * (heading hits weighted higher); error/code density always contributes so a
 * stack trace ranks up even on a vague query. Document order breaks ties.
 *
 * When the focus matches CVE or advisory patterns, sections with code blocks,
 * version ranges, and CVSS vectors get bonus scoring.
 */
export function rankSections(sections: Section[], focus?: string): RankedSection[] {
  const f = (focus ?? '').trim();
  const ts = f ? terms(f) : [];
  const exact = f.toLowerCase();
  const isCveQuery = CVE_RE.test(f) || ADVISORY_TERMS.test(f);

  const ranked = sections.map((s, index): RankedSection => {
    const bodyLc = s.text.toLowerCase();
    const headLc = s.heading.toLowerCase();

    let termScore = 0;
    for (const t of ts) {
      termScore += countMatches(bodyLc, t);
      if (headLc.includes(t)) termScore += 3;
    }

    const errSignals = (s.text.match(ERROR_SIGNALS) ?? []).length;
    const density = Math.min(errSignals, 10) + (s.hasCode ? 4 : 0);

    // Verbatim phrase match (3+ chars) is the protection trigger.
    const hasErrorMatch = exact.length >= 3 && bodyLc.includes(exact);

    let huntBonus = 0;
    if (isCveQuery) {
      if (s.hasCode) huntBonus += 2;
      if (/affected\s+versions?|fixed\s+in/i.test(s.text)) huntBonus += 3;
      if (/CVSS/i.test(s.text)) huntBonus += 2;
    }

    const score = termScore * 2 + density + (hasErrorMatch ? 50 : 0) + huntBonus;
    return { ...s, index, score, hasErrorMatch };
  });

  return ranked.sort((a, b) => (b.score - a.score) || (a.index - b.index));
}
