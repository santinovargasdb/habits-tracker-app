"use client";

import { useEffect } from "react";

/**
 * Registra el service worker (solo en producción) para habilitar la
 * instalación de la PWA.  En desarrollo lo evitamos para no cachear el bundle.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* no-op: la app funciona igual sin SW */
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
