import {
	createBashToolDefinition,
	DynamicBorder,
	getShellConfig,
	type BashOperations,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, Input, Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";

const PASSWORD_PROMPT_TIMEOUT_MS = 60_000;
const PRIVILEGED_COMMAND = /(?:^|(?:&&|\|\||[;|])\s*)sudo\b/;

type PasswordPromptResult = string | null;
type DialogTheme = {
	fg: (color: "accent" | "error" | "muted" | "warning", text: string) => string;
	bold: (text: string) => string;
};

function needsSudo(command: string): boolean {
	return PRIVILEGED_COMMAND.test(command);
}

function unsupportedPlatformMessage(): string {
	return process.platform === "win32"
		? "sudo is not available on Windows. Use an elevated PowerShell or platform-specific administrator flow."
		: "sudo authentication requires Pi's interactive TUI mode.";
}

/**
 * A short-lived masked password dialog. The value is only held in memory, is
 * never echoed, written to disk, appended to the Pi session, or passed via an
 * environment variable / process argument.
 */
async function promptForPassword(
	ctx: ExtensionContext,
	command: string,
	initialError?: string,
): Promise<PasswordPromptResult> {
	if (ctx.mode !== "tui" || !ctx.hasUI) throw new Error(unsupportedPlatformMessage());

	return ctx.ui.custom<PasswordPromptResult>((tui, theme: DialogTheme, _keybindings, done) => {
		const input = new Input();
		let status = initialError ?? "Press Enter to continue. Press Esc to cancel.";
		let statusIsError = initialError !== undefined;
		let completed = false;

		const finish = (value: PasswordPromptResult) => {
			if (completed) return;
			completed = true;
			clearTimeout(timeout);
			input.setValue("");
			done(value);
		};

		input.onSubmit = (value) => {
			if (!value) {
				status = "Enter a password to continue.";
				statusIsError = true;
				tui.requestRender();
				return;
			}
			finish(value);
		};
		input.onEscape = () => finish(null);

		const timeout = setTimeout(() => finish(null), PASSWORD_PROMPT_TIMEOUT_MS);
		const borderColor = (text: string) => theme.fg("warning", text);
		const container = new Container();
		container.addChild(new DynamicBorder(borderColor));
		container.addChild(new Text(theme.fg("warning", theme.bold("Administrator access")), 1, 0));
		container.addChild(new Text(theme.fg("muted", `Command: ${command}`), 1, 0));

		const maskedInput = {
			focused: true,
			render(width: number): string[] {
				const masked = "*".repeat([...input.getValue()].length);
				return [truncateToWidth(` Password: ${masked}${CURSOR_MARKER}`, width)];
			},
			invalidate() {},
		};
		container.addChild(maskedInput);
		container.addChild({
			render: (width: number) => {
				const rendered = statusIsError ? theme.fg("error", status) : theme.fg("muted", status);
				return [truncateToWidth(` ${rendered}`, width)];
			},
			invalidate() {},
		});
		container.addChild(new DynamicBorder(borderColor));

		return {
			get focused() { return input.focused; },
			set focused(value: boolean) { input.focused = value; maskedInput.focused = value; },
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput(data: string) {
				if (matchesKey(data, Key.ctrl("c"))) {
					finish(null);
					return;
				}
				status = "Press Enter to continue. Press Esc to cancel.";
				statusIsError = false;
				input.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

/** Check the password before starting the actual command, without displaying sudo's prompt. */
async function validatePassword(password: string, cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		// Force a fresh check so an existing sudo credential ticket cannot make an
		// incorrect password appear valid.
		const child = spawn("sudo", ["-k", "-S", "-p", "", "-v"], {
			cwd,
			stdio: ["pipe", "ignore", "ignore"],
			windowsHide: true,
		});
		child.once("error", () => resolve(false));
		child.once("exit", (code) => resolve(code === 0));
		child.stdin?.end(`${password}\n`);
	});
}

async function authenticate(
	ctx: ExtensionContext,
	command: string,
	cwd: string,
): Promise<{ password?: string; reason?: string }> {
	if (process.platform === "win32") return { reason: unsupportedPlatformMessage() };
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		return { reason: "sudo authentication requires Pi's interactive TUI mode." };
	}

	let error: string | undefined;
	for (let attempt = 1; attempt <= 3; attempt++) {
		let password = await promptForPassword(ctx, command, error);
		if (!password) return { reason: "sudo command cancelled." };
		if (await validatePassword(password, cwd)) return { password };

		password = "";
		error = attempt < 3
			? `Incorrect password. Try again (${3 - attempt} attempts remaining).`
			: "Incorrect password. No attempts remaining.";
	}
	return { reason: "sudo authentication failed after three attempts." };
}

function killChild(child: ReturnType<typeof spawn>): void {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

/** Supply sudo's password through private file descriptor 3, never argv/env. */
function createAuthenticatedSudoOperations(initialPassword: string): BashOperations {
	let password = initialPassword;
	return {
		async exec(command, cwd, { onData, signal, timeout, env }) {
			const shell = getShellConfig();
			const wrappedCommand = `sudo() { command sudo -S -p '' "$@" <&3; }\n${command}`;

			return new Promise<{ exitCode: number | null }>((resolve, reject) => {
				const child = spawn(shell.shell, [...shell.args, wrappedCommand], {
					cwd,
					detached: true,
					env,
					stdio: ["ignore", "pipe", "pipe", "pipe"],
					windowsHide: true,
				});
				let settled = false;
				let timer: ReturnType<typeof setTimeout> | undefined;

				const cleanup = () => {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", abort);
					password = "";
				};
				const fail = (error: Error) => {
					if (settled) return;
					settled = true;
					cleanup();
					reject(error);
				};
				const abort = () => {
					killChild(child);
					fail(new Error("aborted"));
				};

				child.once("error", fail);
				child.once("exit", (exitCode) => {
					if (settled) return;
					settled = true;
					cleanup();
					resolve({ exitCode });
				});
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				const passwordPipe = child.stdio[3];
				if (passwordPipe && "end" in passwordPipe) passwordPipe.end(`${password}\n`);

				if (signal) {
					if (signal.aborted) abort();
					else signal.addEventListener("abort", abort, { once: true });
				}
				if (timeout && timeout > 0) {
					timer = setTimeout(() => {
						killChild(child);
						fail(new Error(`timeout:${timeout}`));
					}, timeout * 1000);
				}
			});
		},
	};
}

export default function sudoAuth(pi: ExtensionAPI) {
	const bashDefinition = createBashToolDefinition(process.cwd());

	// Override Pi's bash tool while preserving its official schema, renderer,
	// streaming, truncation, timeout handling, and process cleanup.
	pi.registerTool({
		...bashDefinition,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!needsSudo(params.command)) {
				return createBashToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			}

			const auth = await authenticate(ctx, params.command, ctx.cwd);
			if (!auth.password) throw new Error(auth.reason ?? "sudo authentication failed.");

			return createBashToolDefinition(ctx.cwd, {
				operations: createAuthenticatedSudoOperations(auth.password),
			}).execute(toolCallId, params, signal, onUpdate, ctx);
		},
	});
}
