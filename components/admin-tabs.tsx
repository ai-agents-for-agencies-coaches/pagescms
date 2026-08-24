import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Route-based tabs rather than a client-side tab widget: every admin panel is an async
 * server component doing its own database queries, so each tab wants to be its own route
 * with its own data fetch, not a hidden panel rendered alongside the others.
 */
const TABS = [
  { href: "/admin", label: "Overview", key: "overview" },
  { href: "/admin/integrations", label: "Integrations", key: "integrations" },
] as const;

export type AdminTabKey = (typeof TABS)[number]["key"];

export function AdminTabs({ current }: { current: AdminTabKey }) {
  return (
    <nav className="border-b -mt-2" aria-label="Admin sections">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
                  active
                    ? "border-foreground text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
