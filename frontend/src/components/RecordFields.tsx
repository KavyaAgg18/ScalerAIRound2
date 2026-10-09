"use client";

import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Grid from "@cloudscape-design/components/grid";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import Toggle from "@cloudscape-design/components/toggle";
import { InfoLink } from "@/components/console";
import { RECORDS_HELP } from "@/components/help";
import { api } from "@/lib/api";
import { CONTINENTS, COUNTRIES, US_STATES } from "@/lib/geo";
import { AWS_REGIONS } from "@/lib/regions";
import type { AliasTargetType, RecordInput, RecordSet, RecordType, RoutingPolicy } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { isHostname, recordNameError, splitValues, ttlError, valuesError } from "@/lib/validate";

export interface RecordDraft {
  key: number;
  name: string;
  type: RecordType | "SOA"; // SOA appears only when editing the record Route 53 created
  values: string;
  ttl: string;
  routing_policy: RoutingPolicy;
  set_identifier: string;
  weight: string;
  failover: "" | "PRIMARY" | "SECONDARY";
  region: string;
  geo_location: string; // "*", "continent:EU" or "country:US"
  geo_subdivision: string; // US state code, only with country:US
  prox_kind: "region" | "coordinates";
  prox_region: string;
  prox_lat: string;
  prox_lon: string;
  bias: string;
  cidr_collection_id: string;
  cidr_location: string;
  health_check_id: string;
  alias: boolean;
  alias_type: AliasTargetType;
  alias_target: string;
  alias_region: string;
  evaluate_target_health: boolean;
}

export const newDraft = (key: number): RecordDraft => ({
  key,
  name: "",
  type: "A",
  values: "",
  ttl: "300",
  routing_policy: "simple",
  set_identifier: "",
  weight: "",
  failover: "",
  region: "",
  geo_location: "",
  geo_subdivision: "",
  prox_kind: "region",
  prox_region: "",
  prox_lat: "",
  prox_lon: "",
  bias: "0",
  cidr_collection_id: "",
  cidr_location: "",
  health_check_id: "",
  alias: false,
  alias_type: "elb",
  alias_target: "",
  alias_region: "",
  evaluate_target_health: true,
});

/** Draft for editing an existing record (relative name, values one per line). */
export function draftFromRecord(r: RecordSet, zoneName: string): RecordDraft {
  const [geo, sub] = (r.geo_location ?? "").split("/");
  const coords = r.geoproximity?.startsWith("coordinates:") ? r.geoproximity.slice(12).split(",") : null;
  return {
    ...newDraft(r.id),
    name: r.name === zoneName ? "" : r.name.slice(0, -zoneName.length - 1),
    type: r.type,
    values: r.values.join("\n"),
    ttl: String(r.ttl ?? 300),
    routing_policy: r.routing_policy,
    set_identifier: r.set_identifier ?? "",
    weight: r.weight === null ? "" : String(r.weight),
    failover: r.failover ?? "",
    region: r.region ?? "",
    geo_location: geo,
    geo_subdivision: sub ?? "",
    prox_kind: coords ? "coordinates" : "region",
    prox_region: r.geoproximity?.startsWith("region:") ? r.geoproximity.slice(7) : "",
    prox_lat: coords?.[0] ?? "",
    prox_lon: coords?.[1] ?? "",
    bias: String(r.bias ?? 0),
    cidr_collection_id: r.cidr_collection_id ?? "",
    cidr_location: r.cidr_location ?? "",
    health_check_id: r.health_check_id ?? "",
    alias: !!r.alias,
    alias_type: r.alias?.target_type ?? "elb",
    alias_target: r.alias ? r.alias.dns_name.replace(/\.$/, "") : "",
    alias_region: r.alias?.region ?? "",
    evaluate_target_health: r.alias?.evaluate_target_health ?? true,
  };
}

export type DraftField =
  | "name"
  | "values"
  | "ttl"
  | "routing_policy"
  | "set_identifier"
  | "weight"
  | "failover"
  | "region"
  | "geo_location"
  | "geoproximity"
  | "bias"
  | "cidr_collection_id"
  | "cidr_location"
  | "health_check_id"
  | "alias";
