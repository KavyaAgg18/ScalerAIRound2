import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apiMock, flash, router, setUrl, zone } from "@/test/mocks";
import CreateHostedZonePage from "./page";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/components/console", async () => (await import("@/test/mocks")).consoleMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

const submit = () => userEvent.click(screen.getByRole("button", { name: "Create hosted zone" }));
const domain = () => screen.getByPlaceholderText("example.com");

describe("Create hosted zone", () => {
  beforeEach(() => setUrl("/hostedzones/create/"));

  it("validates the domain name before calling the API", async () => {
    render(<CreateHostedZonePage />);
    await submit();
    expect((await screen.findAllByText("Enter a domain name."))[0]).toBeInTheDocument();
    await userEvent.type(domain(), "com");
    expect((await screen.findAllByText(/doesn.t support top-level domains/))[0]).toBeInTheDocument();
    await userEvent.clear(domain());
    await userEvent.type(domain(), "bad_name.com");
    expect((await screen.findAllByText(/"bad_name" isn.t a valid label/))[0]).toBeInTheDocument();
    expect(apiMock.createZone).not.toHaveBeenCalled();
  });

  it("limits the description to 256 characters", async () => {
    render(<CreateHostedZonePage />);
    await userEvent.type(domain(), "ok.com");
    await userEvent.click(screen.getByPlaceholderText("The hosted zone is used for..."));
    await userEvent.paste("x".repeat(257));
    expect(screen.getAllByText("The description can have up to 256 characters.").length).toBeGreaterThan(0);
    await submit();
    expect(apiMock.createZone).not.toHaveBeenCalled();
  });

  it("creates a public zone, flashes success and opens its details", async () => {
    apiMock.createZone.mockResolvedValue(zone({ id: "ZNEW", name: "new.com." }));
    render(<CreateHostedZonePage />);
    await userEvent.type(domain(), "new.com");
    await userEvent.type(screen.getByPlaceholderText("The hosted zone is used for..."), "hello");
    await submit();
    expect(apiMock.createZone).toHaveBeenCalledWith({
      name: "new.com",
      description: "hello",
      zone_type: "public",
      tags: [],
    });
    expect(flash).toHaveBeenCalledWith("success", "new.com was successfully created.");
    expect(router.push).toHaveBeenCalledWith("/hostedzones/details/?id=ZNEW");
  });

  it("private zones require a Region and VPC, then send them", async () => {
    apiMock.createZone.mockResolvedValue(zone({ id: "ZP", zone_type: "private" }));
    const { container } = render(<CreateHostedZonePage />);
    await userEvent.type(domain(), "corp.internal");
    createWrapper(container).findTiles()!.findItemByValue("private")!.click();
    expect(screen.getByText("VPCs to associate with the hosted zone")).toBeInTheDocument();
    await submit();
    expect(screen.getByText("Choose a Region.")).toBeInTheDocument();
    expect(screen.getByText("Choose a VPC.")).toBeInTheDocument();
    expect(apiMock.createZone).not.toHaveBeenCalled();

    const region = createWrapper(container).findSelect()!;
    region.openDropdown();
    region.selectOptionByValue("eu-west-1");
    // VPC ID is free text with suggestions; pick the first suggestion.
    const vpc = createWrapper(container).findAutosuggest()!;
    vpc.focus();
    vpc.selectSuggestion(1);
    await submit();
    expect(apiMock.createZone).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "corp.internal",
        zone_type: "private",
        vpcs: [{ region: "eu-west-1", vpc_id: expect.stringMatching(/^vpc-/) }],
      }),
    );
  });

  it("shows a duplicate-name error from the API on the Domain name field", async () => {
    apiMock.createZone.mockRejectedValue(
      new ApiError(409, "A hosted zone named dup.com already exists.", {
        name: "A hosted zone named dup.com already exists.",
      }),
    );
    render(<CreateHostedZonePage />);
    await userEvent.type(domain(), "dup.com");
    await submit();
    expect(await screen.findByText("A hosted zone named dup.com already exists.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    // Editing the field clears the server error.
    await userEvent.type(domain(), "x");
    expect(screen.queryByText("A hosted zone named dup.com already exists.")).not.toBeInTheDocument();
  });

  it("shows non-field API failures as a form error", async () => {
    apiMock.createZone.mockRejectedValue(new ApiError(0, "Unable to reach the server."));
    render(<CreateHostedZonePage />);
    await userEvent.type(domain(), "net.com");
    await submit();
    expect(await screen.findByText("Unable to reach the server.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create hosted zone" })).toBeEnabled();
  });

  it("Cancel returns to the list", async () => {
    render(<CreateHostedZonePage />);
    await userEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(router.push).toHaveBeenCalledWith("/hostedzones/");
  });

  it("sends tags added in the Tags section", async () => {
    apiMock.createZone.mockResolvedValue(zone({ id: "ZT" }));
    const { container } = render(<CreateHostedZonePage />);
    await userEvent.type(domain(), "tagged.com");
    const editor = createWrapper(container).findTagEditor()!;
    editor.findAddButton().click();
    const [key, value] = editor.findRow(1)!.getElement().querySelectorAll("input");
    await userEvent.type(key, "env");
    await userEvent.type(value, "prod");
    await submit();
    expect(apiMock.createZone).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [{ key: "env", value: "prod" }] }),
    );
  });
});
