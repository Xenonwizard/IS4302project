/** Deterministic PRNG so the catalog is identical on server and client. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRandom(seed: number) {
  const rnd = mulberry32(seed);
  return {
    next: rnd,
    int(min: number, max: number) {
      return Math.floor(rnd() * (max - min + 1)) + min;
    },
    float(min: number, max: number) {
      return rnd() * (max - min) + min;
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(rnd() * items.length)];
    },
    chance(p: number) {
      return rnd() < p;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** Fake 32-byte hex id, deterministic. */
export function hexId(seed: number, bytes = 32): string {
  const rnd = mulberry32(seed);
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(rnd() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}
