import "react-native-url-polyfill/auto";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import * as Speech from "expo-speech";
import Constants from "expo-constants";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from "expo-audio";
import type { File as ExpoFile } from "expo-file-system";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  Share,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { fromLocalInput, type Person, type Task } from "../lib/tasks";
import {
  advanceConversation,
  conversationContext,
  emptyConversationState,
  finishSpeech,
  startConversation,
  type ConversationState,
  type IntentResult,
} from "../lib/conversation-machine";
import { supabase } from "./src/supabase";
import {
  createMobileTask,
  deleteMobileTask,
  listMobileWorkspaces,
  loadMobileWorkspace,
  setMobileTaskCompleted,
  type MobileWorkspace,
  type MobileWorkspaceData,
} from "./src/repository";
import {
  clearMobileWorkspace,
  savedMobileWorkspace,
  saveMobileWorkspace,
} from "./src/workspace-preference";
import { errorMessage, taskDateTimeLabel } from "./src/format";
import {
  filterMobileTasks,
  localIsoDate,
  localTimeInput,
  type MobileTaskFilter,
  mobileTaskSections,
} from "./src/task-list";
import { uploadMobileVoiceTurn } from "./src/voice-api";
import { linkVoiceTask } from "./src/voice-task-link";
import {
  cloudDiagnostic,
  cloudSuccess,
  logCloudDiagnostic,
  type CloudDiagnostic,
} from "./src/cloud-diagnostics";
import {
  microphoneErrorMessage,
  microphoneFailure,
  microphoneSuccess,
  type MicrophoneDiagnostic,
  type MicrophoneStage,
} from "./src/microphone-diagnostics";
import {
  advanceVoiceActivity,
  newVoiceActivity,
  voiceActivityNoiseFloor,
  voiceActivitySilenceMs,
  voiceActivityThreshold,
  type VoiceActivityState,
} from "./src/hands-free-vad";
import {
  canFinalizeHandsFreeTurn,
  canResumeHandsFreeListening,
} from "./src/hands-free-session";
import {
  initialHandsFreeRecorderStatus,
  recorderStatusSnapshot,
  recorderStoppedUnexpectedly,
  type HandsFreeRecorderStatus,
} from "./src/hands-free-recorder-status";
import {
  handsFreeElapsedMs,
  isFreshHandsFreeStatus,
  monotonicNowMs,
} from "./src/hands-free-turn-clock";
import {
  readRecorderStatus,
  readRecorderUri,
  useSafeRecorderStatus,
} from "./src/safe-recorder-status";
import {
  timeInputFromPicker,
  timePickerLabel,
  timePickerValue,
} from "./src/time-picker";
import {
  dateInputFromPicker,
  datePickerLabel,
  datePickerValue,
} from "./src/date-picker";
import { readBuildInfo, shareableBuildInfo } from "./src/build-info";
import { HandsFreeTurnTimer } from "./src/hands-free-timer";
import {
  ASSISTANT_SPEEDS,
  DEFAULT_ASSISTANT_PREFERENCES,
  deviceSpeechRate,
  loadAssistantPreferences,
  NATURAL_VOICE_OPTIONS,
  saveAssistantPreferences,
  type AssistantPreferences,
  type AssistantSpeed,
  type AssistantVoiceId,
} from "./src/assistant-preferences";
import {
  removeNaturalSpeechFile,
  requestNaturalSpeech,
} from "./src/natural-speech-api";
import {
  isCurrentNaturalSpeechRequest,
  naturalSpeechFailureDetails,
} from "./src/natural-speech-response";
import { primaryConversationControl } from "./src/capture-primary-control";

type Tab = "home" | "capture" | "tasks" | "people" | "settings";
type VoiceStatus =
  | "ready"
  | "listening"
  | "user_speaking"
  | "processing"
  | "speaking"
  | "saving"
  | "error";
type VadTransition = {
  turn: number;
  event: string;
  elapsedMs: number;
};
type HandsFreeLoopDiagnostics = {
  timerRunning: boolean;
  timerStarts: number;
  timerTicks: number;
  lastTimerTickAtMs: number | null;
  lastPollAtMs: number | null;
  lastPollAgeMs: number | null;
  latestMeterAtMs: number | null;
};
type NaturalSpeechDiagnostic = {
  source: "natural" | "device";
  stage:
    | "request"
    | "response"
    | "cache"
    | "audio_session"
    | "playback"
    | "complete";
  code: string | null;
  voice: AssistantVoiceId;
  speed: AssistantSpeed;
};
const HANDS_FREE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};
const HANDS_FREE_STATUS_INTERVAL_MS = 100;
const COLORS = {
  ink: "#1B2A23",
  muted: "#64726B",
  cream: "#F7F5EE",
  card: "#FFFFFF",
  sage: "#DDE9D8",
  green: "#2E684A",
  peach: "#F4D9C5",
  line: "#E5E4DA",
  danger: "#A63C32",
};

