#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { runAllScans, CliPaths } from '../core/runner';
import { parseReportDir } from '../core/parser';
import { writeMarkdownReport, renderMarkdown } from '../core/markdown';

/**
 * graphify-reviewer CLI — run scans and render reports without VS Code.
 *
 * Usage:
 *   graphify-reviewer scan   [--cwd DIR] [--sonar EXE] [--nexus-iq EXE]
 *                            [--graphify EXE] [--timeout MS]
 *                            [--sonar-arg ARG]... [--iq-arg ARG]...
 *   graphify-reviewer report [--cwd DIR] [--print]
 *   graphify-reviewer install-hook [--cwd DIR]
 *   graphify-reviewer hook-stdin            (invoked by the Claude Code hook)
 *
 * Environment overrides: GRAPHIFY_REVIEWER_CLAUDE_PATH, ..._SONAR_PATH,
 * ..._NEXUS_IQ_PATH, ..._GRAPHIFY_PATH.
 */

interface ParsedArgs {
  command: string | undefined;
  cwd: string;
  paths: CliPaths;
  timeoutMs?: number;
  sonarExtraArgs: string[];
  iqExtraArgs: string[];
  print: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: undefined,
    cwd: process.cwd(),
    paths: {
      claude: process.env.GRAPHIFY_REVIEWER_CLAUDE_PATH,
      sonar: process.env.GRAPHIFY_REVIEWER_SONAR_PATH,
      nexusIq: process.env.GRAPHIFY_REVIEWER_NEXUS_IQ_PATH,
      graphify: process.env.GRAPHIFY_REVIEWER_GRAPHIFY_PATH,
    },
    sonarExtraArgs: [],
    iqExtraArgs: [],
    print: false,
    help: false,
  };

  const args = [...argv];
  result.command = args.shift();
  if (result.command === '-h' || result.command === '--help') {
    result.help = true;
    result.command = undefined;
  }

  while (args.length > 0) {
    const flag = args.shift() as string;
    const value = (): string => {
      const v = args.shift();
      if (v === undefined) {
        throw new Error(`Missing value for ${flag}`);
      }
      return v;
    };
    switch (flag) {
      case '--cwd': result.cwd = path.resolve(value()); break;
      case '--sonar': result.paths.sonar = value(); break;
      case '--nexus-iq': result.paths.nexusIq = value(); break;
      case '--graphify': result.paths.graphify = value(); break;
      case '--claude': result.paths.claude = value(); break;
      case '--timeout': result.timeoutMs = Number(value()); break;
      case '--sonar-arg': result.sonarExtraArgs.push(value()); break;
      case '--iq-arg': result.iqExtraArgs.push(value()); break;
      case '--print': result.print = true; break;
      case '-h':
      case '--help': result.help = true; break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return result;
}

const USAGE = `graphify-reviewer — unified agentic code review CLI

Commands:
  scan     Run graphify, sonar-scanner, and nexus-iq-cli; writes JSON to
           .scanner-reports/ and renders .scanner-reports/report.md
  report   Re-render the markdown report from existing JSON reports
  install-hook
           Install a Claude Code hook (.claude/settings.json) that triggers
           an autonomous scan whenever Claude Code commits code
  hook-stdin
           Internal: invoked by the hook; reads the hook payload from stdin
           and only scans when the tool call was a git commit

Options:
  --cwd DIR          Workspace root (default: current directory)
  --sonar EXE        Path to sonar-scanner
  --nexus-iq EXE     Path to the Nexus IQ CLI
  --graphify EXE     Path to the Graphify CLI
  --claude EXE       Path to the Claude Code CLI
  --timeout MS       Per-tool timeout (default: 600000)
  --sonar-arg ARG    Extra sonar-scanner argument (repeatable)
  --iq-arg ARG       Extra nexus-iq-cli argument (repeatable)
  --print            (report) Print markdown to stdout instead of writing a file
  -h, --help         Show this help
`;

async function main(): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  if (args.help || !args.command) {
    console.log(USAGE);
    return args.help ? 0 : 2;
  }

  if (args.command === 'scan') {
    const summary = await runAllScans({
      cwd: args.cwd,
      paths: args.paths,
      timeoutMs: args.timeoutMs,
      sonarExtraArgs: args.sonarExtraArgs,
      iqExtraArgs: args.iqExtraArgs,
      logger: (line) => console.log(line),
    });

    for (const step of summary.steps) {
      const status = step.skipped ? 'SKIPPED' : step.ok ? 'OK' : 'FAILED';
      console.log(
        `[${status}] ${step.tool} (${(step.durationMs / 1000).toFixed(1)}s) — ${step.message}`
      );
    }

    const parsed = parseReportDir(summary.reportDir);
    const reportFile = writeMarkdownReport(parsed, args.cwd, summary.reportDir);
    console.log(`\n${parsed.findings.length} finding(s). Markdown report: ${reportFile}`);
    return summary.ok ? 0 : 1;
  }

  if (args.command === 'report') {
    const reportDir = path.join(args.cwd, '.scanner-reports');
    const parsed = parseReportDir(reportDir);
    if (parsed.missing.length > 0 && parsed.findings.length === 0) {
      console.error(`No reports found in ${reportDir}. Run 'graphify-reviewer scan' first.`);
      return 1;
    }
    if (args.print) {
      console.log(renderMarkdown(parsed, args.cwd));
    } else {
      const reportFile = writeMarkdownReport(parsed, args.cwd, reportDir);
      console.log(`Markdown report: ${reportFile}`);
    }
    return 0;
  }

  if (args.command === 'install-hook') {
    return installHook(args.cwd);
  }

  if (args.command === 'hook-stdin') {
    return runHookFromStdin(args);
  }

  console.error(`Unknown command: ${args.command}\n\n${USAGE}`);
  return 2;
}

