<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
const source = new URLSearchParams(location.search).get("preview")!;
const initial = JSON.parse(
  localStorage.getItem(`writer-classic.preview.${source}`) ||
    '{"html":"","dark":false}',
);
const html = ref(initial.html);
document.documentElement.classList.toggle("dark", initial.dark);
let unlisten: (() => void) | undefined;
onMounted(async () => {
  unlisten = await getCurrentWebviewWindow().listen<{
    html: string;
    dark: boolean;
  }>("preview-update", (event) => {
    html.value = event.payload.html;
    document.documentElement.classList.toggle("dark", event.payload.dark);
  });
});
onBeforeUnmount(() => unlisten?.());
</script>
<template>
  <div class="preview-body"><article v-html="html" /></div>
</template>
