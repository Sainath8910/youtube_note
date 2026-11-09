import {
  useEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Clapperboard,
  Clock3,
  Download,
  FileText,
  FileCode2,
  Folder,
  House,
  Menu,
  Play,
  Plus,
  RefreshCw,
  Search,
  Save,
  LogOut,
  Trash2,
  UserRound,
  Video,
  X,
} from "lucide-react";
import {
  BlockEditor,
  NoteReader,
  type ThemeColors,
} from "./Sidebar";
import {
  createEmptyDocument,
  documentToPlainText,
  getChecklistItems,
  getListItems,
  hasTableHeader,
  getTableRows,
  hasMeaningfulBlockContent,
  normalizeDocument,
  type NoteBlock,
  type NoteDocument,
  type VideoNote,
} from "./noteDocument";
import {
  createVideoDashboardNote,
  createStandaloneDashboardNote,
  deleteDashboardNote,
  getDashboardVideoContext,
  loadDashboardData,
  removeDashboardNote,
  updateDashboardNoteFolder,
  updateDashboardNote,
  upsertDashboardNote,
  type DashboardData,
  type DashboardFolderPathItem,
  type DashboardNote,
  type DashboardVideoContext as DashboardVideoDetails,
  invalidateDashboardDataRequest,
  isDashboardRequestCurrent,
} from "./dashboardApi";
import type { SafeAuthUser } from "./backgroundAuth";
import { getDashboardProfile } from "./profileApi";
import {
  FolderDetailPage,
  FoldersPage,
  FolderSearchPage,
} from "./FolderPages";
import type { DashboardFolder } from "./folderApi";
import { FolderOrganizerDialog } from "./FolderOrganizerDialog";
import "./dashboard.css";
import {
  VideoDetailPage,
  VideosLibraryPage,
  type VideoTab,
} from "./VideosPage";
import { listDashboardVideos, type LibraryVideo } from "./videoApi";
import { ProfilePage } from "./ProfilePage";
import { TrashPage } from "./TrashPage";
import type { AuthActionResult } from "./authFlow";

type DashboardRoute =
  | "dashboard"
  | "notes"
  | "videos"
  | "folders"
  | "search"
  | "profile"
  | "trash";

type NoteWorkspaceLocation =
  | { mode: "new"; youtubeId?: string }
  | { mode: "existing"; noteId: number }
  | null;

interface DashboardLocation {
  route: DashboardRoute;
  noteWorkspace: NoteWorkspaceLocation;
  folderId: number | null;
  videoId: string | null;
  videoTab: VideoTab;
}

type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData };

const navigation = [
  { route: "dashboard", label: "Dashboard", icon: House },
  { route: "notes", label: "Notes", icon: FileText },
  { route: "videos", label: "Videos", icon: Clapperboard },
  { route: "folders", label: "Folders", icon: Folder },
  { route: "trash", label: "Trash", icon: Trash2 },
  { route: "search", label: "Search", icon: Search },
  { route: "profile", label: "Profile", icon: UserRound },
] as const satisfies ReadonlyArray<{
  route: DashboardRoute;
  label: string;
  icon: typeof House;
}>;

const routeContent: Record<
  Exclude<DashboardRoute, "dashboard" | "notes">,
  { title: string; description: string; message: string }
> = {
  videos: {
    title: "Videos",
    description: "Browse your saved YouTube videos and learning materials.",
    message: "",
  },
  folders: {
    title: "Folders",
    description: "Keep related learning together.",
    message: "",
  },
  trash: {
    title: "Trash",
    description: "Restore notes and folders within 30 days.",
    message: "",
  },
  search: {
    title: "Search",
    description: "Find folders and notes by folder name or note title.",
    message: "",
  },
  profile: {
    title: "Profile",
    description: "Manage your account details and password.",
    message: "",
  },
};

function locationFromHash(hash = window.location.hash): DashboardLocation {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  const searchParams = new URLSearchParams(query);
  const videoMatch = path.match(/^videos\/([A-Za-z0-9_-]{11})$/);
  if (videoMatch) {
    const requestedTab = searchParams.get("tab");
    return {
      route: "videos",
      noteWorkspace: null,
      folderId: null,
      videoId: videoMatch[1],
      videoTab:
        requestedTab === "transcript" || requestedTab === "notes"
          ? requestedTab
          : "notes",
    };
  }

  if (path === "notes/new") {
    const youtubeId = searchParams.get("videoId") ?? undefined;
    return {
      route: "notes",
      noteWorkspace: {
        mode: "new",
        ...(youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)
          ? { youtubeId }
          : {}),
      },
      folderId: null,
      videoId: null,
      videoTab: "transcript",
    };
  }

  const noteMatch = path.match(/^notes\/(\d+)$/);
  if (noteMatch) {
    const noteId = Number(noteMatch[1]);
    if (Number.isSafeInteger(noteId) && noteId > 0) {
      return {
        route: "notes",
        noteWorkspace: { mode: "existing", noteId },
        folderId: null,
        videoId: null,
        videoTab: "transcript",
      };
    }
  }

  const folderMatch = path.match(/^folders\/(\d+)$/);
  if (folderMatch) {
    const folderId = Number(folderMatch[1]);
    if (Number.isSafeInteger(folderId) && folderId > 0) {
      return {
        route: "folders",
        noteWorkspace: null,
        folderId,
        videoId: null,
        videoTab: "transcript",
      };
    }
  }

  return {
    route: navigation.some((item) => item.route === path)
      ? (path as DashboardRoute)
      : "dashboard",
    noteWorkspace: null,
    folderId: null,
    videoId: null,
    videoTab: "transcript",
  };
}

