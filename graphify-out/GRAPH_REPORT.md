# Graph Report - .  (2026-08-10)

## Corpus Check
- Corpus is ~5,671 words - fits in a single context window. You may not need a graph.

## Summary
- 176 nodes · 263 edges · 9 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- CLI & Markdown Rendering
- Package Manifest Metadata
- VSCode Contribution Points
- Diagnostics & Tree View
- README Design & Overview
- Code Actions & Activation
- TypeScript Build Config
- Report Parser (IQ/Sonar)
- Dev Dependencies

## God Nodes (most connected - your core abstractions)
1. `Finding` - 13 edges
2. `activate()` - 11 edges
3. `parseReportDir()` - 10 edges
4. `compilerOptions` - 10 edges
5. `VulnerabilityTreeProvider` - 9 edges
6. `main()` - 8 edges
7. `runAllScans()` - 8 edges
8. `DiagnosticsProvider` - 8 edges
9. `Orchestrator (src/runner.ts / src/core/runner.ts)` - 8 edges
10. `writeMarkdownReport()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `parseReportDir()`  [EXTRACTED]
  src/cli/index.ts → src/core/parser.ts
- `runHookFromStdin()` --calls--> `parseReportDir()`  [EXTRACTED]
  src/cli/index.ts → src/core/parser.ts
- `activate()` --calls--> `writeMarkdownReport()`  [EXTRACTED]
  src/extension.ts → src/core/markdown.ts
- `activate()` --calls--> `parseReportDir()`  [EXTRACTED]
  src/extension.ts → src/core/parser.ts
- `activate()` --calls--> `runAllScans()`  [EXTRACTED]
  src/extension.ts → src/core/runner.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Multi-tool scan pipeline (Graphify + SonarQube + Nexus IQ executed together by Orchestrator)** — readme_orchestrator, readme_graphify, readme_sonarqube_cli, readme_nexus_iq_cli [EXTRACTED 1.00]
- **End-to-end autonomous review flow from commit hook to developer review** — readme_claude_code_hook, readme_orchestrator, readme_diagnostics_provider, readme_code_action_provider, readme_vulnerability_explorer [EXTRACTED 1.00]

## Communities (9 total, 0 thin omitted)

### Community 0 - "CLI & Markdown Rendering"
Cohesion: 0.13
Nodes (25): ClaudeSettings, HookPayload, installHook(), main(), parseArgs(), ParsedArgs, readStdin(), runHookFromStdin() (+17 more)

### Community 1 - "Package Manifest Metadata"
Cohesion: 0.07
Nodes (26): activationEvents, bin, graphify-reviewer, categories, description, displayName, engines, vscode (+18 more)

### Community 2 - "VSCode Contribution Points"
Cohesion: 0.08
Nodes (25): properties, title, contributes, commands, configuration, views, viewsContainers, default (+17 more)

### Community 3 - "Diagnostics & Tree View"
Cohesion: 0.13
Nodes (9): Finding, DiagnosticsProvider, toVsSeverity(), FileNode, FindingNode, iconFor(), Node, SeverityNode (+1 more)

### Community 4 - "README Design & Overview"
Cohesion: 0.14
Nodes (22): Claude Code, Claude Code Hook (autonomous trigger), graphify-reviewer CLI tool, Code Action Provider (src/codeActions.ts), Extension Commands (runScans, openReport), Extension Configuration Settings (graphifyReviewer.*Path), Developer-in-control design principle, vscode.DiagnosticCollection (+14 more)

### Community 5 - "Code Actions & Activation"
Cohesion: 0.21
Nodes (12): buildClaudePrompt(), ClaudeCodeActionProvider, extractGraphContext(), FIX_WITH_CLAUDE_COMMAND, quoteForShell(), registerFixWithClaude(), DIAGNOSTIC_SOURCE, activate() (+4 more)

### Community 6 - "TypeScript Build Config"
Cohesion: 0.13
Nodes (14): ES2022, node_modules, out, compilerOptions, esModuleInterop, lib, module, outDir (+6 more)

### Community 7 - "Report Parser (IQ/Sonar)"
Cohesion: 0.29
Nodes (10): FindingSource, IqPolicyViolation, IqReport, parseIqReport(), parseReportDir(), parseSonarReport(), readJson(), SonarIssue (+2 more)

### Community 8 - "Dev Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/node, @types/vscode, typescript, @types/node, @types/vscode, typescript

## Knowledge Gaps
- **66 isolated node(s):** `name`, `displayName`, `description`, `version`, `publisher` (+61 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `contributes` connect `VSCode Contribution Points` to `Package Manifest Metadata`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `activate()` (e.g. with `.refreshFromDisk()` and `.update()`) actually correct?**
  _`activate()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `displayName`, `description` to the rest of the system?**
  _66 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `CLI & Markdown Rendering` be split into smaller, more focused modules?**
  _Cohesion score 0.12962962962962962 - nodes in this community are weakly interconnected._
- **Should `Package Manifest Metadata` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `VSCode Contribution Points` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Diagnostics & Tree View` be split into smaller, more focused modules?**
  _Cohesion score 0.12666666666666668 - nodes in this community are weakly interconnected._