function MobileApp() {
  const buildInfo = readBuildInfo(Constants);
  const recorder = useAudioRecorder(HANDS_FREE_RECORDING_OPTIONS);
  const naturalSpeechPlayer = useAudioPlayer(null, { updateInterval: 100 });
  const naturalSpeechStatus = useAudioPlayerStatus(naturalSpeechPlayer);
  const recording = useSafeRecorderStatus(
    recorder,
    HANDS_FREE_STATUS_INTERVAL_MS,
  );
  // The interval callbacks below intentionally read the newest native sample,
  // rather than closing over the sample from the render that created them.
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([]);
  const [data, setData] = useState<MobileWorkspaceData | null>(null);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [showNewReminder, setShowNewReminder] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskFilter, setTaskFilter] = useState<MobileTaskFilter>("Upcoming");
  const [taskSearch, setTaskSearch] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [recordingNotice, setRecordingNotice] = useState("");
  const [conversation, setConversation] = useState<ConversationState>(() =>
    emptyConversationState(),
  );
  const conversationRef = useRef(conversation);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("ready");
  const [handsFreeActive, setHandsFreeActive] = useState(false);
  const [handsFreeRecorderStatus, setHandsFreeRecorderStatus] =
    useState<HandsFreeRecorderStatus>(initialHandsFreeRecorderStatus);
  const handsFreeRecorderStatusRef = useRef<HandsFreeRecorderStatus>(
    initialHandsFreeRecorderStatus,
  );
  const handsFreeRecordingStartedAtRef = useRef<number | null>(null);
  const handsFreeStatusStartedAtRef = useRef<number | null>(null);
  const handsFreeWallElapsedRef = useRef(0);
  const handsFreeTimerRef = useRef<HandsFreeTurnTimer | null>(null);
  const handsFreeTimerTurnRef = useRef<number | null>(null);
  const handsFreeTickRef = useRef<(turn: number) => void>(() => {});
  const lastObservedPollAtRef = useRef<number | null>(null);
  const observedPollCountRef = useRef(0);
  const lastMeterDbRef = useRef<number | null>(null);
  const lastMeterChangedAtRef = useRef<number | null>(null);
  const [assistantMuted, setAssistantMuted] = useState(false);
  const assistantMutedRef = useRef(false);
  const [assistantPreferences, setAssistantPreferences] =
    useState<AssistantPreferences>(DEFAULT_ASSISTANT_PREFERENCES);
  const assistantPreferencesRef = useRef(assistantPreferences);
  const assistantPreferencesRequestRef = useRef(0);
  const naturalSpeechCompletionRef = useRef<(() => void) | null>(null);
  const naturalSpeechFallbackRef = useRef<(() => void) | null>(null);
  const naturalSpeechFileRef = useRef<ExpoFile | null>(null);
  const [naturalSpeechDiagnostic, setNaturalSpeechDiagnostic] =
    useState<NaturalSpeechDiagnostic | null>(null);
  const [transcript, setTranscript] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [pendingSave, setPendingSave] = useState<{
    task: Task;
    nextState: ConversationState;
    transcript: string;
  } | null>(null);
  const voiceTurnRef = useRef(0);
  const speechPlaybackRef = useRef(0);
  const handsFreeSessionRef = useRef(0);
  const handsFreeActiveRef = useRef(false);
  const activeRecordingTurnRef = useRef<number | null>(null);
  const autoFinalizeTurnRef = useRef<number | null>(null);
  const voiceActivityRef = useRef<VoiceActivityState>(newVoiceActivity());
  const startListeningRef = useRef<(sessionId: number) => Promise<void>>(
    async () => {},
  );
  const workspaceRequestRef = useRef(0);
  const workspaceDataRevisionRef = useRef(0);
  const restoreRequestRef = useRef(0);
  const [cloudDiagnostics, setCloudDiagnostics] = useState<CloudDiagnostic[]>(
    [],
  );
  const [microphoneDiagnostics, setMicrophoneDiagnostics] = useState<
    MicrophoneDiagnostic[]
  >([]);
  const [vadTransitions, setVadTransitions] = useState<VadTransition[]>([]);
  if (handsFreeTimerRef.current === null)
    handsFreeTimerRef.current = new HandsFreeTurnTimer();
  const [handsFreeLoopDiagnostics, setHandsFreeLoopDiagnostics] =
    useState<HandsFreeLoopDiagnostics>({
      timerRunning: false,
      timerStarts: 0,
      timerTicks: 0,
      lastTimerTickAtMs: null,
      lastPollAtMs: null,
      lastPollAgeMs: null,
      latestMeterAtMs: null,
    });

  const recordCloudDiagnostic = useCallback((diagnostic: CloudDiagnostic) => {
    logCloudDiagnostic(diagnostic);
    setCloudDiagnostics((current) => [diagnostic, ...current].slice(0, 12));
  }, []);
  const recordMicrophoneDiagnostic = useCallback(
    (diagnostic: MicrophoneDiagnostic) => {
      console.info("[LeadLoop mobile microphone]", JSON.stringify(diagnostic));
      setMicrophoneDiagnostics((current) =>
        [diagnostic, ...current].slice(0, 12),
      );
    },
    [],
  );
  const recordVadTransition = useCallback(
    (turn: number, event: string, elapsedMs: number) => {
      if (process.env.NODE_ENV === "production") return;
      setVadTransitions((current) =>
        [{ turn, event, elapsedMs }, ...current].slice(0, 12),
      );
    },
    [],
  );

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    assistantMutedRef.current = assistantMuted;
  }, [assistantMuted]);

  useEffect(() => {
    assistantPreferencesRef.current = assistantPreferences;
    assistantMutedRef.current = assistantPreferences.muted;
    setAssistantMuted(assistantPreferences.muted);
  }, [assistantPreferences]);

  useEffect(() => {
    if (!sessionUserId || !data?.workspace.id) {
      setAssistantPreferences({ ...DEFAULT_ASSISTANT_PREFERENCES });
      return;
    }
    const requestId = ++assistantPreferencesRequestRef.current;
    void loadAssistantPreferences(sessionUserId, data.workspace.id)
      .then((preferences) => {
        if (requestId !== assistantPreferencesRequestRef.current) return;
        setAssistantPreferences(preferences);
      })
      .catch(() => {
        if (requestId !== assistantPreferencesRequestRef.current) return;
        setAssistantPreferences({ ...DEFAULT_ASSISTANT_PREFERENCES });
      });
  }, [data?.workspace.id, sessionUserId]);

  const updateAssistantPreferences = useCallback(
    (change: Partial<AssistantPreferences>) => {
      const next = { ...assistantPreferencesRef.current, ...change };
      // A Preview press can follow a preference tap in the same native event
      // sequence. Keep the request source synchronous with the selected UI.
      assistantPreferencesRef.current = next;
      setAssistantPreferences(next);
      if (!sessionUserId || !data?.workspace.id) return;
      void saveAssistantPreferences(
        sessionUserId,
        data.workspace.id,
        next,
      ).catch(() => {
        setNotice(
          "Your voice preference is active for now, but could not be saved on this device.",
        );
      });
    },
    [data?.workspace.id, sessionUserId],
  );

  const clearNaturalSpeech = useCallback(() => {
    naturalSpeechCompletionRef.current = null;
    naturalSpeechFallbackRef.current = null;
    try {
      naturalSpeechPlayer.pause();
      naturalSpeechPlayer.replace(null);
    } catch {
      // A released player is already silent.
    }
    removeNaturalSpeechFile(naturalSpeechFileRef.current);
    naturalSpeechFileRef.current = null;
  }, [naturalSpeechPlayer]);

  useEffect(() => {
    const playbackError = (
      naturalSpeechStatus as typeof naturalSpeechStatus & {
        error?: string | null;
      }
    ).error;
    if (!naturalSpeechStatus.didJustFinish && !playbackError) return;
    const complete = naturalSpeechCompletionRef.current;
    const fallback = naturalSpeechFallbackRef.current;
    clearNaturalSpeech();
    if (playbackError) {
      setNaturalSpeechDiagnostic((current) =>
        current
          ? {
              ...current,
              source: "device",
              stage: "playback",
              code: "SPEECH_PLAYBACK_FAILED",
            }
          : current,
      );
      if (fallback) fallback();
    } else {
      setNaturalSpeechDiagnostic((current) =>
        current ? { ...current, stage: "complete", code: null } : current,
      );
      complete?.();
    }
  }, [clearNaturalSpeech, naturalSpeechStatus]);

  const client = supabase;
  const timezone = data?.timezone ?? "America/Chicago";
  const taskSections = useMemo(
    () => mobileTaskSections(data?.tasks ?? [], timezone),
    [data?.tasks, timezone],
  );

  const chooseWorkspace = useCallback(
    async (workspace: MobileWorkspace, userId: string) => {
      if (!client || !userId) return;
      const requestId = ++workspaceRequestRef.current;
      const dataRevision = workspaceDataRevisionRef.current;
      setBusy(true);
      setError("");
      try {
        const next = await loadMobileWorkspace(client, workspace);
        if (
          requestId !== workspaceRequestRef.current ||
          dataRevision !== workspaceDataRevisionRef.current
        )
          return;
        await saveMobileWorkspace(userId, workspace.id);
        if (
          requestId !== workspaceRequestRef.current ||
          dataRevision !== workspaceDataRevisionRef.current
        )
          return;
        setData(next);
        setShowWorkspacePicker(false);
        setError("");
        next.diagnostics.forEach(recordCloudDiagnostic);
        recordCloudDiagnostic(cloudSuccess("workspace_load"));
      } catch (reason) {
        if (requestId !== workspaceRequestRef.current) return;
        const diagnostic = cloudDiagnostic("workspace_load", reason);
        recordCloudDiagnostic(diagnostic);
        if (diagnostic.kind === "access") {
          // A failed read alone is not proof that access was revoked. Confirm
          // it with a fresh membership list before changing the active view.
          try {
            const fresh = await listMobileWorkspaces(client);
            if (requestId !== workspaceRequestRef.current) return;
            setWorkspaces(fresh);
            if (!fresh.some((item) => item.id === workspace.id)) {
              await clearMobileWorkspace(userId);
              setData(null);
              setShowWorkspacePicker(true);
              setError(
                "You no longer have access to that workspace. Choose another workspace or sign in again.",
              );
              return;
            }
          } catch {
            // Network and auth-refresh errors keep the existing workspace.
          }
        }
        if (diagnostic.kind === "access")
          setError(
            "LeadLoop could not reload this workspace. Your current cloud data remains available; check your connection and retry.",
          );
        else setError(errorMessage(reason));
      } finally {
        if (requestId === workspaceRequestRef.current) setBusy(false);
      }
    },
    [client, recordCloudDiagnostic],
  );

  const restore = useCallback(async () => {
    if (!client) {
      setLoading(false);
      return;
    }
    const restoreId = ++restoreRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const { data: auth, error: authError } = await client.auth.getSession();
      if (authError) throw authError;
      if (restoreId !== restoreRequestRef.current) return;
      recordCloudDiagnostic(cloudSuccess("auth_session"));
      const user = auth.session?.user ?? null;
      setSessionUserId(user?.id ?? null);
      if (!user) {
        setData(null);
        setWorkspaces([]);
        return;
      }
      const available = await listMobileWorkspaces(client);
      if (restoreId !== restoreRequestRef.current) return;
      recordCloudDiagnostic(cloudSuccess("workspace_list"));
      setWorkspaces(available);
      const remembered = await savedMobileWorkspace(user.id);
      const workspace =
        available.find((item) => item.id === remembered) ??
        (available.length === 1 ? available[0] : undefined);
      if (workspace) await chooseWorkspace(workspace, user.id);
      else {
        setData(null);
        setShowWorkspacePicker(true);
      }
    } catch (reason) {
      if (restoreId !== restoreRequestRef.current) return;
      const diagnostic = cloudDiagnostic("workspace_restore", reason);
      recordCloudDiagnostic(diagnostic);
      if (diagnostic.kind === "access")
        setError(
          "LeadLoop could not restore the workspace list. Your loaded cloud data remains available; tap Retry cloud connection.",
        );
      else setError(errorMessage(reason));
    } finally {
      if (restoreId === restoreRequestRef.current) setLoading(false);
    }
  }, [chooseWorkspace, client, recordCloudDiagnostic]);

  useEffect(() => {
    void restore();
    if (!client) return;
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => {
        setSessionUserId(session?.user.id ?? null);
        if (!session) {
          restoreRequestRef.current += 1;
          workspaceRequestRef.current += 1;
          setData(null);
          setWorkspaces([]);
        }
      },
    );
    return () => subscription.subscription.unsubscribe();
  }, [client, restore]);

  const signIn = async () => {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      setPassword("");
      setNotice("Signed in securely.");
      await restore();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const userId = sessionUserId;
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) throw signOutError;
      if (userId) await clearMobileWorkspace(userId);
      restoreRequestRef.current += 1;
      workspaceRequestRef.current += 1;
      setData(null);
      setWorkspaces([]);
      setSessionUserId(null);
      setNotice("Signed out. Your cloud records were not changed.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const reloadWorkspace = async () => {
    if (!data || !client || !sessionUserId) return;
    await chooseWorkspace(data.workspace, sessionUserId);
  };

  const toggleCompleted = async (task: Task) => {
    if (!client || !data) return;
    setBusy(true);
    setError("");
    try {
      await setMobileTaskCompleted(
        client,
        data.workspace.id,
        task.id,
        !task.completed,
      );
      workspaceDataRevisionRef.current += 1;
      setData((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.map((entry) =>
                entry.id === task.id
                  ? { ...entry, completed: !task.completed }
                  : entry,
              ),
            }
          : current,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openTaskEditor = (task?: Task) => {
    setEditingTask(task ?? null);
    setTitle(task?.title ?? "");
    setSelectedPerson(
      task?.personId
        ? (data?.people.find((person) => person.id === task.personId) ?? null)
        : null,
    );
    if (task?.due) {
      const due = new Date(task.due);
      setDate(localIsoDate(due, timezone));
      setTime(localTimeInput(due, timezone));
    } else {
      setDate(localIsoDate(new Date(), timezone));
      setTime("09:00");
    }
    setShowNewReminder(true);
  };

  const deleteTask = async () => {
    if (!client || !data || !editingTask) return;
    setBusy(true);
    setError("");
    try {
      await deleteMobileTask(client, data.workspace.id, editingTask.id);
      workspaceDataRevisionRef.current += 1;
      setData((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.filter((task) => task.id !== editingTask.id),
            }
          : current,
      );
      setShowNewReminder(false);
      setEditingTask(null);
      setNotice("Reminder removed from your cloud workspace.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveReminder = async () => {
    if (!client || !data) return;
    if (!title.trim()) {
      setError("Tell LeadLoop what you want to remember.");
      return;
    }
    if (!date || !time) {
      setError("Choose a date and time before saving this reminder.");
      return;
    }
    let due: string;
    try {
      due = fromLocalInput(`${date}T${time}`, data.timezone);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Choose a valid date and time before saving this reminder.",
      );
      return;
    }
    if (!due || Number.isNaN(Date.parse(due))) {
      setError("Choose a valid date and time before saving this reminder.");
      return;
    }
    const task: Task = {
      id: editingTask?.id ?? Crypto.randomUUID(),
      title: title.trim(),
      person: selectedPerson?.name ?? editingTask?.person ?? "",
      ...(selectedPerson
        ? { personId: selectedPerson.id }
        : editingTask?.personId
          ? { personId: editingTask.personId }
          : {}),
      due,
      completed: editingTask?.completed ?? false,
      notes: editingTask?.notes ?? "",
    };
    setBusy(true);
    setError("");
    try {
      await createMobileTask(client, {
        ...task,
        workspaceId: data.workspace.id,
      });
      workspaceDataRevisionRef.current += 1;
      setData((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.some((entry) => entry.id === task.id)
                ? current.tasks.map((entry) =>
                    entry.id === task.id ? task : entry,
                  )
                : [...current.tasks, task],
            }
          : current,
      );
      setShowNewReminder(false);
      setEditingTask(null);
      setTitle("");
      setDate("");
      setTime("");
      setSelectedPerson(null);
      setNotice("Reminder saved to your cloud workspace.");
      setTab("tasks");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const speakReply = useCallback(
    (reply: string, nextState: ConversationState) => {
      setAssistantReply(reply);
      setVoiceStatus("speaking");
      const sessionId = handsFreeSessionRef.current;
      const playbackId = ++speechPlaybackRef.current;
      const complete = () => {
        if (
          !isCurrentNaturalSpeechRequest(playbackId, speechPlaybackRef.current)
        )
          return;
        if (nextState.stage === "reading_back") {
          setConversation((current) => {
            const next = finishSpeech(current);
            conversationRef.current = next;
            return next;
          });
        }
        if (nextState.stage === "ended") {
          handsFreeActiveRef.current = false;
          setHandsFreeActive(false);
          setVoiceStatus("ready");
          setRecordingNotice("Conversation ended.");
          return;
        }
        if (
          canResumeHandsFreeListening({
            active: handsFreeActiveRef.current,
            callbackSessionId: sessionId,
            currentSessionId: handsFreeSessionRef.current,
            nextStage: nextState.stage,
          })
        ) {
          void startListeningRef.current(sessionId);
          return;
        }
        setVoiceStatus("ready");
      };
      if (assistantMutedRef.current) {
        complete();
        return;
      }
      const deviceFallback = () => {
        if (
          !isCurrentNaturalSpeechRequest(playbackId, speechPlaybackRef.current)
        )
          return;
        try {
          Speech.stop();
          Speech.speak(reply, {
            rate: deviceSpeechRate(assistantPreferencesRef.current.speed),
            onDone: complete,
            onError: complete,
            onStopped: complete,
          });
        } catch {
          // Text remains visible and the conversation must not get stuck when
          // the device speech engine is unavailable.
          complete();
        }
      };
      const preferences = assistantPreferencesRef.current;
      if (preferences.mode !== "natural" || !client || !data) {
        deviceFallback();
        return;
      }
      Speech.stop();
      clearNaturalSpeech();
      void requestNaturalSpeech({
        client,
        workspaceId: data.workspace.id,
        text: reply,
        voice: preferences.voice,
        speed: preferences.speed,
      })
        .then(async (naturalSpeech) => {
          if (
            !isCurrentNaturalSpeechRequest(
              playbackId,
              speechPlaybackRef.current,
            )
          ) {
            removeNaturalSpeechFile(naturalSpeech.file);
            return;
          }
          try {
            await setAudioModeAsync({
              allowsRecording: false,
              playsInSilentMode: true,
            });
          } catch {
            removeNaturalSpeechFile(naturalSpeech.file);
            setNaturalSpeechDiagnostic({
              source: "device",
              stage: "audio_session",
              code: "SPEECH_AUDIO_SESSION_FAILED",
              voice: preferences.voice,
              speed: preferences.speed,
            });
            deviceFallback();
            return;
          }
          if (
            !isCurrentNaturalSpeechRequest(
              playbackId,
              speechPlaybackRef.current,
            )
          ) {
            removeNaturalSpeechFile(naturalSpeech.file);
            return;
          }
          naturalSpeechFileRef.current = naturalSpeech.file;
          naturalSpeechCompletionRef.current = complete;
          naturalSpeechFallbackRef.current = deviceFallback;
          setNaturalSpeechDiagnostic({
            source: "natural",
            stage: "playback",
            code: null,
            voice: naturalSpeech.voice,
            speed: naturalSpeech.speed,
          });
          naturalSpeechPlayer.replace(naturalSpeech.file.uri);
          naturalSpeechPlayer.play();
        })
        .catch((error: unknown) => {
          // Natural synthesis is an opt-in enhancement. A network or provider
          // failure must never prevent the existing device voice or listening.
          const failure = naturalSpeechFailureDetails(error);
          if (
            isCurrentNaturalSpeechRequest(playbackId, speechPlaybackRef.current)
          )
            clearNaturalSpeech();
          setNaturalSpeechDiagnostic({
            source: "device",
            stage: failure.stage,
            code: failure.code,
            voice: preferences.voice,
            speed: preferences.speed,
          });
          deviceFallback();
        });
    },
    [clearNaturalSpeech, client, data, naturalSpeechPlayer],
  );

  const previewNaturalVoice = useCallback(
    (voice: AssistantVoiceId) => {
      if (handsFreeActiveRef.current) {
        setNotice("End the active conversation before previewing a voice.");
        return;
      }
      if (!client || !data) return;
      if (assistantPreferencesRef.current.mode !== "natural") {
        setNotice(
          "Enable Natural AI voice before requesting a paid voice preview.",
        );
        return;
      }
      const playbackId = ++speechPlaybackRef.current;
      const speed = assistantPreferencesRef.current.speed;
      const text = `Hi, I’m LeadLoop. This is the ${voice} natural AI voice at ${speed} pace. I’ll help you keep your business moving.`;
      Speech.stop();
      clearNaturalSpeech();
      setNotice("Preparing your natural voice preview…");
      void requestNaturalSpeech({
        client,
        workspaceId: data.workspace.id,
        text,
        voice,
        speed,
      })
        .then(async (naturalSpeech) => {
          if (
            !isCurrentNaturalSpeechRequest(
              playbackId,
              speechPlaybackRef.current,
            )
          ) {
            removeNaturalSpeechFile(naturalSpeech.file);
            return;
          }
          try {
            await setAudioModeAsync({
              allowsRecording: false,
              playsInSilentMode: true,
            });
          } catch {
            removeNaturalSpeechFile(naturalSpeech.file);
            setNaturalSpeechDiagnostic({
              source: "device",
              stage: "audio_session",
              code: "SPEECH_AUDIO_SESSION_FAILED",
              voice,
              speed,
            });
            setNotice(
              "Device fallback · audio session · SPEECH_AUDIO_SESSION_FAILED",
            );
            Speech.speak(text, { rate: deviceSpeechRate(speed) });
            return;
          }
          if (
            !isCurrentNaturalSpeechRequest(
              playbackId,
              speechPlaybackRef.current,
            )
          ) {
            removeNaturalSpeechFile(naturalSpeech.file);
            return;
          }
          naturalSpeechFileRef.current = naturalSpeech.file;
          naturalSpeechCompletionRef.current = () => {
            if (
              !isCurrentNaturalSpeechRequest(
                playbackId,
                speechPlaybackRef.current,
              )
            )
              return;
            setNotice(`Natural AI preview finished · ${voice} · ${speed}`);
          };
          naturalSpeechFallbackRef.current = () => {
            if (
              !isCurrentNaturalSpeechRequest(
                playbackId,
                speechPlaybackRef.current,
              )
            )
              return;
            setNotice("Device fallback · playback · SPEECH_PLAYBACK_FAILED");
            Speech.speak(text, { rate: deviceSpeechRate(speed) });
          };
          setNaturalSpeechDiagnostic({
            source: "natural",
            stage: "playback",
            code: null,
            voice: naturalSpeech.voice,
            speed: naturalSpeech.speed,
          });
          setNotice(
            `Natural AI preview · ${naturalSpeech.voice} · ${naturalSpeech.speed}`,
          );
          naturalSpeechPlayer.replace(naturalSpeech.file.uri);
          naturalSpeechPlayer.play();
        })
        .catch((error: unknown) => {
          if (
            !isCurrentNaturalSpeechRequest(
              playbackId,
              speechPlaybackRef.current,
            )
          )
            return;
          const failure = naturalSpeechFailureDetails(error);
          clearNaturalSpeech();
          setNaturalSpeechDiagnostic({
            source: "device",
            stage: failure.stage,
            code: failure.code,
            voice,
            speed,
          });
          setNotice(`Device fallback · ${failure.stage} · ${failure.code}`);
          Speech.speak(text, { rate: deviceSpeechRate(speed) });
        });
    },
    [clearNaturalSpeech, client, data, naturalSpeechPlayer],
  );

  const persistConfirmedTask = useCallback(
    async (
      task: Task,
      nextState: ConversationState,
      turnTranscript: string,
    ) => {
      if (!client || !data) return;
      setVoiceStatus("saving");
      const linked = linkVoiceTask(
        task,
        turnTranscript,
        data.people,
        data.quotes,
      );
      try {
        await createMobileTask(client, {
          ...linked,
          workspaceId: data.workspace.id,
        });
        workspaceDataRevisionRef.current += 1;
        setData((current) =>
          current
            ? {
                ...current,
                tasks: current.tasks.some((entry) => entry.id === linked.id)
                  ? current.tasks
                  : [...current.tasks, linked],
              }
            : current,
        );
        setPendingSave(null);
        conversationRef.current = nextState;
        setConversation(nextState);
        speakReply(
          "Perfect, your reminder is saved. Anything else?",
          nextState,
        );
      } catch (reason) {
        setPendingSave({ task, nextState, transcript: turnTranscript });
        setVoiceStatus("error");
        setError(
          `I couldn't save that reminder to the cloud. ${errorMessage(reason)} Your confirmed reminder is ready to retry.`,
        );
      }
    },
    [client, data, speakReply],
  );

  const applyVoiceResult = useCallback(
    async (result: IntentResult, turnTranscript: string) => {
      if (!data) return;
      const transition = advanceConversation({
        state: conversationRef.current,
        result,
        text: turnTranscript,
        timeZone: data.timezone,
        createId: () => Crypto.randomUUID(),
        now: new Date(),
      });
      if (transition.savedTask) {
        await persistConfirmedTask(
          transition.savedTask,
          transition.state,
          turnTranscript,
        );
        return;
      }
      conversationRef.current = transition.state;
      setConversation(transition.state);
      speakReply(transition.reply, transition.state);
    },
    [data, persistConfirmedTask, speakReply],
  );

  const confirmationResult = (): IntentResult => ({
    intent: {
      kind: "confirm",
      fields: {
        title: null,
        person: null,
        date: null,
        time: null,
        notes: null,
        clearDue: false,
      },
    },
  });

  const confirmByButton = async () => {
    if (voiceStatus !== "ready") return;
    await applyVoiceResult(confirmationResult(), "Yes");
  };

  const retryPendingSave = async () => {
    if (!pendingSave) return;
    await persistConfirmedTask(
      pendingSave.task,
      pendingSave.nextState,
      pendingSave.transcript,
    );
  };

  // This ticker is deliberately started from the successful recorder-start
  // path, rather than from a React effect that waits for recorder status
  // updates. Expo Go may keep that status frozen while audio is recording.
  const clearHandsFreeTicker = useCallback((turn?: number) => {
    if (
      turn !== undefined &&
      handsFreeTimerTurnRef.current !== null &&
      handsFreeTimerTurnRef.current !== turn
    )
      return;
    handsFreeTimerRef.current?.stop();
    handsFreeTimerTurnRef.current = null;
    setHandsFreeLoopDiagnostics((current) => ({
      ...current,
      timerRunning: false,
    }));
  }, []);

  const startHandsFreeTicker = useCallback(
    (turn: number) => {
      clearHandsFreeTicker();
      handsFreeTimerTurnRef.current = turn;
      lastObservedPollAtRef.current = null;
      observedPollCountRef.current = 0;
      lastMeterDbRef.current = null;
      lastMeterChangedAtRef.current = null;
      setHandsFreeLoopDiagnostics((current) => ({
        ...current,
        timerRunning: true,
        timerStarts: current.timerStarts + 1,
        timerTicks: 0,
        lastTimerTickAtMs: null,
        lastPollAtMs: null,
        lastPollAgeMs: null,
        latestMeterAtMs: null,
      }));
      const tick = () => handsFreeTickRef.current(turn);
      tick();
      handsFreeTimerRef.current?.start(tick, HANDS_FREE_STATUS_INTERVAL_MS);
    },
    [clearHandsFreeTicker],
  );

  const startListeningTurn = useCallback(
    async (sessionId?: number) => {
      if (
        sessionId !== undefined &&
        (!handsFreeActiveRef.current ||
          sessionId !== handsFreeSessionRef.current)
      )
        return;
      if (
        recordingRef.current.isRecording ||
        activeRecordingTurnRef.current !== null
      )
        return;
      if (!client || !data) {
        setVoiceStatus("error");
        setError("Choose a cloud workspace before recording.");
        return;
      }
      let stage: MicrophoneStage = "permission";
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          recordMicrophoneDiagnostic(microphoneFailure("permission"));
          setVoiceStatus("error");
          setError(microphoneErrorMessage("permission"));
          return;
        }
        if (
          sessionId !== undefined &&
          (!handsFreeActiveRef.current ||
            sessionId !== handsFreeSessionRef.current)
        )
          return;
        recordMicrophoneDiagnostic(microphoneSuccess("permission"));
        stage = "audio_session";
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        recordMicrophoneDiagnostic(microphoneSuccess("audio_session"));
        stage = "prepare";
        await recorder.prepareToRecordAsync();
        recordMicrophoneDiagnostic(microphoneSuccess("prepare"));
        stage = "start";
        const turn = ++voiceTurnRef.current;
        activeRecordingTurnRef.current = turn;
        autoFinalizeTurnRef.current = null;
        voiceActivityRef.current = newVoiceActivity();
        recorder.record();
        const recorderStatus = readRecorderStatus(recorder);
        if (recorderStatus.nativeError || !recorderStatus.isRecording)
          throw new Error("Recorder did not enter recording state.");
        const recordingStartedAtMs = monotonicNowMs();
        const statusStartedAtMs = Date.now();
        handsFreeRecordingStartedAtRef.current = recordingStartedAtMs;
        handsFreeStatusStartedAtRef.current = statusStartedAtMs;
        handsFreeWallElapsedRef.current = 0;
        const initialStatus = recorderStatusSnapshot(
          recorderStatus,
          statusStartedAtMs,
          "waiting",
          0,
        );
        handsFreeRecorderStatusRef.current = initialStatus;
        setHandsFreeRecorderStatus(initialStatus);
        recordVadTransition(turn, "recording_started", 0);
        recordMicrophoneDiagnostic(microphoneSuccess("start"));
        setVoiceStatus("listening");
        if (sessionId !== undefined) startHandsFreeTicker(turn);
        setRecordingNotice(
          sessionId === undefined
            ? "Listening. Tap Stop when you are done."
            : "Listening for you…",
        );
      } catch {
        activeRecordingTurnRef.current = null;
        recordMicrophoneDiagnostic(microphoneFailure(stage));
        setError(microphoneErrorMessage(stage));
        setVoiceStatus("error");
      }
    },
    [
      client,
      data,
      recorder,
      recordMicrophoneDiagnostic,
      recordVadTransition,
      startHandsFreeTicker,
    ],
  );

  useEffect(() => {
    startListeningRef.current = startListeningTurn;
  }, [startListeningTurn]);

  const stopAndProcessRecording = useCallback(
    async (
      turn: number,
      options: {
        discard?: boolean;
        retryListening?: boolean;
        preserveError?: boolean;
      } = {},
    ) => {
      if (turn !== voiceTurnRef.current) return;
      clearHandsFreeTicker(turn);
      const durationMs = Math.max(
        recordingRef.current.durationMillis,
        handsFreeRecorderStatusRef.current.durationMillis,
        handsFreeWallElapsedRef.current,
      );
      try {
        await recorder.stop();
      } catch {
        if (turn !== voiceTurnRef.current) return;
        activeRecordingTurnRef.current = null;
        recordMicrophoneDiagnostic(microphoneFailure("stop"));
        setVoiceStatus("error");
        setError(microphoneErrorMessage("stop"));
        return;
      }
      if (turn !== voiceTurnRef.current) return;
      activeRecordingTurnRef.current = null;
      recordMicrophoneDiagnostic(microphoneSuccess("stop"));
      const sessionId = handsFreeSessionRef.current;
      if (options.discard) {
        if (options.retryListening && handsFreeActiveRef.current) {
          setRecordingNotice(
            "I didn’t hear a usable response. Still listening…",
          );
          await startListeningRef.current(sessionId);
        } else if (!options.preserveError) {
          setVoiceStatus("ready");
        }
        return;
      }
      const audioUri = readRecorderUri(recorder);
      const capturedDurationMs = durationMs;
      if (!audioUri || capturedDurationMs < 100) {
        recordMicrophoneDiagnostic(microphoneFailure("file"));
        setVoiceStatus("error");
        setError(microphoneErrorMessage("file"));
        return;
      }
      recordMicrophoneDiagnostic(microphoneSuccess("file"));
      if (!client || !data) {
        setVoiceStatus("error");
        setError("Choose a cloud workspace before recording.");
        return;
      }
      try {
        setVoiceStatus("processing");
        setRecordingNotice("Processing your request…");
        const payload = await uploadMobileVoiceTurn({
          client,
          workspaceId: data.workspace.id,
          audioUri,
          durationMs: capturedDurationMs,
          timeZone: data.timezone,
          context: conversationContext(conversationRef.current),
        });
        if (turn !== voiceTurnRef.current) return;
        setTranscript(payload.transcript);
        setRecordingNotice("");
        await applyVoiceResult(payload.result, payload.transcript);
      } catch (reason) {
        if (turn !== voiceTurnRef.current) return;
        recordCloudDiagnostic(cloudDiagnostic("voice_upload", reason));
        setVoiceStatus("error");
        setError(errorMessage(reason));
      }
    },
    [
      applyVoiceResult,
      clearHandsFreeTicker,
      client,
      data,
      recorder,
      recordCloudDiagnostic,
      recordMicrophoneDiagnostic,
    ],
  );

  const pauseHandsFreeForMeterFailure = useCallback(
    (
      turn: number,
      action:
        | "meter_unavailable"
        | "meter_stalled"
        | "recorder_inactive"
        | "recorder_invalidated",
    ) => {
      if (!canFinalizeHandsFreeTurn(turn, autoFinalizeTurnRef.current)) return;
      autoFinalizeTurnRef.current = turn;
      if (action === "recorder_invalidated")
        recordMicrophoneDiagnostic(microphoneFailure("status"));
      recordVadTransition(turn, action, handsFreeWallElapsedRef.current);
      const message =
        action === "recorder_invalidated"
          ? "The iPhone recorder was interrupted or reloaded. Reload Expo, then start the conversation again."
          : action === "recorder_inactive"
            ? "The iPhone stopped recording before LeadLoop could hear you. Resume listening or use Record one turn."
            : "Hands-free speech detection could not read the iPhone microphone level. Resume listening or use Record one turn.";
      setHandsFreeRecorderStatus((current) => {
        const next = { ...current, action };
        handsFreeRecorderStatusRef.current = next;
        return next;
      });
      setRecordingNotice(
        "Hands-free listening paused. Your reminder was not changed.",
      );
      setError(message);
      setVoiceStatus("error");
      void stopAndProcessRecording(turn, {
        discard: true,
        preserveError: true,
      });
    },
    [recordMicrophoneDiagnostic, recordVadTransition, stopAndProcessRecording],
  );

  // Keep this implementation in a ref so the timer created by
  // startListeningTurn survives ordinary React renders. Its clock has no
  // dependency on recorder duration or on the recorder-status hook.
  handsFreeTickRef.current = (turn) => {
    const recordingStartedAtMs = handsFreeRecordingStartedAtRef.current;
    const statusStartedAtMs = handsFreeStatusStartedAtRef.current;
    if (
      recordingStartedAtMs === null ||
      statusStartedAtMs === null ||
      activeRecordingTurnRef.current !== turn ||
      !handsFreeActiveRef.current
    ) {
      clearHandsFreeTicker(turn);
      return;
    }

    const nowEpochMs = Date.now();
    const elapsedMs = handsFreeElapsedMs(
      recordingStartedAtMs,
      monotonicNowMs(),
    );
    handsFreeWallElapsedRef.current = elapsedMs;
    const nativeStatus = recordingRef.current;
    const fresh = isFreshHandsFreeStatus(
      nativeStatus.checkedAtMs,
      statusStartedAtMs,
    );
    if (
      nativeStatus.checkedAtMs !== null &&
      nativeStatus.checkedAtMs !== lastObservedPollAtRef.current
    ) {
      lastObservedPollAtRef.current = nativeStatus.checkedAtMs;
      observedPollCountRef.current += 1;
    }
    const meterDb = fresh ? nativeStatus.metering : undefined;
    if (
      Number.isFinite(meterDb) &&
      (lastMeterDbRef.current === null ||
        Math.abs((meterDb as number) - lastMeterDbRef.current) >= 0.1)
    ) {
      lastMeterDbRef.current = meterDb as number;
      lastMeterChangedAtRef.current = nowEpochMs;
    }
    setHandsFreeLoopDiagnostics((current) => ({
      ...current,
      timerRunning: true,
      timerTicks: current.timerTicks + 1,
      lastTimerTickAtMs: nowEpochMs,
      lastPollAtMs: nativeStatus.checkedAtMs,
      lastPollAgeMs:
        nativeStatus.checkedAtMs === null
          ? null
          : Math.max(0, nowEpochMs - nativeStatus.checkedAtMs),
      latestMeterAtMs: lastMeterChangedAtRef.current,
    }));

    const snapshot = recorderStatusSnapshot(
      nativeStatus,
      nativeStatus.checkedAtMs ?? nowEpochMs,
      handsFreeRecorderStatusRef.current.action,
      elapsedMs,
    );
    handsFreeRecorderStatusRef.current = snapshot;
    setHandsFreeRecorderStatus(snapshot);

    if (fresh && nativeStatus.nativeError) {
      pauseHandsFreeForMeterFailure(turn, "recorder_invalidated");
      return;
    }
    if (fresh && recorderStoppedUnexpectedly(snapshot)) {
      pauseHandsFreeForMeterFailure(turn, "recorder_inactive");
      return;
    }
    const result = advanceVoiceActivity(
      voiceActivityRef.current,
      elapsedMs,
      meterDb,
    );
    voiceActivityRef.current = result.state;
    const next = { ...snapshot, action: result.action };
    handsFreeRecorderStatusRef.current = next;
    setHandsFreeRecorderStatus(next);
    if (result.action !== "continue")
      recordVadTransition(turn, result.action, elapsedMs);
    if (result.action === "speech_started") {
      setVoiceStatus("user_speaking");
      setRecordingNotice("Hearing you…");
      return;
    }
    if (
      result.action === "meter_unavailable" ||
      result.action === "meter_stalled"
    ) {
      pauseHandsFreeForMeterFailure(turn, result.action);
      return;
    }
    if (
      (result.action === "submit" || result.action === "retry_silence") &&
      canFinalizeHandsFreeTurn(turn, autoFinalizeTurnRef.current)
    ) {
      autoFinalizeTurnRef.current = turn;
      void stopAndProcessRecording(turn, {
        discard: result.action === "retry_silence",
        retryListening: result.action === "retry_silence",
      });
    }
  };

  useEffect(() => {
    if (
      !recording.nativeError ||
      handsFreeActive ||
      activeRecordingTurnRef.current === null
    )
      return;
    activeRecordingTurnRef.current = null;
    autoFinalizeTurnRef.current = null;
    recordMicrophoneDiagnostic(microphoneFailure("status"));
    setVoiceStatus("error");
    setError(microphoneErrorMessage("status"));
  }, [handsFreeActive, recordMicrophoneDiagnostic, recording.nativeError]);

  useEffect(() => {
    if (!recording.mediaServicesDidReset) return;
    activeRecordingTurnRef.current = null;
    autoFinalizeTurnRef.current = null;
    setVoiceStatus("error");
    setError(
      "The iPhone audio session was interrupted. Your reminder was not changed; resume or record one turn to continue.",
    );
  }, [recording.mediaServicesDidReset]);

  useEffect(
    () => () => {
      handsFreeActiveRef.current = false;
      handsFreeTimerRef.current?.stop();
      handsFreeTimerTurnRef.current = null;
      handsFreeRecordingStartedAtRef.current = null;
      handsFreeStatusStartedAtRef.current = null;
      handsFreeWallElapsedRef.current = 0;
      voiceTurnRef.current += 1;
      speechPlaybackRef.current += 1;
      Speech.stop();
      clearNaturalSpeech();
      void recorder.stop().catch(() => {
        // A released recorder needs no further cleanup.
      });
    },
    [clearNaturalSpeech, recorder],
  );

  const startHandsFreeConversation = async () => {
    if (handsFreeActiveRef.current) return;
    speechPlaybackRef.current += 1;
    Speech.stop();
    clearNaturalSpeech();
    const sessionId = ++handsFreeSessionRef.current;
    handsFreeActiveRef.current = true;
    setHandsFreeActive(true);
    setError("");
    setPendingSave(null);
    const next = startConversation(conversationRef.current);
    conversationRef.current = next;
    setConversation(next);
    await startListeningTurn(sessionId);
  };

  const endHandsFreeConversation = async () => {
    handsFreeActiveRef.current = false;
    clearHandsFreeTicker();
    setHandsFreeActive(false);
    handsFreeSessionRef.current += 1;
    voiceTurnRef.current += 1;
    autoFinalizeTurnRef.current = null;
    handsFreeRecordingStartedAtRef.current = null;
    handsFreeStatusStartedAtRef.current = null;
    handsFreeWallElapsedRef.current = 0;
    speechPlaybackRef.current += 1;
    Speech.stop();
    clearNaturalSpeech();
    try {
      await recorder.stop();
    } catch {
      // The session is still ended even if iOS already interrupted capture.
    }
    activeRecordingTurnRef.current = null;
    setVoiceStatus("ready");
    setRecordingNotice("Conversation ended.");
  };

  const resumeHandsFreeConversation = async () => {
    if (!handsFreeActiveRef.current) return;
    setError("");
    await startListeningTurn(handsFreeSessionRef.current);
  };

  const toggleRecording = async () => {
    setError("");
    if (recording.isRecording || activeRecordingTurnRef.current !== null) {
      const turn = activeRecordingTurnRef.current ?? voiceTurnRef.current;
      autoFinalizeTurnRef.current = turn;
      await stopAndProcessRecording(turn);
      return;
    }
    speechPlaybackRef.current += 1;
    Speech.stop();
    clearNaturalSpeech();
    await startListeningTurn();
  };

  if (!client)
    return (
      <Centered>
        <Text style={styles.logo}>LeadLoop</Text>
        <Text style={styles.title}>Connect your cloud workspace</Text>
        <Text style={styles.copy}>
          Add EXPO_PUBLIC_SUPABASE_URL and a publishable key in mobile/.env,
          then restart Expo. Private keys never belong in this app.
        </Text>
      </Centered>
    );

  if (loading)
    return (
      <Centered>
        <ActivityIndicator color={COLORS.green} size="large" />
        <Text style={styles.copy}>Restoring your secure workspace…</Text>
      </Centered>
    );

  if (!sessionUserId)
    return (
      <Centered>
        <Text style={styles.logo}>LeadLoop</Text>
        <Text style={styles.title}>Your business, in the loop.</Text>
        <Text style={styles.copy}>
          Sign in to see your customers and reminders.
        </Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor={COLORS.muted}
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          autoComplete="password"
          placeholder="Password"
          placeholderTextColor={COLORS.muted}
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />
        <PrimaryButton
          label={busy ? "Signing in…" : "Sign in"}
          onPress={signIn}
          disabled={busy}
        />
        <Message error={error} notice={notice} />
      </Centered>
    );

  if (!data || showWorkspacePicker)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.page}>
          <Text style={styles.logo}>LeadLoop</Text>
          <Text style={styles.title}>Choose your workspace</Text>
          <Text style={styles.copy}>
            Only workspaces you are authorized to access appear here.
          </Text>
          {workspaces.map((workspace) => (
            <Pressable
              key={workspace.id}
              style={styles.workspaceRow}
              onPress={() =>
                sessionUserId && void chooseWorkspace(workspace, sessionUserId)
              }
            >
              <View>
                <Text style={styles.cardTitle}>{workspace.businessName}</Text>
                <Text style={styles.meta}>{workspace.role}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
          {!workspaces.length && (
            <Text style={styles.copy}>
              No cloud workspace is available for this account yet. Create one
              on the web app, then pull to refresh.
            </Text>
          )}
          <PrimaryButton
            label={busy ? "Loading…" : "Refresh"}
            onPress={restore}
            disabled={busy}
          />
          <Pressable onPress={signOut}>
            <Text style={styles.link}>Sign out</Text>
          </Pressable>
          <Message error={error} notice={notice} />
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>LeadLoop</Text>
            <Text style={styles.meta}>{data.workspace.businessName}</Text>
          </View>
          <Pressable onPress={() => setShowWorkspacePicker(true)}>
            <Text style={styles.link}>Switch</Text>
          </Pressable>
        </View>
        {tab === "home" && (
          <Today
            sections={taskSections}
            timezone={timezone}
            busy={busy}
            onToggle={toggleCompleted}
            onRefresh={reloadWorkspace}
          />
        )}
        {tab === "tasks" && (
          <Tasks
            tasks={data.tasks}
            timezone={timezone}
            busy={busy}
            filter={taskFilter}
            search={taskSearch}
            onFilter={setTaskFilter}
            onSearch={setTaskSearch}
            onToggle={toggleCompleted}
            onEdit={openTaskEditor}
            onRefresh={reloadWorkspace}
            onNew={() => openTaskEditor()}
          />
        )}
        {tab === "capture" && (
          <Capture
            isRecording={
              handsFreeActive
                ? handsFreeRecorderStatus.active
                : recording.isRecording
            }
            seconds={Math.round(
              (handsFreeActive
                ? handsFreeRecorderStatus.wallElapsedMs
                : recording.durationMillis) / 1000,
            )}
            notice={recordingNotice}
            status={voiceStatus}
            conversationActive={handsFreeActive}
            assistantMuted={assistantMuted}
            transcript={transcript}
            reply={assistantReply}
            awaitingConfirmation={
              conversation.stage === "awaiting_confirmation"
            }
            canRecord={
              voiceStatus === "ready" ||
              voiceStatus === "error" ||
              recording.isRecording
            }
            onRecord={toggleRecording}
            onStartConversation={() => void startHandsFreeConversation()}
            onEndConversation={() => void endHandsFreeConversation()}
            onResumeConversation={() => void resumeHandsFreeConversation()}
            onToggleMute={() =>
              updateAssistantPreferences({
                muted: !assistantPreferencesRef.current.muted,
              })
            }
            onConfirm={() => void confirmByButton()}
            onRetrySave={() => void retryPendingSave()}
            hasPendingSave={Boolean(pendingSave)}
            onRetryCloud={() => void reloadWorkspace()}
            diagnostics={cloudDiagnostics}
            microphoneDiagnostics={microphoneDiagnostics}
            handsFreeRecorderStatus={handsFreeRecorderStatus}
            handsFreeLoopDiagnostics={handsFreeLoopDiagnostics}
            voiceActivity={voiceActivityRef.current}
            vadTransitions={vadTransitions}
            workspaceLoaded={Boolean(data)}
            showDiagnostics={process.env.NODE_ENV !== "production"}
            onNewReminder={() => {
              openTaskEditor();
            }}
          />
        )}
        {tab === "people" && (
          <People
            people={data.people}
            tasks={data.tasks}
            timezone={timezone}
            onRefresh={reloadWorkspace}
          />
        )}
        {tab === "settings" && (
          <SettingsScreen
            workspace={data.workspace}
            timezone={timezone}
            buildInfo={buildInfo}
            assistantPreferences={assistantPreferences}
            naturalSpeechDiagnostic={naturalSpeechDiagnostic}
            onAssistantPreferences={updateAssistantPreferences}
            onPreviewVoice={previewNaturalVoice}
            onSwitch={() => setShowWorkspacePicker(true)}
            onSignOut={() => void signOut()}
          />
        )}
        <Message error={error} notice={notice} />
        <View style={styles.tabbar}>
          <TabButton
            label="Home"
            icon="✓"
            active={tab === "home"}
            onPress={() => setTab("home")}
          />
          <TabButton
            label="Capture"
            icon="●"
            active={tab === "capture"}
            onPress={() => setTab("capture")}
          />
          <TabButton
            label="Tasks"
            icon="☑"
            active={tab === "tasks"}
            onPress={() => setTab("tasks")}
          />
          <TabButton
            label="People"
            icon="◎"
            active={tab === "people"}
            onPress={() => setTab("people")}
          />
          <TabButton
            label="Settings"
            icon="⚙"
            active={tab === "settings"}
            onPress={() => setTab("settings")}
          />
        </View>
        <Modal
          visible={showNewReminder}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowNewReminder(false)}
        >
          <SafeAreaView style={styles.safe}>
            <ScrollView
              contentContainerStyle={styles.modal}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <Text style={styles.title}>
                  {editingTask ? "Edit reminder" : "New reminder"}
                </Text>
                <Pressable onPress={() => setShowNewReminder(false)}>
                  <Text style={styles.link}>Close</Text>
                </Pressable>
              </View>
              <Text style={styles.copy}>
                This writes directly to {data.workspace.businessName} after you
                save.
              </Text>
              <TextInput
                placeholder="What should I remind you about?"
                placeholderTextColor={COLORS.muted}
                style={[styles.input, styles.tallInput]}
                value={title}
                onChangeText={setTitle}
                multiline
              />
              <Text style={styles.fieldLabel}>Date</Text>
              <Text style={styles.datePickerValue}>
                {datePickerLabel(date)}
              </Text>
              <DateTimePicker
                value={datePickerValue(date)}
                mode="date"
                display="inline"
                locale="en-US"
                onChange={(_event, selectedDate) => {
                  if (selectedDate) setDate(dateInputFromPicker(selectedDate));
                }}
                style={styles.datePicker}
              />
              <Text style={styles.fieldLabel}>Time</Text>
              <Text style={styles.timePickerValue}>
                {timePickerLabel(time)}
              </Text>
              <DateTimePicker
                value={timePickerValue(time)}
                mode="time"
                display="spinner"
                locale="en-US"
                is24Hour={false}
                onChange={(_event, selectedTime) => {
                  if (selectedTime) setTime(timeInputFromPicker(selectedTime));
                }}
                style={styles.timePicker}
              />
              <Text style={styles.fieldLabel}>Customer (optional)</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chips}
              >
                <Pressable
                  style={[styles.chip, !selectedPerson && styles.chipActive]}
                  onPress={() => setSelectedPerson(null)}
                >
                  <Text style={styles.chipText}>No customer</Text>
                </Pressable>
                {data.people.map((person) => (
                  <Pressable
                    key={person.id}
                    style={[
                      styles.chip,
                      selectedPerson?.id === person.id && styles.chipActive,
                    ]}
                    onPress={() => setSelectedPerson(person)}
                  >
                    <Text style={styles.chipText}>{person.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <PrimaryButton
                label={busy ? "Saving…" : "Save reminder"}
                onPress={saveReminder}
                disabled={busy}
              />
              {editingTask ? (
                <Pressable onPress={() => void deleteTask()} disabled={busy}>
                  <Text style={styles.deleteLink}>Delete reminder</Text>
                </Pressable>
              ) : null}
              <Message error={error} notice="" />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Today({
  sections,
  timezone,
  busy,
  onToggle,
  onRefresh,
}: {
  sections: ReturnType<typeof mobileTaskSections>;
  timezone: string;
  busy: boolean;
  onToggle(task: Task): void;
  onRefresh(): void;
}) {
  return (
    <SectionList
      sections={sections}
      keyExtractor={(task) => task.id}
      refreshControl={
        <RefreshControl
          refreshing={busy}
          onRefresh={onRefresh}
          tintColor={COLORS.green}
        />
      }
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          <Text style={styles.eyebrow}>YOUR DAY</Text>
          <Text style={styles.title}>
            {sections.length ? "Here’s what’s next." : "Your day is clear."}
          </Text>
          <Text style={styles.copy}>
            Cloud-synced reminders, in your selected workspace.
          </Text>
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.cardTitle}>No open reminders</Text>
          <Text style={styles.meta}>Capture one when something comes up.</Text>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionHeading}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <View style={styles.taskCard}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.completed }}
            style={styles.check}
            onPress={() => void onToggle(item)}
          >
            <Text>{item.completed ? "✓" : ""}</Text>
          </Pressable>
          <View style={styles.taskBody}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.meta}>
              {taskDateTimeLabel(item.due, timezone)}
              {item.person ? ` · ${item.person}` : ""}
            </Text>
          </View>
        </View>
      )}
    />
  );
}

function Tasks({
  tasks,
  timezone,
  busy,
  filter,
  search,
  onFilter,
  onSearch,
  onToggle,
  onEdit,
  onRefresh,
  onNew,
}: {
  tasks: Task[];
  timezone: string;
  busy: boolean;
  filter: MobileTaskFilter;
  search: string;
  onFilter(value: MobileTaskFilter): void;
  onSearch(value: string): void;
  onToggle(task: Task): void;
  onEdit(task: Task): void;
  onRefresh(): void;
  onNew(): void;
}) {
  const shown = filterMobileTasks(tasks, timezone, filter, search);
  return (
    <FlatList
      data={shown}
      keyExtractor={(task) => task.id}
      refreshControl={
        <RefreshControl
          refreshing={busy}
          onRefresh={onRefresh}
          tintColor={COLORS.green}
        />
      }
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          <Text style={styles.eyebrow}>A LITTLE MORE ORGANIZED</Text>
          <Text style={styles.title}>Your tasks.</Text>
          <TextInput
            value={search}
            onChangeText={onSearch}
            placeholder="Search tasks"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chips}
          >
            {(["Upcoming", "Overdue", "Completed", "All"] as const).map(
              (item) => (
                <Pressable
                  key={item}
                  onPress={() => onFilter(item)}
                  style={[styles.chip, filter === item && styles.chipActive]}
                >
                  <Text style={styles.chipText}>{item}</Text>
                </Pressable>
              ),
            )}
          </ScrollView>
          <PrimaryButton label="Add reminder" onPress={onNew} />
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.cardTitle}>All clear here.</Text>
          <Text style={styles.meta}>No tasks match this view.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.taskCard} onPress={() => onEdit(item)}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.completed }}
            style={styles.check}
            onPress={() => void onToggle(item)}
          >
            <Text>{item.completed ? "✓" : ""}</Text>
          </Pressable>
          <View style={styles.taskBody}>
            <Text
              style={[
                styles.cardTitle,
                item.completed && styles.completedTitle,
              ]}
            >
              {item.title}
            </Text>
            <Text style={styles.meta}>
              {taskDateTimeLabel(item.due, timezone)}
              {item.person ? ` · ${item.person}` : ""}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

