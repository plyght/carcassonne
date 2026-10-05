/** Small seeded PRNG (sfc32) for the dev engine. Not the engine's real PRNG. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: bigint) {
    const lo = Number(seed & 0xffff_ffffn) >>> 0;
    const hi = Number((seed >> 32n) & 0xffff_ffffn) >>> 0;
    this.a = lo;
    this.b = hi;
    this.c = 0x9e3779b9;
    this.d = 1;
    for (let i = 0; i < 15; i++) this.next();
  }

  /** Uniform u32. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0,1). */
  float(): number {
    return this.next() / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  state(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  static restore(s: [number, number, number, number]): Rng {
    const r = new Rng(0n);
    [r.a, r.b, r.c, r.d] = s;
    return r;
  }
}
