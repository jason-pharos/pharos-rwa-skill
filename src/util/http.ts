export const PHAROS_HEADERS = { origin: 'https://port.pharos.xyz', referer: 'https://port.pharos.xyz/' } as const;

export function headersFor(url: string): Record<string, string> {
  const baseHeaders = { accept: 'application/json' };
  try {
    const host = new URL(url).host;
    if (host === 'api.pharosnetwork.xyz') {
      return { ...baseHeaders, ...PHAROS_HEADERS };
    }
  } catch {
    // ignore invalid URL, return base headers
  }
  return baseHeaders;
}

export async function fetchText(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  if (!url.startsWith('https://')) throw new Error(`refusing non-https url: ${url}`);
  const timeoutMs = opts.timeoutMs ?? 12000;
  const attempt = async (): Promise<string> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: headersFor(url) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally { clearTimeout(t); }
  };
  try { return await attempt(); }
  catch { return await attempt(); } // single retry
}

export async function fetchJson<T>(url: string, opts: { timeoutMs?: number } = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}