function SettingsScreen({
  workspace,
  timezone,
  buildInfo,
  assistantPreferences,
  naturalSpeechDiagnostic,
  onAssistantPreferences,
  onPreviewVoice,
  onSwitch,
  onSignOut,
}: {
  workspace: MobileWorkspace;
  timezone: string;
  buildInfo: ReturnType<typeof readBuildInfo>;
  assistantPreferences: AssistantPreferences;
  naturalSpeechDiagnostic: NaturalSpeechDiagnostic | null;
  onAssistantPreferences(change: Partial<AssistantPreferences>): void;
  onPreviewVoice(voice: AssistantVoiceId): void;
  onSwitch(): void;
  onSignOut(): void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.eyebrow}>YOUR WORKSPACE</Text>
      <Text style={styles.title}>Settings.</Text>
      <View style={styles.personCard}>
        <Text style={styles.cardTitle}>{workspace.businessName}</Text>
        <Text style={styles.meta}>Time zone · {timezone}</Text>
        <Text style={styles.meta}>Cloud-synced workspace</Text>
      </View>
      <PrimaryButton label="Switch workspace" onPress={onSwitch} />
      <View style={styles.personCard}>
        <Text style={styles.eyebrow}>ASSISTANT VOICE</Text>
        <Text style={styles.cardTitle}>Natural conversation, your choice.</Text>
        <Text style={styles.meta}>
          Device voice is included. Natural AI voice uses the secure LeadLoop
          service and may incur OpenAI usage charges.
        </Text>
        <View style={styles.choiceRow}>
          <Pressable
            accessibilityRole="button"
            style={[
              styles.choice,
              assistantPreferences.mode === "device" && styles.choiceSelected,
            ]}
            onPress={() => onAssistantPreferences({ mode: "device" })}
          >
            <Text style={styles.choiceTitle}>Device voice</Text>
            <Text style={styles.choiceMeta}>Included fallback</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[
              styles.choice,
              assistantPreferences.mode === "natural" && styles.choiceSelected,
            ]}
            onPress={() => {
              if (assistantPreferences.mode === "natural") return;
              Alert.alert(
                "Enable Natural AI Voice?",
                "LeadLoop will send each assistant reply to the secure server for OpenAI speech generation. This can create usage charges. You can switch back to device voice anytime.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Enable",
                    onPress: () => onAssistantPreferences({ mode: "natural" }),
                  },
                ],
              );
            }}
          >
            <Text style={styles.choiceTitle}>Natural AI voice</Text>
            <Text style={styles.choiceMeta}>Opt in before use</Text>
          </Pressable>
        </View>
        <Text style={styles.fieldLabel}>Voice style</Text>
        {NATURAL_VOICE_OPTIONS.map((voice) => (
          <View key={voice.id} style={styles.voiceRow}>
            <Pressable
              accessibilityRole="button"
              style={[
                styles.voiceChoice,
                assistantPreferences.voice === voice.id &&
                  styles.choiceSelected,
              ]}
              onPress={() => onAssistantPreferences({ voice: voice.id })}
            >
              <Text style={styles.choiceTitle}>{voice.label}</Text>
              <Text style={styles.choiceMeta}>{voice.description}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onPreviewVoice(voice.id)}
            >
              <Text style={styles.link}>Preview</Text>
            </Pressable>
          </View>
        ))}
        <Text style={styles.fieldLabel}>Speaking pace</Text>
        <View style={styles.choiceRow}>
          {ASSISTANT_SPEEDS.map((speed) => (
            <Pressable
              key={speed}
              accessibilityRole="button"
              style={[
                styles.choice,
                assistantPreferences.speed === speed && styles.choiceSelected,
              ]}
              onPress={() => onAssistantPreferences({ speed })}
            >
              <Text style={styles.choiceTitle}>
                {speed.charAt(0).toUpperCase() + speed.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onAssistantPreferences({ muted: !assistantPreferences.muted })
          }
        >
          <Text style={styles.link}>
            {assistantPreferences.muted ? "Unmute assistant" : "Mute assistant"}
          </Text>
        </Pressable>
        <Text style={styles.meta}>
          Voice preferences are stored on this device. The current cloud
          workspace schema has no voice-preference field, so LeadLoop does not
          silently sync them across devices yet.
        </Text>
        {naturalSpeechDiagnostic ? (
          <Text selectable style={styles.meta}>
            Last voice playback ·{" "}
            {naturalSpeechDiagnostic.source === "natural"
              ? "Natural AI"
              : "Device fallback"}{" "}
            · {naturalSpeechDiagnostic.voice} · {naturalSpeechDiagnostic.speed}{" "}
            · {naturalSpeechDiagnostic.stage}
            {naturalSpeechDiagnostic.code
              ? ` · ${naturalSpeechDiagnostic.code}`
              : ""}
          </Text>
        ) : null}
      </View>
      <View style={styles.personCard}>
        <Text style={styles.eyebrow}>BUILD INFORMATION</Text>
        <Text selectable style={styles.meta}>
          JavaScript commit · {buildInfo.commit}
        </Text>
        <Text selectable style={styles.meta}>
          JavaScript build · {buildInfo.identifier}
        </Text>
        <Text selectable style={styles.meta}>
          JavaScript bundle date · {buildInfo.builtAt}
        </Text>
        <Text selectable style={styles.meta}>
          Native runtime · {buildInfo.nativeRuntime}
        </Text>
        <Pressable
          onPress={() => {
            void Share.share({ message: shareableBuildInfo(buildInfo) });
          }}
        >
          <Text style={styles.link}>Share build information</Text>
        </Pressable>
      </View>
      <Pressable onPress={onSignOut}>
        <Text style={styles.deleteLink}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
function Capture({
  isRecording,
  seconds,
  notice,
  status,
  conversationActive,
  assistantMuted,
  transcript,
  reply,
  awaitingConfirmation,
  canRecord,
  onRecord,
  onStartConversation,
  onEndConversation,
  onResumeConversation,
  onToggleMute,
  onConfirm,
  onRetrySave,
  hasPendingSave,
  onRetryCloud,
  diagnostics,
  microphoneDiagnostics,
  handsFreeRecorderStatus,
  handsFreeLoopDiagnostics,
  voiceActivity,
  vadTransitions,
  workspaceLoaded,
  showDiagnostics,
  onNewReminder,
}: {
  isRecording: boolean;
  seconds: number;
  notice: string;
  status: VoiceStatus;
  conversationActive: boolean;
  assistantMuted: boolean;
  transcript: string;
  reply: string;
  awaitingConfirmation: boolean;
  canRecord: boolean;
  onRecord(): void;
  onStartConversation(): void;
  onEndConversation(): void;
  onResumeConversation(): void;
  onToggleMute(): void;
  onConfirm(): void;
  onRetrySave(): void;
  hasPendingSave: boolean;
  onRetryCloud(): void;
  diagnostics: CloudDiagnostic[];
  microphoneDiagnostics: MicrophoneDiagnostic[];
  handsFreeRecorderStatus: HandsFreeRecorderStatus;
  handsFreeLoopDiagnostics: HandsFreeLoopDiagnostics;
  voiceActivity: VoiceActivityState;
  vadTransitions: VadTransition[];
  workspaceLoaded: boolean;
  showDiagnostics: boolean;
  onNewReminder(): void;
}) {
  const [showPanel, setShowPanel] = useState(false);
  const [showManualFallback, setShowManualFallback] = useState(false);
  const primaryControl = primaryConversationControl(conversationActive, status);
  return (
    <ScrollView contentContainerStyle={styles.capture}>
      <Text style={styles.eyebrow}>VOICE CAPTURE</Text>
      <Text style={styles.title}>What’s on your mind?</Text>
      <Text style={styles.copy}>
        {status === "user_speaking"
          ? `Listening · hearing you · ${seconds}s`
          : status === "listening"
            ? `Listening · ${seconds}s`
            : status === "processing" || status === "saving"
              ? "Processing…"
              : status === "speaking"
                ? "Assistant speaking…"
                : status === "error"
                  ? "Error"
                  : conversationActive
                    ? "Waiting for the next turn…"
                    : "Tap the microphone to start a conversation."}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primaryControl.accessibilityLabel}
        disabled={!conversationActive && (!canRecord || isRecording)}
        style={[
          styles.mic,
          primaryControl.tone === "danger" && styles.micEnd,
          !conversationActive && (!canRecord || isRecording) && styles.disabled,
        ]}
        onPress={conversationActive ? onEndConversation : onStartConversation}
      >
        <Text style={styles.micIcon}>{primaryControl.icon}</Text>
        <Text style={styles.micText}>{primaryControl.label}</Text>
      </Pressable>
      {conversationActive && status === "error" ? (
        <PrimaryButton
          label="Resume listening"
          onPress={onResumeConversation}
        />
      ) : null}
      <Pressable onPress={() => setShowManualFallback((visible) => !visible)}>
        <Text style={styles.link}>
          {showManualFallback
            ? "Hide manual recording fallback"
            : "Voice troubleshooting"}
        </Text>
      </Pressable>
      {showManualFallback ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isRecording
              ? "Manually submit this recording"
              : "Record one turn manually"
          }
          disabled={!canRecord}
          style={[
            styles.mic,
            isRecording && styles.micActive,
            !isRecording && !canRecord && styles.disabled,
          ]}
          onPress={() => void onRecord()}
        >
          <Text style={styles.micIcon}>{isRecording ? "■" : "●"}</Text>
          <Text style={styles.micText}>
            {isRecording ? "Submit this turn" : "Manual recording fallback"}
          </Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onToggleMute}>
        <Text style={styles.link}>
          {assistantMuted ? "Unmute assistant" : "Mute assistant"}
        </Text>
      </Pressable>
      <View style={styles.captureNote}>
        <Text style={styles.cardTitle}>Your control comes first</Text>
        <Text style={styles.meta}>
          Hands-free listening starts only after Start conversation and ends
          when you choose End conversation. It never listens in the background.
        </Text>
      </View>
      {notice ? <Text style={styles.copy}>{notice}</Text> : null}
      {transcript ? (
        <View style={styles.captureNote}>
          <Text style={styles.eyebrow}>YOU SAID</Text>
          <Text style={styles.cardTitle}>{transcript}</Text>
        </View>
      ) : null}
      {reply ? (
        <View style={styles.captureReply}>
          <Text style={styles.eyebrow}>LEADLOOP</Text>
          <Text style={styles.cardTitle}>{reply}</Text>
        </View>
      ) : null}
      {awaitingConfirmation ? (
        <PrimaryButton label="Yes, save it" onPress={onConfirm} />
      ) : null}
      {hasPendingSave ? (
        <PrimaryButton label="Retry cloud save" onPress={onRetrySave} />
      ) : null}
      <PrimaryButton label="Refresh cloud reminders" onPress={onRetryCloud} />
      <PrimaryButton label="Create a typed reminder" onPress={onNewReminder} />
      {showDiagnostics ? (
        <View style={styles.diagnostics}>
          <Pressable onPress={() => setShowPanel((visible) => !visible)}>
            <Text style={styles.link}>
              {showPanel
                ? "Hide development diagnostics"
                : "Show development diagnostics"}
            </Text>
          </Pressable>
          {showPanel ? (
            <>
              <Text style={styles.meta}>
                Workspace data: {workspaceLoaded ? "loaded" : "not loaded"}
              </Text>
              {diagnostics.length ? (
                diagnostics.map((diagnostic, index) => (
                  <Text
                    key={`${diagnostic.operation}-${index}`}
                    style={styles.diagnosticText}
                  >
                    {diagnostic.outcome} · {diagnostic.operation} ·{" "}
                    {diagnostic.kind}
                    {diagnostic.code ? ` · ${diagnostic.code}` : ""}
                  </Text>
                ))
              ) : (
                <Text style={styles.meta}>
                  No cloud operation has completed yet.
                </Text>
              )}
              <Text style={styles.diagnosticHeading}>Microphone</Text>
              <Text style={styles.diagnosticText}>
                Hands-free recorder:{" "}
                {handsFreeRecorderStatus.active ? "active" : "inactive"}
                {" · "}
                native duration{" "}
                {Math.round(handsFreeRecorderStatus.durationMillis)}ms
                {" · turn clock "}
                {Math.round(handsFreeRecorderStatus.wallElapsedMs)}ms
              </Text>
              <Text style={styles.diagnosticText}>
                VAD timer:{" "}
                {handsFreeLoopDiagnostics.timerRunning ? "running" : "stopped"}
                {" · starts: "}
                {handsFreeLoopDiagnostics.timerStarts}
                {" · ticks: "}
                {handsFreeLoopDiagnostics.timerTicks}
              </Text>
              <Text style={styles.diagnosticText}>
                Last poll: {handsFreeLoopDiagnostics.lastPollAtMs ?? "none"}
                {" · age: "}
                {handsFreeLoopDiagnostics.lastPollAgeMs === null
                  ? "unavailable"
                  : `${Math.round(handsFreeLoopDiagnostics.lastPollAgeMs)}ms`}
                {" · meter changed: "}
                {handsFreeLoopDiagnostics.latestMeterAtMs === null
                  ? "never"
                  : `${Math.max(0, Date.now() - handsFreeLoopDiagnostics.latestMeterAtMs)}ms ago`}
              </Text>
              <Text style={styles.diagnosticText}>
                Meter:{" "}
                {handsFreeRecorderStatus.meterDb === undefined
                  ? "unavailable"
                  : `${handsFreeRecorderStatus.meterDb.toFixed(1)} dB`}
                {" · floor: "}
                {voiceActivityNoiseFloor(voiceActivity).toFixed(1)} dB
              </Text>
              <Text style={styles.diagnosticText}>
                Threshold: {voiceActivityThreshold(voiceActivity).toFixed(1)} dB
                {" · speech: "}
                {voiceActivity.activity.speechStarted
                  ? "detected"
                  : "not detected"}
                {" · silence: "}
                {Math.round(voiceActivitySilenceMs(voiceActivity))}ms
                {" · action: "}
                {handsFreeRecorderStatus.action}
              </Text>
              <Text style={styles.diagnosticText}>
                Silence target: 1200ms · no-speech target: 12000ms
              </Text>
              <Text style={styles.diagnosticText}>
                Native recorder error:{" "}
                {handsFreeRecorderStatus.nativeError ||
                handsFreeRecorderStatus.action === "recorder_invalidated"
                  ? "recorder reference invalidated"
                  : "none"}
              </Text>
              <Text style={styles.diagnosticHeading}>VAD transitions</Text>
              {vadTransitions.length ? (
                vadTransitions.map((transition, index) => (
                  <Text
                    key={`${transition.turn}-${transition.event}-${index}`}
                    style={styles.diagnosticText}
                  >
                    turn {transition.turn} · {transition.event} ·{" "}
                    {Math.round(transition.elapsedMs)}ms
                  </Text>
                ))
              ) : (
                <Text style={styles.meta}>No hands-free transition yet.</Text>
              )}
              {microphoneDiagnostics.length ? (
                microphoneDiagnostics.map((diagnostic, index) => (
                  <Text
                    key={`${diagnostic.stage}-${index}`}
                    style={styles.diagnosticText}
                  >
                    {diagnostic.outcome} · {diagnostic.stage} ·{" "}
                    {diagnostic.category}
                  </Text>
                ))
              ) : (
                <Text style={styles.meta}>
                  No microphone operation has run yet.
                </Text>
              )}
            </>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
function People({
  people,
  tasks,
  timezone,
  onRefresh,
}: {
  people: Person[];
  tasks: Task[];
  timezone: string;
  onRefresh(): void;
}) {
  return (
    <FlatList
      data={people}
      keyExtractor={(person) => person.id}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={COLORS.green}
        />
      }
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          <Text style={styles.eyebrow}>CUSTOMERS</Text>
          <Text style={styles.title}>People you serve.</Text>
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.cardTitle}>No customers yet</Text>
          <Text style={styles.meta}>
            Add customers from the web app for now.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const reminders = tasks.filter(
          (task) => !task.completed && task.personId === item.id,
        );
        return (
          <View style={styles.personCard}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            {item.business ? (
              <Text style={styles.meta}>{item.business}</Text>
            ) : null}
            {item.notes ? (
              <Text style={styles.personNotes} numberOfLines={2}>
                {item.notes}
              </Text>
            ) : null}
            <Text style={styles.meta}>
              {reminders.length
                ? `${reminders.length} open reminder${reminders.length === 1 ? "" : "s"} · ${taskDateTimeLabel(reminders[0].due, timezone)}`
                : "No open reminders"}
            </Text>
          </View>
        );
      }}
    />
  );
}
function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable style={styles.tab} onPress={onPress}>
      <Text style={[styles.tabIcon, active && styles.tabActive]}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabActive]}>{label}</Text>
    </Pressable>
  );
}
function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[styles.primary, disabled && styles.disabled]}
      onPress={onPress}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}