function isKnownDashboardHash(hash: string): boolean {
  const path = hash.replace(/^#\/?/, "").split("?")[0];
  return (
    navigation.some((item) => item.route === path) ||
    /^notes\/(?:new|\d+)$/.test(path) ||
    /^folders\/\d+$/.test(path) ||
    /^videos\/[A-Za-z0-9_-]{11}$/.test(path)
  );
}

function Dashboard({
  authenticatedUser,
  onSignOut,
  onChangePassword,
  onSendPasswordRecovery,
  signingOut,
  signOutError,
}: {
  authenticatedUser: SafeAuthUser;
  onSignOut: () => void;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<AuthActionResult>;
  onSendPasswordRecovery: (email: string) => Promise<AuthActionResult>;
  signingOut: boolean;
  signOutError?: string;
}) {
  const [location, setLocation] = useState<DashboardLocation>(locationFromHash);
  const route = location.route;
  const [hasVisitedVideoLibrary, setHasVisitedVideoLibrary] = useState(
    route === "videos" && location.videoId === null,
  );
  const [visitedVideoIds, setVisitedVideoIds] = useState<Set<string>>(
    () => new Set(location.videoId === null ? [] : [location.videoId]),
  );
  const [dashboardUsername, setDashboardUsername] = useState("");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [noteType, setNoteType] = useState<NoteTypeFilter>("ALL");
  const [sortOrder, setSortOrder] = useState<NoteSortOrder>("updated-desc");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const dashboardRequestVersion = useRef(0);
  const unsavedChangesRef = useRef(false);
  const savedNoteOverridesRef = useRef(new Map<number, DashboardNote>());
  const previousHashRef = useRef(window.location.hash || "#/dashboard");
  const noteWorkspaceBackHashRef = useRef<string | null>(null);
  const [dashboardState, setDashboardState] = useState<DashboardState>({
    status: "loading",
  });
  const previousRoute = useRef(route);

  useEffect(() => {
    let active = true;
    setDashboardUsername("");
    void getDashboardProfile()
      .then((profile) => {
        if (active) setDashboardUsername(profile.username);
      })
      .catch(() => {
        if (active) setDashboardUsername("");
      });

    return () => {
      active = false;
    };
  }, [authenticatedUser.id]);

  useEffect(
    () => () => {
      dashboardRequestVersion.current += 1;
      invalidateDashboardDataRequest();
    },
    [],
  );

  useEffect(() => {
    const handleRouteChange = () => {
      const nextHash = window.location.hash || "#/dashboard";
      if (
        unsavedChangesRef.current &&
        !window.confirm("You have unsaved changes. Discard them and leave?")
      ) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${previousHashRef.current}`,
        );
        return;
      }

      const nextLocation = locationFromHash(nextHash);
      const previousLocation = locationFromHash(previousHashRef.current);
      if (nextLocation.route === "videos") {
        if (nextLocation.videoId === null) {
          setHasVisitedVideoLibrary(true);
        } else {
          const youtubeId = nextLocation.videoId;
          setVisitedVideoIds((current) => {
            const next = new Set(current);
            next.add(youtubeId);
            return next;
          });
        }
      }
      if (
        nextLocation.noteWorkspace &&
        !previousLocation.noteWorkspace &&
        isKnownDashboardHash(previousHashRef.current)
      ) {
        noteWorkspaceBackHashRef.current = previousHashRef.current;
      }

      unsavedChangesRef.current = false;
      previousHashRef.current = nextHash;
      setLocation(nextLocation);
      setMobileNavigationOpen(false);
    };

    window.addEventListener("hashchange", handleRouteChange);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsavedChangesRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (previousRoute.current !== route) {
      previousRoute.current = route;
      pageHeadingRef.current?.focus();
    }
  }, [route]);

  useEffect(() => {
    let active = true;
    const requestVersion = ++dashboardRequestVersion.current;

    loadDashboardData()
      .then((data) => {
        if (
          isDashboardRequestCurrent(
            active,
            requestVersion,
            dashboardRequestVersion.current,
          )
        ) {
          const mergedData = [...savedNoteOverridesRef.current.values()].reduce(
            (currentData, savedNote) =>
              upsertDashboardNote(currentData, savedNote),
            data,
          );
          setDashboardState({ status: "ready", data: mergedData });
        }
      })
      .catch((error: unknown) => {
        if (
          !isDashboardRequestCurrent(
            active,
            requestVersion,
            dashboardRequestVersion.current,
          )
        ) {
          return;
        }
        setDashboardState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Could not load saved notes.",
        });
      });

    return () => {
      active = false;
    };
  }, [retryCount]);

  useEffect(() => {
    if (!mobileNavigationOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavigationOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavigationOpen]);

  const refreshDashboard = () => {
    setDashboardState({ status: "loading" });
    setRetryCount((count) => count + 1);
  };
  const navigateBackFromNote = () => {
    if (
      unsavedChangesRef.current &&
      !window.confirm("You have unsaved changes. Discard them and leave?")
    ) {
      return;
    }
    unsavedChangesRef.current = false;

    const previousDashboardHash = noteWorkspaceBackHashRef.current;
    if (previousDashboardHash && isKnownDashboardHash(previousDashboardHash)) {
      window.history.back();
      return;
    }
    window.location.hash = "#/notes";
  };
  const toggleMobileNavigation = () => {
    if (mobileNavigationOpen) {
      setMobileNavigationOpen(false);
      return;
    }

    setMobileNavigationOpen(true);
    window.setTimeout(() => {
      document
        .querySelector<HTMLAnchorElement>(
          "#dashboard-navigation .navigation-link",
        )
        ?.focus();
    });
  };
  const handleNavigation = () => {
    if (mobileNavigationOpen && locationFromHash().route === route) {
      pageHeadingRef.current?.focus();
    }
    setMobileNavigationOpen(false);
  };
  const closeMobileNavigation = () => {
    setMobileNavigationOpen(false);
    menuButtonRef.current?.focus();
  };
  const currentRoute = navigation.find((item) => item.route === route);
  const pageTitle = currentRoute?.label ?? "Dashboard";
  const pageDescription =
    route === "dashboard"
      ? "A clear view of the notes and ideas you collect while learning."
      : route === "notes"
        ? "Your saved notes, collected from the YouTube learning sidebar."
        : route === "folders" && location.folderId !== null
          ? "Notes saved in this folder."
          : routeContent[route].description;

  if (location.noteWorkspace) {
    const workspaceLocation = location.noteWorkspace;
    if (
      workspaceLocation.mode === "existing" &&
      dashboardState.status === "loading"
    ) {
      return <NoteWorkspaceLoading />;
    }
    const workspaceNote =
      workspaceLocation.mode === "existing" &&
      dashboardState.status === "ready"
        ? dashboardState.data.notes.find(
            (note) => note.id === workspaceLocation.noteId,
          ) ?? null
        : null;
    if (
      workspaceLocation.mode === "existing" &&
      !workspaceNote
    ) {
      return (
        <NoteWorkspaceUnavailable
          message={
            dashboardState.status === "error"
              ? dashboardState.message
              : "This note could not be found in your notes."
          }
          canRetry={dashboardState.status === "error"}
          onRetry={refreshDashboard}
          onBackToNotes={navigateBackFromNote}
        />
      );
    }
    return (
      <NoteWorkspace
        key={
          workspaceLocation.mode === "new"
            ? "new-note"
            : `note-${workspaceLocation.noteId}`
        }
        location={workspaceLocation}
        note={workspaceNote}
        onBackToNotes={navigateBackFromNote}
        onDirtyChange={(dirty) => {
          unsavedChangesRef.current = dirty;
        }}
        onSaved={(savedNote) => {
          savedNoteOverridesRef.current.set(savedNote.id, savedNote);
          setDashboardState((current) =>
            current.status === "ready"
              ? {
                  status: "ready",
                  data: upsertDashboardNote(current.data, savedNote),
                }
              : current,
          );
          if (dashboardState.status === "error") refreshDashboard();
        }}
        onFolderUpdated={(updatedNote) => {
          savedNoteOverridesRef.current.set(updatedNote.id, updatedNote);
          setDashboardState((current) =>
            current.status === "ready"
              ? {
                  status: "ready",
                  data: upsertDashboardNote(current.data, updatedNote),
                }
              : current,
          );
          if (dashboardState.status === "error") refreshDashboard();
        }}
        onDeleted={(noteId) => {
          savedNoteOverridesRef.current.delete(noteId);
          unsavedChangesRef.current = false;
          setDashboardState((current) =>
            current.status === "ready"
              ? {
                  status: "ready",
                  data: removeDashboardNote(current.data, noteId),
                }
              : current,
          );
          const returnHash = noteWorkspaceBackHashRef.current;
          window.location.hash =
            returnHash && /^#\/videos\/[A-Za-z0-9_-]{11}/.test(returnHash)
              ? returnHash
              : "#/notes";
        }}
      />
    );
  }

  return (
    <div className="dashboard-shell">
      {mobileNavigationOpen && (
        <button
          className="dashboard-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={closeMobileNavigation}
        />
        )}
      <Sidebar
        activeRoute={route}
        mobileOpen={mobileNavigationOpen}
        onNavigate={handleNavigation}
      />

      <div className="dashboard-main">
        <DashboardHeader
          title={pageTitle}
          onMenuClick={toggleMobileNavigation}
          menuExpanded={mobileNavigationOpen}
          menuButtonRef={menuButtonRef}
          authenticatedUser={authenticatedUser}
          username={dashboardUsername}
          onSignOut={onSignOut}
          signingOut={signingOut}
          signOutError={signOutError}
        />

        <main className="dashboard-content">
          <header className="page-intro">
            <div>
              <p className="eyebrow">YOUR LEARNING SPACE</p>
              <h1 ref={pageHeadingRef} tabIndex={-1}>
                {route === "dashboard" ? "Your learning space" : pageTitle}
              </h1>
              <p className="page-description">{pageDescription}</p>
            </div>
            <a
              className="primary-link"
              href="https://www.youtube.com/"
              target="_blank"
              rel="noreferrer"
            >
              <Play size={16} aria-hidden="true" />
              Open YouTube
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </header>

          <div hidden={route !== "dashboard"}>
            <DashboardHome
              dashboardState={dashboardState}
              onRetry={refreshDashboard}
              onNavigateToNotes={() => {
                window.location.hash = "#/notes";
              }}
              onOpenNote={(noteId) => {
                window.location.hash = `#/notes/${noteId}`;
              }}
            />
          </div>
          {hasVisitedVideoLibrary && (
            <div hidden={route !== "videos" || location.videoId !== null}>
              <VideosLibraryPage
                onOpenVideo={(youtubeId) => {
                  window.location.hash = `#/videos/${encodeURIComponent(youtubeId)}`;
                }}
              />
            </div>
          )}
          {[...visitedVideoIds].map((youtubeId) => (
            <div
              key={youtubeId}
              hidden={route !== "videos" || location.videoId !== youtubeId}
            >
              <VideoDetailPage
                youtubeId={youtubeId}
                activeTab={
                  location.videoId === youtubeId ? location.videoTab : "notes"
                }
                onBack={() => {
                  window.location.hash = "#/videos";
                }}
                onTabChange={(tab) => {
                  window.location.hash = `#/videos/${youtubeId}?tab=${tab}`;
                }}
                onOpenNote={(noteId) => {
                  window.location.hash = `#/notes/${noteId}`;
                }}
                onCreateNote={(videoId) => {
                  window.location.hash = `#/notes/new?videoId=${encodeURIComponent(videoId)}`;
                }}
              />
            </div>
          ))}
          {route === "notes" ? (
            <NotesPage
              dashboardState={dashboardState}
              onRetry={refreshDashboard}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              noteType={noteType}
              onNoteTypeChange={setNoteType}
              sortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
              onOpenNote={(noteId) => {
                window.location.hash = `#/notes/${noteId}`;
              }}
            />
          ) : route === "search" ? (
            <FolderSearchPage
              notesState={
                dashboardState.status === "ready"
                  ? { status: "ready", data: dashboardState.data.notes }
                  : dashboardState
              }
              onRetryNotes={refreshDashboard}
              onOpenNote={(noteId) => {
                window.location.hash = `#/notes/${noteId}`;
              }}
            />
          ) : route === "folders" && location.folderId !== null ? (
            <FolderDetailPage
              key={location.folderId}
              folderId={location.folderId}
              onOpenNote={(noteId) => {
                window.location.hash = `#/notes/${noteId}`;
              }}
            />
          ) : route === "folders" ? (
            <FoldersPage />
          ) : route === "profile" ? (
            <ProfilePage
              authenticatedUser={authenticatedUser}
              onUsernameChange={setDashboardUsername}
              onChangePassword={onChangePassword}
              onSendPasswordRecovery={onSendPasswordRecovery}
            />
          ) : route === "trash" ? (
            <TrashPage />
          ) : route === "dashboard" ||
            route === "videos" ? null : (
            <WorkspacePlaceholder route={route} />
          )}
        </main>
      </div>
    </div>
  );
}

interface SidebarProps {
  activeRoute: DashboardRoute;
  mobileOpen: boolean;
  onNavigate: () => void;
}

function Sidebar({ activeRoute, mobileOpen, onNavigate }: SidebarProps) {
  return (
    <aside
      className={`dashboard-sidebar${mobileOpen ? " is-open" : ""}`}
      id="dashboard-navigation"
    >
      <a
        className="brand"
        href="#/dashboard"
        onClick={onNavigate}
        aria-label="YouTube Notes dashboard"
      >
        <span className="brand-mark">
          <BookOpen size={21} aria-hidden="true" />
        </span>
        <span className="brand-copy">
          <strong>YouTube Notes</strong>
          <span>LEARNING WORKSPACE</span>
        </span>
      </a>

      <p className="nav-caption">WORKSPACE</p>
      <nav className="primary-navigation" aria-label="Main navigation">
        {navigation.map(({ route, label, icon: Icon }) => (
          <a
            key={route}
            className={`navigation-link${activeRoute === route ? " is-active" : ""}`}
            href={`#/${route}`}
            aria-current={activeRoute === route ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
            {activeRoute === route && (
              <span className="active-indicator" aria-hidden="true" />
            )}
          </a>
        ))}
      </nav>

      <div className="sidebar-note">
        <p>
          <strong>Learn as you watch</strong>
          <span>Capture ideas from any YouTube video.</span>
        </p>
      </div>

      <div className="sidebar-footer">
        <span className="connection-dot" aria-hidden="true" />
        <span>YouTube sidebar workspace</span>
      </div>
    </aside>
  );
}

interface DashboardHeaderProps {
  title: string;
  onMenuClick: () => void;
  menuExpanded: boolean;
  menuButtonRef: Ref<HTMLButtonElement>;
  authenticatedUser: SafeAuthUser;
  username: string;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError?: string;
}

function DashboardHeader({
  title,
  onMenuClick,
  menuExpanded,
  menuButtonRef,
  authenticatedUser,
  username,
  onSignOut,
  signingOut,
  signOutError,
}: DashboardHeaderProps) {
  return (
    <header className="dashboard-topbar">
      <button
        ref={menuButtonRef}
        className="mobile-menu-button"
        type="button"
        aria-label={menuExpanded ? "Close navigation menu" : "Open navigation menu"}
        aria-controls="dashboard-navigation"
        aria-expanded={menuExpanded}
        onClick={onMenuClick}
      >
        {menuExpanded ? (
          <X size={20} aria-hidden="true" />
        ) : (
          <Menu size={20} aria-hidden="true" />
        )}
      </button>
      <div className="topbar-title">{title}</div>
      <div className="dashboard-account">
        <div className="dashboard-account-copy">
          <span className="connection-dot" aria-hidden="true" />
          <span>
            {username.trim() || authenticatedUser.email || "Signed in"}
          </span>
        </div>
        <button
          className="dashboard-signout-button"
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
        >
          <LogOut size={15} aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {signOutError && (
          <span className="dashboard-signout-error" role="alert">
            {signOutError}
          </span>
        )}
      </div>
    </header>
  );
}

interface DashboardHomeProps {
  dashboardState: DashboardState;
  onRetry: () => void;
  onNavigateToNotes: () => void;
  onOpenNote: (noteId: number) => void;
}

function DashboardHome({
  dashboardState,
  onRetry,
  onNavigateToNotes,
  onOpenNote,
}: DashboardHomeProps) {
  const [recentVideosRefreshKey, setRecentVideosRefreshKey] = useState(0);
  const [totalVideos, setTotalVideos] = useState<number | null>(null);
  const refreshDashboardAndVideos = () => {
    onRetry();
    setRecentVideosRefreshKey((key) => key + 1);
  };

  return (
    <>
      <DashboardOverview
        dashboardState={dashboardState}
        totalVideos={totalVideos}
        onRefresh={refreshDashboardAndVideos}
      />
      <div className="dashboard-columns">
        <RecentNotes
          dashboardState={dashboardState}
          onRetry={onRetry}
          onOpenNote={onOpenNote}
        />
        <RecentVideos
          refreshKey={recentVideosRefreshKey}
          onTotalVideosChange={setTotalVideos}
        />
      </div>
      <QuickActions onViewNotes={onNavigateToNotes} />
    </>
  );
}

function DashboardOverview({
  dashboardState,
  totalVideos,
  onRefresh,
}: {
  dashboardState: DashboardState;
  totalVideos: number | null;
  onRefresh: () => void;
}) {
  const data =
    dashboardState.status === "ready" ? dashboardState.data : null;
  const metrics = [
    {
      label: "Total videos",
      value: totalVideos === null ? "—" : String(totalVideos),
      detail: "Videos in your library",
      icon: Clapperboard,
      className: "metric-cyan",
    },
    {
      label: "Created in last 7 days",
      value: data ? String(data.recentlyCreatedNotes) : "—",
      detail: "Based on note creation date",
      icon: Clock3,
      className: "metric-violet",
    },
    {
      label: "Video-associated notes",
      value: data ? String(data.videoAssociatedNotes) : "—",
      detail: "Notes with an associated video",
      icon: Clapperboard,
      className: "metric-green",
    },
    {
      label: "Standalone notes",
      value: data ? String(data.standaloneNotes) : "—",
      detail: "Notes without an associated video",
      icon: FileText,
      className: "metric-cyan",
    },
  ];

  return (
    <section
      className="overview-section"
      aria-labelledby="overview-heading"
      aria-busy={dashboardState.status === "loading"}
    >
      <div className="section-heading">
        <div>
          <h2 id="overview-heading">Overview</h2>
          <p>
            {dashboardState.status === "ready" && data?.totalNotes === 0
              ? "No notes saved yet"
              : "Calculated from your saved notes"}
          </p>
        </div>
        <div className="overview-actions">
          {dashboardState.status === "ready" && (
            <span className="data-source-label">
              <span className="connection-dot" aria-hidden="true" />
              {dashboardState.data.totalNotes} notes loaded
            </span>
          )}
          <button
            className="icon-button"
            type="button"
            aria-label={
              dashboardState.status === "loading"
                ? "Loading dashboard data"
                : "Refresh dashboard data"
            }
            title="Refresh dashboard data"
            onClick={onRefresh}
            disabled={dashboardState.status === "loading"}
          >
            <RefreshCw
              className={
                dashboardState.status === "loading" ? "is-spinning" : undefined
              }
              size={16}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      {dashboardState.status === "loading" ? (
        <div className="metrics-grid" role="status" aria-label="Loading dashboard data">
          {metrics.map(({ label, icon: Icon, className }) => (
            <article className="metric-card" key={label}>
              <div className={`metric-icon ${className}`}>
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="metric-copy">
                <p>{label}</p>
                <span className="metric-value-skeleton" aria-hidden="true" />
                <span>Loading data</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="metrics-grid">
            {metrics.map(({ label, value, detail, icon: Icon, className }) => (
              <article className="metric-card" key={label}>
                <div className={`metric-icon ${className}`}>
                  <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div className="metric-copy">
                  <p>{label}</p>
                  <strong>{value}</strong>
                  <span>
                    {dashboardState.status === "error"
                      ? "Unavailable"
                      : detail}
                  </span>
                </div>
              </article>
            ))}
          </div>
          {dashboardState.status === "error" && (
            <div className="dashboard-error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              <div>
                <strong>Dashboard data could not be loaded</strong>
                <p>{dashboardState.message}</p>
                <button
                  className="inline-action"
                  type="button"
                  onClick={onRefresh}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          {dashboardState.status === "ready" &&
            dashboardState.data.totalNotes === 0 && (
              <div className="dashboard-empty-callout">
                <span>
                  Your notes will appear here after you save one from a
                  YouTube video.
                </span>
                <a
                  className="secondary-link"
                  href="https://www.youtube.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Start a note on YouTube
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </div>
            )}
        </>
      )}
    </section>
  );
}

interface RecentNotesProps {
  dashboardState: DashboardState;
  onRetry: () => void;
  onOpenNote: (noteId: number) => void;
}

function RecentNotes({
  dashboardState,
  onRetry,
  onOpenNote,
}: RecentNotesProps) {
  return (
    <section className="content-card recent-notes" aria-labelledby="recent-notes-heading">
      <div className="card-heading">
        <div>
          <div className="card-title-row">
            <span className="section-icon">
              <Clock3 size={16} aria-hidden="true" />
            </span>
            <h2 id="recent-notes-heading">Recent notes</h2>
          </div>
          <p>Sorted by most recently updated</p>
        </div>
        <div className="recent-section-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh recent notes"
            title="Refresh recent notes"
            disabled={dashboardState.status === "loading"}
            onClick={onRetry}
          >
            <RefreshCw
              className={
                dashboardState.status === "loading" ? "is-spinning" : undefined
              }
              size={15}
              aria-hidden="true"
            />
          </button>
          <a className="text-link" href="#/notes">
            View all <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </div>
      <NotesListState
        dashboardState={dashboardState}
        notes={
          dashboardState.status === "ready"
            ? dashboardState.data.recentNotes
            : []
        }
        onRetry={onRetry}
        onSelectNote={onOpenNote}
        compact
      />
    </section>
  );
}

type RecentVideosState =
  | { status: "loading" }
  | { status: "error"; message: string; requestKey: string }
  | { status: "ready"; videos: LibraryVideo[]; requestKey: string };

function RecentVideos({
  refreshKey,
  onTotalVideosChange,
}: {
  refreshKey: number;
  onTotalVideosChange: (count: number) => void;
}) {
  const [state, setState] = useState<RecentVideosState>({
    status: "loading",
  });
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${refreshKey}:${retryCount}`;

  useEffect(() => {
    let active = true;
    listDashboardVideos({
      page: 1,
      pageSize: 5,
      sort: "updated",
    })
      .then((page) => {
        if (active) {
          setState({
            status: "ready",
            videos: page.results,
            requestKey,
          });
          onTotalVideosChange(page.count);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          requestKey,
          message:
            error instanceof Error
              ? error.message
              : "Could not load your recent videos.",
        });
      });
    return () => {
      active = false;
    };
  }, [onTotalVideosChange, requestKey]);

  const currentState =
    state.status !== "loading" && state.requestKey !== requestKey
      ? { status: "loading" as const }
      : state;

  return (
    <section className="content-card recent-videos" aria-labelledby="recent-videos-heading">
      <div className="card-heading">
        <div>
          <div className="card-title-row">
            <span className="section-icon video-section-icon">
              <Clapperboard size={16} aria-hidden="true" />
            </span>
            <h2 id="recent-videos-heading">Recent videos</h2>
          </div>
          <p>Recently updated in your library</p>
        </div>
        <div className="recent-section-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh recent videos"
            title="Refresh recent videos"
            disabled={currentState.status === "loading"}
            onClick={() => setRetryCount((count) => count + 1)}
          >
            <RefreshCw
              className={currentState.status === "loading" ? "is-spinning" : undefined}
              size={15}
              aria-hidden="true"
            />
          </button>
          <a className="text-link" href="#/videos">
            View all <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </div>
      {currentState.status === "loading" ? (
        <div
          className="recent-video-loading"
          role="status"
          aria-label="Loading recent videos"
          aria-busy="true"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      ) : currentState.status === "error" ? (
        <div className="recent-video-state is-error" role="alert">
          <strong>Recent videos could not be loaded</strong>
          <p>{currentState.message}</p>
          <button
            className="inline-action"
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Retry
          </button>
        </div>
      ) : currentState.videos.length === 0 ? (
        <div className="empty-state video-empty-state">
          <span className="empty-state-icon">
            <Clapperboard size={20} aria-hidden="true" />
          </span>
          <h3>No saved videos yet</h3>
          <p>
            Videos linked to your saved notes will appear here.
          </p>
          <a className="secondary-link" href="#/videos">
            Open Videos <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="recent-video-list">
          {currentState.videos.map((video) => (
            <RecentVideoCard key={video.youtube_id} video={video} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecentVideoCard({ video }: { video: LibraryVideo }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  let thumbnailUrl: string | null = null;
  try {
    const candidate = new URL(video.thumbnail_url);
    if (candidate.protocol === "https:" || candidate.protocol === "http:") {
      thumbnailUrl = candidate.toString();
    }
  } catch {
    thumbnailUrl = null;
  }

  return (
    <button
      className="recent-video-card"
      type="button"
      onClick={() => {
        window.location.hash = `#/videos/${encodeURIComponent(video.youtube_id)}`;
      }}
      aria-label={`Open ${video.title || "Untitled video"}`}
    >
      <span className="recent-video-thumbnail">
        {thumbnailUrl && !thumbnailFailed ? (
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbnailFailed(true)}
          />
        ) : (
          <Clapperboard size={18} aria-hidden="true" />
        )}
      </span>
      <span className="recent-video-copy">
        <strong>{video.title.trim() || "Untitled video"}</strong>
        <span>
          {video.notes_count} {video.notes_count === 1 ? "note" : "notes"}
          {" · "}
          Transcript {video.transcript_availability}
        </span>
      </span>
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}

function QuickActions({ onViewNotes }: { onViewNotes: () => void }) {
  return (
    <section className="quick-actions-section" aria-labelledby="quick-actions-heading">
      <div className="section-heading">
        <div>
          <h2 id="quick-actions-heading">Quick actions</h2>
          <p>Pick up where your learning happens</p>
        </div>
      </div>
      <div className="quick-actions-grid">
        <a
          className="quick-action-card"
          href="https://www.youtube.com/"
          target="_blank"
          rel="noreferrer"
        >
          <span className="quick-action-icon youtube-action-icon">
            <Play size={18} aria-hidden="true" />
          </span>
          <span className="quick-action-copy">
            <strong>Open YouTube</strong>
            <span>Watch and capture notes with the sidebar</span>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
        <a className="quick-action-card" href="#/notes" onClick={onViewNotes}>
          <span className="quick-action-icon notes-action-icon">
            <FileText size={18} aria-hidden="true" />
          </span>
          <span className="quick-action-copy">
            <strong>Browse your notes</strong>
            <span>Review the ideas you have saved</span>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function NotesPage({
  dashboardState,
  onRetry,
  searchQuery,
  onSearchQueryChange,
  noteType,
  onNoteTypeChange,
  sortOrder,
  onSortOrderChange,
  onOpenNote,
}: {
  dashboardState: DashboardState;
  onRetry: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  noteType: NoteTypeFilter;
  onNoteTypeChange: (value: NoteTypeFilter) => void;
  sortOrder: NoteSortOrder;
  onSortOrderChange: (value: NoteSortOrder) => void;
  onOpenNote: (noteId: number) => void;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const allNotes =
    dashboardState.status === "ready" ? dashboardState.data.notes : [];
  const matchingNotes = allNotes
    .filter((note) => noteType === "ALL" || note.note_type === noteType)
    .filter((note) => matchesNoteSearch(note, searchQuery))
    .sort((left, right) => compareNotes(left, right, sortOrder));
  const totalPages = Math.max(
    1,
    Math.ceil(matchingNotes.length / NOTES_PAGE_SIZE),
  );
  const page = Math.min(currentPage, totalPages);
  const pageNotes = matchingNotes.slice(
    (page - 1) * NOTES_PAGE_SIZE,
    page * NOTES_PAGE_SIZE,
  );
  const pageNumbers = Array.from(
    { length: Math.min(3, totalPages) },
    (_, index) => {
      const firstVisiblePage = Math.max(
        1,
        Math.min(page - 1, totalPages - 2),
      );
      return firstVisiblePage + index;
    },
  );
  const hasNotes =
    dashboardState.status === "ready" &&
    dashboardState.data.totalNotes > 0;

  return (
    <section className="content-card notes-page-card" aria-labelledby="notes-list-heading">
      <div className="card-heading">
        <div>
          <div className="card-title-row">
            <span className="section-icon">
              <FileText size={16} aria-hidden="true" />
            </span>
            <h2 id="notes-list-heading">All notes</h2>
          </div>
          <p>
            {hasNotes
              ? `${dashboardState.data.totalNotes} notes`
              : "Your saved notes"}
          </p>
        </div>
        <div className="notes-heading-actions">
          <a className="new-note-button" href="#/notes/new">
            <Plus size={15} aria-hidden="true" />
            New Note
          </a>
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh notes"
            disabled={dashboardState.status === "loading"}
            onClick={onRetry}
          >
            <RefreshCw
              className={
                dashboardState.status === "loading" ? "is-spinning" : undefined
              }
              size={16}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      {hasNotes ? (
        <>
          <div className="notes-toolbar">
            <label className="notes-search">
              <span className="visually-hidden">Search notes</span>
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setCurrentPage(1);
                  onSearchQueryChange(event.target.value);
                }}
                aria-label="Search notes"
                placeholder="Search titles and note text"
              />
            </label>
            <label className="notes-control">
              <span>Type</span>
              <select
                value={noteType}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isNoteTypeFilter(value)) {
                    setCurrentPage(1);
                    onNoteTypeChange(value);
                  }
                }}
              >
                <option value="ALL">All Notes</option>
                <option value="VIDEO">Video Notes</option>
                <option value="STANDALONE">Standalone Notes</option>
              </select>
            </label>
            <label className="notes-control">
              <span>Sort</span>
              <select
                value={sortOrder}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isNoteSortOrder(value)) {
                    setCurrentPage(1);
                    onSortOrderChange(value);
                  }
                }}
              >
                <option value="updated-desc">Recently Updated</option>
                <option value="created-desc">Recently Created</option>
                <option value="updated-asc">Oldest Updated</option>
                <option value="created-asc">Oldest Created</option>
              </select>
            </label>
          </div>
          <p className="notes-result-count" aria-live="polite">
            {matchingNotes.length}{" "}
            {matchingNotes.length === 1 ? "note" : "notes"}
            {searchQuery.trim() || noteType !== "ALL"
              ? " match your search and filters"
              : ""}
          </p>
          {matchingNotes.length === 0 ? (
            <div className="notes-no-matches" role="status">
              <Search size={19} aria-hidden="true" />
              <p>No matching notes. Try changing your search or note type.</p>
            </div>
          ) : (
            <>
              <NotesListState
                dashboardState={dashboardState}
                notes={pageNotes}
                onRetry={onRetry}
                onSelectNote={onOpenNote}
              />
              {totalPages > 1 && (
                <nav
                  className="notes-pagination"
                  aria-label="Notes pages"
                >
                  <span className="notes-pagination-summary">
                    Showing {(page - 1) * NOTES_PAGE_SIZE + 1}–
                    {Math.min(page * NOTES_PAGE_SIZE, matchingNotes.length)} of{" "}
                    {matchingNotes.length}
                  </span>
                  <div className="notes-pagination-controls">
                    <button
                      type="button"
                      className="notes-page-button notes-page-step"
                      disabled={page === 1}
                      onClick={() =>
                        setCurrentPage((value) => Math.max(1, value - 1))
                      }
                    >
                      Prev
                    </button>
                    {pageNumbers.map((pageNumber) => (
                      <button
                        type="button"
                        key={pageNumber}
                        className={`notes-page-button${pageNumber === page ? " is-current" : ""}`}
                        aria-label={`Page ${pageNumber}`}
                        aria-current={pageNumber === page ? "page" : undefined}
                        onClick={() => setCurrentPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="notes-page-button notes-page-step"
                      disabled={page === totalPages}
                      onClick={() =>
                        setCurrentPage((value) =>
                          Math.min(totalPages, value + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </nav>
              )}
            </>
          )}
        </>
      ) : (
        <NotesListState
          dashboardState={dashboardState}
          notes={[]}
          onRetry={onRetry}
        />
      )}
    </section>
  );
}

type NoteSortOrder =
  | "updated-desc"
  | "created-desc"
  | "updated-asc"
  | "created-asc";
type NoteTypeFilter = "ALL" | "VIDEO" | "STANDALONE";
const NOTES_PAGE_SIZE = 10;

function isNoteSortOrder(value: string): value is NoteSortOrder {
  return (
    value === "updated-desc" ||
    value === "created-desc" ||
    value === "updated-asc" ||
    value === "created-asc"
  );
}

function isNoteTypeFilter(value: string): value is NoteTypeFilter {
  return value === "ALL" || value === "VIDEO" || value === "STANDALONE";
}

function matchesNoteSearch(note: VideoNote, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  const searchableText = [
    typeof note.title === "string" ? note.title : "",
    typeof note.content === "string" ? note.content : "",
    structuredDocumentText(note),
  ]
    .join("\n")
    .toLocaleLowerCase();

  return searchableText.includes(normalizedQuery);
}

function compareNotes(
  left: VideoNote,
  right: VideoNote,
  sortOrder: NoteSortOrder,
): number {
  const sortByCreated = sortOrder.startsWith("created");
  const ascending = sortOrder.endsWith("asc");
  const leftDate = safeDateValue(
    sortByCreated ? left.created_at : left.updated_at,
  );
  const rightDate = safeDateValue(
    sortByCreated ? right.created_at : right.updated_at,
  );

  if (leftDate === null && rightDate !== null) return 1;
  if (leftDate !== null && rightDate === null) return -1;
  if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
    return ascending ? leftDate - rightDate : rightDate - leftDate;
  }
  return left.id - right.id;
}

function safeDateValue(value?: string): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function supportedDocumentBlocks(note: VideoNote): NoteBlock[] {
  const document = note.document;
  if (!document || document.version !== 1 || !Array.isArray(document.blocks)) {
    return [];
  }

  return document.blocks.filter(
    (block): block is NoteBlock =>
      Boolean(block) &&
      typeof block.id === "string" &&
      typeof block.content === "string" &&
      (block.type === "paragraph" ||
        block.type === "heading" ||
        block.type === "equation" ||
        block.type === "timestamp" ||
        block.type === "image" ||
        block.type === "url" ||
        block.type === "code" ||
        block.type === "command" ||
        block.type === "bullet_list" ||
        block.type === "numbered_list" ||
        block.type === "table" ||
        block.type === "checklist" ||
        block.type === "screenshot"),
  );
}

function structuredDocumentText(note: VideoNote): string {
  return supportedDocumentBlocks(note)
    .map((block) => {
      if (block.type === "image") {
        return typeof block.metadata?.alt === "string"
          ? block.metadata.alt
          : "";
      }

      if (block.type === "screenshot") {
        return "[Video screenshot]";
      }

      if (block.type === "url") {
        const urlText = block.content.trim();
        const title = typeof block.metadata?.title === "string"
          ? block.metadata.title
          : "";
        return urlText || title;
      }

      if (block.type === "bullet_list" || block.type === "numbered_list") {
        return getListItems(block.content).join("\n");
      }

      if (block.type === "table") {
        const rows = getTableRows(block);
        const lines = rows.map((row) => row.join(" | "));
        if (hasTableHeader(block) && rows.length > 0) {
          lines.splice(1, 0, rows[0].map(() => "---").join(" | "));
        }
        return lines.join("\n");
      }

      if (block.type === "checklist") {
        return getChecklistItems(block)
          .map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`)
          .join("\n");
      }

      return block.content;
    })
    .filter((text) => text.trim().length > 0)
    .join("\n");
}

type NoteWorkspaceMode = "read" | "write" | "transcript";

type DashboardVideoContextState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardVideoDetails };

const dashboardNoteColors: ThemeColors = {
  panel: "#0b1220",
  header: "#0f172a",
  surface: "#101827",
  input: "#111827",
  border: "#263449",
  text: "#dbe4f0",
  primaryText: "#f8fafc",
  muted: "#94a3b8",
  accent: "#67e8f9",
  accentSoft: "#12303a",
  danger: "#f87171",
  shadow: "rgba(0, 0, 0, 0.38)",
};

interface NoteWorkspaceProps {
  location: Exclude<NoteWorkspaceLocation, null>;
  note: DashboardNote | null;
  onBackToNotes: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (note: DashboardNote) => void;
  onFolderUpdated: (note: DashboardNote) => void;
  onDeleted: (noteId: number) => void;
}

function noteExportFileName(title: string, extension: "html" | "pdf"): string {
  const safeTitle = title
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return `${safeTitle || "youtube-note"}.${extension}`;
}

function noteExportBlocks(note: DashboardNote): NoteBlock[] {
  const blocks = normalizeDocument(note).blocks.filter(
    hasMeaningfulBlockContent,
  );
  if (blocks.length > 0) return blocks;
  return note.content.trim()
    ? [{ id: "legacy-content", type: "paragraph", content: note.content }]
    : [];
}

function noteBlockUrl(block: NoteBlock): string | null {
  const value =
    block.type === "url"
      ? block.content.trim() || block.metadata?.url || ""
      : block.content.trim();
  return safeExternalHttpUrl(value);
}

function noteBlockImage(block: NoteBlock): string {
  const metadataImage =
    typeof block.metadata?.image === "string" ? block.metadata.image : "";
  return block.type === "screenshot"
    ? metadataImage || block.content
    : block.content || metadataImage;
}

function noteBlockImageLink(block: NoteBlock): string | null {
  const metadataUrl =
    typeof block.metadata?.url === "string"
      ? safeExternalHttpUrl(block.metadata.url)
      : null;
  const image = safeNoteImageUrl(noteBlockImage(block));
  return metadataUrl ?? (image && /^https?:\/\//i.test(image) ? image : null);
}

function noteBlockTimestamp(block: NoteBlock): number | null {
  const value =
    block.type === "screenshot"
      ? block.metadata?.timestamp_seconds
      : block.type === "timestamp"
        ? block.content
        : null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }
  if (typeof value !== "string") return null;

  const parts = value.split(":").map(Number);
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isFinite(part) || part < 0) ||
    parts.at(-1)! >= 60 ||
    (parts.length === 3 && parts[1] >= 60)
  ) {
    return null;
  }
  return parts.length === 3
    ? Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2])
    : Math.floor(parts[0] * 60 + parts[1]);
}

function noteBlockTimestampUrl(
  block: NoteBlock,
  youtubeId?: string,
): string | null {
  const timestamp = noteBlockTimestamp(block);
  return timestamp === null ? null : getYoutubeWatchUrl(youtubeId, timestamp);
}

function downloadNoteAsHtml(note: DashboardNote): void {
  const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character] ?? character;
    });
  const title = note.title.trim() || "Untitled note";
  const youtubeId = note.video_detail?.youtube_id;
  const blocks = noteExportBlocks(note).map((block) => {
    const timestamp = noteBlockTimestamp(block);
    const timestampUrl = noteBlockTimestampUrl(block, youtubeId);
    if (block.type === "heading") {
      const level =
        typeof block.metadata?.level === "number" &&
        block.metadata.level >= 1 &&
        block.metadata.level <= 6
          ? Math.floor(block.metadata.level)
          : 2;
      return `<h${level}>${escapeHtml(block.content)}</h${level}>`;
    }
    if (block.type === "code" || block.type === "command") {
      const language =
        block.type === "code"
          ? block.metadata?.language || "code"
          : block.metadata?.shell || "command";
      return `<figure class="code-block"><figcaption>${escapeHtml(block.type === "code" ? "Code" : "Command")} · ${escapeHtml(String(language))}</figcaption><pre><code>${escapeHtml(block.content)}</code></pre></figure>`;
    }
    if (block.type === "bullet_list" || block.type === "numbered_list") {
      const tag = block.type === "bullet_list" ? "ul" : "ol";
      const items = getListItems(block.content)
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    if (block.type === "table") {
      const tableRows = getTableRows(block);
      const hasHeader = hasTableHeader(block) && tableRows.length > 0;
      const renderRow = (row: string[], tag: "td" | "th") =>
        `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;
      const header = hasHeader
        ? `<thead>${renderRow(tableRows[0], "th")}</thead>`
        : "";
      const bodyRows = tableRows
        .slice(hasHeader ? 1 : 0)
        .map((row) => renderRow(row, "td"))
        .join("");
      return `<div class="note-table-wrap"><table class="note-table">${header}<tbody>${bodyRows}</tbody></table></div>`;
    }
    if (block.type === "checklist") {
      const items = getChecklistItems(block)
        .map(
          (item) =>
            `<li><span class="checklist-box">${item.checked ? "✓" : ""}</span><span${item.checked ? ' class="is-complete"' : ""}>${escapeHtml(item.text)}</span></li>`,
        )
        .join("");
      return `<ul class="note-checklist">${items}</ul>`;
    }
    if (block.type === "url") {
      const url = noteBlockUrl(block);
      const label =
        block.metadata?.title || block.metadata?.domain || url || "Web resource";
      const description =
        typeof block.metadata?.description === "string"
          ? `<p>${escapeHtml(block.metadata.description)}</p>`
          : "";
      return `<article class="resource-card"><strong>${escapeHtml(label)}</strong>${description}${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : ""}</article>`;
    }
    if (block.type === "image" || block.type === "screenshot") {
      const image = safeNoteImageUrl(noteBlockImage(block));
      const alt =
        block.type === "image"
          ? block.metadata?.alt || "Note image"
          : timestamp !== null
            ? `Video screenshot at ${formatTimestamp(timestamp)}`
            : "Video screenshot";
      const caption =
        block.type === "image"
          ? block.metadata?.alt || ""
          : timestamp !== null
            ? `Captured at ${formatTimestamp(timestamp)}`
            : "";
      const imageMarkup = image
        ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy">`
        : `<p class="missing-image">${escapeHtml(alt)} (image unavailable)</p>`;
      const imageLink = noteBlockImageLink(block);
      const linkedImage =
        imageLink
          ? `<a href="${escapeHtml(imageLink)}" target="_blank" rel="noopener noreferrer">${imageMarkup}</a>`
          : imageMarkup;
      const timestampLink =
        timestampUrl && timestamp !== null
          ? `<a class="timestamp-link" href="${escapeHtml(timestampUrl)}" target="_blank" rel="noopener noreferrer">Open video at ${formatTimestamp(timestamp)}</a>`
          : caption
            ? `<span>${escapeHtml(caption)}</span>`
            : "";
      return `<figure class="note-image">${linkedImage}${caption && block.type === "image" ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}${timestampLink ? `<figcaption>${timestampLink}</figcaption>` : ""}</figure>`;
    }
    if (block.type === "timestamp") {
      return timestampUrl && timestamp !== null
        ? `<p class="note-timestamp"><a href="${escapeHtml(timestampUrl)}" target="_blank" rel="noopener noreferrer">▶ ${escapeHtml(block.content)} · Open video</a></p>`
        : `<p class="note-timestamp">▶ ${escapeHtml(block.content)}</p>`;
    }
    if (block.type === "equation") {
      return `<pre class="equation">${escapeHtml(block.content)}</pre>`;
    }
    return `<p>${escapeHtml(block.content).replace(/\r?\n/g, "<br>")}</p>`;
  });
  const content =
    blocks.filter(Boolean).join("\n") ||
    `<p>${escapeHtml(note.content || "This note has no text content.")}</p>`;
  const videoUrl = getYoutubeWatchUrl(youtubeId);
  const videoLink = videoUrl
    ? `<p class="video-link"><a href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener noreferrer">Open related YouTube video</a></p>`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { max-width: 820px; margin: 42px auto; padding: 0 26px 48px; color: #17202a; background: #fff; font: 15px/1.7 system-ui, sans-serif; }
    header { margin-bottom: 30px; padding-bottom: 18px; border-bottom: 2px solid #dbe4ec; }
    h1 { margin: 0; font-size: 30px; line-height: 1.25; overflow-wrap: anywhere; }
    h2, h3, h4 { margin: 24px 0 8px; line-height: 1.35; }
    p { margin: 12px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    ul, ol { padding-left: 26px; }
    li { margin: 5px 0; }
    .note-table-wrap { overflow-x: auto; margin: 16px 0; }
    .note-table { width: 100%; border-collapse: collapse; }
    .note-table td, .note-table th { min-width: 70px; padding: 8px 10px; border: 1px solid #cbd5e1; white-space: pre-wrap; text-align: left; }
    .note-table th { background: #eaf0f6; font-weight: 700; }
    .note-checklist { padding: 0; list-style: none; }
    .note-checklist li { display: flex; align-items: flex-start; gap: 8px; }
    .checklist-box { display: inline-grid; width: 14px; height: 14px; flex: 0 0 auto; place-items: center; margin-top: 4px; border: 1px solid #64748b; border-radius: 3px; font-size: 11px; line-height: 1; }
    .is-complete { color: #64748b; text-decoration: line-through; }
    a { color: #075985; overflow-wrap: anywhere; }
    img { display: block; max-width: 100%; max-height: 680px; object-fit: contain; border-radius: 6px; }
    figure { margin: 20px 0; }
    figcaption { margin-top: 7px; color: #526273; font-size: 13px; }
    .code-block, .resource-card { padding: 14px 16px; border: 1px solid #d4dee8; border-radius: 8px; background: #f5f8fb; }
    .code-block figcaption { margin: 0 0 9px; font-weight: 650; text-transform: capitalize; }
    .code-block pre, .equation { overflow-x: auto; margin: 0; padding: 13px; border-radius: 6px; color: #e2e8f0; background: #111827; font: 13px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .resource-card strong { display: block; margin-bottom: 4px; }
    .resource-card p { margin: 4px 0; }
    .resource-card a { display: block; margin-top: 8px; }
    .note-timestamp { display: inline-block; padding: 5px 9px; border: 1px solid #b7d9e6; border-radius: 6px; background: #effaff; }
    .missing-image { padding: 14px; border: 1px dashed #9aa9b8; border-radius: 6px; }
    @media print { body { margin: 0 auto; } a { color: #075985; } figure, .code-block, .resource-card { break-inside: avoid; } }
  </style>
</head>
<body><main><header><h1>${escapeHtml(title)}</h1>${videoLink}</header><article>${content}</article></main></body>
</html>`;
  const blobUrl = URL.createObjectURL(
    new Blob([html], { type: "text/html;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = noteExportFileName(title, "html");
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function downloadNoteAsPdf(note: DashboardNote): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const bottomMargin = 52;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const maxWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const youtubeId = note.video_detail?.youtube_id;
  let y = margin;

  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - bottomMargin) {
      pdf.addPage();
      y = margin;
    }
  };
  const addText = (
    text: string,
    options: {
      size?: number;
      font?: "helvetica" | "courier" | "times";
      style?: "normal" | "bold" | "italic";
      color?: [number, number, number];
      indent?: number;
      lineHeight?: number;
    } = {},
  ) => {
    if (!text) return;
    const {
      size = 11,
      font = "helvetica",
      style = "normal",
      color = [35, 45, 58],
      indent = 0,
      lineHeight = size * 1.5,
    } = options;
    pdf.setFont(font, style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(text, maxWidth - indent);
    ensureSpace(lines.length * lineHeight + 3);
    pdf.text(lines, margin + indent, y);
    y += lines.length * lineHeight + 5;
  };
  const addLink = (label: string, url: string) => {
    if (!label || !url) return;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(8, 105, 145);
    const lines = pdf.splitTextToSize(label, maxWidth);
    ensureSpace(lines.length * 15 + 4);
    for (const line of lines) {
      pdf.textWithLink(line, margin, y, { url });
      y += 15;
    }
    y += 4;
  };
  const addSectionLabel = (label: string) => {
    y += 5;
    addText(label, { size: 9, style: "bold", color: [92, 106, 122] });
  };
  const addImage = (image: string, caption: string, linkUrl?: string | null) => {
    if (/^data:image\/(?:png|jpe?g);base64,/i.test(image)) {
      const properties = pdf.getImageProperties(image);
      const maxImageWidth = Math.min(maxWidth, 440);
      const maxImageHeight = 330;
      const scale = Math.min(
      maxImageWidth / properties.width,
      maxImageHeight / properties.height,
      1,
      );
      const width = properties.width * scale;
      const height = properties.height * scale;
      ensureSpace(height + 24);
      pdf.addImage(
        image,
        properties.fileType,
        margin,
        y,
        width,
        height,
      );
      if (linkUrl) pdf.link(margin, y, width, height, { url: linkUrl });
      y += height + 5;
      if (caption) addText(caption, { size: 9, color: [92, 106, 122] });
      return;
    }
    if (linkUrl) addLink(caption || "Open image", linkUrl);
    else addText(caption || "Image unavailable", { size: 10 });
  };
  const addTable = (sourceRows: string[][], hasHeader: boolean) => {
    const columnCount = Math.max(0, ...sourceRows.map((row) => row.length));
    if (columnCount === 0 || sourceRows.length === 0) return;

    const fontSize = columnCount <= 4 ? 9 : columnCount <= 7 ? 8 : 7;
    const lineHeight = fontSize * 1.45;
    const cellPaddingX = 5;
    const cellPaddingY = 5;
    const columnWidth = maxWidth / columnCount;
    const textWidth = Math.max(12, columnWidth - cellPaddingX * 2);
    const rows = sourceRows.map((row) =>
      Array.from({ length: columnCount }, (_, columnIndex) =>
        pdf.splitTextToSize(row[columnIndex]?.trim() || " ", textWidth),
      ),
    );
    const rowLineCounts = rows.map((row) =>
      Math.max(1, ...row.map((cellLines) => cellLines.length)),
    );

    const drawRow = (
      rowIndex: number,
      startLine: number,
      lineCount: number,
    ) => {
      const rowHeight = lineCount * lineHeight + cellPaddingY * 2;
      const isHeader = hasHeader && rowIndex === 0;
      const backgroundColor: [number, number, number] = isHeader
        ? [36, 57, 78]
        : rowIndex % 2 === 0
          ? [241, 246, 250]
          : [255, 255, 255];
      pdf.setFillColor(...backgroundColor);
      pdf.setDrawColor(198, 210, 221);
      pdf.setLineWidth(0.6);
      pdf.rect(margin, y, maxWidth, rowHeight, "FD");

      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const cellX = margin + columnIndex * columnWidth;
        if (columnIndex > 0) {
          pdf.line(cellX, y, cellX, y + rowHeight);
        }
        pdf.setFont("helvetica", isHeader ? "bold" : "normal");
        pdf.setFontSize(fontSize);
        if (isHeader) pdf.setTextColor(255, 255, 255);
        else pdf.setTextColor(39, 54, 72);
        const lines = rows[rowIndex][columnIndex].slice(
          startLine,
          startLine + lineCount,
        );
        if (lines.length > 0) {
          pdf.text(
            lines,
            cellX + cellPaddingX,
            y + cellPaddingY + fontSize,
            { lineHeightFactor: lineHeight / fontSize },
          );
        }
      }
      y += rowHeight;
    };

    y += 4;
    const maxLinesPerPage = Math.floor(
      (pageHeight - bottomMargin - margin - cellPaddingY * 2) / lineHeight,
    );
    const canRepeatHeader =
      hasHeader && rowLineCounts[0] < maxLinesPerPage;
    const repeatHeader = () => {
      const headerHeight =
        rowLineCounts[0] * lineHeight + cellPaddingY * 2;
      if (!canRepeatHeader) return;
      if (y + headerHeight > pageHeight - bottomMargin) {
        pdf.addPage();
        y = margin;
      }
      drawRow(0, 0, rowLineCounts[0]);
    };

    let firstDataRow = 0;
    if (hasHeader) {
      let headerStartLine = 0;
      while (headerStartLine < rowLineCounts[0]) {
        const availableLines = Math.floor(
          (pageHeight - bottomMargin - y - cellPaddingY * 2) / lineHeight,
        );
        if (availableLines < 1) {
          pdf.addPage();
          y = margin;
          continue;
        }
        const lineCount = Math.min(
          rowLineCounts[0] - headerStartLine,
          availableLines,
        );
        drawRow(0, headerStartLine, lineCount);
        headerStartLine += lineCount;
        if (headerStartLine < rowLineCounts[0]) {
          pdf.addPage();
          y = margin;
        }
      }
      firstDataRow = 1;
    }

    for (let rowIndex = firstDataRow; rowIndex < rows.length; rowIndex += 1) {
      let startLine = 0;
      while (startLine < rowLineCounts[rowIndex]) {
        const availableLines = Math.floor(
          (pageHeight - bottomMargin - y - cellPaddingY * 2) / lineHeight,
        );
        if (availableLines < 1) {
          pdf.addPage();
          y = margin;
          if (hasHeader) repeatHeader();
          continue;
        }

        const lineCount = Math.min(
          rowLineCounts[rowIndex] - startLine,
          availableLines,
        );
        drawRow(rowIndex, startLine, lineCount);
        startLine += lineCount;

        if (startLine < rowLineCounts[rowIndex]) {
          pdf.addPage();
          y = margin;
          if (hasHeader) repeatHeader();
        }
      }
    }
    y += 9;
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.setTextColor(24, 37, 52);
  const titleLines = pdf.splitTextToSize(
    note.title.trim() || "Untitled note",
    maxWidth,
  );
  ensureSpace(titleLines.length * 27 + 18);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 27 + 9;
  pdf.setDrawColor(211, 222, 232);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 18;

  const videoUrl = getYoutubeWatchUrl(youtubeId);
  if (videoUrl) addLink("Open related YouTube video", videoUrl);

  const exportBlocks = noteExportBlocks(note);
  if (!exportBlocks.length) addText("This note has no text content.", { color: [92, 106, 122] });
  for (const block of exportBlocks) {
    switch (block.type) {
      case "heading":
        y += 5;
        addText(block.content, { size: 15, style: "bold", color: [24, 37, 52] });
        break;
      case "code":
      case "command": {
        const label =
          block.type === "code"
            ? `CODE${block.metadata?.language ? ` · ${block.metadata.language}` : ""}`
            : `COMMAND${block.metadata?.shell ? ` · ${block.metadata.shell}` : ""}`;
        addSectionLabel(label);
        pdf.setFont("courier", "normal");
        pdf.setFontSize(9);
        const codeLines = pdf.splitTextToSize(block.content, maxWidth - 24);
        const lineHeight = 13;
        let index = 0;
        while (index < codeLines.length) {
          let linesOnPage = Math.floor(
            (pageHeight - bottomMargin - y - 2) / lineHeight,
          );
          if (linesOnPage < 1) {
            pdf.addPage();
            y = margin;
            linesOnPage = Math.floor(
              (pageHeight - bottomMargin - y - 2) / lineHeight,
            );
          }
          linesOnPage = Math.min(linesOnPage, codeLines.length - index);
          const blockHeight = linesOnPage * lineHeight + 12;
          pdf.setFillColor(244, 247, 250);
          pdf.setDrawColor(216, 225, 234);
          pdf.roundedRect(
            margin,
            y - 10,
            maxWidth,
            blockHeight,
            4,
            4,
            "FD",
          );
          pdf.setTextColor(34, 45, 58);
          for (let line = 0; line < linesOnPage; line += 1) {
            pdf.text(codeLines[index + line], margin + 12, y + line * lineHeight);
          }
          index += linesOnPage;
          y += blockHeight + 8;
        }
        break;
      }
      case "bullet_list":
      case "numbered_list": {
        const items = getListItems(block.content);
        items.forEach((item, index) => {
          const marker =
            block.type === "bullet_list" ? "- " : `${index + 1}. `;
          addText(`${marker}${item}`, { indent: 6, lineHeight: 16 });
        });
        break;
      }
      case "table":
        addTable(getTableRows(block), hasTableHeader(block));
        break;
      case "checklist":
        getChecklistItems(block).forEach((item) => {
          addText(`${item.checked ? "[x]" : "[ ]"} ${item.text}`, {
            indent: 6,
            lineHeight: 16,
          });
        });
        break;
      case "url": {
        const url = noteBlockUrl(block);
        const label =
          (typeof block.metadata?.title === "string" &&
            block.metadata.title.trim()) ||
          (typeof block.metadata?.domain === "string" &&
            block.metadata.domain.trim()) ||
          "Web resource";
        addSectionLabel(label);
        if (
          typeof block.metadata?.description === "string" &&
          block.metadata.description.trim()
        ) {
          addText(block.metadata.description);
        }
        if (url) addLink(url, url);
        else addText(block.content);
        break;
      }
      case "image":
      case "screenshot": {
        const image = safeNoteImageUrl(noteBlockImage(block));
        const timestamp = noteBlockTimestamp(block);
        const caption =
          block.type === "image"
            ? block.metadata?.alt || "Note image"
            : timestamp !== null
              ? `Video screenshot at ${formatTimestamp(timestamp)}`
              : "Video screenshot";
        const imageLink = noteBlockImageLink(block);
        addImage(image || "", caption, imageLink);
        const timestampUrl = noteBlockTimestampUrl(block, youtubeId);
        if (timestampUrl && timestamp !== null) {
          addLink(`Open video at ${formatTimestamp(timestamp)}`, timestampUrl);
        }
        break;
      }
      case "timestamp": {
        const timestamp = noteBlockTimestamp(block);
        const timestampUrl = noteBlockTimestampUrl(block, youtubeId);
        if (timestamp !== null && timestampUrl) {
          addLink(`▶ ${block.content} · Open video`, timestampUrl);
        } else {
          addText(`▶ ${block.content}`, { style: "bold", color: [8, 105, 145] });
        }
        break;
      }
      case "equation":
        addText(block.content, {
          font: "times",
          style: "italic",
          size: 13,
          color: [39, 54, 72],
        });
        break;
      default:
        addText(block.content);
    }
  }
  pdf.save(noteExportFileName(note.title, "pdf"));
}

function VideoTranscriptPanel({
  state,
}: {
  state: DashboardVideoContextState;
}) {
  if (state.status === "loading") {
    return <p className="video-context-status">Loading the saved transcript…</p>;
  }
  if (state.status === "error") {
    return <p className="video-context-status is-error">{state.message}</p>;
  }
  if (!state.data.transcript?.length) {
    return (
      <p className="video-context-status">
        {state.data.transcriptStatus === "READY"
          ? "No transcript content is available for this video."
          : `No saved transcript is available (status: ${state.data.transcriptStatus.toLowerCase()}).`}
      </p>
    );
  }

  return (
    <section className="video-transcript-panel" aria-label="Video transcript">
      <p className="video-context-meta">
        {state.data.transcriptLanguage
          ? `Language: ${state.data.transcriptLanguage}`
          : `${state.data.transcript.length} transcript segments`}
      </p>
      <ol className="video-transcript-list">
        {state.data.transcript.map((segment, index) => (
          <li key={`${segment.start}-${index}`}>
            <time>{formatTimestamp(Math.floor(segment.start))}</time>
            <p>{segment.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NoteWorkspaceLoading() {
  return (
    <main className="note-workspace-page" aria-busy="true">
      <div className="note-workspace-loading" role="status">
        <span className="metric-value-skeleton" aria-hidden="true" />
        <p>Loading note workspace…</p>
      </div>
    </main>
  );
}

function NoteWorkspaceUnavailable({
  message,
  canRetry,
  onRetry,
  onBackToNotes,
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
  onBackToNotes: () => void;
}) {
  return (
    <main className="note-workspace-page">
      <div className="note-workspace-error" role="alert">
        <AlertCircle size={20} aria-hidden="true" />
        <div>
          <h1>Note unavailable</h1>
          <p>{message}</p>
          {canRetry && (
            <button className="inline-action" type="button" onClick={onRetry}>
              Retry loading
            </button>
          )}
          <button
            className="workspace-secondary-button"
            type="button"
            onClick={onBackToNotes}
          >
            Back
          </button>
        </div>
      </div>
    </main>
  );
}

function NoteWorkspace({
  location,
  note,
  onBackToNotes,
  onDirtyChange,
  onSaved,
  onFolderUpdated,
  onDeleted,
}: NoteWorkspaceProps) {
  const isNew = location.mode === "new";
  const hasVideo =
    note?.note_type === "VIDEO" && typeof note.video === "number";
  const videoMetadata = hasVideo ? note?.video_detail : null;
  const [mode, setMode] = useState<NoteWorkspaceMode>(
    isNew ? "write" : "read",
  );
  const [title, setTitle] = useState(() => note?.title ?? "");
  const [savedDocument, setSavedDocument] = useState(() =>
    note ? normalizeDocument(note) : createEmptyDocument(),
  );
  const [noteDocument, setNoteDocument] = useState(savedDocument);
  const [isSaving, setIsSaving] = useState(false);
  const [isChecklistSaving, setIsChecklistSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [videoContextState, setVideoContextState] =
    useState<DashboardVideoContextState>(() =>
      hasVideo && videoMetadata?.youtube_id
        ? { status: "loading" }
        : {
            status: "error",
            message: "Video details are unavailable for this note.",
          },
    );
  const [isOrganizerOpen, setIsOrganizerOpen] = useState(false);
  const [newNoteFolder, setNewNoteFolder] = useState<DashboardFolder | null>(
    null,
  );
  const [thumbnailUnavailable, setThumbnailUnavailable] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const pageTitleRef = useRef<HTMLHeadingElement>(null);

  const serializedDocument = JSON.stringify(noteDocument);
  const serializedSavedDocument = JSON.stringify(savedDocument);
  const isDirty =
    (isNew
      ? title.length > 0 ||
        serializedDocument !== serializedSavedDocument ||
        newNoteFolder !== null
      : Boolean(
          note &&
            (title !== note.title ||
              serializedDocument !== serializedSavedDocument),
        ));

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (mode === "write") {
      titleInputRef.current?.focus();
    } else {
      pageTitleRef.current?.focus();
    }
  }, [mode]);

  useEffect(() => {
    const youtubeId = note?.video_detail?.youtube_id;
    if (!hasVideo || !youtubeId) return;

    let active = true;
    getDashboardVideoContext(youtubeId)
      .then((data) => {
        if (active) setVideoContextState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (active) {
          setVideoContextState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not load video details.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [hasVideo, note?.video_detail?.youtube_id]);

  const discardAndSwitchToRead = (
    targetMode: "read" | "transcript" = "read",
  ) => {
    if (
      isDirty &&
      !window.confirm(
        `Discard your unsaved changes and switch to ${targetMode} mode?`,
      )
    ) {
      return;
    }
    if (note) {
      setTitle(note.title);
      setNoteDocument(savedDocument);
    } else {
      setTitle("");
      setNoteDocument(savedDocument);
    }
    setSaveError(null);
    setIsExportMenuOpen(false);
    onDirtyChange(false);
    setMode(targetMode);
  };

  const saveNote = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setSaveError("Enter a title before saving this note.");
      titleInputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      let savedNote: DashboardNote;
      const content = documentToPlainText(noteDocument);
      if (isNew) {
        savedNote = location.youtubeId
          ? await createVideoDashboardNote({
              youtubeId: location.youtubeId,
              title: normalizedTitle,
              content,
              document: noteDocument,
              folder: newNoteFolder?.id ?? null,
            })
          : await createStandaloneDashboardNote({
              title: normalizedTitle,
              content,
              document: noteDocument,
              folder: newNoteFolder?.id ?? null,
            });
      } else {
        if (!note) return;
        savedNote = await updateDashboardNote(note.id, {
          title: normalizedTitle,
          content,
          document: noteDocument,
        });
      }

      onSaved(savedNote);
      onDirtyChange(false);
      if (isNew) {
        window.location.hash = `#/notes/${savedNote.id}`;
      } else {
        const updatedDocument = normalizeDocument(savedNote);
        setTitle(savedNote.title);
        setSavedDocument(updatedDocument);
        setNoteDocument(updatedDocument);
        setMode("read");
      }
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save this note.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleChecklistItemToggle = async (
    blockId: string,
    itemId: string,
    checked: boolean,
  ) => {
    if (!note || isChecklistSaving) return;
    const previousDocument = savedDocument;
    const updatedDocument: NoteDocument = {
      ...savedDocument,
      blocks: savedDocument.blocks.map((block) =>
        block.id === blockId && block.type === "checklist"
          ? {
              ...block,
              metadata: {
                ...block.metadata,
                checklist_items: getChecklistItems(block).map((item) =>
                  item.id === itemId ? { ...item, checked } : item,
                ),
              },
            }
          : block,
      ),
    };
    setSavedDocument(updatedDocument);
    setNoteDocument(updatedDocument);
    setSaveError(null);
    setIsChecklistSaving(true);
    try {
      const savedNote = await updateDashboardNote(note.id, {
        title: note.title,
        content: documentToPlainText(updatedDocument),
        document: updatedDocument,
      });
      const savedDocument = normalizeDocument(savedNote);
      setSavedDocument(savedDocument);
      setNoteDocument(savedDocument);
      onSaved(savedNote);
    } catch (error) {
      setSavedDocument(previousDocument);
      setNoteDocument(previousDocument);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save checklist state.",
      );
    } finally {
      setIsChecklistSaving(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!note || !window.confirm(`Move "${note.title}" to Trash? You can restore it within 30 days.`)) {
      return;
    }

    setIsDeleting(true);
    setSaveError(null);
    try {
      await deleteDashboardNote(note.id);
      onDeleted(note.id);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not delete this note.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const pageHeading =
    isNew
      ? location.youtubeId
        ? "New video note"
        : "New standalone note"
      : note?.title || "Note workspace";
  const updatedDate = note ? formatNoteDate(note.updated_at) : null;
  const createdDate = note ? formatNoteDate(note.created_at) : null;
  const videoUrl = getYoutubeWatchUrl(videoMetadata?.youtube_id);
  const thumbnailUrl = safeExternalHttpUrl(videoMetadata?.thumbnail_url);
  const noteTimestamp =
    typeof note?.timestamp_seconds === "number" &&
    Number.isInteger(note.timestamp_seconds) &&
    note.timestamp_seconds >= 0
      ? note.timestamp_seconds
      : null;
  const timestampUrl =
    noteTimestamp === null
      ? null
      : getYoutubeWatchUrl(videoMetadata?.youtube_id, noteTimestamp);

  if (!isNew && !note) {
    return (
      <main className="note-workspace-page">
        <div className="note-workspace-error" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <h1>Note unavailable</h1>
            <p>This note could not be found in your notes.</p>
            <button
              className="workspace-secondary-button"
              type="button"
              onClick={onBackToNotes}
            >
              Back to Notes
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="note-workspace-page">
      <div className="note-workspace">
        <header className="note-workspace-topbar">
          <button
            className="workspace-back-button"
            type="button"
            onClick={onBackToNotes}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span>Back</span>
          </button>
          <p className="workspace-brand">YOUTUBE KNOWLEDGE / NOTES</p>
          <div className="workspace-mode-switch" role="group" aria-label="Note mode">
            {!isNew && (
              <button
                type="button"
                aria-pressed={mode === "read"}
                className={mode === "read" ? "is-active" : ""}
                onClick={() => {
                  if (mode === "write") {
                    discardAndSwitchToRead();
                  } else {
                    setMode("read");
                  }
                }}
              >
                READ
              </button>
            )}
            <button
              type="button"
              aria-pressed={mode === "write"}
              className={mode === "write" ? "is-active" : ""}
              onClick={() => {
                setSaveError(null);
                setMode("write");
              }}
            >
              WRITE
            </button>
            {hasVideo && (
              <button
                type="button"
                aria-pressed={mode === "transcript"}
                className={mode === "transcript" ? "is-active" : ""}
                onClick={() => {
                  if (mode === "write") {
                    discardAndSwitchToRead("transcript");
                  } else {
                    setMode("transcript");
                  }
                }}
              >
                TRANSCRIPT
              </button>
            )}
          </div>
        </header>

        <section className="note-workspace-body" aria-labelledby="workspace-title">
          <div className="note-workspace-heading">
            <div>
              <p className="eyebrow">
                {mode === "read"
                  ? "READ MODE"
                  : mode === "write"
                    ? "WRITE MODE"
                    : "VIDEO TRANSCRIPT"}
              </p>
              <h1 id="workspace-title" ref={pageTitleRef} tabIndex={-1}>
                {pageHeading}
              </h1>
              {mode === "read" && note && (
                <div className="note-detail-metadata">
                  <span>
                    {note.note_type === "VIDEO" ? "Video note" : "Standalone note"}
                  </span>
                  {hasVideo && <span>Associated video</span>}
                  {hasVideo &&
                    typeof note.timestamp_seconds === "number" &&
                    note.timestamp_seconds >= 0 && (
                      <span className="note-timestamp">
                        Timestamp {formatTimestamp(note.timestamp_seconds)}
                      </span>
                    )}
                  {typeof note?.folder === "number" && <span>Folder assigned</span>}
                  <span>Created {createdDate ?? "date unavailable"}</span>
                  <span>Updated {updatedDate ?? "date unavailable"}</span>
                </div>
              )}
            </div>
            {mode === "write" && (
              <button
                className="workspace-save-button"
                type="button"
                onClick={() => void saveNote()}
                disabled={isSaving}
              >
                <Save size={16} aria-hidden="true" />
                {isSaving ? "Saving…" : "Save note"}
              </button>
            )}
            {mode === "read" && note && (
              <div className="workspace-read-actions">
                <div className="workspace-export">
                  <button
                    className="workspace-secondary-button"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={isExportMenuOpen}
                    onClick={() => setIsExportMenuOpen((open) => !open)}
                  >
                    <Download size={15} aria-hidden="true" />
                    Export
                  </button>
                  {isExportMenuOpen && (
                    <div className="workspace-export-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void downloadNoteAsPdf(note)
                            .then(() => setIsExportMenuOpen(false))
                            .catch((error: unknown) => {
                              setSaveError(
                                error instanceof Error
                                  ? error.message
                                  : "Could not export this note as a PDF.",
                              );
                            });
                        }}
                      >
                        <FileText size={15} aria-hidden="true" />
                        Download PDF
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          downloadNoteAsHtml(note);
                          setIsExportMenuOpen(false);
                        }}
                      >
                        <FileCode2 size={15} aria-hidden="true" />
                        Download HTML
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className="workspace-delete-button"
                  type="button"
                  onClick={() => void handleDeleteNote()}
                  disabled={isDeleting}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {isDeleting ? "Moving…" : "Move to Trash"}
                </button>
              </div>
            )}
          </div>

          <div className="note-folder-organize-row">
            <div>
              <span className="note-folder-organize-label">
                {isNew ? "Save to" : "Folder"}
              </span>
              <FolderPath
                path={
                  isNew
                    ? newNoteFolder?.breadcrumbs ??
                      (newNoteFolder
                        ? [{ id: newNoteFolder.id, name: newNoteFolder.name }]
                        : [])
                    : note?.folder_path ?? []
                }
                className="note-folder-organize-path"
                emptyLabel={
                  isNew || note?.folder == null
                    ? "No Folder"
                    : "Folder path unavailable"
                }
              />
            </div>
            <button
              className="workspace-secondary-button"
              type="button"
              onClick={() => setIsOrganizerOpen(true)}
              disabled={isSaving}
            >
              <Folder size={15} aria-hidden="true" />
              {isNew ? "Choose Folder" : "Organize"}
            </button>
          </div>

          {isOrganizerOpen && (
            <FolderOrganizerDialog
              initialFolderId={
                isNew ? newNoteFolder?.id ?? null : note?.folder ?? null
              }
              onCancel={() => setIsOrganizerOpen(false)}
              onSaveHere={async (folderId, folder) => {
                if (isNew) {
                  setNewNoteFolder(folder);
                  setIsOrganizerOpen(false);
                  return;
                }
                if (!note) {
                  throw new Error("This note is no longer available.");
                }
                if ((note.folder ?? null) !== folderId) {
                  const updatedNote = await updateDashboardNoteFolder(
                    note.id,
                    folderId,
                  );
                  onFolderUpdated(updatedNote);
                }
                setIsOrganizerOpen(false);
              }}
            />
          )}

          {hasVideo && (
            <section className="workspace-video-context" aria-label="Video context">
              {thumbnailUrl && !thumbnailUnavailable && (
                <img
                  className="workspace-video-thumbnail"
                  src={thumbnailUrl}
                  onError={() => setThumbnailUnavailable(true)}
                  alt={
                    videoMetadata?.title
                      ? `Thumbnail for ${videoMetadata.title}`
                      : "Video thumbnail"
                  }
                />
              )}
              <div className="workspace-video-copy">
                <p className="eyebrow">VIDEO CONTEXT</p>
                <h2>
                  {videoMetadata?.title?.trim() || "Video title unavailable"}
                </h2>
                {(videoMetadata?.channel_name?.trim() ||
                  videoMetadata?.channel_handle?.trim()) && (
                  <p className="workspace-video-channel">
                    {videoMetadata.channel_name?.trim() ||
                      videoMetadata.channel_handle?.trim()}
                  </p>
                )}
                {videoUrl ? (
                  <div className="workspace-video-actions">
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Play size={14} aria-hidden="true" />
                      Open Video
                    </a>
                    {timestampUrl && noteTimestamp !== null && (
                        <a
                          href={timestampUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Clock3 size={14} aria-hidden="true" />
                          Open at {formatTimestamp(noteTimestamp)}
                        </a>
                      )}
                  </div>
                ) : (
                  <p className="workspace-video-unavailable">
                    Video link unavailable.
                  </p>
                )}
              </div>
            </section>
          )}

          {saveError && (
            <div className="workspace-save-error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              <p>{saveError}</p>
            </div>
          )}

          {mode === "write" ? (
            <div className="note-editor">
              <label htmlFor="note-title-input">Title</label>
              <input
                ref={titleInputRef}
                id="note-title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={500}
                placeholder="Give this note a title"
              />
              <div className="note-block-editor">
                <BlockEditor
                  noteDocument={noteDocument}
                  colors={dashboardNoteColors}
                  onChange={setNoteDocument}
                  enableTimestampJump={false}
                  timestampContent={() => ""}
                />
              </div>
              <p className="note-editor-hint">
                Blocks are saved in their original structured order. Existing video, folder, timestamp, and note-type associations are preserved.
              </p>
            </div>
          ) : mode === "read" && note ? (
            <div className="note-workspace-content">
              <NoteReader
                note={{ ...note, document: savedDocument }}
                colors={dashboardNoteColors}
                showTitle={false}
                onChecklistItemToggle={handleChecklistItemToggle}
                checklistToggleDisabled={isChecklistSaving}
                enableTimestampJump={false}
                onTimestampClick={
                  hasVideo && videoUrl
                    ? (seconds) => {
                        const timestampUrl = getYoutubeWatchUrl(
                          videoMetadata?.youtube_id,
                          seconds,
                        );
                        if (timestampUrl) {
                          window.open(
                            timestampUrl,
                            "_blank",
                            "noopener,noreferrer",
                          );
                        }
                      }
                    : undefined
                }
              />
              {supportedDocumentBlocks(note).length === 0 &&
                !note.content.trim() && (
                  <p className="note-detail-empty">
                    This note has no text content.
                  </p>
                )}
            </div>
          ) : mode === "transcript" ? (
            <VideoTranscriptPanel state={videoContextState} />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function getYoutubeWatchUrl(
  youtubeId?: string,
  timestampSeconds?: number,
): string | null {
  if (!youtubeId || !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return null;
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", youtubeId);
  if (
    typeof timestampSeconds === "number" &&
    Number.isInteger(timestampSeconds) &&
    timestampSeconds >= 0
  ) {
    url.searchParams.set("t", String(timestampSeconds));
  }
  return url.toString();
}

function safeExternalHttpUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeNoteImageUrl(value: string): string | null {
  if (value.startsWith("data:image/")) return value;
  return safeExternalHttpUrl(value);
}

function formatNoteDate(value?: string): string | null {
  const timestamp = safeDateValue(value);
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function NotesListState({
  dashboardState,
  notes,
  onRetry,
  compact = false,
  onSelectNote,
}: {
  dashboardState: DashboardState;
  notes: VideoNote[];
  onRetry: () => void;
  compact?: boolean;
  onSelectNote?: (noteId: number) => void;
}) {
  if (dashboardState.status === "loading") {
    return (
      <div
        className="notes-loading"
        role="status"
        aria-label="Loading saved notes"
      >
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (dashboardState.status === "error") {
    return (
      <div className="inline-state error-state" role="alert">
        <AlertCircle size={19} aria-hidden="true" />
        <div>
          <strong>Notes could not be loaded</strong>
          <p>{dashboardState.message}</p>
          <button className="inline-action" type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (dashboardState.data.totalNotes === 0) {
    return (
      <div className="empty-state notes-empty-state">
        <span className="empty-state-icon">
          <FileText size={20} aria-hidden="true" />
        </span>
        <h3>No notes saved yet</h3>
        <p>
          Open a YouTube video and use the YouTube Notes sidebar to capture
          your first note.
        </p>
        <a
          className="secondary-link"
          href="https://www.youtube.com/"
          target="_blank"
          rel="noreferrer"
        >
          Go to YouTube <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    );
  }

  return (
    <NoteRows
      notes={notes}
      onSelectNote={onSelectNote}
      compact={compact}
    />
  );
}

function NoteRows({
  notes,
  onSelectNote,
  compact = false,
}: {
  notes: Array<VideoNote & { folder_path?: DashboardFolderPathItem[] }>;
  onSelectNote?: (noteId: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`notes-list${compact ? " is-compact" : ""}`}>
      {notes.map((note) => {
        const rowContent = (
          <>
            <span
              className={`note-type-icon${note.note_type === "VIDEO" ? " is-video" : ""}`}
              aria-hidden="true"
            >
              {note.note_type === "VIDEO" ? (
                <Video size={16} />
              ) : (
                <FileText size={16} />
              )}
            </span>
            <span className="note-row-copy">
              <span className="note-row-title">
                {note.title || "Untitled note"}
              </span>
              <span className="note-metadata">
                {typeof note.video === "number" && (
                  <span className="note-video-label">Video note</span>
                )}
                {typeof note.video === "number" &&
                  typeof note.timestamp_seconds === "number" &&
                  note.timestamp_seconds >= 0 && (
                    <span className="note-timestamp">
                      at {formatTimestamp(note.timestamp_seconds)}
                    </span>
                  )}
              </span>
            </span>
            <span className="note-date">{noteDate(note)}</span>
          </>
        );

        return (
          <article className="note-row" key={note.id}>
            {onSelectNote ? (
              <button
                className="note-row-select-button"
                type="button"
                aria-label={`View note: ${note.title || "Untitled note"}`}
                onClick={() => onSelectNote(note.id)}
              >
                {rowContent}
              </button>
            ) : (
              <div className="note-row-select-button is-static">
                {rowContent}
              </div>
            )}
            <FolderPath
              path={note.folder_path ?? []}
              className="note-row-folder-path"
              emptyLabel={
                note.folder == null ? "No Folder" : "Folder path unavailable"
              }
            />
          </article>
        );
      })}
    </div>
  );
}

function FolderPath({
  path,
  className,
  emptyLabel = "No Folder",
}: {
  path: DashboardFolderPathItem[];
  className: string;
  emptyLabel?: string;
}) {
  return (
    <nav className={className} aria-label="Folder path">
      {path.length === 0 ? (
        <span>{emptyLabel}</span>
      ) : (
        path.map((folder, index) => (
          <span className="folder-path-segment" key={folder.id}>
            {index > 0 && <span aria-hidden="true">/</span>}
            <a href={`#/folders/${folder.id}`}>{folder.name}</a>
          </span>
        ))
      )}
    </nav>
  );
}

function noteDate(note: VideoNote): string {
  const value = note.created_at ?? note.updated_at;
  const timestamp = safeDateValue(value);
  if (timestamp === null) return "Saved note";
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTimestamp(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function WorkspacePlaceholder({ route }: { route: DashboardRoute }) {
  if (route === "dashboard" || route === "notes") return null;
  const content = routeContent[route];

  return (
    <section className="content-card workspace-placeholder">
      <span className="placeholder-icon">
        {route === "videos" ? (
          <Clapperboard size={22} aria-hidden="true" />
        ) : route === "folders" ? (
          <Folder size={22} aria-hidden="true" />
        ) : (
          <Search size={22} aria-hidden="true" />
        )}
      </span>
      <p className="eyebrow">WORKSPACE</p>
      <h2>{content.title}</h2>
      <p className="placeholder-message">{content.message}</p>
      <a
        className="secondary-link"
        href="https://www.youtube.com/"
        target="_blank"
        rel="noreferrer"
      >
        Open YouTube <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </section>
  );
}

export default Dashboard;
