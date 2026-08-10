import * as fs from 'fs';
import * as path from 'path';

/**
 * Report parser (vscode-free, shared by the CLI tool and the extension).
 *
 * Normalizes SonarQube and Nexus IQ JSON reports into a common Finding
 * shape consumed by the markdown renderer, the diagnostics provider, and
 * the tree view.
 */

export type FindingSource = 'sonar' | 'nexus-iq';

export interface Finding {
  source: FindingSource;
  /** Workspace-relative file path, when the report provides one. */
  file?: string;
  line?: number;
  severity: string;
  rule?: string;
  message: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

interface SonarIssue {
  rule?: string;
  severity?: string;
  component?: string;
  line?: number;
  message?: string;
  textRange?: { startLine?: number };
}

function stripProjectPrefix(component: string): string {
  // Sonar components look like "projectKey:src/main/Foo.java".
  const idx = component.indexOf(':');
  return idx >= 0 ? component.slice(idx + 1) : component;
}

export function parseSonarReport(file: string): Finding[] {
  const data = readJson(file) as { issues?: SonarIssue[] } | undefined;
  if (!data || !Array.isArray(data.issues)) {
    return [];
  }
  return data.issues.map((issue) => ({
    source: 'sonar' as const,
    file: issue.component ? stripProjectPrefix(issue.component) : undefined,
    line: issue.line ?? issue.textRange?.startLine,
    severity: (issue.severity ?? 'INFO').toUpperCase(),
    rule: issue.rule,
    message: issue.message ?? '(no message)',
  }));
}

interface IqPolicyViolation {
  policyName?: string;
  threatLevel?: number;
  component?: {
    displayName?: string;
    pathnames?: string[];
  };
}

interface IqReport {
  policyViolations?: IqPolicyViolation[];
  policyEvaluationResult?: { policyViolations?: IqPolicyViolation[] };
}

function threatToSeverity(level: number | undefined): string {
  if (level === undefined) { return 'INFO'; }
  if (level >= 8) { return 'CRITICAL'; }
  if (level >= 4) { return 'MAJOR'; }
  if (level >= 1) { return 'MINOR'; }
  return 'INFO';
}

export function parseIqReport(file: string): Finding[] {
  const data = readJson(file) as IqReport | undefined;
  const violations =
    data?.policyViolations ?? data?.policyEvaluationResult?.policyViolations ?? [];
  return violations.map((v) => ({
    source: 'nexus-iq' as const,
    file: v.component?.pathnames?.[0],
    severity: threatToSeverity(v.threatLevel),
    rule: v.policyName,
    message: `${v.policyName ?? 'Policy violation'} — ${v.component?.displayName ?? 'unknown component'}`,
  }));
}

export interface ParsedReports {
  findings: Finding[];
  missing: string[];
}

/** Parses every report present in the report directory. */
export function parseReportDir(reportDir: string): ParsedReports {
  const findings: Finding[] = [];
  const missing: string[] = [];

  const sonarFile = path.join(reportDir, 'sonar.json');
  if (fs.existsSync(sonarFile)) {
    findings.push(...parseSonarReport(sonarFile));
  } else {
    missing.push(sonarFile);
  }

  const iqFile = path.join(reportDir, 'iq.json');
  if (fs.existsSync(iqFile)) {
    findings.push(...parseIqReport(iqFile));
  } else {
    missing.push(iqFile);
  }

  return { findings, missing };
}
