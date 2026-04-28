import { describe, expect, test } from "bun:test";
import { applySilentInputChunk } from "./prompt";

describe("applySilentInputChunk", () => {
  test("handles a full pasted password chunk ending in newline", () => {
    const result = applySilentInputChunk("VaultPass123!\n", "");

    expect(result).toEqual({
      input: "VaultPass123!",
      done: true,
      interrupt: false,
    });
  });

  test("stops on ctrl-c within a chunk", () => {
    const result = applySilentInputChunk("abcrest", "");

    expect(result).toEqual({
      input: "abc",
      done: false,
      interrupt: true,
    });
  });

  test("treats CR (\\r) the same as LF — done at first newline-style byte", () => {
    expect(applySilentInputChunk("hello\r", "")).toEqual({
      input: "hello",
      done: true,
      interrupt: false,
    });
  });

  test("appends a partial chunk to the existing buffer when neither done nor interrupt fires", () => {
    expect(applySilentInputChunk("def", "abc")).toEqual({
      input: "abcdef",
      done: false,
      interrupt: false,
    });
  });

  test("backspace (DEL, 0x7F) trims the last character of the running buffer", () => {
    expect(applySilentInputChunk("", "abc")).toEqual({
      input: "ab",
      done: false,
      interrupt: false,
    });
  });

  test("backspace (BS, 0x08) trims the last character of the running buffer", () => {
    expect(applySilentInputChunk("\b", "abc")).toEqual({
      input: "ab",
      done: false,
      interrupt: false,
    });
  });

  test("empty chunk leaves the buffer unchanged and reports not-done", () => {
    expect(applySilentInputChunk("", "wat")).toEqual({
      input: "wat",
      done: false,
      interrupt: false,
    });
  });

  test("interleaved backspaces inside a chunk apply in order", () => {
    expect(applySilentInputChunk("abc\b\bd", "")).toEqual({
      input: "ad",
      done: false,
      interrupt: false,
    });
  });

  test("ignores chunk content after newline (subsequent bytes belong to next read)", () => {
    expect(applySilentInputChunk("foo\nbar", "")).toEqual({
      input: "foo",
      done: true,
      interrupt: false,
    });
  });
});
