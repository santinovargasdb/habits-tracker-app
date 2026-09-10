"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Bottom sheet minimalista (estilo shadcn/vaul) sin dependencias extra.
 * Se renderiza vía portal en <body> para escapar de cualquier stacking
 * context (p. ej. el de la vista, que lo dejaría por debajo del bottom-nav).
 * Cierra con Escape o tocando el backdrop.
 */
export function Drawer({ open, onClose, children, className }: DrawerProps) {
  const [mounted, setMounted] = useState(false);
  // Guard de montaje en cliente para createPortal (patrón intencional).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      {/* Backdrop */}
      <button
        aria-label="Cerrar"
        onClick={onClose}
        className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "animate-sheet-in relative w-full max-w-md rounded-t-3xl border-t border-line bg-ink-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.7)]",
          className,
        )}
      >
        <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-line" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
