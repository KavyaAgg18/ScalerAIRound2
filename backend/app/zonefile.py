"""BIND zone file parsing (for import) and rendering (for export).

Supports what the console's "Import zone file" accepts for our record types: $ORIGIN, $TTL,
relative names, "@", omitted owner names, optional TTL/class in either order, parentheses that
span lines, and ; comments. SOA and NS records at the zone apex are skipped, as Route 53 does.
"""

from dataclasses import dataclass, field

SUPPORTED = {"A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "CAA"}
DEFAULT_TTL = 300


@dataclass
class ParsedRecord:
    line: int
    name: str  # FQDN with trailing dot
    type: str
    ttl: int
    value: str


@dataclass
class ParseResult:
    records: list[ParsedRecord] = field(default_factory=list)
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def _strip_comment(line: str) -> str:
    in_quotes = False
    for i, ch in enumerate(line):
        if ch == '"' and (i == 0 or line[i - 1] != "\\"):
            in_quotes = not in_quotes
        elif ch == ";" and not in_quotes:
            return line[:i]
    return line


def _logical_lines(text: str):
    """Yield (line_number, text, starts_with_blank) with parenthesised continuations joined."""
    buf, start, depth, blank = "", 0, 0, False
    for n, raw in enumerate(text.splitlines(), start=1):
        line = _strip_comment(raw)
        if depth == 0:
            if not line.strip():
                continue
            buf, start, blank = line, n, line[:1] in (" ", "\t")
        else:
            buf += " " + line
        depth += line.count("(") - line.count(")")
        if depth <= 0:
            depth = 0
            yield start, buf.replace("(", " ").replace(")", " "), blank


def _split(text: str) -> list[str]:
    """Whitespace split that keeps quoted strings (with their quotes) together."""
    tokens, cur, in_quotes = [], "", False
    for i, ch in enumerate(text):
        if ch == '"' and (i == 0 or text[i - 1] != "\\"):
            in_quotes = not in_quotes
            cur += ch
        elif ch.isspace() and not in_quotes:
            if cur:
                tokens.append(cur)
                cur = ""
        else:
            cur += ch
    if cur:
        tokens.append(cur)
    return tokens


def _qualify(name: str, origin: str) -> str:
    if name == "@":
        return origin
    if name.endswith("."):
        return name.lower()
    return f"{name}.{origin}".lower()


def parse_zone_file(text: str, zone_name: str) -> ParseResult:
    result = ParseResult()
    origin = zone_name.lower()
    default_ttl = DEFAULT_TTL
    last_name = origin

    for n, line, starts_blank in _logical_lines(text):
        tokens = _split(line)
        head = tokens[0].upper()

        if head == "$ORIGIN":
            if len(tokens) != 2:
                result.errors.append(f"Line {n}: $ORIGIN needs exactly one domain name.")
                continue
            origin = _qualify(tokens[1], origin)
            continue
        if head == "$TTL":
            if len(tokens) != 2 or not tokens[1].isdigit():
                result.errors.append(f"Line {n}: $TTL needs a number of seconds.")
                continue
            default_ttl = int(tokens[1])
            continue
        if head.startswith("$"):
            result.errors.append(f"Line {n}: {tokens[0]} isn't supported.")
            continue

        if starts_blank:
            name = last_name
        else:
            name = _qualify(tokens.pop(0), origin)
            last_name = name

        ttl = default_ttl
        # TTL and class can come in either order before the type.
        for _ in range(2):
            if tokens and tokens[0].isdigit():
                ttl = int(tokens.pop(0))
            elif tokens and tokens[0].upper() in ("IN", "CH", "HS"):
                if tokens.pop(0).upper() != "IN":
                    result.errors.append(f"Line {n}: only the IN class is supported.")
        if not tokens:
            result.errors.append(f"Line {n}: missing record type.")
            continue

        rtype = tokens.pop(0).upper()
        value = " ".join(tokens)

        if rtype in ("SOA", "NS") and name == zone_name.lower():
            result.skipped += 1  # Route 53 keeps its own apex SOA and NS records
            continue
        if rtype == "SOA":
            result.errors.append(f"Line {n}: SOA records are only allowed at the zone apex.")
            continue
        if rtype not in SUPPORTED:
            result.errors.append(f"Line {n}: record type {rtype} isn't supported.")
            continue
        if not value:
            result.errors.append(f"Line {n}: {rtype} record has no value.")
            continue
        if name != zone_name.lower() and not name.endswith("." + zone_name.lower()):
            result.errors.append(f"Line {n}: {name} isn't in the hosted zone {zone_name.rstrip('.')}.")
            continue

        result.records.append(ParsedRecord(n, name, rtype, ttl, value))

    return result


def render_zone_file(zone_name: str, records) -> str:
    """BIND text for a zone.

    BIND has no routing policies or aliases: policy records are written as plain records with a
    comment, and alias records only as a comment (they have no values to export).
    """
    lines = [f"$ORIGIN {zone_name}", f"$TTL {DEFAULT_TTL}", "; Exported from the Route 53 console clone", ""]
    for r in records:
        if r.alias_target:
            lines.append(f"; alias {r.name} {r.type} -> {r.alias_target} (not representable in BIND)")
            continue
        note = f"\t; {r.routing_policy} routing, record ID {r.set_identifier}" if r.set_identifier else ""
        for value in r.values:
            lines.append(f"{r.name}\t{r.ttl}\tIN\t{r.type}\t{value}{note}")
    return "\n".join(lines) + "\n"
