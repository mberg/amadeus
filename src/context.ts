// ABOUTME: Manages the .context directory for cross-agent knowledge sharing.
// ABOUTME: Provides functions to save, search, and retrieve accumulated learnings.

import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

export interface KnowledgeEntry {
  title: string;
  content: string;
  tags: string[];
  sourceIssue?: string;
}

export interface IssueSummary {
  identifier: string;
  title: string;
  outcome: string;
  keyLearnings: string[];
  filesModified: string[];
  relatedIssues?: string[];
}

export interface DebugArtifact {
  title: string;
  symptom: string;
  rootCause: string;
  solution: string;
  sourceIssue?: string;
}

export interface SearchResult {
  type: "knowledge" | "issue" | "debug";
  title: string;
  path: string;
  snippet: string;
}

export interface ContextSummary {
  knowledgeCount: number;
  issueCount: number;
  debugCount: number;
  knowledgeTitles: string[];
  issueSummaries: string[];
}

export interface SearchOptions {
  limit?: number;
}

const CONTEXT_DIR = ".context";
const KNOWLEDGE_DIR = "knowledge";
const ISSUES_DIR = "issues";
const DEBUG_DIR = "debug";

export async function ensureContextDir(projectPath: string): Promise<void> {
  const contextPath = join(projectPath, CONTEXT_DIR);

  await mkdir(join(contextPath, KNOWLEDGE_DIR), { recursive: true });
  await mkdir(join(contextPath, ISSUES_DIR), { recursive: true });
  await mkdir(join(contextPath, DEBUG_DIR), { recursive: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatKnowledgeMarkdown(entry: KnowledgeEntry): string {
  const lines: string[] = [];

  lines.push(`# ${entry.title}`);
  lines.push("");
  lines.push(`tags: ${entry.tags.join(", ")}`);
  if (entry.sourceIssue) {
    lines.push(`source: ${entry.sourceIssue}`);
  }
  lines.push(`created: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(entry.content);

  return lines.join("\n");
}

function formatIssueSummaryMarkdown(summary: IssueSummary): string {
  const lines: string[] = [];

  lines.push(`# ${summary.identifier}: ${summary.title}`);
  lines.push("");
  lines.push(`completed: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Outcome");
  lines.push("");
  lines.push(summary.outcome);
  lines.push("");

  if (summary.keyLearnings.length > 0) {
    lines.push("## Key Learnings");
    lines.push("");
    for (const learning of summary.keyLearnings) {
      lines.push(`- ${learning}`);
    }
    lines.push("");
  }

  if (summary.filesModified.length > 0) {
    lines.push("## Files Modified");
    lines.push("");
    for (const file of summary.filesModified) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (summary.relatedIssues && summary.relatedIssues.length > 0) {
    lines.push("## Related Issues");
    lines.push("");
    for (const issue of summary.relatedIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatDebugArtifactMarkdown(artifact: DebugArtifact): string {
  const lines: string[] = [];

  lines.push(`# ${artifact.title}`);
  lines.push("");
  if (artifact.sourceIssue) {
    lines.push(`source: ${artifact.sourceIssue}`);
  }
  lines.push(`created: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Symptom");
  lines.push("");
  lines.push(artifact.symptom);
  lines.push("");
  lines.push("## Root Cause");
  lines.push("");
  lines.push(artifact.rootCause);
  lines.push("");
  lines.push("## Solution");
  lines.push("");
  lines.push(artifact.solution);

  return lines.join("\n");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).text();
    return true;
  } catch {
    return false;
  }
}

export async function saveKnowledge(
  projectPath: string,
  entry: KnowledgeEntry
): Promise<string> {
  const knowledgePath = join(projectPath, CONTEXT_DIR, KNOWLEDGE_DIR);
  let filename = `${slugify(entry.title)}.md`;
  let filePath = join(knowledgePath, filename);

  // Handle duplicate filenames by appending timestamp
  if (await fileExists(filePath)) {
    const timestamp = Date.now();
    filename = `${slugify(entry.title)}-${timestamp}.md`;
    filePath = join(knowledgePath, filename);
  }

  const content = formatKnowledgeMarkdown(entry);
  await Bun.write(filePath, content);

  return filePath;
}

export async function saveIssueSummary(
  projectPath: string,
  summary: IssueSummary
): Promise<string> {
  const issuesPath = join(projectPath, CONTEXT_DIR, ISSUES_DIR);
  const filePath = join(issuesPath, `${summary.identifier}.md`);

  const content = formatIssueSummaryMarkdown(summary);
  await Bun.write(filePath, content);

  return filePath;
}

export async function saveDebugArtifact(
  projectPath: string,
  artifact: DebugArtifact
): Promise<string> {
  const debugPath = join(projectPath, CONTEXT_DIR, DEBUG_DIR);
  let filename = `${slugify(artifact.title)}.md`;
  let filePath = join(debugPath, filename);

  // Handle duplicate filenames by appending timestamp
  if (await fileExists(filePath)) {
    const timestamp = Date.now();
    filename = `${slugify(artifact.title)}-${timestamp}.md`;
    filePath = join(debugPath, filename);
  }

  const content = formatDebugArtifactMarkdown(artifact);
  await Bun.write(filePath, content);

  return filePath;
}

async function searchInDirectory(
  dirPath: string,
  query: string,
  type: "knowledge" | "issue" | "debug"
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  try {
    const files = await readdir(dirPath);

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = join(dirPath, file);
      const content = await readFile(filePath, "utf-8");
      const contentLower = content.toLowerCase();

      if (contentLower.includes(queryLower)) {
        // Extract title from first line
        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch ? titleMatch[1] : basename(file, ".md");

        // Extract snippet around the match
        const matchIndex = contentLower.indexOf(queryLower);
        const snippetStart = Math.max(0, matchIndex - 50);
        const snippetEnd = Math.min(content.length, matchIndex + query.length + 50);
        const snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, " ").trim();

        results.push({
          type,
          title,
          path: filePath,
          snippet: snippet.length > 100 ? `...${snippet}...` : snippet,
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return results;
}

export async function searchContext(
  projectPath: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const contextPath = join(projectPath, CONTEXT_DIR);

  const knowledgeResults = await searchInDirectory(
    join(contextPath, KNOWLEDGE_DIR),
    query,
    "knowledge"
  );

  const issueResults = await searchInDirectory(
    join(contextPath, ISSUES_DIR),
    query,
    "issue"
  );

  const debugResults = await searchInDirectory(
    join(contextPath, DEBUG_DIR),
    query,
    "debug"
  );

  let allResults = [...knowledgeResults, ...issueResults, ...debugResults];

  if (options.limit && options.limit > 0) {
    allResults = allResults.slice(0, options.limit);
  }

  return allResults;
}

async function countFilesInDir(dirPath: string): Promise<number> {
  try {
    const files = await readdir(dirPath);
    return files.filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

async function getTitlesFromDir(dirPath: string): Promise<string[]> {
  const titles: string[] = [];

  try {
    const files = await readdir(dirPath);

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = join(dirPath, file);
      const content = await readFile(filePath, "utf-8");

      const titleMatch = content.match(/^# (.+)$/m);
      if (titleMatch) {
        titles.push(titleMatch[1]);
      } else {
        titles.push(basename(file, ".md"));
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return titles;
}

async function getIssueIdentifiersFromDir(dirPath: string): Promise<string[]> {
  try {
    const files = await readdir(dirPath);
    return files.filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md"));
  } catch {
    return [];
  }
}

export async function getContextSummary(projectPath: string): Promise<ContextSummary> {
  const contextPath = join(projectPath, CONTEXT_DIR);

  const knowledgeCount = await countFilesInDir(join(contextPath, KNOWLEDGE_DIR));
  const issueCount = await countFilesInDir(join(contextPath, ISSUES_DIR));
  const debugCount = await countFilesInDir(join(contextPath, DEBUG_DIR));

  const knowledgeTitles = await getTitlesFromDir(join(contextPath, KNOWLEDGE_DIR));
  const issueSummaries = await getIssueIdentifiersFromDir(join(contextPath, ISSUES_DIR));

  return {
    knowledgeCount,
    issueCount,
    debugCount,
    knowledgeTitles,
    issueSummaries,
  };
}
