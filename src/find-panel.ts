import {
  EditorView,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import {
  SearchQuery,
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import {
  FIND_PATTERNS,
  defaultFindOptions,
  findQuerySpec,
  type FindMatch,
} from "./find-query";

/** Find bar state shared by every panel an editor opens. */
export class ClassicFind {
  options = { ...defaultFindOptions };
  find = "";
  replace = "";
  showReplace = false;
  private panel: { revealReplace(): void } | null = null;

  query() {
    return new SearchQuery(
      findQuerySpec(this.find, this.replace, this.options),
    );
  }

  matches(view: EditorView, limit = 10000) {
    const query = getSearchQuery(view.state);
    const found: { from: number; to: number }[] = [];
    if (!query.valid) return found;
    const cursor = query.getCursor(view.state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      found.push({ from: next.value.from, to: next.value.to });
      if (found.length >= limit) break;
    }
    return found;
  }

  open(view: EditorView, replace = false) {
    if (replace) this.showReplace = true;
    this.panel?.revealReplace();
    openSearchPanel(view);
  }

  step(view: EditorView, forward: boolean) {
    if (!getSearchQuery(view.state).valid) {
      this.open(view);
      return true;
    }
    const all = this.matches(view);
    const { from, to } = view.state.selection.main;
    let match = forward
      ? all.find((item) => item.from >= to && item.to > from)
      : all.filter((item) => item.from < from).pop();
    if (!match && this.options.wrapAround)
      match = forward ? all[0] : all[all.length - 1];
    if (!match) return true;
    view.dispatch({
      selection: EditorSelection.range(match.from, match.to),
      scrollIntoView: true,
      userEvent: "select.search",
    });
    return true;
  }

  keymap() {
    return [
      {
        key: "Mod-f",
        run: (view: EditorView) => (this.open(view), true),
        scope: "editor search-panel",
      },
      {
        key: "Mod-g",
        run: (view: EditorView) => this.step(view, true),
        shift: (view: EditorView) => this.step(view, false),
        scope: "editor search-panel",
        preventDefault: true,
      },
      {
        key: "Escape",
        run: (view: EditorView) => this.close(view),
        scope: "editor search-panel",
      },
    ];
  }

  close(view: EditorView) {
    if (!searchPanelOpen(view.state)) return false;
    closeSearchPanel(view);
    view.focus();
    return true;
  }

  createPanel = (view: EditorView): Panel => {
    const make = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      attributes: Record<string, string> = {},
      text = "",
    ) => {
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes))
        element.setAttribute(name, value);
      if (text) element.textContent = text;
      return element;
    };
    const dom = make("div", {
      class: "cm-search classic-find",
      role: "search",
      "aria-label": "Find",
    });
    const findField = make("input", {
      type: "text",
      "aria-label": "Find",
      placeholder: "Find",
      "main-field": "true",
      class: "classic-find-field",
    });
    const count = make("span", {
      class: "classic-find-count",
      role: "status",
      "aria-label": "Matches",
    });
    const previous = make(
      "button",
      {
        type: "button",
        "aria-label": "Previous match",
        title: "Previous (⇧⌘G)",
      },
      "‹",
    );
    const next = make(
      "button",
      {
        type: "button",
        "aria-label": "Next match",
        title: "Next (⌘G)",
      },
      "›",
    );
    const done = make("button", { type: "button" }, "Done");
    const replaceToggle = make("input", {
      type: "checkbox",
      "aria-label": "Replace",
    });
    const replaceLabel = make("label", { class: "classic-find-option" });
    replaceLabel.append(replaceToggle, " Replace");
    const replaceRow = make("div", { class: "classic-find-replace" });
    const replaceField = make("input", {
      type: "text",
      "aria-label": "Replace with",
      placeholder: "Replace",
      class: "classic-find-field",
    });
    const replaceOne = make("button", { type: "button" }, "Replace");
    const replaceEvery = make(
      "button",
      { type: "button", "aria-label": "Replace All" },
      "All",
    );
    replaceRow.append(replaceField, replaceOne, replaceEvery);
    const options = make("details", { class: "classic-find-options" });
    const optionsBody = make("div", { class: "classic-find-menu" });
    options.append(make("summary", {}, "Options"), optionsBody);
    const checkbox = (label: string, key: "ignoreCase" | "wrapAround") => {
      const input = make("input", { type: "checkbox" });
      input.checked = this.options[key];
      input.onchange = () => {
        this.options[key] = input.checked;
        sync();
      };
      const wrapper = make("label", { class: "classic-find-option" });
      wrapper.append(input, ` ${label}`);
      optionsBody.append(wrapper);
    };
    checkbox("Ignore Case", "ignoreCase");
    checkbox("Wrap Around", "wrapAround");
    for (const [value, label] of [
      ["contains", "Contains"],
      ["starts-with", "Starts With"],
      ["full-word", "Full Word"],
    ] as const) {
      const input = make("input", {
        type: "radio",
        name: "classic-find-match",
        value,
      });
      input.checked = this.options.match === value;
      input.onchange = () => {
        if (input.checked) this.options.match = value as FindMatch;
        sync();
      };
      const wrapper = make("label", { class: "classic-find-option" });
      wrapper.append(input, ` ${label}`);
      optionsBody.append(wrapper);
    }
    const pattern = make("select", { "aria-label": "Insert Pattern" });
    for (const [value, label] of [
      ["", "Insert Pattern"],
      ["\t", "Tab"],
      ...FIND_PATTERNS.map((item) => [item.token, item.label]),
    ])
      pattern.append(make("option", { value }, label));
    optionsBody.append(pattern);
    let lastField: HTMLInputElement = findField;
    for (const field of [findField, replaceField])
      field.addEventListener("focus", () => (lastField = field));
    pattern.onchange = () => {
      const text = pattern.value;
      pattern.value = "";
      if (!text) return;
      const start = lastField.selectionStart ?? lastField.value.length;
      const end = lastField.selectionEnd ?? start;
      lastField.setRangeText(text, start, end, "end");
      lastField.focus();
      read();
    };

    let dispatched: SearchQuery | null = null;
    const showCount = () => {
      const all = this.matches(view);
      const { from, to } = view.state.selection.main;
      const index = all.findIndex(
        (item) => item.from === from && item.to === to,
      );
      count.textContent = !this.find
        ? ""
        : index >= 0
          ? `${index + 1} of ${all.length}`
          : `${all.length} ${all.length === 1 ? "match" : "matches"}`;
    };
    const sync = () => {
      const query = this.query();
      if (!query.eq(getSearchQuery(view.state))) {
        dispatched = query;
        view.dispatch({ effects: setSearchQuery.of(query) });
      }
      showCount();
    };
    const read = () => {
      this.find = findField.value;
      this.replace = replaceField.value;
      sync();
    };
    const revealReplace = () => {
      replaceToggle.checked = this.showReplace;
      replaceRow.hidden = !this.showReplace;
    };
    findField.oninput = read;
    replaceField.oninput = read;
    replaceToggle.onchange = () => {
      this.showReplace = replaceToggle.checked;
      revealReplace();
      if (this.showReplace) replaceField.focus();
    };
    previous.onclick = () => this.step(view, false);
    next.onclick = () => this.step(view, true);
    done.onclick = () => this.close(view);
    replaceOne.onclick = () => replaceNext(view);
    replaceEvery.onclick = () => replaceAll(view);
    dom.addEventListener("keydown", (event) => {
      if (runScopeHandlers(view, event, "search-panel")) {
        event.preventDefault();
      } else if (event.key === "Enter" && event.target === findField) {
        event.preventDefault();
        this.step(view, !event.shiftKey);
      } else if (event.key === "Enter" && event.target === replaceField) {
        event.preventDefault();
        replaceNext(view);
      }
    });
    const row = make("div", { class: "classic-find-row" });
    row.append(findField, count, previous, next, replaceLabel, options, done);
    dom.append(row, replaceRow);
    return {
      dom,
      top: true,
      mount: () => {
        this.panel = { revealReplace };
        const current = getSearchQuery(view.state);
        if (!current.eq(this.query())) this.find = current.search;
        findField.value = this.find;
        replaceField.value = this.replace;
        revealReplace();
        findField.select();
        // Panels mount during a view update, so the query dispatch waits.
        queueMicrotask(sync);
      },
      update: (update: ViewUpdate) => {
        for (const transaction of update.transactions)
          for (const effect of transaction.effects)
            if (
              effect.is(setSearchQuery) &&
              effect.value !== dispatched &&
              !effect.value.eq(this.query())
            ) {
              this.find = findField.value = effect.value.search;
              queueMicrotask(sync);
            }
        if (update.docChanged || update.selectionSet) showCount();
      },
      destroy: () => {
        this.panel = null;
      },
    };
  };
}
