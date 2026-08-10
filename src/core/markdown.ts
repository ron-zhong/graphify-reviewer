import * as fs from 'fs';
import * as path from 'path';
import { Finding, ParsedReports } from './parser';

/**
 * Markdown report renderer (vscode-free). The CLI writes the report to
 * `.scanner-reports/report.md`; the VS Code extension opens the same file
 * in a markdown preview.
 */

const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];

function severityRank(severity: string): number {
  const idx = SEVERITY_ORDER.indexOf(severity.toUpperCase());
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderMarkdown(parsed: ParsedReports, workspaceRoot: string): string {
  const { findings } = parsed;
  const sorted = [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity)
  );

  const counts = new Map<string, number>();
  for (const f of findings) {
    counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push('# Graphify Reviewer — Scan Report');
  lines.push('');
  lines.push(`- Workspace: \`${workspaceRoot}\``);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Total findings: **${findings.length}**`);
  if (parsed.missing.length > 0) {
    lines.push(
      `- Missing reports: ${parsed.missing.map((m) => `\`${path.basename(m)}\``).join(', ')}`
    );
  }
  lines.push('');

  lines.push('## Summary by severity');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('| -------- | ----- |');
  for (const sev of SEVERITY_ORDER) {
    const n = counts.get(sev);
    if (n) {
      lines.push(`| ${sev} | ${n} |`);
    }
  }
  lines.push('');

  const byFile = new Map<string, Finding[]>();
  const noFile: Finding[] = [];
  for (const f of sorted) {
    if (f.file) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    } else {
      noFile.push(f);
    }
  }

  lines.push('## Findings by file');
  lines.push('');
  for (const [file, fileFindings] of [...byFile.entries()].sort()) {
    lines.push(`### \`${file}\``);
    lines.push('');
    lines.push('| Line | Severity | Source | Rule | Message |');
    lines.push('| ---- | -------- | ------ | ---- | ------- |');
    for (const f of fileFindings) {
      lines.push(
        `| ${f.line ?? '—'} | ${f.severity} | ${f.source} | ${escapeCell(f.rule ?? '—')} | ${escapeCell(f.message)} |`
      );
    }
    lines.push('');
  }

  if (noFile.length > 0) {
    lines.push('## Dependency / policy findings (no file location)');
    lines.push('');
    lines.push('| Severity | Source | Rule | Message |');
    lines.push('| -------- | ------ | ---- | ------- |');
    for (const f of noFile) {
      lines.push(
        `| ${f.severity} | ${f.source} | ${escapeCell(f.rule ?? '—')} | ${escapeCell(f.message)} |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function writeMarkdownReport(
  parsed: ParsedReports,
  workspaceRoot: string,
  reportDir: string
): string {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, 'report.md');
  fs.writeFileSync(reportFile, renderMarkdown(parsed, workspaceRoot), 'utf8');
  return reportFile;
}
