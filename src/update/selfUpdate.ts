import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fetchText } from '../util/http.ts';
import { VERSION, OWNER, REPO } from '../version.ts';

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function releaseBase(): string {
  return `https://github.com/${OWNER}/${REPO}/releases/latest/download`;
}

/** Parse a `shasum -a 256` line ("<hex>  <path>") or a bare hex digest. */
export function parseSha256File(text: string): string | undefined {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase();
  return first && /^[0-9a-f]{64}$/.test(first) ? first : undefined;
}

/** Fetch a release asset plus its .sha256 sidecar; verify before returning. */
async function fetchVerified(name: string): Promise<string> {
  const [text, shaText] = await Promise.all([
    fetchText(`${releaseBase()}/${name}`, { timeoutMs: 30000 }),
    fetchText(`${releaseBase()}/${name}.sha256`, { timeoutMs: 30000 }),
  ]);
  const expected = parseSha256File(shaText);
  const actual = sha256(Buffer.from(text, 'utf8'));
  if (!expected || expected !== actual) {
    throw new Error(`sha256 mismatch for ${name}: expected ${expected ?? '(unparseable)'}, got ${actual}; aborting, originals untouched`);
  }
  return text;
}

export interface UpgradeResult {
  upgraded: boolean;
  from: string;
  to: string;
  files: string[];
  note?: string;
}

/**
 * Replace the installed skill files with the latest GitHub Release.
 *
 * Updates `cli.js` and, when a `SKILL.md` sits next to it, that file too:
 * SKILL.md documents the CLI's commands and output fields, so a stale SKILL.md
 * against a fresh cli.js leaves the agent working from the wrong contract.
 *
 * Every asset is downloaded and hash-verified before anything is written, so a
 * failure partway through cannot leave a half-updated skill directory.
 */
export async function selfUpdate(opts: { targetPath?: string } = {}): Promise<UpgradeResult> {
  const target = opts.targetPath ?? process.argv[1];
  if (!target) throw new Error('cannot resolve target path for self-update');

  const dir = dirname(target);
  const skillMdPath = join(dir, 'SKILL.md');
  const hasSkillMd = existsSync(skillMdPath);

  // Fetch and verify everything first — no writes until all digests match.
  const [cliText, skillMdText] = await Promise.all([
    fetchVerified('cli.js'),
    hasSkillMd ? fetchVerified('SKILL.md') : Promise.resolve(undefined),
  ]);

  const staged: { tmp: string; dest: string }[] = [];
  try {
    const stage = (dest: string, text: string, mode: number) => {
      const tmp = join(dir, `.${basename(dest)}.tmp-${process.pid}`);
      writeFileSync(tmp, text, { mode });
      staged.push({ tmp, dest });
    };
    stage(target, cliText, 0o755);
    if (skillMdText !== undefined) stage(skillMdPath, skillMdText, 0o644);

    // renameSync is atomic on POSIX; safe even for the currently running script.
    for (const { tmp, dest } of staged) renameSync(tmp, dest);
  } catch (e) {
    for (const { tmp } of staged) { try { unlinkSync(tmp); } catch { /* already renamed or gone */ } }
    throw e;
  }

  const files = ['cli.js', ...(skillMdText !== undefined ? ['SKILL.md'] : [])];
  const note = hasSkillMd
    ? 'restart to use the new version'
    : 'restart to use the new version; no SKILL.md found next to cli.js, so only cli.js was updated';
  return { upgraded: true, from: VERSION, to: 'latest', files, note };
}
