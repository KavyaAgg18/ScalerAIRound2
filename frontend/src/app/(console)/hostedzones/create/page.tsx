"use client";

import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import { useRouter } from "next/navigation";
import { useState } from "react";
import TagsSection, { toTags, type EditableTag } from "@/components/TagsSection";
import VpcEditor, { emptyVpc, toVpcs, vpcsValid, type VpcRow } from "@/components/VpcEditor";
import { InfoLink, ROUTE53_CRUMB, Shell, useConsole, useFollow } from "@/components/console";
import { api, ApiError, bare } from "@/lib/api";
import type { ZoneType } from "@/lib/types";
import { zoneNameError } from "@/lib/validate";
import { DOMAIN_CHARS, ZONE_HELP } from "@/components/help";

export default function CreateHostedZonePage() {
  const router = useRouter();
  const follow = useFollow();
  const { flash } = useConsole();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [zoneType, setZoneType] = useState<ZoneType>("public");
  const [vpcs, setVpcs] = useState<VpcRow[]>([emptyVpc()]);
  const [tags, setTags] = useState<readonly EditableTag[]>([]);
  const [tagsValid, setTagsValid] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const isPrivate = zoneType === "private";
  const errors: Record<string, string | null> = {
    name: serverErrors.name ?? (submitted ? zoneNameError(name) : null),
    description: description.length > 256 ? "The description can have up to 256 characters." : null,
    tags: serverErrors.tags ?? null,
  };

  async function submit() {
    setSubmitted(true);
    setServerErrors({});
    setFormError("");
    const invalid =
      zoneNameError(name) || errors.description || !tagsValid || (isPrivate && !vpcsValid(vpcs));
    if (invalid) return;
    setBusy(true);
    try {
      const zone = await api.createZone({
        name,
        description,
        zone_type: zoneType,
        tags: toTags(tags),
        ...(isPrivate ? { vpcs: toVpcs(vpcs) } : {}),
      });
      flash("success", `${bare(zone.name)} was successfully created.`);
      router.push(`/hostedzones/details/?id=${zone.id}`);
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
        { text: "Create hosted zone", href: "/hostedzones/create/" },
      ]}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Form
          header={
            <Header variant="h1" info={<InfoLink help={ZONE_HELP} />}>
              Create hosted zone
            </Header>
          }
          errorText={formError || undefined}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" href="/hostedzones/" onFollow={follow} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" formAction="submit" loading={busy}>
                Create hosted zone
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
                  Hosted zone configuration
                </Header>
              }
            >
              <SpaceBetween size="l">
                <FormField
                  label="Domain name"
                  info={<InfoLink help={ZONE_HELP} />}
                  description="This is the name of the domain that you want to route traffic for."
                  constraintText={DOMAIN_CHARS}
                  errorText={errors.name}
                >
                  <Input
                    value={name}
                    placeholder="example.com"
                    onChange={(e) => {
                      setName(e.detail.value);
                      setServerErrors(({ name: _, ...rest }) => rest);
                    }}
                    ariaRequired
                  />
                </FormField>
                <FormField
                  label={
                    <span>
                      Description <i>- optional</i>
                    </span>
                  }
                  info={<InfoLink help={ZONE_HELP} />}
                  description="This value lets you distinguish hosted zones that have the same name."
                  constraintText={`The description can have up to 256 characters. ${description.length}/256`}
                  errorText={errors.description}
                >
                  <Textarea
                    value={description}
                    placeholder="The hosted zone is used for..."
                    onChange={(e) => setDescription(e.detail.value)}
                    rows={3}
                  />
                </FormField>
                <FormField
                  label="Type"
                  info={<InfoLink help={ZONE_HELP} />}
                  description="The type indicates whether you want to route traffic on the internet or in an Amazon VPC."
                >
                  <Tiles
                    value={zoneType}
                    onChange={(e) => setZoneType(e.detail.value as ZoneType)}
                    columns={2}
                    items={[
                      {
                        value: "public",
                        label: "Public hosted zone",
                        description: "A public hosted zone determines how traffic is routed on the internet.",
                      },
                      {
                        value: "private",
                        label: "Private hosted zone",
                        description:
                          "A private hosted zone determines how traffic is routed within an Amazon VPC.",
                      },
                    ]}
                  />
                </FormField>
              </SpaceBetween>
            </Container>

            {isPrivate && (
              <Container
                header={
                  <Header
                    variant="h2"
                    info={<InfoLink help={ZONE_HELP} />}
                    description="To use this hosted zone to resolve DNS queries for one or more VPCs, choose the VPCs. To associate a VPC with a hosted zone when the VPC was created using a different AWS account, you must use a programmatic method, such as the AWS CLI."
                  >
                    VPCs to associate with the hosted zone
                  </Header>
                }
              >
                <VpcEditor
                  rows={vpcs}
                  onChange={(rows) => {
                    setVpcs(rows);
                    setServerErrors(({ vpcs: _, ...rest }) => rest);
                  }}
                  showErrors={submitted}
                  serverError={serverErrors.vpcs}
                />
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
            {errors.tags && <Alert type="error">{errors.tags}</Alert>}
          </SpaceBetween>
        </Form>
      </form>
    </Shell>
  );
}
