export type NaturalSpeechRequestKind = "assistant_reply" | "preview";

const cooldowns = new Map<string, number>();

function cooldownKey(workspaceId: string, kind: NaturalSpeechRequestKind) {
  return `${workspaceId}:${kind}`;
}

export function activeNaturalSpeechCooldown(input: {
  workspaceId: string;
  kind: NaturalSpeechRequestKind;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const key = cooldownKey(input.workspaceId, input.kind);
  const until = cooldowns.get(key);
  if (!until || until <= now) {
    cooldowns.delete(key);
    return 0;
  }
  return Math.max(1, Math.ceil((until - now) / 1000));
}

/** Records only a server-supplied, bounded cooldown; no conversation data. */
export function setNaturalSpeechCooldown(input: {
  workspaceId: string;
  kind: NaturalSpeechRequestKind;
  retryAfterSeconds?: number;
  now?: number;
}) {
  const seconds = input.retryAfterSeconds;
  if (
    !Number.isSafeInteger(seconds) ||
    !seconds ||
    seconds < 1 ||
    seconds > 3_600
  )
    return;
  cooldowns.set(
    cooldownKey(input.workspaceId, input.kind),
    (input.now ?? Date.now()) + seconds * 1000,
  );
}

export function resetNaturalSpeechCooldownsForTest() {
  cooldowns.clear();
}
