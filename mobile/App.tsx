import "react-native-url-polyfill/auto";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import * as Speech from "expo-speech";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
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
  type ConversationState,
  type IntentResult,
} from "../lib/conversation-machine";
import { supabase } from "./src/supabase";
import {
  createMobileTask,
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

type Tab = "today" | "capture" | "people";
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

function isoDateToday(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function MobileApp() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder);
  const [tab, setTab] = useState<Tab>("today");
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
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [recordingNotice, setRecordingNotice] = useState("");
  const [conversation, setConversation] = useState<ConversationState>(() =>
    emptyConversationState(),
  );
  const conversationRef = useRef(conversation);
  const [voiceStatus, setVoiceStatus] = useState<
    "ready" | "recording" | "processing" | "speaking" | "saving" | "error"
  >("ready");
  const [transcript, setTranscript] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [pendingSave, setPendingSave] = useState<{
    task: Task;
    nextState: ConversationState;
    transcript: string;
  } | null>(null);
  const voiceTurnRef = useRef(0);
  const workspaceRequestRef = useRef(0);
  const restoreRequestRef = useRef(0);
  const [cloudDiagnostics, setCloudDiagnostics] = useState<CloudDiagnostic[]>(
    [],
  );
  const [microphoneDiagnostics, setMicrophoneDiagnostics] = useState<
    MicrophoneDiagnostic[]
  >([]);

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

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  const client = supabase;
  const timezone = data?.timezone ?? "America/Chicago";
  const openTasks = useMemo(
    () => (data?.tasks ?? []).filter((task) => !task.completed),
    [data?.tasks],
  );
  const todayTasks = useMemo(() => {
    const today = isoDateToday(timezone);
    return openTasks.filter((task) => task.due.startsWith(today));
  }, [openTasks, timezone]);

  const chooseWorkspace = useCallback(
    async (workspace: MobileWorkspace, userId: string) => {
      if (!client || !userId) return;
      const requestId = ++workspaceRequestRef.current;
      setBusy(true);
      setError("");
      try {
        const next = await loadMobileWorkspace(client, workspace);
        if (requestId !== workspaceRequestRef.current) return;
        await saveMobileWorkspace(userId, workspace.id);
        if (requestId !== workspaceRequestRef.current) return;
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
    const due = fromLocalInput(`${date}T${time}`, data.timezone);
    if (!due || Number.isNaN(Date.parse(due))) {
      setError("Use a valid date and time, for example 2026-10-21 and 15:00.");
      return;
    }
    const task: Task = {
      id: Crypto.randomUUID(),
      title: title.trim(),
      person: selectedPerson?.name ?? "",
      ...(selectedPerson ? { personId: selectedPerson.id } : {}),
      due,
      completed: false,
      notes: "",
    };
    setBusy(true);
    setError("");
    try {
      await createMobileTask(client, {
        ...task,
        workspaceId: data.workspace.id,
      });
      setData((current) =>
        current ? { ...current, tasks: [...current.tasks, task] } : current,
      );
      setShowNewReminder(false);
      setTitle("");
      setDate("");
      setTime("");
      setSelectedPerson(null);
      setNotice("Reminder saved to your cloud workspace.");
      setTab("today");
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
      const complete = () => {
        if (nextState.stage === "reading_back") {
          setConversation((current) => finishSpeech(current));
        }
        setVoiceStatus("ready");
      };
      try {
        Speech.stop();
        Speech.speak(reply, {
          rate: 0.48,
          onDone: complete,
          onError: complete,
          onStopped: complete,
        });
      } catch {
        // Text remains visible and the conversation must not get stuck when a
        // device has speech playback disabled.
        complete();
      }
    },
    [],
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

  const toggleRecording = async () => {
    setError("");
    if (recording.isRecording || voiceStatus === "recording") {
      const turn = voiceTurnRef.current;
      const durationMs = recording.durationMillis;
      try {
        await recorder.stop();
      } catch (reason) {
        if (turn !== voiceTurnRef.current) return;
        recordMicrophoneDiagnostic(microphoneFailure("stop"));
        setVoiceStatus("error");
        setError(microphoneErrorMessage("stop"));
        return;
      }
      recordMicrophoneDiagnostic(microphoneSuccess("stop"));
      const audioUri = recorder.uri;
      const capturedDurationMs = Math.max(
        durationMs,
        recorder.getStatus().durationMillis,
      );
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
        setRecordingNotice("Thinking…");
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
        setVoiceStatus("error");
        setError(errorMessage(reason));
      }
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
      voiceTurnRef.current += 1;
      recorder.record();
      if (!recorder.getStatus().isRecording)
        throw new Error("Recorder did not enter recording state.");
      recordMicrophoneDiagnostic(microphoneSuccess("start"));
      setVoiceStatus("recording");
      setRecordingNotice("Listening. Tap Stop when you are done.");
    } catch (reason) {
      recordMicrophoneDiagnostic(microphoneFailure(stage));
      setError(microphoneErrorMessage(stage));
      setVoiceStatus("error");
    }
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

  const activeTasks = openTasks;
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
        {tab === "today" && (
          <Today
            tasks={todayTasks.length ? todayTasks : activeTasks}
            timezone={timezone}
            busy={busy}
            onToggle={toggleCompleted}
            onRefresh={reloadWorkspace}
          />
        )}
        {tab === "capture" && (
          <Capture
            isRecording={recording.isRecording || voiceStatus === "recording"}
            seconds={Math.round(recording.durationMillis / 1000)}
            notice={recordingNotice}
            status={voiceStatus}
            transcript={transcript}
            reply={assistantReply}
            awaitingConfirmation={
              conversation.stage === "awaiting_confirmation"
            }
            canRecord={voiceStatus === "ready" || voiceStatus === "error"}
            onRecord={toggleRecording}
            onConfirm={() => void confirmByButton()}
            onRetrySave={() => void retryPendingSave()}
            hasPendingSave={Boolean(pendingSave)}
            onRetryCloud={() => void reloadWorkspace()}
            diagnostics={cloudDiagnostics}
            microphoneDiagnostics={microphoneDiagnostics}
            workspaceLoaded={Boolean(data)}
            showDiagnostics={process.env.NODE_ENV !== "production"}
            onNewReminder={() => {
              setDate(isoDateToday(timezone));
              setTime("09:00");
              setShowNewReminder(true);
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
        <Message error={error} notice={notice} />
        <View style={styles.tabbar}>
          <TabButton
            label="Today"
            icon="✓"
            active={tab === "today"}
            onPress={() => setTab("today")}
          />
          <TabButton
            label="Capture"
            icon="●"
            active={tab === "capture"}
            onPress={() => setTab("capture")}
          />
          <TabButton
            label="People"
            icon="◎"
            active={tab === "people"}
            onPress={() => setTab("people")}
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
                <Text style={styles.title}>New reminder</Text>
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
              <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="2026-10-21"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={date}
                onChangeText={setDate}
                autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>Time (24-hour HH:MM)</Text>
              <TextInput
                placeholder="15:00"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={time}
                onChangeText={setTime}
                autoCapitalize="none"
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
              <Message error={error} notice="" />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Today({
  tasks,
  timezone,
  busy,
  onToggle,
  onRefresh,
}: {
  tasks: Task[];
  timezone: string;
  busy: boolean;
  onToggle(task: Task): void;
  onRefresh(): void;
}) {
  return (
    <FlatList
      data={tasks}
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
            {tasks.length ? "Here’s what’s next." : "Your day is clear."}
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
function Capture({
  isRecording,
  seconds,
  notice,
  status,
  transcript,
  reply,
  awaitingConfirmation,
  canRecord,
  onRecord,
  onConfirm,
  onRetrySave,
  hasPendingSave,
  onRetryCloud,
  diagnostics,
  microphoneDiagnostics,
  workspaceLoaded,
  showDiagnostics,
  onNewReminder,
}: {
  isRecording: boolean;
  seconds: number;
  notice: string;
  status: string;
  transcript: string;
  reply: string;
  awaitingConfirmation: boolean;
  canRecord: boolean;
  onRecord(): void;
  onConfirm(): void;
  onRetrySave(): void;
  hasPendingSave: boolean;
  onRetryCloud(): void;
  diagnostics: CloudDiagnostic[];
  microphoneDiagnostics: MicrophoneDiagnostic[];
  workspaceLoaded: boolean;
  showDiagnostics: boolean;
  onNewReminder(): void;
}) {
  const [showPanel, setShowPanel] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.capture}>
      <Text style={styles.eyebrow}>VOICE CAPTURE</Text>
      <Text style={styles.title}>What’s on your mind?</Text>
      <Text style={styles.copy}>
        {isRecording
          ? `Listening · ${seconds}s`
          : status === "processing" || status === "saving"
            ? "Thinking…"
            : status === "speaking"
              ? "LeadLoop is speaking…"
              : "Tap once to start. Tap again when you’re done."}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isRecording ? "Stop recording" : "Start recording"}
        disabled={!isRecording && !canRecord}
        style={[
          styles.mic,
          isRecording && styles.micActive,
          !isRecording && !canRecord && styles.disabled,
        ]}
        onPress={() => void onRecord()}
      >
        <Text style={styles.micIcon}>{isRecording ? "■" : "●"}</Text>
        <Text style={styles.micText}>
          {isRecording ? "Stop" : "Tap to talk"}
        </Text>
      </Pressable>
      <View style={styles.captureNote}>
        <Text style={styles.cardTitle}>Your control comes first</Text>
        <Text style={styles.meta}>
          LeadLoop records only after this tap. It never listens in the
          background.
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
      <PrimaryButton label="Retry cloud connection" onPress={onRetryCloud} />
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
