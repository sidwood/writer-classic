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
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { ClassicFind } from "./find-panel";
import { tags } from "@lezer/highlight";
import { vim, Vim, getCM } from "@replit/codemirror-vim";
import { sentenceAt } from "./document";
import { marksAt, type FormatMarks } from "./format-marks";
import {
  NITTI_SPACE_EM,
  WORKFLOW_FACE,
  classicLayout,
  workflowState,
  type WorkflowState,
} from "./adaptive-layout";
import {
  detectText,
  detectionTarget,
  smartDeleteBounds,
  smartInserted,
  type Detection,
} from "./substitutions";

import {
  autocompletion,
  startCompletion,
  completionKeymap,
} from "@codemirror/autocomplete";
import { invoke, isTauri } from "@tauri-apps/api/core";
const props = defineProps<{
  text: string;
  vim: boolean;
  focus: boolean;
  smartCopyPaste: boolean;
  smartLinks: boolean;
  dataDetection: boolean;
}>();
const emit = defineEmits<{
  change: [text: string];
  selection: [text: string];
  mode: [mode: string];
  marks: [marks: FormatMarks];
  command: [command: string];
  dataAction: [message: string];
}>();
const container = ref<HTMLDivElement>();
// Classic's workflow state selects the typeface and its size table. 1 is the default.
const WORKFLOW_STATES: WorkflowState[] = [0, 1, 2, 3];
const workflow = ref<WorkflowState>(
  workflowState(localStorage.getItem("writer-classic.workflow")),
);
function chooseWorkflow(value: string) {
  workflow.value = workflowState(value);
  localStorage.setItem("writer-classic.workflow", String(workflow.value));
  applyLayout();
  view?.focus();
}
// The select must not keep the keyboard, whether or not its value changed.
// Focus that moves to another control stays there.
function leaveWorkflowChoice(event: FocusEvent) {
  if (!event.relatedTarget) view?.focus();
}
let view: EditorView;
const vimConfig = new Compartment();
const focusConfig = new Compartment();
const detectionConfig = new Compartment();

function detectionExtension(items: Detection[]) {
  return EditorView.decorations.of(
    Decoration.set(
      items
        .filter((item) => item.start < item.end)
        .map((item) =>
          Decoration.mark({
            class: `detected-${item.kind}`,
            attributes: { title: item.value },
          }).range(item.start, item.end),
        ),
    ),
  );
}
let detectionEpoch = 0;
let shownDetections: Detection[] = [];
function currentDetections(text: string) {
  return detectText(text, props.smartLinks, props.dataDetection).filter(
    (item) => item.end <= text.length,
  );
}
function reportMarks() {
  if (!view) return;
  emit(
    "marks",
    marksAt(view.state.doc.toString(), view.state.selection.main.head),
  );
}
async function refreshDetections() {
  if (!view) return;
  const epoch = ++detectionEpoch;
  const text = view.state.doc.toString();
  const fallback = currentDetections(text);
  shownDetections = fallback;
  let items = fallback;
  if (isTauri()) {
    try {
      const native = await invoke<Detection[] | null>("detect_data", {
        text,
        links: props.smartLinks,
        data: props.dataDetection,
      });
      if (Array.isArray(native))
        items = native.filter(
          (item) => item.start < item.end && item.end <= text.length,
        );
    } catch {
      /* JS detections remain the fallback. */
    }
  }
  if (epoch !== detectionEpoch || !view) return;
  shownDetections = items;
  view.dispatch({
    effects: detectionConfig.reconfigure(
      items.length ? detectionExtension(items) : [],
    ),
  });
}
function openDetected(target: string) {
  if (!isTauri()) {
    window.open(target);
    return;
  }
  void invoke("open_detected_url", { url: target }).catch((reason) =>
    emit("dataAction", String(reason)),
  );
}
function deleteText() {
  view.dispatch(
    view.state.changeByRange((range) => {
      let from = range.from;
      let to = range.to;
      if (from === to) {
        const next = view.state.doc.sliceString(
          from,
          Math.min(view.state.doc.length, from + 2),
        );
        const code = next.codePointAt(0) ?? 0;
        to = from + (code > 0xffff ? 2 : next ? 1 : 0);
      } else if (props.smartCopyPaste) {
        [from, to] = smartDeleteBounds(view.state.doc.toString(), from, to);
      }
      return { changes: { from, to }, range: EditorSelection.cursor(from) };
    }),
  );
  view.focus();
}

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

