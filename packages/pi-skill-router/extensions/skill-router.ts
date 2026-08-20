import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

// pi-skill-router
// Token-efficient skill architecture for Pi:
// 1. Hide SKILL.md metadata from the model prompt with `disable-model-invocation: true`.
// 2. Keep manual `/skill:name` commands usable (documented Pi behavior).
// 3. Give the model retrieval tools: `skill_search` and `skill_read`.
// 4. Fail open: never break normal Pi startup or user commands.

type SkillLike = {
  name: string;
  description: string;
  filePath: string;
  baseDir?: string;
  source?: string;
  hidden?: boolean;
};

type PatchResult = {
  discovered: number;
  changed: number;
  skipped: number;
  errors: Array<{ path: string; error: string }>;
  backupDir?: string;
};

const HOME = process.env.HOME ?? "";
const ROOTS = [
  `${HOME}/.pi/agent/skills`,
  `${HOME}/.agents/skills`,
  `${HOME}/.claude/skills`,
  `${HOME}/.pi/agent/git/github.com/davebcn87/pi-autoresearch`,
  `${HOME}/.pi/agent/git/github.com/tmustier/pi-extensions`,
  `${HOME}/.nvm/versions/node/v22.19.0/lib/node_modules/pi-exa-search`,
  `${HOME}/.nvm/versions/node/v22.19.0/lib/node_modules/pi-ask-user`,
  `${HOME}/.nvm/versions/node/v22.19.0/lib/node_modules/context-mode`,
  `${HOME}/.nvm/versions/node/v22.19.0/lib/node_modules/pi-subagents`,
  `${HOME}/.nvm/versions/node/v22.19.0/lib/node_modules/@aliou/pi-processes`,
].filter(Boolean);

const BACKUP_ROOT = `${HOME}/.pi/agent/skill-router-backups`;

let skillsCache: SkillLike[] = [];
let lastScan = 0;

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function walkSkillFiles(root: string, out: string[]) {
  if (!existsSync(root)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (entry === ".git" || entry === "node_modules" || entry.includes("backup")) continue;
    const skill = join(path, "SKILL.md");
    if (existsSync(skill)) out.push(skill);
    walkSkillFiles(path, out);
  }
}

function discoverSkillFiles(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) walkSkillFiles(root, files);
  return Array.from(new Set(files)).sort();
}

function parseFrontmatter(text: string): { front: string; body: string; data: Record<string, string> } | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const front = text.slice(4, end);
  const body = text.slice(end);
  const data: Record<string, string> = {};
  for (const line of front.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    data[m[1]] = m[2].replace(/^['\"]|['\"]$/g, "").trim();
  }
  return { front, body, data };
}

function scanSkills(force = false): SkillLike[] {
  const now = Date.now();
  if (!force && skillsCache.length > 0 && now - lastScan < 30_000) return skillsCache;

  const seenNames = new Set<string>();
  const skills: SkillLike[] = [];
  for (const filePath of discoverSkillFiles()) {
    try {
      const text = readFileSync(filePath, "utf8");
      const parsed = parseFrontmatter(text);
      const name = parsed?.data.name;
      const description = parsed?.data.description;
      if (!name || !description || seenNames.has(name)) continue;
      seenNames.add(name);
      skills.push({
        name,
        description,
        filePath,
        baseDir: dirname(filePath),
        hidden: parsed?.data["disable-model-invocation"] === "true",
      });
    } catch {
      // Ignore broken skills. Pi's own validator can report them separately.
    }
  }
  skillsCache = skills;
  lastScan = now;
  return skillsCache;
}

function scoreSkill(skill: SkillLike, query: string): number {
  const terms = normalize(query).split(/[^a-z0-9-]+/).filter(Boolean);
  const name = normalize(skill.name);
  const desc = normalize(skill.description);
  let score = 0;
  for (const term of terms) {
    if (name === term) score += 60;
    else if (name.includes(term)) score += 25;
    if (desc.includes(term)) score += 6;
  }
  return score;
}

function hideOneSkillFrontmatter(text: string): { text: string; changed: boolean; reason?: string } {
  const parsed = parseFrontmatter(text);
  if (!parsed) return { text, changed: false, reason: "missing or invalid frontmatter" };

  const lines = parsed.front.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("disable-model-invocation:")) {
      if (lines[i].trim() === "disable-model-invocation: true") return { text, changed: false, reason: "already hidden" };
      lines[i] = "disable-model-invocation: true";
      return { text: `---\n${lines.join("\n")}${parsed.body}`, changed: true };
    }
  }

  let insertAt = lines.length;
  const metadataIndex = lines.findIndex((line) => line.trim().startsWith("metadata:"));
  if (metadataIndex >= 0) insertAt = metadataIndex;
  lines.splice(insertAt, 0, "disable-model-invocation: true");
  return { text: `---\n${lines.join("\n")}${parsed.body}`, changed: true };
}

