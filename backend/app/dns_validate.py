# Validators raise ValueError; the message is shown to the user as-is.
import ipaddress
import re

ZONE_LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
# Record names and hostname values may contain underscores (_dmarc, _sip._tcp).
HOST_LABEL = re.compile(r"^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$")
CAA_VALUE = re.compile(r'^(\d{1,3})\s+(issue|issuewild|issuemail|iodef)\s+"[^"]*"$', re.I)
TXT_STRING = re.compile(r'"((?:[^"\\]|\\.)*)"')
TXT_VALUE = re.compile(r'^(\s*"(?:[^"\\]|\\.)*"\s*)+$')

MAX_TTL = 2147483647


def _bare(name: str) -> str:
    return name.strip().lower().rstrip(".")


def normalize_zone_name(raw: str) -> str:
    name = _bare(raw)
    if not name:
        raise ValueError("Enter a domain name.")
    if len(name) > 253:
        raise ValueError("Domain name can't be longer than 253 characters.")
    labels = name.split(".")
    if len(labels) < 2:
        raise ValueError(
            "Route 53 doesn't support top-level domains (TLDs). Enter a domain name such as example.com."
        )
    for label in labels:
        if not ZONE_LABEL.match(label):
            raise ValueError(
                f'"{label}" isn\'t a valid label. Use a-z, 0-9 and hyphens (-), up to 63 characters, '
                "and don't start or end a label with a hyphen."
            )
    return name + "."


def is_hostname(value: str) -> bool:
    name = _bare(value)
    if not name or len(name) > 253:
        return False
    return all(HOST_LABEL.match(label) for label in name.split("."))


def record_fqdn(raw_name: str, zone_name: str, rtype: str) -> str:
    # The console sends what the user typed: "", "@", "www" or a full name.
    zone = zone_name.rstrip(".")
    name = _bare(raw_name)
    if name in ("", "@", zone):
        fqdn = zone
    elif name.endswith("." + zone):
        fqdn = name
    else:
        fqdn = f"{name}.{zone}"
    relative = fqdn[: -len(zone)].rstrip(".")
    if relative:
        labels = relative.split(".")
        for i, label in enumerate(labels):
            if label == "*" and i == 0:
                if rtype == "NS":
                    raise ValueError("You can't use the * wildcard in the name of an NS record.")
                continue
            if not HOST_LABEL.match(label):
                raise ValueError(
                    f'"{label}" isn\'t a valid label. Use a-z, 0-9, hyphens (-) and underscores (_); '
                    "* is allowed only as the leftmost label."
                )
    if len(fqdn) > 253:
        raise ValueError("Record name can't be longer than 253 characters.")
    if rtype == "CNAME" and fqdn == zone:
        raise ValueError("You can't create a CNAME record at the zone apex. Enter a subdomain name.")
    return fqdn + "."


def validate_ttl(ttl: int) -> int:
    if not 0 <= ttl <= MAX_TTL:
        raise ValueError(f"TTL must be between 0 and {MAX_TTL} seconds.")
    return ttl


def _uint(s: str, maximum: int) -> bool:
    return s.isdigit() and int(s) <= maximum


def _check_value(rtype: str, v: str) -> str | None:
    parts = v.split()
    match rtype:
        case "A":
            try:
                ipaddress.IPv4Address(v)
            except ValueError:
                return f'"{v}" isn\'t a valid IPv4 address, for example 192.0.2.44.'
        case "AAAA":
            try:
                ipaddress.IPv6Address(v)
            except ValueError:
                return f'"{v}" isn\'t a valid IPv6 address, for example 2001:db8::1.'
        case "CNAME" | "NS" | "PTR":
            if len(parts) != 1 or not is_hostname(v):
                return f'"{v}" isn\'t a valid domain name.'
        case "MX":
            if len(parts) != 2 or not _uint(parts[0], 65535) or not is_hostname(parts[1]):
                return f'"{v}" isn\'t valid. Use the format [priority] [mail server host name], for example 10 mail.example.com.'
        case "SRV":
            if len(parts) != 4 or not all(_uint(p, 65535) for p in parts[:3]) or not is_hostname(parts[3]):
                return f'"{v}" isn\'t valid. Use the format [priority] [weight] [port] [server host name], for example 1 10 5269 xmpp.example.com.'
        case "CAA":
            m = CAA_VALUE.match(v)
            if not m or int(m.group(1)) > 255:
                return f'"{v}" isn\'t valid. Use the format [flags] [tag] "[value]", for example 0 issue "amazon.com".'
        case "TXT":
            if not TXT_VALUE.match(v):
                return (
                    f'"{v}" isn\'t valid. Enclose text in quotation marks, for example "Sample text entry".'
                )
            if any(len(s) > 255 for s in TXT_STRING.findall(v)):
                return "Each quoted string in a TXT value can be up to 255 characters."
        case "SOA":
            if (
                len(parts) != 7
                or not is_hostname(parts[0])
                or not is_hostname(parts[1])
                or not all(_uint(p, 4294967295) for p in parts[2:])
            ):
                return "SOA value must be: [name server] [admin email] [serial] [refresh] [retry] [expire] [minimum TTL]."
    return None


def validate_values(rtype: str, values: list[str]) -> list[str]:
    cleaned: list[str] = []
    for v in values:
        v = v.strip()
        if v and v not in cleaned:
            cleaned.append(v)
    if not cleaned:
        raise ValueError("Enter at least one value.")
    if rtype in ("CNAME", "SOA") and len(cleaned) > 1:
        raise ValueError(f"A {rtype} record can have only one value.")
    for v in cleaned:
        if err := _check_value(rtype, v):
            raise ValueError(err)
    return cleaned
