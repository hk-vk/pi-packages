import type { WorkspaceTheme } from './sc.mjs';
export interface InstalledTheme { name: string; path: string; colors: Record<string, string> }
export function installThemes(directory: string, workspaceTheme: WorkspaceTheme, tokens: string[], workspaceId?: string): Promise<Record<'light' | 'dark', InstalledTheme>>;
