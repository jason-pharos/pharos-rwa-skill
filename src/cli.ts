import { Command } from 'commander';
import { VERSION } from './version.ts';
import { runVaults, runPosition, runReminders, runAdvise, runUpgrade, type RunOpts } from './index.ts';

function emit(obj: unknown, pretty: boolean): void {
  process.stdout.write(JSON.stringify(obj, null, pretty ? 2 : 0) + '\n');
}
function fail(message: string, code = 1): never {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(code);
}
function assertAddress(addr: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) fail(`invalid address: ${addr}`, 2);
}
function runOpts(o: { rpc?: string; remote?: boolean; r25?: boolean }): RunOpts {
  const base = { noRemote: o.remote === false, noR25: o.r25 === false };
  return o.rpc === undefined ? base : { ...base, rpc: o.rpc };
}

const program = new Command();
program.name('pharos-rwa').version(VERSION)
  .option('--pretty', 'pretty-print JSON')
  .option('--rpc <url>', 'override Pharos RPC URL')
  .option('--no-remote', 'skip remote config + version check')
  .option('--no-r25', 'skip R25 dApp API (region-restricted)');

function globals() { return program.opts<{ pretty?: boolean; rpc?: string; remote?: boolean; r25?: boolean }>(); }

program.command('vaults').description('market overview of all harbor vaults')
  .action(async () => { const g = globals(); emit(await runVaults(runOpts(g)), !!g.pretty); });

program.command('position <address>').description('position overview for APC3M/pALPHA')
  .action(async (address: string) => { const g = globals(); assertAddress(address); emit(await runPosition(address, runOpts(g)), !!g.pretty); });

program.command('reminders <address>').description('action-period reminders')
  .action(async (address: string) => { const g = globals(); assertAddress(address); emit(await runReminders(address, runOpts(g)), !!g.pretty); });

program.command('advise <address>').description('market + position + gap advice bundle')
  .action(async (address: string) => { const g = globals(); assertAddress(address); emit(await runAdvise(address, runOpts(g)), !!g.pretty); });

program.command('upgrade').description('self-update cli.js from the latest GitHub Release')
  .action(async () => { const g = globals(); emit(await runUpgrade(), !!g.pretty); });

program.parseAsync().catch((err: unknown) => fail(String((err as Error)?.message ?? err)));
