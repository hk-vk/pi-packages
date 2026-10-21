import type { Workspace, WorkspaceTheme } from './sc.mjs';
export type Appearance = 'light' | 'dark';
export interface SyncState { mode: Appearance; workspaceId: string; workspaceName: string; theme: WorkspaceTheme }
export function isSuper(env: NodeJS.ProcessEnv): boolean;
export function settingsPath(env: NodeJS.ProcessEnv, home?: string): string;
export function appearance(mode: unknown, system?: Appearance): Appearance | undefined;
export function systemAppearance(): Promise<Appearance | undefined>;
export function startSync(options: {
 path: string;
 apply: (state: SyncState) => void | boolean | Promise<void | boolean>;
 workspace: () => Promise<Workspace>;
 isApplied?: () => boolean;
 read?: () => string | Promise<string>;
 system?: () => Appearance | undefined | Promise<Appearance | undefined>;
 watch?: (callback: () => void) => () => void;
 every?: (callback: () => void) => () => void;
}): {
 ready: Promise<void>;
 refresh(): Promise<void>;
 status(): SyncState | undefined;
 health(): { error: string | undefined; stale: boolean; closed: boolean };
 stop(): void;
};