function Message({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </>
  );
}
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centered}>{children}</View>
    </SafeAreaView>
  );
}

export default function App() {
  return <MobileApp />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.cream },
  page: { flex: 1, padding: 24, gap: 16 },
  centered: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 14,
    backgroundColor: COLORS.cream,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    color: COLORS.green,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  title: {
    color: COLORS.ink,
    fontSize: 31,
    fontWeight: "700",
    letterSpacing: -1.1,
    lineHeight: 37,
  },
  eyebrow: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  copy: { color: COLORS.muted, fontSize: 16, lineHeight: 23 },
  meta: { color: COLORS.muted, fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: COLORS.ink,
    fontSize: 16,
    width: "100%",
  },
  tallInput: { minHeight: 92, textAlignVertical: "top" },
  fieldLabel: { color: COLORS.ink, fontWeight: "700", marginTop: 4 },
  datePickerValue: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 2,
  },
  datePicker: {
    alignSelf: "stretch",
    marginBottom: 8,
  },
  timePickerValue: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 2,
  },
  timePicker: {
    alignSelf: "stretch",
    height: 154,
    marginBottom: 8,
  },
  primary: {
    minHeight: 54,
    borderRadius: 27,
    paddingHorizontal: 22,
    backgroundColor: COLORS.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  disabled: { opacity: 0.55 },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  link: { color: COLORS.green, fontSize: 16, fontWeight: "700", padding: 8 },
  choiceRow: { flexDirection: "row", gap: 8, width: "100%" },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    padding: 10,
    backgroundColor: COLORS.cream,
  },
  choiceSelected: { borderColor: COLORS.green, backgroundColor: COLORS.sage },
  choiceTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "800" },
  choiceMeta: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  voiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: "100%",
  },
  voiceChoice: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    padding: 10,
    backgroundColor: COLORS.cream,
  },
  deleteLink: {
    color: COLORS.danger,
    fontSize: 16,
    fontWeight: "700",
    padding: 12,
    textAlign: "center",
  },
  error: {
    color: COLORS.danger,
    backgroundColor: "#F8E5E2",
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 24,
    marginBottom: 8,
  },
  notice: {
    color: COLORS.green,
    backgroundColor: COLORS.sage,
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 24,
    marginBottom: 8,
  },
  workspaceRow: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  chevron: { fontSize: 30, color: COLORS.green },
  list: { padding: 24, gap: 12, paddingBottom: 100 },
  sectionHeading: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 10,
  },
  taskCard: {
    padding: 16,
    borderRadius: 17,
    backgroundColor: COLORS.card,
    flexDirection: "row",
    gap: 13,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  check: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: COLORS.sage,
    alignItems: "center",
    justifyContent: "center",
  },
  taskBody: { flex: 1, gap: 4 },
  completedTitle: { color: COLORS.muted, textDecorationLine: "line-through" },
  cardTitle: {
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  empty: {
    backgroundColor: COLORS.sage,
    padding: 20,
    borderRadius: 18,
    gap: 5,
  },
  tabbar: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    flexDirection: "row",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  tab: { flex: 1, alignItems: "center", gap: 3, padding: 4 },
  tabIcon: { color: COLORS.muted, fontSize: 20 },
  tabLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  tabActive: { color: COLORS.green },
  capture: {
    flexGrow: 1,
    padding: 28,
    alignItems: "center",
    gap: 18,
    justifyContent: "center",
  },
  mic: {
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: COLORS.green,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.green,
    shadowRadius: 14,
    shadowOpacity: 0.22,
    elevation: 6,
  },
  micEnd: { backgroundColor: COLORS.danger, shadowColor: COLORS.danger },
  micActive: { backgroundColor: COLORS.danger },
  micIcon: { color: "#FFFFFF", fontSize: 42, lineHeight: 45 },
  micText: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  captureNote: {
    backgroundColor: COLORS.sage,
    borderRadius: 16,
    padding: 16,
    gap: 4,
    width: "100%",
  },
  captureReply: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    width: "100%",
  },
  diagnostics: {
    width: "100%",
    backgroundColor: "#F2F0E7",
    borderRadius: 14,
    padding: 10,
    gap: 5,
  },
  diagnosticText: { color: COLORS.ink, fontSize: 12, lineHeight: 18 },
  diagnosticHeading: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 6,
  },
  modal: { padding: 24, gap: 13, backgroundColor: COLORS.cream, flexGrow: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chips: { flexGrow: 0 },
  chip: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginRight: 8,
  },
  chipActive: { backgroundColor: COLORS.sage, borderColor: COLORS.green },
  chipText: { color: COLORS.ink, fontWeight: "700" },
  personCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 17,
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  personNotes: { color: COLORS.ink, fontSize: 14, lineHeight: 20 },
});
