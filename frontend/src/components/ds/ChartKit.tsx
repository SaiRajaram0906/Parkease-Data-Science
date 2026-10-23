/**
 * Shared building blocks for the Data Science features, built from the
 * existing ParkEase UI components so the features look native to the app.
 */
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, Inbox, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DemandLevel, DsError } from "@/lib/ds-api";

// Colours by role (defined in index.css, with dark-mode values).
export const SERIES = ["var(--ds-series-1)", "var(--ds-series-2)", "var(--ds-series-3)"] as const;
export const DEMAND_COLOR: Record<DemandLevel, string> = {
  Low: "var(--ds-demand-low)",
  Medium: "var(--ds-demand-medium)",
  High: "var(--ds-demand-high)",
};

// Recharts styling shared by every chart.
export const axisTick = { fill: "hsl(var(--muted-foreground))", fontSize: 12 };
export const gridStroke = "hsl(var(--border))";
export const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--foreground))",
};
export const tooltipCursor = { fill: "hsl(var(--muted))", fillOpacity: 0.5 };

export function SyntheticNote({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground cursor-help",
            className,
          )}
        >
          <FlaskConical className="h-3 w-3" />
          {children ?? "Synthetic training data"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        The models and statistics are built from a synthetic historical dataset. They show how the
        system works and are not real-world parking statistics.
      </TooltipContent>
    </Tooltip>
  );
}

export function PredictionTag({ children = "Prediction" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--ds-band)] px-2 py-0.5 text-[11px] font-semibold text-foreground">
      {children}
    </span>
  );
}

export function ActualTag({ children = "Actual" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
      {children}
    </span>
  );
}

export function DemandBadge({ level, className }: { level: DemandLevel; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", className)}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEMAND_COLOR[level] }} />
      {level}
    </span>
  );
}

export function StatTile({
  label, value, hint, icon: Icon,
}: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon }) {
  return (
    <Card className="border-none shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-primary shrink-0" />}
        </div>
        <p className="mt-1.5 text-xl sm:text-2xl font-bold tracking-tight break-words">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function ChartCard({
  title, description, children, footer, className, action,
}: {
  title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode;
  className?: string; action?: ReactNode;
}) {
  return (
    <Card className={cn("border-none shadow-md min-w-0", className)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <CardTitle className="text-base sm:text-lg leading-snug">{title}</CardTitle>
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        {children}
        {footer && <p className="mt-3 text-xs text-muted-foreground">{footer}</p>}
      </CardContent>
    </Card>
  );
}

/** Fixed-height box that keeps a Recharts chart inside its card on any screen. */
export function ChartBox({ height = 260, children }: { height?: number; children: ReactNode }) {
  return <div className="w-full min-w-0" style={{ height }}>{children}</div>;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={item.dashed ? { border: `1.5px dashed ${item.color}` } : { backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, icon: Icon = Inbox }: { title: string; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-10 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-50" />
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Shown instead of numbers whenever a prediction or statistic cannot be produced. */
export function Unavailable({ error, compact }: { error: DsError | Error | null; compact?: boolean }) {
  const status = (error as DsError | null)?.status;
  const hint = (error as DsError | null)?.hint;
  const serviceDown = status === 503 || status === 502 || status === 0;
  return (
    <div className={cn("rounded-xl border border-dashed bg-muted/20 text-sm", compact ? "p-4" : "p-6")}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="font-semibold">
            {serviceDown ? "Data Science insights are unavailable right now" : "This could not be loaded"}
          </p>
          <p className="mt-0.5 text-muted-foreground break-words">{error?.message ?? "Unknown error"}</p>
          {hint && <p className="mt-2 rounded bg-muted px-2 py-1 font-mono text-xs break-all">{hint}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            No estimate is shown in its place. The rest of ParkEase keeps working.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Loading, error and success states for one Data Science query. */
export function QueryState<T>({
  query, children, skeletonHeight = 200, compact,
}: {
  query: UseQueryResult<T, DsError>;
  children: (data: T) => ReactNode;
  skeletonHeight?: number;
  compact?: boolean;
}) {
  if (query.isLoading) return <Skeleton className="w-full rounded-xl" style={{ height: skeletonHeight }} />;
  if (query.isError) return <Unavailable error={query.error} compact={compact} />;
  if (!query.data) return null;
  return <>{children(query.data)}</>;
}

/** Horizontal bar rows for short ranked lists (feature importance, shares). */
export function BarList({
  rows, unit = "%", color = SERIES[0], max,
}: { rows: { label: string; value: number; note?: string }[]; unit?: string; color?: string; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {row.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}{unit}
              {row.note && <span className="ml-1.5 font-normal text-muted-foreground">{row.note}</span>}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${Math.max((row.value / top) * 100, 0.5)}%`, backgroundColor: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
