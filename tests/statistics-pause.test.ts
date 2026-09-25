import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { pausedStatistics, type Statistics } from "../src/document";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("document counts wait 3 seconds after the last edit", () => {
  const shown: Statistics[] = [];
  const figures = pausedStatistics((value) => shown.push(value));
  figures.now("one");
  expect(shown.map((value) => value.words)).toEqual([1]);
  figures.later("one two");
  vi.advanceTimersByTime(2000);
  figures.later("one two three");
  vi.advanceTimersByTime(2999);
  expect(shown.map((value) => value.words)).toEqual([1]);
  vi.advanceTimersByTime(1);
  expect(shown.map((value) => value.words)).toEqual([1, 3]);
  expect(shown[1]).toEqual({ words: 3, characters: 13, time: "00:00:01" });
});

test("an immediate count cancels a pending one", () => {
  const shown: number[] = [];
  const figures = pausedStatistics((value) => shown.push(value.words));
  figures.later("a b c d");
  figures.now("");
  vi.advanceTimersByTime(5000);
  expect(shown).toEqual([0]);
});
