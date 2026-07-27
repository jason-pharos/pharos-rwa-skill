export function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, '0');
  const i = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + (f ? `${i}.${f}` : i);
}

export function toNumber(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}
