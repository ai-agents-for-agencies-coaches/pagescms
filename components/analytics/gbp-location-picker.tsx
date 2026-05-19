"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Location = {
  accountId: string;
  accountName: string;
  locationId: string;
  locationName: string;
  address: string | null;
};

type Props = {
  owner: string;
  repo: string;
  locations: Location[];
};

export function GbpLocationPicker({ owner, repo, locations }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const groups = useMemo(() => {
    const byAccount = new Map<string, { name: string; items: Location[] }>();
    for (const loc of locations) {
      const g = byAccount.get(loc.accountId) ?? { name: loc.accountName, items: [] };
      g.items.push(loc);
      byAccount.set(loc.accountId, g);
    }
    return [...byAccount.values()];
  }, [locations]);

  const handleConfirm = async () => {
    if (!selected) return;
    const loc = locations.find((l) => l.locationId === selected);
    if (!loc) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/${owner}/${repo}/analytics/gbp/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: loc.accountId, locationId: loc.locationId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.status !== "ok") {
        throw new Error(payload?.message || "Failed to save the selected location.");
      }
      router.replace(
        `/${owner}/${repo}/analytics/settings?gbp=success&location=${encodeURIComponent(
          loc.locationName
        )}`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save selection.");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.name} className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {group.name}
          </p>
          <Card>
            <CardContent className="p-0 divide-y">
              {group.items.map((loc) => {
                const isSelected = selected === loc.locationId;
                return (
                  <label
                    key={loc.locationId}
                    className={`flex cursor-pointer items-start gap-3 p-4 text-sm transition-colors ${
                      isSelected ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="gbp-location"
                      className="mt-0.5"
                      value={loc.locationId}
                      checked={isSelected}
                      onChange={() => setSelected(loc.locationId)}
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">{loc.locationName}</span>
                      {loc.address && (
                        <span className="text-xs text-muted-foreground">
                          {loc.address}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={!selected || submitting} onClick={handleConfirm}>
          {submitting && <Loader className="mr-2 h-4 w-4 animate-spin" />}
          Connect this location
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={submitting}
          onClick={() => router.replace(`/${owner}/${repo}/analytics/settings`)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
