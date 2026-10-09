"use client";

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useState } from "react";
import DeleteModal from "@/components/DeleteModal";
import { InfoLink, ROUTE53_CRUMB, Shell, useConsole, useFollow } from "@/components/console";
import { CIDR_HELP } from "@/components/help";
import { api } from "@/lib/api";
import type { CidrCollection } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";

export default function CidrCollectionsPage() {
  const follow = useFollow();
  const { flash } = useConsole();
  const { data, loading, error, reload } = useLoad(() => api.listCidrCollections(), []);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<CidrCollection[]>([]);
  const [deleting, setDeleting] = useState(false);

  const items = (data ?? []).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const one = selected[0];

  return (
    <Shell
      breadcrumbs={[ROUTE53_CRUMB, { text: "CIDR collections", href: "/cidrcollections/" }]}
      contentType="table"
    >
      <Table
        variant="full-page"
        items={items}
        loading={loading && !data}
        loadingText="Loading CIDR collections"
        trackBy="id"
        selectionType="single"
        selectedItems={selected}
        onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
        ariaLabels={{
          selectionGroupLabel: "CIDR collection selection",
          itemSelectionLabel: (_, c) => c.name,
        }}
        columnDefinitions={[
          {
            id: "name",
            header: "Collection name",
            isRowHeader: true,
            cell: (c) => (
              <Link href={`/cidrcollections/edit/?id=${c.id}`} onFollow={follow}>
                {c.name}
              </Link>
            ),
          },
          { id: "id", header: "ID", cell: (c) => c.id },
          {
            id: "locations",
            header: "Locations",
            cell: (c) => c.locations.map((l) => l.name).join(", ") || "-",
          },
          {
            id: "blocks",
            header: "CIDR blocks",
            cell: (c) => c.locations.reduce((n, l) => n + l.cidrs.length, 0),
          },
        ]}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={data ? `(${data.length})` : undefined}
            info={<InfoLink help={CIDR_HELP} />}
            description="A CIDR collection contains locations that hold IP address ranges in CIDR notation."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={!one}
                  href={one ? `/cidrcollections/edit/?id=${one.id}` : undefined}
                  onFollow={follow}
                >
                  View details
                </Button>
                <Button disabled={!one} onClick={() => setDeleting(true)}>
                  Delete
                </Button>
                <Button variant="primary" href="/cidrcollections/create/" onFollow={follow}>
                  Create CIDR collection
                </Button>
              </SpaceBetween>
            }
          >
            CIDR collections
          </Header>
        }
        filter={
          <TextFilter
            filteringText={filter}
            filteringPlaceholder="Search"
            filteringAriaLabel="Search CIDR collections"
            onChange={(e) => setFilter(e.detail.filteringText)}
          />
        }
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <Box color="inherit">{error ? "Unable to load CIDR collections." : "No collections"}</Box>
              {error ? (
                <Button onClick={reload}>Retry</Button>
              ) : (
                <Button href="/cidrcollections/create/" onFollow={follow}>
                  Create CIDR collection
                </Button>
              )}
            </SpaceBetween>
          </Box>
        }
      />
      <DeleteModal
        visible={deleting && !!one}
        title={`Delete CIDR collection ${one?.name ?? ""}?`}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await api.deleteCidrCollection(one.id);
          setDeleting(false);
          setSelected([]);
          flash("success", `CIDR collection ${one.name} was deleted.`);
          reload();
        }}
      >
        Delete CIDR collection <b>{one?.name}</b> and all of its locations? IP-based records that use it must
        be deleted first.
      </DeleteModal>
    </Shell>
  );
}
