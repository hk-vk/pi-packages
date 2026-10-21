export type WorkspaceTheme = Record<string, unknown>;
export interface Workspace { id: string; name: string; theme?: WorkspaceTheme }
export type ScClient = (args: string[]) => Promise<any>;
export function scClient(options?: { env?: NodeJS.ProcessEnv; cwd?: string; signal?: AbortSignal }): ScClient;
export function verifyCaller(sc: ScClient): Promise<boolean>;
export function sessionWorkspace(sc: ScClient, cwd: string): Promise<Workspace>;
export function workspaceById(sc: ScClient, id: string): Promise<Workspace>;
export function activeWorkspace(sc: ScClient): Promise<Workspace>;
