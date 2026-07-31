import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
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
  /** True only when at least one file was actually replaced. */
  upgraded: boolean;
  from: string;
  /** The release's version when it publishes one, else "latest". */
  to: string;
  /** Files that were replaced — empty when everything was already current. */
  files: string[];
  note?: string;
}

/**
 * The release's own version marker, when it publishes one. Absent on older
 * releases, so a failure here is not fatal: it only decides whether `to`
 * can name a version instead of saying "latest".
 */
async function fetchReleaseVersion(): Promise<string | undefined> {
  try {
    const text = await fetchText(`${releaseBase()}/VERSION`, { timeoutMs: 30000 });
    const first = text.trim().split(/\s+/)[0];
    return first && first.length > 0 ? first : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Replace the installed skill files with the latest GitHub Release.
 *
 * Updates `cli.js` and, when a `SKILL.md` sits next to it, that file too:
 * SKILL.md documents the CLI's commands and output fields, so a stale SKILL.md
 * against a fresh cli.js leaves the agent working from the wrong contract.
 *
 * Every asset is downloaded and hash-verified before anything is written, so a
 * failure partway through cannot leave a half-updated skill directory. Files
 * whose contents already match the release are left alone, so `upgraded`
 * answers "did anything change?" rather than "did the command run?".
 */
export async function selfUpdate(opts: { targetPath?: string } = {}): Promise<UpgradeResult> {
  const target = opts.targetPath ?? process.argv[1];
  if (!target) throw new Error('cannot resolve target path for self-update');

  const dir = dirname(target);
  const skillMdPath = join(dir, 'SKILL.md');
  const hasSkillMd = existsSync(skillMdPath);

  // Fetch and verify everything first — no writes until all digests match.
  const [cliText, skillMdText, releaseVersion] = await Promise.all([
    fetchVerified('cli.js'),
    hasSkillMd ? fetchVerified('SKILL.md') : Promise.resolve(undefined),
    fetchReleaseVersion(),
  ]);

  /** Already byte-identical → nothing to do; don't churn the file's mtime. */
  const isCurrent = (path: string, text: string): boolean => {
    try { return readFileSync(path, 'utf8') === text; } catch { return false; }
  };

  const pending: { dest: string; text: string; mode: number; label: string }[] = [];
  if (!isCurrent(target, cliText)) pending.push({ dest: target, text: cliText, mode: 0o755, label: 'cli.js' });
  if (skillMdText !== undefined && !isCurrent(skillMdPath, skillMdText)) {
    pending.push({ dest: skillMdPath, text: skillMdText, mode: 0o644, label: 'SKILL.md' });
  }

  const to = releaseVersion ?? 'latest';

  if (pending.length === 0) {
    return {
      upgraded: false,
      from: VERSION,
      to,
      files: [],
      note: 'already up to date; nothing was replaced',
    };
  }

  const staged: { tmp: string; dest: string }[] = [];
  try {
    for (const { dest, text, mode } of pending) {
      const tmp = join(dir, `.${basename(dest)}.tmp-${process.pid}`);
      writeFileSync(tmp, text, { mode });
      staged.push({ tmp, dest });
    }
    // renameSync is atomic on POSIX; safe even for the currently running script.
    for (const { tmp, dest } of staged) renameSync(tmp, dest);
  } catch (e) {
    for (const { tmp } of staged) { try { unlinkSync(tmp); } catch { /* already renamed or gone */ } }
    throw e;
  }

  const note = hasSkillMd
    ? 'restart to use the new version'
    : 'restart to use the new version; no SKILL.md found next to cli.js, so only cli.js was updated';
  return { upgraded: true, from: VERSION, to, files: pending.map((p) => p.label), note };
}
