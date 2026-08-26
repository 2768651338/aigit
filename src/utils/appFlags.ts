/**
 * Cross-cutting UI flags mirrored from the loaded AppConfig. Lives outside
 * zustand so lightweight modules (services, repoStore) can read settings
 * without importing the settings store — whose module graph pulls in i18n
 * and AI services as side effects.
 */
export const appFlags = {
  /** Persist open repository tabs across restarts (ui.remember_open_repos). */
  rememberOpenRepos: true,
};
