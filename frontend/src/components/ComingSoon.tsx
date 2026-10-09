"use client";

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { ROUTE53_CRUMB, Shell, useFollow } from "@/components/console";

// Placeholder for the parts of Route 53 this clone doesn't implement (allowed by the brief).
export default function ComingSoon({ title, href }: { title: string; href: string }) {
  const follow = useFollow();
  const crumbs = href === "/" ? [ROUTE53_CRUMB] : [ROUTE53_CRUMB, { text: title, href }];

  return (
    <Shell breadcrumbs={crumbs}>
      <ContentLayout header={<Header variant="h1">{title}</Header>}>
        <Container>
          <Box textAlign="center" padding={{ vertical: "xxxl" }}>
            <SpaceBetween size="m">
              <Box variant="h2" tagOverride="p">
                Coming soon
              </Box>
              <Box variant="p" color="text-body-secondary">
                {title} isn&apos;t available in this demo yet. Hosted zones and DNS records are fully working.
              </Box>
              <Button variant="primary" href="/hostedzones/" onFollow={follow}>
                Go to Hosted zones
              </Button>
            </SpaceBetween>
          </Box>
        </Container>
      </ContentLayout>
    </Shell>
  );
}
