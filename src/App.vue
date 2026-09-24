<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  WebviewWindow,
  getAllWebviewWindows,
} from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import DOMPurify from "dompurify";
import WriterEditor from "./WriterEditor.vue";
import { WriterDocument, statistics } from "./document";
import { htmlDocument, renderMarkdown } from "./markdown";
import { exportDocx, exportRtf, importDocx } from "./export";
import documentIconUrl from "../brand/markdown-document-icon.svg";
import nativeIconUrl from "../brand/markdown-document-icon.png";
let headerIcon: number[] | undefined;

async function updateDocumentHeader() {
  document.title = doc.title + (doc.dirty ? " — Edited" : "");
  if (!native) return;
  if (headerIcon)
    await invoke("set_document_header", {
      title: doc.title,
      path: doc.path,
      edited: doc.dirty,
      icon: headerIcon,
    });
  else await getCurrentWindow().setTitle(doc.title);
}

const native = isTauri();
const label = native ? getCurrentWindow().label : "browser";
const draftKey = `writer-classic.draft.${label}`;
const doc = reactive(new WriterDocument());
const editor = ref<InstanceType<typeof WriterEditor>>();
const generation = ref(0);
const selection = ref("");
const mode = ref("");
const dark = ref(localStorage.getItem("writer-classic.dark") === "true");
const vim = ref(localStorage.getItem("writer-classic.vim") !== "false");
const focus = ref(false);
const formatBar = ref(
  localStorage.getItem("writer-classic.format") !== "false",
);
const chromeHidden = ref(false);
const preview = ref(false);
const previewHtml = ref("");
const error = ref("");
const busy = ref(false);
const pending = ref<null | (() => Promise<void>)>(null);
const exportDialog = ref(false);
const exportType = ref("html");
const recent = ref<string[]>(
  JSON.parse(localStorage.getItem("writer-classic.recent") ?? "[]"),
);
const fileInput = ref<HTMLInputElement>();
const stats = computed(() => statistics(selection.value || doc.text));
let autosave: ReturnType<typeof setTimeout>;
let previewTimer: ReturnType<typeof setTimeout>;
let previewWindow: Window | null = null;
let nativePreview: WebviewWindow | null = null;
const cleanups: (() => void)[] = [];
type Version = { path: string; timestamp: number; text: string };
const versions = ref<Version[]>([]);
const versionDialog = ref(false);
const chosenVersion = ref(0);
const recentDialog = ref(false);
function clearRecent() {
  recent.value = [];
  localStorage.removeItem("writer-classic.recent");
  if (native) void invoke("set_recent_files", { paths: [] }).catch(showError);
}
let lastVersion = 0;

async function browseVersions() {
  if (!doc.path) {
    showError("Save this document before browsing versions.");
    return;
  }
  versions.value = await invoke<Version[]>("list_versions", { path: doc.path });
  chosenVersion.value = 0;
  versionDialog.value = true;
}
async function restoreVersion(copy = false) {
  const version = versions.value[chosenVersion.value];
  if (!version) return;
  versionDialog.value = false;
  if (copy) await newDocument(version.text);
  else
    await confirmTransition(async () => {
      changed(version.text);
    });
}
async function deleteVersion(all = false) {
  if (!confirm(all ? "Delete all old versions?" : "Delete this version?"))
    return;
  await invoke("remove_version", {
    path: doc.path,
    versionPath: all ? null : versions.value[chosenVersion.value]?.path,
  });
  await browseVersions();
}
async function moveDocument() {
  if (!(await saveDocument())) return;
  const destination = await save({
    title: "Move document",
    defaultPath: doc.path!,
  });
  if (!destination || destination === doc.path) return;
  await invoke("move_document", { path: doc.path, destination });
  doc.path = destination;
  remember(destination);
  persistDraft();
}

