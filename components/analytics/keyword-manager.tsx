"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader, X } from "lucide-react";
import type { KeywordWithLatest } from "@/lib/analytics/queries";

type Props = { owner: string; repo: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function KeywordManager({ owner, repo }: Props) {
  const base = `/api/${owner}/${repo}/analytics/keywords`;
  const { data, mutate } = useSWR<{ keywords: KeywordWithLatest[] }>(base, fetcher);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const onAdd = async () => {
    const keyword = draft.trim();
    if (!keyword) return;
    setBusy(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.message || "Failed to add keyword");
      } else {
        toast.success(`Added "${keyword}"`);
        setDraft("");
        await mutate();
      }
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (id: number, enabled: boolean) => {
    await fetch(`${base}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await mutate();
  };

  const onDelete = async (id: number, keyword: string) => {
    if (!confirm(`Remove "${keyword}" and its heat-map history?`)) return;
    const res = await fetch(`${base}/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`Removed "${keyword}"`);
      await mutate();
    } else {
      toast.error("Failed to delete");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target keywords (Local Rank)</CardTitle>
        <CardDescription>
          Keywords tracked weekly via the local-rank-tracker heat-map cron. Disable a keyword to
          pause its weekly run without losing history. Defaults: 5×5 grid, 5km radius, square shape.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-2">
            {data.keywords.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No keywords yet.</p>
            ) : (
              data.keywords.map((k) => (
                <div key={k.id} className="flex items-center gap-3 rounded-md border p-2.5">
                  <Switch
                    checked={k.enabled}
                    onCheckedChange={(checked) => onToggle(k.id, checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{k.keyword}</div>
                    {k.latestRun?.summary && "averageRank" in k.latestRun.summary && (
                      <div className="text-xs text-muted-foreground">
                        Last run {k.latestRun.runDate} ·{" "}
                        avg rank{" "}
                        {k.latestRun.summary.averageRank != null
                          ? Number(k.latestRun.summary.averageRank).toFixed(1)
                          : "—"}
                      </div>
                    )}
                    {k.latestRun?.errorReason && (
                      <div className="text-xs text-red-600 truncate">Error: {k.latestRun.errorReason}</div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(k.id, k.keyword)}
                    aria-label={`Remove ${k.keyword}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="e.g. roof repair near me"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onAdd();
              }
            }}
            maxLength={200}
          />
          <Button type="button" onClick={onAdd} disabled={busy || !draft.trim()}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
