import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CLI Orchestrator (vscode-free, shared by the CLI tool and the extension).
 *
 * Runs `graphify update .` to refresh the AST graph, then `sonar-scanner`
 * and the Nexus IQ CLI with flags that write local JSON reports under
 * `.scanner-reports/`. Handles per-tool timeouts and degrades gracefully
 * when a CLI is missing.
 */

export interface CliPaths {
  claude?: string;
  sonar?: string;
  nexusIq?: string;
  graphify?: string;
}

export interface ScanOptions {
  /** Workspace root the scanners run against. */
  cwd: string;
  /** Absolute CLI paths; falls back to resolving names from PATH. */
  paths?: CliPaths;
  /** Directory for JSON/markdown reports. Defaults to `<cwd>/.scanner-reports`. */
  reportDir?: string;
  /** Per-tool timeout in ms. Defaults to 10 minutes. */
  timeoutMs?: number;
  /** Extra args forwarded to sonar-scanner (e.g. -Dsonar.host.url=...). */
  sonarExtraArgs?: string[];
  /** Extra args forwarded to nexus-iq-cli (e.g. -i appId -s server). */
  iqExtraArgs?: string[];
  logger?: (line: string) => void;
}

export interface ScanStepResult {
  tool: 'graphify' | 'sonar' | 'nexus-iq';
  ok: boolean;
  /** True when the CLI was not found and the step was skipped. */
  skipped?: boolean;
  message: string;
  reportFile?: string;
  durationMs: number;
}

export interface ScanSummary {
  steps: ScanStepResult[];
  reportDir: string;
  graphFile: string;
  ok: boolean;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function resolveBin(configured: string | undefined, fallbackName: string): string {
  return configured && configured.trim().length > 0 ? configured : fallbackName;
}

function isMissing(
  error: NodeJS.ErrnoException | null,
  code: number | null,
  stderr: string
): boolean {
  if (error?.code === 'ENOENT') { return true; }
  // POSIX shells report missing commands as exit code 127.
  if (code === 127) { return true; }
  if (!error) { return false; }
  // Windows cmd-style "not recognized" and POSIX "command not found".
  return /not recognized|command not found|not found/i.test(stderr);
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
  timedOut: boolean;
}

function quote(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function run(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<RunResult> {
  return new Promise((resolve) => {
    // Build a single quoted command string instead of passing an args array
    // with shell:true (which triggers DEP0190 and leaves args unescaped).
    const command = [quote(bin), ...args.map(quote)].join(' ');
    const child = execFile(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, shell: true },
      (error, stdout, stderr) => {
        resolve({
          code: typeof child.exitCode === 'number' ? child.exitCode : null,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          error: (error as NodeJS.ErrnoException | null) ?? null,
          timedOut:
            !!error &&
            (error as { killed?: boolean }).killed === true &&
            /timeout/i.test(error.message ?? ''),
        });
      }
    );
  });
}

async function runStep(
  tool: ScanStepResult['tool'],
  bin: string,
  args: string[],
  options: ScanOptions,
  expectedReport: string | undefined,
  log: (line: string) => void
): Promise<ScanStepResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  log(`[${tool}] ${bin} ${args.join(' ')}`);

  const result = await run(bin, args, options.cwd, timeoutMs);

  if (result.error && isMissing(result.error, result.code, result.stderr)) {
    return {
      tool,
      ok: false,
      skipped: true,
      message: `CLI not found: '${bin}'. Configure its absolute path or add it to PATH.`,
      durationMs: Date.now() - started,
    };
  }
  if (result.timedOut) {
    return {
      tool,
      ok: false,
      message: `Timed out after ${Math.round(timeoutMs / 1000)}s.`,
      durationMs: Date.now() - started,
    };
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-3).join(' | ');
    return {
      tool,
      ok: false,
      message: `Exited with code ${result.code}.${detail ? ` ${detail}` : ''}`,
      durationMs: Date.now() - started,
    };
  }
  if (expectedReport && !fs.existsSync(expectedReport)) {
    return {
      tool,
      ok: false,
      message: `Completed but did not produce expected report: ${expectedReport}`,
      durationMs: Date.now() - started,
    };
  }
  return {
    tool,
    ok: true,
    message: 'OK',
    reportFile: expectedReport,
    durationMs: Date.now() - started,
  };
}

/** Runs graphify, sonar-scanner, and nexus-iq-cli; returns per-step results. */
export async function runAllScans(options: ScanOptions): Promise<ScanSummary> {
  const log = options.logger ?? (() => undefined);
  const reportDir = options.reportDir ?? path.join(options.cwd, '.scanner-reports');
  fs.mkdirSync(reportDir, { recursive: true });

  const paths = options.paths ?? {};
  const sonarReport = path.join(reportDir, 'sonar.json');
  const iqReport = path.join(reportDir, 'iq.json');
  const graphFile = path.join(options.cwd, 'graph.json');

  const steps: ScanStepResult[] = [];

  // 1. Refresh the AST graph first — diagnostics and Claude Code fixes
  //    depend on graph.json being current.
  steps.push(
    await runStep(
      'graphify',
      resolveBin(paths.graphify, 'graphify'),
      ['update', '.'],
      options,
      fs.existsSync(graphFile) ? graphFile : undefined,
      log
    )
  );

  // 2. SonarQube — ask the scanner to export issues as JSON locally.
  //    (sonar.reportExportPath requires a SonarQube edition supporting the
  //    report export; the step degrades gracefully if the file never lands.)
  steps.push(
    await runStep(
      'sonar',
      resolveBin(paths.sonar, 'sonar-scanner'),
      [`-Dsonar.reportExportPath=${sonarReport}`, ...(options.sonarExtraArgs ?? [])],
      options,
      sonarReport,
      log
    )
  );

  // 3. Nexus IQ — write the policy evaluation result as JSON.
  steps.push(
    await runStep(
      'nexus-iq',
      resolveBin(paths.nexusIq, 'nexus-iq-cli'),
      ['--result-file', iqReport, ...(options.iqExtraArgs ?? [])],
      options,
      iqReport,
      log
    )
  );

  return {
    steps,
    reportDir,
    graphFile,
    ok: steps.every((s) => s.ok || s.skipped),
  };
}
