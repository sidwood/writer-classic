export class WriterDocument {
  text = "";
  path: string | null = null;
  savedText = "";
  get dirty() {
    return this.text !== this.savedText;
  }
  get title() {
    return this.path?.split("/").pop() || "Untitled";
  }
  edit(text: string) {
    this.text = text;
  }
  saved(path: string, text: string) {
    this.path = path;
    this.savedText = text;
  }
  opened(path: string, text: string) {
    this.text = text;
    this.saved(path, text);
  }
}

export function statistics(text: string) {
  const words = text.match(/\S+/gu)?.length ?? 0;
  const characters = Array.from(text).length;
  const seconds = Math.ceil(words / 3.5);
  const time = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return { words, characters, time };
}

export function sentenceAt(text: string, position: number) {
  const segments = new Intl.Segmenter(undefined, {
    granularity: "sentence",
  }).segment(text);
  for (const segment of segments) {
    const end = segment.index + segment.segment.length;
    if (position < end || end === text.length)
      return { from: segment.index, to: end };
  }
  return { from: 0, to: text.length };
}
