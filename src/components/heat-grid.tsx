// src/components/heat-grid.tsx
import { cn } from "@/lib/utils";

// Rampa de intensidad 0..4 (estilo contribution graph de GitHub), por hex para
// no depender de la paleta de Tailwind.
const NIVEL_COLOR = ["#20262e", "#0e4429", "#006d32", "#26a641", "#39d353"];
// Etiquetas de día (lun→dom); como GitHub, sólo se rotulan algunas (L/X/V).
const DIA_LABEL = ["L", "", "X", "", "V", "", ""];

/**
 * Heatmap estilo GitHub: columnas = semanas, filas = días (lun→dom).
 * `semanas[col][row]` = nivel 0-4, o null para días futuros (celda transparente).
 */
export function HeatGrid({
  semanas,
  className,
}: {
  semanas: (number | null)[][];
  className?: string;
}) {
  return (
    <div className={cn("flex gap-[3px]", className)}>
      {/* Gutter de etiquetas de día */}
      <div className="mr-0.5 flex flex-col gap-[3px]">
        {DIA_LABEL.map((d, row) => (
          <span
            key={row}
            className="h-2.5 w-2 text-right font-mono text-[7px] leading-[10px] text-muted"
          >
            {d}
          </span>
        ))}
      </div>
      {/* Columnas = semanas */}
      {semanas.map((semana, col) => (
        <div key={col} className="flex flex-col gap-[3px]">
          {semana.map((nivel, row) => (
            <span
              key={row}
              aria-hidden
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{
                backgroundColor:
                  nivel == null ? "transparent" : NIVEL_COLOR[Math.max(0, Math.min(4, nivel))],
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
