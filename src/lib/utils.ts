import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases de Tailwind resolviendo conflictos (patrón shadcn/ui). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Fecha local en formato YYYY-MM-DD (sin corrimiento por UTC). */
export function todayISO(d: Date = new Date()): string {
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/** "martes 9 de septiembre" a partir de un YYYY-MM-DD. */
export function formatLongDate(iso: string): string {
  const [y, m, day] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, day ?? 1);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}
