import {
  EditorState,
  Prec,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { getCM, Vim } from "@replit/codemirror-vim";

// The CM6 adapter splits visual change's deletion from subsequent typing, and
// its visual-line `c` consumes the following newline. Keep one Vim change as
// one undo event and use the library's full-line change action for line mode.
export function visualChangeCompatibility(): Extension {
  let changing = false;
  let first = false;
  return [
    Prec.highest(
      EditorView.domEventHandlers({
        keydown(event, view) {
          const cm = getCM(view),
            state = cm?.state.vim;
          if (
            event.key !== "c" ||
            event.metaKey ||
            event.ctrlKey ||
            !state?.visualMode
          )
            return false;
          changing = true;
          first = true;
          if (state.visualLine) {
            Vim.handleKey(cm!, "R", "user");
            return true;
          }
          return false;
        },
        keyup(event) {
          if (event.key === "Escape") changing = false;
        },
        blur() {
          changing = false;
        },
      }),
    ),
    EditorState.transactionFilter.of((transaction) => {
      if (!changing || !transaction.docChanged) return transaction;
      const annotations = [
        Transaction.userEvent.of(
          first ? "input.type.compose.start" : "input.type.compose",
        ),
      ];
      if (first) {
        annotations.push(isolateHistory.of("before"));
        first = false;
      }
      return [{ annotations }, transaction];
    }),
  ];
}
