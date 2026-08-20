import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CancellableLoader,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  SelectList,
  type SelectItem,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

type PackageResult = {
  name: string;
  description: string;
  url: string;
  npmUrl?: string;
  repoUrl?: string;
  install?: string;
  installSpec?: string;
  type?: string;
  author?: string;
  downloads?: string;
  published?: string;
};

const CATALOG_URL = "https://pi.dev/packages";
const PI_BASE_URL = "https://pi.dev";
let cache: { key: string; at: number; packages: PackageResult[] } | undefined;
const CACHE_TTL_MS = 5 * 60 * 1000;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "));
}

function absoluteUrl(url: string): string {
  return url.startsWith("http") ? url : `${PI_BASE_URL}${url}`;
}

function parseCatalog(html: string): PackageResult[] {
  const packages = new Map<string, PackageResult>();
  const sectionRegex = /<h3[^>]*>\s*<a[^>]+href="(\/packages\/[^"]+)"[^>]*>(.*?)<\/a>\s*<\/h3>([\s\S]*?)(?=<h3[^>]*>\s*<a[^>]+href="\/packages\/|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(html))) {
    const [, path, rawName, rest] = match;
    const name = stripTags(rawName);
    if (!name || packages.has(name)) continue;

    const paragraph = rest.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const description = paragraph ? stripTags(paragraph[1]) : "";
    const npmMatch = rest.match(/href="(https:\/\/www\.npmjs\.com\/package\/[^"]+)"/);
    const repoMatch = rest.match(/href="(https:\/\/github\.com\/[^"]+)"/);
    const installMatch = rest.match(/\$\s*pi\s+install\s+([^`<\s]+)/);
    const plain = stripTags(rest);
    const typeMatch = plain.match(/\b(extension|skill|theme|prompt|package)\b/i);
    const downloadsMatch = plain.match(/([0-9]+(?:\.[0-9]+)?[KMB]?\/mo)/i);
    const publishedMatch = plain.match(/(\d+[mhdwmo]+ ago)/i);

    const install = installMatch ? `pi install ${installMatch[1]}` : `pi install npm:${name}`;
    packages.set(name, {
      name,
      description,
      url: absoluteUrl(path),
      npmUrl: npmMatch?.[1],
      repoUrl: repoMatch?.[1],
      install,
      installSpec: install.replace(/^pi install\s+/, ""),
      type: typeMatch?.[1]?.toLowerCase(),
      downloads: downloadsMatch?.[1],
      published: publishedMatch?.[1],
    });
  }

  return [...packages.values()];
}

async function fetchCatalog(
  force = false,
  signal?: AbortSignal,
  query = "",
): Promise<PackageResult[]> {
  const normalizedQuery = query.trim();
  const cacheKey = normalizedQuery.toLowerCase();
  if (!force && cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.packages;
  }

  const url = new URL(CATALOG_URL);
  if (normalizedQuery) url.searchParams.set("name", normalizedQuery);
  const response = await fetch(url, {
    headers: { "user-agent": "pi-package-search/0.1" },
    signal,
  });
  if (!response.ok) throw new Error(`Failed to fetch ${CATALOG_URL}: ${response.status} ${response.statusText}`);
  const html = await response.text();
  const packages = parseCatalog(html);
  cache = { key: cacheKey, at: Date.now(), packages };
  return packages;
}

async function searchOfficialPackages(
  query: string,
  signal?: AbortSignal,
  force = false,
): Promise<PackageResult[]> {
  const normalized = query.trim();
  if (!normalized) return fetchCatalog(force, signal);

  // Pi's catalog treats the `name` parameter as a package-name search. Turn
  // natural typing like "pi auto review" into the npm-style slug first, then
  // fall back to the original phrase for description/category searches.
  const slug = normalized.split(/\s+/).join("-");
  const slugResults = await fetchCatalog(force, signal, slug);
  if (slugResults.length > 0 || slug === normalized) return slugResults;
  return fetchCatalog(force, signal, normalized);
}

async function installedPackageSpecs(): Promise<Set<string>> {
  try {
    const raw = await readFile(join(homedir(), ".pi", "agent", "settings.json"), "utf8");
    const settings = JSON.parse(raw) as { packages?: unknown[] };
    const specs = new Set<string>();
    for (const entry of settings.packages ?? []) {
      if (typeof entry === "string") specs.add(entry);
      else if (entry && typeof entry === "object" && "source" in entry) {
        const source = (entry as { source?: unknown }).source;
        if (typeof source === "string") specs.add(source);
      }
    }
    return specs;
  } catch {
    return new Set();
  }
}

function packageIsInstalled(pkg: PackageResult, specs: Set<string>): boolean {
  const candidates = [pkg.installSpec, `npm:${pkg.name}`, pkg.name].filter(
    (value): value is string => Boolean(value),
  );
  return candidates.some((candidate) => specs.has(candidate));
}

type BrowserSelection = {
  package: PackageResult;
  query: string;
  page: number;
};

class PackageBrowser {
  private readonly editor: Editor;
  private list: SelectList | null = null;
  private listIndex = 0;
  private results: PackageResult[] = [];
  private query = "";
  private page = 0;
  private readonly pageSize = 8;
  private focus: "search" | "list" = "search";
  private loading = false;
  private error: string | undefined;
  private spinnerIndex = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private controller: AbortController | undefined;
  private requestId = 0;
  private startingPage: number;
  private closed = false;
  private _focused = false;

  constructor(
    private readonly tui: { requestRender: () => void },
    private readonly theme: any,
    initialQuery: string,
    initialPage: number,
    private readonly installed: Set<string>,
    private readonly search: (query: string, signal: AbortSignal) => Promise<PackageResult[]>,
    private readonly onSelect: (selection: BrowserSelection) => void,
    private readonly onCancel: () => void,
  ) {
    const editorTheme: EditorTheme = {
      borderColor: (text: string) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text: string) => theme.fg("accent", text),
        selectedText: (text: string) => theme.fg("accent", text),
        description: (text: string) => theme.fg("muted", text),
        scrollInfo: (text: string) => theme.fg("dim", text),
        noMatch: (text: string) => theme.fg("warning", text),
      },
    };
    this.startingPage = Math.max(0, initialPage);
    this.editor = new Editor(tui as never, editorTheme);
    this.editor.setText(initialQuery);
    this.editor.onSubmit = (text) => void this.runSearch(text);
    this.editor.onChange = () => {
      this.invalidate();
      this.tui.requestRender();
    };
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncFocus();
  }

  start(): void {
    void this.runSearch(this.editor.getText());
  }

  private syncFocus(): void {
    this.editor.focused = this._focused && this.focus === "search";
  }

  private setFocus(focus: "search" | "list"): void {
    this.focus = focus;
    this.syncFocus();
    this.invalidate();
    this.tui.requestRender();
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % 4;
      this.invalidate();
      this.tui.requestRender();
    }, 120);
    (this.spinnerTimer as { unref?: () => void }).unref?.();
  }

  private stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }

  private makeList(): void {
    const start = this.page * this.pageSize;
    const pageResults = this.results.slice(start, start + this.pageSize);
    this.listIndex = 0;
    const items: SelectItem[] = pageResults.map((pkg) => {
      const installed = packageIsInstalled(pkg, this.installed);
      const status = installed ? ` ${this.theme.fg("success", "✓ installed")}` : "";
      const kind = pkg.type ? `${pkg.type} • ` : "";
      return {
        value: pkg.name,
        label: `${pkg.name}${status}`,
        description: `${kind}${pkg.description || "No description"}`,
      };
    });

    this.list = new SelectList(items, Math.max(1, Math.min(this.pageSize, items.length)), {
      selectedPrefix: (text: string) => this.theme.fg("accent", text),
      selectedText: (text: string) => this.theme.fg("accent", text),
      description: (text: string) => this.theme.fg("muted", text),
      scrollInfo: (text: string) => this.theme.fg("dim", text),
      noMatch: (text: string) => this.theme.fg("warning", text),
    });
    this.list.onSelect = (item) => {
      const pkg = this.results.find((candidate) => candidate.name === item.value);
      if (pkg) this.onSelect({ package: pkg, query: this.query, page: this.page });
    };
    this.list.onSelectionChange = (item) => {
      const index = pageResults.findIndex((candidate) => candidate.name === item.value);
      if (index >= 0) this.listIndex = index;
    };
    this.list.onCancel = this.onCancel;
  }

  private async runSearch(rawQuery: string): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const requestId = ++this.requestId;
    this.query = rawQuery.trim();
    this.page = 0;
    this.results = [];
    this.list = null;
    this.error = undefined;
    this.loading = true;
    this.setFocus("search");
    this.startSpinner();

    try {
      const results = await this.search(this.query, controller.signal);
      if (controller.signal.aborted || requestId !== this.requestId || this.closed) return;
      this.results = results;
      this.page = Math.min(this.startingPage, this.pageCount() - 1);
      this.startingPage = 0;
      this.makeList();
      // Keep the search field focused after results arrive so typing works
      // immediately; Tab moves to the package list for selection.
      this.setFocus("search");
    } catch (error) {
      if (controller.signal.aborted || requestId !== this.requestId || this.closed) return;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (requestId === this.requestId) {
        this.loading = false;
        this.stopSpinner();
        this.invalidate();
        this.tui.requestRender();
      }
    }
  }

  private pageCount(): number {
    return Math.max(1, Math.ceil(this.results.length / this.pageSize));
  }

  private nextPage(): void {
    if (this.page >= this.pageCount() - 1) return;
    this.page++;
    this.makeList();
    this.invalidate();
    this.tui.requestRender();
  }

  private previousPage(): void {
    if (this.page <= 0) return;
    this.page--;
    this.makeList();
    this.invalidate();
    this.tui.requestRender();
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller?.abort();
    this.stopSpinner();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.close();
      this.onCancel();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.setFocus(this.focus === "search" && this.list ? "list" : "search");
      return;
    }

    if (this.focus === "search") {
      if (matchesKey(data, Key.down) && this.list) {
        this.setFocus("list");
        this.list.handleInput(data);
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      this.editor.handleInput(data);
      return;
    }

    if (data === "s" || matchesKey(data, Key.ctrl("r"))) {
      this.editor.setText(this.query);
      this.setFocus("search");
      return;
    }
    if (matchesKey(data, Key.up) && this.listIndex === 0) {
      this.setFocus("search");
      return;
    }
    if (matchesKey(data, Key.right) || data === "n") {
      this.nextPage();
      return;
    }
    if (matchesKey(data, Key.left) || data === "p") {
      this.previousPage();
      return;
    }

    this.list?.handleInput(data);
    this.invalidate();
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const renderWidth = Math.max(1, width);
    const lines: string[] = [];
    const add = (text: string) => lines.push(...wrapTextWithAnsi(text, renderWidth));
    const border = this.theme.fg("accent", "─".repeat(renderWidth));
    const spinner = ["⠋", "⠙", "⠹", "⠸"][this.spinnerIndex];

    lines.push(border);
    add(this.theme.fg("accent", this.theme.bold("Pi Package Browser")));
    add(this.theme.fg("dim", "Search the official pi.dev catalog. Enter searches; installed packages are marked in green."));
    lines.push("");
    add(this.theme.fg("muted", "Search:"));
    lines.push(...this.editor.render(renderWidth));
    lines.push("");

    if (this.loading) {
      add(this.theme.fg("accent", `${spinner} Searching ${this.query ? `for \"${this.query}\"` : "the catalog"}...`));
    } else if (this.error) {
      add(this.theme.fg("error", `Search failed: ${this.error}`));
      add(this.theme.fg("dim", "Press Tab to edit the search, Enter to retry, or Esc to close."));
    } else if (this.results.length === 0) {
      add(this.theme.fg("warning", "No packages found."));
      add(this.theme.fg("dim", "Press Tab to edit the search, then Enter to search again."));
    } else {
      const pages = this.pageCount();
      const firstResult = this.page * this.pageSize + 1;
      const lastResult = Math.min((this.page + 1) * this.pageSize, this.results.length);
      const searchedTerm = this.query ? `"${this.query}"` : "all packages";
      const pageLabel = `Showing ${firstResult}-${lastResult} of ${this.results.length} results for ${searchedTerm} • Page ${this.page + 1}/${pages}`;
      add(this.theme.fg("muted", pageLabel));
      lines.push(...(this.list?.render(renderWidth) ?? []));
      lines.push("");
      add(this.theme.fg("dim", `${this.page > 0 ? "‹ p/← previous" : ""}${this.page > 0 && this.page < pages - 1 ? "  •  " : ""}${this.page < pages - 1 ? "n/→ next ›" : ""}`));
    }

    lines.push("");
    const help = this.focus === "search"
      ? "Tab: results  •  Enter: search  •  Esc: close"
      : "Tab or ↑ at top: search  •  ↓↑: select  •  Enter: actions  •  s/Ctrl-R: search again  •  Esc: close";
    add(this.theme.fg("dim", help));
    lines.push(border);
    return lines;
  }

  invalidate(): void {
    this.editor.invalidate();
    this.list?.invalidate();
  }
}

function formatResults(results: PackageResult[]): string {
  if (results.length === 0) return "No Pi packages found.";
  return results
    .map((pkg, index) => {
      const lines = [
        `${index + 1}. ${pkg.name}${pkg.type ? ` (${pkg.type})` : ""}`,
        `   ${pkg.description || "No description"}`,
        `   Link: ${pkg.url}`,
      ];
      if (pkg.install) lines.push(`   Install: ${pkg.install}`);
      if (pkg.npmUrl) lines.push(`   npm: ${pkg.npmUrl}`);
      if (pkg.repoUrl) lines.push(`   repo: ${pkg.repoUrl}`);
      if (pkg.downloads || pkg.published) lines.push(`   Stats: ${[pkg.downloads, pkg.published].filter(Boolean).join(" • ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "pi_package_search",
    label: "Search Pi packages",
    description: "Search the official Pi package catalog at pi.dev/packages and return package links, install commands, npm links, and repo links.",
    parameters: Type.Object({
      query: Type.String({ description: "Search terms, e.g. google docs, mcp, theme, subagents." }),
      limit: Type.Optional(Type.Number({ description: "Maximum results to return. Default 8." })),
      type: Type.Optional(Type.String({ description: "Optional type filter: extension, skill, theme, prompt, package." })),
      refresh: Type.Optional(Type.Boolean({ description: "Bypass the short local cache and refetch pi.dev/packages." })),
    }),
    async execute(_toolCallId, params) {
      const query = String(params.query ?? "").trim();
      const limit = Math.max(1, Math.min(Number(params.limit ?? 8), 25));
      const type = params.type ? String(params.type).toLowerCase() : undefined;
      const packages = await searchOfficialPackages(query, undefined, Boolean(params.refresh));
      const results = packages
        .filter((pkg) => !type || pkg.type === type)
        .slice(0, limit);

      return { content: [{ type: "text", text: formatResults(results) }], details: { query, count: results.length, source: CATALOG_URL } };
    },
  });

  pi.registerTool({
    name: "pi_package_catalog",
    label: "List Pi packages",
    description: "List recent/top packages from the official Pi package catalog.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Maximum packages to return. Default 12." })),
      refresh: Type.Optional(Type.Boolean({ description: "Bypass cache and refetch pi.dev/packages." })),
    }),
    async execute(_toolCallId, params) {
      const limit = Math.max(1, Math.min(Number(params.limit ?? 12), 50));
      const packages = (await fetchCatalog(Boolean(params.refresh))).slice(0, limit);
      return { content: [{ type: "text", text: formatResults(packages) }], details: { count: packages.length, source: CATALOG_URL } };
    },
  });

  pi.registerCommand("pi-package-search", {
    description: "Browse, inspect, open, or install Pi packages. Usage: /pi-package-search google docs",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/pi-package-search requires Pi's interactive TUI.", "warning");
        return;
      }

      let query = String(args ?? "").trim();
      let page = 0;

      for (;;) {
        const installed = await installedPackageSpecs();
        const selection = await ctx.ui.custom<BrowserSelection | null>((tui, theme, _keybindings, done) => {
          const browser = new PackageBrowser(
            tui,
            theme,
            query,
            page,
            installed,
            async (searchQuery, signal) => searchOfficialPackages(searchQuery, signal),
            done,
            () => done(null),
          );
          browser.start();
          return browser;
        });

        if (!selection) return;
        query = selection.query;
        page = selection.page;

        const selected = selection.package;
        const alreadyInstalled = packageIsInstalled(selected, installed);
        const installAction = alreadyInstalled ? "Reinstall/update package" : "Install package";
        const action = await ctx.ui.select(
          `${selected.name}${alreadyInstalled ? " • installed" : ""}`,
          [
            installAction,
            "Open package page",
            "Open official catalog",
            "Open npm page",
            "Open repository",
            "Back to results",
            "Cancel",
          ],
        );

        if (!action || action === "Cancel") return;
        if (action === "Back to results") continue;

        const url = action === "Open package page"
          ? selected.url
          : action === "Open official catalog"
            ? CATALOG_URL
            : action === "Open npm page"
              ? selected.npmUrl
              : action === "Open repository"
                ? selected.repoUrl
                : undefined;

        if (url) {
          const command: [string, string[]] = process.platform === "darwin"
            ? ["open", [url]]
            : process.platform === "win32"
              ? ["cmd", ["/c", "start", "", url]]
              : ["xdg-open", [url]];
          const opened = await pi.exec(command[0], command[1]);
          ctx.ui.notify(
            opened.code === 0 ? `Opened ${url}` : `Could not open ${url}`,
            opened.code === 0 ? "info" : "error",
          );
          continue;
        }

        if (action !== installAction) {
          ctx.ui.notify(`No link is available for ${action.toLowerCase()}.`, "warning");
          continue;
        }

        const confirmed = await ctx.ui.confirm(
          `${alreadyInstalled ? "Reinstall/update" : "Install"} ${selected.name}?`,
          `This will run: ${selected.install ?? `pi install npm:${selected.name}`}`,
        );
        if (!confirmed) {
          ctx.ui.notify("Installation cancelled.", "info");
          continue;
        }

        const installResult = await ctx.ui.custom<Awaited<ReturnType<ExtensionAPI["exec"]>> | null>(
          (tui, theme, _keybindings, done) => {
            const loader = new CancellableLoader(
              tui,
              (text) => theme.fg("accent", text),
              (text) => theme.fg("muted", text),
              `${alreadyInstalled ? "Updating" : "Installing"} ${selected.name}...`,
            );
            loader.onAbort = () => done(null);
            pi.exec(
              "pi",
              ["install", selected.installSpec ?? `npm:${selected.name}`],
              { timeout: 120_000, signal: loader.signal },
            ).then(done).catch(() => done(null));
            return loader;
          },
        );

        if (!installResult) {
          ctx.ui.notify("Installation cancelled.", "info");
        } else if (installResult.code === 0) {
          ctx.ui.notify(`Installed ${selected.name}. Run /reload to load it.`, "info");
        } else {
          const detail = (installResult.stderr || installResult.stdout || "unknown error").trim();
          ctx.ui.notify(`Installation failed for ${selected.name}: ${detail}`, "error");
        }

      }
    },
  });
}
