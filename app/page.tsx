"use client";
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ArrowUpRight,
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Home,
  LayoutList,
  Mic,
  Plus,
  Search,
  Settings,
  Users,
  X,
  Trash2,
  Pencil,
  Keyboard,
  ShieldCheck,
  CalendarDays,
  Download,
  Menu,
  Leaf,
  AlertCircle,
  LoaderCircle,
  Square,
  RotateCcw,
  MessageCircle,
  Volume2,
  VolumeX,
  RotateCw,
} from "lucide-react";
import {
  Task,
  Person,
  Store,
  STORAGE_KEY,
  sampleStore,
  saveTask,
  DEFAULT_WORKING_DAYS,
  normalizeWorkingDays,
  migrateStore,
  persistStore,
  dateLabel,
  fromLocalInput,
  isToday,
  remindersForPerson,
  toLocalInput,
} from "../lib/tasks";
import {
  advanceQuoteMemory,
  emptyQuoteMemoryState,
  quoteAmountLabel,
  quoteForReminder,
  matchingQuotesForReminder,
  quotesForCustomer,
  saveQuote,
  type Quote,
} from "../lib/quotes";
import {
  advanceCustomerMemory,
  emptyCustomerMemoryState,
  findCustomer,
  saveCustomer,
} from "../lib/customer-memory";
import {
  advanceConversation,
  conversationContext,
  emptyConversationState,
  finishSpeech,
  startConversation,
  spokenReminder,
  type IntentResult,
} from "../lib/conversation-machine";
import {
  selectRecorderMimeType,
  supportedAudioFormat,
} from "../lib/audio-format";
import {
  advanceVoiceActivity,
  DEFAULT_VOICE_ACTIVITY_CONFIG,
  initialVoiceActivityState,
  rmsFromTimeDomain,
  type VoiceActivityConfig,
  type VoiceActivityState,
} from "../lib/voice-activity";
import {
  calendarFromLegacy,
  resolveCalendarExpression,
} from "../lib/calendar-expression";
import {
  getSupabaseBrowserClient,
  getSupabaseBrowserConfigurationError,
} from "../lib/cloud/supabase-browser";
import {
  createSupabaseWorkspaceRepository,
  type CloudWorkspaceSummary,
  type WorkspaceRepository,
} from "../lib/cloud/repository";
import {
  authErrorMessage,
  authRedirectUrl,
  clearPasswordRecoveryRequest,
  clearPasswordRecoverySession,
  completeAuthCallback,
  currentAuth,
  hasPasswordRecoveryRequest,
  hasPasswordRecoverySession,
  markPasswordRecoveryRequested,
  markPasswordRecoverySession,
  passwordRecoveryRedirectUrl,
  sendPasswordRecovery,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  updatePassword,
  validateNewPassword,
} from "../lib/cloud/auth";
import {
  importApprovedLocalWorkspace,
  previewLocalCloudImport,
} from "../lib/cloud/local-import";
import type { CloudImportPreview } from "../lib/cloud/types";
import {
  chooseWorkspaceRestoreTarget,
  clearSelectedCloudWorkspace,
  readSelectedCloudWorkspace,
  saveSelectedCloudWorkspace,
} from "../lib/cloud/workspace-selection";
type Screen = "Home" | "Capture" | "Tasks" | "People" | "Settings";
const nav = [
  { name: "Home", icon: Home },
  { name: "Capture", icon: AudioLines },
  { name: "Tasks", icon: LayoutList },
  { name: "People", icon: Users },
  { name: "Settings", icon: Settings },
] as const;
const configuredInactivityTimeout = Number(
  process.env.NEXT_PUBLIC_CONVERSATION_IDLE_TIMEOUT_MS,
);
// Configurable at build time, with a bounded default for the browser MVP.
const INACTIVITY_TIMEOUT_MS =
  Number.isFinite(configuredInactivityTimeout) &&
  configuredInactivityTimeout >= 10_000 &&
  configuredInactivityTimeout <= 300_000
    ? configuredInactivityTimeout
    : 45_000;
const configuredSilenceMs = Number(process.env.NEXT_PUBLIC_VOICE_SILENCE_MS);
const VOICE_SILENCE_MS =
  Number.isFinite(configuredSilenceMs) &&
  configuredSilenceMs >= 800 &&
  configuredSilenceMs <= 2_500
    ? configuredSilenceMs
    : DEFAULT_VOICE_ACTIVITY_CONFIG.silenceMs;