export type DraftErrors = Partial<Record<DraftField, string>>;

// Alias targets as the console lists them under "Route traffic to"; true = needs a Region.
export const ALIAS_TARGETS: {
  value: AliasTargetType;
  label: string;
  region: boolean;
  placeholder: string;
}[] = [
  {
    value: "elb",
    label: "Alias to Application and Classic Load Balancer",
    region: true,
    placeholder: "my-lb-1234567890.us-east-1.elb.amazonaws.com",
  },
  {
    value: "cloudfront",
    label: "Alias to CloudFront distribution",
    region: false,
    placeholder: "d111111abcdef8.cloudfront.net",
  },
  {
    value: "s3",
    label: "Alias to S3 website endpoint",
    region: true,
    placeholder: "s3-website-us-east-1.amazonaws.com",
  },
  {
    value: "apigateway",
    label: "Alias to API Gateway API",
    region: true,
    placeholder: "d-abcde12345.execute-api.us-east-1.amazonaws.com",
  },
  {
    value: "vpce",
    label: "Alias to VPC endpoint",
    region: true,
    placeholder: "vpce-0123456789abcdef0-abcdefgh.vpce-svc-0123456789abcdef0.us-east-1.vpce.amazonaws.com",
  },
  {
    value: "beanstalk",
    label: "Alias to Elastic Beanstalk environment",
    region: true,
    placeholder: "my-env.us-east-1.elasticbeanstalk.com",
  },
  {
    value: "globalaccelerator",
    label: "Alias to Global Accelerator",
    region: false,
    placeholder: "a1234567890abcdef.awsglobalaccelerator.com",
  },
  {
    value: "record",
    label: "Alias to another record in this hosted zone",
    region: false,
    placeholder: "www",
  },
];

const NEEDS_POLICY_ID = (p: RoutingPolicy) => p !== "simple";

export function draftErrors(d: RecordDraft): DraftErrors {
  const e: DraftErrors = {};
  if (d.type === "SOA") return e; // server validates SOA format
  const nameErr = recordNameError(d.name, d.type);
  if (nameErr) e.name = nameErr;

  if (d.alias) {
    const target = ALIAS_TARGETS.find((t) => t.value === d.alias_type)!;
    if (!d.alias_target.trim()) e.alias = "Choose or enter the resource to route traffic to.";
    else if (d.alias_type !== "record" && !isHostname(d.alias_target)) e.alias = "Enter a valid DNS name.";
    else if (target.region && !d.alias_region) e.alias = "Choose a Region.";
    else if (d.alias_type !== "record" && d.type !== "A" && d.type !== "AAAA")
      e.alias = "Only A and AAAA records can be aliases to AWS resources.";
    if (d.routing_policy === "multivalue") e.alias = "Multivalue answer records can't be alias records.";
  } else {
    const valErr = valuesError(d.type, d.values);
    if (valErr) e.values = valErr;
    else if (d.routing_policy === "multivalue" && splitValues(d.values).length > 1)
      e.values = "Each multivalue answer record can have only one value.";
    const ttlErr = ttlError(d.ttl);
    if (ttlErr) e.ttl = ttlErr;
  }

  if (NEEDS_POLICY_ID(d.routing_policy) && !d.set_identifier.trim())
    e.set_identifier = "Enter a record ID to differentiate records with the same name and type.";
  if (d.routing_policy !== "simple" && d.type === "NS")
    e.routing_policy = "You can create NS records only with the simple routing policy.";
  switch (d.routing_policy) {
    case "weighted":
      if (!/^\d+$/.test(d.weight) || Number(d.weight) > 255) e.weight = "Enter a weight between 0 and 255.";
      break;
    case "failover":
      if (!d.failover) e.failover = "Choose primary or secondary.";
      break;
    case "latency":
      if (!d.region) e.region = "Choose a Region.";
      break;
    case "geolocation":
      if (!d.geo_location) e.geo_location = "Choose a location.";
      break;
    case "geoproximity": {
      if (d.prox_kind === "region" && !d.prox_region) e.geoproximity = "Choose a Region.";
      if (d.prox_kind === "coordinates") {
        const lat = Number(d.prox_lat);
        const lon = Number(d.prox_lon);
        if (
          !d.prox_lat ||
          !d.prox_lon ||
          isNaN(lat) ||
          isNaN(lon) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180
        )
          e.geoproximity = "Enter latitude (-90 to 90) and longitude (-180 to 180).";
      }
      if (!/^-?\d+$/.test(d.bias) || Math.abs(Number(d.bias)) > 99) e.bias = "Enter a bias from -99 to 99.";
      break;
    }
    case "multivalue":
      if (d.type === "CNAME")
        e.routing_policy = "Multivalue answer routing isn't available for CNAME records.";
      break;
    case "ip":
      if (!d.cidr_collection_id) e.cidr_collection_id = "Choose a CIDR collection.";
      else if (!d.cidr_location) e.cidr_location = "Choose a location.";
      break;
  }
  return e;
}

