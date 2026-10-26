const { execFileSync } = require("node:child_process");

// Keep one source of Expo configuration. A separate app.json alongside this
// dynamic build-information config makes Expo Doctor treat the project as
// having competing configuration sources.
const baseExpoConfig = {
  name: "LeadLoop",
  slug: "leadloop",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  scheme: "leadloop",
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.leadloop.app",
    infoPlist: {
      NSMicrophoneUsageDescription:
        "LeadLoop records only when you tap Capture so you can create a reminder.",
    },
  },
  plugins: ["expo-audio", "expo-secure-store"],
  extra: {
    eas: { projectId: "" },
  },
};

function gitShortSha() {
  if (process.env.EAS_BUILD_GIT_COMMIT_HASH) {
    return process.env.EAS_BUILD_GIT_COMMIT_HASH.slice(0, 12);
  }
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// Expo evaluates this when it creates the JavaScript bundle. It intentionally
// reads Git at bundle time instead of accepting a handwritten source constant.
module.exports = () => {
  const commit = gitShortSha();
  const builtAt = new Date().toISOString();
  return {
    ...baseExpoConfig,
    extra: {
      ...baseExpoConfig.extra,
      leadloopBuild: {
        commit,
        builtAt,
        identifier: commit ? `${commit}-${builtAt}` : null,
      },
    },
  };
};
