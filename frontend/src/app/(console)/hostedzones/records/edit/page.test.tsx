import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apiMock, flash, record, router, setUrl, zone } from "@/test/mocks";
import EditRecordPage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

const WWW = record({ id: 7, name: "www.example.com.", type: "A", ttl: 300, values: ["192.0.2.1"] });

describe("Edit record", () => {
  beforeEach(() => {
    setUrl("/hostedzones/records/edit/", "zoneId=Z1&id=7");
    apiMock.getZone.mockResolvedValue(zone({ id: "Z1", name: "example.com." }));
  });

  it("prefills the form and locks name and type", async () => {
    apiMock.getRecord.mockResolvedValue(WWW);
    render(<EditRecordPage />);
    expect(await screen.findByLabelText("Record name")).toHaveValue("www");
    expect(apiMock.getRecord).toHaveBeenCalledWith("Z1", 7);
    expect(screen.getByLabelText("Record name")).toBeDisabled();
    expect(screen.getByLabelText("Value")).toHaveValue("192.0.2.1");
    expect(screen.getByLabelText("TTL (seconds)")).toHaveValue("300");
  });

  it("saves TTL and values, then returns to the zone", async () => {
    apiMock.getRecord.mockResolvedValue(WWW);
    apiMock.updateRecord.mockResolvedValue({ ...WWW, ttl: 3600 });
    render(<EditRecordPage />);
    const value = await screen.findByLabelText("Value");
    await userEvent.type(value, "\n192.0.2.9");
    await userEvent.click(screen.getByRole("button", { name: "1h" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(apiMock.updateRecord).toHaveBeenCalledWith(
      "Z1",
      7,
      expect.objectContaining({ ttl: 3600, values: ["192.0.2.1", "192.0.2.9"], alias: null }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=Z1"));
    expect(flash).toHaveBeenCalledWith("success", "Record www.example.com (A) was successfully updated.");
  });

  it("blocks invalid values on the client", async () => {
    apiMock.getRecord.mockResolvedValue(WWW);
    render(<EditRecordPage />);
    const value = await screen.findByLabelText("Value");
    await userEvent.clear(value);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter at least one value.")).toBeInTheDocument();
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
  });

  it("shows server validation errors on the field", async () => {
    apiMock.getRecord.mockResolvedValue(WWW);
    apiMock.updateRecord.mockRejectedValue(
      new ApiError(422, "TTL must be between 0 and 2147483647 seconds.", {
        ttl: "TTL must be between 0 and 2147483647 seconds.",
      }),
    );
    render(<EditRecordPage />);
    await screen.findByLabelText("Value");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("TTL must be between 0 and 2147483647 seconds.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("warns when editing a record Route 53 created", async () => {
    apiMock.getRecord.mockResolvedValue(
      record({
        id: 7,
        name: "example.com.",
        type: "SOA",
        is_protected: true,
        values: ["ns-1.awsdns-00.com. h 1 7200 900 1209600 86400"],
      }),
    );
    render(<EditRecordPage />);
    expect(await screen.findByText(/Route 53 created this SOA record/)).toBeInTheDocument();
  });

  it("shows an error for an unknown record", async () => {
    apiMock.getRecord.mockRejectedValue(new ApiError(404, "No record found with ID 7 in hosted zone Z1."));
    render(<EditRecordPage />);
    expect(await screen.findByText("Unable to load record")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Back to hosted zone" }));
    expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=Z1");
  });
});
