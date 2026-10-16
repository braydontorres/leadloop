"use client";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import {
  Task,
  Person,
  Store,
  STORAGE_KEY,
  sampleStore,
  saveTask,
  dateLabel,
  isToday,
  toLocalInput,
} from "../lib/tasks";
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
    [menu, setMenu] = useState(false);
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
                    aria-label="Open capture; voice input coming in Phase 2"
                    onClick={() => go("Capture")}
                  >
                    <Mic size={37} strokeWidth={1.7} />
                  </button>
                  <strong>Capture a thought</strong>
                  <span>Text capture available now</span>
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
                      <Keyboard size={21} />
                    </span>
                    <div>
                      <h2>Start with a thought</h2>
                      <p>Manual capture · Phase 1</p>
                    </div>
                  </div>
                  <label className="field">
                    What do you need to remember?
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="e.g. Call Sarah about the new project"
                      rows={6}
                    />
                  </label>
                  <div className="capture-help">
                    <Mic size={18} />
                    <span>
                      Push-to-talk, transcription, and AI follow-up are coming
                      in Phase 2. For now, type your task and choose the details
                      yourself.
                    </span>
                  </div>
                  <button
                    className="button primary wide"
                    disabled={!text.trim()}
                    onClick={() =>
                      setDraft({
                        id: crypto.randomUUID(),
                        title: text.trim(),
                        person: "",
                        due: "",
                        completed: false,
                        notes: "",
                      })
                    }
                  >
                    Review task <ArrowRight size={17} />
                  </button>
                </section>
                <aside className="capture-aside">
                  <span className="pill">LESS FRICTION. MORE FOCUS.</span>
                  <h2>
                    From a thought
                    <br />
                    to a little more clarity.
                  </h2>
                  {[
                    "Capture what matters",
                    "Choose a date and time",
                    "Review and confirm",
                    "Find it in your task list",
                  ].map((s, i) => (
                    <div className="step" key={s}>
                      <span>{i + 1}</span>
                      {s}
                    </div>
                  ))}
                  <p>
                    This version saves one task at a time. Nothing is saved
                    until you confirm it.
                  </p>
                </aside>
              </div>
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
                  value={toLocalInput(draft.due)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      due: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    })
                  }
                />
              </label>
              <p className="input-note">
                Enter time in your device’s zone (
                {Intl.DateTimeFormat().resolvedOptions().timeZone}). Displayed
                below in {timezone}.
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
