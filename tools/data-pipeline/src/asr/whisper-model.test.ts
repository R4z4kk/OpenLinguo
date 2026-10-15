import { describe, expect, it } from "vitest";
import { assetName, gitBlobSha1, modelFiles, SHARED_FILES } from "./whisper-model.ts";

describe("modelFiles", () => {
  it("lists the shared files, then each ONNX file once with the backends loading it", () => {
    const files = modelFiles({
      webgpu: { encoder_model: "fp16", decoder_model_merged: "q4" },
      wasm: { encoder_model: "q8", decoder_model_merged: "q4" },
    });
    expect(files.slice(0, SHARED_FILES.length)).toEqual(
      SHARED_FILES.map((path) => ({ path, backends: null })),
    );
    expect(files.slice(SHARED_FILES.length)).toEqual([
      { path: "onnx/encoder_model_fp16.onnx", backends: ["webgpu"] },
      { path: "onnx/decoder_model_merged_q4.onnx", backends: ["webgpu", "wasm"] },
      { path: "onnx/encoder_model_quantized.onnx", backends: ["wasm"] },
    ]);
  });
});

describe("gitBlobSha1", () => {
  it("computes git's object id (git hash-object)", () => {
    expect(gitBlobSha1(new TextEncoder().encode("hello\n"))).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });
});

describe("assetName", () => {
  it("keeps the base name", () => {
    expect(assetName("onnx/encoder_model_quantized.onnx")).toBe("encoder_model_quantized.onnx");
    expect(assetName("config.json")).toBe("config.json");
  });
});
