import { notFound } from "next/navigation";
import ComingSoon from "@/components/ComingSoon";

// Side-nav entries without a real page get a "Coming soon" page.
const TITLES: Record<string, string> = {
  profiles: "Profiles",
  globalresolvers: "Global resolvers",
  shareddnsviews: "Shared DNS views",
  resolver: "VPCs",
  inboundendpoints: "Inbound endpoints",
  outboundendpoints: "Outbound endpoints",
  resolverrules: "Rules",
  querylogging: "Query logging",
  outposts: "Outposts",
  domains: "Registered domains",
  requests: "Requests",
  trafficpolicies: "Traffic policies",
  policyrecords: "Policy records",
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(TITLES).map((section) => ({ section }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const title = TITLES[section];
  if (!title) notFound();
  return <ComingSoon title={title} href={`/${section}/`} />;
}
