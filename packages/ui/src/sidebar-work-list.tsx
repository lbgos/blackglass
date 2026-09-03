import { ChevronDown } from "lucide-react";
import { useId, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

import { cn } from "./cn.js";

interface SidebarRowState {
  background?: boolean;
  current?: boolean;
  selected?: boolean;
}

interface SidebarSurfaceState {
  background: boolean | undefined;
  current: boolean | undefined;
  selected: boolean | undefined;
}

interface SidebarRowProps extends SidebarRowState {
  action?: ReactNode;
  context: string;
  href: string;
  itemId: string;
  onNavigate?: () => void;
  status?: string;
  title: string;
}

export interface SidebarCardRowProps extends SidebarRowProps {
  metadata: string;
}

export interface SidebarCompactRowProps extends SidebarRowProps {
  leading?: ReactNode;
  metadata?: string;
}

export interface SidebarRowActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

const cardVisibilityStyle: CSSProperties = {
  containIntrinsicSize: "78px",
  contentVisibility: "auto",
};

const compactVisibilityStyle: CSSProperties = {
  containIntrinsicSize: "44px",
  contentVisibility: "auto",
};

function surfaceClasses({ background, current, selected }: SidebarSurfaceState): string {
  return cn(
    "sidebar-work-row group flex rounded-[10px] border-0 bg-transparent transition-colors",
    current && "bg-sidebar-active text-sidebar-foreground",
    !current && selected && "bg-sidebar-selected text-sidebar-foreground",
    !current &&
      !selected &&
      "hover:bg-sidebar-hover focus-within:bg-sidebar-hover",
    background && !current && !selected && "text-sidebar-muted-foreground",
  );
}

export function SidebarRowAction({ className, label, type = "button", ...props }: SidebarRowActionProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-xs font-semibold text-sidebar-muted-foreground outline-none hover:bg-sidebar-control hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 md:min-w-8",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarCardRow({
  action,
  background,
  context,
  current,
  href,
  itemId,
  metadata,
  onNavigate,
  selected,
  status,
  title,
}: SidebarCardRowProps) {
  return (
    <article
      className={surfaceClasses({ background, current, selected })}
      data-background={background || undefined}
      data-current={current || undefined}
      data-item-id={itemId}
      data-selected={selected || undefined}
      style={cardVisibilityStyle}
    >
      <a
        href={href}
        aria-current={current ? "page" : undefined}
        className="flex min-h-[78px] min-w-0 flex-1 flex-col justify-center rounded-[10px] px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onNavigate}
      >
        <span className="flex items-center gap-2 text-[11px] font-medium text-sidebar-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{context}</span>
          {status ? (
  <span className="shrink-0 normal-case" aria-label={`Status: ${status}`}>
              {status}
            </span>
) : null}
        </span>
        <span
          className={cn(
            "mt-1 truncate text-[13px] font-semibold text-sidebar-foreground",
            background &&
              !current &&
              !selected &&
              "text-sidebar-muted-foreground group-hover:text-sidebar-foreground group-focus-within:text-sidebar-foreground",
          )}
        >
          {title}
        </span>
        <span className="mt-1 truncate font-mono text-[11px] text-sidebar-muted-foreground">
          {metadata}
        </span>
      </a>
      {action && <div className="sidebar-row-actions flex shrink-0 items-center pr-1">{action}</div>}
    </article>
  );
}

export function SidebarCompactRow({
  action,
  background,
  context,
  current,
  href,
  itemId,
  leading,
  metadata,
  onNavigate,
  selected,
  status,
  title,
}: SidebarCompactRowProps) {
  return (
    <article
      className={surfaceClasses({ background, current, selected })}
      data-background={background || undefined}
      data-current={current || undefined}
      data-item-id={itemId}
      data-selected={selected || undefined}
      style={compactVisibilityStyle}
    >
      <a
        href={href}
        aria-current={current ? "page" : undefined}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-9"
        onClick={onNavigate}
      >
        {leading && <span className="shrink-0 text-sidebar-muted-foreground">{leading}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] font-semibold text-sidebar-foreground",
                background &&
                  !current &&
                  !selected &&
                  "text-sidebar-muted-foreground group-hover:text-sidebar-foreground group-focus-within:text-sidebar-foreground",
              )}
            >
              {title}
            </span>
            {status ? (
  <span
                className="shrink-0 text-[11px] text-sidebar-muted-foreground"
                aria-label={`Status: ${status}`}
              >
                {status}
              </span>
) : null}
          </span>
          <span className="flex min-w-0 gap-2 text-[11px] text-sidebar-muted-foreground">
            <span className="truncate">{context}</span>
            {metadata && <span className="shrink-0 font-mono">{metadata}</span>}
          </span>
        </span>
      </a>
      {action && <div className="sidebar-row-actions flex shrink-0 items-center pr-1">{action}</div>}
    </article>
  );
}

export interface SidebarShelfProps<Item> {
  currentId?: string;
  defaultOpen?: boolean;
  getId: (item: Item) => string;
  initialCount?: number;
  items: readonly Item[];
  pageSize?: number;
  paginated?: boolean;
  renderItem: (item: Item) => ReactNode;
  title: string;
}

export function SidebarShelf<Item>({
  currentId,
  defaultOpen = true,
  getId,
  initialCount = 10,
  items,
  pageSize = 25,
  paginated = false,
  renderItem,
  title,
}: SidebarShelfProps<Item>) {
  const [open, setOpen] = useState(defaultOpen);
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const contentId = useId();
  const currentItem = currentId ? items.find((item) => getId(item) === currentId) : undefined;
  const normallyVisible = open
    ? paginated
      ? items.slice(0, visibleCount)
      : items
    : [];
  const visibleItems =
    currentItem && open && !normallyVisible.some((item) => getId(item) === currentId)
      ? [...normallyVisible, currentItem]
      : normallyVisible;
  const hasMore = paginated && open && visibleCount < items.length;
  const nextBatch = Math.min(pageSize, items.length - visibleCount);

  return (
    <section>
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium tracking-wide text-sidebar-muted-foreground outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-8"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown
          className={cn("size-4 transition-transform", !open && "-rotate-90")}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="font-mono text-[11px]" aria-label={`${items.length} items`}>
          {items.length}
        </span>
      </button>
      <div id={contentId}>
        {open && visibleItems.length > 0 && (
          <ul className="m-0 list-none space-y-1 p-0">
            {visibleItems.map((item) => (
              <li key={getId(item)} data-collection-item={getId(item)}>
                {renderItem(item)}
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <button
            type="button"
            className="mt-1 flex min-h-11 w-full items-center justify-center rounded-md px-3 text-xs font-semibold text-sidebar-muted-foreground outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-8"
            onClick={() => setVisibleCount((current) => Math.min(current + pageSize, items.length))}
          >
            Show more ({nextBatch})
          </button>
        )}
      </div>
      {!open && currentItem && (
        <ul className="m-0 list-none p-0">
          <li data-collection-item={getId(currentItem)}>{renderItem(currentItem)}</li>
        </ul>
      )}
    </section>
  );
}
