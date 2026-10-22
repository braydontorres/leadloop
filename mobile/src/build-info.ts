export type ExpoBuildConstants = {
  expoConfig?: {
    extra?: {
      leadloopBuild?: {
        commit?: unknown;
        builtAt?: unknown;
        identifier?: unknown;
      };
    };
  } | null;
  executionEnvironment?: string;
  expoVersion?: string | null;
  nativeAppVersion?: string | null;
  nativeBuildVersion?: string | null;
};

export type BuildInfo = {
  commit: string;
  identifier: string;
  builtAt: string;
  nativeRuntime: string;
};

function nonBlankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The commit is injected by app.config.js while Expo creates a JavaScript
 * bundle. It identifies the JS running in this app, not a Render deployment.
 */
export function readBuildInfo(constants: ExpoBuildConstants): BuildInfo {
  const source = constants.expoConfig?.extra?.leadloopBuild;
  const commit = nonBlankString(source?.commit) ?? "unavailable";
  const builtAt = nonBlankString(source?.builtAt) ?? "unavailable";
  const identifier =
    nonBlankString(source?.identifier) ??
    (commit === "unavailable" ? "unavailable" : `${commit}-${builtAt}`);
  const nativeRuntime =
    constants.executionEnvironment === "storeClient"
      ? `Expo Go ${nonBlankString(constants.expoVersion) ?? "version unavailable"}`
      : `Native app ${nonBlankString(constants.nativeAppVersion) ?? "version unavailable"} (${nonBlankString(constants.nativeBuildVersion) ?? "build unavailable"})`;
  return { commit, identifier, builtAt, nativeRuntime };
}

export function shareableBuildInfo(info: BuildInfo) {
  return [
    "LeadLoop build information",
    `JavaScript commit: ${info.commit}`,
    `JavaScript build: ${info.identifier}`,
    `JavaScript bundle date: ${info.builtAt}`,
    `Native runtime: ${info.nativeRuntime}`,
  ].join("\n");
}
