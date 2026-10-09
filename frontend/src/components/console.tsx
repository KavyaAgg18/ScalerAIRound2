"use client";

import { type AppLayoutProps } from "@cloudscape-design/components/app-layout";
import AppLayoutToolbar from "@cloudscape-design/components/app-layout-toolbar";
import Box from "@cloudscape-design/components/box";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import BreadcrumbGroup, { type BreadcrumbGroupProps } from "@cloudscape-design/components/breadcrumb-group";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import HelpPanel from "@cloudscape-design/components/help-panel";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import SideNavigation, { type SideNavigationProps } from "@cloudscape-design/components/side-navigation";
import Spinner from "@cloudscape-design/components/spinner";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Account } from "@/lib/types";
import { getVisualMode, setVisualMode, type VisualMode } from "@/lib/theme";

type FlashType = NonNullable<FlashbarProps.MessageDefinition["type"]>;

export interface Help {
  title: string;
  body: ReactNode;
}

interface ConsoleCtx {
  account: Account;
  flash: (type: FlashType, content: ReactNode, extra?: Partial<FlashbarProps.MessageDefinition>) => void;
  flashes: FlashbarProps.MessageDefinition[];
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  help: Help | null;
  showHelp: (help: Help | null) => void;
}

const Ctx = createContext<ConsoleCtx | null>(null);

export function useConsole(): ConsoleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConsole outside ConsoleProvider");
  return ctx;
}

// Cloudscape links render real <a> tags; route them through the Next router instead.
export function useFollow() {
  const router = useRouter();
  return useCallback(
    (e: CustomEvent<{ href?: string; external?: boolean }>) => {
      if (e.detail.href && !e.detail.external) {
        e.preventDefault();
        router.push(e.detail.href);
      }
    },
    [router],
  );
}

/** "Info" link next to a header; opens the help panel on the right, like the console. */
export function InfoLink({ help }: { help: Help }) {
  const { showHelp } = useConsole();
  return (
    <Link variant="info" onFollow={() => showHelp(help)} ariaLabel={`Information about ${help.title}`}>
      Info
    </Link>
  );
}

/** Flash shown for console features that this clone doesn't implement. */
export function useComingSoon() {
  const { flash } = useConsole();
  return useCallback(
    (what: string) =>
      flash("info", `${what} is coming soon. This part of Route 53 isn't available in this demo.`),
    [flash],
  );
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Single-key shortcut that's ignored while the user is typing in a field. */
export function useShortcut(key: string, handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler]);
}

export const SHORTCUTS = [
  { keys: "Alt + S", action: "Search hosted zones from the top bar" },
  { keys: "/", action: "Focus the table filter on this page" },
  { keys: "c", action: "Create (a hosted zone on the list, a record on a zone)" },
  { keys: "?", action: "Show this list" },
];

function ShortcutsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} onDismiss={onClose} header="Keyboard shortcuts">
      <KeyValuePairs columns={1} items={SHORTCUTS.map((s) => ({ label: s.keys, value: s.action }))} />
    </Modal>
  );
}

let flashId = 0;

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [flashes, setFlashes] = useState<FlashbarProps.MessageDefinition[]>([]);
  // Start collapsed on narrow screens so the nav doesn't cover the content.
  const [navOpen, setNavOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1024);
  const [help, showHelp] = useState<Help | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useShortcut("?", () => setShortcutsOpen(true));
  useShortcut("/", () => {
    // First search box in the page content (the top-bar search has its own Alt+S).
    const filter = [...document.querySelectorAll<HTMLInputElement>('input[type="search"]')].find(
      (el) => !el.closest("#top-nav"),
    );
    filter?.focus();
  });

  useEffect(() => {
    api
      .me()
      .then(setAccount)
      .catch(() => {
        const next = window.location.pathname + window.location.search;
        router.replace(`/login/?next=${encodeURIComponent(next)}`);
      });
  }, [router]);

  const flash = useCallback(
    (type: FlashType, content: ReactNode, extra?: Partial<FlashbarProps.MessageDefinition>) => {
      const id = String(++flashId);
      const dismiss = () => setFlashes((fs) => fs.filter((f) => f.id !== id));
      setFlashes((fs) =>
        [{ id, type, content, dismissible: true, onDismiss: dismiss, ...extra }, ...fs].slice(0, 3),
      );
    },
    [],
  );

  if (!account) {
    return (
      <div className="full-page-center">
        <Spinner size="large" />
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ account, flash, flashes, navOpen, setNavOpen, help, showHelp }}>
      <TopBar account={account} onShowShortcuts={() => setShortcutsOpen(true)} />
      {children}
      <Footer />
      <ShortcutsModal visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </Ctx.Provider>
  );
}

