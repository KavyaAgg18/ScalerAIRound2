// Help-panel content and console copy shared by several pages.

export const DOMAIN_CHARS =
  "Valid characters: a-z, 0-9, ! \" # $ % & ' ( ) * + , - / : ; < = > ? @ [ \\ ] ^ _ ` { | } . ~";

export const ZONE_HELP = {
  title: "Hosted zones",
  body: (
    <p>
      A hosted zone is a container for records. Records contain information about how you want to route
      traffic for a specific domain, such as example.com, and its subdomains. A public hosted zone routes
      traffic on the internet; a private hosted zone routes traffic within one or more Amazon VPCs.
    </p>
  ),
};

export const RECORDS_HELP = {
  title: "Records",
  body: (
    <p>
      Each record set has a name, a type, a TTL and one or more values. Route 53 creates an NS and an SOA
      record for every hosted zone; you can edit them but not delete them.
    </p>
  ),
};

export const HEALTH_HELP = {
  title: "Health checks",
  body: (
    <p>
      A health check monitors an endpoint by IP address or domain name. Weighted, failover, latency,
      geolocation, geoproximity, IP-based and multivalue answer records can use one, so Route 53 stops
      returning a record when its endpoint is unhealthy. In this demo the status is simulated.
    </p>
  ),
};

export const CIDR_HELP = {
  title: "CIDR collections",
  body: (
    <p>
      A CIDR collection groups IP address ranges (CIDR blocks) into named locations. IP-based routing records
      pick a collection and a location, so queries from those ranges get that record.
    </p>
  ),
};
