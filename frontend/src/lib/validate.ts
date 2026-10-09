// Instant client-side feedback only. The API (backend/app/dns_validate.py) is the source of truth.
import type { RecordType } from "./types";

const ZONE_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_LABEL = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const CAA = /^(\d{1,3})\s+(issue|issuewild|issuemail|iodef)\s+"[^"]*"$/i;
const TXT = /^(\s*"(?:[^"\\]|\\.)*"\s*)+$/;
export const MAX_TTL = 2147483647;

const bareLower = (s: string) => s.trim().toLowerCase().replace(/\.$/, "");

export function zoneNameError(raw: string): string | null {
  const name = bareLower(raw);
  if (!name) return "Enter a domain name.";
  if (name.length > 253) return "Domain name can't be longer than 253 characters.";
  const labels = name.split(".");
  if (labels.length < 2)
    return "Route 53 doesn't support top-level domains (TLDs). Enter a domain name such as example.com.";
  const bad = labels.find((l) => !ZONE_LABEL.test(l));
  if (bad !== undefined)
    return `"${bad}" isn't a valid label. Use a-z, 0-9 and hyphens (-), up to 63 characters, and don't start or end a label with a hyphen.`;
  return null;
}

export function isHostname(value: string): boolean {
  const name = bareLower(value);
  return !!name && name.length <= 253 && name.split(".").every((l) => HOST_LABEL.test(l));
}

function isIPv6(v: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(v) || !v.includes(":")) return false;
  try {
    new URL(`http://[${v}]/`);
    return true;
  } catch {
    return false;
  }
}

export function recordNameError(raw: string, type: RecordType): string | null {
  const name = bareLower(raw);
  if (!name || name === "@")
    return type === "CNAME"
      ? "You can't create a CNAME record at the zone apex. Enter a subdomain name."
      : null;
  const labels = name.split(".");
  for (const [i, l] of labels.entries()) {
    if (l === "*" && i === 0) {
      if (type === "NS") return "You can't use the * wildcard in the name of an NS record.";
      continue;
    }
    if (!HOST_LABEL.test(l))
      return `"${l}" isn't a valid label. Use a-z, 0-9, hyphens (-) and underscores (_); * is allowed only as the leftmost label.`;
  }
  return null;
}

const uint = (s: string, max: number) => /^\d+$/.test(s) && Number(s) <= max;

function valueError(type: RecordType, v: string): string | null {
  const p = v.split(/\s+/);
  switch (type) {
    case "A":
      return IPV4.test(v) ? null : `"${v}" isn't a valid IPv4 address, for example 192.0.2.44.`;
    case "AAAA":
      return isIPv6(v) ? null : `"${v}" isn't a valid IPv6 address, for example 2001:db8::1.`;
    case "CNAME":
    case "NS":
    case "PTR":
      return p.length === 1 && isHostname(v) ? null : `"${v}" isn't a valid domain name.`;
    case "MX":
      return p.length === 2 && uint(p[0], 65535) && isHostname(p[1])
        ? null
        : `"${v}" isn't valid. Use the format [priority] [mail server host name], for example 10 mail.example.com.`;
    case "SRV":
      return p.length === 4 && p.slice(0, 3).every((x) => uint(x, 65535)) && isHostname(p[3])
        ? null
        : `"${v}" isn't valid. Use the format [priority] [weight] [port] [server host name], for example 1 10 5269 xmpp.example.com.`;
    case "CAA": {
      const m = CAA.exec(v);
      return m && Number(m[1]) <= 255
        ? null
        : `"${v}" isn't valid. Use the format [flags] [tag] "[value]", for example 0 issue "amazon.com".`;
    }
    case "TXT":
      return TXT.test(v)
        ? null
        : `"${v}" isn't valid. Enclose text in quotation marks, for example "Sample text entry".`;
  }
}

export function splitValues(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function valuesError(type: RecordType, text: string): string | null {
  const values = splitValues(text);
  if (!values.length) return "Enter at least one value.";
  if (type === "CNAME" && values.length > 1) return "A CNAME record can have only one value.";
  for (const v of values) {
    const err = valueError(type, v);
    if (err) return err;
  }
  return null;
}

export function ttlError(raw: string): string | null {
  if (!/^\d+$/.test(raw.trim())) return "Enter a TTL in seconds (a whole number).";
  return Number(raw) <= MAX_TTL ? null : `TTL must be between 0 and ${MAX_TTL} seconds.`;
}
