"use client";

import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Textarea from "@cloudscape-design/components/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import TagsSection, { toEditable, toTags, type EditableTag } from "@/components/TagsSection";
import VpcEditor, { toVpcRows, toVpcs, vpcsValid, type VpcRow } from "@/components/VpcEditor";
import { InfoLink, ROUTE53_CRUMB, Shell, useConsole, useFollow } from "@/components/console";
import { ZONE_HELP } from "@/components/help";
import { api, ApiError, bare } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

export default function EditHostedZonePage() {
  const router = useRouter();
  const follow = useFollow();
  const { flash } = useConsole();
  const zoneId = useSearchParams().get("id") ?? "";
  const { data: zone, error } = useLoad(() => api.getZone(zoneId), [zoneId]);

  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<readonly EditableTag[]>([]);
  const [tagsValid, setTagsValid] = useState(true);
  const [vpcs, setVpcs] = useState<VpcRow[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (zone) {
      setDescription(zone.description);
      setTags(toEditable(zone.tags));
      setVpcs(toVpcRows(zone.vpcs));
    }
  }, [zone]);

  const detailsHref = `/hostedzones/details/?id=${zoneId}`;
  const label = zone ? bare(zone.name) : zoneId;
  const tooLong = description.length > 256;

  async function save() {
    setSubmitted(true);
    const isPrivate = zone?.zone_type === "private";
    if (!zone || tooLong || !tagsValid || (isPrivate && !vpcsValid(vpcs))) return;
    setBusy(true);
    setFormError("");
    try {
      const saved = await api.updateZone(zone.id, {
        description,
        tags: toTags(tags),
        ...(isPrivate ? { vpcs: toVpcs(vpcs) } : {}),
      });
      flash("success", `Hosted zone ${bare(saved.name)} was updated.`);
      router.push(detailsHref);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "Hosted zones", href: "/hostedzones/" },
        { text: label, href: detailsHref },
        { text: "Edit", href: `/hostedzones/edit/?id=${zoneId}` },
      ]}
    >
      {error ? (
        <Alert type="error" header="Unable to load hosted zone">
          {error.message}
        </Alert>
      ) : !zone ? (
        <Spinner size="large" />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Form
            header={
              <Header variant="h1" info={<InfoLink help={ZONE_HELP} />}>
                Edit {label}
              </Header>
            }
            errorText={formError || undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" href={detailsHref} onFollow={follow} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" formAction="submit" loading={busy} disabled={tooLong}>
                  Save changes
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween size="l">
              <Container
                header={
                  <Header
                    variant="h2"
                    description="A hosted zone is a container that holds information about how you want to route traffic for a domain, such as example.com, and its subdomains."
                  >
                    Edit hosted zone
                  </Header>
                }
              >
                <SpaceBetween size="l">
                  <KeyValuePairs
                    columns={1}
                    items={[
                      { label: "Domain name", value: label },
                      { label: "Hosted zone ID", value: zone.id },
                      { label: "Record count", value: zone.record_count },
                      {
                        label: "Type",
                        value: zone.zone_type === "public" ? "Public hosted zone" : "Private hosted zone",
                      },
                    ]}
                  />
                  <FormField
                    label={
                      <span>
                        Description <i>- optional</i>
                      </span>
                    }
                    info={<InfoLink help={ZONE_HELP} />}
                    description="This value lets you distinguish hosted zones that have the same name."
                    constraintText={`The description can have up to 256 characters. ${description.length}/256`}
                    errorText={tooLong ? "The description can have up to 256 characters." : undefined}
                  >
                    <Textarea
                      value={description}
                      placeholder="The hosted zone is used for..."
                      onChange={(e) => setDescription(e.detail.value)}
                      rows={3}
                    />
                  </FormField>
                </SpaceBetween>
              </Container>
              {zone.zone_type === "private" && (
                <Container
                  header={
                    <Header
                      variant="h2"
                      info={<InfoLink help={ZONE_HELP} />}
                      description="Choose the VPCs that can resolve DNS queries for this hosted zone. A private hosted zone needs at least one VPC."
                    >
                      VPCs to associate with the hosted zone
                    </Header>
                  }
                >
                  <VpcEditor rows={vpcs} onChange={setVpcs} showErrors={submitted} />
                </Container>
              )}
              <TagsSection
                tags={tags}
                info={<InfoLink help={ZONE_HELP} />}
                onChange={(t, valid) => {
                  setTags(t);
                  setTagsValid(valid);
                }}
              />
            </SpaceBetween>
          </Form>
        </form>
      )}
    </Shell>
  );
}
