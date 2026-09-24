import { describe, expect, it } from "vitest";
import { WriterDocument } from "../src/document";

describe("document lifecycle", () => {
  it("preserves raw text and remains dirty when a save snapshot finishes after another edit", () => {
    const doc = new WriterDocument();
    doc.edit("  café\r\n\r\n猫\t\nrepeat\nrepeat\n");
    const snapshot = doc.text;
    doc.edit(snapshot + "later");
    doc.saved("/tmp/unusual name.md", snapshot);
    expect(doc.path).toBe("/tmp/unusual name.md");
    expect(doc.text).toBe("  café\r\n\r\n猫\t\nrepeat\nrepeat\nlater");
    expect(doc.dirty).toBe(true);
    doc.saved(doc.path!, doc.text);
    expect(doc.dirty).toBe(false);
  });
});
