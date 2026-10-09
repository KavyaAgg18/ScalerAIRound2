"use client";

import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";
import { useRouter, useSearchParams } from "next/navigation";
import HealthCheckForm from "@/components/HealthCheckForm";
import { ROUTE53_CRUMB, Shell, useConsole } from "@/components/console";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

export default function EditHealthCheckPage() {
  const router = useRouter();
  const { flash } = useConsole();
  const id = useSearchParams().get("id") ?? "";
  const { data, error } = useLoad(() => api.getHealthCheck(id), [id]);
  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "Health checks", href: "/healthchecks/" },
        { text: data?.name || id, href: `/healthchecks/edit/?id=${id}` },
      ]}
    >
      {error ? (
        <Alert type="error" header="Unable to load health check">
          {error.message}
        </Alert>
      ) : !data ? (
        <Spinner size="large" />
      ) : (
        <HealthCheckForm
          title={`Edit health check ${data.name || data.id}`}
          submitLabel="Save changes"
          initial={data}
          onSubmit={async (body) => {
            await api.updateHealthCheck(id, body);
            flash("success", `Health check ${body.name || id} was updated.`);
            router.push("/healthchecks/");
          }}
        />
      )}
    </Shell>
  );
}
