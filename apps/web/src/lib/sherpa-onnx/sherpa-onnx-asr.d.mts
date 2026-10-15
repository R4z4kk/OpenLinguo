/** The exports of tools/sherpa-onnx's build (`EXPORTED_FUNCTIONS`, `EXPORTED_RUNTIME_METHODS`). */
export type SherpaOnnx = {
  readonly HEAPF32: Float32Array;
  readonly FS_createDataFile: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean,
  ) => void;
  readonly FS_unlink: (path: string) => void;
  readonly stringToNewUTF8: (text: string) => number;
  readonly UTF8ToString: (pointer: number) => string;
  readonly _malloc: (bytes: number) => number;
  readonly _free: (pointer: number) => void;
  /** 0 when the model or tokens cannot be read; the reason goes to `printErr`. */
  readonly _OpenLinguoCreateRecognizer: (model: number, tokens: number) => number;
  /** A string to `_free`, or 0. */
  readonly _OpenLinguoTranscribe: (recognizer: number, samples: number, count: number) => number;
};

export type SherpaOnnxOptions = {
  readonly wasmBinary: Uint8Array;
  readonly print: (text: string) => void;
  readonly printErr: (text: string) => void;
};

export default function createSherpaOnnx(options: SherpaOnnxOptions): Promise<SherpaOnnx>;
