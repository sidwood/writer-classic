const wordChar = /[\p{L}\p{N}]/u;

export function isWordChar(char: string) {
  return char !== "" && wordChar.test(char);
}

export function smartInserted(
  before: string,
  after: string,
  inserted: string,
) {
  if (!inserted) return inserted;
  const prefix =
    !/^\s/u.test(inserted) && isWordChar(before) && isWordChar(inserted[0])
      ? " "
      : "";
  const suffix =
    !/\s$/u.test(inserted) &&
    isWordChar(after) &&
    isWordChar(inserted[inserted.length - 1])
      ? " "
      : "";
  return prefix + inserted + suffix;
}

export function smartDeleteBounds(text: string, from: number, to: number) {
  if (from >= to) return [from, to] as const;
  const selected = text.slice(from, to);
  if (![...selected].every(isWordChar)) return [from, to] as const;
  const prev = from > 0 ? text[from - 1] : "";
  const next = to < text.length ? text[to] : "";
  if (prev === " " && next === " ") return [from, to + 1] as const;
  if (prev === " " && !isWordChar(next)) return [from - 1, to] as const;
  if (next === " " && !isWordChar(prev)) return [from, to + 1] as const;
  return [from, to] as const;
}

export type Detection = {
  start: number;
  end: number;
  kind: "link" | "phone" | "date" | "address";
  value: string;
};

export function detectText(text: string, links: boolean, data: boolean) {
  const found: Detection[] = [];
  const add = (kind: Detection["kind"], pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        kind,
        value: match[0],
      });
    }
  };
  if (links) add("link", /https?:\/\/[^\s<>)]+/gu);
  if (data) {
    add(
      "phone",
      /(?:\+1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/gu,
    );
    add("date", /\b\d{4}-\d{2}-\d{2}\b/gu);
    add(
      "address",
      /\b\d{1,5}\s+[A-Z][\p{L}.]+(?:\s+[A-Z][\p{L}.]+)*\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b/gu,
    );
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: Detection[] = [];
  for (const item of found) {
    if (kept.some((other) => item.start < other.end && item.end > other.start))
      continue;
    kept.push(item);
  }
  return kept;
}

export function detectionTarget(item: Detection) {
  if (item.kind === "link") return item.value;
  if (item.kind === "phone")
    return `tel:${item.value.replace(/[^\d+]/gu, "")}`;
  if (item.kind === "address")
    return `https://maps.apple.com/?q=${encodeURIComponent(item.value)}`;
  return null;
}
