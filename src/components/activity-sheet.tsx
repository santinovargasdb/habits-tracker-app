// src/components/activity-sheet.tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TIME_BLOCK_ORDER } from "@/lib/constants";
import type { ActivitySummary } from "@/lib/activity";
import { HeatGrid } from "@/components/heat-grid";
import { TaskGrid } from "@/components/task-grid";

export function ActivitySheet({
  summary,
  onClose,
}: {
  summary: ActivitySummary;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  // Guard de montaje en cliente para createPortal (patrón del proyecto).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;

  const g = summary.general;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center">
      <button
        aria-label="Cerrar"
        onClick={onClose}
        className="animate-fade-in absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div className="animate-rise relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-4 pb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold text-fg">Tu actividad</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-muted hover:text-fg" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {/* General */}
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          General · últimos 6 meses
        </p>
        <div className="mb-4 overflow-x-auto">
          <HeatGrid semanas={g.semanas} />
        </div>

        {/* Etapas */}
        {TIME_BLOCK_ORDER.map((block) => (
          <TaskGrid key={block} block={block} tareas={summary.etapas[block]?.tareas ?? []} />
        ))}

        {/* Info de racha */}
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm text-fg">
          <p>🔥 Racha actual: <b>{g.rachaActual}</b> días · mejor: <b>{g.mejorRacha}</b></p>
          <p className="text-muted">📊 {g.diasActivos} días activos (6 meses)</p>
          {summary.tareaEstrella && (
            <p className="text-gold">
              ⭐ Tarea estrella de la semana: «{summary.tareaEstrella.nombre}» ({summary.tareaEstrella.hechos} días)
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
