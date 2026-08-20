import { type Dirent, existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	fuzzyFilter,
} from "@earendil-works/pi-tui";

const MAX_SUGGESTIONS = 20;
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";
const SKILL_ROOTS = [
	`${HOME}/.pi/agent/skills`,
	`${HOME}/.pi/skills`,
	`${HOME}/.agents/skills`,
	`${HOME}/.claude/skills`,
	`${HOME}/.pi/agent/git`,
];
const SKILL_SCAN_TTL_MS = 30_000;
const MAX_SCAN_DEPTH = 7;
let scannedSkillsCache: SkillCommand[] = [];
let scannedSkillsAt = 0;
const SKILL_TOKEN = /(^|[\s([{])\$([a-z0-9-]*)$/i;
const SUBMITTED_SKILL_TOKEN = /(^|[\s([{])\$([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=$|[\s.,;:!?\])}])/gi;

type SkillCommand = {
	name: string;
	description?: string;
	path?: string;
};

function skillName(commandName: string): string {
	return commandName.startsWith("skill:") ? commandName.slice("skill:".length) : commandName;
}

function parseSkillMetadata(content: string): { name?: string; description?: string } {
	const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const metadata = frontmatter?.[1];
	if (!metadata) return {};

	const readField = (field: string): string | undefined => {
		const match = metadata.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
		return match?.[1]?.replace(/^['\"]|['\"]$/g, "").trim();
	};

	return {
		name: readField("name"),
		description: readField("description"),
	};
}

function addSkillFile(skills: SkillCommand[], path: string, fallbackName: string): void {
	let metadata: { name?: string; description?: string } = {};
	try {
		metadata = parseSkillMetadata(readFileSync(path, "utf8"));
	} catch {}
	skills.push({ name: metadata.name ?? fallbackName, description: metadata.description, path });
}

function scanSkillDir(skills: SkillCommand[], dir: string, depth: number): void {
	if (depth > MAX_SCAN_DEPTH) return;
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	const skillFile = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
	if (skillFile) {
		addSkillFile(skills, join(dir, "SKILL.md"), dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir);
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		scanSkillDir(skills, join(dir, entry.name), depth + 1);
	}
}

function scanSkillFiles(): SkillCommand[] {
	const now = Date.now();
	if (now - scannedSkillsAt < SKILL_SCAN_TTL_MS) return scannedSkillsCache;
	const skills: SkillCommand[] = [];
	for (const root of SKILL_ROOTS) {
		if (!root || !existsSync(root)) continue;
		scanSkillDir(skills, root, 0);
	}
	scannedSkillsCache = skills;
	scannedSkillsAt = now;
	return skills;
}

function getSkills(pi: ExtensionAPI): SkillCommand[] {
	const commandSkills = pi
		.getCommands()
		.filter((command) => command.source === "skill" || command.name.startsWith("skill:"))
		.map((command) => ({
			name: skillName(command.name),
			description: command.description,
			path: command.sourceInfo?.path,
		}));

	const byName = new Map<string, SkillCommand>();
	for (const skill of [...commandSkills, ...scanSkillFiles()]) {
		if (!byName.has(skill.name)) byName.set(skill.name, skill);
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function filterSkills(skills: SkillCommand[], query: string): AutocompleteItem[] {
	const matches = query.trim()
		? fuzzyFilter(skills, query, (skill) => `${skill.name} ${skill.description ?? ""}`)
		: skills;

	return matches.slice(0, MAX_SUGGESTIONS).map((skill) => ({
		value: `$${skill.name}`,
		label: skill.name,
		description: `[skill] ${skill.description ?? "Load this skill"}`,
	}));
}

function createDollarSkillProvider(pi: ExtensionAPI, current: AutocompleteProvider): AutocompleteProvider {
	return {
		triggerCharacters: ["$", ...(current.triggerCharacters ?? [])],

		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			const match = beforeCursor.match(SKILL_TOKEN);
			if (!match) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const query = match[2] ?? "";
			try {
				const suggestions = filterSkills(getSkills(pi), query);
				if (options.signal.aborted || suggestions.length === 0) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				return {
					prefix: `$${query}`,
					items: suggestions,
				};
			} catch {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (prefix.startsWith("$")) {
				const currentLine = lines[cursorLine] ?? "";
				const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
				const afterCursor = currentLine.slice(cursorCol);
				const suffix = afterCursor.startsWith(" ") ? "" : " ";
				const newLines = [...lines];
				newLines[cursorLine] = `${beforePrefix}${item.value}${suffix}${afterCursor}`;
				return {
					lines: newLines,
					cursorLine,
					cursorCol: beforePrefix.length + item.value.length + suffix.length,
				};
			}

			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

function requestedSkillNames(text: string): string[] {
	const names: string[] = [];
	for (const match of text.matchAll(SUBMITTED_SKILL_TOKEN)) {
		const name = match[2];
		if (name && !names.includes(name)) names.push(name);
	}
	return names;
}

async function loadSkill(skill: SkillCommand): Promise<string> {
	if (!skill.path) {
		return `<skill name="${skill.name}">\n${skill.description ?? ""}\n</skill>`;
	}

	const content = await readFile(skill.path, "utf8");
	return `<skill name="${skill.name}" location="${skill.path}">\n${content.trim()}\n</skill>`;
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => createDollarSkillProvider(pi, current));
		try {
			ctx.ui.notify(`$skill autocomplete loaded (${getSkills(pi).length} skills)`, "info");
		} catch {
			ctx.ui.notify("$skill autocomplete loaded", "info");
		}
	});

	pi.on("input", async (event) => {
		if (event.source === "extension" || event.text.startsWith("/skill:")) {
			return { action: "continue" as const };
		}

		const names = requestedSkillNames(event.text);
		if (names.length === 0) return { action: "continue" as const };

		const skillsByName = new Map(getSkills(pi).map((skill) => [skill.name, skill]));
		const selectedSkills = names.map((name) => skillsByName.get(name)).filter((skill): skill is SkillCommand => Boolean(skill));
		if (selectedSkills.length === 0) return { action: "continue" as const };

		const blocks = await Promise.all(selectedSkills.map(loadSkill));
		const text = `${blocks.join("\n\n")}\n\nUser message:\n${event.text.trim()}`;

		return { action: "transform" as const, text };
	});
}
