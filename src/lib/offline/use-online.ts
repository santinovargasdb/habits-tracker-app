"use client";

import { useEffect, useState } from "react";

/** true si el navegador está online; escucha los eventos 'online'/'offline'. */
export function useOnline(): boolean {
  // Iniciar SIEMPRE en `true` para que el primer render del cliente coincida con
  // el del servidor. En Node 21+/Next 16 `navigator` existe en SSR y
  // `navigator.onLine` es false → renderizaría el chip Offline sólo en el
  // servidor (hydration mismatch, React #418). El valor real se setea en el
  // effect, post-montaje.
  const [online, setOnline] = useState<boolean>(true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
