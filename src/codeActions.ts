import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DIAGNOSTIC_SOURCE } from './diagnostics';

export const FIX_WITH_CLAUDE_COMMAND = 'graphifyReviewer.fixWithClaude';

/**
 * Code Action Provider.
 *
 * Surfaces a "Fix with Claude Code" Quick Fix on every diagnostic we
 * generated. Executing it builds a prompt from the diagnostic details
 * plus the cross-file dependency context extracted from graph.json, and
 * hands it to the Claude Code CLI in a terminal — the developer reviews
 * and accepts the drafted patch themselves.
 */
export class ClaudeCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (!diagnostic.source?.startsWith(DIAGNOSTIC_SOURCE)) {
        continue;
      }
      const action = new vscode.CodeAction(
        'Fix with Claude Code',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diagnostic];
      action.isPreferred = true;
      action.command = {
        command: FIX_WITH_CLAUDE_COMMAND,
        title: 'Fix with Claude Code',
        arguments: [{ uri: document.uri, diagnostic }],
      };
      actions.push(action);
    }
    return actions;
  }
}

/** Extracts graph.json entries that mention the given file (best effort). */
function extractGraphContext(graphFile: string, targetFile: string): string {
  try {
    const raw = fs.readFileSync(graphFile, 'utf8');
    const graph = JSON.parse(raw) as Record<string, unknown>;
    const fileName = path.basename(targetFile);
    const relevant: unknown[] = [];

    for (const section of Object.values(graph)) {
      if (!Array.isArray(section)) {
        continue;
      }
      for (const entry of section) {
        const serialized = JSON.stringify(entry);
        if (serialized.includes(fileName) || serialized.includes(targetFile)) {
          relevant.push(entry);
        }
      }
    }

    const MAX_CONTEXT = 4096;
    const json = JSON.stringify(relevant, null, 2);
    return json.length > MAX_CONTEXT ? `${json.slice(0, MAX_CONTEXT)}\n…(truncated)` : json;
  } catch {
    return '(graph.json unavailable — run a scan first)';
  }
}

export function buildClaudePrompt(
  workspaceRoot: string,
  file: string,
  diagnostic: vscode.Diagnostic
): string {
  const relFile = path.relative(workspaceRoot, file);
  const line = diagnostic.range.start.line + 1;
  const graphContext = extractGraphContext(
    path.join(workspaceRoot, 'graph.json'),
    relFile
  );

  return [
    `Fix the following static-analysis finding. Draft the patch but let me review it before applying.`,
    ``,
    `File: ${relFile}`,
    `Line: ${line}`,
    `Severity: ${vscode.DiagnosticSeverity[diagnostic.severity]}`,
    diagnostic.code ? `Rule: ${String(typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code)}` : undefined,
    `Message: ${diagnostic.message}`,
    ``,
    `Cross-file dependency context (graph.json excerpt):`,
    '```json',
    graphContext,
    '```',
  ]
    .filter((l): l is string => l !== undefined)
    .join('\n');
}

/**
 * Quotes a value for the terminal's shell. POSIX shells (Linux/macOS)
 * expand `$`, backticks, and `\` inside double quotes, so single quotes
 * with the '\'' idiom are required there; cmd.exe only understands
 * double quotes.
 */
export function quoteForShell(value: string): string {
  if (process.platform === 'win32') {
    return JSON.stringify(value);
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Registers the fix command; spawns Claude Code in an integrated terminal. */
export function registerFixWithClaude(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  claudePath: () => string,
  output: vscode.OutputChannel
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      FIX_WITH_CLAUDE_COMMAND,
      (args: { uri: vscode.Uri; diagnostic: vscode.Diagnostic }) => {
        const prompt = buildClaudePrompt(
          workspaceRoot,
          args.uri.fsPath,
          args.diagnostic
        );
        output.appendLine('--- Claude Code prompt ---');
        output.appendLine(prompt);

        const bin = claudePath();
        const terminal = vscode.window.createTerminal({
          name: 'Claude Code Fix',
          cwd: workspaceRoot,
        });
        terminal.show();
        terminal.sendText(`${quoteForShell(bin)} ${quoteForShell(prompt)}`);
        vscode.window.showInformationMessage(
          'Graphify Reviewer: prompt sent to Claude Code — review the drafted fix before applying.'
        );
      }
    )
  );
}
