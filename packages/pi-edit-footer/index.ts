import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type FooterColor = "default" | "muted" | "accent" | "success" | "warning" | "error";

type FooterItem = {
    id: string;
    text: string;
    enabled: boolean;
    color: FooterColor;
};

type SeenStatus = {
    id: string;
    lastText?: string;
    source: "seen" | "known" | "custom";
    firstSeenAt: number;
    lastSeenAt: number;
};

type FooterConfig = {
    items: FooterItem[];
    hiddenIds: string[];
    seen: SeenStatus[];
    textFilters: Record<string, string[]>;
    segmentLimits: Record<string, number>;
};

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "edit-footer.json");
// Keep user rules in a separate file so an older already-running extension
// cannot overwrite them when several Pi sessions share this extension.
const RULES_PATH = path.join(os.homedir(), ".pi", "agent", "edit-footer-rules.json");
const LEGACY_CLIP_PREFIX = "__pi_edit_footer_clip__:";
const COLORS: FooterColor[] = ["default", "muted", "accent", "success", "warning", "error"];

// Pi does not expose a public API to enumerate the current footer registry.
// We seed common ids, then learn any ids that flow through ctx.ui.setStatus.
const COMMON_STATUS_IDS = [
    "codex",
    "codex-adapter",
    "pi-codex-conversion",
    "thinking",
    "model",
    "mcp",
    "todo",
    "goals",
    "goal",
    "telegram",
    "processes",
    "subagents",
    "vcc",
    "memctx",
    "edit-footer",
];

function now(): number {
    return Date.now();
}

function defaultSeen(): SeenStatus[] {
    const timestamp = now();
    return COMMON_STATUS_IDS.map((id) => ({
        id,
        source: "known" as const,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
    }));
}

const DEFAULT_CONFIG: FooterConfig = {
    items: [
        {
            id: "edit-footer",
            text: "footer editable",
            enabled: false,
            color: "muted",
        },
    ],
    hiddenIds: [],
    seen: defaultSeen(),
    textFilters: {},
    segmentLimits: {},
};

