const { execFileSync } = require("node:child_process");
const base = require("./app.json");

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
    ...base.expo,
    extra: {
      ...base.expo.extra,
      leadloopBuild: {
        commit,
        builtAt,
        identifier: commit ? `${commit}-${builtAt}` : null,
      },
    },
  };
};
