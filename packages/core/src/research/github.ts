import { execFile } from 'node:child_process';
import { safeFetch } from './fetch.js';

export interface GitHubRef {
  owner: string;
  repo: string;
  number: number;
  kind: 'issue' | 'pull';
  url: string;
}

export interface GhsaRef {
  ghsaId: string;
  owner?: string;
  repo?: string;
  url: string;
}

const SEG = '[A-Za-z0-9._-]+';
const URL_RE = new RegExp(`github\\.com/(${SEG})/(${SEG})/(issues|pull)/(\\d+)`, 'i');
const SHORT_RE = new RegExp(`^(${SEG})/(${SEG})#(\\d+)$`);
const GHSA_GLOBAL_RE = /github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})/i;
const GHSA_REPO_RE = new RegExp(`github\\.com/(${SEG})/(${SEG})/security/advisories/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})`, 'i');

/** Parse a GitHub issue/PR URL or `owner/repo#number`; null if not one. */
export function parseGitHubRef(input: string): GitHubRef | null {
  const s = input.trim();
  const m = URL_RE.exec(s);
  if (m) {
    const kind = m[3].toLowerCase() === 'pull' ? 'pull' : 'issue';
    return { owner: m[1], repo: m[2], number: Number(m[4]), kind, url: canonical(m[1], m[2], kind, Number(m[4])) };
  }
  const sm = SHORT_RE.exec(s);
  if (sm) {
    return { owner: sm[1], repo: sm[2], number: Number(sm[3]), kind: 'issue', url: canonical(sm[1], sm[2], 'issue', Number(sm[3])) };
  }
  return null;
}

/** Parse a GHSA advisory URL; null if not one. */
export function parseGhsaRef(input: string): GhsaRef | null {
  const s = input.trim();
  const rm = GHSA_REPO_RE.exec(s);
  if (rm) {
    return { ghsaId: rm[3], owner: rm[1], repo: rm[2], url: `https://github.com/${rm[1]}/${rm[2]}/security/advisories/${rm[3]}` };
  }
  const gm = GHSA_GLOBAL_RE.exec(s);
  if (gm) {
    return { ghsaId: gm[1], url: `https://github.com/advisories/${gm[1]}` };
  }
  return null;
}

function canonical(owner: string, repo: string, kind: 'issue' | 'pull', n: number): string {
  return `https://github.com/${owner}/${repo}/${kind === 'pull' ? 'pull' : 'issues'}/${n}`;
}

/** Runs a `gh` subcommand and resolves its stdout. Injectable for tests. */
export type GhExec = (args: string[]) => Promise<string>;

export const realGhExec: GhExec = (args) =>
  new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 20_000_000, timeout: 15_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });

const KEEP_HEAD = 3;
const KEEP_TAIL = 3;
const MAINTAINER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

interface IssueJson { title?: string; body?: string; state?: string; user?: { login?: string }; labels?: ({ name?: string } | string)[] }
interface CommentJson { body?: string; user?: { login?: string }; author_association?: string }

/**
 * Fetch a GitHub issue/PR and render it as a compacted markdown document:
 * title + body verbatim, plus head/tail and all maintainer comments verbatim;
 * the middle of a long thread is replaced by a single "N comments omitted" line
 * (the full thread stays recoverable because the markdown is cached by the
 * gateway). Prefers `gh` (user's auth); falls back to the unauthenticated API.
 */
export async function fetchGitHubMarkdown(
  ref: GitHubRef,
  opts: { ghExec?: GhExec; fetchImpl?: typeof safeFetch; preferGh?: boolean } = {},
): Promise<{ markdown: string; url: string }> {
  const base = `repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  let issue: IssueJson;
  let comments: CommentJson[];

  const gh = opts.ghExec;
  const useGh = gh && opts.preferGh !== false;
  if (useGh) {
    issue = JSON.parse(await gh!([ 'api', base ]));
    comments = JSON.parse(await gh!([ 'api', `${base}/comments?per_page=100` ]));
  } else {
    const fetcher = opts.fetchImpl ?? safeFetch;
    const i = await fetcher(`https://api.github.com/${base}`);
    const c = await fetcher(`https://api.github.com/${base}/comments?per_page=100`);
    issue = JSON.parse(i.body);
    comments = JSON.parse(c.body);
  }

  return { markdown: renderMarkdown(ref, issue, comments), url: ref.url };
}