function showError(reason: unknown) {
  error.value = String(reason);
}
function remember(path: string) {
  recent.value = [path, ...recent.value.filter((item) => item !== path)].slice(
    0,
    12,
  );
  localStorage.setItem("writer-classic.recent", JSON.stringify(recent.value));
  if (native)
    void invoke("set_recent_files", { paths: recent.value }).catch(showError);
}
function persistDraft() {
  try {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        text: doc.text,
        path: doc.path,
        savedText: doc.savedText,
      }),
    );
    return true;
  } catch (reason) {
    showError(`Draft could not be stored. Save your document now. ${reason}`);
    return false;
  }
}
function changed(text: string) {
  doc.edit(text);
  chromeHidden.value = true;
  persistDraft();
  clearTimeout(autosave);
  if (native && doc.path)
    autosave = setTimeout(() => {
      void saveDocument(false, true);
    }, 2000);
}
function applyDocument(path: string | null, text: string, savedText = text) {
  clearTimeout(autosave);
  doc.path = path;
  doc.text = text;
  doc.savedText = savedText;
  selection.value = "";
  generation.value++;
  persistDraft();
}
async function saveDocument(
  saveAs = false,
  automatic = false,
): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    let path = doc.path;
    const text = doc.text;
    if (native) {
      if (!path || saveAs)
        path = await save({
          title: "Save document",
          defaultPath: path || "Untitled.md",
          filters: [{ name: "Plain Text", extensions: ["md", "txt"] }],
        });
      if (!path) return false;
      await invoke("write_text", {
        path,
        text,
        expected: path === doc.path && !saveAs ? doc.savedText : null,
      });
      doc.saved(path, text);
      remember(path);
      persistDraft();
      if (!automatic || Date.now() - lastVersion > 3600000) {
        try {
          await invoke("save_version", { path });
          lastVersion = Date.now();
        } catch (reason) {
          showError(
            `Document saved, but its version could not be stored. ${reason}`,
          );
        }
      }
    } else {
      download(
        doc.title === "Untitled" ? "Untitled.md" : doc.title,
        new TextEncoder().encode(text),
        "text/plain",
      );
      doc.saved(doc.path || "Untitled.md", text);
      persistDraft();
    }
    return true;
  } catch (reason) {
    showError(reason);
    return false;
  } finally {
    busy.value = false;
  }
}
function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function confirmTransition(action: () => Promise<void>) {
  clearTimeout(autosave);
  if (busy.value) return;
  if (doc.dirty) {
    pending.value = action;
    return;
  }
  await action();
}
async function resolveTransition(choice: "save" | "discard" | "cancel") {
  const action = pending.value;
  if (choice === "cancel") {
    pending.value = null;
    editor.value?.focus();
    return;
  }
  if (choice === "save" && !(await saveDocument())) return;
  pending.value = null;
  if (action) await action();
}
async function newDocument(
  text = "",
  path: string | null = null,
  savedText = "",
) {
  if (native) {
    const id = `document-${crypto.randomUUID()}`;
    localStorage.setItem(
      `writer-classic.draft.${id}`,
      JSON.stringify({ text, path, savedText }),
    );
    new WebviewWindow(id, {
      title: "Untitled",
      width: 860,
      height: 640,
      minWidth: 560,
      minHeight: 320,
    });
  } else await confirmTransition(async () => applyDocument(null, text, ""));
}
async function openPath(path: string, replace = false) {
  try {
    const isDocx = path.toLowerCase().endsWith(".docx");
    const text = isDocx
      ? await importDocx(
          new Uint8Array(await invoke<number[]>("read_bytes", { path })),
        )
      : await invoke<string>("read_text", { path });
    if (native && !replace && (doc.text || doc.path))
      await newDocument(text, isDocx ? null : path, isDocx ? "" : text);
    else applyDocument(isDocx ? null : path, text, isDocx ? "" : text);
    remember(path);
  } catch (reason) {
    showError(`Could not open document. ${reason}`);
  }
}
async function openDocument(importing = false) {
  const pick = async () => {
    if (native) {
      const path = await open({
        multiple: true,
        directory: false,
        title: importing ? "Import Word document" : "Open document",
        ...(importing
          ? { filters: [{ name: "Microsoft Word", extensions: ["docx"] }] }
          : {}),
      });
      if (path)
        for (const selected of Array.isArray(path) ? path : [path])
          await openPath(selected);
    } else {
      fileInput.value!.accept = importing ? ".docx" : "";
      fileInput.value!.click();
    }
  };
  if (native) await pick();
  else await confirmTransition(pick);
}
async function browserOpen(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const importing = file.name.toLowerCase().endsWith(".docx");
    const text = importing
      ? await importDocx(bytes)
      : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        );
    applyDocument(importing ? null : file.name, text, importing ? "" : text);
  } catch (reason) {
    showError(reason);
  }
  input.value = "";
}
async function closeDocument() {
  await confirmTransition(async () => {
    localStorage.removeItem(draftKey);
    await nativePreview?.destroy();
    if (native) await getCurrentWindow().destroy();
    else applyDocument(null, "");
  });
}
function refreshPreview() {
  previewHtml.value = DOMPurify.sanitize(renderMarkdown(doc.text));
  if (nativePreview)
    void emitTo(nativePreview.label, "preview-update", {
      html: previewHtml.value,
      dark: dark.value,
    });
  if (previewWindow && !previewWindow.closed) {
    previewWindow.document.body.className = dark.value
      ? "dark preview-body"
      : "preview-body";
    previewWindow.document.querySelector("article")!.innerHTML =
      previewHtml.value;
  }
}
async function togglePreview() {
  preview.value = !preview.value;
  if (!preview.value) {
    previewWindow?.close();
    previewWindow = null;
    await nativePreview?.close();
    nativePreview = null;
    return;
  }
  refreshPreview();
  if (native) {
    localStorage.setItem(
      `writer-classic.preview.${label}`,
      JSON.stringify({ html: previewHtml.value, dark: dark.value }),
    );
    nativePreview = new WebviewWindow(`preview-${label}`, {
      url: `index.html?preview=${label}`,
      title: "Preview",
      width: 600,
      height: 700,
      alwaysOnTop: true,
    });
    await nativePreview.once("tauri://destroyed", () => {
      nativePreview = null;
      preview.value = false;
    });
    return;
  }
  previewWindow = window.open("", "writer-preview", "width=600,height=700");
  if (previewWindow) {
    previewWindow.document.write(
      "<!doctype html><html><head><title>Preview</title></head><body><article></article></body></html>",
    );
    for (const style of document.querySelectorAll(
      'style,link[rel="stylesheet"]',
    ))
      previewWindow.document.head.appendChild(style.cloneNode(true));
    refreshPreview();
  }
}
async function exportDocument() {
  try {
    const type = exportType.value;
    if (type === "pdf") {
      exportDialog.value = false;
      refreshPreview();
      await nextTick();
      await window.print();
      return;
    }
    const bytes =
      type === "docx"
        ? await exportDocx(doc.text)
        : new TextEncoder().encode(
            type === "rtf"
              ? exportRtf(doc.text)
              : htmlDocument(doc.text, doc.title),
          );
    const name = doc.title.replace(/\.[^.]+$/, "") + "." + type;
    if (native) {
      const path = await save({
        title: "Export document",
        defaultPath: name,
        filters: [{ name: type.toUpperCase(), extensions: [type] }],
      });
      if (!path) return;
      await invoke("write_bytes", { path, bytes: [...bytes] });
    } else
      download(
        name,
        bytes,
        type === "html" ? "text/html" : "application/octet-stream",
      );
    exportDialog.value = false;
  } catch (reason) {
    showError(reason);
  }
}
async function action(command: string) {
  chromeHidden.value = false;
  try {
    if (command.startsWith("recent-open-")) {
      const path = recent.value[Number(command.slice("recent-open-".length))];
      if (path) await openPath(path);
      return;
    }
    if (command === "recent-clear") {
      clearRecent();
      return;
    }
    if (command.startsWith("service-")) {
      editor.value?.focus();
      return await invoke("text_service", { service: command.slice(8) });
    }
    switch (command) {
      case "new":
        return await newDocument();
      case "duplicate":
        return await newDocument(doc.text);
      case "open":
        return await openDocument();
      case "import":
        return await openDocument(true);
      case "save":
        return await saveDocument();
      case "save-as":
        return await saveDocument(true);
      case "recent":
        recentDialog.value = true;
        return;
      case "move":
      case "rename":
        return await moveDocument();
      case "versions":
        return await browseVersions();
      case "revert":
        return await confirmTransition(async () => {
          if (doc.path) await openPath(doc.path, true);
        });
      case "icloud":
        showError(await invoke<string>("icloud_status"));
        return;
      case "close":
        return await closeDocument();
      case "quit":
        return native ? await invoke("request_quit") : await closeDocument();
      case "save-close":
        if (await saveDocument()) await closeDocument();
        return;
      case "focus":
        focus.value = !focus.value;
        return;
      case "dark":
        dark.value = !dark.value;
        return;
      case "vim":
        vim.value = !vim.value;
        return;
      case "format-bar":
        formatBar.value = !formatBar.value;
        return;
      case "preview":
        await togglePreview();
        return;
      case "export":
        exportDialog.value = true;
        return;
      case "print":
        refreshPreview();
        await nextTick();
        await window.print();
        return;
      case "copy-html":
        await navigator.clipboard.writeText(
          renderMarkdown(selection.value || doc.text),
        );
        return;
      case "fullscreen":
        if (native) {
          const win = getCurrentWindow();
          await win.setFullscreen(!(await win.isFullscreen()));
        } else if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
        return;
      default:
        editor.value?.command(command);
    }
  } catch (reason) {
    showError(reason);
  }
}
function shortcuts(event: KeyboardEvent) {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) {
    if (event.key === "Escape") {
      event.preventDefault();
      pending.value = null;
      exportDialog.value = false;
      recentDialog.value = false;
      editor.value?.focus();
    } else if (event.key === "Tab") {
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled),select,input",
        ),
      ];
      const index = controls.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      controls[
        (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      ]?.focus();
    } else if (event.metaKey || event.ctrlKey) event.preventDefault();
    return;
  }
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  let command: string | undefined;
  if (event.altKey)
    command = (
      {
        d: "dark",
        v: "vim",
        t: "format-bar",
        f: "replace",
        c: "copy-html",
        arrowright: "next-sentence",
        arrowleft: "previous-sentence",
        backspace: "clear",
        s: "save-as",
      } as Record<string, string>
    )[key];
  else if (event.shiftKey)
    command = (
      {
        s: "duplicate",
        i: "import",
        e: "export",
        l: "ordered",
        g: "find-previous",
      } as Record<string, string>
    )[key];
  else
    command =
      (
        {
          n: "new",
          o: "open",
          s: "save",
          w: "close",
          d: "focus",
          r: "preview",
          b: "bold",
          i: "italic",
          "-": "strike",
          k: "link",
          l: "unordered",
          p: "print",
          e: "selection-find",
          "0": "body",
        } as Record<string, string>
      )[key] || (/^[1-6]$/.test(key) ? `heading-${key}` : undefined);
  if (event.ctrlKey && event.metaKey && key === "f") command = "fullscreen";
  if (command) {
    event.preventDefault();
    event.stopPropagation();
    void action(command);
  }
}
watch(
  dark,
  async (enabled) => {
    localStorage.setItem("writer-classic.dark", String(enabled));
    document.documentElement.classList.toggle("dark", enabled);
    if (native) await getCurrentWindow().setTheme(enabled ? "dark" : "light");
    refreshPreview();
  },
  { immediate: true },
);
watch(vim, (enabled) => {
  localStorage.setItem("writer-classic.vim", String(enabled));
  if (native) void invoke("set_vim_checked", { checked: enabled });
});
watch(formatBar, (enabled) =>
  localStorage.setItem("writer-classic.format", String(enabled)),
);
watch(
  () => [doc.title, doc.path, doc.dirty],
  () => {
    void updateDocumentHeader().catch(showError);
  },
);
watch(
  () => doc.text,
  () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 3000);
  },
);
watch([pending, exportDialog, recentDialog], async () => {
  await nextTick();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  (
    dialog?.querySelector<HTMLElement>(".primary") ??
    dialog?.querySelector<HTMLElement>("button,select,input")
  )?.focus();
});
onMounted(async () => {
  try {
    const stored = localStorage.getItem(draftKey);
    if (stored) {
      const draft = JSON.parse(stored);
      applyDocument(draft.path, draft.text, draft.savedText);
    }
    const initialPath = new URLSearchParams(location.search).get("open");
    if (native && initialPath) await openPath(initialPath);
    if (native) {
      try {
        const response = await fetch(nativeIconUrl);
        if (!response.ok)
          throw new Error("Markdown document icon could not be loaded.");
        headerIcon = [...new Uint8Array(await response.arrayBuffer())];
        await updateDocumentHeader();
      } catch (reason) {
        showError(reason);
      }
      await invoke("set_vim_checked", { checked: vim.value });
      await invoke("set_recent_files", { paths: recent.value });
      cleanups.push(
        await listen("quit-request", async () => {
          clearTimeout(autosave);
          const saved = !doc.path || !doc.dirty || (await saveDocument());
          await invoke("quit_ready", { ready: saved && persistDraft() });
        }),
      );
      cleanups.push(
        await getCurrentWindow().onFocusChanged((event) => {
          if (event.payload)
            void invoke("set_vim_checked", { checked: vim.value });
        }),
      );
      if (label === "main") {
        const existing = new Set(
          (await getAllWebviewWindows()).map((win) => win.label),
        );
        for (const key of Object.keys(localStorage)) {
          if (!key.startsWith("writer-classic.draft.document-")) continue;
          const documentLabel = key.slice("writer-classic.draft.".length);
          if (!existing.has(documentLabel))
            new WebviewWindow(documentLabel, {
              title: "Untitled",
              width: 860,
              height: 640,
              minWidth: 560,
              minHeight: 320,
            });
        }
      }
      for (const [weight, css] of [
        ["regular", { weight: "400" }],
        ["bold", { weight: "700" }],
        ["italic", { style: "italic" }],
      ] as const) {
        try {
          const bytes = new Uint8Array(
            await invoke<number[]>("classic_font", { weight }),
          );
          const font = new FontFace("Classic Nitti", bytes, css);
          await font.load();
          document.fonts.add(font);
        } catch {
          /* Licensed font is optional and never bundled. */
        }
      }
      cleanups.push(
        await listen<string>("menu-action", (event) => {
          void action(event.payload);
        }),
      );
      cleanups.push(
        await listen<string>("open-file", (event) => {
          void confirmTransition(() => openPath(event.payload));
        }),
      );
      cleanups.push(
        await getCurrentWindow().onCloseRequested((event) => {
          event.preventDefault();
          void closeDocument();
        }),
      );
      cleanups.push(
        await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "drop" && payload.paths[0]) {
            const path = payload.paths[0];
            void confirmTransition(() => openPath(path));
          }
        }),
      );
    }
  } catch (reason) {
    showError(reason);
  }
  window.addEventListener("keydown", shortcuts, true);
});
function preferenceChanged(event: StorageEvent) {
  if (event.key === "writer-classic.vim")
    vim.value = event.newValue !== "false";
  if (event.key === "writer-classic.dark")
    dark.value = event.newValue === "true";
  if (event.key === "writer-classic.recent")
    recent.value = JSON.parse(event.newValue || "[]");
}
window.addEventListener("storage", preferenceChanged);
onBeforeUnmount(() => {
  clearTimeout(autosave);
  clearTimeout(previewTimer);
  cleanups.forEach((fn) => fn());
  window.removeEventListener("keydown", shortcuts, true);
  window.removeEventListener("storage", preferenceChanged);
  previewWindow?.close();
});
</script>

