import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apiMock, flash, router, setUrl, zone } from "@/test/mocks";
import EditHostedZonePage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

const ZONE = zone({
  id: "Z1",
  name: "example.com.",
  description: "old",
  tags: [{ key: "env", value: "prod" }],
});

describe("Edit hosted zone", () => {
  beforeEach(() => {
    setUrl("/hostedzones/edit/", "id=Z1");
    apiMock.getZone.mockResolvedValue(ZONE);
  });

  it("shows the read-only zone facts like the console", async () => {
    render(<EditHostedZonePage />);
    expect(await screen.findByRole("heading", { level: 1, name: /Edit example\.com/ })).toBeInTheDocument();
    expect(screen.getByText("Hosted zone ID")).toBeInTheDocument();
    expect(screen.getByText("Z1")).toBeInTheDocument();
    expect(screen.getByText("Public hosted zone")).toBeInTheDocument();
    expect(screen.getByDisplayValue("old")).toBeInTheDocument();
    expect(screen.getByDisplayValue("env")).toBeInTheDocument();
  });

  it("saves description and tags, then returns to the zone", async () => {
    apiMock.updateZone.mockResolvedValue({ ...ZONE, description: "new" });
    const { container } = render(<EditHostedZonePage />);
    const description = await screen.findByDisplayValue("old");
    await userEvent.clear(description);
    await userEvent.type(description, "new");
    // Remove the existing tag (it becomes "marked for removal") and add another.
    const editor = createWrapper(container).findTagEditor()!;
    editor.findRow(1)!.findRemoveButton()!.click();
    editor.findAddButton().click();
    const [key, value] = editor.findRow(2)!.getElement().querySelectorAll("input");
    await userEvent.type(key, "team");
    await userEvent.type(value, "dns");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(apiMock.updateZone).toHaveBeenCalledWith("Z1", {
      description: "new",
      tags: [{ key: "team", value: "dns" }],
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=Z1"));
    expect(flash).toHaveBeenCalledWith("success", "Hosted zone example.com was updated.");
  });

  it("shows API errors and stays on the page", async () => {
    apiMock.updateZone.mockRejectedValue(new ApiError(422, "Each tag key must be unique."));
    render(<EditHostedZonePage />);
    await screen.findByDisplayValue("old");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Each tag key must be unique.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
