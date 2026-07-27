import { createHash } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchText } from '../util/http.ts';
import { VERSION, OWNER, REPO } from '../version.ts';

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function releaseBase(): string {
  return `https://github.com/${OWNER}/${REPO}/releases/latest/download`;
}

export async function selfUpdate(opts: { targetPath?: string } = {}): Promise<{ upgraded: boolean; from: string; to: string; note?: string }> {
  const target = opts.targetPath ?? process.argv[1];
  if (!target) throw new Error('cannot resolve target path for self-update');

  const [cliText, shaText] = await Promise.all([
    fetchText(`${releaseBase()}/cli.js`, { timeoutMs: 30000 }),
    fetchText(`${releaseBase()}/cli.js.sha256`, { timeoutMs: 30000 }),
  ]);

  const expected = shaText.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = sha256(Buffer.from(cliText, 'utf8'));
  if (!expected || expected !== actual) {
    throw new Error(`sha256 mismatch: expected ${expected}, got ${actual}; aborting, original untouched`);
  }

  const tmp = join(dirname(target), `.cli.js.tmp-${process.pid}`);
  writeFileSync(tmp, cliText, { mode: 0o755 });
  renameSync(tmp, target); // atomic on POSIX; safe to replace a running script
  return { upgraded: true, from: VERSION, to: 'latest', note: 'restart to use the new version' };
}
