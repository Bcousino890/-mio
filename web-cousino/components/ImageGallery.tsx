"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

export default function ImageGallery({
  images,
  alt,
}: {
  images: string[];
  alt: string;
}) {
  const [active, setActive] = useState(0);

  const goTo = (delta: number) =>
    setActive((i) => (i + delta + images.length) % images.length);

  return (
    <div>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-navy/5">
        <Image
          src={images[active]}
          alt={alt}
          fill
          priority
          className="object-cover"
          sizes="(min-width: 1024px) 60vw, 100vw"
        />
        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Imagen anterior"
              onClick={() => goTo(-1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 text-navy transition-colors hover:bg-white"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Imagen siguiente"
              onClick={() => goTo(1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 text-navy transition-colors hover:bg-white"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-navy/70 px-3 py-1 text-xs font-medium text-white">
              {active + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
          {images.map((src, i) => (
            <button
              key={src + i}
              onClick={() => setActive(i)}
              className={`relative aspect-square overflow-hidden rounded-md border-2 transition-colors ${
                i === active ? "border-gold" : "border-transparent"
              }`}
            >
              <Image
                src={src}
                alt={`${alt} ${i + 1}`}
                fill
                className="object-cover"
                sizes="120px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
