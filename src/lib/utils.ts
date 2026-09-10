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

/**
 * Inicio de la semana (LUNES) que contiene a `iso`, en formato YYYY-MM-DD.
 * Los hábitos semanales anclan su log a esta fecha: así el estado se mantiene
 * de lunes a domingo y se reinicia solo al arrancar la semana siguiente.
 * Semana estilo ISO: el domingo pertenece a la semana que empezó el lunes previo.
 */
export function weekStartISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const dow = date.getDay(); // 0=Dom, 1=Lun, ... 6=Sáb
  const daysFromMonday = (dow + 6) % 7; // Lun→0, Dom→6
  date.setDate(date.getDate() - daysFromMonday);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
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
