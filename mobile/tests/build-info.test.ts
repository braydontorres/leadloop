import assert from "node:assert/strict";
import test from "node:test";
import { readBuildInfo, shareableBuildInfo } from "../src/build-info";

test("build information identifies the bundled JavaScript commit separately from Expo Go", () => {
  const info = readBuildInfo({
    executionEnvironment: "storeClient",
    expoVersion: "58.0.0",
    expoConfig: {
      extra: {
        leadloopBuild: {
          commit: "0dc83c050009",
          builtAt: "2026-10-22T12:00:00.000Z",
          identifier: "0dc83c050009-2026-10-22T12:00:00.000Z",
        },
      },
    },
  });
  assert.equal(info.commit, "0dc83c050009");
  assert.equal(info.nativeRuntime, "Expo Go 58.0.0");
  assert.match(shareableBuildInfo(info), /JavaScript commit: 0dc83c050009/);
});

test("missing injected build metadata is explicit rather than a placeholder SHA", () => {
  const info = readBuildInfo({ executionEnvironment: "standalone" });
  assert.equal(info.commit, "unavailable");
  assert.equal(info.identifier, "unavailable");
  assert.match(info.nativeRuntime, /^Native app /);
});
