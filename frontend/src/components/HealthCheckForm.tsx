"use client";

import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import { useState } from "react";
import { InfoLink, useFollow } from "@/components/console";
import { HEALTH_HELP } from "@/components/help";
import { ApiError } from "@/lib/api";
import type { HealthCheck, HealthCheckInput } from "@/lib/types";
import { isHostname } from "@/lib/validate";

type By = "ip" | "domain";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

interface Props {
  title: string;
  submitLabel: string;
  initial?: HealthCheck;
  onSubmit: (body: HealthCheckInput) => Promise<void>;
}

// Mirrors the console's "Configure health check" step for endpoint checks.
export default function HealthCheckForm({ title, submitLabel, initial, onSubmit }: Props) {
  const follow = useFollow();
  const info = <InfoLink help={HEALTH_HELP} />;
  const [name, setName] = useState(initial?.name ?? "");
  const [by, setBy] = useState<By>(initial?.domain_name ? "domain" : "ip");
  const [protocol, setProtocol] = useState<HealthCheck["protocol"]>(initial?.protocol ?? "HTTP");
  const [ip, setIp] = useState(initial?.ip_address ?? "");
  const [domain, setDomain] = useState(initial?.domain_name ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 80));
  const [path, setPath] = useState((initial?.resource_path ?? "/").replace(/^\//, ""));
  const [interval, setIntervalValue] = useState<"10" | "30">(
    String(initial?.request_interval ?? 30) as "10" | "30",
  );
  const [threshold, setThreshold] = useState(String(initial?.failure_threshold ?? 3));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const errors = {
    ip_address:
      serverErrors.ip_address ??
      (submitted && by === "ip" && !IPV4.test(ip.trim()) && !ip.includes(":")
        ? "Enter a valid IP address."
        : null),
    domain_name:
      serverErrors.domain_name ??
      (submitted && by === "domain" && !isHostname(domain) ? "Enter a valid domain name." : null),
    port:
      submitted && !(/^\d+$/.test(port) && +port >= 1 && +port <= 65535)
        ? "Enter a port from 1 to 65535."
        : null,
    failure_threshold:
      submitted && !(/^\d+$/.test(threshold) && +threshold >= 1 && +threshold <= 10)
        ? "Enter a number from 1 to 10."
        : null,
  };

  async function submit() {
    setSubmitted(true);
    setServerErrors({});
    setFormError("");
    const invalid =
      (by === "ip" ? !ip.trim() : !isHostname(domain)) ||
      Object.values(errors).some(Boolean) ||
      !/^\d+$/.test(port) ||
      !/^\d+$/.test(threshold);
    if (invalid) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        protocol,
        ip_address: by === "ip" ? ip.trim() : null,
        domain_name: by === "domain" ? domain.trim() : null,
        port: Number(port),
        resource_path: protocol === "TCP" ? null : `/${path.replace(/^\//, "")}`,
        request_interval: Number(interval) as 10 | 30,
        failure_threshold: Number(threshold),
      });
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setServerErrors(e.fieldErrors);
      else setFormError(e instanceof Error ? e.message : String(e));
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
            <Button variant="link" href="/healthchecks/" onFollow={follow} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" formAction="submit" loading={busy}>
              {submitLabel}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Configure health check</Header>}>
            <SpaceBetween size="l">
              <FormField label="Name" info={info} description="A name for this health check.">
                <Input
                  value={name}
                  onChange={(e) => setName(e.detail.value)}
                  placeholder="my-health-check"
                  ariaLabel="Name"
                />
              </FormField>
              <FormField label="What to monitor" info={info}>
                <RadioGroup
                  value="endpoint"
                  items={[
                    { value: "endpoint", label: "Endpoint" },
                    {
                      value: "other",
                      label: "Status of other health checks (calculated health check)",
                      disabled: true,
                    },
                    { value: "alarm", label: "State of CloudWatch alarm", disabled: true },
                  ]}
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h2">Monitor an endpoint</Header>}>
            <SpaceBetween size="l">
              <FormField label="Specify endpoint by" info={info}>
                <Tiles
                  value={by}
                  columns={2}
                  onChange={(e) => setBy(e.detail.value as By)}
                  items={[
                    { value: "ip", label: "IP address" },
                    { value: "domain", label: "Domain name" },
                  ]}
                />
              </FormField>
              <FormField label="Protocol" info={info}>
                <Select
                  selectedOption={{ value: protocol, label: protocol }}
                  options={["HTTP", "HTTPS", "TCP"].map((p) => ({ value: p, label: p }))}
                  onChange={(e) => {
                    const p = e.detail.selectedOption.value as HealthCheck["protocol"];
                    setProtocol(p);
                    setPort(p === "HTTPS" ? "443" : "80");
                  }}
                  ariaLabel="Protocol"
                />
              </FormField>
              {by === "ip" ? (
                <FormField label="IP address" info={info} errorText={errors.ip_address}>
                  <Input
                    value={ip}
                    onChange={(e) => setIp(e.detail.value)}
                    placeholder="192.0.2.44"
                    ariaLabel="IP address"
                  />
                </FormField>
              ) : (
                <FormField label="Domain name" info={info} errorText={errors.domain_name}>
                  <Input
                    value={domain}
                    onChange={(e) => setDomain(e.detail.value)}
                    placeholder="www.example.com"
                    ariaLabel="Domain name"
                  />
                </FormField>
              )}
              <FormField label="Port" info={info} errorText={errors.port}>
                <Input
                  value={port}
                  inputMode="numeric"
                  onChange={(e) => setPort(e.detail.value)}
                  ariaLabel="Port"
                />
              </FormField>
              {protocol !== "TCP" && (
                <FormField
                  label={
                    <span>
                      Path <i>- optional</i>
                    </span>
                  }
                  info={info}
                  description="The path Route 53 requests, for example images/test.jpg."
                >
                  <Input
                    value={path}
                    onChange={(e) => setPath(e.detail.value)}
                    placeholder="images/test.jpg"
                    ariaLabel="Path"
                  />
                </FormField>
              )}
              <ExpandableSection headerText="Advanced configuration">
                <SpaceBetween size="l">
                  <FormField label="Request interval" info={info}>
                    <RadioGroup
                      value={interval}
                      onChange={(e) => setIntervalValue(e.detail.value as "10" | "30")}
                      items={[
                        { value: "30", label: "Standard (30 seconds)" },
                        { value: "10", label: "Fast (10 seconds)" },
                      ]}
                    />
                  </FormField>
                  <FormField
                    label="Failure threshold"
                    info={info}
                    description="Consecutive failed checks before the endpoint is considered unhealthy."
                    errorText={errors.failure_threshold}
                  >
                    <Input
                      value={threshold}
                      inputMode="numeric"
                      onChange={(e) => setThreshold(e.detail.value)}
                      ariaLabel="Failure threshold"
                    />
                  </FormField>
                </SpaceBetween>
              </ExpandableSection>
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </Form>
    </form>
  );
}