interface ClaudeSettings {
  hooks?: {
    PostToolUse?: Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Installs a Claude Code PostToolUse hook into .claude/settings.json so an
 * autonomous scan runs whenever Claude Code executes a git commit. The hook
 * invokes `graphify-reviewer hook-stdin`, which inspects the hook payload.
 */
function installHook(cwd: string): number {
  const claudeDir = path.join(cwd, '.claude');
  const settingsFile = path.join(claudeDir, 'settings.json');
  fs.mkdirSync(claudeDir, { recursive: true });

  let settings: ClaudeSettings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as ClaudeSettings;
    } catch {
      console.error(`Cannot parse existing ${settingsFile} — fix or remove it first.`);
      return 1;
    }
  }

  const hookCommand = 'graphify-reviewer hook-stdin';
  settings.hooks = settings.hooks ?? {};
  settings.hooks.PostToolUse = settings.hooks.PostToolUse ?? [];

  const alreadyInstalled = settings.hooks.PostToolUse.some((entry) =>
    entry.hooks?.some((h) => h.command.includes(hookCommand))
  );
  if (alreadyInstalled) {
    console.log(`Hook already installed in ${settingsFile}`);
    return 0;
  }

  settings.hooks.PostToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: hookCommand }],
  });

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(
    `Installed Claude Code hook in ${settingsFile}\n` +
      `A scan will now run automatically whenever Claude Code commits code.`
  );
  return 0;
}

interface HookPayload {
  tool_name?: string;
  tool_input?: { command?: string };
  cwd?: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // Don't hang forever if the harness never pipes anything.
    setTimeout(() => resolve(data), 5000).unref();
  });
}

/**
 * Hook entry point: reads the Claude Code hook payload from stdin and runs
 * the scan pipeline only when the completed tool call was a git commit.
 * Always exits 0 — a hook must never block Claude Code.
 */
async function runHookFromStdin(args: ParsedArgs): Promise<number> {
  const raw = await readStdin();
  let payload: HookPayload = {};
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return 0;
  }

  const command = payload.tool_input?.command ?? '';
  if (!/\bgit\s+commit\b/.test(command)) {
    return 0; // not a commit — nothing to do
  }

  const cwd = payload.cwd ? path.resolve(payload.cwd) : args.cwd;
  console.error(`[graphify-reviewer] commit detected — starting autonomous scan in ${cwd}`);

  const summary = await runAllScans({
    cwd,
    paths: args.paths,
    timeoutMs: args.timeoutMs,
    logger: (line) => console.error(line),
  });
  const parsed = parseReportDir(summary.reportDir);
  const reportFile = writeMarkdownReport(parsed, cwd, summary.reportDir);
  console.error(
    `[graphify-reviewer] ${parsed.findings.length} finding(s). Report: ${reportFile}`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
