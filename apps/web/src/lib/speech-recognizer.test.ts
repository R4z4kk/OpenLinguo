import { err, ok, type Result } from "@openlinguo/core";
import { describe, expect, it, vi } from "vitest";
import type { SpeechModelIndex } from "@/data/format";
import { shareRecognizer, type Recognizer, type RecognizerError } from "./speech-recognizer.ts";

const index = (release: string): SpeechModelIndex => ({
  release,
  model: "m/model.int8.onnx",
  tokens: "m/tokens.txt",
  runtime: "sherpa-onnx/sherpa-onnx-asr.wasm",
  files: [],
});

const setup = (texts: Result<string, RecognizerError>[]) => {
  const recognizers: Recognizer[] = [];
  const start = vi.fn(() => {
    const recognizer: Recognizer = {
      transcribe: () => Promise.resolve(texts.shift() ?? ok("")),
      close: vi.fn(),
    };
    recognizers.push(recognizer);
    return Promise.resolve(ok(recognizer));
  });
  return { shared: shareRecognizer(start), start, recognizers };
};

const samples = new Float32Array(160);

describe("shareRecognizer", () => {
  it("starts once when the page opens, then serves every transcript", async () => {
    const { shared, start } = setup([ok("你好"), ok("谢谢")]);
    shared.warm(index("paraformer-1"));
    shared.warm(index("paraformer-1"));
    expect(await shared.transcribe(index("paraformer-1"), samples, 16_000)).toEqual(ok("你好"));
    expect(await shared.transcribe(index("paraformer-1"), samples, 16_000)).toEqual(ok("谢谢"));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("stops after a failure, and starts again on the next use", async () => {
    const failed = err({ kind: "failed" as const, message: "abort" });
    const { shared, start, recognizers } = setup([failed, ok("你好")]);
    expect(await shared.transcribe(index("paraformer-1"), samples, 16_000)).toEqual(failed);
    await Promise.resolve();
    expect(recognizers[0]?.close).toHaveBeenCalled();
    expect(await shared.transcribe(index("paraformer-1"), samples, 16_000)).toEqual(ok("你好"));
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("replaces the recognizer of an older release", async () => {
    const { shared, start, recognizers } = setup([]);
    shared.warm(index("paraformer-1"));
    shared.warm(index("paraformer-2"));
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(2);
    expect(recognizers[0]?.close).toHaveBeenCalled();
    expect(recognizers[1]?.close).not.toHaveBeenCalled();
  });

  it("reports a start that failed, then tries again", async () => {
    const start = vi.fn((): Promise<Result<Recognizer, RecognizerError>> =>
      Promise.resolve(err({ kind: "missing" })),
    );
    const shared = shareRecognizer(start);
    shared.warm(index("paraformer-1"));
    expect(await shared.transcribe(index("paraformer-1"), samples, 16_000)).toEqual(
      err({ kind: "missing" }),
    );
    await shared.transcribe(index("paraformer-1"), samples, 16_000);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
