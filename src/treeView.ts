import * as path from 'path';
import * as vscode from 'vscode';
import { Finding } from './core/parser';

type Node = SeverityNode | FileNode | FindingNode;

class SeverityNode {
  constructor(
    public readonly severity: string,
    public readonly findings: Finding[]
  ) {}
}

class FileNode {
  constructor(
    public readonly file: string,
    public readonly findings: Finding[]
  ) {}
}

class FindingNode {
  constructor(public readonly finding: Finding) {}
}

/**
 * Vulnerability Explorer — workspace-wide TreeDataProvider surfacing all
 * parsed findings grouped by severity, then file.
 */
export class VulnerabilityTreeProvider
  implements vscode.TreeDataProvider<Node>, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private findings: Finding[] = [];

  constructor(private readonly workspaceRoot: string) {}

  update(findings: Finding[]): void {
    this.findings = findings;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node instanceof SeverityNode) {
      const item = new vscode.TreeItem(
        `${node.severity} (${node.findings.length})`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon(iconFor(node.severity));
      return item;
    }
    if (node instanceof FileNode) {
      const item = new vscode.TreeItem(
        node.file,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.resourceUri = vscode.Uri.file(this.resolveFile(node.file));
      item.iconPath = vscode.ThemeIcon.File;
      item.description = `${node.findings.length}`;
      return item;
    }
    const f = node.finding;
    const item = new vscode.TreeItem(
      `${f.line ? `L${f.line}: ` : ''}${f.message}`,
      vscode.TreeItemCollapsibleState.None
    );
    item.tooltip = `${f.severity} · ${f.rule ?? '—'} · ${f.source}\n${f.message}`;
    item.description = f.rule;
    item.iconPath = new vscode.ThemeIcon('warning');
    if (f.file) {
      item.command = {
        command: 'vscode.open',
        title: 'Open file',
        arguments: [
          vscode.Uri.file(this.resolveFile(f.file)),
          f.line
            ? { selection: new vscode.Range(f.line - 1, 0, f.line - 1, 0) }
            : undefined,
        ],
      };
    }
    return item;
  }

  private resolveFile(file: string): string {
    return path.isAbsolute(file) ? file : path.join(this.workspaceRoot, file);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const bySeverity = new Map<string, Finding[]>();
      for (const f of this.findings) {
        const list = bySeverity.get(f.severity) ?? [];
        list.push(f);
        bySeverity.set(f.severity, list);
      }
      return [...bySeverity.entries()].map(
        ([severity, findings]) => new SeverityNode(severity, findings)
      );
    }
    if (node instanceof SeverityNode || node instanceof FileNode) {
      const byFile = new Map<string, Finding[]>();
      const loose: Finding[] = [];
      for (const f of node.findings) {
        if (f.file) {
          const list = byFile.get(f.file) ?? [];
          list.push(f);
          byFile.set(f.file, list);
        } else {
          loose.push(f);
        }
      }
      const children: Node[] = [...byFile.entries()].map(
        ([file, findings]) => new FileNode(file, findings)
      );
      children.push(...loose.map((f) => new FindingNode(f)));
      return children;
    }
    return [];
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}

function iconFor(severity: string): string {
  switch (severity.toUpperCase()) {
    case 'BLOCKER':
    case 'CRITICAL':
      return 'error';
    case 'MAJOR':
      return 'warning';
    default:
      return 'info';
  }
}
