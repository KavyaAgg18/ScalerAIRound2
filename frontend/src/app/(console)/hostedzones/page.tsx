"use client";

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import SplitPanel from "@cloudscape-design/components/split-panel";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import DeleteZoneModal from "@/components/DeleteZoneModal";
import TablePreferences, { useTablePrefs, type Prefs } from "@/components/TablePreferences";
import {
  PAGINATION_LABELS,
  ROUTE53_CRUMB,
  Shell,
  useComingSoon,
  useConsole,
  useFollow,
  useShortcut,
} from "@/components/console";
import { api, bare } from "@/lib/api";
import type { HostedZone } from "@/lib/types";
import { setQuery, useLoad } from "@/lib/useLoad";

const PREFS_KEY = "r53.hostedzones.prefs";
const PAGE_SIZE = 10;

const COLUMNS: (TableProps.ColumnDefinition<HostedZone> & { label: string })[] = [
  {
    id: "name",
    label: "Hosted zone name",
    header: "Hosted zone name",
    sortingField: "name",
    cell: () => null,
  },
  {
    id: "zone_type",
    label: "Type",
    header: "Type",
    sortingField: "zone_type",
    cell: (z) => (z.zone_type === "public" ? "Public" : "Private"),
  },
  { id: "created_by", label: "Created by", header: "Created by", cell: () => "Route 53" },
  {
    id: "record_count",
    label: "Record count",
    header: "Record count",
    sortingField: "record_count",
    cell: (z) => z.record_count,
  },
  {
    id: "description",
    label: "Description",
    header: "Description",
    sortingField: "description",
    cell: (z) => z.description || "-",
  },
  { id: "id", label: "Hosted zone ID", header: "Hosted zone ID", sortingField: "id", cell: (z) => z.id },
];

const DEFAULT_PREFS: Prefs = {
  pageSize: PAGE_SIZE,
  wrapLines: false,
  custom: "automatic",
  contentDisplay: COLUMNS.map((c) => ({ id: c.id!, visible: true })),
};

