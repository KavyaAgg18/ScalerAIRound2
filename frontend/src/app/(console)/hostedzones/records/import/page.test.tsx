import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apiMock, flash, router, setUrl, zone } from "@/test/mocks";
import ImportZoneFilePage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

const importButton = () => screen.getByRole("button", { name: "Import" });

describe("Import zone file", () => {
  beforeEach(() => {
    setUrl("/hostedzones/records/import/", "zoneId=Z1");
    apiMock.getZone.mockResolvedValue(zone({ id: "Z1", name: "example.com." }));
  });

  it("asks for content before calling the API", async () => {
    render(<ImportZoneFilePage />);
    await waitFor(() => expect(importButton()).toBeEnabled());
    await userEvent.click(importButton());
    expect(screen.getByText("Paste a zone file or choose a file.")).toBeInTheDocument();
    expect(apiMock.importZoneFile).not.toHaveBeenCalled();
  });

  it("imports pasted text, flashes the result and returns to the zone", async () => {
    apiMock.importZoneFile.mockResolvedValue({ imported: 3, skipped: 2 });
    render(<ImportZoneFilePage />);
    await waitFor(() => expect(importButton()).toBeEnabled());
    await userEvent.click(screen.getByLabelText("Zone file"));
    await userEvent.paste("www A 192.0.2.1\n");
    await userEvent.click(importButton());
    expect(apiMock.importZoneFile).toHaveBeenCalledWith("Z1", "www A 192.0.2.1\n");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=Z1"));
    expect(flash).toHaveBeenCalledWith(
      "success",
      "Imported 3 record(s) into example.com. 2 SOA/NS line(s) for the zone apex were skipped; Route 53 keeps its own.",
    );
  });

  it("lists every problem line the server reports", async () => {
    apiMock.importZoneFile.mockRejectedValue(
      new ApiError(422, "The zone file has 2 problem(s). Nothing was imported.", {}, [
        "Line 1: bad IP",
        "Line 3: record type X isn't supported.",
      ]),
    );
    render(<ImportZoneFilePage />);
    await waitFor(() => expect(importButton()).toBeEnabled());
    await userEvent.click(screen.getByLabelText("Zone file"));
    await userEvent.paste("junk");
    await userEvent.click(importButton());
    expect(
      await screen.findByText("The zone file has 2 problem(s). Nothing was imported."),
    ).toBeInTheDocument();
    expect(screen.getByText("Line 1: bad IP")).toBeInTheDocument();
    expect(screen.getByText("Line 3: record type X isn't supported.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a chosen file fills the text area", async () => {
    const { container } = render(<ImportZoneFilePage />);
    const input = createWrapper(container).findFileUpload()!.findNativeInput().getElement();
    await userEvent.upload(
      input,
      new File(["mail MX 10 mx.example.com.\n"], "example.zone", { type: "text/plain" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Zone file")).toHaveValue("mail MX 10 mx.example.com.\n"),
    );
  });
});