function hideCatalog(): PatchResult {
  const files = discoverSkillFiles();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const backupDir = join(BACKUP_ROOT, stamp);
  const result: PatchResult = { discovered: files.length, changed: 0, skipped: 0, errors: [], backupDir };

  for (const file of files) {
    try {
      const oldText = readFileSync(file, "utf8");
      const patched = hideOneSkillFrontmatter(oldText);
      if (!patched.changed) {
        result.skipped++;
        continue;
      }
      const backupPath = join(backupDir, relative(HOME, file));
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(file, backupPath);
      writeFileSync(file, patched.text, "utf8");
      result.changed++;
    } catch (error) {
      result.errors.push({ path: file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  scanSkills(true);
  return result;
}

function latestBackupDir(): string | undefined {
  if (!existsSync(BACKUP_ROOT)) return undefined;
  const dirs = readdirSync(BACKUP_ROOT)
    .map((name) => join(BACKUP_ROOT, name))
    .filter((path) => {
      try { return statSync(path).isDirectory(); } catch { return false; }
    })
    .sort();
  return dirs.at(-1);
}

function restoreLatestBackup(): PatchResult {
  const backupDir = latestBackupDir();
  const result: PatchResult = { discovered: 0, changed: 0, skipped: 0, errors: [], backupDir };
  if (!backupDir) {
    result.errors.push({ path: BACKUP_ROOT, error: "No backup directory found" });
    return result;
  }

  const backupFiles: string[] = [];
  const walk = (root: string) => {
    for (const entry of readdirSync(root)) {
      const path = join(root, entry);
      if (entry === "manifest.json") continue;
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else if (entry === "SKILL.md") backupFiles.push(path);
    }
  };
  walk(backupDir);
  result.discovered = backupFiles.length;

  for (const backup of backupFiles) {
    const original = join(HOME, relative(backupDir, backup));
    try {
      mkdirSync(dirname(original), { recursive: true });
      copyFileSync(backup, original);
      result.changed++;
    } catch (error) {
      result.errors.push({ path: original, error: error instanceof Error ? error.message : String(error) });
    }
  }

  try { renameSync(backupDir, `${backupDir}.restored`); } catch { /* best effort */ }
  scanSkills(true);
  return result;
}

function compactSkillPrompt(systemPrompt: string): string {
  const replacement = `
Skills are available on demand, but the full skill catalog is intentionally hidden to reduce token cost.
Use skill_search(query) when a task may benefit from a specialized skill, then skill_read(name) for one selected skill.
Users can still invoke skills manually with /skill:name.
`;
  const withIntro = /\n?The following skills provide specialized instructions[\s\S]*?<\/available_skills>\n?/m;
  if (withIntro.test(systemPrompt)) return systemPrompt.replace(withIntro, `\n${replacement}\n`);
  const xmlOnly = /\n?<available_skills>[\s\S]*?<\/available_skills>\n?/m;
  if (xmlOnly.test(systemPrompt)) return systemPrompt.replace(xmlOnly, `\n${replacement}\n`);
  return systemPrompt;
}

function statusText(): string {
  const skills = scanSkills(true);
  const hidden = skills.filter((s) => s.hidden).length;
  return [
    `pi-skill-router status`,
    `discovered skills: ${skills.length}`,
    `hidden from model prompt: ${hidden}`,
    `visible in model prompt: ${skills.length - hidden}`,
    `manual /skill:name commands should remain available for hidden skills`,
  ].join("\n");
}

export default function skillRouter(pi: ExtensionAPI) {
  scanSkills(true);

  pi.registerCommand("skill-router-status", {
    description: "Show pi-skill-router skill catalog status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(statusText(), "info");
    },
  });

  pi.registerCommand("skill-router-hide", {
    description: "Hide discovered skills from model prompt while preserving /skill:name commands",
    handler: async (_args, ctx) => {
      const result = hideCatalog();
      ctx.ui.notify(`skill-router-hide changed ${result.changed}/${result.discovered} skills; skipped ${result.skipped}; errors ${result.errors.length}. Run /reload.`, result.errors.length ? "warning" : "info");
    },
  });

  pi.registerCommand("skill-router-restore", {
    description: "Restore latest skill frontmatter backup created by /skill-router-hide",
    handler: async (_args, ctx) => {
      const result = restoreLatestBackup();
      ctx.ui.notify(`skill-router-restore restored ${result.changed}/${result.discovered} skills; errors ${result.errors.length}. Run /reload.`, result.errors.length ? "warning" : "info");
    },
  });

  pi.registerTool({
    name: "skill_search",
    label: "Search Skills",
    description: "Search installed Pi skills by name/description without injecting the full skill catalog into the prompt.",
    parameters: Type.Object({
      query: Type.String({ description: "Task intent or keywords, e.g. debug react tests" }),
      limit: Type.Optional(Type.Number({ description: "Max matches, 1-20", minimum: 1, maximum: 20 })),
    }),
    async execute(_id, params) {
      const query = String((params as any).query ?? "");
      const limit = Math.max(1, Math.min(20, Number((params as any).limit ?? 8)));
      const matches = scanSkills()
        .map((skill) => ({ skill, score: scoreSkill(skill, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
        .slice(0, limit)
        .map(({ skill, score }) => ({ name: skill.name, description: skill.description, path: skill.filePath, hidden: skill.hidden, score }));
      return { content: [{ type: "text", text: JSON.stringify({ query, matches }, null, 2) }], details: { query, count: matches.length } };
    },
  });

  pi.registerTool({
    name: "skill_read",
    label: "Read Skill",
    description: "Read one installed Pi skill SKILL.md by exact name returned from skill_search.",
    parameters: Type.Object({ name: Type.String({ description: "Exact skill name" }) }),
    async execute(_id, params) {
      const name = String((params as any).name ?? "");
      const skill = scanSkills().find((s) => s.name === name);
      if (!skill) return { content: [{ type: "text", text: `Skill not found: ${name}` }], details: { found: false, name, path: undefined as string | undefined } };
      const text = readFileSync(skill.filePath, "utf8");
      return { content: [{ type: "text", text: `# Skill: ${name}\nPath: ${skill.filePath}\n\n${text}` }], details: { found: true, name, path: skill.filePath } };
    },
  });

  pi.on("session_start", async () => {
    scanSkills(true);
  });

  pi.on("before_agent_start", async (event) => {
    try {
      scanSkills();
      return { systemPrompt: compactSkillPrompt(event.systemPrompt) };
    } catch {
      return {}; // fail open
    }
  });
}
