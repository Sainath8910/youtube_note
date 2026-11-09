import { useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  FileText,
  Folder,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { DashboardNote } from "./dashboardApi";
import {
  createDashboardFolder,
  deleteDashboardFolder,
  getDashboardFolder,
  getDashboardFolderNotes,
  listDashboardFolders,
  renameDashboardFolder,
  searchDashboardFolders,
  type DashboardFolder,
  type DashboardFolderSearchResult,
} from "./folderApi";

type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatFolderDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date)
    : "date unavailable";
}

function FolderCreateForm({
  parentId,
  onCreated,
  onCancel,
}: {
  parentId: number | null;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createDashboardFolder({
        name: name.trim(),
        description: description.trim(),
        parent: parentId,
      });
      onCreated();
    } catch (reason) {
      setError(errorMessage(reason, "Could not create this folder."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="folder-create-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="folder-name">Name</label>
      <input
        id="folder-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={255}
        required
        autoFocus
      />
      <label htmlFor="folder-description">Description (optional)</label>
      <textarea
        id="folder-description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={3}
      />
      {error && <p className="folder-operation-error" role="alert">{error}</p>}
      <div className="folder-form-actions">
        <button
          className="workspace-secondary-button"
          type="button"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="workspace-save-button"
          type="submit"
          disabled={saving || !name.trim()}
        >
          {saving ? "Creating…" : "Create folder"}
        </button>
      </div>
    </form>
  );
}

export function FoldersPage() {
  const [state, setState] = useState<LoadState<DashboardFolder[]>>({
    status: "loading",
  });
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    listDashboardFolders(null)
      .then((folders) => {
        if (active) setState({ status: "ready", data: folders });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: errorMessage(error, "Could not load your folders."),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [retry]);

  const refresh = () => {
    setState({ status: "loading" });
    setRetry((value) => value + 1);
  };

  return (
    <section
      className="content-card folders-page-card"
      aria-labelledby="folders-list-heading"
      aria-busy={state.status === "loading"}
    >
      <div className="card-heading folders-page-heading">
        <div>
          <div className="card-title-row">
            <span className="section-icon"><Folder size={16} aria-hidden="true" /></span>
            <h2 id="folders-list-heading">Folders</h2>
          </div>
          <p>Keep related learning together.</p>
        </div>
        <button
          className="new-note-button"
          type="button"
          onClick={() => setCreating((value) => !value)}
          aria-expanded={creating}
        >
          <Plus size={15} aria-hidden="true" />
          {creating ? "Cancel" : "New Folder"}
        </button>
      </div>

      {creating && (
        <FolderCreateForm
          parentId={null}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      {state.status === "loading" ? (
        <div className="folder-loading" role="status" aria-label="Loading folders">
          <span /><span /><span />
        </div>
      ) : state.status === "error" ? (
        <div className="inline-state error-state" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          <div>
            <strong>Folders could not be loaded</strong>
            <p>{state.message}</p>
            <button className="inline-action" type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        </div>
      ) : state.data.length === 0 ? (
        <div className="folder-empty-state">
          <span className="empty-state-icon"><Folder size={20} aria-hidden="true" /></span>
          <h3>No folders yet.</h3>
          <p>Create a folder to organize your learning.</p>
          <button className="new-note-button" type="button" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" />
            New Folder
          </button>
        </div>
      ) : (
        <div className="folder-list">
          {state.data.map((folder) => (
            <a className="folder-row" href={`#/folders/${folder.id}`} key={folder.id}>
              <span className="folder-row-icon"><Folder size={18} aria-hidden="true" /></span>
              <div className="folder-row-copy">
                <div className="folder-row-heading">
                  <h3>{folder.name}</h3>
                  <time className="folder-row-date" dateTime={folder.created_at}>
                    Created {formatFolderDate(folder.created_at)}
                  </time>
                </div>
                {folder.description.trim() && <p>{folder.description}</p>}
              </div>
              <ArrowUpRight className="folder-row-arrow" size={16} aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export function FolderDetailPage({
  folderId,
  onOpenNote,
}: {
  folderId: number;
  onOpenNote: (noteId: number) => void;
}) {
  const [folder, setFolder] = useState<LoadState<DashboardFolder>>({ status: "loading" });
  const [children, setChildren] = useState<LoadState<DashboardFolder[]>>({ status: "loading" });
  const [notes, setNotes] = useState<LoadState<DashboardNote[]>>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getDashboardFolder(folderId),
      listDashboardFolders(folderId),
      getDashboardFolderNotes(folderId),
    ])
      .then(([loadedFolder, loadedChildren, loadedNotes]) => {
        if (!active) return;
        setFolder({ status: "ready", data: loadedFolder });
        setChildren({ status: "ready", data: loadedChildren });
        setNotes({ status: "ready", data: loadedNotes });
        setName(loadedFolder.name);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = errorMessage(error, "Could not load this folder.");
        setFolder({ status: "error", message });
        setChildren({ status: "error", message });
        setNotes({ status: "error", message });
      });
    return () => {
      active = false;
    };
  }, [folderId, retry]);

  const refresh = () => {
    setFolder({ status: "loading" });
    setChildren({ status: "loading" });
    setNotes({ status: "loading" });
    setRetry((value) => value + 1);
  };
  const currentFolder = folder.status === "ready" ? folder.data : null;

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      await renameDashboardFolder(folderId, name.trim());
      setRenaming(false);
      refresh();
    } catch (error) {
      setOperationError(errorMessage(error, "Could not rename this folder."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !currentFolder) return;
    setBusy(true);
    setOperationError(null);
    try {
      await deleteDashboardFolder(folderId);
      window.location.hash = currentFolder.parent
        ? `#/folders/${currentFolder.parent}`
        : "#/folders";
    } catch (error) {
      setOperationError(errorMessage(error, "Could not delete this folder."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="folder-detail-page">
      {folder.status === "loading" ? (
        <section className="content-card folder-detail-loading" role="status" aria-label="Loading folder">
          <span /><span />
        </section>
      ) : folder.status === "error" ? (
        <section className="content-card" role="alert">
          <div className="inline-state error-state">
            <AlertCircle size={19} aria-hidden="true" />
            <div>
              <strong>Folder not found or unavailable</strong>
              <p>{folder.message}</p>
              <button className="inline-action" type="button" onClick={refresh}>Try again</button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <nav className="folder-breadcrumbs" aria-label="Folder breadcrumbs">
            <a href="#/folders">Folders</a>
            {folder.data.breadcrumbs?.map((crumb, index, path) => (
              <span className="folder-breadcrumb-item" key={crumb.id}>
                <span aria-hidden="true">/</span>
                {index === path.length - 1 ? (
                  <span aria-current="page">{crumb.name}</span>
                ) : (
                  <a href={`#/folders/${crumb.id}`}>{crumb.name}</a>
                )}
              </span>
            ))}
          </nav>
          <section className="content-card">
            <header className="folder-detail-header">
              <div className="folder-detail-heading">
                {renaming ? (
                  <form className="folder-create-form" onSubmit={(event) => void rename(event)}>
                    <label htmlFor="rename-folder">Folder name</label>
                    <input
                      id="rename-folder"
                      value={name}
                      maxLength={255}
                      onChange={(event) => setName(event.target.value)}
                      required
                      autoFocus
                    />
                    <div className="folder-form-actions">
                      <button className="workspace-secondary-button" type="button" onClick={() => setRenaming(false)} disabled={busy}>
                        Cancel
                      </button>
                      <button className="workspace-save-button" type="submit" disabled={busy || !name.trim()}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <h2>{folder.data.name}</h2>
                    {folder.data.description.trim() && <p>{folder.data.description}</p>}
                  </>
                )}
              </div>
              {!renaming && !confirmDelete && !creating && (
                <div className="folder-management-actions">
                  <button className="workspace-secondary-button" type="button" onClick={() => setRenaming(true)}>
                    Rename
                  </button>
                  <button className="folder-delete-button" type="button" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </button>
                </div>
              )}
            </header>

            {confirmDelete && (
              <div className="folder-delete-confirmation" role="alert">
                <h3>Move this folder to Trash?</h3>
                <p>Its subfolders and contained notes will move to Trash together. You can restore the whole group within 30 days.</p>
                <div className="folder-form-actions">
                  <button className="workspace-secondary-button" type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</button>
                  <button className="folder-delete-button" type="button" onClick={() => void remove()} disabled={busy}>
                    {busy ? "Moving…" : "Move to Trash"}
                  </button>
                </div>
              </div>
            )}
            {operationError && <p className="folder-operation-error" role="alert">{operationError}</p>}
            {!creating && !renaming && !confirmDelete && (
              <button className="new-note-button" type="button" onClick={() => setCreating(true)}>
                <Plus size={15} aria-hidden="true" /> New Subfolder
              </button>
            )}
            {creating && (
              <FolderCreateForm
                parentId={folderId}
                onCancel={() => setCreating(false)}
                onCreated={() => {
                  setCreating(false);
                  refresh();
                }}
              />
            )}
          </section>

          <section className="content-card folder-subfolders-card">
            <div className="card-heading">
              <div><h2>Subfolders</h2><p>Folders inside {folder.data.name}</p></div>
            </div>
            {children.status === "loading" ? (
              <div className="folder-loading" role="status" aria-label="Loading subfolders"><span /><span /></div>
            ) : children.status === "error" ? (
              <div className="inline-state error-state" role="alert">
                <AlertCircle size={18} aria-hidden="true" /><div><p>{children.message}</p><button className="inline-action" type="button" onClick={refresh}>Try again</button></div>
              </div>
            ) : children.data.length ? (
              <div className="folder-list">
                {children.data.map((child) => (
                  <a className="folder-row" href={`#/folders/${child.id}`} key={child.id}>
                    <span className="folder-row-icon"><Folder size={18} aria-hidden="true" /></span>
                    <div className="folder-row-copy"><div className="folder-row-heading"><h3>{child.name}</h3></div>{child.description.trim() && <p>{child.description}</p>}</div>
                    <ArrowUpRight className="folder-row-arrow" size={16} aria-hidden="true" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="folder-notes-empty"><Folder size={20} aria-hidden="true" /><h3>No subfolders yet.</h3></div>
            )}
          </section>

          <section className="content-card folder-notes-card">
            <div className="card-heading">
              <div><div className="card-title-row"><span className="section-icon"><FileText size={16} aria-hidden="true" /></span><h2>Notes</h2></div><p>Notes saved in this folder</p></div>
            </div>
            {notes.status === "loading" ? (
              <div className="folder-loading" role="status" aria-label="Loading notes"><span /><span /></div>
            ) : notes.status === "error" ? (
              <div className="inline-state error-state" role="alert">
                <AlertCircle size={18} aria-hidden="true" /><div><p>{notes.message}</p><button className="inline-action" type="button" onClick={refresh}>Try again</button></div>
              </div>
            ) : notes.data.length ? (
              <div className="notes-list">
                {notes.data.map((note) => (
                  <article className="note-row" key={note.id}>
                    <button className="note-row-select-button" type="button" onClick={() => onOpenNote(note.id)} aria-label={`View note: ${note.title || "Untitled note"}`}>
                      <span className={`note-type-icon${note.note_type === "VIDEO" ? " is-video" : ""}`} aria-hidden="true"><FileText size={16} /></span>
                      <span className="note-row-copy"><span className="note-row-title">{note.title || "Untitled note"}</span><span className="note-metadata">{note.note_type === "VIDEO" ? "Video note" : "Standalone note"}</span></span>
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="folder-notes-empty"><FileText size={20} aria-hidden="true" /><h3>No notes in this folder yet.</h3></div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

type FolderSearchState =
  | { query: string; status: "loading" }
  | { query: string; status: "ready"; data: DashboardFolderSearchResult[] }
  | { query: string; status: "error"; message: string };

function noteMatchesSearch(note: DashboardNote, query: string): boolean {
  const normalized = query.toLocaleLowerCase();
  const blocks = note.document?.blocks.map((block) => block.content).join("\n") ?? "";
  const folderPath = note.folder_path.map((folder) => folder.name).join(" ");
  return `${note.title}\n${note.content}\n${blocks}\n${folderPath}`
    .toLocaleLowerCase()
    .includes(normalized);
}

export function FolderSearchPage({
  notesState,
  onRetryNotes,
  onOpenNote,
}: {
  notesState: LoadState<DashboardNote[]>;
  onRetryNotes: () => void;
  onOpenNote: (noteId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [folderState, setFolderState] = useState<FolderSearchState>({
    query: "",
    status: "loading",
  });
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (!normalizedQuery) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setFolderState({ query: normalizedQuery, status: "loading" });
      searchDashboardFolders(normalizedQuery)
        .then((data) => {
          if (active) setFolderState({ query: normalizedQuery, status: "ready", data });
        })
        .catch((error: unknown) => {
          if (active) {
            setFolderState({
              query: normalizedQuery,
              status: "error",
              message: errorMessage(error, "Could not search folders."),
            });
          }
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [normalizedQuery, retry]);

  const currentFolderState =
    normalizedQuery === ""
      ? null
      : folderState.query === normalizedQuery
        ? folderState
        : { query: normalizedQuery, status: "loading" as const };
  const matchingNotes =
    notesState.status === "ready"
      ? notesState.data.filter((note) => noteMatchesSearch(note, normalizedQuery))
      : [];

  return (
    <section className="content-card folder-search-panel">
      <label className="folder-search-input">
        <span className="visually-hidden">Search folders and notes</span>
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search folders and notes..."
          aria-label="Search folders and notes"
        />
      </label>
      {currentFolderState === null ? (
        <div className="folder-search-message" role="status">
          <Folder size={20} aria-hidden="true" />
          <div><strong>Search your learning space</strong><p>Enter a folder name or note title to search.</p></div>
        </div>
      ) : currentFolderState.status === "loading" ? (
        <div className="folder-search-message" role="status"><span className="folder-search-loading-indicator" aria-hidden="true" /><p>Searching folders…</p></div>
      ) : currentFolderState.status === "error" ? (
        <div className="folder-search-message is-error" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          <div><strong>Folders could not be searched</strong><p>{currentFolderState.message}</p><button className="inline-action" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
        </div>
      ) : currentFolderState.data.length > 0 ? (
        <div className="folder-search-results">
          <div className="folder-search-results-heading"><h2>Folders</h2><span>{currentFolderState.data.length}</span></div>
          <ul>
            {currentFolderState.data.map((result) => (
              <li key={result.id}>
                <a className="folder-search-result" href={`#/folders/${result.id}`} aria-label={`Open folder: ${result.path.map((folder) => folder.name).join(" / ")}`}>
                  <Folder size={17} aria-hidden="true" />
                  <span className="folder-search-path">
                    {result.path.map((folder, index) => (
                      <span className="folder-search-path-segment" key={folder.id}>
                        {index > 0 && <span className="folder-search-path-separator" aria-hidden="true">/</span>}
                        {folder.id === result.id ? <strong>{folder.name}</strong> : <span>{folder.name}</span>}
                      </span>
                    ))}
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {notesState.status === "loading" ? (
        <div className="folder-search-message" role="status"><span className="folder-search-loading-indicator" aria-hidden="true" /><p>Loading notes…</p></div>
      ) : notesState.status === "error" ? (
        <div className="folder-search-message is-error" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          <div><strong>Notes could not be searched</strong><p>{notesState.message}</p><button className="inline-action" type="button" onClick={onRetryNotes}>Try again</button></div>
        </div>
      ) : normalizedQuery && matchingNotes.length > 0 ? (
        <div className="folder-search-results">
          <div className="folder-search-results-heading"><h2>Notes</h2><span>{matchingNotes.length}</span></div>
          <div className="notes-list">
            {matchingNotes.map((note) => (
              <article className="note-row" key={note.id}>
                <button className="note-row-select-button" type="button" onClick={() => onOpenNote(note.id)} aria-label={`View note: ${note.title || "Untitled note"}`}>
                  <span className={`note-type-icon${note.note_type === "VIDEO" ? " is-video" : ""}`} aria-hidden="true"><FileText size={16} /></span>
                  <span className="note-row-copy"><span className="note-row-title">{note.title || "Untitled note"}</span><span className="note-metadata">{note.folder_path.length ? note.folder_path.map((folder) => folder.name).join(" / ") : "No Folder"}</span></span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : normalizedQuery && currentFolderState?.status === "ready" && currentFolderState.data.length === 0 ? (
        <div className="folder-search-message" role="status"><Search size={19} aria-hidden="true" /><p>No matching folders or notes.</p></div>
      ) : null}
    </section>
  );
}
