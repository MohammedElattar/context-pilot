import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Extra request headers (never include credentials). */
  headers?: Record<string, string>;
}

export interface FetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  /** True when the body hit maxBytes and was cut off. */
  truncated: boolean;
}

export class FetchError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FetchError';
  }
}

const DEFAULTS = { maxBytes: 2_000_000, timeoutMs: 10_000, maxRedirects: 5 };

/**
 * Reject loopback, private, link-local, and reserved addresses (IPv4 + IPv6,
 * including IPv4-mapped IPv6 and the cloud metadata address). This is the SSRF
 * core: every connect target is checked against it.
 */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip.toLowerCase());
  return true; // not an IP we can reason about — treat as unsafe
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                    // 0.0.0.0/8
  if (a === 10) return true;                   // 10.0.0.0/8
  if (a === 127) return true;                  // loopback
  if (a === 169 && b === 254) return true;     // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;     // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true;                   // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  if (ip === '::1' || ip === '::') return true;
  if (ip.startsWith('fe80')) return true;      // link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local fc00::/7
  if (ip.startsWith('ff')) return true;        // multicast
  const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

/**
 * dns.lookup replacement passed to the request. It resolves every address and
 * rejects the whole connection if ANY resolved address is private, then hands
 * back a validated address — so the address that is connected to is the same
 * one that was checked (no DNS-rebinding TOCTOU gap).
 */
function guardedLookup(hostname: string, options: any, cb: any): void {
  const callback = typeof options === 'function' ? options : cb;
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err);
    if (!addresses || addresses.length === 0) {
      return callback(new FetchError(`DNS returned no address for ${hostname}`, 'dns_empty'));
    }
    for (const a of addresses) {
      if (isPrivateIp(a.address)) {
        return callback(new FetchError(`Blocked private address ${a.address} for ${hostname}`, 'ssrf_blocked'));
      }
    }
    // Prefer a validated IPv4 address: pinning one address defeats Node's
    // happy-eyeballs, and a dead-first AAAA would otherwise stall until timeout.
    const chosen = addresses.find(a => a.family === 4) ?? addresses[0];
    callback(null, chosen.address, chosen.family);
  });
}

/** Resolve a hostname and reject if any address is private (DNS pre-validation). */
function assertHostPublic(hostname: string): Promise<void> {
  // An IP literal is validated synchronously by assertSafeUrl; skip DNS.
  if (isIP(hostname.replace(/^\[|\]$/g, ''))) return Promise.resolve();
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
      if (err) return reject(new FetchError(err.message, 'dns'));
      if (!addresses?.length) return reject(new FetchError(`DNS returned no address for ${hostname}`, 'dns_empty'));
      for (const a of addresses) {
        if (isPrivateIp(a.address)) return reject(new FetchError(`Blocked private address ${a.address} for ${hostname}`, 'ssrf_blocked'));
      }
      resolve();
    });
  });
}

function assertSafeUrl(u: URL): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new FetchError(`Blocked non-http(s) scheme: ${u.protocol}`, 'bad_scheme');
  }
  // Reject a literal private IP host up front (lookup is skipped for literals).
  if (isIP(u.hostname) && isPrivateIp(u.hostname)) {
    throw new FetchError(`Blocked private host: ${u.hostname}`, 'ssrf_blocked');
  }
  // Bracketed IPv6 literal.
  const bare = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) && isPrivateIp(bare)) {
    throw new FetchError(`Blocked private host: ${u.hostname}`, 'ssrf_blocked');
  }
}

/**
 * Fetch a URL with SSRF protection, manual redirect validation, a body cap,
 * and a timeout. Redirects are followed explicitly (each hop re-validated),
 * never automatically, so a redirect to a private address is blocked.
 */