export default function Page() {
  const [store, setStore] = useState<Store | null>(null),
    [screen, setScreen] = useState<Screen>("Home"),
    [filter, setFilter] = useState("Upcoming"),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState<Task | null>(null),
    [person, setPerson] = useState<Person | null>(null),
    [quoteDraft, setQuoteDraft] = useState<Quote | null>(null),
    [text, setText] = useState(""),
    [notice, setNotice] = useState(""),
    [storageError, setStorageError] = useState(false),
    [menu, setMenu] = useState(false),
    [isRecording, setIsRecording] = useState(false),
    [recordingSeconds, setRecordingSeconds] = useState(0),
    [voiceBusy, setVoiceBusy] = useState(false),
    [voiceError, setVoiceError] = useState(""),
    [demoMode, setDemoMode] = useState(false),
    [assistantMessage, setAssistantMessage] = useState(""),
    [isSpeaking, setIsSpeaking] = useState(false),
    [muted, setMuted] = useState(false),
    [retryAfterSeconds, setRetryAfterSeconds] = useState(0),
    [sessionActive, setSessionActive] = useState(false),
    [speechDetected, setSpeechDetected] = useState(false),
    [microphoneStarting, setMicrophoneStarting] = useState(false),
    [conversation, setConversation] = useState(emptyConversationState),
    [customerMemory, setCustomerMemory] = useState(emptyCustomerMemoryState),
    [quoteMemory, setQuoteMemory] = useState(emptyQuoteMemoryState),
    [cloudClient] = useState(() => getSupabaseBrowserClient()),
    [cloudConfigurationError] = useState(() =>
      getSupabaseBrowserConfigurationError(),
    ),
    [cloudRepository, setCloudRepository] =
      useState<WorkspaceRepository | null>(null),
    [cloudWorkspaceId, setCloudWorkspaceId] = useState<string | null>(null),
    [cloudLoadedWorkspaceId, setCloudLoadedWorkspaceId] = useState<
      string | null
    >(null),
    [cloudUserEmail, setCloudUserEmail] = useState(""),
    [cloudRestoring, setCloudRestoring] = useState(Boolean(cloudClient)),
    [cloudWorkspaces, setCloudWorkspaces] = useState<CloudWorkspaceSummary[]>(
      [],
    ),
    [cloudEmail, setCloudEmail] = useState(""),
    [cloudPassword, setCloudPassword] = useState(""),
    [cloudPasswordConfirmation, setCloudPasswordConfirmation] = useState(""),
    [cloudRecoveryActive, setCloudRecoveryActive] = useState(false),
    [cloudMode, setCloudMode] = useState<
      "sign_in" | "sign_up" | "recover" | "new_password"
    >("sign_in"),
    [cloudBusy, setCloudBusy] = useState(false),
    [cloudError, setCloudError] = useState(""),
    [cloudSyncState, setCloudSyncState] = useState<
      "idle" | "saving" | "saved" | "error"
    >("idle"),
    [cloudImportPreview, setCloudImportPreview] =
      useState<CloudImportPreview | null>(null),
    [newWorkspaceName, setNewWorkspaceName] = useState(""),
    [newWorkspaceBusiness, setNewWorkspaceBusiness] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRecordingRef = useRef(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingLimitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoListenRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysisSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analysisFilterRef = useRef<BiquadFilterNode | null>(null);
  const recordingFinalizedRef = useRef(false);
  const voiceActivityRef = useRef<VoiceActivityState>(
    initialVoiceActivityState(),
  );
  const voiceDetectionAvailableRef = useRef(false);
  const recordingEndReasonRef = useRef<
    "manual" | "silence" | "no_speech" | "limit" | "cancel"
  >("manual");
  const submissionRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const voiceBusyRef = useRef(false);
  const microphoneStartingRef = useRef(false);
  const nextTurnIdRef = useRef(0);
  const activeTurnIdRef = useRef<number | null>(null);
  const nextMicrophoneRequestIdRef = useRef(0);
  const activeMicrophoneRequestIdRef = useRef(0);
  const nextSessionIdRef = useRef(0);
  const activeSessionIdRef = useRef(0);
  const speechPlaybackIdRef = useRef(0);
  const nextRequestIdRef = useRef(0);
  const activeRequestIdRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const turnTimingRef = useRef<{
    recordingStartedAt?: number;
    speechDetectedAt?: number;
    finalizedAt?: number;
    requestStartedAt?: number;
    replyStartedAt?: number;
  }>({});
  const sessionActiveRef = useRef(false);
  const conversationRef = useRef(conversation);
  const customerMemoryRef = useRef(customerMemory);
  const quoteMemoryRef = useRef(quoteMemory);
  const pendingQuoteLinkRef = useRef<{
    reminderId: string;
    quoteIds: string[];
  } | null>(null);
  const selectedQuoteLinkRef = useRef<{
    reminderId: string;
    quoteId: string;
  } | null>(null);
  const storeRef = useRef<Store | null>(store);
  const localStoreRef = useRef<Store | null>(null);
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudLoadGenerationRef = useRef(0);
  const cloudAuthGenerationRef = useRef(0);
  const cloudSyncGenerationRef = useRef(0);
  const cloudUserIdRef = useRef("");
  const cloudRecoveryActiveRef = useRef(false);
  const authCallbackStartedRef = useRef(false);
  const cloudRefreshRef = useRef<() => void | Promise<void>>(() => {});
  const cloudLoadedWorkspaceIdRef = useRef<string | null>(null);
  const cloudSkipNextSaveRef = useRef<string | null>(null);
  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cloudBaselineStoreRef = useRef<Store | null>(null);
  const enterPasswordRecovery = (user: {
    id: string;
    email?: string | null;
  }) => {
    // A recovery session must not trigger workspace restoration or cloud writes.
    cloudAuthGenerationRef.current += 1;
    cloudLoadGenerationRef.current += 1;
    cloudSyncGenerationRef.current += 1;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudUserIdRef.current = user.id;
    cloudRecoveryActiveRef.current = true;
    markPasswordRecoverySession(localStorage, user.id);
    clearPasswordRecoveryRequest(localStorage);
    cloudBaselineStoreRef.current = null;
    cloudSkipNextSaveRef.current = null;
    cloudLoadedWorkspaceIdRef.current = null;
    setCloudUserEmail(user.email ?? "");
    setCloudRecoveryActive(true);
    setCloudMode("new_password");
    setCloudPassword("");
    setCloudPasswordConfirmation("");
    setCloudWorkspaces([]);
    setCloudWorkspaceId(null);
    setCloudLoadedWorkspaceId(null);
    setCloudSyncState("idle");
    setCloudRestoring(false);
    setScreen("Settings");
    const local = localStoreRef.current;
    if (local) setStore(local);
  };
  const activateCloudWorkspace = async (
    workspaceId: string,
    options: {
      repository?: WorkspaceRepository | null;
      userId?: string;
      authGeneration?: number;
      announce?: boolean;
    } = {},
  ) => {
    const repository = options.repository ?? cloudRepository;
    const userId = options.userId ?? cloudUserIdRef.current;
    if (
      !repository ||
      !userId ||
      (options.authGeneration !== undefined &&
        options.authGeneration !== cloudAuthGenerationRef.current)
    )
      return false;
    const generation = ++cloudLoadGenerationRef.current;
    const previousLoadedWorkspaceId = cloudLoadedWorkspaceIdRef.current;
    cloudSyncGenerationRef.current += 1;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    setCloudBusy(true);
    setCloudError("");
    cloudLoadedWorkspaceIdRef.current = null;
    setCloudLoadedWorkspaceId(null);
    try {
      const cloudStore = await repository.loadStore(workspaceId);
      if (
        generation !== cloudLoadGenerationRef.current ||
        cloudUserIdRef.current !== userId ||
        (options.authGeneration !== undefined &&
          options.authGeneration !== cloudAuthGenerationRef.current)
      )
        return false;
      cloudBaselineStoreRef.current = cloudStore;
      cloudSkipNextSaveRef.current = workspaceId;
      cloudLoadedWorkspaceIdRef.current = workspaceId;
      setCloudWorkspaceId(workspaceId);
      setCloudLoadedWorkspaceId(workspaceId);
      setStore(cloudStore);
      storeRef.current = cloudStore;
      setCloudImportPreview(null);
      setCloudSyncState("saved");
      saveSelectedCloudWorkspace(localStorage, userId, workspaceId);
      if (options.announce !== false)
        setNotice(
          "Cloud workspace loaded. Local browser data was left unchanged.",
        );
      return true;
    } catch (error) {
      if (
        generation === cloudLoadGenerationRef.current &&
        cloudUserIdRef.current === userId &&
        (options.authGeneration === undefined ||
          options.authGeneration === cloudAuthGenerationRef.current)
      ) {
        // A failed manual switch leaves the previously loaded cloud store
        // authoritative instead of exposing a half-selected workspace.
        cloudLoadedWorkspaceIdRef.current = previousLoadedWorkspaceId;
        setCloudLoadedWorkspaceId(previousLoadedWorkspaceId);
        setCloudError(
          `Could not load this workspace: ${(error as Error).message}`,
        );
      }
      return false;
    } finally {
      if (generation === cloudLoadGenerationRef.current) setCloudBusy(false);
    }
  };
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);
  useEffect(() => {
    customerMemoryRef.current = customerMemory;
  }, [customerMemory]);
  useEffect(() => {
    quoteMemoryRef.current = quoteMemory;
  }, [quoteMemory]);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const migrated = migrateStore(saved);
        new Intl.DateTimeFormat("en", { timeZone: migrated.timezone });
        if (JSON.stringify(saved) !== JSON.stringify(migrated)) {
          try {
            const backupKey = `${STORAGE_KEY}.backup.v1`;
            if (!localStorage.getItem(backupKey))
              localStorage.setItem(backupKey, raw);
          } catch {
            // Keep the migrated workspace in memory, but do not claim it is safely persisted.
            setStorageError(true);
          }
        }
        localStoreRef.current = migrated;
        setStore(migrated);
      } else {
        const seeded = sampleStore();
        localStoreRef.current = seeded;
        setStore(seeded);
      }
    } catch {
      setStorageError(true);
      const seeded = sampleStore();
      localStoreRef.current = seeded;
      setStore(seeded);
    }
  }, []);
  useEffect(() => {
    if (!store || storageError || cloudWorkspaceId) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      localStoreRef.current = store;
    } catch {
      setStorageError(true);
    }
  }, [store, storageError, cloudWorkspaceId]);
  useEffect(() => {
    if (!cloudClient || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const isAuthCallback =
      url.searchParams.get("auth_callback") === "1" ||
      Boolean(url.searchParams.get("code")) ||
      Boolean(fragment.get("access_token")) ||
      Boolean(url.searchParams.get("type")) ||
      Boolean(url.searchParams.get("error")) ||
      Boolean(url.searchParams.get("error_description")) ||
      Boolean(fragment.get("error")) ||
      Boolean(fragment.get("error_description"));
    if (!isAuthCallback || authCallbackStartedRef.current) return;
    authCallbackStartedRef.current = true;
    let active = true;
    const recoveryIntent =
      url.searchParams.get("flow") === "recovery" ||
      (!url.searchParams.get("type") &&
        hasPasswordRecoveryRequest(sessionStorage));
    const clearCallbackUrl = () => {
      [
        "auth_callback",
        "code",
        "type",
        "flow",
        "error",
        "error_description",
      ].forEach((name) => url.searchParams.delete(name));
      window.history.replaceState(
        {},
        document.title,
        `${url.pathname}${url.search}`,
      );
    };
    setCloudBusy(true);
    setCloudError("");
    void completeAuthCallback(cloudClient, window.location.href, {
      recoveryIntent,
    })
      .then((result) => {
        if (!active) return;
        clearCallbackUrl();
        if (result.kind === "recovery") {
          if (!result.session?.user)
            throw new Error(
              "This recovery link did not create a valid recovery session. Request a new link and open it in this browser.",
            );
          enterPasswordRecovery(result.session.user);
          setNotice("Set a new password to finish recovering your account.");
          return;
        }
        clearPasswordRecoveryRequest(sessionStorage);
        if (result.kind === "confirmation") {
          setCloudMode("sign_in");
          setCloudUserEmail(result.session?.user.email ?? "");
          setNotice(
            result.session
              ? "Email confirmed. You are signed in."
              : "Email confirmed. Sign in to continue.",
          );
        }
      })
      .catch((error) => {
        if (!active) return;
        clearCallbackUrl();
        clearPasswordRecoveryRequest(sessionStorage);
        setCloudError(authErrorMessage(error));
        setCloudMode("recover");
        setScreen("Settings");
      })
      .finally(() => {
        if (active) setCloudBusy(false);
      });
    return () => {
      active = false;
    };
  }, [cloudClient]);
  useEffect(() => {
    if (!cloudClient) return;
    const repository = createSupabaseWorkspaceRepository(cloudClient);
    setCloudRepository(repository);
    const returnToLocalWorkspace = () => {
      cloudLoadGenerationRef.current += 1;
      cloudSyncGenerationRef.current += 1;
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
      cloudBaselineStoreRef.current = null;
      cloudSkipNextSaveRef.current = null;
      setCloudWorkspaces([]);
      cloudLoadedWorkspaceIdRef.current = null;
      setCloudWorkspaceId(null);
      setCloudLoadedWorkspaceId(null);
      setCloudSyncState("idle");
      const local = localStoreRef.current;
      if (local) setStore(local);
    };
    const refresh = async () => {
      const generation = ++cloudAuthGenerationRef.current;
      setCloudRestoring(true);
      try {
        const auth = await currentAuth(cloudClient);
        if (generation !== cloudAuthGenerationRef.current) return;
        const user = auth.user;
        if (!user) {
          cloudUserIdRef.current = "";
          setCloudUserEmail("");
          returnToLocalWorkspace();
          return;
        }
        const isDifferentUser = cloudUserIdRef.current !== user.id;
        if (isDifferentUser) returnToLocalWorkspace();
        cloudUserIdRef.current = user.id;
        setCloudUserEmail(user.email ?? "");
        if (hasPasswordRecoverySession(sessionStorage, user.id)) {
          enterPasswordRecovery(user);
          return;
        }
        const workspaces = await repository.listWorkspaces();
        if (
          generation !== cloudAuthGenerationRef.current ||
          cloudUserIdRef.current !== user.id
        )
          return;
        setCloudWorkspaces(workspaces);
        const savedWorkspaceId = readSelectedCloudWorkspace(
          localStorage,
          user.id,
        );
        const target = chooseWorkspaceRestoreTarget(
          workspaces,
          savedWorkspaceId,
        );
        if (target.kind !== "selection_required") {
          const restored = await activateCloudWorkspace(target.workspaceId, {
            repository,
            userId: user.id,
            authGeneration: generation,
            announce: false,
          });
          if (!restored && generation === cloudAuthGenerationRef.current) {
            // A load can fail after the membership list was read. Check once
            // more before clearing the preference: a transient network error
            // keeps the remembered workspace available for a later retry.
            try {
              const currentWorkspaces = await repository.listWorkspaces();
              if (generation !== cloudAuthGenerationRef.current) return;
              setCloudWorkspaces(currentWorkspaces);
              if (
                !currentWorkspaces.some(
                  (workspace) => workspace.id === target.workspaceId,
                )
              ) {
                clearSelectedCloudWorkspace(localStorage, user.id);
                const fallback = chooseWorkspaceRestoreTarget(
                  currentWorkspaces,
                  null,
                );
                if (fallback.kind !== "selection_required") {
                  await activateCloudWorkspace(fallback.workspaceId, {
                    repository,
                    userId: user.id,
                    authGeneration: generation,
                    announce: false,
                  });
                  return;
                }
                returnToLocalWorkspace();
                cloudUserIdRef.current = user.id;
                setCloudUserEmail(user.email ?? "");
                setCloudWorkspaces(currentWorkspaces);
                setNotice(
                  "Your previous cloud workspace is no longer available. Choose an authorized workspace.",
                );
              }
            } catch {
              // The original load error remains visible. Do not erase a valid
              // remembered choice when the follow-up authorization check fails.
            }
            setScreen("Settings");
          }
          return;
        }
        if (savedWorkspaceId)
          clearSelectedCloudWorkspace(localStorage, user.id);
        returnToLocalWorkspace();
        cloudUserIdRef.current = user.id;
        setCloudUserEmail(user.email ?? "");
        setCloudWorkspaces(workspaces);
        setScreen("Settings");
        if (savedWorkspaceId)
          setNotice(
            "Your previous cloud workspace is no longer available. Choose an authorized workspace.",
          );
      } catch (error) {
        if (generation === cloudAuthGenerationRef.current)
          setCloudError(
            `Could not restore cloud workspaces: ${(error as Error).message}`,
          );
      } finally {
        if (generation === cloudAuthGenerationRef.current)
          setCloudRestoring(false);
      }
    };
    cloudRefreshRef.current = refresh;
    void refresh();
    const { data } = cloudClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user) {
        enterPasswordRecovery(session.user);
        return;
      }
      if (cloudRecoveryActiveRef.current) return;
      void refresh();
    });
    return () => {
      cloudRefreshRef.current = () => {};
      data.subscription.unsubscribe();
    };
  }, [cloudClient]);
  useEffect(() => {
    if (
      !store ||
      !cloudRepository ||
      cloudRestoring ||
      !cloudWorkspaceId ||
      cloudLoadedWorkspaceId !== cloudWorkspaceId
    )
      return;
    if (cloudSkipNextSaveRef.current === cloudWorkspaceId) {
      cloudSkipNextSaveRef.current = null;
      return;
    }
    const generation = ++cloudSyncGenerationRef.current;
    const baseline = cloudBaselineStoreRef.current;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    setCloudSyncState("saving");
    cloudSyncTimerRef.current = setTimeout(() => {
      const save = async () => {
        try {
          await cloudRepository.saveStore(cloudWorkspaceId, store, baseline);
          if (generation === cloudSyncGenerationRef.current) {
            cloudBaselineStoreRef.current = store;
            setCloudSyncState("saved");
          }
        } catch (error) {
          if (generation !== cloudSyncGenerationRef.current) return;
          setCloudSyncState("error");
          setCloudError(`Cloud save failed: ${(error as Error).message}`);
        }
      };
      // Serialize snapshots. A delayed earlier request can never finish after
      // a newer snapshot and restore stale customer, quote, or task data.
      cloudSaveQueueRef.current = cloudSaveQueueRef.current
        .catch(() => undefined)
        .then(save);
    }, 350);
    return () => {
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    };
  }, [
    store,
    cloudRepository,
    cloudRestoring,
    cloudWorkspaceId,
    cloudLoadedWorkspaceId,
  ]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!retryAfterSeconds) return;
    const timer = setInterval(
      () => setRetryAfterSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [retryAfterSeconds]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDraft(null);
        setPerson(null);
        setQuoteDraft(null);
        setMenu(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!draft && !person && !quoteDraft) return;
    const previous = document.activeElement as HTMLElement | null;
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const dialog = document.querySelector("[role=dialog]");
      const items = dialog?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input, textarea, select, [href]",
      );
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trap);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [!!draft, !!person, !!quoteDraft]);
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordingLimitRef.current) clearTimeout(recordingLimitRef.current);
      if (autoListenRef.current) clearTimeout(autoListenRef.current);
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      requestAbortRef.current?.abort();
      if (analysisFrameRef.current)
        cancelAnimationFrame(analysisFrameRef.current);
      analysisSourceRef.current?.disconnect();
      analysisFilterRef.current?.disconnect();
      void audioContextRef.current?.close();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);
  if (!store || cloudRestoring)
    return (
      <main className="loading" aria-live="polite">
        <AudioLines size={32} />
        <p>
          {cloudRestoring
            ? "Restoring your cloud workspace…"
            : "Getting your day ready…"}
        </p>
      </main>
    );
  const timezone = store.timezone,
    active = store.tasks.filter((t) => !t.completed),
    today = active.filter((t) => isToday(t.due, timezone)),
    overdue = active.filter(
      (t) => t.due && new Date(t.due) < new Date() && !isToday(t.due, timezone),
    ),
    upcoming = active
      .filter(
        (t) =>
          !isToday(t.due, timezone) && (!t.due || new Date(t.due) > new Date()),
      )
      .sort((a, b) => (a.due || "z").localeCompare(b.due || "z"));
  const activeReminder = conversation.activeReminder;
  const customerReminders = person
    ? remindersForPerson(store.tasks, store.people, person)
    : [];
  const upcomingCustomerReminders = customerReminders.filter(
    (task) => !task.completed,
  );
  const completedCustomerReminders = customerReminders.filter(
    (task) => task.completed,
  );
  const customerQuotes = person
    ? quotesForCustomer(store.quotes, person.id)
    : [];
  const isOverdueReminder = (task: Task) =>
    Boolean(task.due) && new Date(task.due) < new Date();
  const voicePhase =
    conversation.stage === "ended"
      ? "Ended"
      : !sessionActive
        ? "Paused"
        : isSpeaking
          ? "Speaking"
          : voiceBusy
            ? "Thinking"
            : isRecording
              ? speechDetected
                ? "Hearing you"
                : "Listening"
              : "Paused";
  // The former review-card collections are deliberately empty: the active
  // conversation above is now the only authoritative reminder surface.
  const reviewItems: any[] = [];
  const pendingClarifications: any[] = [];
  const cancelIds: string[] = [];
  const go = (s: Screen) => {
    setScreen(s);
    setSearch("");
    setMenu(false);
  };
  const submitCloudAuth = async () => {
    if (!cloudClient) return;
    setCloudBusy(true);
    setCloudError("");
    try {
      const redirectTo = authRedirectUrl(window.location.origin);
      const recoveryRedirectTo = passwordRecoveryRedirectUrl(
        window.location.origin,
      );
      if (cloudMode === "sign_up") {
        const result = await signUpWithEmail(
          cloudClient,
          cloudEmail.trim(),
          cloudPassword,
          redirectTo,
        );
        setCloudPassword("");
        setNotice(
          result.session
            ? "Account created and signed in."
            : "Check your email to confirm your account, then sign in.",
        );
      } else if (cloudMode === "recover") {
        await sendPasswordRecovery(
          cloudClient,
          cloudEmail.trim(),
          recoveryRedirectTo,
        );
        markPasswordRecoveryRequested(sessionStorage);
        setNotice(
          "Password reset email sent. Open it in this browser to choose a new password.",
        );
      } else if (cloudMode === "new_password") {
        if (!cloudRecoveryActiveRef.current)
          throw new Error(
            "Open a valid password recovery link before setting a new password.",
          );
        const password = validateNewPassword(
          cloudPassword,
          cloudPasswordConfirmation,
        );
        await updatePassword(cloudClient, password);
        clearPasswordRecoverySession(sessionStorage);
        cloudRecoveryActiveRef.current = false;
        setCloudRecoveryActive(false);
        setCloudMode("sign_in");
        setCloudPassword("");
        setCloudPasswordConfirmation("");
        setNotice("Password updated. You are signed in and can continue.");
        void cloudRefreshRef.current();
      } else {
        await signInWithEmail(cloudClient, cloudEmail.trim(), cloudPassword);
        setCloudPassword("");
        setNotice("Signed in successfully.");
      }
    } catch (error) {
      setCloudError(authErrorMessage(error));
    } finally {
      setCloudBusy(false);
    }
  };
  const createCloudWorkspace = async () => {
    if (!cloudRepository) return;
    setCloudBusy(true);
    setCloudError("");
    try {
      const created = await cloudRepository.createWorkspace({
        name: newWorkspaceName || newWorkspaceBusiness || "LeadLoop workspace",
        businessName: newWorkspaceBusiness,
        ownerName: store?.name ?? "",
      });
      setCloudWorkspaces(await cloudRepository.listWorkspaces());
      await activateCloudWorkspace(created.id);
    } catch (error) {
      setCloudError((error as Error).message);
    } finally {
      setCloudBusy(false);
    }
  };
  const previewCloudImport = async () => {
    const local = localStoreRef.current;
    if (!local) return;
    try {
      setCloudImportPreview(await previewLocalCloudImport(local));
      setCloudError("");
    } catch (error) {
      setCloudError((error as Error).message);
    }
  };
  const confirmCloudImport = async () => {
    const local = localStoreRef.current;
    if (!local || !cloudRepository || !cloudWorkspaceId || !cloudImportPreview)
      return;
    if (
      !window.confirm(
        "Import this preview into the selected cloud workspace? Browser data will remain on this device.",
      )
    )
      return;
    setCloudBusy(true);
    setCloudError("");
    try {
      const outcome = await importApprovedLocalWorkspace({
        storage: localStorage,
        workspaceId: cloudWorkspaceId,
        store: local,
        approved: true,
        gateway: cloudRepository,
      });
      await activateCloudWorkspace(cloudWorkspaceId);
      setNotice(
        outcome.result.duplicate
          ? "This browser backup was already imported and verified."
          : "Local data imported and verified in the cloud workspace.",
      );
      setCloudImportPreview(null);
    } catch (error) {
      setCloudError((error as Error).message);
    } finally {
      setCloudBusy(false);
    }
  };
  const leaveCloudAccount = async () => {
    if (!cloudClient) return;
    setCloudBusy(true);
    try {
      await signOut(cloudClient);
      cloudAuthGenerationRef.current += 1;
      cloudLoadGenerationRef.current += 1;
      cloudSyncGenerationRef.current += 1;
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
      cloudUserIdRef.current = "";
      cloudRecoveryActiveRef.current = false;
      clearPasswordRecoveryRequest(sessionStorage);
      clearPasswordRecoverySession(sessionStorage);
      setCloudRecoveryActive(false);
      cloudBaselineStoreRef.current = null;
      cloudSkipNextSaveRef.current = null;
      setCloudUserEmail("");
      cloudLoadedWorkspaceIdRef.current = null;
      setCloudWorkspaceId(null);
      setCloudLoadedWorkspaceId(null);
      setCloudWorkspaces([]);
      setCloudSyncState("idle");
      const local = localStoreRef.current;
      if (local) setStore(local);
      setNotice("Signed out. Your browser-local workspace is available again.");
    } catch (error) {
      setCloudError((error as Error).message);
    } finally {
      setCloudBusy(false);
    }
  };
  const newTask = () =>
    setDraft({
      id: crypto.randomUUID(),
      title: "",
      person: "",
      due: "",
      completed: false,
      notes: "",
    });
  const toggle = (id: string) =>
    setStore({
      ...store,
      tasks: store.tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t,
      ),
    });
  const commit = () => {
    if (!draft) return;
    try {
      if (conversation.activeReminder?.id === draft.id) {
        const updatedReminder = {
          id: draft.id,
          title: draft.title.trim(),
          person: draft.person,
          due: draft.due,
          notes: draft.notes,
          pendingDate: conversation.activeReminder?.pendingDate ?? null,
          pendingTime: conversation.activeReminder?.pendingTime ?? null,
          pendingDateConstraint:
            conversation.activeReminder?.pendingDateConstraint ?? null,
          calendar: calendarFromLegacy({
            timeZone: timezone,
            due: draft.due,
            pendingDate: conversation.activeReminder?.pendingDate ?? null,
            pendingTime: conversation.activeReminder?.pendingTime ?? null,
            pendingDateConstraint:
              conversation.activeReminder?.pendingDateConstraint ?? null,
          }),
        };
        if (!updatedReminder.title) throw new Error("Give your task a name.");
        const reply = updatedReminder.due
          ? spokenReminder(updatedReminder, timezone)
          : "Sure! When would you like me to remind you?";
        setConversation((current) => ({
          ...current,
          activeReminder: updatedReminder,
          stage: updatedReminder.due ? "reading_back" : "awaiting_details",
        }));
        setDraft(null);
        setAssistantMessage(reply);
        speakReply(
          reply,
          Boolean(updatedReminder.due),
          sessionActiveRef.current,
        );
        return;
      }
      const lookup = draft.person
        ? findCustomer(store.people, draft.person)
        : { kind: "none" as const };
      setStore({
        ...store,
        tasks: saveTask(store.tasks, {
          ...draft,
          title: draft.title.trim(),
          ...(lookup.kind === "one"
            ? { person: lookup.person.name, personId: lookup.person.id }
            : {}),
        }),
      });
      setDraft(null);
      setText("");
      setNotice(
        cloudWorkspaceId
          ? "Reminder queued for cloud save."
          : "Task saved on this device.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const logVoiceTiming = (event: string, values: Record<string, number>) => {
    console.info(
      "[LeadLoop voice timing]",
      JSON.stringify({ event, ...values }),
    );
  };
  const logVoiceTurn = (
    turnId: number | null,
    stage: string,
    values: Record<string, number | string> = {},
  ) => {
    console.info(
      "[LeadLoop voice turn]",
      JSON.stringify({
        sessionId: activeSessionIdRef.current,
        turnId: turnId ?? "text",
        stage,
        ...values,
      }),
    );
  };
  const cancelSpeechPlayback = () => {
    speechPlaybackIdRef.current += 1;
    window.speechSynthesis?.cancel();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  };
  const speakReply = (
    reply: string,
    readsBack: boolean,
    resumeListening = false,
    turnId: number | null = null,
  ) => {
    const preparedAt = performance.now();
    const playbackId = ++speechPlaybackIdRef.current;
    let completed = false;
    let speechStarted = false;
    let playbackWatchdog: ReturnType<typeof setTimeout> | null = null;
    const complete = (reason = "finished") => {
      if (completed || playbackId !== speechPlaybackIdRef.current) return;
      completed = true;
      if (playbackWatchdog) clearTimeout(playbackWatchdog);
      const completedAt = performance.now();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      logVoiceTurn(turnId, "speech_playback_finished", {
        reason,
        playbackMs: Math.round(completedAt - preparedAt),
      });
      if (readsBack) {
        setConversation((current) => {
          const next = finishSpeech(current);
          conversationRef.current = next;
          return next;
        });
      }
      if (resumeListening && sessionActiveRef.current)
        scheduleAutoListen(completedAt, turnId);
    };
    if (muted || typeof window === "undefined" || !window.speechSynthesis) {
      complete(muted ? "muted" : "unavailable");
      return;
    }
    // Invalidate callbacks from a previous utterance before canceling it. A
    // canceled utterance may still fire onerror asynchronously.
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.onstart = () => {
      if (playbackId !== speechPlaybackIdRef.current) return;
      speechStarted = true;
      logVoiceTurn(turnId, "speech_playback_started", {
        preparationMs: Math.round(performance.now() - preparedAt),
      });
    };
    utterance.onend = () => complete("finished");
    utterance.onerror = () => {
      if (playbackId !== speechPlaybackIdRef.current) return;
      setVoiceError(
        "LeadLoop couldn't play that response aloud. The response is shown below; you can replay it or continue speaking.",
      );
      complete("error");
    };
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    playbackWatchdog = setTimeout(() => {
      if (speechStarted || playbackId !== speechPlaybackIdRef.current) return;
      setVoiceError(
        "LeadLoop couldn't start audio playback. The response is shown below; you can replay it or continue speaking.",
      );
      complete("not_started");
    }, 1_500);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      setVoiceError(
        "LeadLoop couldn't start audio playback. The response is shown below; you can replay it or continue speaking.",
      );
      complete("exception");
    }
  };
  const commitLocalStore = (next: Store) => {
    if (cloudWorkspaceId) {
      storeRef.current = next;
      setStore(next);
      return true;
    }
    if (persistStore(localStorage, next)) {
      storeRef.current = next;
      setStore(next);
      setStorageError(false);
      return true;
    }
    setStorageError(true);
    setVoiceError(
      "LeadLoop couldn't save that change in this browser. Your pending change is still available to retry.",
    );
    return false;
  };
  const handleQuoteInput = (
    transcript: string,
    turnId: number | null = null,
  ) => {
    const currentStore = storeRef.current;
    if (!currentStore) return false;
    const transition = advanceQuoteMemory({
      state: quoteMemoryRef.current,
      text: transcript,
      people: currentStore.people,
      quotes: currentStore.quotes,
      createId: () => crypto.randomUUID(),
    });
    if (!transition.handled) return false;
    if (transition.savedQuote) {
      const nextStore = {
        ...currentStore,
        quotes: saveQuote(currentStore.quotes, transition.savedQuote),
      };
      if (!commitLocalStore(nextStore)) return true;
      setNotice(
        cloudWorkspaceId
          ? "Estimate queued for cloud save."
          : "Estimate saved on this device.",
      );
    }
    quoteMemoryRef.current = transition.state;
    setQuoteMemory(transition.state);
    setAssistantMessage(transition.reply);
    speakReply(transition.reply, false, sessionActiveRef.current, turnId);
    return true;
  };
  const handlePendingQuoteLink = (
    transcript: string,
    turnId: number | null = null,
  ) => {
    const pending = pendingQuoteLinkRef.current;
    const currentStore = storeRef.current;
    const active = conversationRef.current.activeReminder;
    if (
      !pending ||
      !currentStore ||
      !active ||
      active.id !== pending.reminderId
    )
      return false;
    const selected = currentStore.quotes.find(
      (quote) =>
        pending.quoteIds.includes(quote.id) &&
        transcript
          .toLocaleLowerCase()
          .includes(quote.serviceDescription.toLocaleLowerCase()),
    );
    if (!selected) {
      const reply = "Which estimate should this reminder be linked to?";
      setAssistantMessage(reply);
      speakReply(reply, false, sessionActiveRef.current, turnId);
      return true;
    }
    pendingQuoteLinkRef.current = null;
    selectedQuoteLinkRef.current = {
      reminderId: active.id,
      quoteId: selected.id,
    };
    const next = {
      ...conversationRef.current,
      stage: "awaiting_confirmation" as const,
    };
    conversationRef.current = next;
    setConversation(next);
    const reply = `Okay, I’ll link this reminder to the ${selected.serviceDescription} estimate. Is that correct?`;
    setAssistantMessage(reply);
    speakReply(reply, true, sessionActiveRef.current, turnId);
    return true;
  };
  const handleCustomerInput = (
    transcript: string,
    turnId: number | null = null,
  ) => {
    const currentStore = storeRef.current;
    if (!currentStore) return false;
    const transition = advanceCustomerMemory({
      state: customerMemoryRef.current,
      text: transcript,
      people: currentStore.people,
      createId: () => crypto.randomUUID(),
    });
    if (!transition.handled) return false;
    if (transition.savedPerson) {
      const nextStore = {
        ...currentStore,
        people: saveCustomer(currentStore.people, transition.savedPerson),
      };
      if (!commitLocalStore(nextStore)) return true;
      customerMemoryRef.current = transition.state;
      setCustomerMemory(transition.state);
      setNotice(
        cloudWorkspaceId
          ? "Customer change queued for cloud save."
          : "Customer information saved on this device.",
      );
    } else {
      customerMemoryRef.current = transition.state;
      setCustomerMemory(transition.state);
    }
    setAssistantMessage(transition.reply);
    speakReply(transition.reply, false, sessionActiveRef.current, turnId);
    return true;
  };
  const handleAssistantResult = (
    transcript: string,
    result: IntentResult,
    turnId: number | null = null,
  ) => {
    try {
      if (handlePendingQuoteLink(transcript, turnId)) return;
      if (handleQuoteInput(transcript, turnId)) return;
      if (handleCustomerInput(transcript, turnId)) return;
      const previous = conversationRef.current;
      const confirmingCustomerReminder =
        previous.stage === "awaiting_confirmation" &&
        result.intent.kind === "confirm" &&
        previous.activeReminder?.person;
      if (confirmingCustomerReminder && storeRef.current) {
        const lookup = findCustomer(
          storeRef.current.people,
          previous.activeReminder!.person,
        );
        if (lookup.kind === "ambiguous") {
          const reply = `I found more than one customer named ${previous.activeReminder!.person}. Which one should this reminder be linked to?`;
          setAssistantMessage(reply);
          speakReply(reply, false, sessionActiveRef.current, turnId);
          return;
        }
        if (lookup.kind === "one") {
          const matches = matchingQuotesForReminder({
            quotes: storeRef.current.quotes,
            customerId: lookup.person.id,
            title: previous.activeReminder!.title,
            notes: previous.activeReminder!.notes,
          });
          const selected = selectedQuoteLinkRef.current;
          if (
            matches.length > 1 &&
            (!selected || selected.reminderId !== previous.activeReminder!.id)
          ) {
            pendingQuoteLinkRef.current = {
              reminderId: previous.activeReminder!.id,
              quoteIds: matches.map((quote) => quote.id),
            };
            const reply = `I found more than one matching estimate for ${lookup.person.name}. Which service should this reminder be linked to?`;
            setAssistantMessage(reply);
            speakReply(reply, false, sessionActiveRef.current, turnId);
            return;
          }
        }
      }
      const transition = advanceConversation({
        state: previous,
        result,
        text: transcript,
        timeZone: timezone,
        createId: () => crypto.randomUUID(),
      });
      if (transition.savedTask && storeRef.current) {
        const lookup = transition.savedTask.person
          ? findCustomer(storeRef.current.people, transition.savedTask.person)
          : { kind: "none" as const };
        const savedTask =
          lookup.kind === "one"
            ? (() => {
                const quote = quoteForReminder({
                  quotes: storeRef.current!.quotes,
                  customerId: lookup.person.id,
                  title: transition.savedTask!.title,
                  notes: transition.savedTask!.notes,
                });
                return {
                  ...transition.savedTask,
                  person: lookup.person.name,
                  personId: lookup.person.id,
                  ...(selectedQuoteLinkRef.current?.reminderId ===
                  transition.savedTask!.id
                    ? { quoteId: selectedQuoteLinkRef.current.quoteId }
                    : quote
                      ? { quoteId: quote.id }
                      : {}),
                };
              })()
            : transition.savedTask;
        setStore({
          ...storeRef.current,
          tasks: saveTask(storeRef.current.tasks, savedTask),
        });
        if (
          selectedQuoteLinkRef.current?.reminderId === transition.savedTask.id
        )
          selectedQuoteLinkRef.current = null;
      }
      conversationRef.current = transition.state;
      setConversation(transition.state);
      const resolution = transition.state.activeReminder
        ? resolveCalendarExpression(transition.state.activeReminder.calendar)
        : null;
      logVoiceTurn(turnId, "conversation_accepted", {
        fromStage: previous.stage,
        toStage: transition.state.stage,
        activeDraft: transition.state.activeReminder ? "present" : "none",
        resolution: resolution?.kind ?? "saved_or_ended",
      });
      setAssistantMessage(transition.reply);
      if (transition.state.stage === "ended") {
        stopConversationSession();
        speakReply(transition.reply, false, false, turnId);
      } else {
        speakReply(
          transition.reply,
          transition.state.stage === "reading_back",
          sessionActiveRef.current,
          turnId,
        );
      }
      if (transition.savedTask)
        setNotice(
          cloudWorkspaceId
            ? "Reminder queued for cloud save."
            : "Reminder saved on this device.",
        );
    } catch (error) {
      setVoiceError((error as Error).message);
    }
  };
  const requestInterpretation = async (thought: string) => {
    if (!sessionActiveRef.current) {
      setVoiceError("Start a conversation before sending a reply.");
      return;
    }
    if (
      handlePendingQuoteLink(thought) ||
      handleQuoteInput(thought) ||
      handleCustomerInput(thought)
    ) {
      setText(thought);
      return;
    }
    if (submissionRef.current) {
      setVoiceError("LeadLoop is still processing the previous turn.");
      return;
    }
    const sessionId = activeSessionIdRef.current;
    const requestId = ++nextRequestIdRef.current;
    activeRequestIdRef.current = requestId;
    const abortController = new AbortController();
    requestAbortRef.current = abortController;
    submissionRef.current = true;
    voiceBusyRef.current = true;
    setVoiceBusy(true);
    setVoiceError("");
    setDemoMode(false);
    let resumeAfterFailure = false;
    try {
      turnTimingRef.current.requestStartedAt = performance.now();
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: thought,
          timeZone: timezone,
          context: conversationContext(conversationRef.current),
        }),
        signal: abortController.signal,
      });
      const payload = (await response.json()) as {
        transcript?: string;
        result?: IntentResult;
        error?: string;
        demoMode?: boolean;
        retryAfterSeconds?: number;
      };
      if (
        !sessionActiveRef.current ||
        activeSessionIdRef.current !== sessionId ||
        activeRequestIdRef.current !== requestId
      ) {
        logVoiceTurn(null, "interpretation_discarded", {
          reason: "session_changed",
        });
        return;
      }
      if (!response.ok || !payload.result || !payload.transcript) {
        setDemoMode(Boolean(payload.demoMode));
        if (payload.retryAfterSeconds)
          setRetryAfterSeconds(payload.retryAfterSeconds);
        throw new Error(
          payload.retryAfterSeconds
            ? `${payload.error} Try again in ${payload.retryAfterSeconds}s.`
            : payload.error || "LeadLoop couldn't understand that thought.",
        );
      }
      handleAssistantResult(payload.transcript, payload.result);
      logVoiceTurn(null, "interpretation_complete", {
        requestMs: Math.round(
          performance.now() -
            (turnTimingRef.current.requestStartedAt ?? performance.now()),
        ),
      });
      logVoiceTiming("text_interpretation_complete", {
        requestMs: Math.round(
          performance.now() -
            (turnTimingRef.current.requestStartedAt ?? performance.now()),
        ),
      });
      setRetryAfterSeconds(0);
    } catch (error) {
      // A failed request must not discard the pending field or confirmation.
      if (
        activeSessionIdRef.current === sessionId &&
        activeRequestIdRef.current === requestId
      ) {
        setVoiceError((error as Error).message);
        resumeAfterFailure = sessionActiveRef.current;
      }
    } finally {
      if (activeRequestIdRef.current !== requestId) return;
      requestAbortRef.current = null;
      submissionRef.current = false;
      voiceBusyRef.current = false;
      setVoiceBusy(false);
      if (resumeAfterFailure) scheduleAutoListen(performance.now());
    }
  };
  const submitAudio = async (
    audio: Blob,
    turnId: number,
    sessionId: number,
  ) => {
    if (submissionRef.current) {
      logVoiceTurn(turnId, "submission_rejected", { reason: "busy" });
      setVoiceError(
        "LeadLoop is still processing the previous turn. Please try again.",
      );
      return;
    }
    const requestId = ++nextRequestIdRef.current;
    activeRequestIdRef.current = requestId;
    const abortController = new AbortController();
    requestAbortRef.current = abortController;
    submissionRef.current = true;
    voiceBusyRef.current = true;
    setVoiceBusy(true);
    setVoiceError("");
    setDemoMode(false);
    let resumeAfterFailure = false;
    try {
      turnTimingRef.current.requestStartedAt = performance.now();
      const format = supportedAudioFormat(audio.type);
      if (!format) {
        throw new Error(
          "This browser recorded an audio format LeadLoop cannot transcribe. Try a current version of Chrome or Safari, or type your thought instead.",
        );
      }
      const form = new FormData();
      form.append("audio", audio, `leadloop-${Date.now()}.${format.extension}`);
      form.append("timeZone", timezone);
      form.append(
        "context",
        JSON.stringify(conversationContext(conversationRef.current)),
      );
      const response = await fetch("/api/voice", {
        method: "POST",
        body: form,
        signal: abortController.signal,
      });
      const payload = (await response.json()) as {
        transcript?: string;
        result?: IntentResult;
        error?: string;
        demoMode?: boolean;
        retryAfterSeconds?: number;
      };
      if (
        !sessionActiveRef.current ||
        activeSessionIdRef.current !== sessionId ||
        activeRequestIdRef.current !== requestId
      ) {
        logVoiceTurn(turnId, "response_discarded", {
          reason: "session_changed",
        });
        return;
      }
      if (!response.ok || !payload.result || !payload.transcript) {
        setDemoMode(Boolean(payload.demoMode));
        if (payload.retryAfterSeconds)
          setRetryAfterSeconds(payload.retryAfterSeconds);
        throw new Error(
          payload.retryAfterSeconds
            ? `${payload.error} Try again in ${payload.retryAfterSeconds}s.`
            : payload.error || "LeadLoop couldn't process that recording.",
        );
      }
      setText(payload.transcript);
      logVoiceTurn(turnId, "transcription_complete", {
        requestMs: Math.round(
          performance.now() -
            (turnTimingRef.current.requestStartedAt ?? performance.now()),
        ),
      });
      handleAssistantResult(payload.transcript, payload.result, turnId);
      logVoiceTurn(turnId, "interpretation_complete", {
        requestMs: Math.round(
          performance.now() -
            (turnTimingRef.current.requestStartedAt ?? performance.now()),
        ),
      });
      logVoiceTiming("voice_request_complete", {
        uploadAndAiMs: Math.round(
          performance.now() -
            (turnTimingRef.current.requestStartedAt ?? performance.now()),
        ),
      });
      setRetryAfterSeconds(0);
    } catch (error) {
      // Keep the authoritative draft intact so the user can safely retry.
      if (
        activeSessionIdRef.current === sessionId &&
        activeRequestIdRef.current === requestId
      ) {
        setVoiceError((error as Error).message);
        resumeAfterFailure = sessionActiveRef.current;
      }
    } finally {
      if (activeRequestIdRef.current !== requestId) return;
      requestAbortRef.current = null;
      submissionRef.current = false;
      voiceBusyRef.current = false;
      setVoiceBusy(false);
      if (resumeAfterFailure) scheduleAutoListen(performance.now());
    }
  };
  const clearRecordingTimers = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingLimitRef.current) clearTimeout(recordingLimitRef.current);
    recordingTimerRef.current = null;
    recordingLimitRef.current = null;
  };
  const stopVoiceActivityDetection = () => {
    if (analysisFrameRef.current)
      cancelAnimationFrame(analysisFrameRef.current);
    analysisFrameRef.current = null;
    analysisSourceRef.current?.disconnect();
    analysisFilterRef.current?.disconnect();
    analysisSourceRef.current = null;
    analysisFilterRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  };
  const finishRecording = (
    reason: "manual" | "silence" | "no_speech" | "limit" | "cancel",
    turnId = activeTurnIdRef.current,
  ) => {
    if (turnId === null || activeTurnIdRef.current !== turnId) return;
    if (recordingFinalizedRef.current) return;
    recordingFinalizedRef.current = true;
    recordingEndReasonRef.current = reason;
    turnTimingRef.current.finalizedAt = performance.now();
    logVoiceTurn(turnId, "recording_finalized", {
      reason,
      endOfSpeechSilenceMs: Math.round(voiceActivityRef.current.quietMs),
      peakSignal: Math.round(voiceActivityRef.current.peakSignal * 10_000),
      recordingMs: turnTimingRef.current.recordingStartedAt
        ? Math.round(
            turnTimingRef.current.finalizedAt -
              turnTimingRef.current.recordingStartedAt,
          )
        : 0,
    });
    clearRecordingTimers();
    stopVoiceActivityDetection();
    if (reason === "cancel" || reason === "no_speech")
      discardRecordingRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      // getUserMedia may still be resolving. Invalidating this id makes its
      // late result release its stream instead of starting a stale recorder.
      activeTurnIdRef.current = null;
      activeMicrophoneRequestIdRef.current =
        ++nextMicrophoneRequestIdRef.current;
      microphoneStartingRef.current = false;
      setMicrophoneStarting(false);
    }
  };
  const startVoiceActivityDetection = (
    stream: MediaStream,
    turnId: number,
    config: VoiceActivityConfig,
  ) => {
    const AudioContextConstructor =
      window.AudioContext ||
      (
        window as Window &
          typeof globalThis & { webkitAudioContext?: typeof AudioContext }
      ).webkitAudioContext;
    if (!AudioContextConstructor) {
      voiceDetectionAvailableRef.current = false;
      return;
    }
    try {
      const context = new AudioContextConstructor();
      const source = context.createMediaStreamSource(stream);
      const filter = context.createBiquadFilter();
      const analyser = context.createAnalyser();
      // Filter low-frequency rumble before measuring an adaptive noise floor.
      filter.type = "highpass";
      filter.frequency.value = 120;
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(filter);
      filter.connect(analyser);
      audioContextRef.current = context;
      analysisSourceRef.current = source;
      analysisFilterRef.current = filter;
      if (context.state === "suspended") {
        logVoiceTurn(turnId, "vad_resume_requested");
        void context.resume().catch(() => {
          if (activeTurnIdRef.current !== turnId) return;
          voiceDetectionAvailableRef.current = false;
          logVoiceTurn(turnId, "vad_unavailable", {
            reason: "audio_context_suspended",
          });
        });
      }
      voiceActivityRef.current = initialVoiceActivityState();
      voiceDetectionAvailableRef.current = true;
      let previousTime = performance.now();
      const samples = new Uint8Array(analyser.fftSize);
      const tick = (now: number) => {
        if (
          !sessionActiveRef.current ||
          activeTurnIdRef.current !== turnId ||
          recordingFinalizedRef.current
        )
          return;
        analyser.getByteTimeDomainData(samples);
        const update = advanceVoiceActivity(
          voiceActivityRef.current,
          rmsFromTimeDomain(samples),
          now - previousTime,
          config,
        );
        previousTime = now;
        voiceActivityRef.current = update.state;
        if (update.event === "speech_started") {
          turnTimingRef.current.speechDetectedAt = performance.now();
          setSpeechDetected(true);
          logVoiceTurn(turnId, "speech_detected", {
            waitForSpeechMs: turnTimingRef.current.recordingStartedAt
              ? Math.round(
                  turnTimingRef.current.speechDetectedAt -
                    turnTimingRef.current.recordingStartedAt,
                )
              : 0,
            peakSignal: Math.round(update.state.peakSignal * 10_000),
          });
        }
        if (update.event === "speech_ended") {
          finishRecording("silence", turnId);
          return;
        }
        if (update.event === "no_speech") {
          setVoiceError(
            "I didn't hear speech. I'll keep listening after this.",
          );
          finishRecording("no_speech", turnId);
          return;
        }
        analysisFrameRef.current = requestAnimationFrame(tick);
      };
      analysisFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // Web Audio is optional; manual stop and the maximum-duration guard remain.
      voiceDetectionAvailableRef.current = false;
    }
  };
  const clearSessionTimers = () => {
    if (autoListenRef.current) clearTimeout(autoListenRef.current);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    autoListenRef.current = null;
    inactivityRef.current = null;
  };
  const stopConversationSession = () => {
    logVoiceTurn(activeTurnIdRef.current, "session_stopping", {
      fromStage: conversationRef.current.stage,
    });
    clearSessionTimers();
    sessionActiveRef.current = false;
    activeSessionIdRef.current = ++nextSessionIdRef.current;
    setSessionActive(false);
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    activeRequestIdRef.current = 0;
    submissionRef.current = false;
    voiceBusyRef.current = false;
    setVoiceBusy(false);
    cancelSpeechPlayback();
    discardRecordingRef.current = true;
    const turnId = activeTurnIdRef.current;
    if (recorderRef.current?.state === "recording")
      finishRecording("cancel", turnId);
    else {
      activeTurnIdRef.current = null;
      activeMicrophoneRequestIdRef.current =
        ++nextMicrophoneRequestIdRef.current;
      microphoneStartingRef.current = false;
      setMicrophoneStarting(false);
      stopVoiceActivityDetection();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setIsRecording(false);
    }
    logVoiceTurn(null, "session_stopped", {
      stage: conversationRef.current.stage,
    });
  };
  const resetInactivityTimer = () => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (!sessionActiveRef.current) return;
    inactivityRef.current = setTimeout(() => {
      if (!sessionActiveRef.current) return;
      stopConversationSession();
      setConversation((current) => {
        const next = {
          ...current,
          stage: "ended" as const,
          activeReminder: null,
        };
        conversationRef.current = next;
        return next;
      });
      const reply =
        "I haven't heard anything, so I'll end the conversation here.";
      setAssistantMessage(reply);
      speakReply(reply, false, false);
    }, INACTIVITY_TIMEOUT_MS);
  };
  const scheduleAutoListen = (
    replyCompletedAt = performance.now(),
    turnId: number | null = null,
    sessionId = activeSessionIdRef.current,
  ) => {
    if (autoListenRef.current) clearTimeout(autoListenRef.current);
    if (!sessionActiveRef.current || activeSessionIdRef.current !== sessionId)
      return;
    resetInactivityTimer();
    autoListenRef.current = setTimeout(() => {
      autoListenRef.current = null;
      if (!sessionActiveRef.current || activeSessionIdRef.current !== sessionId)
        return;
      if (isSpeakingRef.current || voiceBusyRef.current) {
        scheduleAutoListen(replyCompletedAt, turnId, sessionId);
        return;
      }
      logVoiceTurn(turnId, "listening_resumed", {
        afterReplyMs: Math.round(performance.now() - replyCompletedAt),
      });
      void startRecording(sessionId);
    }, 50);
  };
  const startConversationSession = () => {
    if (sessionActiveRef.current) return;
    clearSessionTimers();
    const next = startConversation(conversationRef.current);
    conversationRef.current = next;
    setConversation(next);
    setAssistantMessage("Starting microphone…");
    setText("");
    setVoiceError("");
    sessionActiveRef.current = true;
    activeSessionIdRef.current = ++nextSessionIdRef.current;
    setSessionActive(true);
    logVoiceTurn(null, "session_started", {
      stage: next.stage,
    });
    resetInactivityTimer();
    void startRecording(activeSessionIdRef.current);
  };
  const startRecording = async (sessionId = activeSessionIdRef.current) => {
    setDemoMode(false);
    if (
      !sessionActiveRef.current ||
      activeSessionIdRef.current !== sessionId ||
      isSpeakingRef.current ||
      voiceBusyRef.current ||
      submissionRef.current ||
      microphoneStartingRef.current ||
      recorderRef.current?.state === "recording"
    )
      return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceError(
        "Voice capture is not supported in this browser. Type your thought instead.",
      );
      return;
    }
    const turnId = ++nextTurnIdRef.current;
    const microphoneRequestId = ++nextMicrophoneRequestIdRef.current;
    activeTurnIdRef.current = turnId;
    activeMicrophoneRequestIdRef.current = microphoneRequestId;
    microphoneStartingRef.current = true;
    setMicrophoneStarting(true);
    logVoiceTurn(turnId, "microphone_request_started", { sessionId });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          // Avoid raising distant TV speech in a quiet room.
          autoGainControl: false,
        },
      });
      if (
        !sessionActiveRef.current ||
        activeSessionIdRef.current !== sessionId ||
        activeTurnIdRef.current !== turnId ||
        activeMicrophoneRequestIdRef.current !== microphoneRequestId ||
        isSpeakingRef.current ||
        voiceBusyRef.current
      ) {
        stream.getTracks().forEach((track) => track.stop());
        logVoiceTurn(turnId, "microphone_request_discarded", {
          reason: "turn_or_session_changed",
        });
        return;
      }
      const supportedType = selectRecorderMimeType(
        MediaRecorder.isTypeSupported.bind(MediaRecorder),
      );
      if (!supportedType) {
        stream.getTracks().forEach((track) => track.stop());
        activeTurnIdRef.current = null;
        activeMicrophoneRequestIdRef.current =
          ++nextMicrophoneRequestIdRef.current;
        microphoneStartingRef.current = false;
        setMicrophoneStarting(false);
        setVoiceError(
          "This browser cannot record a LeadLoop-supported audio format. Try a current version of Chrome or Safari, or type your thought instead.",
        );
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType: supportedType });
      const voiceActivityConfig: VoiceActivityConfig = {
        ...DEFAULT_VOICE_ACTIVITY_CONFIG,
        silenceMs: VOICE_SILENCE_MS,
      };
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      discardRecordingRef.current = false;
      recordingFinalizedRef.current = false;
      recordingEndReasonRef.current = "manual";
      voiceDetectionAvailableRef.current = false;
      turnTimingRef.current = { recordingStartedAt: performance.now() };
      setSpeechDetected(false);
      recorder.ondataavailable = (event) => {
        if (activeTurnIdRef.current === turnId && event.data.size)
          chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (activeTurnIdRef.current !== turnId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        clearRecordingTimers();
        stopVoiceActivityDetection();
        setIsRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const recordedMimeType =
          chunks.find((chunk) => chunk.type)?.type || recorder.mimeType;
        const audio = new Blob(chunks, { type: recordedMimeType });
        recorderRef.current = null;
        activeTurnIdRef.current = null;
        activeMicrophoneRequestIdRef.current =
          ++nextMicrophoneRequestIdRef.current;
        const recordingReason = recordingEndReasonRef.current;
        const speechStarted = voiceActivityRef.current.speechStarted;
        const lowSignalFallback = voiceActivityRef.current.peakSignal >= 0.005;
        if (recordingReason === "no_speech" && sessionActiveRef.current) {
          if (audio.size && !voiceDetectionAvailableRef.current) {
            logVoiceTurn(turnId, "vad_unavailable_submission");
            void submitAudio(audio, turnId, sessionId);
            return;
          }
          if (audio.size && lowSignalFallback) {
            setVoiceError("I heard a quiet response and am checking it now.");
            logVoiceTurn(turnId, "low_signal_submission", {
              peakSignal: Math.round(
                voiceActivityRef.current.peakSignal * 10_000,
              ),
            });
            void submitAudio(audio, turnId, sessionId);
            return;
          }
          const reply = "I didn't hear anything. Please try again.";
          setAssistantMessage(reply);
          speakReply(reply, false, true, turnId);
          return;
        }
        if (
          !discardRecordingRef.current &&
          audio.size &&
          sessionActiveRef.current &&
          (!voiceDetectionAvailableRef.current || speechStarted)
        ) {
          if (!supportedAudioFormat(audio.type)) {
            setVoiceError(
              "This browser returned an unsupported audio format. Try a current version of Chrome or Safari, or type your thought instead.",
            );
            logVoiceTurn(turnId, "recording_rejected", {
              reason: "unsupported_format",
            });
            scheduleAutoListen(performance.now(), turnId, sessionId);
          } else {
            void submitAudio(audio, turnId, sessionId);
          }
        } else if (
          !discardRecordingRef.current &&
          voiceDetectionAvailableRef.current &&
          !speechStarted
        ) {
          setVoiceError("I didn't hear speech. Please try again.");
          logVoiceTurn(turnId, "recording_rejected", { reason: "no_speech" });
          if (sessionActiveRef.current)
            scheduleAutoListen(performance.now(), turnId, sessionId);
        } else if (!discardRecordingRef.current && sessionActiveRef.current) {
          setVoiceError(
            "LeadLoop couldn't keep that recording. Please try again.",
          );
          logVoiceTurn(turnId, "recording_rejected", {
            reason: audio.size ? "session_changed" : "empty_audio",
          });
          scheduleAutoListen(performance.now(), turnId, sessionId);
        }
      };
      let recorderStarted = false;
      const markRecorderReady = () => {
        if (recorderStarted || activeTurnIdRef.current !== turnId) return;
        recorderStarted = true;
        microphoneStartingRef.current = false;
        setMicrophoneStarting(false);
        setRecordingSeconds(0);
        setIsRecording(true);
        logVoiceTurn(turnId, "recording_started", { sessionId });
      };
      recorder.onstart = markRecorderReady;
      recorder.start(250);
      // MediaRecorder fires start asynchronously. If a browser omits that
      // event but reports an active recorder, the fallback still makes the
      // capture state visible without waiting for a user retry.
      window.setTimeout(markRecorderReady, 0);
      recordingTimerRef.current = setInterval(
        () => setRecordingSeconds((seconds) => seconds + 1),
        1000,
      );
      recordingLimitRef.current = setTimeout(() => {
        setVoiceError(
          "Voice notes are limited to 90 seconds. We stopped this recording.",
        );
        finishRecording("limit", turnId);
      }, 90_000);
      startVoiceActivityDetection(stream, turnId, voiceActivityConfig);
      resetInactivityTimer();
    } catch (error) {
      if (activeTurnIdRef.current !== turnId) return;
      activeTurnIdRef.current = null;
      activeMicrophoneRequestIdRef.current =
        ++nextMicrophoneRequestIdRef.current;
      microphoneStartingRef.current = false;
      setMicrophoneStarting(false);
      const denied = (error as DOMException).name === "NotAllowedError";
      setVoiceError(
        denied
          ? "Microphone access was denied. Allow access in your browser, or type your thought instead."
          : "LeadLoop couldn't start the microphone. Check your device and try again.",
      );
    }
  };
  const stopRecording = () => {
    finishRecording("manual", activeTurnIdRef.current);
  };
  const cancelRecording = () => {
    if (recorderRef.current?.state === "recording")
      finishRecording("cancel", activeTurnIdRef.current);
    else {
      activeTurnIdRef.current = null;
      activeMicrophoneRequestIdRef.current =
        ++nextMicrophoneRequestIdRef.current;
      microphoneStartingRef.current = false;
      setMicrophoneStarting(false);
      setIsRecording(false);
    }
  };
  const openReminderEditor = () => {
    if (!activeReminder) return;
    const saved = store.tasks.find((task) => task.id === activeReminder.id);
    setDraft({
      id: activeReminder.id,
      title: activeReminder.title,
      person: activeReminder.person,
      due: activeReminder.due,
      notes: activeReminder.notes,
      completed: saved?.completed ?? false,
    });
  };
  const openReviewItem = (_item: any) => openReminderEditor();
  const confirmCancellation = (_id: string) => {};
  const taskRow = (t: Task) => (
    <div className={"task-row " + (t.completed ? "done" : "")} key={t.id}>
      <button
        className="check-button"
        aria-label={`${t.completed ? "Reopen" : "Complete"} ${t.title}`}
        onClick={() => toggle(t.id)}
      >
        {t.completed && <Check size={15} />}
      </button>
      <button className="task-content" onClick={() => setDraft({ ...t })}>
        <strong>{t.title}</strong>
        <span>
          {t.person && (
            <>
              <Users size={12} />
              {t.person}
              <i>·</i>
            </>
          )}
          <Clock3 size={12} />
          {dateLabel(t.due, timezone)}
        </span>
      </button>
      <button
        className="icon-button row-edit"
        aria-label={`Edit ${t.title}`}
        onClick={() => setDraft({ ...t })}
      >
        <Pencil size={15} />
      </button>
    </div>
  );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (menu ? "mobile-open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("Home");
          }}
        >
          <span className="brand-mark">
            <AudioLines size={25} />
          </span>
          LeadLoop<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.name}
              className={"nav-item " + (screen === n.name ? "selected" : "")}
              onClick={() => go(n.name)}
            >
              <n.icon size={19} />
              {n.name === "Capture" ? "Capture & review" : n.name}
              {n.name === "Tasks" && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tip">
            <span className="tip-icon">
              <Leaf size={18} />
            </span>
            <strong>A little less on your mind.</strong>
            <p>
              Big ideas. Small to-dos.
              <br />
              There’s room for it all.
            </p>
            <button onClick={() => go("Capture")}>
              Let’s capture something <ArrowUpRight size={15} />
            </button>
          </div>
          <button className="profile" onClick={() => go("Settings")}>
            <span className="avatar">{store.name.slice(0, 1) || "Y"}</span>
            <span>
              <strong>{store.name || "Your workspace"}</strong>
              <small>{store.business}</small>
            </span>
            <Settings size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={22} />
          </button>
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>
              {screen === "Capture" ? "Capture & review" : screen}
            </strong>
          </span>
          <div className="header-right">
            <span className="demo-badge">
              <span />
              {cloudWorkspaceId ? "Cloud workspace" : "Local demo"}
            </span>
            <button
              aria-label="View reminders"
              className="icon-button"
              onClick={() => {
                go("Tasks");
                setFilter("Upcoming");
              }}
            >
              <Bell size={19} />
            </button>
            <button
              className="avatar small"
              aria-label="Open account settings"
              onClick={() => go("Settings")}
            >
              {store.name.slice(0, 1) || "Y"}
            </button>
          </div>
        </header>
        <main className="main-content">
          {storageError && (
            <div className="warning">
              Browser storage is unavailable or unreadable. Changes in this
              session may not survive a refresh. Export your data before
              leaving.
            </div>
          )}
          {screen === "Home" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      timeZone: timezone,
                    }).format(new Date())}
                  </div>
                  <h1>
                    A clear mind. A good day<span>.</span>
                  </h1>
                  <p>
                    Hey {store.name || "there"}, let’s make room for what
                    matters.
                  </p>
                </div>
                <button className="button secondary" onClick={newTask}>
                  <Plus size={16} /> Add task
                </button>
              </div>
              <section className="capture-hero">
                <div className="hero-copy">
                  <span className="pill">
                    <AudioLines size={14} /> YOUR NEXT THOUGHT STARTS HERE
                  </span>
                  <h2>
                    Just talk.
                    <br />
                    We’ll remember.
                  </h2>
                  <p>
                    A follow-up, a fresh idea, that thing you can’t forget.
                    <br className="desktop-break" /> Get it out of your head and
                    into your day.
                  </p>
                  <button className="hero-link" onClick={() => go("Capture")}>
                    <Keyboard size={15} /> Prefer to type?{" "}
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div className="hero-action">
                  <button
                    className="mic-button"
                    aria-label={
                      sessionActive
                        ? "Open active conversation"
                        : "Start conversation"
                    }
                    onClick={() => {
                      go("Capture");
                      if (!sessionActive) startConversationSession();
                    }}
                  >
                    {isRecording ? (
                      <Square size={30} fill="currentColor" strokeWidth={1.7} />
                    ) : (
                      <Mic size={37} strokeWidth={1.7} />
                    )}
                  </button>
                  <strong>
                    {isRecording
                      ? "Listening…"
                      : sessionActive
                        ? "Conversation active"
                        : "Start a conversation"}
                  </strong>
                  <span>
                    {isRecording
                      ? `${recordingSeconds}s of 90s`
                      : sessionActive
                        ? "LeadLoop takes the next turn"
                        : "Voice or text"}
                  </span>
                  <div className="wave" aria-hidden="true">
                    {[8, 15, 23, 12, 31, 19, 37, 24, 16, 28, 12, 20, 8].map(
                      (h, i) => (
                        <i key={i} style={{ height: h }} />
                      ),
                    )}
                  </div>
                </div>
                <span className="hero-decoration" />
              </section>
              <div className="stats-grid">
                {[
                  {
                    label: "On your list today",
                    value: today.length,
                    icon: CalendarDays,
                    color: "green",
                  },
                  {
                    label: "Coming up",
                    value: upcoming.length,
                    icon: Clock3,
                    color: "blue",
                  },
                  {
                    label: "Taken care of",
                    value: store.tasks.filter((t) => t.completed).length,
                    icon: CheckCheck,
                    color: "purple",
                  },
                ].map((s) => (
                  <button
                    className="stat-card"
                    key={s.label}
                    onClick={() => {
                      go("Tasks");
                      setFilter(
                        s.label === "Taken care of" ? "Completed" : "Upcoming",
                      );
                    }}
                  >
                    <span className={"stat-icon " + s.color}>
                      <s.icon size={20} />
                    </span>
                    <span>
                      <small>{s.label}</small>
                      <strong>
                        {s.value}
                        <em>
                          {s.label === "Taken care of"
                            ? "A little progress, every day."
                            : s.label === "Coming up"
                              ? "One thing at a time."
                              : "You’ve got this."}
                        </em>
                      </strong>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
              <div className="home-columns">
                <section className="card">
                  <div className="section-heading">
                    <h2>
                      Today’s focus <span>{today.length}</span>
                    </h2>
                    <button onClick={() => go("Tasks")}>
                      All tasks <ArrowRight size={14} />
                    </button>
                  </div>
                  {today.length ? (
                    today.map(taskRow)
                  ) : (
                    <div className="empty-inline">
                      A little breathing room. No tasks scheduled today.
                    </div>
                  )}
                  <button className="add-inline" onClick={newTask}>
                    <Plus size={16} /> Add something to your day
                  </button>
                </section>
                <section className="card upcoming-card">
                  <div className="section-heading">
                    <h2>On the horizon</h2>
                    <Clock3 size={17} />
                  </div>
                  {upcoming.length ? (
                    upcoming.slice(0, 3).map((t) => (
                      <button
                        className="horizon-row"
                        key={t.id}
                        onClick={() => setDraft({ ...t })}
                      >
                        <span className="date-tile">
                          {t.due
                            ? new Intl.DateTimeFormat("en", {
                                month: "short",
                                timeZone: timezone,
                              }).format(new Date(t.due))
                            : "NO"}
                          <strong>
                            {t.due
                              ? new Intl.DateTimeFormat("en", {
                                  day: "numeric",
                                  timeZone: timezone,
                                }).format(new Date(t.due))
                              : "DATE"}
                          </strong>
                        </span>
                        <span>
                          <strong>{t.title}</strong>
                          <small>{t.person || "Your business"}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  ) : (
                    <div className="empty-inline">
                      Your upcoming tasks will appear here.
                    </div>
                  )}
                  <div className="gentle-note">
                    <Leaf size={16} /> A plan today. Peace of mind tomorrow.
                  </div>
                </section>
              </div>
              {overdue.length > 0 && (
                <section className="overdue-banner">
                  <span className="overdue-icon">
                    <Clock3 size={19} />
                  </span>
                  <div>
                    <strong>A little catch-up?</strong>
                    <p>
                      {overdue.length}{" "}
                      {overdue.length === 1 ? "task needs" : "tasks need"} a new
                      moment on your calendar. No rush, just a nudge.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      go("Tasks");
                      setFilter("Overdue");
                    }}
                  >
                    Take a look <ArrowRight size={15} />
                  </button>
                </section>
              )}
              <footer className="home-footer">
                <ShieldCheck size={14} /> Your thoughts, in one place.{" "}
                <span>Sample data · Stored in this browser only</span>
              </footer>
            </>
          )}
          {screen === "Tasks" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A LITTLE MORE ORGANIZED</div>
                  <h1>
                    Your tasks<span>.</span>
                  </h1>
                  <p>Everything you need to do, with room to breathe.</p>
                </div>
                <button className="button primary" onClick={newTask}>
                  <Plus size={17} /> Add task
                </button>
              </div>
              <div className="toolbar">
                <div className="tabs">
                  {["Upcoming", "Overdue", "Completed", "All"].map((f) => (
                    <button
                      key={f}
                      className={filter === f ? "active" : ""}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    placeholder="Search tasks"
                    aria-label="Search tasks"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <section className="card">
                {(() => {
                  const list = store.tasks.filter(
                    (t) =>
                      (filter === "All" ||
                        (filter === "Completed" && t.completed) ||
                        (filter === "Upcoming" && !t.completed) ||
                        (filter === "Overdue" &&
                          overdue.some((o) => o.id === t.id))) &&
                      `${t.title} ${t.person}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  );
                  return list.length ? (
                    list.map(taskRow)
                  ) : (
                    <div className="empty-state">
                      <CheckCheck size={34} />
                      <h2>All clear here.</h2>
                      <p>No tasks match this view.</p>
                      <button className="button secondary" onClick={newTask}>
                        Add a task
                      </button>
                    </div>
                  );
                })()}
              </section>
              <p className="muted-note">
                Dates shown in {timezone}. Email reminders are not connected in
                this demo.
              </p>
            </>
          )}
          {screen === "Capture" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAKE ROOM IN YOUR HEAD</div>
                  <h1>
                    What’s on your mind<span>?</span>
                  </h1>
                  <p>Capture it now. Make it happen later.</p>
                </div>
              </div>
              <div className="capture-layout">
                <section className="card capture-panel">
                  <div className="capture-top">
                    <span className="stat-icon green">
                      <Mic size={21} />
                    </span>
                    <div>
                      <h2>Your LeadLoop conversation</h2>
                      <p>Reminders and customer facts, confirmed out loud.</p>
                    </div>
                  </div>
                  <div className="recording-controls">
                    {!sessionActive ? (
                      <button
                        className="record-button"
                        type="button"
                        onClick={startConversationSession}
                      >
                        <Mic size={19} /> Start Conversation
                      </button>
                    ) : (
                      <button
                        className={`record-button ${isRecording ? "recording" : ""}`}
                        type="button"
                        aria-pressed={isRecording}
                        disabled={voiceBusy || isSpeaking || microphoneStarting}
                        onClick={() => {
                          if (isRecording) stopRecording();
                          else void startRecording();
                        }}
                      >
                        {isRecording ? (
                          <Square size={18} fill="currentColor" />
                        ) : (
                          <Mic size={19} />
                        )}
                        {isRecording
                          ? speechDetected
                            ? `Listening — tap to stop · ${recordingSeconds}s`
                            : `Listening for speech · ${recordingSeconds}s`
                          : isSpeaking
                            ? "LeadLoop is speaking"
                            : voiceBusy
                              ? "Thinking…"
                              : microphoneStarting
                                ? "Starting microphone…"
                                : "Resume listening"}
                      </button>
                    )}
                    {isRecording && (
                      <button
                        className="button secondary compact"
                        type="button"
                        onClick={cancelRecording}
                      >
                        <X size={15} /> Cancel
                      </button>
                    )}
                    {voiceBusy && (
                      <span className="processing">
                        <LoaderCircle size={16} /> Understanding your thought…
                      </span>
                    )}
                    {isSpeaking && (
                      <span className="processing">
                        <Volume2 size={16} /> LeadLoop is speaking…
                      </span>
                    )}
                  </div>
                  <label className="field">
                    Or type your reply
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Say or type what you want LeadLoop to hear"
                      rows={3}
                    />
                  </label>
                  <p className="input-note">
                    Start once, then LeadLoop alternates speaking and listening.
                    Recording stops before every reply, so it never records its
                    own voice.
                  </p>
                  <div className="capture-help">
                    <ShieldCheck size={18} />
                    <span>
                      Nothing is saved until you say yes to LeadLoop’s
                      read-back.
                    </span>
                  </div>
                  {voiceError && (
                    <div className="voice-alert" role="alert">
                      <AlertCircle size={17} />
                      <span>{voiceError}</span>
                    </div>
                  )}
                  {retryAfterSeconds > 0 && (
                    <p className="input-note" role="status">
                      You can retry in {retryAfterSeconds}s. Your unfinished
                      reminder is still here.
                    </p>
                  )}
                  {demoMode && (
                    <div className="demo-ai-note">
                      <strong>Demo mode</strong> — add a server-side OpenAI key
                      to use spoken or typed AI understanding.
                    </div>
                  )}
                  <button
                    className="button primary wide"
                    disabled={
                      !text.trim() || !sessionActive || voiceBusy || isRecording
                    }
                    onClick={() => void requestInterpretation(text.trim())}
                  >
                    {voiceBusy ? "Working…" : "Send reply"}{" "}
                    <ArrowRight size={17} />
                  </button>
                  {sessionActive && (
                    <button
                      className="button secondary wide"
                      type="button"
                      onClick={() => {
                        stopConversationSession();
                        setConversation((current) => {
                          const next = {
                            ...current,
                            stage: "ended" as const,
                            activeReminder: null,
                          };
                          conversationRef.current = next;
                          return next;
                        });
                        setAssistantMessage("Conversation ended.");
                      }}
                    >
                      <Square size={15} /> End Conversation
                    </button>
                  )}
                </section>
                <aside className="capture-aside">
                  <span className="pill">{voicePhase}</span>
                  <h2>LeadLoop’s current order</h2>
                  {activeReminder ? (
                    <dl className="conversation-reminder">
                      <div>
                        <dt>Reminder</dt>
                        <dd>
                          {activeReminder.title || "Listening for the task"}
                        </dd>
                      </div>
                      <div>
                        <dt>Contact</dt>
                        <dd>{activeReminder.person || "Not specified"}</dd>
                      </div>
                      <div>
                        <dt>When</dt>
                        <dd>
                          {activeReminder.due
                            ? dateLabel(activeReminder.due, timezone)
                            : activeReminder.pendingDate
                              ? `${activeReminder.pendingDate} · waiting for time`
                              : activeReminder.pendingDateConstraint
                                ? "Waiting for the exact date"
                                : "Waiting for date and time"}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p>
                      Tell LeadLoop what you need to remember. It will ask only
                      for what is missing.
                    </p>
                  )}
                  {activeReminder && (
                    <button
                      className="manual-review-link"
                      onClick={openReminderEditor}
                    >
                      <Pencil size={15} /> Edit reminder details
                    </button>
                  )}
                  {customerMemory.pending && (
                    <dl className="conversation-reminder customer-memory-review">
                      <div>
                        <dt>Customer memory to confirm</dt>
                        <dd>{customerMemory.pending.person.name}</dd>
                      </div>
                      <div>
                        <dt>Change</dt>
                        <dd>
                          {customerMemory.pending.changed.join(", ") ||
                            "Customer record"}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {quoteMemory.pending && (
                    <dl className="conversation-reminder customer-memory-review">
                      <div>
                        <dt>Estimate to confirm</dt>
                        <dd>{quoteMemory.pending.quote.serviceDescription}</dd>
                      </div>
                      <div>
                        <dt>Amount</dt>
                        <dd>
                          {quoteAmountLabel(
                            quoteMemory.pending.quote.amountCents,
                          )}
                        </dd>
                      </div>
                    </dl>
                  )}
                </aside>
              </div>
              {(assistantMessage ||
                activeReminder ||
                customerMemory.pending ||
                quoteMemory.pending ||
                conversation.lastSavedReminder) && (
                <section className="assistant-review" aria-live="polite">
                  <div className="assistant-message">
                    <MessageCircle size={20} />
                    <div>
                      <span className="eyebrow">LEADLOOP</span>
                      <strong>
                        {assistantMessage || "I’m ready when you are."}
                      </strong>
                      <p>
                        {conversation.stage === "ended"
                          ? "Conversation ended — microphone off."
                          : isSpeaking
                            ? "Speaking now — recording is paused."
                            : voiceBusy
                              ? "Thinking about your last turn."
                              : isRecording
                                ? speechDetected
                                  ? "Hearing you now."
                                  : "Listening for your voice."
                                : microphoneStarting
                                  ? "Starting your microphone. Speak once Listening appears."
                                  : sessionActive
                                    ? "Paused — use Resume listening when you are ready."
                                    : "Conversation ended — microphone off."}
                      </p>
                    </div>
                  </div>
                  <div className="conversation-actions">
                    <button
                      className="button secondary"
                      onClick={() =>
                        speakReply(
                          assistantMessage,
                          conversation.stage === "reading_back",
                        )
                      }
                      disabled={!assistantMessage || isSpeaking}
                    >
                      <RotateCw size={15} /> Replay response
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setMuted((value) => !value);
                        cancelSpeechPlayback();
                      }}
                    >
                      {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      {muted ? "Unmute" : "Mute"}
                    </button>
                    <button
                      className="review-dismiss"
                      onClick={() => {
                        if (
                          !activeReminder ||
                          window.confirm(
                            "Discard the unfinished reminder and start over?",
                          )
                        ) {
                          cancelSpeechPlayback();
                          stopConversationSession();
                          const next = emptyConversationState();
                          conversationRef.current = next;
                          setConversation(next);
                          setAssistantMessage("");
                          setText("");
                        }
                      }}
                    >
                      <X size={15} /> Cancel or start over
                    </button>
                  </div>
                  <div className="review-grid">
                    {reviewItems.map((item) => {
                      const pending = pendingClarifications.find(
                        (clarification) =>
                          clarification.taskIds.includes(item.id),
                      );
                      return (
                        <article className="review-card" key={item.id}>
                          <span className="pill">
                            {item.source === "existing"
                              ? "UPDATE TO REVIEW"
                              : "NEW REMINDER"}
                          </span>
                          <h2>{item.title}</h2>
                          <dl>
                            <div>
                              <dt>Contact</dt>
                              <dd>{item.person || "No contact"}</dd>
                            </div>
                            <div>
                              <dt>Reminder</dt>
                              <dd>
                                {item.due
                                  ? dateLabel(item.due, timezone)
                                  : "No reminder time"}
                              </dd>
                            </div>
                          </dl>
                          {pending && (
                            <p className="pending-question">
                              <MessageCircle size={13} /> Waiting for:{" "}
                              {pending.question}
                            </p>
                          )}
                          {item.notes && <p>{item.notes}</p>}
                          <button
                            className="button primary"
                            onClick={() => openReviewItem(item)}
                          >
                            Review & confirm <ArrowRight size={15} />
                          </button>
                          <button
                            className="review-dismiss"
                            onClick={() => {
                              setConversation((current) => ({
                                ...current,
                                drafts: current.drafts.filter(
                                  (entry) => entry.id !== item.id,
                                ),
                                pending: current.pending.filter(
                                  (clarification) =>
                                    !clarification.taskIds.includes(item.id),
                                ),
                                phase: "canceled",
                              }));
                            }}
                          >
                            Discard draft
                          </button>
                        </article>
                      );
                    })}
                    {cancelIds.map((id) => {
                      const target =
                        store.tasks.find((task) => task.id === id) ||
                        reviewItems.find((item) => item.id === id);
                      return (
                        <article className="review-card cancel-card" key={id}>
                          <span className="pill">CANCELLATION TO REVIEW</span>
                          <h2>{target?.title || "This task"}</h2>
                          <p>
                            LeadLoop heard a request to cancel it. Confirm
                            before removing anything.
                          </p>
                          <button
                            className="button secondary"
                            onClick={() => confirmCancellation(id)}
                          >
                            <Trash2 size={15} /> Confirm cancellation
                          </button>
                          <button
                            className="review-dismiss"
                            onClick={() =>
                              setConversation((current) => ({
                                ...current,
                                cancellationIds: current.cancellationIds.filter(
                                  (cancelId) => cancelId !== id,
                                ),
                                phase: "ready_for_review",
                              }))
                            }
                          >
                            Keep task
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  {!sessionActive && (
                    <button
                      className="continue-speaking"
                      onClick={startConversationSession}
                      disabled={voiceBusy}
                    >
                      <RotateCcw size={16} /> Start Conversation
                    </button>
                  )}
                  <button
                    className="review-dismiss"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Discard unfinished reminders and start a fresh capture session?",
                        )
                      ) {
                        stopConversationSession();
                        const next = emptyConversationState();
                        conversationRef.current = next;
                        setConversation(next);
                        setAssistantMessage("");
                        setText("");
                      }
                    }}
                  >
                    Start fresh capture
                  </button>
                </section>
              )}
            </>
          )}
          {screen === "People" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GOOD BUSINESS IS PERSONAL</div>
                  <h1>
                    Your people<span>.</span>
                  </h1>
                  <p>A familiar face. A detail remembered.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() =>
                    setPerson({
                      id: crypto.randomUUID(),
                      name: "",
                      business: "",
                      email: "",
                      phone: "",
                      address: "",
                      notes: "",
                      interactions: [],
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    })
                  }
                >
                  <Plus size={16} /> Add person
                </button>
              </div>
              <label className="search people-search">
                <Search size={17} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search people"
                  placeholder="Find someone…"
                />
              </label>
              <div className="people-grid">
                {store.people
                  .filter((p) =>
                    `${p.name} ${p.business}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <button
                      className="card person-card"
                      key={p.id}
                      onClick={() => setPerson({ ...p })}
                    >
                      <span className="person-avatar">
                        {p.name
                          .split(" ")
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <ArrowUpRight size={17} />
                      <h2>{p.name}</h2>
                      <small>{p.business || "Business contact"}</small>
                      <p>
                        {p.notes || "Add a note to remember the little things."}
                      </p>
                      <div>
                        <LayoutList size={14} />
                        {
                          remindersForPerson(
                            store.tasks,
                            store.people,
                            p,
                          ).filter((task) => !task.completed).length
                        }{" "}
                        open tasks
                      </div>
                    </button>
                  ))}
              </div>
              {store.people.length === 0 && (
                <div className="empty-state">
                  <Users />
                  <h2>Your next connection starts here.</h2>
                  <p>Add a customer or business contact.</p>
                </div>
              )}
            </>
          )}
          {screen === "Settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                  <h1>
                    Your workspace<span>.</span>
                  </h1>
                  <p>A few details to make LeadLoop yours.</p>
                </div>
              </div>
              <div className="settings-grid">
                <section className="card settings-card">
                  <h2>Business profile</h2>
                  <p>Saved automatically on this device.</p>
                  <label className="field">
                    Your name
                    <input
                      value={store.name}
                      onChange={(e) =>
                        setStore({ ...store, name: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Business name
                    <input
                      value={store.business}
                      onChange={(e) =>
                        setStore({ ...store, business: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Display time zone
                    <select
                      value={timezone}
                      onChange={(e) =>
                        setStore({ ...store, timezone: e.target.value })
                      }
                    >
                      {Array.from(
                        new Set([
                          timezone,
                          "America/Chicago",
                          "America/New_York",
                          "America/Denver",
                          "America/Los_Angeles",
                          "Europe/London",
                          "Europe/Paris",
                          "Asia/Tokyo",
                          "Australia/Sydney",
                          "UTC",
                        ]),
                      ).map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </select>
                    <small>
                      Midland, Texas uses America/Chicago. Changing this does
                      not shift reminders already saved on this device.
                    </small>
                  </label>
                </section>
                <div>
                  <section className="card settings-card">
                    <h2>Working days</h2>
                    <p>
                      Used for future working-day scheduling requests. LeadLoop
                      will not move a reminder away from a weekend unless you
                      ask it to.
                    </p>
                    <div
                      className="check-list"
                      role="group"
                      aria-label="Working days"
                    >
                      {[
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((day, index) => (
                        <label key={day}>
                          <input
                            type="checkbox"
                            checked={store.workingDays.includes(index)}
                            onChange={() =>
                              setStore({
                                ...store,
                                workingDays: normalizeWorkingDays(
                                  store.workingDays.includes(index)
                                    ? store.workingDays.filter(
                                        (value) => value !== index,
                                      )
                                    : [...store.workingDays, index],
                                ),
                              })
                            }
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                    <small>New workspaces use Monday through Friday.</small>
                  </section>
                  <section className="card settings-card">
                    <h2>
                      {cloudMode === "new_password"
                        ? "Set new password"
                        : "Cloud account"}
                    </h2>
                    {!cloudClient && (
                      <div className="status-line">
                        <ShieldCheck size={20} />
                        <span>
                          <strong>
                            {cloudConfigurationError
                              ? "Cloud configuration needs attention"
                              : "Local demo workspace"}
                          </strong>
                          <p>
                            {cloudConfigurationError ||
                              "Add the Supabase project base URL and publishable key to enable optional private cloud accounts. Your browser data stays on this device until you explicitly import it."}
                          </p>
                        </span>
                      </div>
                    )}
                    {cloudClient &&
                      (!cloudUserEmail ||
                        cloudMode === "new_password" ||
                        cloudMode === "recover") && (
                        <>
                          <p>
                            {cloudMode === "new_password"
                              ? "Choose a new password to finish account recovery."
                              : "Sign in to use an authenticated workspace. LeadLoop never sends browser data to the cloud until you approve an import."}
                          </p>
                          {cloudMode !== "new_password" && (
                            <label className="field">
                              Email
                              <input
                                type="email"
                                value={cloudEmail}
                                onChange={(event) =>
                                  setCloudEmail(event.target.value)
                                }
                                autoComplete="email"
                              />
                            </label>
                          )}
                          {cloudMode !== "recover" && (
                            <label className="field">
                              {cloudMode === "new_password"
                                ? "New password"
                                : "Password"}
                              <input
                                type="password"
                                value={cloudPassword}
                                onChange={(event) =>
                                  setCloudPassword(event.target.value)
                                }
                                autoComplete={
                                  cloudMode === "sign_up" ||
                                  cloudMode === "new_password"
                                    ? "new-password"
                                    : "current-password"
                                }
                              />
                            </label>
                          )}
                          {cloudMode === "new_password" && (
                            <>
                              <label className="field">
                                Confirm new password
                                <input
                                  type="password"
                                  value={cloudPasswordConfirmation}
                                  onChange={(event) =>
                                    setCloudPasswordConfirmation(
                                      event.target.value,
                                    )
                                  }
                                  autoComplete="new-password"
                                />
                              </label>
                              <small>
                                Use at least 8 characters. LeadLoop never stores
                                your password.
                              </small>
                            </>
                          )}
                          <button
                            className="button"
                            disabled={
                              cloudBusy ||
                              (cloudMode !== "new_password" && !cloudEmail) ||
                              (cloudMode !== "recover" &&
                                cloudPassword.length < 8) ||
                              (cloudMode === "new_password" &&
                                (!cloudRecoveryActive ||
                                  !cloudPasswordConfirmation))
                            }
                            onClick={submitCloudAuth}
                          >
                            {cloudBusy
                              ? "Working…"
                              : cloudMode === "sign_up"
                                ? "Create account"
                                : cloudMode === "recover"
                                  ? "Send reset email"
                                  : cloudMode === "new_password"
                                    ? "Save new password"
                                    : "Sign in"}
                          </button>
                          {cloudMode === "new_password" && (
                            <div className="modal-actions">
                              <button
                                className="text-link"
                                onClick={() => {
                                  clearPasswordRecoverySession(sessionStorage);
                                  cloudRecoveryActiveRef.current = false;
                                  setCloudRecoveryActive(false);
                                  setCloudPassword("");
                                  setCloudPasswordConfirmation("");
                                  setCloudMode("recover");
                                  setCloudError("");
                                }}
                              >
                                Request a new recovery link
                              </button>
                            </div>
                          )}
                          {cloudMode !== "new_password" && (
                            <div className="modal-actions">
                              <button
                                className="text-link"
                                onClick={() =>
                                  setCloudMode(
                                    cloudMode === "sign_in"
                                      ? "sign_up"
                                      : "sign_in",
                                  )
                                }
                              >
                                {cloudMode === "sign_in"
                                  ? "Create an account"
                                  : "I already have an account"}
                              </button>
                              <button
                                className="text-link"
                                onClick={() => setCloudMode("recover")}
                              >
                                Forgot password?
                              </button>
                            </div>
                          )}
                          {cloudError && (
                            <p className="error-message" role="alert">
                              {cloudError}
                            </p>
                          )}
                        </>
                      )}
                    {cloudClient &&
                      cloudUserEmail &&
                      cloudMode !== "new_password" &&
                      cloudMode !== "recover" && (
                        <>
                          <p>
                            Signed in as <strong>{cloudUserEmail}</strong>.
                          </p>
                          {cloudWorkspaces.length > 0 && (
                            <label className="field">
                              Cloud workspace
                              <select
                                value={cloudWorkspaceId ?? ""}
                                onChange={(event) =>
                                  event.target.value &&
                                  void activateCloudWorkspace(
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="">Choose a workspace</option>
                                {cloudWorkspaces.map((workspace) => (
                                  <option
                                    key={workspace.id}
                                    value={workspace.id}
                                  >
                                    {workspace.businessName || workspace.name} ·{" "}
                                    {workspace.role}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {!cloudWorkspaceId && (
                            <>
                              <label className="field">
                                Workspace name
                                <input
                                  value={newWorkspaceName}
                                  onChange={(event) =>
                                    setNewWorkspaceName(event.target.value)
                                  }
                                  placeholder="LeadLoop workspace"
                                />
                              </label>
                              <label className="field">
                                Business name
                                <input
                                  value={newWorkspaceBusiness}
                                  onChange={(event) =>
                                    setNewWorkspaceBusiness(event.target.value)
                                  }
                                  placeholder="My business"
                                />
                              </label>
                              <button
                                className="button"
                                disabled={cloudBusy}
                                onClick={createCloudWorkspace}
                              >
                                {cloudBusy ? "Creating…" : "Create workspace"}
                              </button>
                            </>
                          )}
                          {cloudWorkspaceId && (
                            <>
                              <div className="status-line">
                                <ShieldCheck size={20} />
                                <span>
                                  <strong>Cloud sync · {cloudSyncState}</strong>
                                  <p>
                                    {cloudSyncState === "saving"
                                      ? "Saving changes securely…"
                                      : cloudSyncState === "error"
                                        ? "A cloud save failed. Your visible change has not been confirmed as saved."
                                        : "Customers, estimates, reminders, and preferences use this workspace."}
                                  </p>
                                </span>
                              </div>
                              {cloudWorkspaces.find(
                                (workspace) =>
                                  workspace.id === cloudWorkspaceId,
                              )?.role === "owner" ? (
                                <button
                                  className="button secondary"
                                  disabled={cloudBusy}
                                  onClick={previewCloudImport}
                                >
                                  Preview local-data import
                                </button>
                              ) : (
                                <p>
                                  Only this workspace’s owner can import
                                  browser-local data.
                                </p>
                              )}
                              {cloudImportPreview && (
                                <div className="status-line">
                                  <Download size={20} />
                                  <span>
                                    <strong>Import preview</strong>
                                    <p>
                                      {cloudImportPreview.counts.customers}{" "}
                                      customers,{" "}
                                      {cloudImportPreview.counts.quotes}{" "}
                                      estimates, and{" "}
                                      {cloudImportPreview.counts.tasks}{" "}
                                      reminders.{" "}
                                      {cloudImportPreview.errors.join(" ") ||
                                        cloudImportPreview.warnings.join(" ") ||
                                        "IDs and links are ready for review."}
                                    </p>
                                    <button
                                      className="button"
                                      disabled={
                                        cloudBusy ||
                                        cloudImportPreview.errors.length > 0
                                      }
                                      onClick={confirmCloudImport}
                                    >
                                      Approve and import
                                    </button>
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                          {cloudError && (
                            <p className="error-message" role="alert">
                              {cloudError}
                            </p>
                          )}
                          <button
                            className="text-link"
                            disabled={cloudBusy}
                            onClick={leaveCloudAccount}
                          >
                            Sign out
                          </button>
                        </>
                      )}
                  </section>
                  <section className="card settings-card">
                    <h2>Accounts & reminders</h2>
                    <div className="status-line">
                      <Bell size={20} />
                      <span>
                        <strong>Email reminders · Not connected</strong>
                        <p>
                          Tasks are saved, but notifications will not be sent.
                          Scheduled delivery is a later phase.
                        </p>
                      </span>
                    </div>
                  </section>
                  <section className="card settings-card data-card">
                    <h2>Your data, your choice</h2>
                    <p>Export a backup or clear this browser’s workspace.</p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(store, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "leadloop-backup.json";
                        a.click();
                        URL.revokeObjectURL(url);
                        setNotice("Backup downloaded.");
                      }}
                    >
                      <Download size={16} /> Export data
                    </button>
                    <button
                      className="danger-link"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete all LeadLoop tasks, contacts, and profile details from this browser? This cannot be undone.",
                          )
                        ) {
                          setStore({
                            tasks: [],
                            people: [],
                            quotes: [],
                            name: "",
                            business: "",
                            timezone:
                              Intl.DateTimeFormat().resolvedOptions().timeZone,
                            workingDays: [...DEFAULT_WORKING_DAYS],
                          });
                          setStorageError(false);
                          setNotice("Workspace cleared.");
                        }
                      }}
                    >
                      <Trash2 size={15} /> Clear local data
                    </button>
                  </section>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.map((n) => (
          <button
            key={n.name}
            className={screen === n.name ? "selected" : ""}
            onClick={() => go(n.name)}
          >
            <n.icon size={21} />
            <span>{n.name}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {draft && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDraft(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">A MOMENT OF CLARITY</span>
                <h2 id="task-dialog">
                  {store.tasks.some((t) => t.id === draft.id)
                    ? "Edit your task"
                    : "Review your task"}
                </h2>
              </div>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close task editor"
                onClick={() => setDraft(null)}
              >
                <X />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <label className="field">
                Task
                <input
                  required
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  placeholder="What needs to happen?"
                />
              </label>
              <label className="field">
                Person <span>(optional)</span>
                <input
                  list="contact-names"
                  value={draft.person}
                  onChange={(e) =>
                    setDraft({ ...draft, person: e.target.value })
                  }
                />
                <datalist id="contact-names">
                  {store.people.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                Date & time <span>(optional)</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.due, timezone)}
                  onChange={(e) => {
                    try {
                      setDraft({
                        ...draft,
                        due: e.target.value
                          ? fromLocalInput(e.target.value, timezone)
                          : "",
                      });
                    } catch (error) {
                      setNotice((error as Error).message);
                    }
                  }}
                />
              </label>
              <p className="input-note">
                Enter time in your selected zone ({timezone}).
              </p>
              <label className="field">
                Notes <span>(optional)</span>
                <textarea
                  rows={2}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                />
              </label>
              <div className="confirmation">
                <CalendarDays size={18} />
                <span>
                  <strong>{dateLabel(draft.due, timezone)}</strong>
                  <small>
                    {draft.due
                      ? "Scheduled in your task list. Email delivery is not connected."
                      : "Save without a reminder time. You can add one later."}
                  </small>
                </span>
              </div>
              <div className="modal-actions">
                {store.tasks.some((t) => t.id === draft.id) && (
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label="Delete task"
                    onClick={() => {
                      if (window.confirm("Delete this task?")) {
                        setStore({
                          ...store,
                          tasks: store.tasks.filter((t) => t.id !== draft.id),
                        });
                        setDraft(null);
                        setNotice("Task deleted.");
                      }
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button className="button primary" type="submit">
                  <Check size={16} /> Confirm & save
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {quoteDraft && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setQuoteDraft(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quote-dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">CUSTOMER ESTIMATE</span>
                <h2 id="quote-dialog">
                  {store.quotes.some((quote) => quote.id === quoteDraft.id)
                    ? "Edit estimate"
                    : "Add estimate"}
                </h2>
              </div>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close estimate editor"
                onClick={() => setQuoteDraft(null)}
              >
                <X />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  const existing = store.quotes.find(
                    (quote) => quote.id === quoteDraft.id,
                  );
                  const timestamp = new Date().toISOString();
                  const nextQuote = {
                    ...quoteDraft,
                    serviceDescription: quoteDraft.serviceDescription.trim(),
                    notes: quoteDraft.notes.trim(),
                    updatedAt: timestamp,
                    statusHistory:
                      existing && existing.status !== quoteDraft.status
                        ? [
                            ...existing.statusHistory,
                            {
                              id: crypto.randomUUID(),
                              from: existing.status,
                              to: quoteDraft.status,
                              changedAt: timestamp,
                            },
                          ]
                        : quoteDraft.statusHistory.length
                          ? quoteDraft.statusHistory
                          : [
                              {
                                id: crypto.randomUUID(),
                                from: null,
                                to: quoteDraft.status,
                                changedAt: timestamp,
                              },
                            ],
                  } satisfies Quote;
                  setStore({
                    ...store,
                    quotes: saveQuote(store.quotes, nextQuote),
                  });
                  setQuoteDraft(null);
                  setNotice(
                    cloudWorkspaceId
                      ? "Estimate queued for cloud save."
                      : "Estimate saved on this device.",
                  );
                } catch (error) {
                  setNotice((error as Error).message);
                }
              }}
            >
              <label className="field">
                Service / job description
                <input
                  required
                  value={quoteDraft.serviceDescription}
                  onChange={(event) =>
                    setQuoteDraft({
                      ...quoteDraft,
                      serviceDescription: event.target.value,
                    })
                  }
                  placeholder="Driveway cleaning"
                />
              </label>
              <label className="field">
                Amount (USD)
                <input
                  required
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  type="number"
                  value={
                    quoteDraft.amountCents
                      ? (quoteDraft.amountCents / 100).toFixed(2)
                      : ""
                  }
                  onChange={(event) => {
                    const amount = Number(event.target.value);
                    setQuoteDraft({
                      ...quoteDraft,
                      amountCents: Number.isFinite(amount)
                        ? Math.round(amount * 100)
                        : 0,
                    });
                  }}
                  placeholder="250.00"
                />
              </label>
              <label className="field">
                Status
                <select
                  value={quoteDraft.status}
                  onChange={(event) =>
                    setQuoteDraft({
                      ...quoteDraft,
                      status: event.target.value as Quote["status"],
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                  <option value="declined">Declined</option>
                </select>
              </label>
              <label className="field">
                Notes <span>(optional)</span>
                <textarea
                  rows={3}
                  value={quoteDraft.notes}
                  onChange={(event) =>
                    setQuoteDraft({ ...quoteDraft, notes: event.target.value })
                  }
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setQuoteDraft(null)}
                >
                  Cancel
                </button>
                <button className="button primary" type="submit">
                  <Check size={16} /> Save estimate
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {person && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="person-dialog"
          >
            <div className="modal-heading">
              <h2 id="person-dialog">Contact details</h2>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close contact editor"
                onClick={() => setPerson(null)}
              >
                <X />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const timestamp = new Date().toISOString();
                const savedPerson = {
                  ...person,
                  createdAt: person.createdAt || timestamp,
                  updatedAt: timestamp,
                  interactions: person.interactions ?? [],
                };
                setStore({
                  ...store,
                  people: store.people.some((p) => p.id === person.id)
                    ? store.people.map((p) =>
                        p.id === person.id ? savedPerson : p,
                      )
                    : [...store.people, savedPerson],
                });
                setPerson(null);
                setNotice("Contact saved.");
              }}
            >
              {(
                [
                  "name",
                  "business",
                  "phone",
                  "email",
                  "address",
                  "notes",
                ] as const
              ).map((k) => (
                <label className="field" key={k}>
                  {k === "business"
                    ? "Business / relationship"
                    : k[0].toUpperCase() + k.slice(1)}
                  {k === "notes" ? (
                    <textarea
                      rows={4}
                      value={person[k]}
                      onChange={(e) =>
                        setPerson({ ...person, [k]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      required={k === "name"}
                      type={
                        k === "email" ? "email" : k === "phone" ? "tel" : "text"
                      }
                      value={person[k]}
                      onChange={(e) =>
                        setPerson({ ...person, [k]: e.target.value })
                      }
                    />
                  )}
                </label>
              ))}
              <section
                className="customer-reminders"
                aria-labelledby="quotes-heading"
              >
                <div className="customer-reminders-heading">
                  <h3 id="quotes-heading">Quotes &amp; Estimates</h3>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      const timestamp = new Date().toISOString();
                      setPerson(null);
                      setQuoteDraft({
                        id: crypto.randomUUID(),
                        customerId: person.id,
                        serviceDescription: "",
                        amountCents: 0,
                        currency: "USD",
                        status: "draft",
                        notes: "",
                        createdAt: timestamp,
                        updatedAt: timestamp,
                        statusHistory: [],
                      });
                    }}
                  >
                    <Plus size={14} /> Add estimate
                  </button>
                </div>
                {customerQuotes.length ? (
                  <div className="customer-reminder-list">
                    {customerQuotes.map((quote) => {
                      const relatedReminders = store.tasks.filter(
                        (task) => task.quoteId === quote.id,
                      );
                      return (
                        <article className="customer-reminder" key={quote.id}>
                          <div className="customer-reminder-copy">
                            <strong>{quote.serviceDescription}</strong>
                            <small>
                              {quoteAmountLabel(quote.amountCents)} ·{" "}
                              {quote.status}
                            </small>
                            {quote.notes && <small>{quote.notes}</small>}
                            {relatedReminders.length > 0 && (
                              <div className="quote-related-reminders">
                                {relatedReminders.map((task) => (
                                  <small key={task.id}>
                                    Reminder: {task.title}
                                  </small>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => {
                              setPerson(null);
                              setQuoteDraft({ ...quote });
                            }}
                          >
                            <Pencil size={14} /> Edit estimate
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="customer-reminders-empty">
                    No estimates for this customer yet.
                  </p>
                )}
              </section>
              <section
                className="customer-reminders"
                aria-labelledby="customer-reminders-heading"
              >
                <div className="customer-reminders-heading">
                  <h3 id="customer-reminders-heading">Upcoming reminders</h3>
                  <span>{upcomingCustomerReminders.length}</span>
                </div>
                {upcomingCustomerReminders.length ? (
                  <div className="customer-reminder-list">
                    {upcomingCustomerReminders.map((task) => (
                      <article className="customer-reminder" key={task.id}>
                        <div className="customer-reminder-copy">
                          <strong>{task.title}</strong>
                          <small>{dateLabel(task.due, timezone)}</small>
                        </div>
                        <span
                          className={
                            isOverdueReminder(task)
                              ? "reminder-status overdue"
                              : "reminder-status"
                          }
                        >
                          {isOverdueReminder(task) ? "Overdue" : "Upcoming"}
                        </span>
                        <div className="customer-reminder-actions">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => {
                              setPerson(null);
                              setDraft({ ...task });
                            }}
                          >
                            Edit reminder
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => toggle(task.id)}
                          >
                            <Check size={14} /> Mark complete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="customer-reminders-empty">
                    No upcoming reminders for this customer.
                  </p>
                )}
              </section>
              {completedCustomerReminders.length > 0 && (
                <section
                  className="customer-reminders completed-customer-reminders"
                  aria-label="Completed reminders"
                >
                  <div className="customer-reminders-heading">
                    <h3>Completed reminders</h3>
                    <span>{completedCustomerReminders.length}</span>
                  </div>
                  <div className="customer-reminder-list">
                    {completedCustomerReminders.map((task) => (
                      <article className="customer-reminder" key={task.id}>
                        <div className="customer-reminder-copy">
                          <strong>{task.title}</strong>
                          <small>{dateLabel(task.due, timezone)}</small>
                        </div>
                        <span className="reminder-status completed">
                          Completed
                        </span>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => toggle(task.id)}
                        >
                          Reopen
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <div className="modal-actions">
                {store.people.some((p) => p.id === person.id) && (
                  <button
                    type="button"
                    aria-label="Delete contact"
                    className="icon-button danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this contact? Existing tasks will keep the person’s name.",
                        )
                      ) {
                        setStore({
                          ...store,
                          people: store.people.filter(
                            (p) => p.id !== person.id,
                          ),
                          tasks: store.tasks.map((task) =>
                            task.personId === person.id
                              ? (() => {
                                  const { personId: _personId, ...legacy } =
                                    task;
                                  return legacy;
                                })()
                              : task,
                          ),
                        });
                        setPerson(null);
                      }
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setPerson(null)}
                >
                  Cancel
                </button>
                <button className="button primary">Save contact</button>
              </div>
              {person.interactions.length > 0 && (
                <section
                  className="customer-history"
                  aria-label="Customer history"
                >
                  <h3>Interaction history</h3>
                  {person.interactions
                    .slice()
                    .reverse()
                    .map((item) => (
                      <p key={item.id}>
                        {item.note}
                        <small>
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: timezone,
                          }).format(new Date(item.createdAt))}
                        </small>
                      </p>
                    ))}
                </section>
              )}
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
