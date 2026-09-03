import type { NmapProjectedService } from "@blackglass/contracts";
import { LoadingRegion, RecoverableError, Skeleton, StaleDataState } from "@blackglass/ui";

import { formatEngagementTimestamp } from "./format.js";
import { useEngagementServicesQuery } from "./query.js";

function deriveServiceStats(services: readonly NmapProjectedService[]) {
  const hostCount = new Set(services.map((service) => service.address)).size;
  const artifactCount = new Set(services.map((service) => service.artifactId)).size;
  let latestObservedAt: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const service of services) {
    const time = Date.parse(service.observedAt);
    const parsed = Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
    if (
      latestObservedAt === undefined ||
      parsed > latestTime ||
      (parsed === latestTime && service.observedAt > latestObservedAt)
    ) {
      latestTime = parsed;
      latestObservedAt = service.observedAt;
    }
  }
  return { serviceCount: services.length, hostCount, artifactCount, latestObservedAt };
}

function formatPrimaryIdentity(service: NmapProjectedService): string {
  if (service.product !== null) {
    return service.version !== null ? `${service.product} ${service.version}` : service.product;
  }
  if (service.serviceName !== null) return service.serviceName;
  return "unknown";
}

function artifactContentUrl(engagementId: string, artifactId: string): string {
  return `/api/v1/engagements/${encodeURIComponent(engagementId)}/artifacts/${encodeURIComponent(artifactId)}/content`;
}

function sortServices(services: readonly NmapProjectedService[]): NmapProjectedService[] {
  return [...services].sort((left, right) => {
    const address = left.address.localeCompare(right.address, "en", { numeric: true });
    if (address !== 0) return address;
    return left.port - right.port;
  });
}

export function EngagementServicesSection({ engagementId }: { engagementId: string }) {
  const servicesQuery = useEngagementServicesQuery(engagementId);
  const hasData = servicesQuery.data !== undefined;
  const retry = () => void servicesQuery.refetch();

  if (!hasData && servicesQuery.isFetching) return <ServicesLoadingState />;
  if (!hasData && servicesQuery.isError) {
    return (
      <RecoverableError
        title="Attack surface unavailable"
        description="The attack surface could not be loaded from the local control plane."
        onRetry={retry}
      />
    );
  }
  if (!hasData) return <ServicesLoadingState />;

  const services = servicesQuery.data;
  const stats = deriveServiceStats(services);
  const sorted = sortServices(services);
  const latestLabel =
    stats.latestObservedAt !== undefined ? formatEngagementTimestamp(stats.latestObservedAt) : "-";

  const statBar = (
    <section aria-label="Engagement totals" className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        <div className="px-3 py-3 sm:px-4">
          <div className="text-[22px] font-semibold tracking-[-0.04em]">{stats.serviceCount}</div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Services</div>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="text-[22px] font-semibold tracking-[-0.04em]">{stats.hostCount}</div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Hosts</div>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="text-[22px] font-semibold tracking-[-0.04em]">{stats.artifactCount}</div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Evidence artifacts</div>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="truncate text-[12px] font-medium tracking-[-0.02em]" title={latestLabel}>
            {latestLabel}
          </div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Latest observation</div>
        </div>
      </div>
    </section>
  );

  const attackSurface =
    sorted.length === 0 ? (
      <section aria-label="Attack surface" className="overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="flex min-h-10 items-center justify-between border-b border-border px-3">
          <h2 className="m-0 text-[13px] font-semibold">Attack surface</h2>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">Projected Nmap services</span>
        </div>
        <div className="px-4 py-8 text-center">
          <h3 className="m-0 text-[13px] font-semibold">No services yet</h3>
          <p className="mx-auto mt-2 mb-0 max-w-md text-[13px] leading-5 text-muted-foreground">
            No services have been observed for this engagement. Complete an Nmap run to populate the attack
            surface.
          </p>
        </div>
      </section>
    ) : (
      <section aria-label="Attack surface" className="overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="flex min-h-10 items-center justify-between border-b border-border px-3">
          <h2 className="m-0 text-[13px] font-semibold">Attack surface</h2>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">Projected Nmap services</span>
        </div>
        <div className="divide-y divide-border">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_96px_minmax(0,1.2fr)_130px] gap-3 bg-muted/40 px-3 py-2 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase md:grid">
            <span>Address</span>
            <span>Port</span>
            <span>Service</span>
            <span>Observed</span>
          </div>
          {sorted.map((service) => (
            <ServiceRow
              key={`${service.address}:${service.port}:${service.artifactId}`}
              service={service}
              engagementId={engagementId}
            />
          ))}
        </div>
      </section>
    );

  const body = (
    <div className="grid gap-4">
      {statBar}
      {attackSurface}
    </div>
  );

  if (servicesQuery.isError) {
    return (
      <StaleDataState
        title="Showing the last successful attack surface"
        description="The latest refresh failed. Existing services are still available."
        onRetry={retry}
      >
        {body}
      </StaleDataState>
    );
  }

  return body;
}

