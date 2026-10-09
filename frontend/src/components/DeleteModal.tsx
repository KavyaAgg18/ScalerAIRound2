"use client";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";

interface Props {
  visible: boolean;
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  /** Shown between the message and the confirm field; defaults to a generic "can't be undone" warning. */
  warning?: ReactNode;
  confirmLabel?: ReactNode;
}

// Same pattern as the console: the Delete button stays off until you type "delete".
export default function DeleteModal({
  visible,
  title,
  children,
  onCancel,
  onConfirm,
  warning = <Alert type="warning">This action can&apos;t be undone.</Alert>,
  confirmLabel = (
    <span>
      To confirm deletion, type <i>delete</i> in the field.
    </span>
  ),
}: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible) {
      setText("");
      setError("");
    }
  }, [visible]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      onDismiss={onCancel}
      header={title}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} loading={busy} disabled={text !== "delete"}>
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="span">{children}</Box>
        {warning}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text === "delete") confirm();
          }}
        >
          <FormField label={confirmLabel}>
            <Input
              value={text}
              onChange={(e) => setText(e.detail.value)}
              placeholder="delete"
              ariaLabel="Type delete to confirm"
            />
          </FormField>
        </form>
        {error && <Alert type="error">{error}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