export function draftToInput(d: RecordDraft): RecordInput {
  const p = d.routing_policy;
  const target = ALIAS_TARGETS.find((t) => t.value === d.alias_type)!;
  return {
    name: d.name.trim(),
    type: d.type as RecordType,
    ttl: Number(d.ttl),
    values: d.alias ? [] : splitValues(d.values),
    routing_policy: p,
    set_identifier: p !== "simple" ? d.set_identifier.trim() : null,
    weight: p === "weighted" ? Number(d.weight) : null,
    failover: p === "failover" ? (d.failover as "PRIMARY" | "SECONDARY") : null,
    region: p === "latency" ? d.region : null,
    geo_location:
      p === "geolocation"
        ? d.geo_location === "country:US" && d.geo_subdivision
          ? `country:US/${d.geo_subdivision}`
          : d.geo_location
        : null,
    geoproximity:
      p === "geoproximity"
        ? d.prox_kind === "region"
          ? `region:${d.prox_region}`
          : `coordinates:${Number(d.prox_lat)},${Number(d.prox_lon)}`
        : null,
    bias: p === "geoproximity" ? Number(d.bias) : null,
    cidr_collection_id: p === "ip" ? d.cidr_collection_id : null,
    cidr_location: p === "ip" ? d.cidr_location : null,
    health_check_id: p !== "simple" && d.health_check_id ? d.health_check_id : null,
    alias: d.alias
      ? {
          target_type: d.alias_type,
          dns_name: d.alias_target.trim(),
          region: target.region ? d.alias_region : null,
          evaluate_target_health: d.evaluate_target_health,
        }
      : null,
  };
}

// Same order and wording as the console's Record type list. Types this clone doesn't store are disabled.
const TYPE_LIST: [string, string, boolean][] = [
  ["A", "Routes traffic to an IPv4 address and some AWS resources", true],
  ["AAAA", "Routes traffic to an IPv6 address and some AWS resources", true],
  ["CNAME", "Routes traffic to another domain name and to some AWS resources", true],
  ["MX", "Specifies mail servers", true],
  ["TXT", "Used to verify email senders and for application-specific values", true],
  ["PTR", "Maps an IP address to a domain name", true],
  ["SRV", "Application-specific values that identify servers", true],
  ["SPF", "Not recommended", false],
  ["NAPTR", "Used by DDDS applications", false],
  ["CAA", "Restricts CAs that can create SSL/TLS certificates for the domain", true],
  ["NS", "Name servers for a hosted zone", true],
  ["DS", "Delegation Signer, used to establish a chain of trust for DNSSEC", false],
  ["TLSA", "Associates a TLS server certificate or public key with the domain name. DNSSEC required.", false],
  ["SSHFP", "SSH public key fingerprint, used to verify SSH host keys", false],
  ["SVCB", "Service binding, used to describe alternative endpoints for a service", false],
  ["HTTPS", "Service binding for HTTPS endpoints", false],
];

const TYPE_OPTIONS: SelectProps.Option[] = TYPE_LIST.map(([t, text, supported]) => ({
  value: t,
  label: `${t} – ${text}`,
  ...(supported ? {} : { disabled: true, disabledReason: "This record type isn't supported in this demo." }),
}));

