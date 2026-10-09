"use client";

import { useRouter } from "next/navigation";
import CidrCollectionForm from "@/components/CidrCollectionForm";
import { ROUTE53_CRUMB, Shell, useConsole } from "@/components/console";
import { api } from "@/lib/api";

export default function CreateCidrCollectionPage() {
  const router = useRouter();
  const { flash } = useConsole();
  return (
    <Shell
      contentType="form"
      breadcrumbs={[
        ROUTE53_CRUMB,
        { text: "CIDR collections", href: "/cidrcollections/" },
        { text: "Create CIDR collection", href: "/cidrcollections/create/" },
      ]}
    >
      <CidrCollectionForm
        title="Create CIDR collection"
        submitLabel="Create CIDR collection"
        onSubmit={async (body) => {
          const c = await api.createCidrCollection(body);
          flash("success", `CIDR collection ${c.name} was successfully created.`);
          router.push("/cidrcollections/");
        }}
      />
    </Shell>
  );
}
