<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { visualChangeCompatibility } from "./vim-compat";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo,
  redo,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  search,
  searchKeymap,
  openSearchPanel,
  findNext,
  findPrevious,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { vim, Vim, getCM } from "@replit/codemirror-vim";
import { sentenceAt } from "./document";

import {
  autocompletion,
  startCompletion,
  completionKeymap,
} from "@codemirror/autocomplete";
import { invoke, isTauri } from "@tauri-apps/api/core";
const props = defineProps<{ text: string; vim: boolean; focus: boolean }>();
const emit = defineEmits<{
  change: [text: string];
  selection: [text: string];
  mode: [mode: string];
  command: [command: string];
}>();
const container = ref<HTMLDivElement>();
let view: EditorView;
const vimConfig = new Compartment();
const focusConfig = new Compartment();

function focusDecorations(editor: EditorView): DecorationSet {
  const { from, to } = sentenceAt(
    editor.state.doc.toString(),
    editor.state.selection.main.head,
  );
  const ranges = [];
  if (from > 0)
    ranges.push(
      Decoration.mark({ class: "unfocused-sentence" }).range(0, from),
    );
  if (to < editor.state.doc.length)
    ranges.push(
      Decoration.mark({ class: "unfocused-sentence" }).range(
        to,
        editor.state.doc.length,
      ),
    );
  return Decoration.set(ranges);
}
const sentenceFocus = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(editor: EditorView) {
      this.decorations = focusDecorations(editor);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet)
        this.decorations = focusDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

const highlighting = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, textDecoration: "underline", color: "var(--text)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
]);
function reportMode() {
  const state = getCM(view)?.state.vim;
  emit(
    "mode",
    !props.vim
      ? ""
      : state?.insertMode
        ? "INSERT"
        : state?.visualMode
          ? state.visualBlock
            ? "VISUAL BLOCK"
            : state.visualLine
              ? "VISUAL LINE"
              : "VISUAL"
          : "NORMAL",
  );
}
onMounted(() => {
  Vim.defineEx("write", "w", () => emit("command", "save"));
  Vim.defineEx("quit", "q", () => emit("command", "close"));
  Vim.defineEx("wq", "wq", () => emit("command", "save-close"));
  view = new EditorView({
    parent: container.value,
    state: EditorState.create({
      doc: props.text,
      extensions: [
        EditorState.lineSeparator.of("\n"),
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        visualChangeCompatibility(),
        vimConfig.of(props.vim ? vim() : []),
        history(),
        markdown(),
        syntaxHighlighting(highlighting),
        keymap.of([
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        search({ top: true }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Document text",
          spellcheck: "true",
          autocapitalize: "off",
        }),
        focusConfig.of(props.focus ? sentenceFocus : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit("change", update.state.doc.toString());
          if (update.docChanged || update.selectionSet)
            emit(
              "selection",
              update.state.sliceDoc(
                update.state.selection.main.from,
                update.state.selection.main.to,
              ),
            );
          queueMicrotask(reportMode);
        }),
        autocompletion({
          activateOnTyping: false,
          override: [
            async (context) => {
              if (!isTauri() || props.vim) return null;
              const word = context.matchBefore(/[\p{L}]+/u);
              if (!word) return null;
              const words = await invoke<string[]>("complete_word", {
                text: context.state.doc.toString(),
                from: word.from,
                to: word.to,
              });
              return {
                from: word.from,
                options: words.map((label) => ({ label })),
              };
            },
          ],
        }),
        keymap.of([
          ...completionKeymap,
          {
            key: "Escape",
            run: (editor) =>
              !props.vim && isTauri() ? startCompletion(editor) : false,
          },
        ]),
        EditorView.domEventHandlers({
          keyup() {
            reportMode();
          },
          mousedown() {
            reportMode();
          },
        }),
      ],
    }),
  });
  view.focus();
  reportMode();
});
watch(
  () => props.text,
  (text) => {
    if (view && text !== view.state.doc.toString())
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
      });
  },
);
watch(
  () => props.vim,
  (enabled) => {
    view.dispatch({ effects: vimConfig.reconfigure(enabled ? vim() : []) });
    reportMode();
    view.focus();
  },
);
watch(
  () => props.focus,
  (enabled) => {
    view.dispatch({
      effects: focusConfig.reconfigure(enabled ? sentenceFocus : []),
    });
    view.focus();
  },
);
onBeforeUnmount(() => view?.destroy());

function replaceSelection(before: string, after = before) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length >= before.length + after.length
  ) {
    const content = selected.slice(
      before.length,
      selected.length - after.length,
    );
    view.dispatch({
      changes: { from, to, insert: content },
      selection: EditorSelection.range(from, from + content.length),
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: EditorSelection.range(
        from + before.length,
        to + before.length,
      ),
    });
  }
  view.focus();
}
function linePrefix(prefix: string) {
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from),
    last = view.state.doc.lineAt(to);
  const changes = [];
  for (let number = first.number; number <= last.number; number++) {
    const line = view.state.doc.line(number);
    const existing =
      line.text.match(/^(?:#{1,6}\s|[-+*]\s|\d+\.\s)/)?.[0] ?? "";
    changes.push({
      from: line.from,
      to: line.from + existing.length,
      insert: existing === prefix ? "" : prefix,
    });
  }
  view.dispatch({ changes });
  view.focus();
}
function command(action: string) {
  if (action.startsWith("heading-"))
    return linePrefix("#".repeat(Number(action.slice(-1))) + " ");
  switch (action) {
    case "bold":
      return replaceSelection("**");
    case "italic":
      return replaceSelection("*");
    case "strike":
      return replaceSelection("~~");
    case "link":
      return replaceSelection("[", "](https://)");
    case "unordered":
      return linePrefix("* ");
    case "ordered":
      return linePrefix("1. ");
    case "body":
      return linePrefix("");
    case "undo":
      undo(view);
      break;
    case "redo":
      redo(view);
      break;
    case "find":
    case "replace":
      openSearchPanel(view);
      break;
    case "find-next":
      findNext(view);
      break;
    case "find-previous":
      findPrevious(view);
      break;
    case "selection-find": {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({ search: view.state.sliceDoc(from, to) }),
        ),
      });
      openSearchPanel(view);
      break;
    }
    case "next-sentence":
    case "previous-sentence": {
      const text = view.state.doc.toString(),
        head = view.state.selection.main.head;
      const current = sentenceAt(text, head);
      const anchor =
        action === "next-sentence"
          ? current.to
          : sentenceAt(text, Math.max(0, current.from - 1)).from;
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      break;
    }
    case "clear": {
      const { from, to } = view.state.selection.main;
      const text = view.state
        .sliceDoc(from, to)
        .replace(/(\*\*|__|~~|\*|_|`)/g, "")
        .replace(/^#{1,6} /gm, "");
      view.dispatch({ changes: { from, to, insert: text } });
      break;
    }
  }
}
defineExpose({ command, focus: () => view.focus() });
</script>
<template><div ref="container" class="writer-editor" /></template>
