"use client";

import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";
import { useRouter, useSearchParams } from "next/navigation";
import CidrCollectionForm from "@/components/CidrCollectionForm";
import { ROUTE53_CRUMB, Shell, useConsole } from "@/components/console";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

export default function EditCidrCollectionPage() {
  const router = useRouter();
  const { flash } = useConsole();
  const id = useSearchParams().get("id") ?? "";
  const { data, error } = useLoad(() => api.getCidrCollection(id), [id]);
  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "CIDR collections", href: "/cidrcollections/" },
        { text: data?.name ?? id, href: `/cidrcollections/edit/?id=${id}` },
      ]}
    >
      {error ? (
        <Alert type="error" header="Unable to load CIDR collection">
          {error.message}
        </Alert>
      ) : !data ? (
        <Spinner size="large" />
      ) : (
        <CidrCollectionForm
          title={data.name}
          submitLabel="Save changes"
          initial={data}
          onSubmit={async (body) => {
            await api.updateCidrCollection(id, body);
            flash("success", `CIDR collection ${body.name} was updated.`);
            router.push("/cidrcollections/");
          }}
        />
      )}
    </Shell>
  );
}
