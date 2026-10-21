export function startThemeGuard(options: {
 matches: () => boolean;
 restore: () => void;
 onInput?: (handler: (data: string) => undefined) => (() => void) | undefined;
 schedule?: (callback: () => void) => () => void;
}): { repair(): void; stop(): void };