<template>
  <section
    v-if="versionDialog"
    class="versions-browser"
    aria-label="Document versions"
  >
    <header>
      <h1>{{ doc.title }} — Versions</h1>
      <button @click="versionDialog = false">Done</button>
    </header>
    <div class="versions-content">
      <nav aria-label="Saved versions">
        <button
          v-for="(version, index) in versions"
          :key="version.path"
          :aria-pressed="index === chosenVersion"
          @click="chosenVersion = index"
        >
          {{ new Date(version.timestamp * 1000).toLocaleString() }}
        </button>
      </nav>
      <pre>{{ versions[chosenVersion]?.text ?? "No older versions." }}</pre>
    </div>
    <div class="dialog-actions">
      <button :disabled="!versions.length" @click="deleteVersion(true)">
        Delete Old Versions</button
      ><button :disabled="!versions.length" @click="deleteVersion()">
        Delete This Version</button
      ><button :disabled="!versions.length" @click="restoreVersion(true)">
        Restore a Copy</button
      ><button :disabled="!versions.length" @click="restoreVersion()">
        Restore
      </button>
    </div>
  </section>
  <main
    v-show="!versionDialog"
    :class="{ 'chrome-hidden': chromeHidden, 'is-native': native }"
  >
    <nav
      v-if="!native"
      class="browser-menu"
      aria-label="Application menu"
      @mousemove="chromeHidden = false"
    >
      <details>
        <summary>File</summary>
        <div class="menu-items">
          <button @click="action('new')">New <kbd>⌘N</kbd></button
          ><button @click="action('open')">Open… <kbd>⌘O</kbd></button>
          <button @click="action('duplicate')">Duplicate <kbd>⇧⌘S</kbd></button
          ><button @click="action('save')">Save <kbd>⌘S</kbd></button>
          <button @click="action('save-as')">Save As…</button
          ><button @click="action('import')">Import…</button
          ><button @click="action('export')">Export…</button>
          <button @click="action('print')">Print Formatted…</button
          ><button @click="action('close')">Close <kbd>⌘W</kbd></button>
        </div>
      </details>
      <details>
        <summary>Edit</summary>
        <div class="menu-items">
          <button @click="action('undo')">Undo</button
          ><button @click="action('redo')">Redo</button
          ><button @click="action('find')">Find…</button
          ><button @click="action('replace')">Find and Replace…</button
          ><button @click="action('copy-html')">Copy HTML</button>
          <button
            role="menuitemcheckbox"
            :aria-checked="vim"
            @click="action('vim')"
          >
            Vim Mode
          </button>
        </div>
      </details>
      <details>
        <summary>View</summary>
        <div class="menu-items">
          <button @click="action('focus')">
            {{ focus ? "Exit" : "Enter" }} Focus Mode <kbd>⌘D</kbd>
          </button>
          <button @click="action('preview')">
            {{ preview ? "Hide" : "Show" }} Preview <kbd>⌘R</kbd>
          </button>
          <button @click="action('format-bar')">
            {{ formatBar ? "Hide" : "Show" }} Format Bar
          </button>
          <button @click="action('fullscreen')">Full Screen</button>
          <button
            role="menuitemcheckbox"
            :aria-checked="dark"
            @click="action('dark')"
          >
            Dark Mode
          </button>
        </div>
      </details>
      <span class="browser-title"
        ><img
          :src="documentIconUrl"
          alt="Markdown document"
          :draggable="false"
        /><span class="document-title"
          >{{ doc.title }}{{ doc.dirty ? " — Edited" : "" }}</span
        ></span
      >
    </nav>
    <input ref="fileInput" type="file" hidden @change="browserOpen" />
    <div v-if="error" role="alert" class="error-message">
      <span>{{ error }}</span
      ><button aria-label="Dismiss error" @click="error = ''">Dismiss</button>
    </div>
    <WriterEditor
      :key="generation"
      ref="editor"
      :text="doc.text"
      :vim="vim"
      :focus="focus"
      @change="changed"
      @selection="selection = $event"
      @mode="mode = $event"
      @command="action"
    />
    <footer @mousemove="chromeHidden = false" @focusin="chromeHidden = false">
      <button
        class="focus-switch"
        :aria-pressed="focus"
        title="Focus Mode (⌘D)"
        @click="action('focus')"
      >
        Focus {{ focus ? "On" : "Off" }}
      </button>
      <div v-if="formatBar" class="format-bar" aria-label="Formatting">
        <button
          v-for="level in 6"
          :key="level"
          :title="`Heading ${level} (⌘${level})`"
          :aria-label="`Heading ${level}`"
          @mousedown.prevent
          @click="action(`heading-${level}`)"
        >
          H{{ level }}
        </button>
        <button
          class="bold"
          title="Strong (⌘B)"
          aria-label="Strong"
          @mousedown.prevent
          @click="action('bold')"
        >
          B
        </button>
        <button
          class="italic"
          title="Emphasis (⌘I)"
          aria-label="Emphasis"
          @mousedown.prevent
          @click="action('italic')"
        >
          I
        </button>
        <button
          class="strike"
          title="Strikethrough (⌘-)"
          aria-label="Strikethrough"
          @mousedown.prevent
          @click="action('strike')"
        >
          S
        </button>
        <button
          title="Ordered item (⇧⌘L)"
          @mousedown.prevent
          @click="action('ordered')"
        >
          1. List
        </button>
        <button
          title="Unordered item (⌘L)"
          @mousedown.prevent
          @click="action('unordered')"
        >
          • List
        </button>
      </div>
      <span v-if="vim" class="vim-mode" aria-label="Vim state">{{ mode }}</span>
      <div
        class="statistics"
        :class="{ selected: selection }"
        aria-label="Document statistics"
      >
        <span :title="selection ? 'Selected words' : 'Words'"
          >{{ stats.words }} W</span
        ><span title="Characters">{{ stats.characters }} C</span
        ><span title="Reading time">{{ stats.time }}</span>
      </div>
    </footer>
    <aside
      v-if="preview && !previewWindow && !native"
      class="preview-fallback"
      aria-label="Preview"
    >
      <button @click="action('preview')">Close Preview</button>
      <article v-html="previewHtml" />
    </aside>
    <div v-if="pending" class="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        class="dialog"
      >
        <h1 id="unsaved-title">Save changes to “{{ doc.title }}”?</h1>
        <p>Your changes will be lost if you don’t save them.</p>
        <div class="dialog-actions">
          <button :disabled="busy" @click="resolveTransition('discard')">
            Don’t Save</button
          ><button :disabled="busy" @click="resolveTransition('cancel')">
            Cancel</button
          ><button
            class="primary"
            :disabled="busy"
            @click="resolveTransition('save')"
          >
            Save
          </button>
        </div>
      </section>
    </div>
    <div v-if="recentDialog" class="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Open Recent"
        class="dialog"
      >
        <h1>Open Recent</h1>
        <p v-if="!recent.length">No recent documents.</p>
        <button
          v-for="path in recent"
          :key="path"
          class="recent-path"
          @click="
            recentDialog = false;
            confirmTransition(() => openPath(path));
          "
        >
          {{ path }}
        </button>
        <div class="dialog-actions">
          <button @click="clearRecent">Clear Menu</button
          ><button @click="recentDialog = false">Done</button>
        </div>
      </section>
    </div>
    <div v-if="exportDialog" class="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        class="dialog"
      >
        <h1 id="export-title">Export document</h1>
        <label
          >Export as
          <select v-model="exportType">
            <option value="html">Web page (.html)</option>
            <option value="docx">Microsoft Word (.docx)</option>
            <option value="rtf">Rich Text Format (.rtf)</option>
            <option value="pdf">Portable Document Format (.pdf)</option>
          </select></label
        >
        <p v-if="exportType === 'pdf'">
          Choose Save as PDF in the print dialog.
        </p>
        <div class="dialog-actions">
          <button @click="exportDialog = false">Cancel</button
          ><button class="primary" @click="exportDocument">Export</button>
        </div>
      </section>
    </div>
    <article class="print-document" v-html="previewHtml" />
  </main>
</template>