const helpIcon = (
  <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <path
      d="M6 6.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2V10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="8" cy="12.3" r="1" fill="currentColor" />
  </svg>
);

export function ConsoleSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Alt+S focuses the search box, as in the console.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        ref.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="console-search" ref={ref}>
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.detail.value)}
        onKeyDown={(e) => {
          // Only hosted zones are searchable here; that's what people look for most.
          if (e.detail.key === "Enter" && value.trim()) {
            router.push(`/hostedzones/?q=${encodeURIComponent(value.trim())}`);
            setValue("");
          }
        }}
        placeholder="Search"
        ariaLabel="Search hosted zones"
      />
      <span className="console-search-hint">
        {!value && "[Alt+S]"}
        {hexIcon}
      </span>
    </div>
  );
}

// Outline hexagon, as at the right end of the console search box.
const hexIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" focusable="false" aria-hidden="true">
    <path
      d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path d="M8 5.2 10.4 6.6v2.8L8 10.8 5.6 9.4V6.6Z" fill="currentColor" />
  </svg>
);

// Purple Amazon Q tile shown between the logo and the services menu.
const amazonQIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
    <defs>
      <linearGradient id="amazon-q-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7b3ff2" />
        <stop offset="1" stopColor="#4d27c9" />
      </linearGradient>
    </defs>
    <rect width="24" height="24" rx="5" fill="url(#amazon-q-bg)" />
    <path d="M12 4.5 18.3 8.1v7.3L12 19 5.7 15.4V8.1Z" fill="none" stroke="#fff" strokeWidth="1.8" />
    <path d="M12 9 14.6 10.5v3L12 15l-2.6-1.5v-3Z" fill="#fff" />
  </svg>
);

function AmazonQButton() {
  const comingSoon = useComingSoon();
  return (
    <button
      type="button"
      className="console-q"
      aria-label="Amazon Q"
      title="Amazon Q"
      onClick={() => comingSoon("Amazon Q")}
    >
      {amazonQIcon}
    </button>
  );
}

const gridIcon = (
  <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
    {[1, 6.5, 12].flatMap((x) =>
      [1, 6.5, 12].map((y) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" fill="currentColor" />
      )),
    )}
  </svg>
);

// Only Route 53 exists in this clone; every other service just says so.
const SERVICES = [
  { category: "Networking & Content Delivery", items: ["Route 53", "VPC", "CloudFront", "API Gateway"] },
  { category: "Compute", items: ["EC2", "Lambda", "Elastic Beanstalk"] },
  { category: "Storage", items: ["S3", "EFS"] },
  { category: "Database", items: ["RDS", "DynamoDB"] },
  { category: "Security, Identity, & Compliance", items: ["IAM", "Certificate Manager"] },
];

export function ServicesMenu() {
  const router = useRouter();
  const comingSoon = useComingSoon();
  return (
    <ButtonDropdown
      variant="icon"
      iconSvg={gridIcon}
      ariaLabel="Services"
      expandToViewport
      items={SERVICES.map((g) => ({
        id: g.category,
        text: g.category,
        items: g.items.map((name) => ({
          id: name,
          text: name,
          secondaryText: name === "Route 53" ? "Scalable DNS and domain name registration" : undefined,
        })),
      }))}
      onItemClick={(e) => (e.detail.id === "Route 53" ? router.push("/") : comingSoon(e.detail.id))}
    />
  );
}

const formatAccountId = (id: string) => id.replace(/(\d{4})(\d{4})(\d{4})/, "$1-$2-$3");

