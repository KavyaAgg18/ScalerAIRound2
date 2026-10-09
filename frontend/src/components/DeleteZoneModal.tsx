"use client";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import DeleteModal from "@/components/DeleteModal";
import { useFollow } from "@/components/console";
import { bare } from "@/lib/api";
import type { HostedZone } from "@/lib/types";

interface Props {
  zones: HostedZone[];
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

// Copy of the console's "Delete hosted zone ...?" dialog, including the warning it shows when
// the zone still has records other than the default NS and SOA.
export default function DeleteZoneModal({ zones, visible, onCancel, onConfirm }: Props) {
  const follow = useFollow();
  const one = zones.length === 1 ? zones[0] : null;
  const busy = zones.filter((z) => z.record_count > 2);

  return (
    <DeleteModal
      visible={visible && zones.length > 0}
      title={one ? `Delete hosted zone ${bare(one.name)}?` : `Delete ${zones.length} hosted zones?`}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmLabel={
        <span>
          To confirm that you want to delete the hosted {one ? "zone" : "zones"}, enter <i>delete</i> in the
          field.
        </span>
      }
      warning={
        busy.length > 0 && (
          <Alert
            type="warning"
            header={
              one
                ? `Take these actions to delete hosted zone ${bare(one.name)}`
                : "Take these actions to delete the hosted zones"
            }
          >
            <SpaceBetween size="s">
              <Box variant="p">
                Complete the following steps to successfully delete{" "}
                {one ? "this hosted zone" : "these hosted zones"}. If you don&apos;t complete the steps, the
                deletion might be blocked by Route 53 service validation.
              </Box>
              <ul>
                <li>
                  Delete all records in {one ? "this hosted zone" : busy.map((z) => bare(z.name)).join(", ")},
                  except the default NS and SOA records.
                </li>
              </ul>
              {busy.length === 1 && (
                <Button href={`/hostedzones/details/?id=${busy[0].id}`} onFollow={follow}>
                  Go to hosted zone details
                </Button>
              )}
            </SpaceBetween>
          </Alert>
        )
      }
    >
      {one ? (
        "Delete the hosted zone permanently? This action cannot be undone. Your domain might become unavailable on the internet."
      ) : (
        <>
          Delete these hosted zones permanently? This action cannot be undone.
          <ul>
            {zones.map((z) => (
              <li key={z.id}>{bare(z.name)}</li>
            ))}
          </ul>
        </>
      )}
    </DeleteModal>
  );
}
