import { normalizePageSourceUrl } from "./pageSource";

interface PageSectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageSectionSelection {
  bounds: PageSectionBounds;
  title: string;
}

interface PageSectionScreenshotResponse {
  success: boolean;
  error?: string;
  image?: string;
}

export interface CapturedPageSection {
  image: string;
  title: string;
}

function isPageSectionScreenshotResponse(
  value: unknown,
): value is PageSectionScreenshotResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "success" in value &&
    typeof value.success === "boolean" &&
    (!("error" in value) || typeof value.error === "string") &&
    (!("image" in value) || typeof value.image === "string")
  );
}

function getSelectableElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.closest("#youtube-notes-root")) return null;
  const element =
    target.closest<HTMLElement>(
      "p,h1,h2,h3,h4,h5,h6,li,figure,pre,blockquote,table,img",
    ) ??
    target.closest<HTMLElement>("article,section,main,aside") ??
    target;
  return element === window.document.body ||
    element === window.document.documentElement
    ? null
    : element;
}

function selectPageElement(): Promise<PageSectionSelection> {
  return new Promise((resolve, reject) => {
    let highlighted: HTMLElement | null = null;
    let oldOutline = "";
    let oldOutlinePriority = "";
    let oldOutlineOffset = "";
    let oldOutlineOffsetPriority = "";
    let settled = false;

    const restoreHighlight = () => {
      if (!highlighted) return;
      if (oldOutline) {
        highlighted.style.setProperty("outline", oldOutline, oldOutlinePriority);
      } else {
        highlighted.style.removeProperty("outline");
      }
      if (oldOutlineOffset) {
        highlighted.style.setProperty(
          "outline-offset",
          oldOutlineOffset,
          oldOutlineOffsetPriority,
        );
      } else {
        highlighted.style.removeProperty("outline-offset");
      }
      highlighted = null;
    };

    const cleanup = () => {
      window.document.removeEventListener("pointerover", handlePointerOver, true);
      window.document.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      restoreHighlight();
    };

    const finish = (selection: PageSectionSelection) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(selection);
    };

    const handlePointerOver = (event: PointerEvent) => {
      const element = getSelectableElement(event.target);
      if (element === highlighted) return;
      restoreHighlight();
      if (!element) return;
      highlighted = element;
      oldOutline = element.style.getPropertyValue("outline");
      oldOutlinePriority = element.style.getPropertyPriority("outline");
      oldOutlineOffset = element.style.getPropertyValue("outline-offset");
      oldOutlineOffsetPriority =
        element.style.getPropertyPriority("outline-offset");
      element.style.setProperty("outline", "2px solid #22d3ee", "important");
      element.style.setProperty("outline-offset", "2px", "important");
    };

    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (window.document.getElementById("youtube-notes-root")?.contains(event.target)) {
        return;
      }
      const element = getSelectableElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const text = (element.innerText || element.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim();
      finish({
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
        title: text.slice(0, 120) || element.tagName.toLocaleLowerCase(),
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || settled) return;
      settled = true;
      cleanup();
      reject(new Error("Section selection canceled."));
    };

    window.document.addEventListener("pointerover", handlePointerOver, true);
    window.document.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKeyDown, true);
  });
}

export async function captureCurrentPageSection(
  sourceUrl: string,
): Promise<CapturedPageSection> {
  if (normalizePageSourceUrl(window.location.href) !== sourceUrl) {
    throw new Error("The current page changed. Reopen the sidebar and try again.");
  }
  const selection = await selectPageElement();
  if (normalizePageSourceUrl(window.location.href) !== sourceUrl) {
    throw new Error("The current page changed. No screenshot was captured.");
  }

  const sidebar = window.document.getElementById("youtube-notes-root");
  const previousDisplay = sidebar?.style.display;
  if (sidebar) sidebar.style.display = "none";
  try {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    const response: unknown = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "CAPTURE_PAGE_SECTION",
          sourceUrl,
          bounds: selection.bounds,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        },
        (result: unknown) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "Section capture failed."));
            return;
          }
          resolve(result);
        },
      );
    });

    if (!isPageSectionScreenshotResponse(response)) {
      throw new Error("The page screenshot service returned an invalid response.");
    }
    if (!response.success || !response.image?.startsWith("data:image/jpeg;base64,")) {
      throw new Error(response.error || "Could not capture the selected section.");
    }
    return { image: response.image, title: selection.title };
  } finally {
    if (sidebar && previousDisplay !== undefined) {
      sidebar.style.display = previousDisplay;
    }
  }
}
