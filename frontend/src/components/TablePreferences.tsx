"use client";

import CollectionPreferences, {
  type CollectionPreferencesProps,
} from "@cloudscape-design/components/collection-preferences";
import FormField from "@cloudscape-design/components/form-field";
import RadioGroup from "@cloudscape-design/components/radio-group";
import { useEffect, useState } from "react";

export type Prefs = CollectionPreferencesProps.Preferences<string>;

/** Table preferences saved per browser (page size, wrap lines, visible columns). */
export function useTablePrefs(storageKey: string, defaults: Prefs) {
  const [prefs, setPrefs] = useState(defaults);
  useEffect(() => {
    try {
      setPrefs({ ...defaults, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") });
    } catch {
      // Unreadable or blocked storage: keep the defaults.
    }
    // defaults is a module constant at each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const save = (next: Prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  };
  return [prefs, save] as const;
}

const SEARCH_MODES = [
  {
    value: "automatic",
    label: "Automatic",
    description: "The service chooses a filter mode based on the total number of items.",
  },
  {
    value: "full",
    label: "Full",
    description: "All search filters are available, but search performance might be slower.",
  },
  {
    value: "fast",
    label: "Fast",
    description: "Some advanced searches may not be available, but search performance will be faster.",
  },
];

interface Props {
  prefs: Prefs;
  onConfirm: (prefs: Prefs) => void;
  columns: { id: string; label: string; alwaysVisible?: boolean }[];
}

// Same layout as the console: page size, wrap lines and search mode on the left, columns on the right.
export default function TablePreferences({ prefs, onConfirm, columns }: Props) {
  return (
    <CollectionPreferences
      title="Preferences"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      preferences={prefs}
      onConfirm={(e) => onConfirm(e.detail)}
      pageSizePreference={{
        title: "Page size",
        options: [10, 30, 50, 100].map((n) => ({ value: n, label: `${n} items` })),
      }}
      wrapLinesPreference={{
        label: "Wrap lines",
        description: "Check to see all the text and wrap the lines.",
      }}
      customPreference={(value, setValue) => (
        <FormField label="Search mode">
          <RadioGroup
            value={value ?? "automatic"}
            onChange={(e) => setValue(e.detail.value)}
            items={SEARCH_MODES}
          />
        </FormField>
      )}
      contentDisplayPreference={{
        title: "Select visible columns",
        description: "Properties",
        options: columns,
      }}
    />
  );
}
