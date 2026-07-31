import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256, parseSha256File, selfUpdate } from '../src/update/selfUpdate.ts';

test('sha256 of "abc" is known digest', () => {
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('parseSha256File accepts shasum output and bare digests', () => {
  const digest = 'a'.repeat(64);
  assert.equal(parseSha256File(`${digest}  dist/cli.js\n`), digest);
  assert.equal(parseSha256File(`${digest}\n`), digest);
  assert.equal(parseSha256File(`${digest.toUpperCase()}\n`), digest);
});

test('parseSha256File rejects non-digests', () => {
  assert.equal(parseSha256File('Not Found'), undefined);
  assert.equal(parseSha256File(''), undefined);
  assert.equal(parseSha256File('zz' + 'a'.repeat(62)), undefined);
});

/** Stub global fetch with a url -> body map; returns a restore fn. */
function stubFetch(bodies) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = bodies[String(url)];
    if (body === undefined) return { ok: false, status: 404, text: async () => 'Not Found' };
    return { ok: true, status: 200, text: async () => body };
  };
  return () => { globalThis.fetch = original; };
}

const BASE = 'https://github.com/jason-pharos/pharos-rwa-skill/releases/latest/download';
const digestOf = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

function releaseBodies(cli, skillMd) {
  const bodies = { [`${BASE}/cli.js`]: cli, [`${BASE}/cli.js.sha256`]: `${digestOf(cli)}  dist/cli.js\n` };
  if (skillMd !== undefined) {
    bodies[`${BASE}/SKILL.md`] = skillMd;
    bodies[`${BASE}/SKILL.md.sha256`] = `${digestOf(skillMd)}  SKILL.md\n`;
  }
  return bodies;
}

test('selfUpdate updates SKILL.md alongside cli.js when it sits next to the CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  const skillPath = join(dir, 'SKILL.md');
  writeFileSync(cliPath, 'old cli');
  writeFileSync(skillPath, 'old skill');

  const restore = stubFetch(releaseBodies('new cli', 'new skill'));
  try {
    const r = await selfUpdate({ targetPath: cliPath });
    assert.equal(r.upgraded, true);
    assert.deepEqual(r.files, ['cli.js', 'SKILL.md']);
    assert.equal(readFileSync(cliPath, 'utf8'), 'new cli');
    assert.equal(readFileSync(skillPath, 'utf8'), 'new skill');
  } finally { restore(); }
});

test('selfUpdate skips SKILL.md when none is installed next to the CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  writeFileSync(cliPath, 'old cli');

  const restore = stubFetch(releaseBodies('new cli', 'new skill'));
  try {
    const r = await selfUpdate({ targetPath: cliPath });
    assert.deepEqual(r.files, ['cli.js']);
    assert.equal(readFileSync(cliPath, 'utf8'), 'new cli');
    assert.equal(existsSync(join(dir, 'SKILL.md')), false, 'must not create a SKILL.md that was never installed');
  } finally { restore(); }
});

test('a bad SKILL.md digest aborts the whole upgrade, leaving cli.js untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  const skillPath = join(dir, 'SKILL.md');
  writeFileSync(cliPath, 'old cli');
  writeFileSync(skillPath, 'old skill');

  const bodies = releaseBodies('new cli', 'new skill');
  bodies[`${BASE}/SKILL.md.sha256`] = `${'b'.repeat(64)}  SKILL.md\n`; // tampered
  const restore = stubFetch(bodies);
  try {
    await assert.rejects(() => selfUpdate({ targetPath: cliPath }), /sha256 mismatch for SKILL\.md/);
    assert.equal(readFileSync(cliPath, 'utf8'), 'old cli', 'cli.js must not be replaced when SKILL.md fails');
    assert.equal(readFileSync(skillPath, 'utf8'), 'old skill');
    assert.deepEqual(readdirSync(dir).sort(), ['SKILL.md', 'cli.js'], 'no temp files left behind');
  } finally { restore(); }
});

test('a missing SKILL.md.sha256 asset aborts rather than skipping verification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  writeFileSync(cliPath, 'old cli');
  writeFileSync(join(dir, 'SKILL.md'), 'old skill');

  const bodies = releaseBodies('new cli', 'new skill');
  delete bodies[`${BASE}/SKILL.md.sha256`];
  const restore = stubFetch(bodies);
  try {
    await assert.rejects(() => selfUpdate({ targetPath: cliPath }));
    assert.equal(readFileSync(cliPath, 'utf8'), 'old cli');
  } finally { restore(); }
});

/**
 * `upgraded` used to be hard-coded true, so running `upgrade` on an
 * already-current install still reported success — which is how an agent came
 * to tell the user "0.1.0 → latest 更新完成" when nothing had changed. It has to
 * reflect whether anything was actually replaced.
 */
test('an already-current install reports upgraded false and writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  const skillPath = join(dir, 'SKILL.md');
  writeFileSync(cliPath, 'same cli');
  writeFileSync(skillPath, 'same skill');
  const mtimeBefore = statSync(cliPath).mtimeMs;

  const restore = stubFetch(releaseBodies('same cli', 'same skill'));
  try {
    const r = await selfUpdate({ targetPath: cliPath });
    assert.equal(r.upgraded, false, 'nothing changed, so nothing was upgraded');
    assert.deepEqual(r.files, [], 'no files were replaced');
    assert.equal(statSync(cliPath).mtimeMs, mtimeBefore, 'an unchanged file must not be rewritten');
    assert.deepEqual(readdirSync(dir).sort(), ['SKILL.md', 'cli.js'], 'no temp files left behind');
  } finally { restore(); }
});

test('only the file that actually differs is replaced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  const skillPath = join(dir, 'SKILL.md');
  writeFileSync(cliPath, 'old cli');
  writeFileSync(skillPath, 'same skill');

  const restore = stubFetch(releaseBodies('new cli', 'same skill'));
  try {
    const r = await selfUpdate({ targetPath: cliPath });
    assert.equal(r.upgraded, true);
    assert.deepEqual(r.files, ['cli.js'], 'SKILL.md was already current');
    assert.equal(readFileSync(cliPath, 'utf8'), 'new cli');
  } finally { restore(); }
});

test('`to` reports the resolved release version, not the string "latest"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  writeFileSync(cliPath, 'old cli');

  const bodies = releaseBodies('new cli');
  bodies[`${BASE}/VERSION`] = 'v0.3.0\n';
  const restore = stubFetch(bodies);
  try {
    const r = await selfUpdate({ targetPath: cliPath });
    assert.equal(r.to, 'v0.3.0', `expected the real tag, got ${JSON.stringify(r.to)}`);
  } finally { restore(); }
});

test('`to` degrades to "latest" when the release exposes no version marker', async () => {
  // Older releases have no VERSION asset; the upgrade must still work rather
  // than failing over a cosmetic field.
  const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
  const cliPath = join(dir, 'cli.js');
  writeFileSync(cliPath, 'old cli');

  const restore = stubFetch(releaseBodies('new cli'));
  try {
    const r = await selfUpdate({ targetPath: cliPath });
    assert.equal(r.upgraded, true);
    assert.equal(r.to, 'latest');
  } finally { restore(); }
});
