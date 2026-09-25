export type FormatMarks = {
  heading: number;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  ordered: boolean;
  unordered: boolean;
};

function insidePair(line: string, column: number, marker: string) {
  let search = 0;
  while (search < line.length) {
    const start = line.indexOf(marker, search);
    if (start < 0) return false;
    const end = line.indexOf(marker, start + marker.length);
    if (end < 0) return false;
    const close = end + marker.length;
    if (column >= start && column < close) return true;
    search = close;
  }
  return false;
}

function insideSingle(line: string, column: number, marker: string) {
  if (insidePair(line, column, marker + marker)) return false;
  let index = 0;
  while (index < line.length) {
    if (line.startsWith(marker + marker, index)) {
      index += 2;
      continue;
    }
    if (!line.startsWith(marker, index)) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < line.length) {
      if (line.startsWith(marker + marker, index)) {
        index += 2;
        continue;
      }
      if (line.startsWith(marker, index)) {
        if (column >= start && column < index + 1) return true;
        index += 1;
        break;
      }
      index += 1;
    }
  }
  return false;
}

export function marksAt(text: string, head: number): FormatMarks {
  const lineStart = text.lastIndexOf("\n", Math.max(0, head - 1)) + 1;
  const nextBreak = text.indexOf("\n", head);
  const line = text.slice(
    lineStart,
    nextBreak === -1 ? text.length : nextBreak,
  );
  const column = Math.max(0, Math.min(head - lineStart, line.length));
  const heading = /^(?: {0,3})(#{1,6})(?:[ \t]|$)/.exec(line);
  return {
    heading: heading ? heading[1].length : 0,
    bold: insidePair(line, column, "**") || insidePair(line, column, "__"),
    italic: insideSingle(line, column, "*") || insideSingle(line, column, "_"),
    strike: insidePair(line, column, "~~"),
    ordered: /^\d+\. /.test(line),
    unordered: /^[-*+] /.test(line),
  };
}
