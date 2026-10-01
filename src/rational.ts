// 精确有理数（BigInt 分子/分母，分母恒正，约分存储）

export interface Fraction {
  num: bigint;
  den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function frac(num: bigint | number, den: bigint | number = 1n): Fraction {
  let n = BigInt(num);
  let d = BigInt(den);
  if (d === 0n) throw new Error("分母为零");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return g === 0n ? { num: 0n, den: 1n } : { num: n / g, den: d / g };
}

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.num, a.den * b.den);
}

export function neg(a: Fraction): Fraction {
  return { num: -a.num, den: a.den };
}

export function cmp(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const l = a.num * b.den;
  const r = b.num * a.den;
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
}

export function isZero(a: Fraction): boolean {
  return a.num === 0n;
}

export function toNumber(a: Fraction): number {
  return Number(a.num) / Number(a.den);
}

// 固定保留位数的十进制近似（不改变精确值）
export function toDecimal(a: Fraction, digits = 10): string {
  const negSign = a.num < 0n;
  const n = negSign ? -a.num : a.num;
  const scale = 10n ** BigInt(digits);
  const whole = n / a.den;
  let rem = n % a.den;
  let digitsOut = "";
  for (let i = 0; i < digits; i++) {
    rem *= 10n;
    digitsOut += (rem / a.den).toString();
    rem %= a.den;
  }
  // 四舍五入
  rem *= 10n;
  if (rem / a.den >= 5n) {
    let arr = digitsOut.split("");
    let carry = 1;
    for (let i = arr.length - 1; i >= 0 && carry; i--) {
      const d = Number(arr[i]) + carry;
      arr[i] = String(d % 10);
      carry = d >= 10 ? 1 : 0;
    }
    digitsOut = arr.join("");
  }
  return `${negSign ? "-" : ""}${whole}.${digitsOut}`;
}

export function fromString(s: string): Fraction {
  const t = String(s).trim();
  if (!/^[+-]?\d+(\/\d+)?$/.test(t)) {
    throw new Error(`无法解析为整数或分数字符串: "${s}"`);
  }
  if (t.includes("/")) {
    const [a, b] = t.split("/");
    return frac(BigInt(a), BigInt(b));
  }
  return frac(BigInt(t), 1n);
}

export function toString(a: Fraction): string {
  return a.den === 1n ? a.num.toString() : `${a.num}/${a.den}`;
}

// 将有限 double 用连分数重构为给定分母上限内最近的分数
export function fromNumberExact(x: number, maxDenominator = 10n ** 12n): Fraction {
  if (!Number.isFinite(x)) throw new Error("非有限数值，无法重构为分数");
  if (x === 0) return frac(0n);
  const sign = x < 0 ? -1n : 1n;
  let v = Math.abs(x);
  let h0 = 0n,
    h1 = 1n,
    k0 = 1n,
    k1 = 0n;
  for (let iter = 0; iter < 200; iter++) {
    const a = BigInt(Math.floor(v));
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDenominator) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    const rem = v - Number(a);
    if (rem < 1e-15) break;
    v = 1 / rem;
  }
  return frac(sign * h1, k1);
}
