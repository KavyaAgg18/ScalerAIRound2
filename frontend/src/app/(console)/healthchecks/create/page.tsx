"use client";

import { useRouter } from "next/navigation";
import HealthCheckForm from "@/components/HealthCheckForm";
import { ROUTE53_CRUMB, Shell, useConsole } from "@/components/console";
import { api } from "@/lib/api";

export default function CreateHealthCheckPage() {
  const router = useRouter();
  const { flash } = useConsole();
  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "Health checks", href: "/healthchecks/" },
        { text: "Create health check", href: "/healthchecks/create/" },
      ]}
    >
      <HealthCheckForm
        title="Create health check"
        submitLabel="Create health check"
        onSubmit={async (body) => {
          const hc = await api.createHealthCheck(body);
          flash("success", `Health check ${hc.name || hc.id} was successfully created.`);
          router.push("/healthchecks/");
        }}
      />
    </Shell>
  );
}
