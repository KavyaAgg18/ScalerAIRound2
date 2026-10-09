"use client";

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useEffect, useState } from "react";
import DeleteModal from "@/components/DeleteModal";
import {
  InfoLink,
  PAGINATION_LABELS,
  ROUTE53_CRUMB,
  Shell,
  useConsole,
  useFollow,
} from "@/components/console";
import { HEALTH_HELP } from "@/components/help";
import { api } from "@/lib/api";
import type { HealthCheck } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";

const PAGE_SIZE = 10;

const healthStatus = (h: HealthCheck) => (
  <StatusIndicator type={h.status === "Healthy" ? "success" : h.status === "Unhealthy" ? "error" : "pending"}>
    {h.status}
  </StatusIndicator>
);

export default function HealthChecksPage() {
  const follow = useFollow();
  const { flash } = useConsole();
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<HealthCheck[]>([]);
  const [deleting, setDeleting] = useState(false);

  const { data, loading, error, reload } = useLoad(
    () => api.listHealthChecks({ q: query, page, page_size: PAGE_SIZE }),
    [query, page],
  );
  useEffect(() => {
    setSelected((sel) => (data ? data.items.filter((h) => sel.some((s) => s.id === h.id)) : []));
  }, [data]);

  const total = data?.total ?? 0;
  const one = selected.length === 1 ? selected[0] : undefined;

  return (
    <Shell
      breadcrumbs={[ROUTE53_CRUMB, { text: "Health checks", href: "/healthchecks/" }]}
      contentType="table"
    >
      <Table
        variant="full-page"
        items={data?.items ?? []}
        loading={loading && !data}
        loadingText="Loading health checks"
        trackBy="id"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
        ariaLabels={{
          selectionGroupLabel: "Health check selection",
          allItemsSelectionLabel: () => "Select all health checks",
          itemSelectionLabel: (_, h) => h.name || h.id,
        }}
        columnDefinitions={[
          {
            id: "id",
            header: "ID",
            isRowHeader: true,
            cell: (h) => (
              <Link href={`/healthchecks/edit/?id=${h.id}`} onFollow={follow}>
                {h.id}
              </Link>
            ),
          },
          { id: "name", header: "Name", cell: (h) => h.name || "-" },
          { id: "status", header: "Current status", cell: healthStatus },
          { id: "details", header: "Details", cell: (h) => h.endpoint },
          { id: "interval", header: "Request interval", cell: (h) => `${h.request_interval} seconds` },
          { id: "threshold", header: "Failure threshold", cell: (h) => h.failure_threshold },
        ]}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={data ? (selected.length ? `(${selected.length}/${total})` : `(${total})`) : undefined}
            info={<InfoLink help={HEALTH_HELP} />}
            description="Route 53 health checks monitor the health and performance of your application's servers and endpoints. Status in this demo is simulated."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh health checks" onClick={reload} />
                <Button
                  disabled={!one}
                  href={one ? `/healthchecks/edit/?id=${one.id}` : undefined}
                  onFollow={follow}
                >
                  Edit health check
                </Button>
                <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
                  Delete health check
                </Button>
                <Button variant="primary" href="/healthchecks/create/" onFollow={follow}>
                  Create health check
                </Button>
              </SpaceBetween>
            }
          >
            Health checks
          </Header>
        }
        filter={
          <TextFilter
            filteringText={filter}
            filteringPlaceholder="Find health check"
            filteringAriaLabel="Find health check"
            onChange={(e) => setFilter(e.detail.filteringText)}
            onDelayedChange={(e) => {
              setQuery(e.detail.filteringText);
              setPage(1);
            }}
          />
        }
        pagination={
          <Pagination
            currentPageIndex={page}
            pagesCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            ariaLabels={PAGINATION_LABELS}
            onChange={(e) => setPage(e.detail.currentPageIndex)}
          />
        }
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <Box color="inherit">
                {error ? "Unable to load health checks." : "No health checks to display."}
              </Box>
              {error ? (
                <Button onClick={reload}>Retry</Button>
              ) : (
                <Button href="/healthchecks/create/" onFollow={follow}>
                  Create health check
                </Button>
              )}
            </SpaceBetween>
          </Box>
        }
      />
      <DeleteModal
        visible={deleting && selected.length > 0}
        title={selected.length > 1 ? `Delete ${selected.length} health checks?` : "Delete health check?"}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          const targets = selected;
          const results = await Promise.allSettled(targets.map((h) => api.deleteHealthCheck(h.id)));
          const failed = targets.flatMap((h, i) => {
            const r = results[i];
            return r.status === "rejected" ? [`${h.name || h.id}: ${(r.reason as Error).message}`] : [];
          });
          const deleted = targets.length - failed.length;
          if (deleted) {
            flash("success", `Deleted ${deleted} health check${deleted > 1 ? "s" : ""}.`);
            reload();
          }
          if (failed.length) throw new Error(failed.join(" "));
          setDeleting(false);
        }}
      >
        Delete the following health checks? Records that use them must be updated first.
        <ul>
          {selected.map((h) => (
            <li key={h.id}>{h.name ? `${h.name} (${h.id})` : h.id}</li>
          ))}
        </ul>
      </DeleteModal>
    </Shell>
  );
}
