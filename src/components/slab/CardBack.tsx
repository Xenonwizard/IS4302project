import Image from "next/image";

/** The provided Pokémon card-back artwork, framed within the slab casing. */
export function CardBack({ className }: { className?: string }) {
  return (
    <Image
      src="/images/pokemon-card-back-v3.png"
      alt="Pokémon card back"
      fill
      sizes="(min-width: 1024px) 420px, 70vw"
      className={className ?? "h-full w-full object-cover"}
      draggable={false}
    />
  );
}