function dedupeById<T extends { id: string }>(items: T[]): T[] {
    const merged = new Map<string, T>();
    for (const item of items) {
        if (!item.id) continue;
        merged.set(item.id, { ...merged.get(item.id), ...item });
    }
    return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeConfig(raw: Partial<FooterConfig> | undefined): FooterConfig {
    const rawTextFilters = Object.entries((raw as { textFilters?: Record<string, unknown> } | undefined)?.textFilters ?? {}).filter(
        ([id, filters]) => typeof id === "string" && Array.isArray(filters),
    );
    const legacySegmentLimits = Object.fromEntries(
        rawTextFilters.flatMap(([id, filters]) => {
            const marker = (filters as unknown[]).find((filter) => typeof filter === "string" && filter.startsWith(LEGACY_CLIP_PREFIX));
            const limit = marker === undefined ? NaN : Number((marker as string).slice(LEGACY_CLIP_PREFIX.length));
            return Number.isInteger(limit) && limit > 0 ? [[id, limit]] : [];
        }),
    );
    const rawSegmentLimits = (raw as { segmentLimits?: Record<string, unknown> } | undefined)?.segmentLimits ?? {};

    return {
        items: dedupeById(
            Array.isArray(raw?.items)
                ? raw.items
                      .filter((item) => item && typeof item.id === "string")
                      .map((item) => ({
                          id: item.id,
                          text: typeof item.text === "string" ? item.text : "",
                          enabled: item.enabled !== false,
                          color: COLORS.includes(item.color as FooterColor) ? (item.color as FooterColor) : "default",
                      }))
                : DEFAULT_CONFIG.items,
        ),
        hiddenIds: [...new Set(Array.isArray(raw?.hiddenIds) ? raw.hiddenIds.filter((id) => typeof id === "string") : [])],
        textFilters: Object.fromEntries(
            rawTextFilters.map(([id, filters]) => [
                id,
                [
                    ...new Set(
                        (filters as unknown[]).filter(
                            (filter): filter is string =>
                                typeof filter === "string" && filter.length > 0 && !filter.startsWith(LEGACY_CLIP_PREFIX),
                        ),
                    ),
                ],
            ]),
        ) as Record<string, string[]>, 
        segmentLimits: Object.fromEntries(
            [...Object.entries(rawSegmentLimits), ...Object.entries(legacySegmentLimits)].filter(
                ([id, limit]) => typeof id === "string" && Number.isInteger(limit) && (limit as number) > 0,
            ),
        ) as Record<string, number>,
        seen: dedupeById([
            ...defaultSeen(),
            ...(Array.isArray(raw?.seen)
                ? raw.seen
                      .filter((item) => item && typeof item.id === "string")
                      .map((item) => ({
                          id: item.id,
                          lastText: typeof item.lastText === "string" ? item.lastText : undefined,
                          source: item.source === "custom" || item.source === "seen" || item.source === "known" ? item.source : "seen",
                          firstSeenAt: typeof item.firstSeenAt === "number" ? item.firstSeenAt : now(),
                          lastSeenAt: typeof item.lastSeenAt === "number" ? item.lastSeenAt : now(),
                      }))
                : []),
        ]),
    };
}

type PersistedRules = Pick<FooterConfig, "items" | "hiddenIds" | "textFilters" | "segmentLimits">;

// Status updates are frequent. Keep the merged configuration in memory so
// every footer repaint does not synchronously read and rewrite JSON files.
let configCache: FooterConfig | undefined;

function readJson(filePath: string): Record<string, unknown> | undefined {
    try {
        if (!fs.existsSync(filePath)) return undefined;
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
}

function readConfig(): FooterConfig {
    if (configCache) return configCache;

    const raw = readJson(CONFIG_PATH);
    const rules = readJson(RULES_PATH);
    // RULES_PATH is authoritative for user changes. It is intentionally not
    // written by older versions of this extension, preventing stale sessions
    // from resurrecting hidden or filtered footer entries.
    configCache = normalizeConfig({
        ...(raw ?? {}),
        ...(rules ?? {}),
    } as Partial<FooterConfig>);
    return configCache;
}

function writeConfig(config: FooterConfig): void {
    const normalized = normalizeConfig(config);
    configCache = normalized;
    const rules: PersistedRules = {
        items: normalized.items,
        hiddenIds: normalized.hiddenIds,
        textFilters: normalized.textFilters,
        segmentLimits: normalized.segmentLimits,
    };
    writeJsonAtomic(RULES_PATH, rules);

    // Older edit-footer instances may still write the config during the same
    // process. Keep a harmless marker in textFilters so they do not discard
    // segmentLimits before /reload loads this version.
    const persistedFilters = Object.fromEntries(
        Object.entries(normalized.textFilters).map(([id, filters]) => [id, [...filters]]),
    ) as Record<string, string[]>;
    for (const [id, limit] of Object.entries(normalized.segmentLimits)) {
        persistedFilters[id] = [...new Set([...(persistedFilters[id] ?? []), `${LEGACY_CLIP_PREFIX}${limit}`])];
    }
    writeJsonAtomic(CONFIG_PATH, { ...normalized, textFilters: persistedFilters });
}

function plainText(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value).replace(/\x1b\[[0-9;]*m/g, "");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyTextFilters(id: string, value: unknown, config = readConfig()): unknown {
    if (value === undefined || value === null) return value;
    const filters = config.textFilters[id] ?? [];
    const segmentLimit = config.segmentLimits[id];
    if (filters.length === 0 && segmentLimit === undefined) return value;

    let text = String(value);
    for (const filter of filters) {
        if (!filter) continue;
        text = text.replace(new RegExp(escapeRegExp(filter), "g"), "");
    }

    // Clean up common footer separators left behind by hidden words/phrases.
    text = text
        .replace(/\s*[·•]\s*[·•]\s*/g, " · ")
        .replace(/^\s*[·•]\s*/g, "")
        .replace(/\s*[·•]\s*$/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();

    // Clip dynamic statuses by separator-delimited parts, so changing counts,
    // paths, or other later segments cannot make hidden content reappear.
    if (segmentLimit !== undefined) {
        text = splitFooterSegments(text).slice(0, segmentLimit).join(" · ");
    }
    return text || undefined;
}

function splitFooterSegments(text: string): string[] {
    return text
        .split(/\s+[·•]\s+/g)
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function isSegmentFiltered(id: string, segment: string, config = readConfig()): boolean {
    return (config.textFilters[id] ?? []).includes(segment);
}

function rememberStatus(id: string, value: unknown, source: SeenStatus["source"] = "seen"): void {
    if (!id) return;
    const config = readConfig();
    const timestamp = now();
    const existing = config.seen.find((item) => item.id === id);
    const text = plainText(value);
    if (existing) {
        existing.lastSeenAt = timestamp;
        if (text !== undefined) existing.lastText = text;
        if (existing.source === "known") existing.source = source;
    } else {
        config.seen.push({ id, source, firstSeenAt: timestamp, lastSeenAt: timestamp, lastText: text });
    }
    // Do not persist on every status repaint. Explicit /edit-footer mutations
    // still call writeConfig(); transient status metadata remains in memory.
}

function colorize(ctx: ExtensionContext, item: FooterItem): string {
    if (item.color === "default") return item.text;
    return ctx.ui.theme.fg(item.color, item.text);
}

function setStatusRaw(ctx: ExtensionContext, id: string, value: unknown): void {
    const ui = ctx.ui as typeof ctx.ui & { __editFooterOriginalSetStatus?: typeof ctx.ui.setStatus };
    const setStatus = ui.__editFooterOriginalSetStatus ? ui.__editFooterOriginalSetStatus.bind(ctx.ui) : ctx.ui.setStatus.bind(ctx.ui);
    setStatus(id, value as never);
}

function renderTrackedStatus(ctx: ExtensionContext, id: string, config = readConfig()): void {
    if (config.hiddenIds.includes(id)) {
        setStatusRaw(ctx, id, undefined);
        return;
    }
    const item = config.items.find((entry) => entry.id === id);
    if (item) {
        setStatusRaw(ctx, id, item.enabled && item.text ? colorize(ctx, item) : undefined);
        return;
    }
    const lastText = config.seen.find((entry) => entry.id === id)?.lastText;
    if (lastText !== undefined && ((config.textFilters[id] ?? []).length > 0 || config.segmentLimits[id] !== undefined)) {
        setStatusRaw(ctx, id, applyTextFilters(id, lastText, config));
    }
}

function applyFooter(ctx: ExtensionContext, config = readConfig()): void {
    const ids = new Set([
        ...config.hiddenIds,
        ...config.items.map((item) => item.id),
        ...Object.keys(config.textFilters).filter((id) => (config.textFilters[id] ?? []).length > 0),
        ...Object.keys(config.segmentLimits),
    ]);
    for (const id of ids) renderTrackedStatus(ctx, id, config);
}

function installStatusTracker(ctx: ExtensionContext): void {
    const ui = ctx.ui as typeof ctx.ui & {
        __editFooterPatched?: boolean;
        __editFooterOriginalSetStatus?: typeof ctx.ui.setStatus;
    };
    if (ui.__editFooterPatched) return;

    const original = ui.setStatus.bind(ctx.ui);
    ui.__editFooterOriginalSetStatus = original as typeof ctx.ui.setStatus;
    ui.__editFooterPatched = true;

    ui.setStatus = ((id: string, value: unknown) => {
        rememberStatus(id, value, "seen");
        const config = readConfig();
        if (config.hiddenIds.includes(id)) return original(id, undefined as never);
        return original(id, applyTextFilters(id, value, config) as never);
    }) as typeof ctx.ui.setStatus;
}

function setup(ctx: ExtensionContext): void {
    installStatusTracker(ctx);
    applyFooter(ctx);
}

function parseArgs(input: string): string[] {
    const args: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(input))) args.push(match[1] ?? match[2] ?? match[3] ?? "");
    return args;
}

function summarize(config = readConfig()): string {
    const custom = config.items.length
        ? config.items.map((item) => `${item.enabled ? "●" : "○"} ${item.id}: ${item.text || "<empty>"}`).join("\n")
        : "No custom footer items.";
    const hidden = config.hiddenIds.length ? `Hidden entries: ${config.hiddenIds.join(", ")}` : "Hidden entries: none";
    const filtered = Object.entries(config.textFilters).filter(([, filters]) => filters.length > 0);
    const filters = filtered.length ? `Word/phrase filters: ${filtered.map(([id, values]) => `${id}=[${values.join(", ")}]`).join("; ")}` : "Word/phrase filters: none";
    const clipped = Object.entries(config.segmentLimits);
    const clips = clipped.length ? `Segment clips: ${clipped.map(([id, count]) => `${id}=first ${count}`).join("; ")}` : "Segment clips: none";
    const seen = config.seen.length ? `Seen/known entries: ${config.seen.map((item) => item.id).join(", ")}` : "Seen/known entries: none";
    return `${custom}\n${hidden}\n${filters}\n${clips}\n${seen}`;
}

function help(ctx: ExtensionCommandContext): void {
    ctx.ui.notify(
        [
            "edit-footer:",
            "/edit-footer              open interactive menu",
            "/edit-footer menu         open interactive menu",
            "/edit-footer list         list known/custom/hidden ids",
            "/edit-footer set <id> <text>",
            "/edit-footer on <id>",
            "/edit-footer off <id>",
            "/edit-footer hide <id>    hide one whole footer entry by id",
            "/edit-footer unhide <id>",
            "/edit-footer segments <id>         toggle · separated pieces inside an entry",
            "/edit-footer filter <id> <phrase>    hide one word/phrase inside an entry",
            "/edit-footer unfilter <id> <phrase>",
            "/edit-footer clip <id> <count>          show only the first N · separated parts",
            "/edit-footer unclip <id>                show all parts again",
            "/edit-footer remove <id>  remove custom item or persistently hide external item",
            "/edit-footer clear        remove custom items and persistently hide seen external entries",
            "/edit-footer json         show config path and JSON",
        ].join("\n"),
        "info",
    );
}

function allKnownIds(config = readConfig()): string[] {
    return [...new Set([...config.seen.map((item) => item.id), ...config.items.map((item) => item.id), ...config.hiddenIds])].sort();
}

async function openMenu(ctx: ExtensionCommandContext): Promise<void> {
    setup(ctx);
    for (;;) {
        const config = readConfig();
        const customIds = new Set(config.items.map((item) => item.id));
        const choices = [
            "➕ Add custom footer item",
            "📋 List config",
            "🧹 Clear edit-footer config",
            ...allKnownIds(config).map((id) => {
                const seen = config.seen.find((item) => item.id === id);
                const isHidden = config.hiddenIds.includes(id);
                const kind = customIds.has(id) ? "custom" : "external";
                const text = seen?.lastText ? ` — ${seen.lastText}` : "";
                return `${isHidden ? "✗ hidden" : "✓ shown"} ${id} (${kind})${text}`;
            }),
            "Done",
        ];

        const choice = await ctx.ui.select("Edit footer/status bar", choices);
        if (!choice || choice === "Done") return;

        if (choice === "📋 List config") {
            ctx.ui.notify(summarize(), "info");
            continue;
        }

        if (choice === "🧹 Clear edit-footer config") {
            const ok = await ctx.ui.confirm(
                "Clear edit-footer config?",
                "This removes custom items and persistently hides currently seen external entries until you show them again.",
            );
            if (ok) {
                const latest = readConfig();
                const next = clearConfig(latest);
                writeConfig(next);
                applyFooter(ctx, next);
                ctx.ui.notify("edit-footer cleared; seen external entries will stay hidden after reload/restart", "info");
            }
            continue;
        }

        if (choice === "➕ Add custom footer item") {
            const id = await ctx.ui.input("Footer id", "Example: my-note");
            if (!id) continue;
            const text = await ctx.ui.input("Footer text", "Text shown in bottom bar");
            if (!text) continue;
            const color = (await ctx.ui.select("Color", COLORS)) as FooterColor | undefined;
            const config = readConfig();
            const item: FooterItem = { id, text, enabled: true, color: color ?? "default" };
            const index = config.items.findIndex((entry) => entry.id === id);
            if (index >= 0) config.items[index] = item;
            else config.items.push(item);
            config.hiddenIds = config.hiddenIds.filter((hiddenId) => hiddenId !== id);
            rememberStatus(id, text, "custom");
            writeConfig(config);
            applyFooter(ctx, config);
            continue;
        }

        const id = choice.replace(/^(✓ shown|✗ hidden)\s+/, "").split(" ")[0];
        if (id) await editOne(ctx, id);
    }
}

async function editSegments(ctx: ExtensionCommandContext, id: string): Promise<void> {
    for (;;) {
        const config = readConfig();
        const lastText = config.seen.find((item) => item.id === id)?.lastText;
        if (!lastText) {
            ctx.ui.notify(`${id} has no captured text yet. Wait for it to render, then reopen /edit-footer.`, "warning");
            return;
        }
        const segments = splitFooterSegments(lastText);
        if (segments.length <= 1) {
            ctx.ui.notify(`${id} does not look like a multi-segment entry. Use Hide word/phrase instead.`, "info");
            return;
        }
        const choices = [
            ...segments.map((segment) => `${isSegmentFiltered(id, segment, config) ? "✗ hidden" : "✓ shown"} ${segment}`),
            "Back",
        ];
        const choice = await ctx.ui.select(`Toggle segments in ${id}`, choices);
        if (!choice || choice === "Back") return;
        const segment = choice.replace(/^(✓ shown|✗ hidden)\s+/, "");
        const next = readConfig();
        const filters = new Set(next.textFilters[id] ?? []);
        if (filters.has(segment)) filters.delete(segment);
        else filters.add(segment);
        next.textFilters[id] = [...filters];
        writeConfig(next);
        renderTrackedStatus(ctx, id, next);
        ctx.ui.notify(`${filters.has(segment) ? "Hidden" : "Shown"}: ${segment}`, "info");
    }
}

async function editOne(ctx: ExtensionCommandContext, id: string): Promise<void> {
    const config = readConfig();
    const custom = config.items.find((item) => item.id === id);
    const hidden = config.hiddenIds.includes(id);
    const action = await ctx.ui.select(`Footer item: ${id}`, [
        hidden ? "Show/unhide" : "Hide",
        custom?.enabled === false ? "Turn custom on" : "Turn custom off",
        custom ? "Edit custom text" : "Create custom override",
        custom ? "Change custom color" : "Create custom colored item",
        "Toggle · separated segments",
        "Show only first N segments",
        "Hide a word/phrase inside this entry",
        "Show/unfilter a hidden word/phrase",
        custom ? "Remove custom item" : "Forget seen id",
        "Back",
    ]);
    if (!action || action === "Back") return;

    const next = readConfig();
    const hiddenSet = new Set(next.hiddenIds);
    const index = next.items.findIndex((item) => item.id === id);
    const existing = index >= 0 ? next.items[index] : undefined;

    if (action === "Hide") {
        hiddenSet.add(id);
        next.hiddenIds = [...hiddenSet];
        ctx.ui.setStatus(id, undefined);
    } else if (action === "Show/unhide") {
        hiddenSet.delete(id);
        next.hiddenIds = [...hiddenSet];
    } else if (action === "Turn custom on" || action === "Turn custom off") {
        if (!existing) ctx.ui.notify(`${id} is external; use Hide/Show for external items.`, "warning");
        else existing.enabled = action === "Turn custom on";
    } else if (action === "Edit custom text" || action === "Create custom override") {
        const text = await ctx.ui.input("Footer text", existing?.text ?? "");
        if (text !== undefined) {
            const updated: FooterItem = { ...(existing ?? { id, color: "default" as FooterColor, enabled: true }), id, text, enabled: true };
            if (index >= 0) next.items[index] = updated;
            else next.items.push(updated);
            hiddenSet.delete(id);
            next.hiddenIds = [...hiddenSet];
        }
    } else if (action === "Change custom color" || action === "Create custom colored item") {
        const color = (await ctx.ui.select("Color", COLORS)) as FooterColor | undefined;
        if (color) {
            const text = existing?.text ?? (await ctx.ui.input("Footer text", "Text shown in bottom bar"));
            if (text) {
                const updated: FooterItem = { ...(existing ?? { id, enabled: true }), id, text, color, enabled: true };
                if (index >= 0) next.items[index] = updated;
                else next.items.push(updated);
            }
        }
    } else if (action === "Toggle · separated segments") {
        await editSegments(ctx, id);
        return;
    } else if (action === "Show only first N segments") {
        const count = await ctx.ui.input("Number of parts to keep", "Example: 2");
        next.segmentLimits[id] = parseSegmentLimit(count);
        // Clipping is the authoritative smart rule for this entry; remove older
        // word filters so the first parts remain intact.
        delete next.textFilters[id];
    } else if (action === "Hide a word/phrase inside this entry") {
        const phrase = await ctx.ui.input("Word or phrase to hide", "Exact text to remove from this footer entry");
        if (phrase) {
            next.textFilters[id] = [...new Set([...(next.textFilters[id] ?? []), phrase])];
        }
    } else if (action === "Show/unfilter a hidden word/phrase") {
        const filters = next.textFilters[id] ?? [];
        if (filters.length === 0) {
            ctx.ui.notify(`${id} has no word/phrase filters.`, "info");
        } else {
            const phrase = await ctx.ui.select("Remove which filter?", [...filters, "Back"]);
            if (phrase && phrase !== "Back") next.textFilters[id] = filters.filter((filter) => filter !== phrase);
        }
    } else if (action === "Remove custom item") {
        ctx.ui.setStatus(id, undefined);
        next.items = next.items.filter((item) => item.id !== id);
    } else if (action === "Forget seen id") {
        next.seen = next.seen.filter((item) => item.id !== id);
        hiddenSet.delete(id);
        next.hiddenIds = [...hiddenSet];
    }

    writeConfig(next);
    applyFooter(ctx, next);
}

function clearConfig(config: FooterConfig): FooterConfig {
    // Keep suppression durable. External extensions re-register their statuses on
    // /reload and process startup, so clearing only the live UI is not enough.
    const seenExternalIds = config.seen
        .filter((entry) => entry.source === "seen")
        .map((entry) => entry.id);
    return {
        items: [],
        hiddenIds: [...new Set([...config.hiddenIds, ...seenExternalIds])],
        seen: config.seen,
        textFilters: {},
        segmentLimits: {},
    };
}

function parseSegmentLimit(value: string | undefined): number {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1) throw new Error("segment count must be a positive integer");
    return count;
}

function mutateConfig(action: string, id: string | undefined, text: string | undefined, ctx: ExtensionContext): FooterConfig {
    const config = readConfig();
    if (action === "clear") {
        const next = clearConfig(config);
        writeConfig(next);
        applyFooter(ctx, next);
        return next;
    }

    if (!id) throw new Error("id is required");
    const index = config.items.findIndex((item) => item.id === id);
    const existing = index >= 0 ? config.items[index] : undefined;

    if (action === "set") {
        if (!text) throw new Error("text is required");
        const item: FooterItem = { ...(existing ?? { id, color: "default" as FooterColor }), id, text, enabled: true };
        if (index >= 0) config.items[index] = item;
        else config.items.push(item);
        config.hiddenIds = config.hiddenIds.filter((hiddenId) => hiddenId !== id);
        rememberStatus(id, text, "custom");
    } else if (action === "on" || action === "off") {
        if (!existing) throw new Error(`unknown custom footer item: ${id}`);
        existing.enabled = action === "on";
    } else if (action === "remove") {
        ctx.ui.setStatus(id, undefined);
        if (existing) {
            config.items = config.items.filter((item) => item.id !== id);
        } else {
            // External statuses cannot be removed from their owning extension;
            // persistently hide them instead so reload/startup cannot resurrect them.
            config.hiddenIds = [...new Set([...config.hiddenIds, id])];
        }
    } else if (action === "hide") {
        config.hiddenIds = [...new Set([...config.hiddenIds, id])];
        ctx.ui.setStatus(id, undefined);
        rememberStatus(id, undefined, "seen");
    } else if (action === "unhide") {
        config.hiddenIds = config.hiddenIds.filter((hiddenId) => hiddenId !== id);
    } else if (action === "filter") {
        if (!text) throw new Error("phrase is required");
        config.textFilters[id] = [...new Set([...(config.textFilters[id] ?? []), text])];
        rememberStatus(id, undefined, "seen");
    } else if (action === "unfilter") {
        if (!text) throw new Error("phrase is required");
        config.textFilters[id] = (config.textFilters[id] ?? []).filter((filter) => filter !== text);
    } else if (action === "clip") {
        config.segmentLimits[id] = parseSegmentLimit(text);
        delete config.textFilters[id];
        rememberStatus(id, undefined, "seen");
    } else if (action === "unclip") {
        delete config.segmentLimits[id];
    } else {
        throw new Error(`unknown action: ${action}`);
    }

    writeConfig(config);
    applyFooter(ctx, config);
    return config;
}

export default function editFooter(pi: ExtensionAPI) {
    pi.on("session_start", (_event, ctx) => setup(ctx));
    pi.on("resources_discover", (_event, ctx) => setup(ctx));
    pi.on("agent_start", (_event, ctx) => setup(ctx));
    pi.on("agent_end", (_event, ctx) => setup(ctx));
    pi.on("turn_start", (_event, ctx) => setup(ctx));
    pi.on("turn_end", (_event, ctx) => setup(ctx));

    pi.registerCommand("edit-footer", {
        description: "Open an interactive UI to find, hide, show, and edit footer/status-bar items",
        handler: async (rawArgs, ctx) => {
            setup(ctx);
            const args = parseArgs(rawArgs ?? "");
            const action = args[0] ?? "menu";

            if (action === "menu") return openMenu(ctx);
            if (action === "help" || action === "-h" || action === "--help") return help(ctx);
            if (action === "list") return ctx.ui.notify(summarize(), "info");
            if (action === "json") return ctx.ui.notify(`${CONFIG_PATH}\n${JSON.stringify(readConfig(), null, 2)}`, "info");

            try {
                const next = mutateConfig(action, args[1], args.slice(2).join(" ") || undefined, ctx);
                ctx.ui.notify(summarize(next), "info");
            } catch (error) {
                ctx.ui.notify(`edit-footer: ${String(error)}`, "warning");
                help(ctx);
            }
        },
    });

    pi.registerTool({
        name: "edit_footer",
        label: "Edit Footer",
        description: "Configure Pi footer/status-bar items in realtime. Supports persistent hiding, text filters, and clipping an entry to its first N separator-delimited parts.",
        parameters: Type.Object({
            action: Type.Union(["list", "set", "on", "off", "remove", "hide", "unhide", "filter", "unfilter", "clip", "unclip", "clear"].map((value) => Type.Literal(value))),
            id: Type.Optional(Type.String({ description: "Footer/status id" })),
            text: Type.Optional(Type.String({ description: "Text, phrase, or segment count depending on action" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            setup(ctx);
            const config = params.action === "list" ? readConfig() : mutateConfig(params.action, params.id, params.text, ctx);
            return {
                content: [{ type: "text", text: summarize(config) }],
                details: { config, configPath: CONFIG_PATH },
            };
        },
    });
}