interface AdvisoryJson {
  ghsa_id?: string;
  summary?: string;
  description?: string;
  severity?: string;
  cvss?: { score?: number; vector_string?: string };
  cwe_ids?: string[];
  vulnerabilities?: { package?: { ecosystem?: string; name?: string }; vulnerable_version_range?: string; first_patched_version?: string }[];
  references?: string[];
  published_at?: string;
}

/**
 * Fetch a GitHub Security Advisory (GHSA-*) and render as markdown.
 * Prefers `gh` (user's auth); falls back to the unauthenticated API.
 */
export async function fetchGhsaMarkdown(
  ref: GhsaRef,
  opts: { ghExec?: GhExec; fetchImpl?: typeof safeFetch; preferGh?: boolean } = {},
): Promise<{ markdown: string; url: string }> {
  const endpoint = ref.owner && ref.repo
    ? `repos/${ref.owner}/${ref.repo}/security/advisories/${ref.ghsaId}`
    : `advisories/${ref.ghsaId}`;

  let advisory: AdvisoryJson;
  const gh = opts.ghExec;
  const useGh = gh && opts.preferGh !== false;
  if (useGh) {
    advisory = JSON.parse(await gh!(['api', endpoint]));
  } else {
    const fetcher = opts.fetchImpl ?? safeFetch;
    const resp = await fetcher(`https://api.github.com/${endpoint}`);
    advisory = JSON.parse(resp.body);
  }

  return { markdown: renderAdvisoryMarkdown(ref, advisory), url: ref.url };
}

function renderAdvisoryMarkdown(ref: GhsaRef, adv: AdvisoryJson): string {
  const out: string[] = [];
  out.push(`# ${adv.summary ?? ref.ghsaId}`);
  out.push(`GHSA: ${adv.ghsa_id ?? ref.ghsaId}`);
  if (adv.severity) out.push(`Severity: ${adv.severity}`);
  if (adv.cvss?.vector_string) out.push(`CVSS: ${adv.cvss.score} (${adv.cvss.vector_string})`);
  if (adv.cwe_ids?.length) out.push(`CWEs: ${adv.cwe_ids.join(', ')}`);
  if (adv.published_at) out.push(`Published: ${adv.published_at}`);
  out.push('');
  out.push(adv.description ?? '(no description)');

  if (adv.vulnerabilities?.length) {
    out.push('');
    out.push('## Affected Packages');
    for (const v of adv.vulnerabilities) {
      const pkg = v.package ? `${v.package.ecosystem}/${v.package.name}` : 'unknown';
      const range = v.vulnerable_version_range ?? 'unknown';
      const fix = v.first_patched_version ?? 'none';
      out.push(`- **${pkg}**: ${range} (fixed in ${fix})`);
    }
  }

  if (adv.references?.length) {
    out.push('');
    out.push('## References');
    for (const r of adv.references) {
      out.push(`- ${r}`);
    }
  }

  return out.join('\n');
}

function renderMarkdown(ref: GitHubRef, issue: IssueJson, comments: CommentJson[]): string {
  const labels = (issue.labels ?? [])
    .map(l => (typeof l === 'string' ? l : l.name ?? ''))
    .filter(Boolean)
    .join(', ');
  const out: string[] = [];
  out.push(`# ${issue.title ?? '(no title)'} (${ref.kind} #${ref.number}, ${issue.state ?? 'unknown'})`);
  if (labels) out.push(`Labels: ${labels}`);
  if (issue.user?.login) out.push(`Author: @${issue.user.login}`);
  out.push('');
  out.push(issue.body ?? '(no description)');

  const n = comments.length;
  comments.forEach((c, i) => {
    const keep = i < KEEP_HEAD || i >= n - KEEP_TAIL || MAINTAINER.has(String(c.author_association ?? ''));
    if (!keep) return;
    out.push('');
    out.push(`## Comment by @${c.user?.login ?? 'unknown'}${c.author_association ? ` (${c.author_association})` : ''}`);
    out.push(c.body ?? '');
  });

  const omittedCount = comments.filter((c, i) =>
    !(i < KEEP_HEAD || i >= n - KEEP_TAIL || MAINTAINER.has(String(c.author_association ?? '')))).length;
  if (omittedCount > 0) {
    out.push('');
    out.push(`## [${omittedCount} middle comment(s) omitted — full thread cached, expand to recover]`);
  }
  return out.join('\n');
}
