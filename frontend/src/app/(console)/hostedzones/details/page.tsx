"use client";

import Alert from "@cloudscape-design/components/alert";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import SplitPanel from "@cloudscape-design/components/split-panel";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";
import TokenGroup from "@cloudscape-design/components/token-group";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import DeleteModal from "@/components/DeleteModal";
import DeleteZoneModal from "@/components/DeleteZoneModal";
import TablePreferences, { useTablePrefs, type Prefs } from "@/components/TablePreferences";
import {
  InfoLink,
  PAGINATION_LABELS,
  ROUTE53_CRUMB,
  Shell,
  useComingSoon,
  useConsole,
  useFollow,
  useShortcut,
} from "@/components/console";
import { RECORDS_HELP, ZONE_HELP } from "@/components/help";
import { api, bare, exportUrl } from "@/lib/api";
import { differentiator } from "@/lib/recordText";
import { POLICY_LABELS, RECORD_TYPES, ROUTING_POLICIES, type RecordSet } from "@/lib/types";
import { setQuery, useLoad } from "@/lib/useLoad";

const PREFS_KEY = "r53.records.prefs";

const TYPE_OPTIONS: SelectProps.Option[] = [...RECORD_TYPES, "SOA"]
  .sort()
  .map((t) => ({ value: t, label: t }));
const POLICY_OPTIONS: SelectProps.Option[] = ROUTING_POLICIES.map((p) => ({
  value: p,
  label: POLICY_LABELS[p],
}));

// Alias records show their target; ordinary records show their values, one per line.
const routeTo = (r: RecordSet) =>
  r.alias ? bare(r.alias.dns_name) : <span className="values-cell">{r.values.join("\n")}</span>;
