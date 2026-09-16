"use client";

import { useState } from "react";
import type { ChestTierConfig } from "@/lib/constants";

type ChestLike = Pick<ChestTierConfig, "icon" | "name" | "image">;

/**
 * Arte del cofre: renderiza el PNG local (chest.image) y cae al emoji (chest.icon)
 * si no hay imagen o si falla la carga. Mismo patrón que GameCard.
 * `className` se aplica al elemento que se renderice; pasá tanto las clases de
 * imagen (h/w, object-contain) como las del emoji (text-*), coexisten sin efecto cruzado.
 */
export function ChestArt({
  chest,
  className,
}: {
  chest: ChestLike;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);

  if (chest.image && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arte estático del catálogo; <img> intencional y liviano
      <img
        src={chest.image}
        alt={chest.name}
        onError={() => setErrored(true)}
        draggable={false}
        className={className}
      />
    );
  }

  return (
    <span aria-hidden className={className}>
      {chest.icon}
    </span>
  );
}
