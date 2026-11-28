import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Folder,
  Globe,
} from "lucide-react";
import { useState } from "react";
import type { DashboardNote } from "./dashboardApi";
import { buildSourceTree, type SourceTreeNode } from "./sourceTree";

function findSourceNode(
  root: SourceTreeNode,
  key: string,
): SourceTreeNode | null {
  if (root.key === key) return root;
  for (const child of root.children.values()) {
    const result = findSourceNode(child, key);
    if (result) return result;
  }
  return null;
}

function SourceGraphNode({
  node,
  selectedKey,
  onSelect,
}: {
  node: SourceTreeNode;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const children = [...node.children.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
  const isRoot = node.path === "";

  return (
    <>
      <button
        className={`source-graph-node${isRoot ? " is-root" : ""}${selectedKey === node.key ? " is-selected" : ""}`}
        type="button"
        aria-pressed={selectedKey === node.key}
        onClick={() => onSelect(node.key)}
      >
        {isRoot ? (
          <Globe size={15} aria-hidden="true" />
        ) : (
          <Folder size={15} aria-hidden="true" />
        )}
        <span className="source-graph-node-label">{node.label}</span>
        {node.noteCount > 0 && (
          <span className="source-graph-node-count">
            {node.noteCount} {node.noteCount === 1 ? "note" : "notes"}
          </span>
        )}
      </button>
      {children.length > 0 && (
        <ul className="source-graph-children">
          {children.map((child) => (
            <li key={child.key}>
              <SourceGraphNode
                node={child}
                selectedKey={selectedKey}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SourceNodeNotes({
  node,
  onOpenNote,
}: {
  node: SourceTreeNode;
  onOpenNote: (noteId: number) => void;
}) {
  const pages = [...node.pages.values()].sort((left, right) =>
    left.title.localeCompare(right.title),
  );

  return (
    <section className="source-node-notes">
      <h3>{node.label}</h3>
      <p className="source-node-notes-caption">
        Notes saved at this exact URL
      </p>
      {pages.length === 0 ? (
        <p className="source-node-notes-empty">
          No notes are saved directly at this path.
        </p>
      ) : (
        <div className="source-node-pages">
          {pages.map((page) => (
            <article className="source-tree-page" key={page.url}>
              <a href={page.url} target="_blank" rel="noreferrer">
                <Globe size={14} aria-hidden="true" />
                <span className="source-tree-page-title">{page.title}</span>
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
              <ul>
                {page.notes.map((note) => (
                  <li key={note.id}>
                    <button type="button" onClick={() => onOpenNote(note.id)}>
                      <FileText size={13} aria-hidden="true" />
                      {note.title || "Untitled note"}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function SourcesPage({
  notes,
  loading,
  error,
  onRetry,
  onOpenNote,
}: {
  notes: DashboardNote[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenNote: (noteId: number) => void;
}) {
  const tree = buildSourceTree(notes);
  const [selectedDomainKey, setSelectedDomainKey] = useState<string | null>(
    null,
  );
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const selectedDomain =
    tree.find((node) => node.key === selectedDomainKey) ?? null;
  const selectedNode =
    selectedDomain && selectedNodeKey
      ? findSourceNode(selectedDomain, selectedNodeKey)
      : selectedDomain;

  const openDomain = (domain: SourceTreeNode) => {
    setSelectedDomainKey(domain.key);
    setSelectedNodeKey(domain.key);
  };

  return (
    <section className="content-card sources-page-card" aria-busy={loading}>
      <div className="sources-page-heading">
        <div>
          <h2>Web sources</h2>
          <p>Browse saved web notes by website and URL path.</p>
        </div>
      </div>
      {loading ? (
        <p className="sources-page-state" role="status">
          Loading sources…
        </p>
      ) : error ? (
        <div className="sources-page-state is-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className="inline-action" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : tree.length === 0 ? (
        <p className="sources-page-state">
          No web sources yet. Open a documentation or tutorial page and use the
          extension button to start a note.
        </p>
      ) : selectedDomain ? (
        <div className="source-domain-view">
          <button
            className="source-back-button"
            type="button"
            onClick={() => {
              setSelectedDomainKey(null);
              setSelectedNodeKey(null);
            }}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            All websites
          </button>
          <h3 className="source-domain-title">{selectedDomain.label}</h3>
          <p className="source-graph-caption">
            Each count is the number of notes saved at that exact URL.
          </p>
          <div className="source-graph-scroll">
            <ul className="source-tree-graph">
              <li>
                <SourceGraphNode
                  node={selectedDomain}
                  selectedKey={selectedNode?.key ?? selectedDomain.key}
                  onSelect={setSelectedNodeKey}
                />
              </li>
            </ul>
          </div>
          {selectedNode && (
            <SourceNodeNotes node={selectedNode} onOpenNote={onOpenNote} />
          )}
        </div>
      ) : (
        <div className="source-domain-list">
          {tree.map((domain) => (
            <button
              className="source-domain-row"
              type="button"
              key={domain.key}
              onClick={() => openDomain(domain)}
            >
              <Globe size={17} aria-hidden="true" />
              <span className="source-domain-row-name">{domain.label}</span>
              <span className="source-domain-row-count">
                {domain.totalNoteCount}{" "}
                {domain.totalNoteCount === 1 ? "note" : "notes"}
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
