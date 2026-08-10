import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { runAllScans, CliPaths } from './core/runner';
import { parseReportDir } from './core/parser';
import { writeMarkdownReport } from './core/markdown';
import { DiagnosticsProvider } from './diagnostics';
import { ClaudeCodeActionProvider, registerFixWithClaude } from './codeActions';
import { VulnerabilityTreeProvider } from './treeView';

/**
 * Graphify Reviewer — unified agentic code review.
 *
 * The scan engine lives in the vscode-free core (src/core/) so the same
 * pipeline backs both the standalone CLI and this extension.
 */

function configuredPaths(): CliPaths {
  const cfg = vscode.workspace.getConfiguration('graphifyReviewer');
  return {
    claude: cfg.get<string>('claudePath') || undefined,
    sonar: cfg.get<string>('sonarPath') || undefined,
    nexusIq: cfg.get<string>('nexusIqPath') || undefined,
    graphify: cfg.get<string>('graphifyPath') || undefined,
  };
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function reportFileFor(root: string): string {
  return path.join(root, '.scanner-reports', 'report.md');
}

async function openReport(root: string): Promise<void> {
  const reportFile = reportFileFor(root);
  if (!fs.existsSync(reportFile)) {
    vscode.window.showWarningMessage(
      'Graphify Reviewer: no report yet — run "Graphify Reviewer: Run All Scans" first.'
    );
    return;
  }
  const uri = vscode.Uri.file(reportFile);
  await vscode.commands.executeCommand('markdown.showPreview', uri);
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Graphify Reviewer');
  context.subscriptions.push(output);
  output.appendLine('Graphify Reviewer activated.');

  const root = workspaceRoot();
  if (!root) {
    output.appendLine('No workspace folder — extension idle until one is opened.');
    return;
  }

  // Step 3: Diagnostics — squiggles from scanner reports.
  const diagnostics = new DiagnosticsProvider(root);
  context.subscriptions.push(diagnostics);
  const initialFindings = diagnostics.refreshFromDisk();

  // Step 5: Vulnerability Explorer tree view.
  const treeProvider = new VulnerabilityTreeProvider(root);
  context.subscriptions.push(treeProvider);
  treeProvider.update(initialFindings);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('graphifyReviewer.vulnerabilities', treeProvider)
  );

  // Step 4: Code actions — "Fix with Claude Code" quick fixes.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new ClaudeCodeActionProvider(),
      { providedCodeActionKinds: ClaudeCodeActionProvider.providedCodeActionKinds }
    )
  );
  registerFixWithClaude(
    context,
    root,
    () => configuredPaths().claude ?? 'claude',
    output
  );

  // Keep tree + report in sync when the CLI rewrites reports on disk.
  const syncFromDisk = () => treeProvider.update(diagnostics.refreshFromDisk());
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, '.scanner-reports/*.json')
  );
  watcher.onDidCreate(syncFromDisk);
  watcher.onDidChange(syncFromDisk);
  watcher.onDidDelete(syncFromDisk);
  context.subscriptions.push(watcher);

  const runScans = vscode.commands.registerCommand(
    'graphifyReviewer.runScans',
    async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Graphify Reviewer: scanning…',
          cancellable: false,
        },
        async () => {
          output.show(true);
          const summary = await runAllScans({
            cwd: root,
            paths: configuredPaths(),
            logger: (line) => output.appendLine(line),
          });

          for (const step of summary.steps) {
            output.appendLine(
              `[${step.skipped ? 'SKIPPED' : step.ok ? 'OK' : 'FAILED'}] ${step.tool} — ${step.message}`
            );
          }

          const parsed = parseReportDir(summary.reportDir);
          const reportFile = writeMarkdownReport(parsed, root, summary.reportDir);
          output.appendLine(`Report written to ${reportFile}`);

          // Push findings to squiggles + sidebar.
          treeProvider.update(diagnostics.update(parsed.findings));

          const choice = await vscode.window.showInformationMessage(
            `Graphify Reviewer: ${parsed.findings.length} finding(s). Scan ${
              summary.ok ? 'complete' : 'finished with errors — see output'
            }.`,
            'Open Report'
          );
          if (choice === 'Open Report') {
            await openReport(root);
          }
        }
      );
    }
  );
  context.subscriptions.push(runScans);

  context.subscriptions.push(
    vscode.commands.registerCommand('graphifyReviewer.openReport', () => openReport(root))
  );
}

export function deactivate(): void {
  // Module disposables are registered on the extension context.
}
