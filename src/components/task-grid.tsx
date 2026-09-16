// src/components/task-grid.tsx
import { TIME_BLOCK_META } from "@/lib/constants";
import type { TimeBlock } from "@/lib/types";
import type { BlockTask } from "@/lib/activity";

const DIAS = ["L", "M", "X", "J", "V", "S", "D"];

export function TaskGrid({ block, tareas }: { block: TimeBlock; tareas: BlockTask[] }) {
  const meta = TIME_BLOCK_META[block];
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <meta.icon aria-hidden className="h-4 w-4 shrink-0" style={{ color: meta.accent }} />
        <h3 className="font-display text-sm font-bold uppercase tracking-wide" style={{ color: meta.accent }}>
          {meta.label}
        </h3>
      </div>

      {tareas.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">Sin tareas en esta etapa.</p>
      ) : (
        <div className="space-y-1">
          {/* Encabezado de días */}
          <div className="flex items-center gap-1 pl-[40%]">
            {DIAS.map((d) => (
              <span key={d} className="w-4 text-center font-mono text-[9px] text-muted">
                {d}
              </span>
            ))}
          </div>
          {tareas.map((t) => (
            <div key={t.id} className="flex items-center gap-1">
              <span className="w-[40%] truncate pr-1 text-[12px] text-fg">{t.nombre}</span>
              {t.semana.map((cell, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="grid h-4 w-4 place-items-center rounded-[3px] text-[10px]"
                  style={{
                    // Completado: círculo del color del bloque (resalta).
                    // Sin completar: cruz gris tenue (se corre al fondo, no entorpece).
                    color: cell === true ? meta.accent : "#4b5563",
                    border: cell === null ? "1px dashed #2a3038" : "none",
                  }}
                >
                  {cell === true ? "●" : cell === false ? "✕" : ""}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