export function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;

  const attempt = (current: string, hops: number): Promise<FetchResult> =>
    new Promise<FetchResult>((resolve, reject) => {
      let u: URL;
      try {
        u = new URL(current);
        assertSafeUrl(u);
      } catch (err) {
        return reject(err instanceof FetchError ? err : new FetchError(`Invalid URL: ${current}`, 'bad_url'));
      }

      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        u,
        {
          method: 'GET',
          lookup: guardedLookup as any,
          headers: {
            'user-agent': 'ContextPilot-ResearchGateway/0.1 (+local)',
            accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
            ...options.headers,
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;

          // Manual redirect handling — validate the target, never auto-follow.
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume(); // drain
            if (hops >= maxRedirects) {
              return reject(new FetchError(`Too many redirects (>${maxRedirects})`, 'too_many_redirects'));
            }
            let next: string;
            try {
              next = new URL(res.headers.location, u).toString();
            } catch {
              return reject(new FetchError('Invalid redirect location', 'bad_redirect'));
            }
            return resolve(attempt(next, hops + 1));
          }

          const chunks: Buffer[] = [];
          let bytes = 0;
          let truncated = false;
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              truncated = true;
              chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (bytes - maxBytes))));
              res.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => finish());
          res.on('close', () => finish());
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve({
              finalUrl: u.toString(),
              status,
              contentType: String(res.headers['content-type'] ?? ''),
              body,
              bytes: Buffer.byteLength(body),
              truncated,
            });
          };
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new FetchError(`Timeout after ${timeoutMs}ms`, 'timeout'));
      });
      req.on('error', (err) => {
        reject(err instanceof FetchError ? err : new FetchError(err.message, 'network'));
      });
      req.end();
    });

  return attempt(rawUrl, 0).catch((err) => {
    // node:http(s) is blocked in some sandboxes while undici fetch still works.
    // Fall back ONLY on a connection-level failure — never on an SSRF/scheme
    // block, which must stay blocked.
    const code = err instanceof FetchError ? err.code : 'network';
    if (code === 'timeout' || code === 'network' || code === 'dns' || code === 'dns_empty') {
      return fetchViaUndici(rawUrl, { maxBytes, timeoutMs, maxRedirects, headers: options.headers });
    }
    throw err;
  });
}

/**
 * Fallback transport using the global fetch (undici). SSRF is enforced by
 * pre-resolving and rejecting private addresses, a scheme check, and manual
 * redirect re-validation. Caveat vs the node:http path: fetch re-resolves the
 * host itself, so a validated-then-flipped DNS record leaves a narrow rebinding
 * window; acceptable for the public docs/GitHub this gateway targets, and each
 * redirect hop is re-validated.
 */
async function fetchViaUndici(rawUrl: string, options: Required<Pick<SafeFetchOptions, 'maxBytes' | 'timeoutMs' | 'maxRedirects'>> & { headers?: Record<string, string> }): Promise<FetchResult> {
  const attempt = async (current: string, hops: number): Promise<FetchResult> => {
    let u: URL;
    try {
      u = new URL(current);
      assertSafeUrl(u);
    } catch (err) {
      throw err instanceof FetchError ? err : new FetchError(`Invalid URL: ${current}`, 'bad_url');
    }
    await assertHostPublic(u.hostname);

    const res = await fetch(u, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        'user-agent': 'ContextPilot-ResearchGateway/0.1 (+local)',
        accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
        ...options.headers,
      },
    }).catch((e) => { throw new FetchError(e instanceof Error ? e.message : String(e), 'network'); });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) {
        if (hops >= options.maxRedirects) throw new FetchError(`Too many redirects (>${options.maxRedirects})`, 'too_many_redirects');
        let next: string;
        try { next = new URL(loc, u).toString(); } catch { throw new FetchError('Invalid redirect location', 'bad_redirect'); }
        return attempt(next, hops + 1);
      }
    }

    // Read with a byte cap.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.length;
        if (bytes > options.maxBytes) {
          chunks.push(value.subarray(0, Math.max(0, value.length - (bytes - options.maxBytes))));
          truncated = true;
          try { await reader.cancel(); } catch { /* ignore */ }
          break;
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8');
    return {
      finalUrl: u.toString(),
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body,
      bytes: Buffer.byteLength(body),
      truncated,
    };
  };
  return attempt(rawUrl, 0);
}
