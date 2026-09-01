import type { NmapProjectedService } from "@blackglass/contracts";
import {
  LoadingRegion,
  RecoverableError,
  Skeleton,
  StaleDataState,
} from "@blackglass/ui";

import { formatEngagementTimestamp } from "./format.js";
import { useEngagementServicesQuery } from "./query.js";

function deriveServiceStats(services: readonly NmapProjectedService[]) {
  const serviceCount = services.length;

  const hostCount = new Set(services.map((service) => service.address)).size;

  const artifactCount = new Set(services.map((service) => service.artifactId)).size;

  let latestObservedAt: string | undefined;

  for (const service of services) {
    if (latestObservedAt === undefined || service.observedAt > latestObservedAt) {
      latestObservedAt = service.observedAt;
    }
  }

  return {
    serviceCount,
    hostCount,
    artifactCount,
    latestObservedAt,
  };
}

function formatServiceIdentity(service: NmapProjectedService): string {
  const parts: string[] = [];

  if (service.serviceName !== null) {
    parts.push(service.serviceName);
  } else {
    parts.push("unknown");
  }

  if (service.product !== null) {
    parts.push(service.product);
  }

  if (service.version !== null) {
    parts.push(service.version);
  }

  return parts.join(" · ");
}

function formatPortProtocol(service: NmapProjectedService): string {
  return `${service.port}/${service.protocol}`;
}

function sortServices(
  services: readonly NmapProjectedService[],
): NmapProjectedService[] {
  return [...services].sort((left, right) => {
    const address = left.address.localeCompare(right.address);
    if (address !== 0) return address;
    return left.port - right.port;
  });
}

export function EngagementServicesSection({
  engagementId,
}: {
  engagementId: string;
}) {
  const servicesQuery = useEngagementServicesQuery(engagementId);
  const hasData = servicesQuery.data !== undefined;
  const retry = () => void servicesQuery.refetch();

  if (!hasData && servicesQuery.isFetching) {
    return <ServicesLoadingState />;
  }

  if (!hasData && servicesQuery.isError) {
    return (
      <RecoverableError
        title="Attack surface unavailable"
        description="The attack surface could not be loaded from the local control plane."
        onRetry={retry}
      />
    );
  }

  if (!hasData) {
    return <ServicesLoadingState />;
  }

  const services = servicesQuery.data;
  const stats = deriveServiceStats(services);
  const sorted = sortServices(services);

  const body =
    sorted.length === 0 ? (
      <ServicesEmptyState />
    ) : (
      <ServicesContent latestObservedAt={stats.latestObservedAt} services={sorted} stats={stats} />
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

function ServicesEmptyState() {
  return (
    <section aria-label="Attack surface" className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="flex min-h-10 items-center justify-between border-b border-border px-3">
        <h2 className="m-0 text-[13px] font-semibold">Attack surface</h2>
      </div>
      <div className="px-4 py-8 text-center">
        <h3 className="m-0 text-[13px] font-semibold text-foreground">No services yet</h3>
        <p className="mx-auto mt-2 mb-0 max-w-md text-[13px] leading-5 text-muted-foreground">
          No services have been observed for this engagement. Complete an Nmap run to populate the attack
          surface.
        </p>
      </div>
    </section>
  );
}

function ServicesContent({
  latestObservedAt,
  services,
  stats,
}: {
  latestObservedAt: string | undefined;
  services: readonly NmapProjectedService[];
  stats: ReturnType<typeof deriveServiceStats>;
}) {
  const latestLabel =
    latestObservedAt !== undefined ? formatEngagementTimestamp(latestObservedAt) : "—";

  return (
    <section aria-label="Attack surface" className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="flex min-h-10 items-center justify-between border-b border-border px-3">
        <h2 className="m-0 text-[13px] font-semibold">Attack surface</h2>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">Projected Nmap services</span>
      </div>

      <div
        aria-label="Engagement totals"
        className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border bg-card sm:grid-cols-4 sm:divide-y-0"
      >
        <div className="px-3 py-3 sm:px-4">
          <div className="text-[22px] font-semibold tracking-[-0.04em] text-foreground">{stats.serviceCount}</div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Services</div>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="text-[22px] font-semibold tracking-[-0.04em] text-foreground">{stats.hostCount}</div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Hosts</div>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="text-[22px] font-semibold tracking-[-0.04em] text-foreground">{stats.artifactCount}</div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Evidence artifacts</div>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="truncate text-[12px] font-medium tracking-[-0.02em] text-foreground" title={latestLabel}>
            {latestLabel}
          </div>
          <div className="mt-1 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Latest observation</div>
        </div>
      </div>

      <div className="divide-y divide-border">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_96px_minmax(0,1.2fr)_130px] gap-3 bg-muted/40 px-3 py-2 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase md:grid">
          <span>Address</span>
          <span>Port</span>
          <span>Service</span>
          <span>Observed</span>
        </div>
        {services.map((service) => (
          <ServiceRow key={`${service.address}:${service.port}:${service.artifactId}`} service={service} />
        ))}
      </div>
    </section>
  );
}

function ServiceRow({ service }: { service: NmapProjectedService }) {
  const observedLabel = formatEngagementTimestamp(service.observedAt);
  const serviceLabel = formatServiceIdentity(service);
  const portLabel = formatPortProtocol(service);

  return (
    <div className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,1.4fr)_96px_minmax(0,1.2fr)_130px] md:items-start md:gap-3">
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] font-semibold tracking-[-0.02em] text-foreground" title={service.address}>
          {service.address}
        </div>
        <div
          className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
          title={service.hostname ?? undefined}
        >
          {service.hostname ?? "—"}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-2 md:block">
        <span className="font-mono text-[13px] font-medium text-foreground md:block">{portLabel}</span>
        <span className="text-[11px] text-muted-foreground md:hidden">· {serviceLabel}</span>
      </div>

      <div className="min-w-0">
        <div className="truncate text-[13px] text-foreground" title={serviceLabel}>
          {serviceLabel}
        </div>
        <div className="mt-0.5 hidden text-[11px] text-muted-foreground md:block">
          {service.product !== null || service.version !== null ? (
            <span className="truncate">{serviceLabel}</span>
          ) : (
            <span className="text-muted-foreground">No product/version</span>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <div className="font-mono text-[11px] text-muted-foreground" title={observedLabel}>
          {observedLabel}
        </div>
        <details className="group mt-2 rounded-md border border-border bg-muted/40">
          <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between px-2.5 text-[11px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span>Provenance</span>
            <span className="text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="border-t border-border px-2.5 py-2">
            <dl className="grid gap-2">
              <ProvenanceRow term="runId" value={service.runId} mono breakAll={false} />
              <ProvenanceRow term="artifactId" value={service.artifactId} mono breakAll={false} />
              <ProvenanceRow term="artifactDigest" value={service.artifactDigest} mono breakAll />
              <ProvenanceRow term="parserVersion" value={service.parserVersion} mono={false} breakAll={false} />
            </dl>
          </div>
        </details>
      </div>
    </div>
  );
}

function ProvenanceRow({
  breakAll,
  mono,
  term,
  value,
}: {
  breakAll: boolean;
  mono: boolean;
  term: string;
  value: string;
}) {
  return (
    <div className="grid gap-1">
      <dt className="m-0 text-[11px] tracking-[0.04em] text-muted-foreground uppercase">{term}</dt>
      <dd
        className={
          mono
            ? `m-0 text-[11px] text-foreground ${breakAll ? "break-all font-mono" : "truncate font-mono"}`
            : "m-0 truncate text-[11px] text-foreground"
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
