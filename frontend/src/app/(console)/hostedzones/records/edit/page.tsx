"use client";

import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import RecordFields, {
  draftErrors,
  draftFromRecord,
  draftToInput,
  type DraftErrors,
  type RecordDraft,
} from "@/components/RecordFields";
import { ROUTE53_CRUMB, Shell, useConsole, useFollow } from "@/components/console";
import { api, ApiError, bare } from "@/lib/api";
import type { RecordUpdate } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";

export default function EditRecordPage() {
  const router = useRouter();
  const follow = useFollow();
  const { flash } = useConsole();
  const params = useSearchParams();
  const zoneId = params.get("zoneId") ?? "";
  const recordId = Number(params.get("id"));

  const { data, error } = useLoad(
    () => Promise.all([api.getZone(zoneId), api.getRecord(zoneId, recordId)]),
    [zoneId, recordId],
  );
  const [zone, record] = data ?? [null, null];

  const [draft, setDraft] = useState<RecordDraft | null>(null);
  useEffect(() => {
    if (zone && record) setDraft(draftFromRecord(record, zone.name));
  }, [zone, record]);

  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const detailsHref = `/hostedzones/details/?id=${zoneId}`;

  async function submit() {
    if (!draft || !record) return;
    setSubmitted(true);
    setFormError("");
    if (Object.keys(draftErrors(draft)).length) return;
    setBusy(true);
    try {
      const input = draftToInput(draft);
      // Name, type, routing policy and record ID can't change; the default SOA/NS only take TTL and values.
      const { name: _n, type: _t, routing_policy: _p, set_identifier: _s, ...editable } = input;
      const body: RecordUpdate = record.is_protected ? { ttl: input.ttl, values: input.values } : editable;
      await api.updateRecord(zoneId, record.id, body);
      flash("success", `Record ${bare(record.name)} (${record.type}) was successfully updated.`);
      router.push(detailsHref);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setServerErrors(e.fieldErrors);
      else setFormError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "Hosted zones", href: "/hostedzones/" },
        { text: zone ? bare(zone.name) : zoneId, href: detailsHref },
        { text: "Edit record", href: `/hostedzones/records/edit/?zoneId=${zoneId}&id=${recordId}` },
      ]}
    >
      {error ? (
        <Alert
          type="error"
          header="Unable to load record"
          action={
            <Button href={detailsHref} onFollow={follow}>
              Back to hosted zone
            </Button>
          }
        >
          {error.message}
        </Alert>
      ) : !draft || !zone || !record ? (
        <Spinner size="large" />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Form
            header={<Header variant="h1">Edit record</Header>}
            errorText={formError || undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" href={detailsHref} onFollow={follow} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" formAction="submit" loading={busy}>
                  Save
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween size="l">
              {record.is_protected && (
                <Alert type="warning">
                  Route 53 created this {record.type} record for the hosted zone. Changing it can make the
                  domain unreachable. You can&apos;t delete it.
                </Alert>
              )}
              <Container header={<Header variant="h2">Record details</Header>}>
                <RecordFields
                  editing
                  draft={draft}
                  zoneName={zone.name}
                  errors={{ ...(submitted ? draftErrors(draft) : {}), ...serverErrors }}
                  onChange={(patch) => {
                    setDraft({ ...draft, ...patch, type: draft.type });
                    setServerErrors({});
                  }}
                />
              </Container>
            </SpaceBetween>
          </Form>
        </form>
      )}
    </Shell>
  );
}
