import type { Section } from './extract.js';

export interface RankedSection extends Section {
  /** Original position in the document (stable id component). */
  index: number;
  score: number;
  /** Section holds the focus phrase verbatim — must survive budget trimming. */
  hasErrorMatch: boolean;
}

const ERROR_SIGNALS = /\b(error|exception|traceback|stack\s*trace|failed|failure|cannot|unexpected|undefined|null|panic|fatal|deprecated)\b/gi;

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
 */
export function rankSections(sections: Section[], focus?: string): RankedSection[] {
  const f = (focus ?? '').trim();
  const ts = f ? terms(f) : [];
  const exact = f.toLowerCase();

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

    const score = termScore * 2 + density + (hasErrorMatch ? 50 : 0);
    return { ...s, index, score, hasErrorMatch };
  });

  return ranked.sort((a, b) => (b.score - a.score) || (a.index - b.index));
}
