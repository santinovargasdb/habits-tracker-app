"use client";

import type { ReactNode } from "react";
import { EUROPEAN_WHEEL, rouletteColor } from "@/lib/constants";

// -----------------------------------------------------------------------------
// Rueda visual de la ruleta europea (single-zero). Presentacional: recibe el
// ángulo `rotation` (grados) y lo anima vía `transform: rotate` + `transition`
// ease-out. La aguja está fija arriba (apunta hacia abajo); a rotation múltiplo
// de 360 la aguja queda sobre el 0 (índice 0 del orden físico).
// -----------------------------------------------------------------------------

const SIZE = 280;
const CENTER = SIZE / 2;
const R_OUTER = CENTER - 3;
const R_LABEL = R_OUTER - 15;
const R_HUB = 34;
export const WHEEL_SEG_ANGLE = 360 / EUROPEAN_WHEEL.length; // ≈ 9.7297°

const SECTOR_FILL: Record<string, string> = {
  RED: "#c62b38",
  BLACK: "#15151d",
  GREEN: "#1f7a52",
};

/** Punto en la circunferencia para un ángulo medido en sentido horario desde arriba. */
function pt(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + r * Math.sin(rad), y: CENTER - r * Math.cos(rad) };
}

interface Sector {
  n: number;
  mid: number;
  path: string;
  fill: string;
  lx: number;
  ly: number;
}

// Geometría estática: se calcula una sola vez (el orden de la rueda es fijo).
const SECTORS: Sector[] = EUROPEAN_WHEEL.map((n, i) => {
  const mid = i * WHEEL_SEG_ANGLE;
  const p0 = pt((i - 0.5) * WHEEL_SEG_ANGLE, R_OUTER);
  const p1 = pt((i + 0.5) * WHEEL_SEG_ANGLE, R_OUTER);
  const label = pt(mid, R_LABEL);
  return {
    n,
    mid,
    path: `M ${CENTER} ${CENTER} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R_OUTER} ${R_OUTER} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z`,
    fill: SECTOR_FILL[rouletteColor(n)],
    lx: label.x,
    ly: label.y,
  };
});

interface RouletteWheelProps {
  /** Ángulo acumulado de la rueda (grados). Sólo crece entre tiradas. */
  rotation: number;
  /** Duración de la animación de frenado (ms). */
  durationMs: number;
  /** Si está girando, aplica la transición ease-out; si no, salto instantáneo. */
  spinning: boolean;
  /** Contenido del hub central fijo (número ganador / estado). */
  center?: ReactNode;
}

export function RouletteWheel({
  rotation,
  durationMs,
  spinning,
  center,
}: RouletteWheelProps) {
  return (
    <div
      className="relative mx-auto select-none"
      style={{ width: SIZE, height: SIZE }}
    >
      {/* Aguja fija arriba, apuntando hacia abajo. */}
      <div
        className="absolute left-1/2 top-[-6px] z-30 -translate-x-1/2"
        aria-hidden
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "11px solid transparent",
            borderRight: "11px solid transparent",
            borderTop: "20px solid #f6c445",
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.55))",
          }}
        />
      </div>

      {/* Rueda giratoria. */}
      <div
        className="absolute inset-0"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? `transform ${durationMs}ms cubic-bezier(0.16, 0.84, 0.28, 1)`
            : "none",
          willChange: "transform",
        }}
      >
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label="Rueda de la ruleta europea"
        >
          <circle cx={CENTER} cy={CENTER} r={R_OUTER} fill="#0b0b0f" />
          {SECTORS.map((s) => (
            <path
              key={`s-${s.n}`}
              d={s.path}
              fill={s.fill}
              stroke="#0b0b0f"
              strokeWidth="0.5"
            />
          ))}
          {SECTORS.map((s) => (
            <text
              key={`t-${s.n}`}
              x={s.lx}
              y={s.ly}
              fill="#f4f4f6"
              fontSize="10"
              fontWeight="700"
              textAnchor="middle"
              dominantBaseline="central"
              transform={`rotate(${s.mid.toFixed(2)} ${s.lx.toFixed(2)} ${s.ly.toFixed(2)})`}
              style={{ fontFamily: "var(--ff-mono), monospace" }}
            >
              {s.n}
            </text>
          ))}
          {/* Aros exterior. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R_OUTER}
            fill="none"
            stroke="#3a3a48"
            strokeWidth="3"
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R_OUTER - 1.5}
            fill="none"
            stroke="#f6c445"
            strokeOpacity="0.25"
            strokeWidth="1"
          />
          {/* Hub interno que tapa los vértices de los sectores. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R_HUB}
            fill="#141420"
            stroke="#2a2a37"
            strokeWidth="2"
          />
        </svg>
      </div>

      {/* Hub central FIJO (no rota): muestra el número ganador / estado. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="grid h-[62px] w-[62px] place-items-center rounded-full border border-line bg-ink/90 text-center shadow-[inset_0_0_12px_rgba(0,0,0,0.6)]">
          {center}
        </div>
      </div>
    </div>
  );
}
