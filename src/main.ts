import { createApp } from "vue";
import App from "./App.vue";
import Preview from "./Preview.vue";
import "./style.css";
createApp(
  new URLSearchParams(location.search).has("preview") ? Preview : App,
).mount("#app");
