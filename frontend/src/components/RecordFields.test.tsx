import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiMock, page } from "@/test/mocks";
import RecordFields, { draftErrors, draftToInput, newDraft, type RecordDraft } from "./RecordFields";

vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

beforeEach(() => {
  apiMock.listHealthChecks.mockResolvedValue(page([]));
  apiMock.listCidrCollections.mockResolvedValue([]);
});

function Harness({ initial, editing }: { initial: Partial<RecordDraft>; editing?: boolean }) {
  const [d, setD] = useState<RecordDraft>({ ...newDraft(1), ...initial });
  return (
    <>
      <RecordFields
        draft={d}
        zoneName="example.com."
        errors={draftErrors(d)}
        onChange={(p) => setD({ ...d, ...p })}
        editing={editing}
      />
      <output data-testid="state">{JSON.stringify(d)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as RecordDraft;

describe("draftErrors / draftToInput", () => {
  it("flags every invalid field", () => {
    const e = draftErrors({
      ...newDraft(1),
      name: "bad name",
      values: "",
      ttl: "x",
      routing_policy: "weighted",
    });
    expect(Object.keys(e).sort()).toEqual(["name", "set_identifier", "ttl", "values", "weight"]);
  });

  it("passes a valid simple A record and converts it to API input", () => {
    const d = { ...newDraft(1), name: " www ", values: "192.0.2.1\n192.0.2.1\n192.0.2.2", ttl: "60" };
    expect(draftErrors(d)).toEqual({});
    expect(draftToInput(d)).toMatchObject({
      name: "www",
      type: "A",
      ttl: 60,
      values: ["192.0.2.1", "192.0.2.2"],
      routing_policy: "simple",
      set_identifier: null,
      weight: null,
      alias: null,
    });
  });

  it("validates weighted fields and keeps them in the input", () => {
    const d = {
      ...newDraft(1),
      values: "1.1.1.1",
      routing_policy: "weighted" as const,
      set_identifier: "blue",
      weight: "256",
    };
    expect(draftErrors(d)).toEqual({ weight: "Enter a weight between 0 and 255." });
    expect(draftToInput({ ...d, weight: "10" })).toMatchObject({ set_identifier: "blue", weight: 10 });
  });

  it("leaves SOA validation to the server", () => {
    expect(draftErrors({ ...newDraft(1), type: "SOA", values: "anything" })).toEqual({});
  });
});

describe("RecordFields", () => {
  it("shows the zone suffix, type-specific placeholder and conditional errors", () => {
    const { container } = render(<Harness initial={{ type: "MX", values: "mail.example.com" }} />);
    expect(screen.getByText(".example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10 mailserver.example.com")).toBeInTheDocument();
    const w = createWrapper(container);
    expect(w.findSelect()!.findTrigger().getElement()).toHaveTextContent("MX – Specifies mail servers");
    expect(screen.getByText(/Use the format \[priority\] \[mail server host name\]/)).toBeInTheDocument();
  });

  it("TTL preset buttons set the TTL", async () => {
    render(<Harness initial={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "1h" }));
    expect(state().ttl).toBe("3600");
    await userEvent.click(screen.getByRole("button", { name: "1d" }));
    expect(state().ttl).toBe("86400");
  });

  it("changing the record type and routing policy updates the draft and reveals weighted fields", () => {
    const { container } = render(<Harness initial={{}} />);
    const [typeSelect, policySelect] = createWrapper(container).findAllSelects();
    typeSelect.openDropdown();
    typeSelect.selectOptionByValue("CNAME");
    expect(state().type).toBe("CNAME");
    expect(screen.getByText("Enter one value.")).toBeInTheDocument();

    expect(screen.queryByText("Weight")).not.toBeInTheDocument();
    policySelect.openDropdown();
    policySelect.selectOptionByValue("weighted");
    expect(state().routing_policy).toBe("weighted");
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Record ID")).toBeInTheDocument();
  });

  it("offers every routing policy and an alias target in place of values", () => {
    const { container } = render(<Harness initial={{}} />);
    const policySelect = createWrapper(container).findAllSelects()[1];
    policySelect.openDropdown();
    for (const name of [/Latency/, /Weighted/, /Failover/, /Geolocation/, /IP-based/])
      expect(screen.getByRole("option", { name })).not.toHaveAttribute("aria-disabled", "true");
    policySelect.selectOptionByValue("simple");

    createWrapper(container).findToggle()!.findNativeInput().click();
    expect(state().alias).toBe(true);
    expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
    expect(screen.getByText("Route traffic to")).toBeInTheDocument();
  });

  it("converts alias and failover drafts to API input", () => {
    const alias = {
      ...newDraft(1),
      alias: true,
      alias_type: "elb" as const,
      alias_region: "us-east-1",
      alias_target: "my-lb-123.us-east-1.elb.amazonaws.com",
    };
    expect(draftToInput(alias)).toMatchObject({
      values: [],
      alias: { target_type: "elb", region: "us-east-1", dns_name: "my-lb-123.us-east-1.elb.amazonaws.com" },
    });
    const failover = {
      ...newDraft(1),
      values: "192.0.2.1",
      routing_policy: "failover" as const,
      set_identifier: "primary",
      failover: "PRIMARY" as const,
      health_check_id: "hc-1",
    };
    expect(draftErrors(failover)).toEqual({});
    expect(draftToInput(failover)).toMatchObject({
      failover: "PRIMARY",
      health_check_id: "hc-1",
      weight: null,
    });
  });

  it("locks name, type and routing policy when editing", () => {
    const { container } = render(<Harness initial={{ name: "www" }} editing />);
    expect(screen.getByLabelText("Record name")).toBeDisabled();
    for (const s of createWrapper(container).findAllSelects()) expect(s.isDisabled()).toBe(true);
    expect(screen.getByLabelText("Value")).toBeEnabled();
  });
});
