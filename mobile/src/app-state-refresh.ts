/** SDK 58 types the initial React Native AppState as nullable during startup. */
export function shouldRefreshSupabaseForAppState(
  state: string | null | undefined,
) {
  return state === "active";
}