const VALUE_PLACEHOLDER: Record<RecordType, string> = {
  A: "192.0.2.235",
  AAAA: "2001:0db8:85a3:0:0:8a2e:0370:7334",
  CAA: '0 issue "amazon.com"',
  CNAME: "www.example.com",
  MX: "10 mailserver.example.com",
  NS: "ns1.example.com",
  PTR: "www.example.com",
  SRV: "1 10 5269 xmpp-server.example.com",
  TXT: '"Sample text entry"',
};

export const POLICY_OPTIONS: SelectProps.Option[] = [
  { value: "simple", label: "Simple routing" },
  { value: "weighted", label: "Weighted" },
  { value: "geolocation", label: "Geolocation" },
  { value: "latency", label: "Latency" },
  { value: "failover", label: "Failover" },
  { value: "multivalue", label: "Multivalue answer" },
  { value: "ip", label: "IP-based" },
  { value: "geoproximity", label: "Geoproximity" },
];

const REGION_OPTIONS: SelectProps.Option[] = AWS_REGIONS.map((r) => ({
  value: r.value,
  label: r.label,
  description: r.value,
}));

const GEO_OPTIONS: SelectProps.OptionGroup[] = [
  {
    label: "Default",
    options: [{ value: "*", label: "Default", description: "Queries from locations with no other record" }],
  },
  {
    label: "Continents",
    options: Object.entries(CONTINENTS).map(([code, name]) => ({ value: `continent:${code}`, label: name })),
  },
  {
    label: "Countries",
    options: COUNTRIES.map((c) => ({ value: `country:${c.code}`, label: c.name, description: c.code })),
  },
];
const GEO_FLAT = GEO_OPTIONS.flatMap((g) => g.options as SelectProps.Option[]);

const SUBDIVISION_OPTIONS: SelectProps.Option[] = [
  { value: "", label: "All of United States" },
  ...US_STATES.map((s) => ({ value: s, label: s })),
];

const TTL_PRESETS = [
  { label: "1m", value: "60" },
  { label: "1h", value: "3600" },
  { label: "1d", value: "86400" },
];

const pick = (options: SelectProps.Option[], value: string) => options.find((o) => o.value === value) ?? null;

interface Props {
  draft: RecordDraft;
  zoneName: string;
  errors: DraftErrors;
  onChange: (patch: Partial<RecordDraft>) => void;
  editing?: boolean;
  /** The wizard picks the routing policy in its first step. */
  hidePolicy?: boolean;
}

