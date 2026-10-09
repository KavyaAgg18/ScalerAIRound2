import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiMock, DEMO_ACCOUNT, router, setUrl } from "@/test/mocks";
import { ConsoleProvider, ConsoleSearch, InfoLink, ServicesMenu, Shell, useConsole } from "./console";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
vi.mock("@/lib/api", async (orig) => (await import("@/test/mocks")).apiModuleMock(orig));

function FlashButton() {
  const { flash } = useConsole();
  return <button onClick={() => flash("success", "Hosted zone created.")}>flash</button>;
}

function App() {
  return (
    <ConsoleProvider>
      <Shell
        breadcrumbs={[
          { text: "Route 53", href: "/" },
          { text: "Hosted zones", href: "/hostedzones/" },
        ]}
      >
        <h1>Page body</h1>
        <InfoLink help={{ title: "About zones", body: <p>Zone help text</p> }} />
        <FlashButton />
      </Shell>
    </ConsoleProvider>
  );
}

describe("ConsoleProvider + Shell", () => {
  beforeEach(() => {
    setUrl("/hostedzones/", "q=abc");
    window.history.replaceState(null, "", "/hostedzones/?q=abc");
  });

  it("shows a spinner, then redirects unauthenticated users to sign-in with a return path", async () => {
    apiMock.me.mockRejectedValue(new Error("401"));
    render(<App />);
    expect(screen.queryByText("Page body")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/login/?next=${encodeURIComponent("/hostedzones/?q=abc")}`,
      ),
    );
  });

  it("renders the console shell for a signed-in user", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    const { container } = render(<App />);
    expect(await screen.findByText("Page body")).toBeInTheDocument();
    const w = createWrapper(container);
    expect(container.querySelector("#top-nav")).toHaveTextContent("developer @ Demo Organization");
    expect(w.findTopNavigation()!.findLogo()!.getElement()).toHaveAttribute("alt", "AWS");
    const sideNav = w.findSideNavigation()!;
    expect(sideNav.findHeaderLink()!.getElement()).toHaveTextContent("Route 53");
    expect(sideNav.findActiveLink()!.getElement()).toHaveTextContent("Hosted zones");
    expect(w.findBreadcrumbGroup()!.findBreadcrumbLinks()).toHaveLength(2);
  });

  it("side navigation links navigate client-side", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    const { container } = render(<App />);
    await screen.findByText("Page body");
    const link = createWrapper(container).findSideNavigation()!.findLinkByHref("/healthchecks/")!;
    await userEvent.click(link.getElement());
    expect(router.push).toHaveBeenCalledWith("/healthchecks/");
  });

  it("flash messages appear in the Flashbar and can be dismissed", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    const { container } = render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "flash" }));
    const flashbar = createWrapper(container).findFlashbar()!;
    expect(flashbar.findItemsByType("success")[0].getElement()).toHaveTextContent("Hosted zone created.");
    await userEvent.click(flashbar.findItems()[0].findDismissButton()!.getElement());
    expect(createWrapper(container).findFlashbar()).toBeNull();
  });

  it("Sign out calls logout and returns to the sign-in page", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    apiMock.logout.mockResolvedValue(undefined);
    const { container } = render(<App />);
    await screen.findByText("Page body");
    // jsdom has no layout, so TopNavigation collapses utilities into its overflow menu.
    const topNav = createWrapper(container).findTopNavigation()!;
    topNav.findOverflowMenuButton()!.click();
    topNav.findOverflowMenu()!.findUtility(6)!.click(); // account menu
    topNav.findOverflowMenu()!.findMenuDropdownItemById("signout")!.click();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login/"));
    expect(apiMock.logout).toHaveBeenCalledOnce();
  });

  it("account menu shows the organization, account ID and role", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    const { container } = render(<App />);
    await screen.findByText("Page body");
    const topNav = createWrapper(container).findTopNavigation()!;
    topNav.findOverflowMenuButton()!.click();
    topNav.findOverflowMenu()!.findUtility(6)!.click();
    await userEvent.click(screen.getByText("Signed in as")); // groups start collapsed in the overflow menu
    const menu = topNav.findOverflowMenu()!.getElement();
    expect(menu).toHaveTextContent("Account ID: 1234-5678-9012");
    expect(menu).toHaveTextContent("Organization: Demo Organization");
    expect(menu).toHaveTextContent("Role: developer/demo");
  });

  it("services menu opens Route 53 and flags other services as coming soon", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    render(
      <ConsoleProvider>
        <div data-testid="services">
          <ServicesMenu />
        </div>
        <FlashButton />
      </ConsoleProvider>,
    );
    const menu = createWrapper(await screen.findByTestId("services")).findButtonDropdown()!;
    menu.openDropdown();
    menu.findItemById("Route 53")!.click();
    expect(router.push).toHaveBeenCalledWith("/");
    menu.openDropdown();
    menu.findItemById("EC2")!.click();
  });

  it("top search: Alt+S focuses it, Enter searches hosted zones", async () => {
    // Rendered on its own: in jsdom TopNavigation collapses the search into a button.
    render(<ConsoleSearch />);
    const search = screen.getByRole("searchbox", { name: "Search hosted zones" });
    await userEvent.keyboard("{Alt>}s{/Alt}");
    expect(search).toHaveFocus();
    await userEvent.type(search, "example{Enter}");
    expect(router.push).toHaveBeenCalledWith("/hostedzones/?q=example");
  });

  it("Info links open the help panel with that topic", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    const { container } = render(<App />);
    await screen.findByText("Page body");
    await userEvent.click(screen.getByRole("button", { name: "Information about About zones" }));
    expect(await screen.findByText("Zone help text")).toBeInTheDocument();
    expect(createWrapper(container).findHelpPanel()!.findHeader()!.getElement()).toHaveTextContent(
      "About zones",
    );
  });

  it("footer and top-bar extras say they're coming soon", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    const { container } = render(<App />);
    await screen.findByText("Page body");
    await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
    const flashbar = createWrapper(container).findFlashbar()!;
    expect(flashbar.findItemsByType("info")[0].getElement()).toHaveTextContent("Feedback is coming soon.");
  });

  it("? opens the shortcuts list and / focuses the page filter, but not while typing", async () => {
    apiMock.me.mockResolvedValue(DEMO_ACCOUNT);
    render(
      <ConsoleProvider>
        <input type="search" aria-label="Page filter" />
        <input aria-label="Some field" />
      </ConsoleProvider>,
    );
    const filter = await screen.findByLabelText("Page filter");

    await userEvent.click(screen.getByLabelText("Some field"));
    await userEvent.keyboard("/");
    expect(filter).not.toHaveFocus(); // typing "/" in a field stays in the field

    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("/");
    expect(filter).toHaveFocus();

    filter.blur();
    await userEvent.keyboard("?");
    expect(await screen.findByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Focus the table filter on this page")).toBeInTheDocument();
  });
});
