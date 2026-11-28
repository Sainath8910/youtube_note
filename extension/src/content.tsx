import React from "react";
import { createRoot, type Root } from "react-dom/client";
import Sidebar, { type TranscriptStatus, type VideoNote } from "./Sidebar";
import { getCurrentPageSource, type PageSource } from "./pageSource";

interface VideoContext {
  video: {
    youtube_id: string;
    title: string;
    transcript_status: TranscriptStatus;
  } | null;
  notes: VideoNote[];
}

type VideoContextStatus = "loading" | "loaded" | "error" | "login_required";

const contentWindow = window as Window & {
  __youtubeNotesContentInitialized?: boolean;
};

if (!contentWindow.__youtubeNotesContentInitialized) {
  contentWindow.__youtubeNotesContentInitialized = true;

  let sidebarRoot: Root | null = null;
  let sidebarContainer: HTMLElement | null = null;
  let lastVideoId: string | null = null;
  let lastPageSourceUrl: string | null = null;
  let contextRequestVersion = 0;

  function getYouTubeVideoId(): string | null {
    const url = new URL(window.location.href);
    if (
      !["youtube.com", "www.youtube.com"].includes(url.hostname) ||
      url.pathname !== "/watch"
    ) {
      return null;
    }
    return url.searchParams.get("v");
  }

  function renderSidebar(
    data: VideoContext,
    detectedVideoId: string,
    contextStatus: VideoContextStatus,
    pageSource: PageSource | null = null,
  ) {
    let container = window.document.getElementById("youtube-notes-root");
    if (!container) {
      container = window.document.createElement("div");
      container.id = "youtube-notes-root";
      window.document.body.appendChild(container);
    }

    if (sidebarContainer !== container) {
      sidebarRoot?.unmount();
      sidebarRoot = createRoot(container);
      sidebarContainer = container;
    }
    const root = sidebarRoot;
    if (!root) throw new Error("The page sidebar root could not be created.");
    root.render(
      <React.StrictMode>
        <Sidebar
          key={pageSource?.url ?? detectedVideoId}
          videoId={detectedVideoId}
          videoTitle={
            pageSource?.title ??
            (data.video?.youtube_id === detectedVideoId
              ? data.video.title
              : "")
          }
          sourceUrl={pageSource?.url}
          sourceTitle={pageSource?.title}
          notes={
            contextStatus === "loaded" &&
            (pageSource !== null ||
              data.video?.youtube_id === detectedVideoId)
              ? data.notes
              : []
          }
          contextStatus={contextStatus}
          transcriptStatus={
            pageSource === null &&
            contextStatus === "loaded" &&
            data.video?.youtube_id === detectedVideoId
              ? data.video.transcript_status
              : null
          }
        />
      </React.StrictMode>,
    );
  }

  function fetchVideoContext(videoId: string) {
    const requestVersion = ++contextRequestVersion;
    renderSidebar({ video: null, notes: [] }, videoId, "loading");

    chrome.runtime.sendMessage(
      { type: "GET_VIDEO_CONTEXT", videoId },
      (response) => {
        if (
          requestVersion !== contextRequestVersion ||
          getYouTubeVideoId() !== videoId
        ) {
          return;
        }
        if (chrome.runtime.lastError || !response?.success) {
          console.error(
            "[YouTube Notes] Failed to fetch video context:",
            chrome.runtime.lastError?.message ?? response?.error,
          );
          renderSidebar(
            { video: null, notes: [] },
            videoId,
            response?.authRequired ? "login_required" : "error",
          );
          return;
        }
        renderSidebar(response.data, videoId, "loaded");
      },
    );
  }

  function getNotesFromResponse(value: unknown): VideoNote[] {
    const values = Array.isArray(value)
      ? value
      : typeof value === "object" &&
          value !== null &&
          "results" in value &&
          Array.isArray(value.results)
        ? value.results
        : [];
    return values.filter(
      (item): item is VideoNote =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        "id" in item &&
        typeof item.id === "number" &&
        "title" in item &&
        typeof item.title === "string" &&
        "content" in item &&
        typeof item.content === "string" &&
        "note_type" in item &&
        typeof item.note_type === "string" &&
        "source_url" in item &&
        typeof item.source_url === "string",
    );
  }

  function fetchPageContext(pageSource: PageSource) {
    const requestVersion = ++contextRequestVersion;
    renderSidebar(
      { video: null, notes: [] },
      "",
      "loading",
      pageSource,
    );

    chrome.runtime.sendMessage({ type: "GET_NOTES" }, (response) => {
      if (
        requestVersion !== contextRequestVersion ||
        getCurrentPageSource()?.url !== pageSource.url
      ) {
        return;
      }
      if (chrome.runtime.lastError || !response?.success) {
        console.error(
          "[YouTube Notes] Failed to fetch page notes:",
          chrome.runtime.lastError?.message ?? response?.error,
        );
        renderSidebar(
          { video: null, notes: [] },
          "",
          response?.authRequired ? "login_required" : "error",
          pageSource,
        );
        return;
      }

      const notes = getNotesFromResponse(response.data).filter(
        (note) => note.source_url === pageSource.url,
      );
      renderSidebar({ video: null, notes }, "", "loaded", pageSource);
    });
  }

  function checkForContextChange() {
    const videoId = getYouTubeVideoId();
    if (videoId) {
      lastPageSourceUrl = null;
      if (lastVideoId !== videoId) {
        lastVideoId = videoId;
        fetchVideoContext(videoId);
      }
      return;
    }

    lastVideoId = null;
    const pageSource = getCurrentPageSource();
    if (!pageSource) {
      lastPageSourceUrl = null;
      return;
    }
    if (pageSource.url !== lastPageSourceUrl) {
      lastPageSourceUrl = pageSource.url;
      fetchPageContext(pageSource);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "TOGGLE_PAGE_SIDEBAR") return false;
    const container = window.document.getElementById("youtube-notes-root");
    if (container) {
      sidebarRoot?.unmount();
      sidebarRoot = null;
      sidebarContainer = null;
      container.remove();
      sendResponse({ success: true, open: false });
      return false;
    }
    lastVideoId = null;
    lastPageSourceUrl = null;
    checkForContextChange();
    sendResponse({ success: true, open: true });
    return false;
  });

  checkForContextChange();
  window.setInterval(checkForContextChange, 500);
}
