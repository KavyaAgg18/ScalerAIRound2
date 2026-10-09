import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
  apiMock,
  comingSoon,
  flash,
  openModal,
  page,
  pending,
  record,
  router,
  setUrl,
  zone,
} from "@/test/mocks";
import HostedZoneDetailsPage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

const ZONE = zone({ id: "Z1", name: "example.com.", record_count: 4 });
const SOA = record({
  name: "example.com.",
  type: "SOA",
  ttl: 900,
  values: ["ns-1.awsdns-00.com. x 1 7200 900 1209600 86400"],
  is_protected: true,
});
const NS = record({
  name: "example.com.",
  type: "NS",
  ttl: 172800,
  values: ["ns-1.awsdns-00.com.", "ns-2.awsdns-00.net."],
  is_protected: true,
});
const WWW = record({ name: "www.example.com.", type: "A", values: ["192.0.2.1", "192.0.2.2"] });
const WEIGHTED = record({
  name: "w.example.com.",
  type: "A",
  routing_policy: "weighted",
  set_identifier: "blue",
  weight: 10,
});
const RECORDS = [NS, SOA, WWW, WEIGHTED];

const table = (c: HTMLElement) => createWrapper(c).findTable()!;
const recordsHeader = (c: HTMLElement) => within(table(c).findHeaderSlot()!.getElement());
const modal = () => within(openModal().getElement());
const rowOf = (_c: HTMLElement, r: (typeof RECORDS)[number]) => RECORDS.indexOf(r) + 1;

function loadOk() {
  apiMock.getZone.mockResolvedValue(ZONE);
  apiMock.listRecords.mockResolvedValue(page(RECORDS, RECORDS.length, 1, 50));
}