function TopBar({ account, onShowShortcuts }: { account: Account; onShowShortcuts: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<VisualMode>(getVisualMode);
  const follow = useFollow();
  const comingSoon = useComingSoon();
  return (
    <div id="top-nav">
      <TopNavigation
        identity={{ href: "/", logo: { src: "/aws-logo.svg", alt: "AWS" }, onFollow: follow }}
        search={
          <div className="console-search-row">
            <span className="console-divider" />
            <AmazonQButton />
            <span className="console-divider" />
            <ServicesMenu />
            <ConsoleSearch />
          </div>
        }
        utilities={[
          {
            type: "button",
            iconName: "script",
            ariaLabel: "CloudShell",
            title: "CloudShell",
            onClick: () => comingSoon("CloudShell"),
          },
          {
            type: "button",
            iconName: "notification",
            ariaLabel: "Notifications",
            title: "Notifications",
            onClick: () => comingSoon("Notifications"),
          },
          {
            type: "button",
            iconSvg: helpIcon,
            ariaLabel: "Support",
            title: "Support",
            onClick: () => comingSoon("Support"),
          },
          {
            type: "menu-dropdown",
            iconName: "settings",
            ariaLabel: "Settings",
            title: "Settings",
            items: [
              {
                id: "visual-mode",
                text: "Visual mode",
                items: (["light", "dark", "system"] as const).map((m) => ({
                  id: `mode-${m}`,
                  text: m === "system" ? "Browser default" : m === "dark" ? "Dark" : "Light",
                  itemType: "checkbox" as const,
                  checked: mode === m,
                })),
              },
              { id: "shortcuts", text: "Keyboard shortcuts" },
            ],
            onItemClick: (e) => {
              if (e.detail.id === "shortcuts") return onShowShortcuts();
              const picked = e.detail.id.replace("mode-", "") as VisualMode;
              setVisualMode(picked);
              setMode(picked);
            },
          },
          {
            type: "menu-dropdown",
            text: "Global",
            title: "Route 53 is a global service",
            items: [{ id: "global", text: "Route 53 doesn't require Region selection.", disabled: true }],
          },
          {
            type: "menu-dropdown",
            text: `${account.role} @ ${account.account_name}`,
            title: `${account.role}/${account.username} @ ${account.account_name}`,
            ariaLabel: "Account menu",
            items: [
              {
                id: "identity",
                text: "Signed in as",
                items: [
                  {
                    id: "account-id",
                    text: `Account ID: ${formatAccountId(account.account_id)}`,
                    disabled: true,
                  },
                  { id: "organization", text: `Organization: ${account.account_name}`, disabled: true },
                  { id: "role", text: `Role: ${account.role}/${account.username}`, disabled: true },
                ],
              },
              {
                id: "links",
                text: "Account settings",
                items: [
                  "Account",
                  "Organization",
                  "Service Quotas",
                  "Billing and Cost Management",
                  "Security credentials",
                ].map((text) => ({ id: text, text })),
              },
              { id: "signout", text: "Sign out" },
            ],
            onItemClick: async (e) => {
              if (e.detail.id !== "signout") return comingSoon(e.detail.id);
              await api.logout().catch(() => {});
              router.replace("/login/");
            },
          },
        ]}
      />
    </div>
  );
}

function Footer() {
  const comingSoon = useComingSoon();
  const item = (label: string) => (
    <button type="button" className="console-footer-link" onClick={() => comingSoon(label)}>
      {label}
    </button>
  );
  return (
    <footer id="console-footer">
      <div className="console-footer-left">
        {item("CloudShell")}
        {item("Feedback")}
        {item("Console Mobile App")}
      </div>
      <div className="console-footer-right">
        <span>© 2026 Route 53 console clone · not affiliated with AWS</span>
        {item("Privacy")}
        {item("Terms")}
        {item("Cookie preferences")}
      </div>
    </footer>
  );
}

const NEW = (
  <Box color="text-status-info" fontSize="body-s" fontWeight="bold" display="inline">
    New
  </Box>
);

const NAV_ITEMS: SideNavigationProps.Item[] = [
  { type: "link", text: "Dashboard", href: "/" },
  { type: "link", text: "Hosted zones", href: "/hostedzones/" },
  { type: "link", text: "Health checks", href: "/healthchecks/" },
  { type: "link", text: "Profiles", href: "/profiles/" },
  {
    type: "section",
    text: "Global Resolver",
    items: [
      { type: "link", text: "Global resolvers", href: "/globalresolvers/", info: NEW },
      { type: "link", text: "Shared DNS views", href: "/shareddnsviews/", info: NEW },
    ],
  },
  {
    type: "section",
    text: "VPC Resolver",
    items: [
      { type: "link", text: "VPCs", href: "/resolver/" },
      { type: "link", text: "Inbound endpoints", href: "/inboundendpoints/" },
      { type: "link", text: "Outbound endpoints", href: "/outboundendpoints/" },
      { type: "link", text: "Rules", href: "/resolverrules/" },
      { type: "link", text: "Query logging", href: "/querylogging/" },
      { type: "link", text: "Outposts", href: "/outposts/" },
    ],
  },
  {
    type: "section",
    text: "Domains",
    items: [
      { type: "link", text: "Registered domains", href: "/domains/" },
      { type: "link", text: "Requests", href: "/requests/" },
    ],
  },
  {
    type: "section",
    text: "IP-based routing",
    items: [{ type: "link", text: "CIDR collections", href: "/cidrcollections/" }],
  },
  {
    type: "section",
    text: "Traffic flow",
    items: [
      { type: "link", text: "Traffic policies", href: "/trafficpolicies/" },
      { type: "link", text: "Policy records", href: "/policyrecords/" },
    ],
  },
  { type: "divider" },
  {
    type: "link",
    text: "DNS Firewall",
    href: "https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-dns-firewall.html",
    external: true,
  },
  {
    type: "link",
    text: "Application Recovery Controller",
    href: "https://docs.aws.amazon.com/r53recovery/latest/dg/what-is-route53-recovery.html",
    external: true,
  },
];

export const ROUTE53_CRUMB = { text: "Route 53", href: "/" };

export const PAGINATION_LABELS = {
  nextPageLabel: "Next page",
  previousPageLabel: "Previous page",
  pageLabel: (n: number) => `Page ${n}`,
};

const DEFAULT_HELP: Help = {
  title: "Amazon Route 53",
  body: (
    <p>
      Route 53 is a DNS web service. This clone lets you manage hosted zones and DNS records; other areas are
      placeholders.
    </p>
  ),
};

interface ShellProps {
  breadcrumbs: BreadcrumbGroupProps.Item[];
  children: ReactNode;
  contentType?: AppLayoutProps.ContentType;
  splitPanel?: ReactNode;
  splitPanelOpen?: boolean;
  onSplitPanelToggle?: (open: boolean) => void;
}

export function Shell({
  breadcrumbs,
  children,
  contentType,
  splitPanel,
  splitPanelOpen,
  onSplitPanelToggle,
}: ShellProps) {
  const { flashes, navOpen, setNavOpen, help, showHelp } = useConsole();
  const [toolsOpen, setToolsOpen] = useState(false);
  const follow = useFollow();
  const pathname = usePathname();
  const active = pathname.startsWith("/hostedzones")
    ? "/hostedzones/"
    : pathname.endsWith("/")
      ? pathname
      : pathname + "/";

  // An Info link sets the help content; open the panel when that happens.
  useEffect(() => {
    if (help) setToolsOpen(true);
  }, [help]);

  const shown = help ?? DEFAULT_HELP;

  return (
    <AppLayoutToolbar
      headerSelector="#top-nav"
      footerSelector="#console-footer"
      ariaLabels={{
        navigation: "Route 53 navigation",
        navigationToggle: "Open navigation",
        navigationClose: "Close navigation",
        tools: "Help panel",
        toolsToggle: "Open help panel",
        toolsClose: "Close help panel",
      }}
      contentType={contentType}
      navigationOpen={navOpen}
      onNavigationChange={(e) => setNavOpen(e.detail.open)}
      navigation={
        <SideNavigation
          header={{ text: "Route 53", href: "/" }}
          activeHref={active}
          items={NAV_ITEMS}
          onFollow={follow}
        />
      }
      breadcrumbs={<BreadcrumbGroup items={breadcrumbs} onFollow={follow} ariaLabel="Breadcrumbs" />}
      notifications={flashes.length ? <Flashbar items={flashes} /> : undefined}
      tools={
        <HelpPanel header={<h2>{shown.title}</h2>}>
          <div>{shown.body}</div>
        </HelpPanel>
      }
      toolsOpen={toolsOpen}
      onToolsChange={(e) => {
        setToolsOpen(e.detail.open);
        if (!e.detail.open) showHelp(null);
      }}
      splitPanel={splitPanel}
      splitPanelOpen={splitPanelOpen}
      onSplitPanelToggle={(e) => onSplitPanelToggle?.(e.detail.open)}
      splitPanelPreferences={{ position: "side" }}
      content={children}
    />
  );
}
