import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apiMock, flash, page, record, router, setUrl, zone } from "@/test/mocks";
import CreateRecordPage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

// Each record is an expandable "Record N" block inside the Quick create container.
const blockWrappers = (c: HTMLElement) =>
  createWrapper(c)
    .findAllExpandableSections()
    .filter((s) => /^Record \d+$/.test(s.findHeaderText()?.getElement().textContent ?? ""));
const blocks = (c: HTMLElement) => blockWrappers(c).map((s) => within(s.getElement()));
const submit = () => userEvent.click(screen.getByRole("button", { name: "Create records" }));
const ready = () => screen.findByText(".example.com");

describe("Create record", () => {
  beforeEach(() => {
    setUrl("/hostedzones/records/create/", "zoneId=Z1");
    apiMock.listHealthChecks.mockResolvedValue(page([]));
    apiMock.getZone.mockResolvedValue(zone({ id: "Z1", name: "example.com." }));
    apiMock.listRecords.mockResolvedValue(
      page([record({ name: "existing.example.com.", values: ["192.0.2.50"] })]),
    );
  });

  it("matches the console layout: creation method, Create record heading, Quick create", async () => {
    render(<CreateRecordPage />);
    await ready();
    expect(screen.getByText("Record creation method")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /Create record/ })).toBeInTheDocument();
    expect(screen.getByText("Quick create record")).toBeInTheDocument();
    expect(screen.getByText("Switch to wizard")).toBeInTheDocument();
    // Existing records are listed under "View existing records".
    await userEvent.click(screen.getByText("View existing records"));
    expect(await screen.findByText("existing.example.com")).toBeInTheDocument();
  });

  it("shows field errors and doesn't call the API for invalid input", async () => {
    const { container } = render(<CreateRecordPage />);
    await ready();
    const [r1] = blocks(container);
    await userEvent.type(r1.getByLabelText("Record name"), "bad name");
    await userEvent.type(r1.getByLabelText("Value"), "999.1.1.1");
    await userEvent.clear(r1.getByLabelText("TTL (seconds)"));
    await userEvent.type(r1.getByLabelText("TTL (seconds)"), "-5");
    await submit();
    expect(screen.getByText(/"bad name" isn't a valid label/)).toBeInTheDocument();
    expect(screen.getByText(/"999.1.1.1" isn't a valid IPv4 address/)).toBeInTheDocument();
    expect(screen.getByText("Enter a TTL in seconds (a whole number).")).toBeInTheDocument();
    expect(apiMock.createRecord).not.toHaveBeenCalled();
  });

  it("creates several records in order and announces them like the console", async () => {
    apiMock.createRecord
      .mockResolvedValueOnce(record({ name: "www.example.com.", type: "A" }))
      .mockResolvedValueOnce(record({ name: "example.com.", type: "TXT" }));
    const { container } = render(<CreateRecordPage />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Add another record" }));
    const [r1, r2] = blocks(container);

    await userEvent.type(r1.getByLabelText("Record name"), "www");
    await userEvent.type(r1.getByLabelText("Value"), "192.0.2.1\n192.0.2.2");
    const typeSelect = blockWrappers(container)[1].findContent().findSelect()!;
    typeSelect.openDropdown();
    typeSelect.selectOptionByValue("TXT");
    await userEvent.type(r2.getByLabelText("Value"), '"v=spf1 -all"');
    await userEvent.click(r2.getByRole("button", { name: "1h" }));
    await submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=Z1"));
    expect(apiMock.createRecord.mock.calls).toEqual([
      [
        "Z1",
        expect.objectContaining({
          name: "www",
          type: "A",
          ttl: 300,
          values: ["192.0.2.1", "192.0.2.2"],
          routing_policy: "simple",
          set_identifier: null,
          alias: null,
        }),
      ],
      [
        "Z1",
        expect.objectContaining({
          name: "",
          type: "TXT",
          ttl: 3600,
          values: ['"v=spf1 -all"'],
          routing_policy: "simple",
          set_identifier: null,
          alias: null,
        }),
      ],
    ]);
    const [type, content, extra] = flash.mock.calls[0];
    expect(type).toBe("info");
    expect(content).toMatch(/propagates your changes .* within 60 seconds/);
    expect(extra.header).toBe("www.example.com, example.com were successfully created.");
    expect(extra.buttonText).toBe("View status");
  });

  it("unsupported record types are listed but disabled", async () => {
    const { container } = render(<CreateRecordPage />);
    await ready();
    const typeSelect = blockWrappers(container)[0].findContent().findSelect()!;
    typeSelect.openDropdown();
    expect(screen.getByRole("option", { name: /^SPF – Not recommended/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: /^CAA – Restricts CAs/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("stops at the first server error, keeps the failed record and reports created ones", async () => {
    apiMock.createRecord
      .mockResolvedValueOnce(record({ name: "a.example.com.", type: "A" }))
      .mockRejectedValueOnce(
        new ApiError(409, "A record named b.example.com with type A already exists.", {
          name: "A record named b.example.com with type A already exists.",
        }),
      );
    const { container } = render(<CreateRecordPage />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Add another record" }));
    const [r1, r2] = blocks(container);
    await userEvent.type(r1.getByLabelText("Record name"), "a");
    await userEvent.type(r1.getByLabelText("Value"), "1.1.1.1");
    await userEvent.type(r2.getByLabelText("Record name"), "b");
    await userEvent.type(r2.getByLabelText("Value"), "2.2.2.2");
    await submit();

    expect(
      await screen.findByText("A record named b.example.com with type A already exists."),
    ).toBeInTheDocument();
    expect(flash.mock.calls[0][2].header).toBe("a.example.com was successfully created.");
    expect(router.push).not.toHaveBeenCalled();
    const left = blocks(container);
    expect(left).toHaveLength(1);
    expect(left[0].getByLabelText("Record name")).toHaveValue("b");
  });

  it("removes a record block; the only block can't be removed", async () => {
    const { container } = render(<CreateRecordPage />);
    await ready();
    expect(blocks(container)[0].getByRole("button", { name: "Delete" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add another record" }));
    expect(blocks(container)).toHaveLength(2);
    await userEvent.click(blocks(container)[1].getByRole("button", { name: "Delete" }));
    expect(blocks(container)).toHaveLength(1);
  });

  it("wizard: routing policy, record details, review, create", async () => {
    apiMock.createRecord.mockResolvedValue(record({ name: "app.example.com.", type: "A" }));
    const { container } = render(<CreateRecordPage />);
    await ready();
    await userEvent.click(screen.getByText("Switch to wizard"));
    const wizard = createWrapper(container).findWizard()!;
    expect(wizard.findHeader()!.getElement()).toHaveTextContent("Choose routing policy");

    wizard.findContent()!.findTiles()!.findItemByValue("weighted")!.click();
    wizard.findPrimaryButton().click();
    expect(await screen.findByText("Record details")).toBeInTheDocument();

    // Next is blocked until the record is valid.
    wizard.findPrimaryButton().click();
    expect(await screen.findByText("Enter at least one value.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Record name"), "app");
    await userEvent.type(screen.getByLabelText("Value"), "192.0.2.9");
    await userEvent.type(screen.getByLabelText("Weight", { exact: true }), "40");
    await userEvent.type(screen.getByLabelText("Record ID", { exact: true }), "blue");
    wizard.findPrimaryButton().click();
    expect(await screen.findByText("app.example.com")).toBeInTheDocument();

    wizard.findPrimaryButton().click(); // Create records
    await waitFor(() =>
      expect(apiMock.createRecord).toHaveBeenCalledWith(
        "Z1",
        expect.objectContaining({
          name: "app",
          type: "A",
          ttl: 300,
          values: ["192.0.2.9"],
          routing_policy: "weighted",
          set_identifier: "blue",
          weight: 40,
          health_check_id: null,
        }),
      ),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=Z1"));
  });

  it("shows an error when the zone can't be loaded", async () => {
    apiMock.getZone.mockRejectedValue(new ApiError(404, "No hosted zone found with ID: Z1"));
    render(<CreateRecordPage />);
    expect(await screen.findByText("Unable to load hosted zone")).toBeInTheDocument();
  });
});