function ServicesLoadingState() {
  return (
    <section aria-label="Attack surface" className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="flex min-h-10 items-center justify-between border-b border-border px-3">
        <h2 className="m-0 text-[13px] font-semibold">Attack surface</h2>
      </div>
      <LoadingRegion label="Loading attack surface" className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
          <Skeleton className="h-16 rounded-none bg-card" />
          <Skeleton className="h-16 rounded-none bg-card" />
          <Skeleton className="h-16 rounded-none bg-card" />
          <Skeleton className="h-16 rounded-none bg-card" />
        </div>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </LoadingRegion>
    </section>
  );
}

function ServiceRow({ engagementId, service }: { engagementId: string; service: NmapProjectedService }) {
  const observedLabel = formatEngagementTimestamp(service.observedAt);
  const primary = formatPrimaryIdentity(service);
  const secondary =
    service.serviceName !== null && service.serviceName !== primary ? service.serviceName : null;
  const evidenceUrl = artifactContentUrl(engagementId, service.artifactId);

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,1.4fr)_96px_minmax(0,1.2fr)_130px] md:items-start md:gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold tracking-[-0.02em]" title={service.address}>
            {service.address}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={service.hostname ?? undefined}>
            {service.hostname ?? "-"}
          </div>
        </div>
        <div className="font-mono text-[13px] font-medium">{`${service.port}/${service.protocol}`}</div>
        <div className="min-w-0">
          <div className="truncate text-[13px]" title={primary}>
            {primary}
          </div>
          {secondary ? (
            <div className="truncate text-[11px] text-muted-foreground" title={secondary}>
              {secondary}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={observedLabel}>
            {observedLabel}
          </div>
          <a
            className="mt-1 inline-block max-w-full truncate text-[11px] font-medium underline underline-offset-2"
            href={evidenceUrl}
            download={`nmap-${service.artifactId}.xml`}
          >
            XML
          </a>
        </div>
      </div>
      <details className="group mx-3 mb-3 rounded-md border border-border">
        <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between px-2.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>Provenance</span>
          <span className="text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-border px-2.5 py-2">
          <dl className="grid gap-2 sm:grid-cols-2">
            <ProvenanceField term="runId" value={service.runId} mono />
            <ProvenanceField term="artifactId" value={service.artifactId} mono />
            <ProvenanceField term="artifactDigest" value={service.artifactDigest} mono breakAll />
            <ProvenanceField term="parserVersion" value={service.parserVersion} />
          </dl>
        </div>
      </details>
    </div>
  );
}

function ProvenanceField({
  breakAll = false,
  mono = false,
  term,
  value,
}: {
  breakAll?: boolean;
  mono?: boolean;
  term: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-[0.04em] text-muted-foreground uppercase">{term}</dt>
      <dd
        className={mono ? `mt-1 text-[11px] ${breakAll ? "break-all font-mono" : "truncate font-mono"}` : "mt-1 truncate text-[11px]"}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
