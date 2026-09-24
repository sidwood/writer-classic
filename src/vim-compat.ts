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
  let observed: ReturnType<typeof getCM>;
  return [
    Prec.highest(
      EditorView.domEventHandlers({
        keydown(event, view) {
          const cm = getCM(view),
            state = cm?.state.vim;
          if (cm && observed !== cm) {
            observed = cm;
            changing = false;
            cm.on("vim-mode-change", (event: { mode: string }) => {
              if (event.mode === "normal") changing = false;
            });
          }
          // Arm only for a real change command. Pending-key arguments such as
          // Vrc, Vfc and V"cy must reach Vim unchanged. s and C are the visual
          // change aliases; line mode uses R so the following newline survives.
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            !state?.visualMode ||
            state.inputState.keyBuffer.length !== 0 ||
            (event.key !== "c" && event.key !== "s" && event.key !== "C")
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