export default function HostedZonesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const follow = useFollow();
  useShortcut("c", () => router.push("/hostedzones/create/"));
  const { flash } = useConsole();
  const comingSoon = useComingSoon();

  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "name";
  const order = params.get("order") === "desc" ? "desc" : "asc";
  const page = Number(params.get("page") ?? 1) || 1;

  const [prefs, setPrefs] = useTablePrefs(PREFS_KEY, DEFAULT_PREFS);
  const pageSize = prefs.pageSize ?? PAGE_SIZE;

  const [filterText, setFilterText] = useState(q);
  useEffect(() => setFilterText(q), [q]);

  const [selected, setSelected] = useState<HostedZone[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [splitOpen, setSplitOpen] = useState(true);

  const { data, error, loading, reload } = useLoad(
    () => api.listZones({ q, sort, order, page, page_size: pageSize }),
    [q, sort, order, page, pageSize],
  );

  useEffect(() => {
    if (error) flash("error", `Failed to load hosted zones: ${error.message}`);
  }, [error, flash]);

  // Keep selection in sync with fresh data (drops rows that disappeared).
  useEffect(() => {
    setSelected((sel) => (data ? data.items.filter((z) => sel.some((s) => s.id === z.id)) : []));
  }, [data]);

  const nav = (updates: Record<string, string | number | undefined>) =>
    router.replace(setQuery(params, updates));
  const one = selected.length === 1 ? selected[0] : undefined;
  const total = data?.total ?? 0;
  const pagesCount = Math.max(1, Math.ceil(total / pageSize));

  const columns = COLUMNS.map((c) =>
    c.id === "name"
      ? {
          ...c,
          cell: (z: HostedZone) => (
            <Link href={`/hostedzones/details/?id=${z.id}`} onFollow={follow}>
              {bare(z.name)}
            </Link>
          ),
        }
      : c,
  );

  // Selecting one zone shows its details in the side panel, like the console.
  const splitPanel = one ? (
    <SplitPanel header="Hosted zone details" hidePreferencesButton>
      <KeyValuePairs
        columns={1}
        items={[
          { label: "Hosted zone name", value: bare(one.name) },
          { label: "Hosted zone ID", value: one.id },
          { label: "Description", value: one.description || "-" },
          { label: "Query log", value: "-" },
          { label: "Type", value: one.zone_type === "public" ? "Public hosted zone" : "Private hosted zone" },
          { label: "Record count", value: one.record_count },
          {
            label: "Name servers",
            value: (
              <ul className="plain-list">
                {one.name_servers.map((ns) => (
                  <li key={ns}>{bare(ns)}</li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </SplitPanel>
  ) : undefined;

  return (
    <Shell
      breadcrumbs={[ROUTE53_CRUMB, { text: "Hosted zones", href: "/hostedzones/" }]}
      contentType="table"
      splitPanel={splitPanel}
      splitPanelOpen={splitOpen}
      onSplitPanelToggle={setSplitOpen}
    >
      <Table
        wrapLines={prefs.wrapLines}
        variant="full-page"
        items={data?.items ?? []}
        columnDefinitions={columns}
        columnDisplay={prefs.contentDisplay}
        loading={loading && !data}
        loadingText="Loading hosted zones"
        trackBy="id"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
        ariaLabels={{
          selectionGroupLabel: "Hosted zone selection",
          allItemsSelectionLabel: () => "Select all hosted zones",
          itemSelectionLabel: (_, z) => bare(z.name),
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
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={data ? (selected.length ? `(${selected.length}/${total})` : `(${total})`) : undefined}
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
                  ariaLabel="Refresh hosted zones"
                  loading={loading && !!data}
                  onClick={reload}
                />
                <Button
                  disabled={!one}
                  href={one ? `/hostedzones/details/?id=${one.id}` : undefined}
                  onFollow={follow}
                >
                  View details
                </Button>
                <Button
                  disabled={!one}
                  href={one ? `/hostedzones/edit/?id=${one.id}` : undefined}
                  onFollow={follow}
                >
                  Edit
                </Button>
                <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
                  Delete
                </Button>
                <Button variant="primary" href="/hostedzones/create/" onFollow={follow}>
                  Create hosted zone
                </Button>
              </SpaceBetween>
            }
          >
            Hosted zones
          </Header>
        }
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Filter records by property or value"
            filteringAriaLabel="Filter hosted zones"
            countText={q ? `${total} match${total === 1 ? "" : "es"}` : undefined}
            onChange={(e) => setFilterText(e.detail.filteringText)}
            onDelayedChange={(e) => nav({ q: e.detail.filteringText, page: undefined })}
          />
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
            columns={COLUMNS.map((c) => ({ id: c.id!, label: c.label, alwaysVisible: c.id === "name" }))}
            onConfirm={(p) => {
              setPrefs(p);
              nav({ page: undefined });
            }}
          />
        }
        empty={
          q ? (
            <Box textAlign="center" color="inherit">
              <SpaceBetween size="m">
                <b>No matches</b>
                <Box variant="p" color="inherit">
                  No results match your query.
                </Box>
                <Button onClick={() => nav({ q: undefined, page: undefined })}>Clear filters</Button>
              </SpaceBetween>
            </Box>
          ) : error ? (
            <Box textAlign="center" color="inherit">
              <SpaceBetween size="m">
                <b>Unable to load hosted zones</b>
                <Button onClick={reload}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" color="inherit">
              <SpaceBetween size="m">
                <b>No hosted zones</b>
                <Box variant="p" color="inherit">
                  There are no hosted zones created for this account.
                </Box>
                <Button variant="primary" href="/hostedzones/create/" onFollow={follow}>
                  Create hosted zone
                </Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <DeleteZoneModal
        zones={selected}
        visible={deleting}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          // Delete in parallel; report the ones that failed (usually zones that still have records).
          const targets = selected;
          const results = await Promise.allSettled(targets.map((z) => api.deleteZone(z.id)));
          const deleted = targets.filter((_, i) => results[i].status === "fulfilled");
          const failed = targets.flatMap((z, i) => {
            const r = results[i];
            return r.status === "rejected" ? [`${bare(z.name)}: ${(r.reason as Error).message}`] : [];
          });
          if (deleted.length) {
            flash(
              "success",
              deleted.length === 1
                ? `Hosted zone ${bare(deleted[0].name)} was deleted.`
                : `Deleted ${deleted.length} hosted zones: ${deleted.map((z) => bare(z.name)).join(", ")}.`,
            );
            reload();
          }
          if (failed.length) throw new Error(failed.join(" "));
          setDeleting(false);
        }}
      />
    </Shell>
  );
}
