// src/components/day-strip.tsx
import { cn } from "@/lib/utils";

// Rampa de intensidad 0..4 (estilo "contribution graph"), por hex para no
// depender de la paleta de Tailwind.
const NIVEL_COLOR = ["#20262e", "#0e4429", "#006d32", "#26a641", "#39d353"];

export function DayStrip({ niveles, className }: { niveles: number[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-[3px]", className)}>
      {niveles.map((n, i) => (
        <span
          key={i}
          aria-hidden
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ backgroundColor: NIVEL_COLOR[Math.max(0, Math.min(4, n))] }}
        />
      ))}
    </div>
  );
}