const ALIAS_OPTIONS: SelectProps.Option[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const COLUMNS: (TableProps.ColumnDefinition<RecordSet> & { id: string; label: string })[] = [
  {
    id: "name",
    label: "Record name",
    header: "Record name",
    sortingField: "name",
    cell: (r) => bare(r.name),
    isRowHeader: true,
    minWidth: 200,
  },
  { id: "type", label: "Type", header: "Type", sortingField: "type", cell: (r) => r.type },
  {
    id: "routing_policy",
    label: "Routing policy",
    header: "Routing policy",
    sortingField: "routing_policy",
    cell: (r) => POLICY_LABELS[r.routing_policy],
  },
  {
    id: "differentiator",
    label: "Differentiator",
    header: "Differentiator",
    cell: (r) => differentiator(r),
  },
  { id: "alias", label: "Alias", header: "Alias", cell: (r) => (r.alias ? "Yes" : "No") },
  {
    id: "values",
    label: "Value/Route traffic to",
    header: "Value/Route traffic to",
    cell: routeTo,
    minWidth: 240,
  },
  {
    id: "ttl",
    label: "TTL (seconds)",
    header: "TTL (seconds)",
    sortingField: "ttl",
    cell: (r) => (r.ttl === null ? "-" : r.ttl.toLocaleString("en-US")),
  },
  {
    id: "health",
    label: "Health check ID",
    header: "Health check ID",
    cell: (r) => r.health_check_id ?? "-",
  },
  {
    id: "evaluate",
    label: "Evaluate target health",
    header: "Evaluate target health",
    cell: (r) => (r.alias ? (r.alias.evaluate_target_health ? "Yes" : "No") : "-"),
  },
  { id: "record_id", label: "Record ID", header: "Record ID", cell: (r) => r.set_identifier ?? "-" },
];

const DEFAULT_PREFS: Prefs = {
  pageSize: 100,
  wrapLines: false,
  custom: "automatic",
  contentDisplay: COLUMNS.map((c) => ({ id: c.id, visible: true })),
};

const ZONE_TYPE_LABEL = { public: "Public hosted zone", private: "Private hosted zone" };

export default function HostedZoneDetailsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const follow = useFollow();
  const comingSoon = useComingSoon();
  const { flash } = useConsole();
  const zoneId = params.get("id") ?? "";
  useShortcut("c", () => router.push(`/hostedzones/records/create/?zoneId=${zoneId}`));

  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const policy = params.get("policy") ?? "";
  const alias = params.get("alias") ?? "";
  const sort = params.get("sort") ?? "name";
  const order = params.get("order") === "desc" ? "desc" : "asc";
  const page = Number(params.get("page") ?? 1) || 1;
  const nav = (u: Record<string, string | number | undefined>) => router.replace(setQuery(params, u));
  const filtered = Boolean(q || type || policy || alias);

  const [prefs, setPrefs] = useTablePrefs(PREFS_KEY, DEFAULT_PREFS);
  const pageSize = prefs.pageSize ?? 100;

  const zoneLoad = useLoad(() => api.getZone(zoneId), [zoneId]);
  const recordsLoad = useLoad(
    () =>
      api.listRecords(zoneId, {
        q,
        type,
        routing_policy: policy,
        alias,
        sort,
        order,
        page,
        page_size: pageSize,
      }),
    [zoneId, q, type, policy, alias, sort, order, page, pageSize],
  );
  const zone = zoneLoad.data;
  const records = recordsLoad.data;

  const [filterText, setFilterText] = useState(q);
  useEffect(() => setFilterText(q), [q]);
  const [selected, setSelected] = useState<RecordSet[]>([]);
  const [splitOpen, setSplitOpen] = useState(true);
  const [deleteZone, setDeleteZone] = useState(false);
  const [deleteRecords, setDeleteRecords] = useState(false);

  useEffect(() => {
    setSelected((sel) => (records ? records.items.filter((r) => sel.some((s) => s.id === r.id)) : []));
  }, [records]);

  useEffect(() => {
    if (recordsLoad.error && recordsLoad.error.status !== 404)
      flash("error", `Failed to load records: ${recordsLoad.error.message}`);
  }, [recordsLoad.error, flash]);

  const reloadAll = () => {
    zoneLoad.reload();
    recordsLoad.reload();
  };

  const detailsHref = `/hostedzones/details/?id=${zoneId}`;
  const crumbs = [
    ROUTE53_CRUMB,
    { text: "Hosted zones", href: "/hostedzones/" },
    { text: zone ? bare(zone.name) : zoneId, href: detailsHref },
  ];

  if (zoneLoad.error) {
    return (
      <Shell breadcrumbs={crumbs}>
        <SpaceBetween size="l">
          <Header variant="h1">Hosted zone</Header>
          <Alert
            type="error"
            header={zoneLoad.error.status === 404 ? "Hosted zone not found" : "Unable to load hosted zone"}
            action={
              zoneLoad.error.status === 404 ? (
                <Button href="/hostedzones/" onFollow={follow}>
                  Go to Hosted zones
                </Button>
              ) : (
                <Button onClick={zoneLoad.reload}>Retry</Button>
              )
            }
          >
            {zoneLoad.error.message}
          </Alert>
        </SpaceBetween>
      </Shell>
    );
  }

  const total = records?.total ?? 0;
  const pagesCount = Math.max(1, Math.ceil(total / pageSize));
  const one = selected.length === 1 ? selected[0] : null;
  const hasProtected = selected.some((r) => r.is_protected);
  const editHref = (r: RecordSet) => `/hostedzones/records/edit/?zoneId=${zoneId}&id=${r.id}`;
  const matches = `${total} match${total === 1 ? "" : "es"}`;
  const clearFilters = () =>
    nav({ q: undefined, type: undefined, policy: undefined, alias: undefined, page: undefined });

  // Active filters as removable chips under the filter bar, as in the console.
  const tokens = [
    q && { key: "q", label: q },
    type && { key: "type", label: `Type: ${type}` },
    policy && {
      key: "policy",
      label: `Routing policy: ${POLICY_LABELS[policy as keyof typeof POLICY_LABELS] ?? policy}`,
    },
    alias && { key: "alias", label: `Alias: ${alias === "yes" ? "Yes" : "No"}` },
  ].filter(Boolean) as { key: string; label: string }[];

  const filterSelect = (label: string, param: string, value: string, options: SelectProps.Option[]) => (
    <Select
      selectedOption={options.find((o) => o.value === value) ?? null}
      options={options}
      placeholder={label}
      ariaLabel={`Filter by ${label.toLowerCase()}`}
      onChange={(e) => nav({ [param]: e.detail.selectedOption.value, page: undefined })}
    />
  );

  const splitPanel = one ? (
    <SplitPanel header="Record details" hidePreferencesButton>
      <SpaceBetween size="l">
        <Header
          variant="h3"
          actions={
            <Button href={editHref(one)} onFollow={follow}>
              Edit record
            </Button>
          }
        >
          {bare(one.name)} ({one.type})
        </Header>
        <KeyValuePairs
          columns={2}
          items={[
            { label: "Record name", value: bare(one.name) },
            { label: "Record type", value: one.type },
            { label: one.alias ? "Route traffic to" : "Value", value: routeTo(one) },
            { label: "Alias", value: one.alias ? "Yes" : "No" },
            { label: "TTL (seconds)", value: one.ttl === null ? "-" : one.ttl.toLocaleString("en-US") },
            { label: "Routing policy", value: POLICY_LABELS[one.routing_policy] },
            ...(one.alias
              ? [{ label: "Evaluate target health", value: one.alias.evaluate_target_health ? "Yes" : "No" }]
              : []),
            ...(one.routing_policy !== "simple"
              ? [
                  { label: "Differentiator", value: differentiator(one) },
                  { label: "Record ID", value: one.set_identifier ?? "-" },
                  { label: "Health check ID", value: one.health_check_id ?? "-" },
                ]
              : []),
          ]}
        />
      </SpaceBetween>
    </SplitPanel>
  ) : (
    <SplitPanel header="Record details" hidePreferencesButton>
      <Box textAlign="center" color="text-body-secondary">
        {selected.length} records selected.
      </Box>
    </SplitPanel>
  );

  const recordsTable = (
    <Table
      variant="borderless"
      items={records?.items ?? []}
      columnDefinitions={COLUMNS}
      columnDisplay={prefs.contentDisplay}
      wrapLines={prefs.wrapLines}
      loading={recordsLoad.loading && !records}
      loadingText="Loading records"
      trackBy="id"
      selectionType="multi"
      selectedItems={selected}
      onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
      ariaLabels={{
        selectionGroupLabel: "Record selection",
        allItemsSelectionLabel: () => "Select all records",
        itemSelectionLabel: (_, r) => `${bare(r.name)} ${r.type}`,
      }}
      sortingColumn={{ sortingField: sort }}
      sortingDescending={order === "desc"}
      onSortingChange={(e) =>
        nav({
          sort: e.detail.sortingColumn.sortingField,
          order: e.detail.isDescending ? "desc" : "asc",
          page: undefined,
        })
      }
      resizableColumns
      header={
        <Header
          variant="h2"
          // Like the console: the counter is the zone's record count, not the filtered count.
          counter={
            zone
              ? selected.length
                ? `(${selected.length}/${zone.record_count})`
                : `(${zone.record_count})`
              : undefined
          }
          info={<InfoLink help={RECORDS_HELP} />}
          description={
            <>
              Automatic mode is the current search behavior optimized for best filter results.{" "}
              <Link variant="primary" onFollow={() => comingSoon("Changing the search mode")}>
                To change modes go to settings.
              </Link>
            </>
          }
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="refresh"
                ariaLabel="Refresh records"
                loading={recordsLoad.loading && !!records}
                onClick={reloadAll}
              />
              <Button
                disabled={!selected.length || hasProtected}
                disabledReason={hasProtected ? "You can't delete the default SOA and NS records." : undefined}
                onClick={() => setDeleteRecords(true)}
              >
                Delete record
              </Button>
              <Button href={`/hostedzones/records/import/?zoneId=${zoneId}`} onFollow={follow}>
                Import zone file
              </Button>
              <Button
                variant="primary"
                href={`/hostedzones/records/create/?zoneId=${zoneId}`}
                onFollow={follow}
              >
                Create record
              </Button>
            </SpaceBetween>
          }
        >
          Records
        </Header>
      }
      filter={
        <SpaceBetween size="s">
          <div className="records-filter">
            <div className="records-filter-text">
              <TextFilter
                filteringText={filterText}
                filteringPlaceholder="Filter records by property or value"
                filteringAriaLabel="Filter records"
                countText={filtered ? matches : undefined}
                onChange={(e) => setFilterText(e.detail.filteringText)}
                onDelayedChange={(e) => nav({ q: e.detail.filteringText, page: undefined })}
              />
            </div>
            {filterSelect("Type", "type", type, TYPE_OPTIONS)}
            {filterSelect("Routing policy", "policy", policy, POLICY_OPTIONS)}
            {filterSelect("Alias", "alias", alias, ALIAS_OPTIONS)}
            {filtered && <Box color="text-body-secondary">{matches}</Box>}
          </div>
          {tokens.length > 0 && (
            <SpaceBetween direction="horizontal" size="s" alignItems="center">
              <TokenGroup
                items={tokens.map((t) => ({ label: t.label, dismissLabel: `Remove filter ${t.label}` }))}
                onDismiss={(e) => nav({ [tokens[e.detail.itemIndex].key]: undefined, page: undefined })}
              />
              <Button onClick={clearFilters}>Clear filters</Button>
            </SpaceBetween>
          )}
        </SpaceBetween>
      }
      pagination={
        <Pagination
          currentPageIndex={Math.min(page, pagesCount)}
          pagesCount={pagesCount}
          ariaLabels={PAGINATION_LABELS}
          onChange={(e) => nav({ page: e.detail.currentPageIndex })}
        />
      }
      preferences={
        <TablePreferences
          prefs={prefs}
          columns={COLUMNS.map((c) => ({ id: c.id, label: c.label, alwaysVisible: c.id === "name" }))}
          onConfirm={(p) => {
            setPrefs(p);
            nav({ page: undefined });
          }}
        />
      }
      empty={
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="m">
            {filtered ? (
              <>
                <SpaceBetween size="xxs">
                  <b>No matches</b>
                  <Box variant="p" color="inherit">
                    No results match your query.
                  </Box>
                </SpaceBetween>
                <Button onClick={clearFilters}>Clear filters</Button>
              </>
            ) : recordsLoad.error ? (
              <>
                <b>Unable to load records</b>
                <Button onClick={recordsLoad.reload}>Retry</Button>
              </>
            ) : (
              <b>No records</b>
            )}
          </SpaceBetween>
        </Box>
      }
    />
  );

  return (
    <Shell
      breadcrumbs={crumbs}
      contentType="table"
      splitPanel={selected.length ? splitPanel : undefined}
      splitPanelOpen={splitOpen}
      onSplitPanelToggle={setSplitOpen}
    >
      <SpaceBetween size="l">
        <Header
          variant="h1"
          info={<InfoLink help={ZONE_HELP} />}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setDeleteZone(true)} disabled={!zone}>
                Delete zone
              </Button>
              <Button onClick={() => comingSoon("Test record")}>Test record</Button>
              <Button onClick={() => comingSoon("Query logging")}>Configure query logging</Button>
              <ButtonDropdown
                disabled={!zone}
                items={[
                  { id: "bind", text: "BIND zone file (.zone)" },
                  { id: "json", text: "JSON (.json)" },
                ]}
                onItemClick={(e) => window.location.assign(exportUrl(zoneId, e.detail.id as "bind" | "json"))}
              >
                Export zone
              </ButtonDropdown>
            </SpaceBetween>
          }
        >
          {zone ? (
            <>
              <span className="zone-type-badge">
                <Badge color="blue">{zone.zone_type === "public" ? "Public" : "Private"}</Badge>
              </span>
              {bare(zone.name)}
            </>
          ) : (
            "Loading…"
          )}
        </Header>

        <Container>
          <ExpandableSection
            headerText="Hosted zone details"
            headerActions={
              <Button href={`/hostedzones/edit/?id=${zoneId}`} onFollow={follow} disabled={!zone}>
                Edit hosted zone
              </Button>
            }
          >
            {zone && (
              <KeyValuePairs
                columns={3}
                items={[
                  { label: "Hosted zone name", value: bare(zone.name) },
                  {
                    label: "Hosted zone ID",
                    value: (
                      <CopyToClipboard
                        variant="inline"
                        textToCopy={zone.id}
                        copySuccessText="Hosted zone ID copied"
                        copyErrorText="Failed to copy"
                      />
                    ),
                  },
                  { label: "Description", value: zone.description || "-" },
                  { label: "Query log", value: "-" },
                  { label: "Type", value: ZONE_TYPE_LABEL[zone.zone_type] },
                  { label: "Record count", value: zone.record_count },
                  {
                    label: "Name servers",
                    value: (
                      <ul className="plain-list">
                        {zone.name_servers.map((ns) => (
                          <li key={ns}>{bare(ns)}</li>
                        ))}
                      </ul>
                    ),
                  },
                  ...(zone.zone_type === "private"
                    ? [
                        {
                          label: zone.vpcs.length > 1 ? "VPCs" : "VPC",
                          value: (
                            <ul className="plain-list">
                              {zone.vpcs.map((v) => (
                                <li key={v.vpc_id}>{`${v.vpc_id} (${v.region})`}</li>
                              ))}
                            </ul>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </ExpandableSection>
        </Container>

        <Tabs
          tabs={[
            {
              id: "records",
              label: `Records (${zone?.record_count ?? "-"})`,
              content: <Container disableContentPaddings>{recordsTable}</Container>,
            },
            {
              id: "recovery",
              label: "Accelerated recovery",
              content: (
                <Container header={<Header variant="h2">Accelerated recovery</Header>}>
                  <Box color="text-body-secondary">
                    Coming soon. Accelerated recovery isn&apos;t available in this demo.
                  </Box>
                </Container>
              ),
            },
            {
              id: "dnssec",
              label: "DNSSEC signing",
              content: (
                <Container header={<Header variant="h2">DNSSEC signing</Header>}>
                  <KeyValuePairs
                    columns={2}
                    items={[
                      { label: "DNSSEC signing status", value: "Not signing" },
                      { label: "Key-signing keys (KSKs)", value: "-" },
                    ]}
                  />
                </Container>
              ),
            },
            {
              id: "tags",
              label: `Hosted zone tags (${zone?.tags.length ?? 0})`,
              content: (
                <Table
                  items={zone?.tags ?? []}
                  columnDefinitions={[
                    { id: "key", header: "Key", cell: (t) => t.key, isRowHeader: true },
                    { id: "value", header: "Value", cell: (t) => t.value || "-" },
                  ]}
                  header={
                    <Header
                      variant="h2"
                      counter={`(${zone?.tags.length ?? 0})`}
                      actions={
                        <Button href={`/hostedzones/edit/?id=${zoneId}`} onFollow={follow}>
                          Manage tags
                        </Button>
                      }
                    >
                      Tags
                    </Header>
                  }
                  empty={
                    <Box textAlign="center" color="inherit">
                      No tags associated with the resource.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>

      <DeleteZoneModal
        zones={zone ? [zone] : []}
        visible={deleteZone}
        onCancel={() => setDeleteZone(false)}
        onConfirm={async () => {
          await api.deleteZone(zoneId);
          flash("success", `Hosted zone ${zone ? bare(zone.name) : zoneId} was deleted.`);
          router.push("/hostedzones/");
        }}
      />
      <DeleteModal
        visible={deleteRecords}
        title={selected.length > 1 ? `Delete ${selected.length} records?` : "Delete record?"}
        onCancel={() => setDeleteRecords(false)}
        onConfirm={async () => {
          const names = selected.map((r) => `${bare(r.name)} (${r.type})`);
          try {
            for (const r of selected) await api.deleteRecord(zoneId, r.id);
          } finally {
            reloadAll();
          }
          setDeleteRecords(false);
          flash("success", `Deleted ${names.length === 1 ? "record" : "records"}: ${names.join(", ")}.`);
        }}
      >
        Delete the following {selected.length === 1 ? "record" : "records"}?
        <ul>
          {selected.map((r) => (
            <li key={r.id}>
              {bare(r.name)} ({r.type})
            </li>
          ))}
        </ul>
      </DeleteModal>
    </Shell>
  );
}
