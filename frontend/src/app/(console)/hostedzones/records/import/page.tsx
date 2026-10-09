"use client";

import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FileUpload from "@cloudscape-design/components/file-upload";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ROUTE53_CRUMB, Shell, useConsole, useFollow } from "@/components/console";
import { api, ApiError, bare } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

const EXAMPLE = `$TTL 300
www     IN  A     192.0.2.1
api         CNAME lb.example.net.
@           MX    10 mail.example.com.`;

export default function ImportZoneFilePage() {
  const router = useRouter();
  const follow = useFollow();
  const { flash } = useConsole();
  const zoneId = useSearchParams().get("zoneId") ?? "";
  const { data: zone, error: zoneError } = useLoad(() => api.getZone(zoneId), [zoneId]);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; lines: string[] } | null>(null);

  const detailsHref = `/hostedzones/details/?id=${zoneId}`;
  const zoneLabel = zone ? bare(zone.name) : zoneId;

  async function pickFile(picked: File[]) {
    setFiles(picked);
    if (picked[0]) setText(await picked[0].text());
  }

  async function submit() {
    setSubmitted(true);
    setProblem(null);
    if (!text.trim()) return;
    setBusy(true);
    try {
      const result = await api.importZoneFile(zoneId, text);
      const skipped = result.skipped
        ? ` ${result.skipped} SOA/NS line(s) for the zone apex were skipped; Route 53 keeps its own.`
        : "";
      flash("success", `Imported ${result.imported} record(s) into ${zoneLabel}.${skipped}`);
      router.push(detailsHref);
    } catch (e) {
      if (e instanceof ApiError) {
        setProblem({ title: e.message, lines: e.messages });
      } else {
        setProblem({ title: String(e), lines: [] });
      }
      setBusy(false);
    }
  }

  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "Hosted zones", href: "/hostedzones/" },
        { text: zoneLabel, href: detailsHref },
        { text: "Import zone file", href: `/hostedzones/records/import/?zoneId=${zoneId}` },
      ]}
    >
      {zoneError ? (
        <Alert type="error" header="Unable to load hosted zone">
          {zoneError.message}
        </Alert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Form
            header={
              <Header
                variant="h1"
                description={`Create records in ${zoneLabel} from a zone file in BIND format. Nothing is imported if any line has a problem.`}
              >
                Import zone file
              </Header>
            }
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" href={detailsHref} onFollow={follow} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" formAction="submit" loading={busy} disabled={!zone}>
                  Import
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween size="l">
              {problem && (
                <Alert type="error" header={problem.title}>
                  {problem.lines.length > 0 && (
                    <ul>
                      {problem.lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  )}
                </Alert>
              )}
              <Container header={<Header variant="h2">Zone file</Header>}>
                <SpaceBetween size="l">
                  <FormField
                    label="Upload a file"
                    description="Or paste the contents of the zone file below."
                  >
                    <FileUpload
                      value={files}
                      onChange={(e) => pickFile(e.detail.value)}
                      accept=".zone,.txt,.db,text/plain"
                      constraintText="Text file in BIND format."
                      i18nStrings={{
                        uploadButtonText: () => "Choose file",
                        dropzoneText: () => "Drop file to upload",
                        removeFileAriaLabel: () => "Remove file",
                        limitShowFewer: "Show fewer files",
                        limitShowMore: "Show more files",
                        errorIconAriaLabel: "Error",
                      }}
                    />
                  </FormField>
                  <FormField
                    label="Zone file"
                    stretch
                    constraintText="Supported: A, AAAA, CNAME, TXT, MX, NS, PTR, SRV, CAA, plus $ORIGIN and $TTL. SOA and NS records for the zone apex are ignored."
                    errorText={submitted && !text.trim() ? "Paste a zone file or choose a file." : undefined}
                  >
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.detail.value)}
                      rows={18}
                      placeholder={EXAMPLE}
                      ariaLabel="Zone file"
                      spellcheck={false}
                    />
                  </FormField>
                </SpaceBetween>
              </Container>
            </SpaceBetween>
          </Form>
        </form>
      )}
    </Shell>
  );
}
