'use strict';
/**
 * Shared SSRF protection for any feature that fetches a user- or
 * partner-supplied URL (webhooks, SEP-31 callbacks, etc.).
 *
 * Resolve-then-validate: the hostname is DNS-resolved and the *resolved* IP
 * is checked against the private/reserved ranges, not just the hostname
 * string. Callers that hold onto a validated URL for any length of time
 * (retry loops, queued deliveries) MUST re-validate immediately before each
 * outbound request to defend against DNS rebinding.
 */
const dns = require('dns').promises;

// RFC 1918, loopback, link-local, and cloud metadata ranges
const BLOCKED_CIDRS = [
  [0x0a000000, 0xff000000],   // 10.0.0.0/8
  [0xac100000, 0xfff00000],   // 172.16.0.0/12
  [0xc0a80000, 0xffff0000],   // 192.168.0.0/16
  [0x7f000000, 0xff000000],   // 127.0.0.0/8  (loopback)
  [0xa9fe0000, 0xffff0000],   // 169.254.0.0/16 (link-local / metadata)
  [0x64400000, 0xffc00000],   // 100.64.0.0/10 (shared address space)
  [0x00000000, 0xff000000],   // 0.0.0.0/8
  [0xe0000000, 0xf0000000],   // 224.0.0.0/4  (multicast)
  [0xf0000000, 0xf0000000],   // 240.0.0.0/4  (reserved)
];

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIp(ip) {
  // IPv6 loopback / link-local / unique-local
  if (ip === '::1' || ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  // Only check IPv4
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const n = ipToInt(ip);
  return BLOCKED_CIDRS.some(([net, mask]) => (n & mask) === (net & mask));
}

const BLOCKED_HOSTNAME_SUFFIXES = ['.local', '.internal', 'localhost'];

/**
 * Validates that `url` is https:// and resolves to a public IP address.
 * Returns true only if the URL is safe to fetch *right now* — callers that
 * delay delivery must call this again immediately before the request.
 */
async function validatePublicUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname === s || hostname.endsWith(s))) return false;

  // Reject if hostname is a bare IP in a blocked range
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && isPrivateIp(hostname)) return false;

  // Resolve hostname and check the actually-connected IP (defends against
  // DNS rebinding — a name that only resolves to a private IP at request time).
  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIp(address)) return false;
  } catch {
    return false; // unresolvable hostname
  }
  return true;
}

module.exports = { validatePublicUrl, isPrivateIp };
