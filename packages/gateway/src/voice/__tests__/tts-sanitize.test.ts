import { describe, it, expect } from "vitest";
import { sanitizeForTts } from "../edge-tts.js";

describe("sanitizeForTts", () => {
  it('strips trailing period: "Hello." → "Hello"', () => {
    expect(sanitizeForTts("Hello.")).toBe("Hello");
  });

  it('strips trailing dots from artifact: "icon...." → "icon"', () => {
    expect(sanitizeForTts("icon....")).toBe("icon");
  });

  it('collapses ellipsis: "Hello … world" → "Hello world"', () => {
    expect(sanitizeForTts("Hello … world")).toBe("Hello world");
  });

  it('collapses repeated ! and ?: "Hi!!! How are you???" → single punct, trailing stripped', () => {
    const result = sanitizeForTts("Hi!!! How are you???");
    // !!!→! preserved mid-sentence; ???→? then stripped at end
    expect(result).toBe("Hi! How are you");
  });

  it('strips trailing period from Vietnamese: "Chào bạn." → "Chào bạn"', () => {
    expect(sanitizeForTts("Chào bạn.")).toBe("Chào bạn");
  });

  it("preserves Vietnamese diacritics", () => {
    const result = sanitizeForTts("Tôi yêu Việt Nam");
    expect(result).toBe("Tôi yêu Việt Nam");
  });

  it('handles ellipsis char: "Loading…" → "Loading"', () => {
    expect(sanitizeForTts("Loading…")).toBe("Loading");
  });

  it('removes standalone dot token: "hello . world" → "hello world"', () => {
    expect(sanitizeForTts("hello . world")).toBe("hello world");
  });

  it('handles multiple trailing dots via collapse: "word..." → "word"', () => {
    expect(sanitizeForTts("word...")).toBe("word");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeForTts("")).toBe("");
  });
});
