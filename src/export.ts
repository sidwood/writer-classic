import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
} from "docx";
import mammoth from "mammoth/mammoth.browser";
import TurndownService from "turndown";
import { renderMarkdown } from "./markdown";

export async function importDocx(bytes: Uint8Array) {
  const result = await mammoth.convertToHtml(
    {
      arrayBuffer: bytes.slice().buffer,
    },
    { styleMap: ["u => em"] },
  );
  const converter = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "*",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  converter.addRule("strike", {
    filter: ["s", "del"],
    replacement: (content) => `~~${content}~~`,
  });
  return converter.turndown(result.value);
}

function formattedRuns(
  node: Node,
  style: {
    bold?: boolean;
    italics?: boolean;
    strike?: boolean;
    style?: string;
  } = {},
): (TextRun | ExternalHyperlink)[] {
  if (node.nodeType === Node.TEXT_NODE)
    return [new TextRun({ text: node.textContent ?? "", ...style })];
  if (!(node instanceof Element)) return [];
  if (node.tagName === "BR") return [new TextRun({ break: 1 })];
  if (node.tagName === "IMG")
    return [
      new TextRun({ text: `[${node.getAttribute("alt") ?? ""}]`, ...style }),
    ];
  const next = {
    ...style,
    bold: style.bold || node.tagName === "STRONG",
    italics: style.italics || node.tagName === "EM",
    strike: style.strike || node.tagName === "S",
    style: node.tagName === "CODE" ? "Code" : style.style,
  };
  if (node.tagName === "A" && node.getAttribute("href"))
    return [
      new ExternalHyperlink({
        link: node.getAttribute("href")!,
        children: [
          new TextRun({ text: node.textContent ?? "", style: "Hyperlink" }),
        ],
      }),
    ];
  return [...node.childNodes].flatMap((child) => formattedRuns(child, next));
}
export async function exportDocx(text: string) {
  const root = new DOMParser().parseFromString(
    renderMarkdown(text),
    "text/html",
  );
  const paragraphs: Paragraph[] = [];
  function visit(node: Element, depth = 0) {
    if (node.tagName === "UL" || node.tagName === "OL") {
      for (const item of node.children) {
        const clone = item.cloneNode(true) as Element;
        clone.querySelectorAll("ul,ol").forEach((list) => list.remove());
        paragraphs.push(
          new Paragraph({
            children: formattedRuns(clone),
            ...(node.tagName === "UL"
              ? { bullet: { level: depth } }
              : { numbering: { reference: "numbered", level: depth } }),
          }),
        );
        for (const list of item.children)
          if (["UL", "OL"].includes(list.tagName)) visit(list, depth + 1);
      }
    } else if (node.tagName === "BLOCKQUOTE") {
      paragraphs.push(
        new Paragraph({
          children: formattedRuns(node),
          style: "Quote",
          indent: { left: 720 },
        }),
      );
    } else {
      const headings = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6,
      ];
      paragraphs.push(
        new Paragraph({
          children: formattedRuns(node),
          heading: /^H[1-6]$/.test(node.tagName)
            ? headings[Number(node.tagName[1]) - 1]
            : undefined,
        }),
      );
    }
  }
  [...root.body.children].forEach((node) => visit(node));
  const doc = new Document({
    styles: {
      characterStyles: [
        {
          id: "Code",
          name: "Code",
          basedOn: "DefaultParagraphFont",
          run: { font: "Menlo" },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: "decimal" as const,
            text: `%${level + 1}.`,
            alignment: "start" as const,
          })),
        },
      ],
    },
    sections: [{ children: paragraphs }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

export function exportRtf(text: string) {
  const root = new DOMParser().parseFromString(
    renderMarkdown(text),
    "text/html",
  );
  const escape = (s: string) =>
    s
      .split("")
      .map((c) =>
        /[\\{}]/.test(c)
          ? `\\${c}`
          : c.charCodeAt(0) > 127
            ? `\\u${c.charCodeAt(0) > 32767 ? c.charCodeAt(0) - 65536 : c.charCodeAt(0)}?`
            : c,
      )
      .join("");
  function nodeRtf(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
    if (!(node instanceof Element)) return "";
    const text = [...node.childNodes].map(nodeRtf).join("");
    const command = (
      { STRONG: "\\b ", EM: "\\i ", S: "\\strike ", CODE: "\\f1 " } as Record<
        string,
        string
      >
    )[node.tagName];
    if (command) return `{${command}${text}}`;
    if (/^H[1-6]$/.test(node.tagName))
      return `{\\b\\fs${40 - Number(node.tagName[1]) * 2} ${text}}\\par\n`;
    if (node.tagName === "LI") {
      const list = node.parentElement!;
      const marker =
        list.tagName === "OL"
          ? `${Number(list.getAttribute("start") || 1) + [...list.children].indexOf(node)}.`
          : "\\bullet";
      return `${marker}\\tab ${text}\\par\n`;
    }
    if (node.tagName === "A")
      return `{\\field{\\*\\fldinst HYPERLINK "${escape(node.getAttribute("href") || "").replace(/"/g, '\\\"')}"}{\\fldrslt ${text}}}`;
    return (
      text +
      (["P", "BLOCKQUOTE", "PRE", "BR"].includes(node.tagName) ? "\\par\n" : "")
    );
  }
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}{\\f1 Courier;}}\\uc1\n${[...root.body.childNodes].map(nodeRtf).join("")}}`;
}