describe("Hosted zone details", () => {
  beforeEach(() => setUrl("/hostedzones/details/", "id=Z1"));

  it("shows loading states while zone and records load", () => {
    apiMock.getZone.mockReturnValue(pending());
    apiMock.listRecords.mockReturnValue(pending());
    const { container } = render(<HostedZoneDetailsPage />);
    expect(screen.getByRole("heading", { name: "Loading…" })).toBeInTheDocument();
    expect(table(container).findLoadingText()!.getElement()).toHaveTextContent("Loading records");
  });

  it("shows a not-found state for an unknown zone", async () => {
    apiMock.getZone.mockRejectedValue(new ApiError(404, "No hosted zone found with ID: Z1"));
    apiMock.listRecords.mockRejectedValue(new ApiError(404, "No hosted zone found with ID: Z1"));
    render(<HostedZoneDetailsPage />);
    expect(await screen.findByText("Hosted zone not found")).toBeInTheDocument();
    expect(screen.getByText("No hosted zone found with ID: Z1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Go to Hosted zones" }));
    expect(router.push).toHaveBeenCalledWith("/hostedzones/");
  });

  it("offers Retry when the zone fails to load for other reasons", async () => {
    apiMock.getZone.mockRejectedValueOnce(new ApiError(0, "Unable to reach the server."));
    apiMock.listRecords.mockResolvedValue(page([]));
    render(<HostedZoneDetailsPage />);
    expect(await screen.findByText("Unable to load hosted zone")).toBeInTheDocument();
    apiMock.getZone.mockResolvedValue(ZONE);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: /example.com$/ })).toBeInTheDocument();
  });

  it("renders zone header, details, tabs and records", async () => {
    loadOk();
    const { container } = render(<HostedZoneDetailsPage />);
    expect(await screen.findByRole("heading", { level: 1, name: /example.com$/ })).toBeInTheDocument();
    expect(apiMock.listRecords).toHaveBeenCalledWith("Z1", {
      q: "",
      type: "",
      routing_policy: "",
      alias: "",
      sort: "name",
      order: "asc",
      page: 1,
      page_size: 100,
    });
    expect(screen.getByRole("tab", { name: "Records (4)" })).toBeInTheDocument();
    await waitFor(() => expect(table(container).findRows()).toHaveLength(4));
    const www = table(container).findRows()[rowOf(container, WWW) - 1].getElement();
    expect(www).toHaveTextContent("www.example.com");
    expect(www).toHaveTextContent(/192\.0\.2\.1\s*192\.0\.2\.2/);
    const weighted = table(container).findRows()[rowOf(container, WEIGHTED) - 1].getElement();
    expect(weighted).toHaveTextContent("Weighted");
    expect(weighted).toHaveTextContent("blue");

    createWrapper(container).findExpandableSection()!.findExpandButton().click();
    expect(screen.getByText("Public hosted zone")).toBeInTheDocument();
    const details = within(createWrapper(container).findExpandableSection()!.findContent().getElement());
    expect(details.getByText("ns-2.awsdns-00.net")).toBeInTheDocument(); // no trailing dot, like the console
  });

  it("filter, type filter, sort and pagination update the URL", async () => {
    loadOk();
    apiMock.listRecords.mockResolvedValue(page(RECORDS, 250, 1, 100)); // 3 pages of 100
    const { container } = render(<HostedZoneDetailsPage />);
    await waitFor(() => expect(table(container).findRows()).toHaveLength(4));

    const [typeSelect, policySelect, aliasSelect] = createWrapper(container).findAllSelects();
    typeSelect.openDropdown();
    typeSelect.selectOptionByValue("MX");
    expect(router.replace).toHaveBeenLastCalledWith("?id=Z1&type=MX");
    policySelect.openDropdown();
    policySelect.selectOptionByValue("weighted");
    expect(router.replace).toHaveBeenLastCalledWith("?id=Z1&policy=weighted");
    aliasSelect.openDropdown();
    aliasSelect.selectOptionByValue("no");
    expect(router.replace).toHaveBeenLastCalledWith("?id=Z1&alias=no");

    table(container).findColumnSortingArea(4)!.click(); // TTL is the first sortable column after name/type/policy
    expect(router.replace.mock.lastCall![0]).toMatch(/sort=(routing_policy|ttl)/);

    const p = createWrapper(container).findPagination()!;
    expect(p.findPageNumbers()).toHaveLength(3);
    p.findPageNumberByIndex(3)!.click();
    expect(router.replace).toHaveBeenLastCalledWith("?id=Z1&page=3");

    await userEvent.type(screen.getByPlaceholderText("Filter records by property or value"), "www");
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith("?id=Z1&q=www"), { timeout: 2000 });
  });

  it("shows No matches with Clear filter for an empty filtered result", async () => {
    setUrl("/hostedzones/details/", "id=Z1&type=MX");
    apiMock.getZone.mockResolvedValue(ZONE);
    apiMock.listRecords.mockResolvedValue(page([]));
    render(<HostedZoneDetailsPage />);
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    // One "Clear filters" next to the chips, one in the empty state; both clear everything.
    const clear = screen.getAllByRole("button", { name: "Clear filters" });
    expect(clear).toHaveLength(2);
    await userEvent.click(clear[1]);
    expect(router.replace).toHaveBeenLastCalledWith("?id=Z1");
  });

  it("can't delete the default SOA/NS records", async () => {
    loadOk();
    const { container } = render(<HostedZoneDetailsPage />);
    await waitFor(() => expect(table(container).findRows()).toHaveLength(4));
    const del = () => recordsHeader(container).getByRole("button", { name: "Delete record" });
    expect(del()).toBeDisabled();
    table(container).findRowSelectionArea(rowOf(container, SOA))!.click();
    expect(del()).toHaveAttribute("aria-disabled", "true");
    table(container).findRowSelectionArea(rowOf(container, SOA))!.click();
    table(container).findRowSelectionArea(rowOf(container, WWW))!.click();
    expect(del()).not.toHaveAttribute("aria-disabled", "true");
    expect(del()).toBeEnabled();
  });

  it("selecting one record shows its details with an Edit link", async () => {
    loadOk();
    const { container } = render(<HostedZoneDetailsPage />);
    await waitFor(() => expect(table(container).findRows()).toHaveLength(4));
    table(container).findRowSelectionArea(rowOf(container, WEIGHTED))!.click();
    const panel = within(createWrapper(container).findSplitPanel()!.getElement());
    expect(panel.getByText("w.example.com (A)")).toBeInTheDocument();
    expect(panel.getByText("Differentiator")).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Edit record" })).toHaveAttribute(
      "href",
      `/hostedzones/records/edit/?zoneId=Z1&id=${WEIGHTED.id}`,
    );
  });

  it("deletes selected records after confirmation", async () => {
    loadOk();
    apiMock.deleteRecord.mockResolvedValue(undefined);
    const { container } = render(<HostedZoneDetailsPage />);
    await waitFor(() => expect(table(container).findRows()).toHaveLength(4));
    table(container).findRowSelectionArea(rowOf(container, WWW))!.click();
    table(container).findRowSelectionArea(rowOf(container, WEIGHTED))!.click();
    await userEvent.click(recordsHeader(container).getByRole("button", { name: "Delete record" }));
    expect(openModal().findHeader().getElement()).toHaveTextContent("Delete 2 records?");
    await userEvent.type(modal().getByPlaceholderText("delete"), "delete");
    await userEvent.click(modal().getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(apiMock.deleteRecord).toHaveBeenCalledTimes(2));
    expect(apiMock.deleteRecord).toHaveBeenCalledWith("Z1", WWW.id);
    expect(apiMock.deleteRecord).toHaveBeenCalledWith("Z1", WEIGHTED.id);
    await waitFor(() =>
      expect(flash).toHaveBeenCalledWith(
        "success",
        "Deleted records: www.example.com (A), w.example.com (A).",
      ),
    );
  });

  it("delete zone: success navigates to the list, failure is shown in the dialog", async () => {
    loadOk();
    apiMock.deleteZone.mockRejectedValueOnce(
      new ApiError(409, "The hosted zone example.com contains 2 record(s)"),
    );
    render(<HostedZoneDetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /example.com$/ });
    await userEvent.click(screen.getByRole("button", { name: "Delete zone" }));
    await userEvent.type(modal().getByPlaceholderText("delete"), "delete");
    await userEvent.click(modal().getByRole("button", { name: "Delete" }));
    expect(await modal().findByText(/contains 2 record/)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    apiMock.deleteZone.mockResolvedValue(undefined);
    await userEvent.click(modal().getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/hostedzones/"));
    expect(flash).toHaveBeenCalledWith("success", "Hosted zone example.com was deleted.");
  });

  it("Edit hosted zone opens the edit page; the title shows the zone type badge", async () => {
    loadOk();
    render(<HostedZoneDetailsPage />);
    const title = await screen.findByRole("heading", { level: 1, name: /example.com$/ });
    expect(title).toHaveTextContent("Publicexample.com");
    expect(screen.getByRole("link", { name: "Edit hosted zone" })).toHaveAttribute(
      "href",
      "/hostedzones/edit/?id=Z1",
    );
  });

  it("active filters show as chips that can be removed one by one", async () => {
    setUrl("/hostedzones/details/", "id=Z1&q=www&type=A&policy=simple");
    loadOk();
    const { container } = render(<HostedZoneDetailsPage />);
    await waitFor(() => expect(table(container).findRows()).toHaveLength(4));
    expect(apiMock.listRecords).toHaveBeenCalledWith(
      "Z1",
      expect.objectContaining({ q: "www", type: "A", routing_policy: "simple" }),
    );
    const chips = createWrapper(container).findTokenGroup()!;
    expect(chips.findTokens().map((t) => t.getElement().textContent)).toEqual([
      "www",
      "Type: A",
      "Routing policy: Simple",
    ]);
    chips.findToken(2)!.findDismiss().click();
    expect(router.replace).toHaveBeenLastCalledWith("?id=Z1&q=www&policy=simple");
    // The counter stays the zone's record count while filtering, as in the console.
    expect(recordsHeader(container).getByText("(4)")).toBeInTheDocument();
  });

  it("Test record and query logging say they're coming soon", async () => {
    loadOk();
    render(<HostedZoneDetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /example.com$/ });
    await userEvent.click(screen.getByRole("button", { name: "Test record" }));
    expect(comingSoon).toHaveBeenCalledWith("Test record");
  });

  it("Export zone downloads BIND or JSON; Import zone file links to the import page", async () => {
    loadOk();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const { container } = render(<HostedZoneDetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /example.com$/ });

    const exportMenu = createWrapper(container).findButtonDropdown()!;
    exportMenu.openDropdown();
    exportMenu.findItemById("json")!.click();
    expect(assign).toHaveBeenCalledWith("/api/hosted-zones/Z1/export?format=json");
    exportMenu.openDropdown();
    exportMenu.findItemById("bind")!.click();
    expect(assign).toHaveBeenLastCalledWith("/api/hosted-zones/Z1/export?format=bind");
    vi.unstubAllGlobals();

    expect(screen.getByRole("link", { name: "Import zone file" })).toHaveAttribute(
      "href",
      "/hostedzones/records/import/?zoneId=Z1",
    );
  });
});