// Auto Markdown keeps its markers in the style of the text they format.
const highlighting = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, textDecoration: "underline", color: "var(--text)" },
]);
const finder = new ClassicFind();
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
          ...finder.keymap(),
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap.filter(
            (binding) => !["Mod-f", "Mod-g", "Escape"].includes(binding.key!),
          ),
          indentWithTab,
        ]),
        search({
          top: true,
          caseSensitive: false,
          literal: true,
          createPanel: finder.createPanel,
        }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Document text",
          spellcheck: "true",
          autocapitalize: "off",
        }),
        detectionConfig.of([]),
        focusConfig.of(props.focus ? sentenceFocus : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit("change", update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            emit(
              "selection",
              update.state.sliceDoc(
                update.state.selection.main.from,
                update.state.selection.main.to,
              ),
            );
            reportMarks();
          }
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
            reportMarks();
          },
          mousedown(event, editor) {
            reportMode();
            if (!event.metaKey) return false;
            const pos = editor.posAtCoords({
              x: event.clientX,
              y: event.clientY,
            });
            if (pos == null) return false;
            const hit = shownDetections.find(
              (item) => pos >= item.start && pos < item.end,
            );
            if (!hit) return false;
            event.preventDefault();
            const target = detectionTarget(hit);
            if (target) openDetected(target);
            else emit("dataAction", `Detected date: ${hit.value}`);
            return true;
          },
          paste(event, editor) {
            if (!props.smartCopyPaste) return false;
            const inserted = event.clipboardData?.getData("text/plain");
            if (inserted == null) return false;
            event.preventDefault();
            const range = editor.state.selection.main;
            const text = editor.state.doc.toString();
            editor.dispatch(
              editor.state.replaceSelection(
                smartInserted(
                  range.from > 0 ? text[range.from - 1] : "",
                  range.to < text.length ? text[range.to] : "",
                  inserted,
                ),
              ),
            );
            return true;
          },
        }),
      ],
    }),
  });
  view.focus();
  view.focus();
  applyLayout();
  window.addEventListener("resize", applyLayout);
  document.fonts.addEventListener("loadingdone", applyLayout);
  // WebKit can hold back resize events for a window that is not in front.
  resizeObserver = new ResizeObserver(() => applyLayout());
  resizeObserver.observe(document.documentElement);
  refreshDetections();
  reportMode();
  reportMarks();
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
    reportMarks();
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
    view.focus();
  },
);
watch(
  () => [
    props.smartCopyPaste,
    props.smartLinks,
    props.dataDetection,
    props.text,
  ],
  () => refreshDetections(),
);
onBeforeUnmount(() => {
  window.removeEventListener("resize", applyLayout);
  document.fonts.removeEventListener("loadingdone", applyLayout);
  resizeObserver?.disconnect();
  view?.destroy();
});

let resizeObserver: ResizeObserver | undefined;
const FALLBACK_FACES = "Menlo, monospace";

/**
 * The face the editor draws for this workflow state and its space advance in
 * ems. Classic's faces are never bundled. When a state's face is not
 * available, the fallback draws, and that fallback is what gets measured.
 */
function drawnFace(state: WorkflowState) {
  const wanted = WORKFLOW_FACE[state];
  const family = state === 1 ? `"Classic Nitti", "Nitti Pro"` : `"${wanted}"`;
  const stack = `${family}, ${FALLBACK_FACES}`;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return { stack, name: "unmeasured", spaceEm: NITTI_SPACE_EM };
  const width = (font: string, text: string) => {
    context.font = `100px ${font}`;
    return context.measureText(text).width;
  };
  const sample = "mmmmiiiiWW00 .";
  const fallback = width(FALLBACK_FACES, sample) === width(stack, sample);
  return {
    stack,
    name: fallback ? "Menlo" : wanted,
    spaceEm: width(stack, " ") / 100 || NITTI_SPACE_EM,
  };
}

// Classic changes type size with the window and insets its text container
// from the window edges and the title bar.
function applyLayout() {
  const element = container.value;
  if (!element || !view) return;
  const state = workflowState(localStorage.getItem("writer-classic.workflow"));
  const face = drawnFace(state);
  const layout = classicLayout(window.innerWidth, face.spaceEm, state);
  element.dataset.workflow = String(state);
  element.dataset.face = face.name;
  element.dataset.spaceEm = face.spaceEm.toFixed(5);
  element.style.setProperty("--writer-font-family", face.stack);
  element.style.setProperty("--writer-font-size", `${layout.fontSize}px`);
  element.style.setProperty("--writer-line-height", `${layout.lineHeight}px`);
  element.style.setProperty("--writer-left", `${layout.left}px`);
  element.style.setProperty("--writer-measure", `${layout.textWidth}px`);
  element.style.setProperty("--writer-vertical", `${layout.vertical}px`);
  view.requestMeasure();
}

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
      finder.open(view);
      break;
    case "replace":
      finder.open(view, true);
      break;
    case "find-next":
      finder.step(view, true);
      break;
    case "find-previous":
      finder.step(view, false);
      break;
    case "selection-find": {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({ search: view.state.sliceDoc(from, to) }),
        ),
      });
      finder.open(view);
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
    case "delete":
      deleteText();
      break;
  }
}
defineExpose({ command, focus: () => view.focus() });
</script>
<template>
  <div ref="container" class="writer-editor">
    <label class="workflow-choice" @mousedown.stop>
      <select
        aria-label="Typeface"
        :value="String(workflow)"
        @change="chooseWorkflow(($event.target as HTMLSelectElement).value)"
        @blur="leaveWorkflowChoice"
      >
        <option
          v-for="state in WORKFLOW_STATES"
          :key="state"
          :value="String(state)"
        >
          {{ WORKFLOW_FACE[state] }} ({{ state }})
        </option>
      </select>
    </label>
  </div>
</template>
