<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
const source = new URLSearchParams(location.search).get("preview")!;
const initial = JSON.parse(
  localStorage.getItem(`writer-classic.preview.${source}`) ||
    '{"html":"","dark":false}',
);
const html = ref(initial.html);
document.documentElement.classList.toggle("dark", initial.dark);
let unlisten: (() => void) | undefined;
function closePreview(event: KeyboardEvent) {
  if (!event.metaKey || event.altKey || event.shiftKey || event.ctrlKey) return;
  if (event.key.toLowerCase() !== "w") return;
  event.preventDefault();
  event.stopPropagation();
  if (isTauri()) void getCurrentWindow().close();
}
onMounted(async () => {
  window.addEventListener("keydown", closePreview, true);
  unlisten = await getCurrentWebviewWindow().listen<{
    html: string;
    dark: boolean;
  }>("preview-update", (event) => {
    html.value = event.payload.html;
    document.documentElement.classList.toggle("dark", event.payload.dark);
  });
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", closePreview, true);
  unlisten?.();
});
</script>
<template>
  <div class="preview-body"><article v-html="html" /></div>
</template>
