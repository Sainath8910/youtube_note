import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import {
  getChecklistItems,
  getListItems,
  getTableRows,
  hasMeaningfulBlockContent,
  hasTableHeader,
  normalizeDocument,
  type NoteBlock,
  type VideoNote,
} from "./noteDocument";

type WordContent = Paragraph | Table;
type EmbeddedImageType = "png" | "jpg" | "gif" | "bmp";

function externalHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function blockImage(block: NoteBlock): string {
  const metadataImage =
    typeof block.metadata?.image === "string" ? block.metadata.image : "";
  return block.type === "screenshot"
    ? metadataImage || block.content
    : block.content || metadataImage;
}

async function createEmbeddedImage(value: string): Promise<ImageRun | null> {
  const match = value.match(
    /^data:image\/(png|jpe?g|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (!match || typeof createImageBitmap !== "function") return null;

  const imageType: EmbeddedImageType =
    match[1].toLowerCase() === "jpeg"
      ? "jpg"
      : (match[1].toLowerCase() as EmbeddedImageType);
  const binary = atob(match[2].replace(/\s/g, ""));
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const mimeType =
    imageType === "jpg" ? "image/jpeg" : `image/${imageType}`;
  const bitmap = await createImageBitmap(
    new Blob([data], { type: mimeType }),
  );
  const scale = Math.min(1, 560 / bitmap.width, 720 / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  bitmap.close();

  return new ImageRun({
    data,
    type: imageType,
    transformation: { width, height },
  });
}

function splitTextRuns(
  value: string,
  options: { font?: string; size?: number; bold?: boolean } = {},
): TextRun[] {
  return value.split(/\r?\n/).map(
    (line, index) =>
      new TextRun({
        text: line,
        ...(index > 0 ? { break: 1 } : {}),
        ...options,
      }),
  );
}

function addHyperlink(
  content: WordContent[],
  label: string,
  url: string,
): void {
  content.push(
    new Paragraph({
      children: [
        new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: label, style: "Hyperlink" })],
        }),
      ],
      spacing: { after: 120 },
    }),
  );
}

function addTable(content: WordContent[], block: NoteBlock): void {
  const rows = getTableRows(block);
  if (rows.length === 0) return;

  const hasHeader = hasTableHeader(block);
  content.push(
    new Table({
      rows: rows.map(
        (row, rowIndex) =>
          new TableRow({
            children: (row.length > 0 ? row : [""]).map(
              (cell) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: cell,
                          bold: hasHeader && rowIndex === 0,
                        }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
      ),
    }),
  );
}

async function addImage(
  content: WordContent[],
  block: NoteBlock,
): Promise<void> {
  const image = blockImage(block);
  const embeddedImage = await createEmbeddedImage(image);
  if (embeddedImage) {
    content.push(new Paragraph({ children: [embeddedImage] }));
  } else {
    const alt =
      block.type === "image"
        ? block.metadata?.alt || "Note image"
        : "Video screenshot";
    content.push(new Paragraph({ text: `[Image not embedded: ${alt}]` }));
    const imageUrl = externalHttpUrl(image);
    if (imageUrl) addHyperlink(content, "Open image", imageUrl);
  }
}

async function addBlock(
  content: WordContent[],
  block: NoteBlock,
  youtubeId?: string,
): Promise<void> {
  if (block.type === "heading") {
    const level =
      typeof block.metadata?.level === "number" &&
      block.metadata.level >= 1 &&
      block.metadata.level <= 6
        ? Math.floor(block.metadata.level)
        : 2;
    const headingLevels = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ];
    content.push(
      new Paragraph({
        text: block.content,
        heading: headingLevels[level - 1],
        spacing: { before: 180, after: 80 },
      }),
    );
    return;
  }

  if (block.type === "bullet_list" || block.type === "numbered_list") {
    getListItems(block.content).forEach((item, index) => {
      content.push(
        new Paragraph({
          text:
            block.type === "numbered_list" ? `${index + 1}. ${item}` : item,
          ...(block.type === "bullet_list" ? { bullet: { level: 0 } } : {}),
          spacing: { after: 60 },
        }),
      );
    });
    return;
  }

  if (block.type === "table") {
    addTable(content, block);
    return;
  }

  if (block.type === "checklist") {
    getChecklistItems(block).forEach((item) => {
      content.push(
        new Paragraph({
          text: `[${item.checked ? "x" : " "}] ${item.text}`,
          spacing: { after: 60 },
        }),
      );
    });
    return;
  }

  if (block.type === "url") {
    const label =
      block.metadata?.title ||
      block.metadata?.domain ||
      block.content.trim() ||
      "Web resource";
    content.push(
      new Paragraph({
        children: [new TextRun({ text: label, bold: true })],
        spacing: { after: 60 },
      }),
    );
    if (typeof block.metadata?.description === "string") {
      content.push(new Paragraph({ text: block.metadata.description }));
    }
    const url = externalHttpUrl(
      block.content.trim() || block.metadata?.url || "",
    );
    if (url) addHyperlink(content, url, url);
    return;
  }

  if (block.type === "image" || block.type === "screenshot") {
    await addImage(content, block);
    return;
  }

  if (block.type === "timestamp") {
    content.push(new Paragraph({ text: `▶ ${block.content}` }));
    const parts = block.content.split(":").map(Number);
    const isValidTimestamp =
      (parts.length === 2 || parts.length === 3) &&
      parts.every((part) => Number.isFinite(part) && part >= 0) &&
      parts.at(-1)! < 60 &&
      (parts.length !== 3 || parts[1] < 60);
    if (youtubeId && isValidTimestamp) {
      const seconds =
        parts.length === 3
          ? Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2])
          : Math.floor(parts[0] * 60 + parts[1]);
      addHyperlink(
        content,
        "Open video at this timestamp",
        `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}&t=${seconds}`,
      );
    }
    return;
  }

  if (block.type === "code" || block.type === "command" || block.type === "equation") {
    if (block.type !== "equation") {
      const label =
        block.type === "code"
          ? `Code - ${block.metadata?.language || "code"}`
          : `Command - ${block.metadata?.shell || "command"}`;
      content.push(
        new Paragraph({
          children: [new TextRun({ text: label, bold: true })],
          spacing: { before: 100, after: 60 },
        }),
      );
    }
    content.push(
      new Paragraph({
        children: splitTextRuns(block.content, {
          font: "Courier New",
          size: 18,
        }),
        spacing: { after: 160 },
      }),
    );
    return;
  }

  content.push(
    new Paragraph({
      children: splitTextRuns(block.content),
      spacing: { after: 120 },
    }),
  );
}

export async function createNoteWordFile(
  note: VideoNote,
  youtubeId?: string,
): Promise<Blob> {
  const title = note.title.trim() || "Untitled note";
  const content: WordContent[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
    }),
  ];

  if (youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    addHyperlink(
      content,
      "Open related YouTube video",
      `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`,
    );
  }

  const blocks = normalizeDocument(note).blocks.filter(
    hasMeaningfulBlockContent,
  );
  const exportBlocks =
    blocks.length > 0
      ? blocks
      : note.content.trim()
        ? [{ id: "legacy-content", type: "paragraph" as const, content: note.content }]
        : [];

  for (const block of exportBlocks) {
    await addBlock(content, block, youtubeId);
  }

  if (exportBlocks.length === 0) {
    content.push(
      new Paragraph({ text: "This note has no text content." }),
    );
  }

  const document = new Document({
    sections: [{ children: content }],
  });
  return Packer.toBlob(document);
}
