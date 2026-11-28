import type { DashboardNote } from "./dashboardApi";

interface SourcePageEntry {
  url: string;
  title: string;
  notes: DashboardNote[];
}

export interface SourceTreeNode {
  key: string;
  label: string;
  path: string;
  children: Map<string, SourceTreeNode>;
  pages: Map<string, SourcePageEntry>;
  noteCount: number;
  totalNoteCount: number;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function getDisplayPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(decodePathSegment)
    .join("/");
}

function countSubtreeNotes(node: SourceTreeNode): number {
  node.totalNoteCount = node.noteCount;
  for (const child of node.children.values()) {
    node.totalNoteCount += countSubtreeNotes(child);
  }
  return node.totalNoteCount;
}

export function buildSourceTree(notes: DashboardNote[]): SourceTreeNode[] {
  const roots = new Map<string, SourceTreeNode>();
  const pathNodesByHost = new Map<string, Map<string, SourceTreeNode>>();
  for (const note of notes) {
    if (!note.source_url) continue;
    let url: URL;
    try {
      url = new URL(note.source_url);
    } catch {
      continue;
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      continue;
    }

    const host = url.host.toLocaleLowerCase();
    let root = roots.get(host);
    if (!root) {
      root = {
        key: host,
        label: host,
        path: "",
        children: new Map(),
        pages: new Map(),
        noteCount: 0,
        totalNoteCount: 0,
      };
      roots.set(host, root);
      pathNodesByHost.set(host, new Map());
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    let node = root;
    if (path === "/") {
      node.noteCount += 1;
    } else {
      let pathNodes = pathNodesByHost.get(host);
      if (!pathNodes) {
        pathNodes = new Map();
        pathNodesByHost.set(host, pathNodes);
      }
      let pathNode = pathNodes.get(path);
      if (!pathNode) {
        pathNode = {
          key: `${host}${path}`,
          label: `${host}/${getDisplayPath(path)}`,
          path,
          children: new Map(),
          pages: new Map(),
          noteCount: 0,
          totalNoteCount: 0,
        };
        pathNodes.set(path, pathNode);
      }
      pathNode.noteCount += 1;
      node = pathNode;
    }

    let page = node.pages.get(note.source_url);
    if (!page) {
      page = {
        url: note.source_url,
        title: note.source_title || url.pathname || host,
        notes: [],
      };
      node.pages.set(note.source_url, page);
    }
    page.notes.push(note);
  }

  for (const [host, root] of roots) {
    const pathNodes = pathNodesByHost.get(host);
    if (!pathNodes) {
      throw new Error(`Missing URL path nodes for ${host}.`);
    }
    for (const [path, node] of pathNodes) {
      const segments = path.split("/").filter(Boolean);
      let parent = root;
      for (let count = segments.length - 1; count > 0; count -= 1) {
        const ancestorPath = `/${segments.slice(0, count).join("/")}`;
        const ancestor = pathNodes.get(ancestorPath);
        if (ancestor) {
          parent = ancestor;
          break;
        }
      }
      parent.children.set(path, node);
    }
  }

  for (const root of roots.values()) {
    countSubtreeNotes(root);
  }
  return [...roots.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}