export default function RecordFields({ draft: d, zoneName, errors, onChange, editing, hidePolicy }: Props) {
  const info = <InfoLink help={RECORDS_HELP} />;
  const policy = d.routing_policy;
  const needsHealthChecks = policy !== "simple";
  const healthChecks = useLoad(
    () => (needsHealthChecks ? api.listHealthChecks({ page_size: 300 }) : Promise.resolve(null)),
    [needsHealthChecks],
  );
  const collections = useLoad(
    () => (policy === "ip" ? api.listCidrCollections() : Promise.resolve(null)),
    [policy],
  );
  const target = ALIAS_TARGETS.find((t) => t.value === d.alias_type)!;
  const half = [{ colspan: { default: 12, s: 6 } }, { colspan: { default: 12, s: 6 } }];
  const isSoa = d.type === "SOA";

  const healthOptions: SelectProps.Option[] = [
    { value: "", label: "No health check" },
    ...(healthChecks.data?.items ?? []).map((h) => ({
      value: h.id,
      label: h.name || h.id,
      description: h.endpoint,
      tags: [h.status],
    })),
  ];
  const collectionOptions: SelectProps.Option[] = (collections.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const chosenCollection = collections.data?.find((c) => c.id === d.cidr_collection_id);
  const locationOptions: SelectProps.Option[] = [
    { value: "*", label: "Default (*)", description: "IP addresses not in any location" },
    ...(chosenCollection?.locations ?? []).map((l) => ({
      value: l.name,
      label: l.name,
      description: l.cidrs.join(", "),
    })),
  ];

  const recordId = (
    <FormField
      label="Record ID"
      info={info}
      description="Enter a value that uniquely identifies this record among records with the same name and type."
      errorText={errors.set_identifier}
    >
      <Input
        value={d.set_identifier}
        disabled={editing}
        onChange={(e) => onChange({ set_identifier: e.detail.value })}
        ariaLabel="Record ID"
      />
    </FormField>
  );
  const healthCheck = (
    <FormField
      label={
        <span>
          Health check <i>- optional</i>
        </span>
      }
      info={info}
      description="Route traffic to this record only when the health check is healthy."
      errorText={errors.health_check_id}
    >
      <Select
        selectedOption={pick(healthOptions, d.health_check_id) ?? healthOptions[0]}
        options={healthOptions}
        statusType={healthChecks.loading ? "loading" : "finished"}
        onChange={(e) => onChange({ health_check_id: e.detail.selectedOption.value ?? "" })}
        ariaLabel="Health check"
      />
    </FormField>
  );

  return (
    <SpaceBetween size="l">
      <Grid gridDefinition={half}>
        <FormField
          label="Record name"
          info={info}
          constraintText="Keep blank to create a record for the root domain."
          errorText={errors.name}
        >
          <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]} disableGutters>
            <Input
              value={d.name}
              placeholder="subdomain"
              disabled={editing}
              onChange={(e) => onChange({ name: e.detail.value })}
              ariaLabel="Record name"
            />
            <div style={{ paddingLeft: 8, paddingTop: 6, wordBreak: "break-all" }}>
              .{zoneName.replace(/\.$/, "")}
            </div>
          </Grid>
        </FormField>
        <FormField label="Record type" info={info}>
          <Select
            selectedOption={TYPE_OPTIONS.find((o) => o.value === d.type) ?? { value: d.type, label: d.type }}
            options={TYPE_OPTIONS}
            disabled={editing}
            onChange={(e) => onChange({ type: e.detail.selectedOption.value as RecordType })}
            ariaLabel="Record type"
          />
        </FormField>
      </Grid>

      {!isSoa && (
        <Toggle checked={d.alias} onChange={(e) => onChange({ alias: e.detail.checked })}>
          Alias
        </Toggle>
      )}

      {d.alias ? (
        <FormField
          label="Route traffic to"
          info={info}
          description="The resource that you want to route traffic to."
          errorText={errors.alias}
          stretch
        >
          <SpaceBetween size="s">
            <Grid gridDefinition={target.region ? half : [{ colspan: { default: 12, s: 6 } }]}>
              <Select
                selectedOption={pick(
                  ALIAS_TARGETS.map((t) => ({ value: t.value, label: t.label })),
                  d.alias_type,
                )}
                options={ALIAS_TARGETS.map((t) => ({ value: t.value, label: t.label }))}
                onChange={(e) =>
                  onChange({ alias_type: e.detail.selectedOption.value as AliasTargetType, alias_target: "" })
                }
                ariaLabel="Alias target type"
              />
              {target.region && (
                <Select
                  selectedOption={pick(REGION_OPTIONS, d.alias_region)}
                  options={REGION_OPTIONS}
                  placeholder="Choose Region"
                  filteringType="auto"
                  onChange={(e) => onChange({ alias_region: e.detail.selectedOption.value ?? "" })}
                  ariaLabel="Alias target Region"
                />
              )}
            </Grid>
            <Input
              value={d.alias_target}
              placeholder={target.placeholder}
              onChange={(e) => onChange({ alias_target: e.detail.value })}
              ariaLabel="Alias target"
            />
            <Toggle
              checked={d.evaluate_target_health}
              onChange={(e) => onChange({ evaluate_target_health: e.detail.checked })}
            >
              Evaluate target health
            </Toggle>
          </SpaceBetween>
        </FormField>
      ) : (
        <FormField
          label="Value"
          info={info}
          stretch
          constraintText={
            d.type === "CNAME" || policy === "multivalue"
              ? "Enter one value."
              : "Enter multiple values on separate lines."
          }
          errorText={errors.values}
        >
          <Textarea
            value={d.values}
            rows={3}
            placeholder={isSoa ? "" : VALUE_PLACEHOLDER[d.type as RecordType]}
            onChange={(e) => onChange({ values: e.detail.value })}
            ariaLabel="Value"
          />
        </FormField>
      )}

      <Grid gridDefinition={half}>
        {d.alias ? (
          <FormField label="TTL (seconds)" info={info} description="Alias records use the TTL of the target.">
            <Input value="" disabled placeholder="Not applicable" ariaLabel="TTL (seconds)" />
          </FormField>
        ) : (
          <FormField
            label="TTL (seconds)"
            info={info}
            constraintText="Recommended values: 60 to 172800 (two days)"
            errorText={errors.ttl}
          >
            <div className="ttl-row">
              <div className="ttl-input">
                <Input
                  value={d.ttl}
                  inputMode="numeric"
                  onChange={(e) => onChange({ ttl: e.detail.value })}
                  ariaLabel="TTL (seconds)"
                />
              </div>
              {TTL_PRESETS.map((p) => (
                <Button key={p.label} onClick={() => onChange({ ttl: p.value })} formAction="none">
                  {p.label}
                </Button>
              ))}
            </div>
          </FormField>
        )}
        {!hidePolicy && (
          <FormField label="Routing policy" info={info} errorText={errors.routing_policy}>
            <Select
              selectedOption={pick(POLICY_OPTIONS, policy)!}
              options={POLICY_OPTIONS}
              disabled={editing || isSoa}
              onChange={(e) => onChange({ routing_policy: e.detail.selectedOption.value as RoutingPolicy })}
              ariaLabel="Routing policy"
            />
          </FormField>
        )}
      </Grid>

      {policy === "weighted" && (
        <Grid gridDefinition={half}>
          <FormField
            label="Weight"
            info={info}
            description="Proportion of traffic routed to this record, relative to other weighted records."
            constraintText="Range: 0 to 255"
            errorText={errors.weight}
          >
            <Input
              value={d.weight}
              inputMode="numeric"
              onChange={(e) => onChange({ weight: e.detail.value })}
              ariaLabel="Weight"
            />
          </FormField>
          {recordId}
        </Grid>
      )}

      {policy === "failover" && (
        <Grid gridDefinition={half}>
          <FormField label="Failover record type" info={info} errorText={errors.failover}>
            <Select
              selectedOption={pick(
                [
                  { value: "PRIMARY", label: "Primary" },
                  { value: "SECONDARY", label: "Secondary" },
                ],
                d.failover,
              )}
              options={[
                { value: "PRIMARY", label: "Primary" },
                { value: "SECONDARY", label: "Secondary" },
              ]}
              placeholder="Choose primary or secondary"
              onChange={(e) =>
                onChange({ failover: e.detail.selectedOption.value as "PRIMARY" | "SECONDARY" })
              }
              ariaLabel="Failover record type"
            />
          </FormField>
          {recordId}
        </Grid>
      )}

      {policy === "latency" && (
        <Grid gridDefinition={half}>
          <FormField
            label="Region"
            info={info}
            description="The Region of the resource this record routes to."
            errorText={errors.region}
          >
            <Select
              selectedOption={pick(REGION_OPTIONS, d.region)}
              options={REGION_OPTIONS}
              placeholder="Choose Region"
              filteringType="auto"
              onChange={(e) => onChange({ region: e.detail.selectedOption.value ?? "" })}
              ariaLabel="Region"
            />
          </FormField>
          {recordId}
        </Grid>
      )}

      {policy === "geolocation" && (
        <Grid gridDefinition={half}>
          <SpaceBetween size="s">
            <FormField
              label="Location"
              info={info}
              description="Where the DNS queries come from."
              errorText={errors.geo_location}
            >
              <Select
                selectedOption={GEO_FLAT.find((o) => o.value === d.geo_location) ?? null}
                options={GEO_OPTIONS}
                placeholder="Choose location"
                filteringType="auto"
                onChange={(e) =>
                  onChange({ geo_location: e.detail.selectedOption.value ?? "", geo_subdivision: "" })
                }
                ariaLabel="Location"
              />
            </FormField>
            {d.geo_location === "country:US" && (
              <FormField
                label={
                  <span>
                    U.S. state <i>- optional</i>
                  </span>
                }
              >
                <Select
                  selectedOption={pick(SUBDIVISION_OPTIONS, d.geo_subdivision) ?? SUBDIVISION_OPTIONS[0]}
                  options={SUBDIVISION_OPTIONS}
                  filteringType="auto"
                  onChange={(e) => onChange({ geo_subdivision: e.detail.selectedOption.value ?? "" })}
                  ariaLabel="U.S. state"
                />
              </FormField>
            )}
          </SpaceBetween>
          {recordId}
        </Grid>
      )}

      {policy === "geoproximity" && (
        <Grid gridDefinition={half}>
          <SpaceBetween size="s">
            <FormField label="Endpoint location" info={info} errorText={errors.geoproximity}>
              <SpaceBetween size="xs">
                <Select
                  selectedOption={pick(
                    [
                      { value: "region", label: "AWS Region" },
                      { value: "coordinates", label: "Coordinates" },
                    ],
                    d.prox_kind,
                  )}
                  options={[
                    { value: "region", label: "AWS Region" },
                    { value: "coordinates", label: "Coordinates" },
                  ]}
                  onChange={(e) =>
                    onChange({ prox_kind: e.detail.selectedOption.value as "region" | "coordinates" })
                  }
                  ariaLabel="Endpoint location type"
                />
                {d.prox_kind === "region" ? (
                  <Select
                    selectedOption={pick(REGION_OPTIONS, d.prox_region)}
                    options={REGION_OPTIONS}
                    placeholder="Choose Region"
                    filteringType="auto"
                    onChange={(e) => onChange({ prox_region: e.detail.selectedOption.value ?? "" })}
                    ariaLabel="Endpoint Region"
                  />
                ) : (
                  <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
                    <Input
                      value={d.prox_lat}
                      placeholder="Latitude"
                      onChange={(e) => onChange({ prox_lat: e.detail.value })}
                      ariaLabel="Latitude"
                    />
                    <Input
                      value={d.prox_lon}
                      placeholder="Longitude"
                      onChange={(e) => onChange({ prox_lon: e.detail.value })}
                      ariaLabel="Longitude"
                    />
                  </Grid>
                )}
              </SpaceBetween>
            </FormField>
            <FormField
              label="Bias"
              info={info}
              description="Expands (positive) or shrinks (negative) the area that traffic is routed from."
              constraintText="Range: -99 to 99"
              errorText={errors.bias}
            >
              <Input
                value={d.bias}
                inputMode="numeric"
                onChange={(e) => onChange({ bias: e.detail.value })}
                ariaLabel="Bias"
              />
            </FormField>
          </SpaceBetween>
          {recordId}
        </Grid>
      )}

      {policy === "ip" && (
        <Grid gridDefinition={half}>
          <SpaceBetween size="s">
            <FormField label="CIDR collection" info={info} errorText={errors.cidr_collection_id}>
              <Select
                selectedOption={pick(collectionOptions, d.cidr_collection_id)}
                options={collectionOptions}
                placeholder="Choose CIDR collection"
                statusType={collections.loading ? "loading" : "finished"}
                empty="No CIDR collections. Create one under IP-based routing > CIDR collections."
                onChange={(e) =>
                  onChange({ cidr_collection_id: e.detail.selectedOption.value ?? "", cidr_location: "" })
                }
                ariaLabel="CIDR collection"
              />
            </FormField>
            <FormField label="Location" info={info} errorText={errors.cidr_location}>
              <Select
                selectedOption={pick(locationOptions, d.cidr_location)}
                options={locationOptions}
                placeholder="Choose location"
                disabled={!d.cidr_collection_id}
                onChange={(e) => onChange({ cidr_location: e.detail.selectedOption.value ?? "" })}
                ariaLabel="CIDR location"
              />
            </FormField>
          </SpaceBetween>
          {recordId}
        </Grid>
      )}

      {policy === "multivalue" && <Grid gridDefinition={half}>{recordId}</Grid>}

      {needsHealthChecks && <Grid gridDefinition={half}>{healthCheck}</Grid>}
    </SpaceBetween>
  );
}
