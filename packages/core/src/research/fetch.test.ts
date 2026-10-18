import { describe, it, expect } from 'vitest';
import { isPrivateIp, safeFetch, FetchError } from './fetch.js';

describe('isPrivateIp (SSRF address guard)', () => {
  it('blocks loopback, private, link-local, CGNAT and metadata IPv4', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.1',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('blocks loopback/ULA/link-local IPv6 and mapped private v4', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('treats a non-IP string as unsafe', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true);
  });
});

describe('safeFetch (no network for these cases)', () => {
  it('rejects a non-http(s) scheme before connecting', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toMatchObject({ code: 'bad_scheme' });
    await expect(safeFetch('ftp://example.com/x')).rejects.toMatchObject({ code: 'bad_scheme' });
  });

  it('rejects a literal private host before connecting', async () => {
    await expect(safeFetch('http://127.0.0.1/')).rejects.toMatchObject({ code: 'ssrf_blocked' });
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({ code: 'ssrf_blocked' });
    await expect(safeFetch('http://[::1]/')).rejects.toMatchObject({ code: 'ssrf_blocked' });
  });

  it('rejects an invalid URL', async () => {
    await expect(safeFetch('not a url')).rejects.toBeInstanceOf(FetchError);
  });
});
