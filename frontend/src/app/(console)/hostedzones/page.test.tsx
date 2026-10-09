import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apiMock, flash, openModal, page, pending, router, setUrl, zone } from "@/test/mocks";
import HostedZonesPage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

const ZONES = [
  zone({ id: "ZA", name: "alpha.com.", record_count: 2, description: "" }),
  zone({ id: "ZB", name: "beta.internal.", zone_type: "private", record_count: 7, description: "VPC zone" }),
];

const table = (c: HTMLElement) => createWrapper(c).findTable()!;
const header = (c: HTMLElement) => within(table(c).findHeaderSlot()!.getElement());
const modal = () => within(openModal().getElement());

describe("Hosted zones list", () => {
  beforeEach(() => {
    setUrl("/hostedzones/");
    localStorage.clear();
  });

  it("shows a loading state while the request is pending", () => {
    apiMock.listZones.mockReturnValue(pending());
    const { container } = render(<HostedZonesPage />);
    expect(table(container).findLoadingText()!.getElement()).toHaveTextContent("Loading hosted zones");
  });

  it("requests page 1 sorted by name and renders zone rows", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    const { container } = render(<HostedZonesPage />);
    await screen.findByRole("link", { name: "alpha.com" });
    expect(apiMock.listZones).toHaveBeenCalledWith({
      q: "",
      sort: "name",
      order: "asc",
      page: 1,
      page_size: 10,
    });
    const rows = table(container)
      .findRows()
      .map((r) => r.getElement().textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/alpha\.comPublicRoute 532-ZA/);
    expect(rows[1]).toMatch(/beta\.internalPrivateRoute 537VPC zoneZB/);
    expect(table(container).findHeaderSlot()!.getElement()).toHaveTextContent(/Hosted zones\s*\(2\)/);
  });

  it("zone name links go to the details page", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    render(<HostedZonesPage />);
    await userEvent.click(await screen.findByRole("link", { name: "alpha.com" }));
    expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=ZA");
  });

  it("shows the empty state with a create action", async () => {
    apiMock.listZones.mockResolvedValue(page([]));
    render(<HostedZonesPage />);
    expect(await screen.findByText("No hosted zones")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create hosted zone" })).toHaveLength(2);
  });

  it("shows an error flash and a Retry action when loading fails", async () => {
    apiMock.listZones.mockRejectedValueOnce(new ApiError(0, "Unable to reach the server."));
    render(<HostedZonesPage />);
    expect(await screen.findByText("Unable to load hosted zones")).toBeInTheDocument();
    expect(flash).toHaveBeenCalledWith("error", "Failed to load hosted zones: Unable to reach the server.");
    apiMock.listZones.mockResolvedValue(page(ZONES));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "alpha.com" })).toBeInTheDocument();
  });

  it("reads filter, sort and page from the URL", async () => {
    setUrl("/hostedzones/", "q=beta&sort=record_count&order=desc&page=2");
    apiMock.listZones.mockResolvedValue(page([], 12));
    render(<HostedZonesPage />);
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(apiMock.listZones).toHaveBeenCalledWith({
      q: "beta",
      sort: "record_count",
      order: "desc",
      page: 2,
      page_size: 10,
    });
    expect(screen.getByDisplayValue("beta")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(router.replace).toHaveBeenCalledWith("?sort=record_count&order=desc");
  });

  it("sorting and pagination update the URL", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES, 25));
    const { container } = render(<HostedZonesPage />);
    await screen.findByRole("link", { name: "alpha.com" });
    const t = table(container);
    t.findColumnSortingArea(5)!.click(); // Record count
    expect(router.replace).toHaveBeenLastCalledWith("?sort=record_count&order=asc");
    const p = createWrapper(container).findPagination()!;
    expect(p.findPageNumbers()).toHaveLength(3);
    p.findNextPageButton().click();
    expect(router.replace).toHaveBeenLastCalledWith("?page=2");
  });

  it("typing in the filter updates the URL after a delay", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    render(<HostedZonesPage />);
    await userEvent.type(screen.getByPlaceholderText("Filter records by property or value"), "alp");
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith("?q=alp"), { timeout: 2000 });
  });

  it("row actions are disabled until a zone is selected", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    const { container } = render(<HostedZonesPage />);
    await screen.findByRole("link", { name: "alpha.com" });
    // Edit and View details are links to other pages; disabled they have no href.
    const edit = () => header(container).getByText("Edit", { exact: true }).closest("a, button")!;
    expect(edit()).not.toHaveAttribute("href");
    expect(header(container).getByRole("button", { name: "Delete" })).toBeDisabled();
    table(container).findRowSelectionArea(1)!.click();
    expect(edit()).toHaveAttribute("href", "/hostedzones/edit/?id=ZA");
    expect(header(container).getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(header(container).getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "/hostedzones/details/?id=ZA",
    );
  });

  it("selecting one zone shows its details in the side panel and counts the selection", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    const { container } = render(<HostedZonesPage />);
    await screen.findByRole("link", { name: "alpha.com" });
    table(container).findRowSelectionArea(2)!.click();
    expect(table(container).findHeaderSlot()!.getElement()).toHaveTextContent(/Hosted zones\s*\(1\/2\)/);
    const panel = within(createWrapper(container).findSplitPanel()!.getElement());
    expect(panel.getByText("Hosted zone details")).toBeInTheDocument();
    expect(panel.getByText("Private hosted zone")).toBeInTheDocument();
    expect(panel.getByText("ns-2.awsdns-00.net")).toBeInTheDocument(); // shown without the trailing dot
  });

  it("deletes the selected zone after confirmation and reloads", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    apiMock.deleteZone.mockResolvedValue(undefined);
    const { container } = render(<HostedZonesPage />);
    await screen.findByRole("link", { name: "alpha.com" });
    table(container).findRowSelectionArea(2)!.click();
    await userEvent.click(header(container).getByRole("button", { name: "Delete" }));
    expect(openModal().getElement()).toHaveTextContent("beta.internal");
    await userEvent.type(modal().getByPlaceholderText("delete"), "delete");
    await userEvent.click(modal().getByRole("button", { name: "Delete" }));
    expect(apiMock.deleteZone).toHaveBeenCalledWith("ZB");
    await waitFor(() =>
      expect(flash).toHaveBeenCalledWith("success", "Hosted zone beta.internal was deleted."),
    );
    expect(apiMock.listZones).toHaveBeenCalledTimes(2);
  });

  it("keeps the delete dialog open with the API error when the zone isn't empty", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    apiMock.deleteZone.mockRejectedValue(new ApiError(409, "The hosted zone alpha.com contains 1 record(s)"));
    const { container } = render(<HostedZonesPage />);
    await screen.findByRole("link", { name: "alpha.com" });
    table(container).findRowSelectionArea(1)!.click();
    await userEvent.click(header(container).getByRole("button", { name: "Delete" }));
    await userEvent.type(modal().getByPlaceholderText("delete"), "delete");
    await userEvent.click(modal().getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/contains 1 record/)).toBeInTheDocument();
    expect(flash).not.toHaveBeenCalledWith("success", expect.anything());
  });

  it("bulk delete: deletes what it can and reports zones that still have records", async () => {
    apiMock.listZones.mockResolvedValue(page(ZONES));
    apiMock.deleteZone.mockImplementation(async (id: string) => {
      if (id === "ZB") throw new ApiError(409, "The hosted zone beta.internal contains 5 record(s).");
    });
    const { container } = render(<HostedZonesPage />);
    await screen.findByRole("link", { name: "alpha.com" });
    table(container).findRowSelectionArea(1)!.click();
    table(container).findRowSelectionArea(2)!.click();
    expect(header(container).getByRole("button", { name: "Edit" })).toBeDisabled(); // needs exactly one

    await userEvent.click(header(container).getByRole("button", { name: "Delete" }));
    expect(openModal().findHeader().getElement()).toHaveTextContent("Delete 2 hosted zones?");
    await userEvent.type(modal().getByPlaceholderText("delete"), "delete");
    await userEvent.click(modal().getByRole("button", { name: "Delete" }));

    expect(
      await modal().findByText(/beta.internal: The hosted zone beta.internal contains 5 record/),
    ).toBeInTheDocument();
    expect(apiMock.deleteZone).toHaveBeenCalledWith("ZA");
    expect(flash).toHaveBeenCalledWith("success", "Hosted zone alpha.com was deleted.");
  });
});
