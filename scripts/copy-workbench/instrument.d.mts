import type { Plugin } from 'vite';

export function copySourcePlugin(options?: { root?: string }): Plugin;
export function instrumentCopySource(source: string, file: string, entries?: unknown[], visualEntries?: unknown[]): { code: string; map: null } | null;
