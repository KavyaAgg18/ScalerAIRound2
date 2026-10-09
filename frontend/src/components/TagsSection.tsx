"use client";

import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import type { Tag } from "@/lib/types";

export type EditableTag = TagEditorProps.Tag;

export const toEditable = (tags: Tag[]): EditableTag[] => tags.map((t) => ({ ...t, existing: true }));

/** Tags the API should store: everything that isn't marked for removal. */
export const toTags = (tags: readonly EditableTag[]): Tag[] =>
  tags.filter((t) => !t.markedForRemoval).map(({ key, value }) => ({ key: key.trim(), value }));

const I18N: TagEditorProps.I18nStrings = {
  keyPlaceholder: "Enter key",
  valuePlaceholder: "Enter value",
  addButton: "Add tag",
  removeButton: "Remove",
  undoButton: "Undo",
  undoPrompt: "This tag will be removed upon saving changes",
  loading: "Loading tags that are associated with this resource",
  keyHeader: "Key",
  valueHeader: "Value",
  optional: "optional",
  keySuggestion: "Custom tag key",
  valueSuggestion: "Custom tag value",
  emptyTags: "No tags associated with the resource.",
  tooManyKeysSuggestion: "You have more keys than can be displayed",
  tooManyValuesSuggestion: "You have more values than can be displayed",
  keysSuggestionLoading: "Loading tag keys",
  keysSuggestionError: "Tag keys could not be retrieved",
  valuesSuggestionLoading: "Loading tag values",
  valuesSuggestionError: "Tag values could not be retrieved",
  emptyKeyError: "You must specify a tag key",
  maxKeyCharLengthError: "The maximum number of characters you can use in a tag key is 128.",
  maxValueCharLengthError: "The maximum number of characters you can use in a tag value is 256.",
  duplicateKeyError: "You must specify a unique tag key.",
  invalidKeyError:
    "Invalid key. Keys can only contain Unicode letters, digits, white space and any of the following: _.:/=+@-",
  invalidValueError:
    "Invalid value. Values can only contain Unicode letters, digits, white space and any of the following: _.:/=+@-",
  awsPrefixError: "Cannot start with aws:",
  tagLimit: (available) =>
    available === 1 ? "You can add up to 1 more tag." : `You can add up to ${available} more tags.`,
  tagLimitReached: (limit) => `You have reached the limit of ${limit} tags.`,
  tagLimitExceeded: (limit) => `You have exceeded the limit of ${limit} tags.`,
  enteredKeyLabel: (key) => `Use "${key}"`,
  enteredValueLabel: (value) => `Use "${value}"`,
  removeButtonAriaLabel: (tag) => `Remove ${tag.key}`,
};

interface Props {
  tags: readonly EditableTag[];
  onChange: (tags: readonly EditableTag[], valid: boolean) => void;
  info?: React.ReactNode;
}

export default function TagsSection({ tags, onChange, info }: Props) {
  return (
    <Container
      header={
        <Header
          variant="h2"
          info={info}
          description="Apply tags to hosted zones to help organize and identify them."
        >
          Tags
        </Header>
      }
    >
      <TagEditor
        tags={tags}
        tagLimit={50}
        i18nStrings={I18N}
        onChange={(e) => onChange(e.detail.tags, e.detail.valid)}
      />
    </Container>
  );
}
