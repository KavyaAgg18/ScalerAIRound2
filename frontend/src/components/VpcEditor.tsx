"use client";

import Alert from "@cloudscape-design/components/alert";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Grid from "@cloudscape-design/components/grid";
import Link from "@cloudscape-design/components/link";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useState } from "react";
import { InfoLink } from "@/components/console";
import { ZONE_HELP } from "@/components/help";
import { AWS_REGIONS } from "@/lib/regions";
import type { Vpc } from "@/lib/types";

export interface VpcRow {
  region: SelectProps.Option | null;
  vpcId: string;
}

const REGION_OPTIONS: SelectProps.Option[] = AWS_REGIONS.map((r) => ({
  value: r.value,
  label: r.label,
  description: r.value,
}));

const VPC_ID = /^vpc-[0-9a-f]{8,17}$/;

export const emptyVpc = (): VpcRow => ({ region: null, vpcId: "" });

export const toVpcRows = (vpcs: Vpc[]): VpcRow[] =>
  vpcs.map((v) => ({ region: REGION_OPTIONS.find((o) => o.value === v.region) ?? null, vpcId: v.vpc_id }));

export const toVpcs = (rows: VpcRow[]): Vpc[] =>
  rows.map((r) => ({ region: r.region!.value!, vpc_id: r.vpcId.trim() }));

export function vpcRowErrors(rows: VpcRow[], i: number) {
  const r = rows[i];
  const id = r.vpcId.trim();
  return {
    region: r.region ? null : "Choose a Region.",
    vpcId: !id
      ? "Choose a VPC."
      : !VPC_ID.test(id)
        ? "Enter a VPC ID like vpc-0a1b2c3d4e5f67890."
        : rows.findIndex((o) => o.vpcId.trim() === id) !== i
          ? "This VPC is already associated."
          : null,
  };
}

export const vpcsValid = (rows: VpcRow[]) =>
  rows.length > 0 && rows.every((_, i) => !Object.values(vpcRowErrors(rows, i)).some(Boolean));

// There's no real AWS account behind the demo, so each Region offers two made-up VPCs.
// Any well-formed VPC ID can still be typed in.
const vpcSuggestions = (region: string) => {
  const seed = [...region]
    .reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padEnd(8, "0");
  return [
    { value: `vpc-0${seed.slice(0, 8)}a1b2c3d4`, description: "default" },
    { value: `vpc-0${seed.slice(0, 8)}e5f6a7b8`, description: "app-vpc" },
  ];
};

interface Props {
  rows: VpcRow[];
  onChange: (rows: VpcRow[]) => void;
  showErrors: boolean;
  serverError?: string;
}

export default function VpcEditor({ rows, onChange, showErrors, serverError }: Props) {
  const [notice, setNotice] = useState(true);
  const set = (i: number, patch: Partial<VpcRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const info = <InfoLink help={ZONE_HELP} />;

  return (
    <SpaceBetween size="l">
      {notice && (
        <Alert type="info" dismissible onDismiss={() => setNotice(false)}>
          For each VPC that you associate with a private hosted zone, you must set the Amazon VPC settings{" "}
          <Link external href="https://docs.aws.amazon.com/vpc/latest/userguide/vpc-dns.html#vpc-dns-support">
            enableDnsHostnames and enableDnsSupport
          </Link>{" "}
          to true.
        </Alert>
      )}
      {rows.map((r, i) => {
        const errors = showErrors ? vpcRowErrors(rows, i) : { region: null, vpcId: null };
        const n = rows.length > 1 ? ` ${i + 1}` : "";
        return (
          <Grid key={i} gridDefinition={[{ colspan: 5 }, { colspan: 5 }, { colspan: 2 }]}>
            <FormField label="Region" info={info} errorText={errors.region}>
              <Select
                selectedOption={r.region}
                options={REGION_OPTIONS}
                placeholder="Choose region"
                filteringType="auto"
                ariaLabel={`Region${n}`}
                onChange={(e) => set(i, { region: e.detail.selectedOption, vpcId: "" })}
              />
            </FormField>
            <FormField label="VPC ID" info={info} errorText={errors.vpcId}>
              <Autosuggest
                value={r.vpcId}
                onChange={(e) => set(i, { vpcId: e.detail.value })}
                options={r.region ? vpcSuggestions(r.region.value!) : []}
                placeholder="Choose VPC"
                enteredTextLabel={(v) => `Use: "${v}"`}
                empty={r.region ? "No VPCs found" : "Choose a Region first"}
                ariaLabel={`VPC ID${n}`}
              />
            </FormField>
            <FormField label=" ">
              <Button
                formAction="none"
                disabled={rows.length === 1 && !r.region && !r.vpcId}
                onClick={() => onChange(rows.length === 1 ? [emptyVpc()] : rows.filter((_, j) => j !== i))}
              >
                Remove VPC
              </Button>
            </FormField>
          </Grid>
        );
      })}
      {serverError && <Alert type="error">{serverError}</Alert>}
      <Button formAction="none" onClick={() => onChange([...rows, emptyVpc()])}>
        Add VPC
      </Button>
    </SpaceBetween>
  );
}
