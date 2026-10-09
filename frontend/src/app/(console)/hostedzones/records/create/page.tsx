"use client";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Flashbar from "@cloudscape-design/components/flashbar";
import Form from "@cloudscape-design/components/form";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tiles from "@cloudscape-design/components/tiles";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import RecordFields, {
  draftErrors,
  draftToInput,
  newDraft,
  type DraftErrors,
  type RecordDraft,
} from "@/components/RecordFields";
import RecordWizard from "@/components/RecordWizard";
import { InfoLink, ROUTE53_CRUMB, Shell, useConsole, useFollow } from "@/components/console";
import { RECORDS_HELP } from "@/components/help";
import { api, ApiError, bare } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

let nextKey = 1;

type Method = "quick" | "wizard";

export default function CreateRecordPage() {
  const router = useRouter();
  const follow = useFollow();
  const { flash } = useConsole();
  const zoneId = useSearchParams().get("zoneId") ?? "";
  const { data: zone, error: zoneError } = useLoad(() => api.getZone(zoneId), [zoneId]);
  const existing = useLoad(() => api.listRecords(zoneId, { page_size: 100 }), [zoneId]);

  const [method, setMethod] = useState<Method>("quick");
  const [drafts, setDrafts] = useState<RecordDraft[]>(() => [newDraft(nextKey++)]);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<number, DraftErrors>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const detailsHref = `/hostedzones/details/?id=${zoneId}`;
  const zoneLabel = zone ? bare(zone.name) : zoneId;

  const update = (key: number, patch: Partial<RecordDraft>) => {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setServerErrors(({ [key]: _, ...rest }) => rest);
  };

  // Same wording as the console's banner after records are created.
  function announce(names: string[]) {
    flash(
      "info",
      'Route 53 propagates your changes to all of the Route 53 authoritative DNS servers within 60 seconds. Use "View status" button to check propagation status.',
      {
        header: `${names.join(", ")} ${names.length > 1 ? "were" : "was"} successfully created.`,
        buttonText: "View status",
        onButtonClick: () =>
          flash("success", "Status: INSYNC. All Route 53 authoritative DNS servers have your changes."),
      },
    );
  }

  async function submit() {
    setSubmitted(true);
    setFormError("");
    if (drafts.some((d) => Object.keys(draftErrors(d)).length)) return;
    setBusy(true);
    const created: string[] = [];
    let remaining = drafts;
    for (const d of drafts) {
      try {
        const r = await api.createRecord(zoneId, draftToInput(d));
        created.push(bare(r.name));
        remaining = remaining.filter((x) => x.key !== d.key);
      } catch (e) {
        setDrafts(remaining);
        if (e instanceof ApiError && Object.keys(e.fieldErrors).length)
          setServerErrors({ [d.key]: e.fieldErrors });
        else setFormError(e instanceof Error ? e.message : String(e));
        if (created.length) announce(created);
        setBusy(false);
        return;
      }
    }
    announce(created);
    router.push(detailsHref);
  }

  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "Hosted zones", href: "/hostedzones/" },
        { text: zoneLabel, href: detailsHref },
        { text: "Create record", href: `/hostedzones/records/create/?zoneId=${zoneId}` },
      ]}
    >
      {zoneError ? (
        <Alert
          type="error"
          header="Unable to load hosted zone"
          action={
            <Button href="/hostedzones/" onFollow={follow}>
              Go to Hosted zones
            </Button>
          }
        >
          {zoneError.message}
        </Alert>
      ) : (
        <SpaceBetween size="l">
          {busy && (
            <Flashbar
              items={[
                {
                  type: "info",
                  loading: true,
                  header: `Creating record(s) for ${zoneLabel}`,
                  content: "This can take a moment.",
                },
              ]}
            />
          )}

          <ExpandableSection variant="container" headerText="Record creation method" defaultExpanded>
            <Tiles
              value={method}
              columns={2}
              onChange={(e) => setMethod(e.detail.value as Method)}
              items={[
                {
                  value: "quick",
                  label: "Quick create (recommended for expert users)",
                  description:
                    "Choose this method if you are confident in the process of creating records and know which options you need.",
                },
                {
                  value: "wizard",
                  label: "Wizard",
                  description:
                    "Choose this method if you want step-by-step guidance on creating records and routing policies.",
                },
              ]}
            />
          </ExpandableSection>

          {method === "wizard" ? (
            zone && (
              <RecordWizard
                zone={zone}
                onCancel={() => router.push(detailsHref)}
                onCreated={(r) => {
                  announce([bare(r.name)]);
                  router.push(detailsHref);
                }}
              />
            )
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Form
                header={
                  <Header variant="h1" info={<InfoLink help={RECORDS_HELP} />}>
                    Create record
                  </Header>
                }
                errorText={formError || undefined}
                actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button variant="link" href={detailsHref} onFollow={follow} disabled={busy}>
                      Cancel
                    </Button>
                    <Button variant="primary" formAction="submit" loading={busy} disabled={!zone}>
                      Create records
                    </Button>
                  </SpaceBetween>
                }
              >
                <Container
                  header={
                    <Header
                      variant="h2"
                      actions={
                        <Link variant="primary" onFollow={() => setMethod("wizard")}>
                          Switch to wizard
                        </Link>
                      }
                    >
                      Quick create record
                    </Header>
                  }
                  footer={
                    <Box float="right">
                      <Button
                        formAction="none"
                        onClick={() => setDrafts((ds) => [...ds, newDraft(nextKey++)])}
                      >
                        Add another record
                      </Button>
                    </Box>
                  }
                >
                  <SpaceBetween size="l">
                    {drafts.map((d, i) => (
                      <ExpandableSection
                        key={d.key}
                        defaultExpanded
                        headerText={`Record ${i + 1}`}
                        headerActions={
                          <Button
                            formAction="none"
                            disabled={drafts.length === 1}
                            onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                          >
                            Delete
                          </Button>
                        }
                      >
                        <RecordFields
                          draft={d}
                          zoneName={zone?.name ?? ""}
                          errors={{ ...(submitted ? draftErrors(d) : {}), ...serverErrors[d.key] }}
                          onChange={(patch) => update(d.key, patch)}
                        />
                      </ExpandableSection>
                    ))}
                  </SpaceBetween>
                </Container>
              </Form>
            </form>
          )}

          <ExpandableSection
            headerText="View existing records"
            headerDescription={`The following table lists the existing records in ${zoneLabel}.`}
          >
            <Table
              variant="embedded"
              items={existing.data?.items ?? []}
              loading={existing.loading}
              loadingText="Loading records"
              columnDefinitions={[
                { id: "name", header: "Record name", cell: (r) => bare(r.name), isRowHeader: true },
                { id: "type", header: "Type", cell: (r) => r.type },
                {
                  id: "values",
                  header: "Value/Route traffic to",
                  cell: (r) => <span className="values-cell">{r.values.join("\n")}</span>,
                },
                {
                  id: "ttl",
                  header: "TTL (seconds)",
                  cell: (r) => (r.ttl === null ? "-" : r.ttl.toLocaleString("en-US")),
                },
              ]}
              empty={<Box textAlign="center">No records</Box>}
            />
          </ExpandableSection>
        </SpaceBetween>
      )}
    </Shell>
  );
}
