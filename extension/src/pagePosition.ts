import type { PagePositionData } from "./noteDocument";
import { normalizePageSourceUrl } from "./pageSource";

export function capturePagePosition(sourceUrl: string): PagePositionData {
  const documentHeight = Math.max(
    window.document.documentElement.scrollHeight,
    window.document.body?.scrollHeight ?? 0,
  );
  const viewportHeight = window.innerHeight;
  const maxScroll = Math.max(0, documentHeight - viewportHeight);
  const scrollY = Math.max(0, Math.min(window.scrollY, maxScroll));

  return {
    source_url: sourceUrl,
    scroll_x: Math.max(0, window.scrollX),
    scroll_y: scrollY,
    progress: maxScroll === 0 ? 0 : scrollY / maxScroll,
    document_height: documentHeight,
    viewport_height: viewportHeight,
  };
}

export function isPagePositionData(value: unknown): value is PagePositionData {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "source_url" in value &&
    typeof value.source_url === "string" &&
    "scroll_x" in value &&
    typeof value.scroll_x === "number" &&
    Number.isFinite(value.scroll_x) &&
    "scroll_y" in value &&
    typeof value.scroll_y === "number" &&
    Number.isFinite(value.scroll_y) &&
    "progress" in value &&
    typeof value.progress === "number" &&
    Number.isFinite(value.progress) &&
    "document_height" in value &&
    typeof value.document_height === "number" &&
    Number.isFinite(value.document_height) &&
    "viewport_height" in value &&
    typeof value.viewport_height === "number" &&
    Number.isFinite(value.viewport_height)
  );
}

export function formatPagePosition(position: PagePositionData): string {
  const progress = Math.round(Math.max(0, Math.min(1, position.progress)) * 100);
  return `${progress}% down the page · ${Math.round(position.scroll_y)} px`;
}

export function jumpToPagePosition(position: PagePositionData): boolean {
  if (normalizePageSourceUrl(window.location.href) !== position.source_url) {
    return false;
  }
  const documentHeight = Math.max(
    window.document.documentElement.scrollHeight,
    window.document.body?.scrollHeight ?? 0,
  );
  const maxScroll = Math.max(0, documentHeight - window.innerHeight);
  window.scrollTo({
    left: position.scroll_x,
    top: Math.round(Math.max(0, Math.min(1, position.progress)) * maxScroll),
    behavior: "smooth",
  });
  return true;
}
