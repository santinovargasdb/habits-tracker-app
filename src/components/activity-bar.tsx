// src/components/activity-bar.tsx
"use client";

import { useEffect, useState } from "react";
import type { Habit } from "@/lib/types";
import { fetchActivity } from "@/actions/activity";
import { heatmapDesdeISO, summarizeActivity, type ActivitySummary } from "@/lib/activity";
import { HeatGrid } from "@/components/heat-grid";
import { ActivitySheet } from "@/components/activity-sheet";

export default function ActivityBar({ habits, today }: { habits: Habit[]; today: string }) {
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [open, setOpen] = useState(false);

  // Deriva una clave estable de la identidad de habits (id) para evitar refetch por cambio de referencia.
  const habitsKey = habits.map((h) => h.id).join(",");

  useEffect(() => {
    let alive = true;
    (async () => {
      // El resumen refleja logs del SERVIDOR (sincronizados); un hábito recién marcado aparece tras sync, no optimísticamente.
      const rows = await fetchActivity(heatmapDesdeISO(today));
      if (alive) setSummary(summarizeActivity(rows, habits, today));
    })();
    return () => {
      alive = false;
    };
    // habitsKey es proxy estable de la identidad de habits: evita refetch por cambio de referencia en cada mark/sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, habitsKey]);

  const racha = summary?.general.rachaActual ?? 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!summary}
        className="mb-4 block w-full rounded-2xl border border-line bg-surface/70 px-4 py-3 text-left disabled:opacity-60"
        aria-label="Ver detalle de actividad"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-display text-lg font-extrabold text-fg whitespace-nowrap">
            🔥 {racha} {racha === 1 ? "día" : "días"}
          </span>
          <span className="font-mono text-[11px] text-muted whitespace-nowrap">
            {summary ? `mejor ${summary.general.mejorRacha} ›` : "Cargando… ›"}
          </span>
        </div>
        {summary ? (
          <div className="overflow-x-auto">
            <HeatGrid semanas={summary.general.semanas} />
          </div>
        ) : (
          <span className="font-mono text-[11px] text-muted">Cargando…</span>
        )}
      </button>

      {open && summary && <ActivitySheet summary={summary} onClose={() => setOpen(false)} />}
    </>
  );
}
