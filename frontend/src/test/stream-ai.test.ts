import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { streamAI } from "../services/api";

function streamBody(parts: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function fetchReturning(res: Response) {
  const mock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("streamAI SSE parser", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("JSON-decodes chunk payloads and fires onDone on [DONE]", async () => {
    fetchReturning(streamBody([
      'data: "Hello"\n\n',
      'data: " world"\n\n',
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamAI("/t", {}, (c) => chunks.push(c), onDone, onError, vi.fn());

    expect(chunks).toEqual(["Hello", " world"]);
    expect(onDone).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("joins multi-line data: fields with newlines (SSE spec)", async () => {
    fetchReturning(streamBody([
      "data: line-a\ndata: line-b\n\n",
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    await streamAI("/t", {}, (c) => chunks.push(c), vi.fn(), vi.fn(), vi.fn());
    expect(chunks).toEqual(["line-a\nline-b"]);
  });

  it("routes event: error frames to onError and stops consuming", async () => {
    fetchReturning(streamBody([
      'data: "before"\n\n',
      'event: error\ndata: "stream_failed"\n\n',
      'data: "unreached"\n\n',
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    const onError = vi.fn();
    const onDone = vi.fn();

    await streamAI("/t", {}, (c) => chunks.push(c), onDone, onError, vi.fn());

    expect(chunks).toEqual(["before"]);
    expect(onError).toHaveBeenCalledWith("stream_failed");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("ignores SSE comment lines (keep-alive pings)", async () => {
    fetchReturning(streamBody([
      ": open\n\n",
      ": ping\n\n",
      'data: "hi"\n\n',
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    await streamAI("/t", {}, (c) => chunks.push(c), vi.fn(), vi.fn(), vi.fn());
    expect(chunks).toEqual(["hi"]);
  });

  it("tolerates CRLF line endings", async () => {
    fetchReturning(streamBody([
      'data: "hi"\r\n\r\n',
      "data: [DONE]\r\n\r\n",
    ]));

    const chunks: string[] = [];
    await streamAI("/t", {}, (c) => chunks.push(c), vi.fn(), vi.fn(), vi.fn());
    expect(chunks).toEqual(["hi"]);
  });

  it("surfaces non-200 responses via onError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("nope", { status: 500 }),
    ));

    const onError = vi.fn();
    await streamAI("/t", {}, vi.fn(), vi.fn(), onError, vi.fn());

    expect(onError).toHaveBeenCalledWith("Request failed: 500");
  });

  it("routes AbortError to onCancelled and skips onDone/onError", async () => {
    const err = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));

    const onDone = vi.fn();
    const onError = vi.fn();
    const onCancelled = vi.fn();

    await streamAI("/t", {}, vi.fn(), onDone, onError, onCancelled);

    expect(onCancelled).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
