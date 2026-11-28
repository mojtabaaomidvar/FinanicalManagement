import { defineConfig, mergeConfig } from 'vitest/config';
import project from '../vite.config';

// Linked worktree dependencies need Workbox resolved through Vite during tests.
export default defineConfig(env => mergeConfig(project(env), {
  test: { server: { deps: { inline: [/^workbox-/] } } },
}));
