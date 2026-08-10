import * as vscode from 'vscode';

/**
 * Graphify Reviewer — unified agentic code review.
 *
 * Wires together the Scanner Orchestrator (runner.ts), the Diagnostics
 * Provider (diagnostics.ts), the Claude Code remediation actions
 * (codeActions.ts), and the Vulnerability Explorer (treeView.ts).
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Graphify Reviewer');
  context.subscriptions.push(output);
  output.appendLine('Graphify Reviewer activated.');

  // Step 1 (scaffolding): register the manual scan trigger.
  // The orchestrator, diagnostics, code actions, and tree view are
  // wired in here as each module is implemented in later steps.
  const runScans = vscode.commands.registerCommand(
    'graphifyReviewer.runScans',
    async () => {
      output.appendLine('runScans triggered — orchestrator not yet implemented (Step 2).');
      vscode.window.showInformationMessage(
        'Graphify Reviewer: scan orchestrator lands in Step 2.'
      );
    }
  );
  context.subscriptions.push(runScans);
}

export function deactivate(): void {
  // Nothing to clean up yet; module disposables will be registered
  // on the extension context as they are implemented.
}
