import { describe, expect, it } from "vitest";
import { isHostname, recordNameError, splitValues, ttlError, valuesError, zoneNameError } from "./validate";

describe("zoneNameError", () => {
  it.each(["example.com", "Example.COM.", "sub.example.co.uk", "a-b.io"])("accepts %s", (n) => {
    expect(zoneNameError(n)).toBeNull();
  });
  it.each([
    ["", "Enter a domain name."],
    ["com", "top-level domains"],
    ["-bad.com", "isn't a valid label"],
    ["bad_label.com", "isn't a valid label"],
    ["a".repeat(64) + ".com", "isn't a valid label"],
    ["a.".repeat(130) + "com", "253 characters"],
  ])("rejects %j", (n, msg) => {
    expect(zoneNameError(n)).toContain(msg);
  });
});

describe("recordNameError", () => {
  it("allows apex, subdomains, underscores and a leading wildcard", () => {
    for (const n of ["", "@", "www", "_dmarc", "_sip._tcp", "*", "*.dev"])
      expect(recordNameError(n, "A")).toBeNull();
  });
  it("rejects CNAME at apex, NS wildcard, bad labels and inner wildcards", () => {
    expect(recordNameError("", "CNAME")).toContain("zone apex");
    expect(recordNameError("*", "NS")).toContain("wildcard");
    expect(recordNameError("bad name", "A")).toContain("isn't a valid label");
    expect(recordNameError("a.*", "A")).toContain("isn't a valid label");
  });
});

describe("valuesError", () => {
  const valid: Record<string, string> = {
    A: "192.0.2.1\n10.0.0.1",
    AAAA: "2001:db8::1",
    CNAME: "target.example.net",
    TXT: '"hello" "world"',
    MX: "10 mail.example.com.",
    NS: "ns1.example.com",
    PTR: "host.example.com",
    SRV: "1 10 5269 xmpp.example.com",
    CAA: '0 issue "amazon.com"',
  };
  const invalid: Record<string, [string, string]> = {
    A: ["256.1.1.1", "IPv4"],
    AAAA: ["192.0.2.1", "IPv6"],
    CNAME: ["a.com\nb.com", "only one value"],
    TXT: ["unquoted", "quotation marks"],
    MX: ["mail.example.com", "[priority]"],
    NS: ["not a host", "domain name"],
    PTR: ["bad!", "domain name"],
    SRV: ["1 10 host", "[priority] [weight] [port]"],
    CAA: ['0 bogus "x"', "[flags] [tag]"],
  };
  it.each(Object.keys(valid))("%s accepts valid values", (t) => {
    expect(valuesError(t as never, valid[t])).toBeNull();
  });
  it.each(Object.keys(invalid))("%s rejects invalid values", (t) => {
    const [value, msg] = invalid[t];
    expect(valuesError(t as never, value)).toContain(msg);
  });
  it("requires at least one value", () => {
    expect(valuesError("A", "  \n ")).toBe("Enter at least one value.");
  });
});

describe("helpers", () => {
  it("splitValues trims, drops blanks and dedupes", () => {
    expect(splitValues(" 1.1.1.1 \n\n1.1.1.1\n2.2.2.2")).toEqual(["1.1.1.1", "2.2.2.2"]);
  });
  it("ttlError accepts 0..2147483647 only", () => {
    expect(ttlError("0")).toBeNull();
    expect(ttlError("2147483647")).toBeNull();
    expect(ttlError("2147483648")).toContain("between 0 and");
    expect(ttlError("-1")).toContain("whole number");
    expect(ttlError("abc")).toContain("whole number");
  });
  it("isHostname", () => {
    expect(isHostname("a.example.com.")).toBe(true);
    expect(isHostname("")).toBe(false);
    expect(isHostname("has space.com")).toBe(false);
  });
});
