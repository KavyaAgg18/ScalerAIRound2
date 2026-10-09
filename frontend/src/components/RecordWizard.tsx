"use client";

import Alert from "@cloudscape-design/components/alert";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import Wizard from "@cloudscape-design/components/wizard";
import { useState } from "react";
import RecordFields, {
  draftErrors,
  draftToInput,
  newDraft,
  type DraftErrors,
} from "@/components/RecordFields";
import { InfoLink } from "@/components/console";
import { RECORDS_HELP } from "@/components/help";
import { differentiator } from "@/lib/recordText";
import { api, ApiError, bare } from "@/lib/api";
import { POLICY_LABELS, type HostedZone, type RecordSet, type RoutingPolicy } from "@/lib/types";
import { splitValues } from "@/lib/validate";

const POLICIES = [
  ["simple", "Simple routing", "Route traffic to a single resource, such as a web server."],
  ["weighted", "Weighted", "Route traffic to multiple resources in proportions that you specify."],
  ["geolocation", "Geolocation", "Route traffic based on the location of your users."],
  ["latency", "Latency", "Route traffic to the Region that provides the best latency."],
  [
    "failover",
    "Failover",
    "Route traffic to a healthy resource, or to a backup when the primary is unhealthy.",
  ],
  [
    "multivalue",
    "Multivalue answer",
    "Respond to DNS queries with up to eight healthy records selected at random.",
  ],
  ["ip", "IP-based", "Route traffic based on the IP address of your users."],
  ["geoproximity", "Geoproximity", "Route traffic based on the location of your resources and users."],
].map(([value, label, description]) => ({ value, label, description }));

interface Props {
  zone: HostedZone;
  onCancel: () => void;
  onCreated: (record: RecordSet) => void;
}

/** The console's "Wizard" record creation method: routing policy, record details, review. */
export default function RecordWizard({ zone, onCancel, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => newDraft(0));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const clientErrors = draftErrors(draft);
  const name = draft.name.trim() ? `${draft.name.trim()}.${bare(zone.name)}` : bare(zone.name);

  async function submit() {
    setBusy(true);
    setFormError("");
    try {
      onCreated(await api.createRecord(zone.id, draftToInput(draft)));
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) {
        setServerErrors(e.fieldErrors);
        setStep(1);
      } else {
        setFormError(e instanceof Error ? e.message : String(e));
      }
      setBusy(false);
    }
  }

  return (
    <Wizard
      activeStepIndex={step}
      isLoadingNextStep={busy}
      onCancel={onCancel}
      onSubmit={submit}
      submitButtonText="Create records"
      onNavigate={(e) => {
        // Don't leave the record step while it has errors.
        if (step === 1 && e.detail.requestedStepIndex > 1 && Object.keys(clientErrors).length) {
          setShowErrors(true);
          return;
        }
        setStep(e.detail.requestedStepIndex);
      }}
      i18nStrings={{
        stepNumberLabel: (n) => `Step ${n}`,
        navigationAriaLabel: "Steps",
        cancelButton: "Cancel",
        previousButton: "Previous",
        nextButton: "Next",
        optional: "optional",
      }}
      steps={[
        {
          title: "Choose routing policy",
          info: <InfoLink help={RECORDS_HELP} />,
          description: "The routing policy determines how Route 53 responds to queries for this record.",
          content: (
            <Container header={<Header variant="h2">Routing policy</Header>}>
              <Tiles
                value={draft.routing_policy}
                columns={2}
                items={POLICIES}
                onChange={(e) => setDraft({ ...draft, routing_policy: e.detail.value as RoutingPolicy })}
              />
            </Container>
          ),
        },
        {
          title: "Configure records",
          info: <InfoLink help={RECORDS_HELP} />,
          content: (
            <Container header={<Header variant="h2">Record details</Header>}>
              <RecordFields
                draft={draft}
                zoneName={zone.name}
                hidePolicy
                errors={{ ...(showErrors ? clientErrors : {}), ...serverErrors }}
                onChange={(patch) => {
                  setDraft({ ...draft, ...patch });
                  setServerErrors({});
                }}
              />
            </Container>
          ),
        },
        {
          title: "Review and create",
          content: (
            <SpaceBetween size="l">
              {formError && <Alert type="error">{formError}</Alert>}
              <Container header={<Header variant="h2">Record to create</Header>}>
                <KeyValuePairs
                  columns={2}
                  items={[
                    { label: "Record name", value: name },
                    { label: "Record type", value: draft.type },
                    {
                      label: "Routing policy",
                      value: POLICY_LABELS[draft.routing_policy],
                    },
                    { label: "TTL (seconds)", value: draft.alias ? "-" : draft.ttl },
                    draft.alias
                      ? { label: "Route traffic to", value: draft.alias_target || "-" }
                      : {
                          label: "Value",
                          value: <span className="values-cell">{splitValues(draft.values).join("\n")}</span>,
                        },
                    ...(draft.routing_policy !== "simple"
                      ? [
                          { label: "Differentiator", value: differentiator(draftToInput(draft)) },
                          { label: "Record ID", value: draft.set_identifier || "-" },
                        ]
                      : []),
                  ]}
                />
              </Container>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}
