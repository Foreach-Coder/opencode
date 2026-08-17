/**
 * CLI, WSL and updater fail closed in Desktop runtime through
 * `assertDesktopCapability`; build-time source rewrites are intentionally gone.
 */
export const removedEntrypointRuleIds = [
  "disable-main-entrypoints",
  "disable-ipc-updater",
  "disable-preload-entrypoints",
  "disable-renderer-cli",
  "disable-preload-types",
  "disable-renderer-entrypoints",
  "disable-menu-updater",
] as const
