// BigInt 精确有理数：内部以最简分数 num/den 保存，den 恒为正数。

export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    this.num = num;
    this.den = den;
  }

  static ZERO = new Fraction(0n, 1n);
  static ONE = new Fraction(1n, 1n);

  static from(n: bigint | number | string | Fraction): Fraction {
    if (n instanceof Fraction) return n;
    if (typeof n === "number") {
      if (!Number.isFinite(n)) throw new Error("数值必须有限");
      if (Number.isInteger(n)) return Fraction.from(BigInt(n));
      // 仅作为兜底，业务输入不允许十进制小数，避免浮点歧义。
      return Fraction.parse(String(n));
    }
    if (typeof n === "bigint") return new Fraction(n, 1n);
    return Fraction.parse(n);
  }

  static parse(input: string): Fraction {
    const s = input.trim();
    if (!/^[+-]?\d+(\/\d+)?$/.test(s)) {
      throw new Error(`无法解析为整数或分数: "${input}"（允许形式：3、-2、1/3、-4/5）`);
    }
    if (s.includes("/")) {
      const [a, b] = s.split("/");
      const den = BigInt(b);
      if (den === 0n) throw new Error("分数分母不能为零");
      return Fraction.make(BigInt(a), den);
    }
    return new Fraction(BigInt(s), 1n);
  }

  static make(num: bigint, den: bigint): Fraction {
    if (den === 0n) throw new Error("分数分母不能为零");
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    if (num === 0n) return Fraction.ZERO;
    const g = gcd(num < 0n ? -num : num, den);
    return new Fraction(num / g, den / g);
  }

  add(o: Fraction): Fraction {
    return Fraction.make(this.num * o.den + o.num * this.den, this.den * o.den);
  }
  sub(o: Fraction): Fraction {
    return Fraction.make(this.num * o.den - o.num * this.den, this.den * o.den);
  }
  mul(o: Fraction): Fraction {
    return Fraction.make(this.num * o.num, this.den * o.den);
  }
  div(o: Fraction): Fraction {
    if (o.num === 0n) throw new Error("除零错误");
    return Fraction.make(this.num * o.den, this.den * o.num);
  }
  neg(): Fraction {
    return new Fraction(-this.num, this.den);
  }
  isZero(): boolean {
    return this.num === 0n;
  }
  isNegative(): boolean {
    return this.num < 0n;
  }
  equals(o: Fraction): boolean {
    return this.num === o.num && this.den === o.den;
  }
  compareTo(o: Fraction): number {
    const d = this.num * o.den - o.num * this.den;
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  }

  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  // 高精度十进制近似，scale 为保留的小数位数（截断后按末位四舍五入）。
  toDecimal(scale = 12): string {
    const neg = this.num < 0n;
    const a = neg ? -this.num : this.num;
    const factor = 10n ** BigInt(scale);
    const scaled = a * factor;
    let q = scaled / this.den;
    const rem = scaled % this.den;
    if (rem * 2n >= this.den) q += 1n;
    const whole = q / factor;
    let frac = (q % factor).toString();
    frac = frac.padStart(scale, "0");
    const trimmed = frac.replace(/0+$/, "");
    const body = trimmed.length ? `${whole}.${trimmed}` : `${whole}`;
    return neg && q !== 0n ? `-${body}` : body;
  }

  toString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`;
  }
}

export function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function sumFractions(xs: Fraction[]): Fraction {
  return xs.reduce((acc, x) => acc.add(x), Fraction.ZERO);
}
