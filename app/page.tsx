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
  dateLabel,
  fromLocalInput,
  isToday,
  toLocalInput,
} from "../lib/tasks";
import {
  advanceConversation,
  conversationContext,
  emptyConversationState,
  finishSpeech,
  setConversationStage,
  spokenReminder,
  type IntentResult,
} from "../lib/conversation-machine";
import {
  selectRecorderMimeType,
  supportedAudioFormat,
} from "../lib/audio-format";
type Screen = "Home" | "Capture" | "Tasks" | "People" | "Settings";
const nav = [
  { name: "Home", icon: Home },
  { name: "Capture", icon: AudioLines },
  { name: "Tasks", icon: LayoutList },
  { name: "People", icon: Users },
  { name: "Settings", icon: Settings },
] as const;
export default function Page() {
  const [store, setStore] = useState<Store | null>(null),
    [screen, setScreen] = useState<Screen>("Home"),
    [filter, setFilter] = useState("Upcoming"),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState<Task | null>(null),
    [person, setPerson] = useState<Person | null>(null),
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
    [conversation, setConversation] = useState(emptyConversationState);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingLimitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submissionRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          !Array.isArray(saved.tasks) ||
          !Array.isArray(saved.people) ||
          typeof saved.timezone !== "string"
        )
          throw Error();
        new Intl.DateTimeFormat("en", { timeZone: saved.timezone });
        setStore(saved);
      } else setStore(sampleStore());
    } catch {
      setStorageError(true);
      setStore(sampleStore());
    }
  }, []);
  useEffect(() => {
    if (!store || storageError) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      setStorageError(true);
    }
  }, [store, storageError]);
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
        setMenu(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!draft && !person) return;
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
  }, [!!draft, !!person]);
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordingLimitRef.current) clearTimeout(recordingLimitRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);
  if (!store)
    return (
      <main className="loading">
        <AudioLines size={32} />
        <p>Getting your day ready…</p>
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
        speakReply(reply, Boolean(updatedReminder.due));
        return;
      }
      setStore({
        ...store,
        tasks: saveTask(store.tasks, { ...draft, title: draft.title.trim() }),
      });
      setDraft(null);
      setText("");
      setNotice("Task saved on this device.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const speakReply = (reply: string, readsBack: boolean) => {
    const complete = () => {
      setIsSpeaking(false);
      if (readsBack) setConversation((current) => finishSpeech(current));
    };
    if (muted || typeof window === "undefined" || !window.speechSynthesis) {
      complete();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.onend = complete;
    utterance.onerror = complete;
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };
  const handleAssistantResult = (transcript: string, result: IntentResult) => {
    try {
      const transition = advanceConversation({
        state: conversation,
        result,
        text: transcript,
        timeZone: timezone,
        createId: () => crypto.randomUUID(),
      });
      if (transition.savedTask)
        setStore({
          ...store,
          tasks: saveTask(store.tasks, transition.savedTask),
        });
      setConversation(transition.state);
      setAssistantMessage(transition.reply);
      speakReply(transition.reply, transition.state.stage === "reading_back");
      if (transition.savedTask) setNotice("Reminder saved on this device.");
    } catch (error) {
      setVoiceError((error as Error).message);
    }
  };
  const requestInterpretation = async (thought: string) => {
    if (submissionRef.current) return;
    submissionRef.current = true;
    setVoiceBusy(true);
    setVoiceError("");
    setDemoMode(false);
    try {
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: thought,
          timeZone: timezone,
          context: conversationContext(conversation),
        }),
      });
      const payload = (await response.json()) as {
        transcript?: string;
        result?: IntentResult;
        error?: string;
        demoMode?: boolean;
        retryAfterSeconds?: number;
      };
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
      setRetryAfterSeconds(0);
    } catch (error) {
      setVoiceError((error as Error).message);
      setConversation((current) =>
        setConversationStage(
          current,
          current.activeReminder ? "awaiting_details" : "idle",
        ),
      );
    } finally {
      submissionRef.current = false;
      setVoiceBusy(false);
    }
  };
  const submitAudio = async (audio: Blob) => {
    if (submissionRef.current) return;
    submissionRef.current = true;
    setVoiceBusy(true);
    setVoiceError("");
    setDemoMode(false);
    try {
      const format = supportedAudioFormat(audio.type);
      if (!format) {
        throw new Error(
          "This browser recorded an audio format LeadLoop cannot transcribe. Try a current version of Chrome or Safari, or type your thought instead.",
        );
      }
      const form = new FormData();
      form.append("audio", audio, `leadloop-${Date.now()}.${format.extension}`);
      form.append("timeZone", timezone);
      form.append("context", JSON.stringify(conversationContext(conversation)));
      const response = await fetch("/api/voice", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        transcript?: string;
        result?: IntentResult;
        error?: string;
        demoMode?: boolean;
        retryAfterSeconds?: number;
      };
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
      handleAssistantResult(payload.transcript, payload.result);
      setRetryAfterSeconds(0);
    } catch (error) {
      setVoiceError((error as Error).message);
      setConversation((current) =>
        setConversationStage(
          current,
          current.activeReminder ? "awaiting_details" : "idle",
        ),
      );
    } finally {
      submissionRef.current = false;
      setVoiceBusy(false);
    }
  };
  const clearRecordingTimers = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingLimitRef.current) clearTimeout(recordingLimitRef.current);
    recordingTimerRef.current = null;
    recordingLimitRef.current = null;
  };
  const startRecording = async () => {
    setVoiceError("");
    setDemoMode(false);
    if (isSpeaking || submissionRef.current) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceError(
        "Voice capture is not supported in this browser. Type your thought instead.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setConversation((current) => setConversationStage(current, "listening"));
      const supportedType = selectRecorderMimeType(
        MediaRecorder.isTypeSupported.bind(MediaRecorder),
      );
      if (!supportedType) {
        stream.getTracks().forEach((track) => track.stop());
        setVoiceError(
          "This browser cannot record a LeadLoop-supported audio format. Try a current version of Chrome or Safari, or type your thought instead.",
        );
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType: supportedType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        clearRecordingTimers();
        setIsRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const recordedMimeType =
          chunksRef.current.find((chunk) => chunk.type)?.type ||
          recorder.mimeType;
        const audio = new Blob(chunksRef.current, { type: recordedMimeType });
        recorderRef.current = null;
        if (!discardRecordingRef.current && audio.size) {
          if (!supportedAudioFormat(audio.type)) {
            setVoiceError(
              "This browser returned an unsupported audio format. Try a current version of Chrome or Safari, or type your thought instead.",
            );
          } else {
            setConversation((current) =>
              setConversationStage(current, "processing"),
            );
            void submitAudio(audio);
          }
        }
      };
      recorder.start(250);
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(
        () => setRecordingSeconds((seconds) => seconds + 1),
        1000,
      );
      recordingLimitRef.current = setTimeout(() => {
        setVoiceError(
          "Voice notes are limited to 90 seconds. We stopped this recording.",
        );
        recorder.stop();
      }, 90_000);
    } catch (error) {
      const denied = (error as DOMException).name === "NotAllowedError";
      setVoiceError(
        denied
          ? "Microphone access was denied. Allow access in your browser, or type your thought instead."
          : "LeadLoop couldn't start the microphone. Check your device and try again.",
      );
    }
  };
  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };
  const cancelRecording = () => {
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else setIsRecording(false);
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
              Local demo
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
                      isRecording ? "Stop recording" : "Start voice recording"
                    }
                    onClick={() => {
                      go("Capture");
                      if (isRecording) stopRecording();
                      else void startRecording();
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
                      ? "Recording… tap to stop"
                      : "Capture a thought"}
                  </strong>
                  <span>
                    {isRecording
                      ? `${recordingSeconds}s of 90s`
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
                      <h2>Your reminder conversation</h2>
                      <p>One reminder at a time, confirmed out loud.</p>
                    </div>
                  </div>
                  <div className="recording-controls">
                    <button
                      className={`record-button ${isRecording ? "recording" : ""}`}
                      type="button"
                      aria-pressed={isRecording}
                      disabled={voiceBusy || isSpeaking}
                      onClick={() =>
                        isRecording ? stopRecording() : void startRecording()
                      }
                    >
                      {isRecording ? (
                        <Square size={18} fill="currentColor" />
                      ) : (
                        <Mic size={19} />
                      )}
                      {isRecording
                        ? `Stop recording · ${recordingSeconds}s`
                        : isSpeaking
                          ? "LeadLoop is speaking"
                          : "Press to talk"}
                    </button>
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
                    Push to talk: recording stops before LeadLoop replies, so it
                    never records its own voice.
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
                    disabled={!text.trim() || voiceBusy || isRecording}
                    onClick={() => void requestInterpretation(text.trim())}
                  >
                    {voiceBusy ? "Working…" : "Send reply"}{" "}
                    <ArrowRight size={17} />
                  </button>
                </section>
                <aside className="capture-aside">
                  <span className="pill">
                    {conversation.stage.replaceAll("_", " ")}
                  </span>
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
                </aside>
              </div>
              {(assistantMessage ||
                activeReminder ||
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
                        {isSpeaking
                          ? "Speaking now — recording is paused."
                          : "Press to talk when you’re ready for the next turn."}
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
                        window.speechSynthesis?.cancel();
                        setIsSpeaking(false);
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
                          window.speechSynthesis?.cancel();
                          setIsSpeaking(false);
                          setConversation(emptyConversationState());
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
                  <button
                    className="continue-speaking"
                    onClick={() => {
                      setText("");
                      setVoiceError("");
                      void startRecording();
                    }}
                    disabled={voiceBusy || isRecording}
                  >
                    <RotateCcw size={16} /> Continue speaking
                  </button>
                  <button
                    className="review-dismiss"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Discard unfinished reminders and start a fresh capture session?",
                        )
                      ) {
                        setConversation(emptyConversationState());
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
                      notes: "",
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
                        {active.filter((t) => t.person === p.name).length} open
                        tasks
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
                  </label>
                </section>
                <div>
                  <section className="card settings-card">
                    <h2>Accounts & reminders</h2>
                    <div className="status-line">
                      <ShieldCheck size={20} />
                      <span>
                        <strong>Local demo workspace</strong>
                        <p>
                          No sign-in or cloud backup yet. Use sample information
                          on shared devices.
                        </p>
                      </span>
                    </div>
                    <div className="status-line">
                      <Bell size={20} />
                      <span>
                        <strong>Email reminders · Not connected</strong>
                        <p>
                          Tasks are saved, but notifications will not be sent.
                          Authentication and scheduled delivery are planned for
                          Phases 3–4.
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
                            name: "",
                            business: "",
                            timezone:
                              Intl.DateTimeFormat().resolvedOptions().timeZone,
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
                setStore({
                  ...store,
                  people: store.people.some((p) => p.id === person.id)
                    ? store.people.map((p) => (p.id === person.id ? person : p))
                    : [...store.people, person],
                });
                setPerson(null);
                setNotice("Contact saved.");
              }}
            >
              {(["name", "business", "email", "notes"] as const).map((k) => (
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
                      type={k === "email" ? "email" : "text"}
                      value={person[k]}
                      onChange={(e) =>
                        setPerson({ ...person, [k]: e.target.value })
                      }
                    />
                  )}
                </label>
              ))}
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
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
