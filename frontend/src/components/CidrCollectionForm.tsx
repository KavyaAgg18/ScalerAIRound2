"use client";

import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { useState } from "react";
import { InfoLink, useFollow } from "@/components/console";
import { CIDR_HELP } from "@/components/help";
import { ApiError } from "@/lib/api";
import type { CidrCollection, CidrLocation } from "@/lib/types";
import { splitValues } from "@/lib/validate";

interface Row {
  name: string;
  cidrs: string;
}

const NAME = /^[A-Za-z0-9_-]+$/;

interface Props {
  title: string;
  submitLabel: string;
  initial?: CidrCollection;
  onSubmit: (body: { name: string; locations: CidrLocation[] }) => Promise<void>;
}

export default function CidrCollectionForm({ title, submitLabel, initial, onSubmit }: Props) {
  const follow = useFollow();
  const info = <InfoLink help={CIDR_HELP} />;
  const [name, setName] = useState(initial?.name ?? "");
  const [rows, setRows] = useState<Row[]>(
    initial?.locations.map((l) => ({ name: l.name, cidrs: l.cidrs.join("\n") })) ?? [],
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const rowErrors = (r: Row, i: number) => ({
    name:
      !NAME.test(r.name.trim()) || r.name.trim().length > 16
        ? "Up to 16 letters, numbers, - and _."
        : rows.findIndex((o) => o.name.trim() === r.name.trim()) !== i
          ? "Location names must be unique."
          : null,
    cidrs: splitValues(r.cidrs).length ? null : "Enter at least one CIDR block.",
  });
  const nameBad = !NAME.test(name.trim()) || name.trim().length > 64;
  const invalid = nameBad || rows.some((r, i) => Object.values(rowErrors(r, i)).some(Boolean));

  async function submit() {
    setSubmitted(true);
    setFormError("");
    if (invalid) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        locations: rows.map((r) => ({ name: r.name.trim(), cidrs: splitValues(r.cidrs) })),
      });
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Form
        header={
          <Header variant="h1" info={info}>
            {title}
          </Header>
        }
        errorText={formError || undefined}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" href="/cidrcollections/" onFollow={follow} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" formAction="submit" loading={busy}>
              {submitLabel}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Collection details</Header>}>
            <FormField
              label="Collection name"
              info={info}
              constraintText="Letters, numbers, - and _. Up to 64 characters."
              errorText={submitted && nameBad ? "Use letters, numbers, - and _ only." : null}
            >
              <Input value={name} onChange={(e) => setName(e.detail.value)} ariaLabel="Collection name" />
            </FormField>
          </Container>
          <Container
            header={
              <Header variant="h2" description="Each location is a named group of CIDR blocks.">
                Locations
              </Header>
            }
          >
            <AttributeEditor
              items={rows}
              addButtonText="Add location"
              removeButtonText="Remove"
              empty="No locations."
              onAddButtonClick={() => setRows([...rows, { name: "", cidrs: "" }])}
              onRemoveButtonClick={(e) => setRows(rows.filter((_, i) => i !== e.detail.itemIndex))}
              definition={[
                {
                  label: "Location name",
                  control: (r, i) => (
                    <Input
                      value={r.name}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, name: e.detail.value } : x)))
                      }
                      ariaLabel={`Location ${i + 1} name`}
                    />
                  ),
                  errorText: (r, i) => (submitted ? rowErrors(r, i).name : null),
                },
                {
                  label: "CIDR blocks (one per line)",
                  control: (r, i) => (
                    <Textarea
                      value={r.cidrs}
                      rows={3}
                      placeholder="192.0.2.0/24"
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, cidrs: e.detail.value } : x)))
                      }
                      ariaLabel={`Location ${i + 1} CIDR blocks`}
                    />
                  ),
                  errorText: (r, i) => (submitted ? rowErrors(r, i).cidrs : null),
                },
              ]}
            />
          </Container>
        </SpaceBetween>
      </Form>
    </form>
  );
}
