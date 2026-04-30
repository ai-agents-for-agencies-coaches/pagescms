"use client";

import { useEffect, useState } from "react";
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map,
  useMap,
} from "@vis.gl/react-google-maps";
import { cn } from "@/lib/utils";
import type { HeatMapCell } from "@/lib/analytics/local-rank";

const cellColor = (rank: number | null): { bg: string; text: string } => {
  if (rank == null) return { bg: "bg-slate-400", text: "text-white" };
  if (rank <= 3) return { bg: "bg-green-500", text: "text-white" };
  if (rank <= 10) return { bg: "bg-yellow-400", text: "text-slate-900" };
  if (rank <= 20) return { bg: "bg-orange-500", text: "text-white" };
  return { bg: "bg-red-500", text: "text-white" };
};

type Props = {
  cells: HeatMapCell[];
  /** Anchor location of the search (the business pin). */
  anchor?: { lat: number; lng: number; name?: string } | null;
};

const MAP_ID = "pagescms-heatmap";

function FitBounds({ cells, anchor }: Pick<Props, "cells" | "anchor">) {
  const map = useMap();
  useEffect(() => {
    if (!map || cells.length === 0 || typeof google === "undefined") return;
    const bounds = new google.maps.LatLngBounds();
    for (const c of cells) bounds.extend({ lat: c.lat, lng: c.lng });
    if (anchor) bounds.extend({ lat: anchor.lat, lng: anchor.lng });
    map.fitBounds(bounds, 60);
  }, [map, cells, anchor]);
  return null;
}

export function HeatmapMap({ cells, anchor }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [openCell, setOpenCell] = useState<HeatMapCell | null>(null);

  if (!apiKey) {
    return (
      <div className="h-72 rounded-md border bg-muted/30 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground p-4 text-center">
        <p className="font-medium">Maps JavaScript API key missing</p>
        <p className="text-xs">
          Set <code className="text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in Vercel project env.
        </p>
      </div>
    );
  }

  if (cells.length === 0) {
    return (
      <div className="h-72 rounded-md border bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">
        No grid cells to display.
      </div>
    );
  }

  const center = {
    lat: cells.reduce((s, c) => s + c.lat, 0) / cells.length,
    lng: cells.reduce((s, c) => s + c.lng, 0) / cells.length,
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md overflow-hidden border" style={{ height: "500px" }}>
        <APIProvider apiKey={apiKey}>
          <Map
            mapId={MAP_ID}
            defaultCenter={center}
            defaultZoom={12}
            gestureHandling="cooperative"
            disableDefaultUI={false}
            style={{ width: "100%", height: "100%" }}
          >
            <FitBounds cells={cells} anchor={anchor} />

            {anchor && (
              <AdvancedMarker position={{ lat: anchor.lat, lng: anchor.lng }} title={anchor.name}>
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 border-2 border-white shadow-md">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
              </AdvancedMarker>
            )}

            {cells.map((c) => {
              const { bg, text } = cellColor(c.rank);
              return (
                <AdvancedMarker
                  key={`${c.row}:${c.col}`}
                  position={{ lat: c.lat, lng: c.lng }}
                  onClick={() => setOpenCell(c)}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-full text-xs font-bold border-2 border-white shadow-md cursor-pointer hover:scale-110 transition-transform",
                      bg,
                      text,
                    )}
                  >
                    {c.rank ?? "21+"}
                  </div>
                </AdvancedMarker>
              );
            })}

            {openCell && (
              <InfoWindow
                position={{ lat: openCell.lat, lng: openCell.lng }}
                onCloseClick={() => setOpenCell(null)}
                pixelOffset={[0, -28]}
              >
                <div className="text-xs space-y-1 max-w-[260px]">
                  <div className="font-semibold">
                    {openCell.rank == null ? (
                      <span>Rank 21+ <span className="text-slate-500 font-normal">(not in top 20)</span></span>
                    ) : (
                      <span>Rank: {openCell.rank}</span>
                    )}
                  </div>
                  {openCell.top3.length > 0 && (
                    <>
                      <div className="text-slate-500">Top 3 at this location:</div>
                      <ol className="list-decimal pl-4 space-y-0.5">
                        {openCell.top3.map((c) => (
                          <li key={c.placeId} className="truncate">
                            {c.name}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-600" /> business
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500" /> rank 1–3
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-yellow-400" /> 4–10
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-orange-500" /> 11–20
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> 21+
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-slate-400" /> 21+
        </span>
      </div>
    </div>
  );
}
