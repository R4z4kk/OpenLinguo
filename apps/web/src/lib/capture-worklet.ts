/** Audio worklet scope: these globals are not in lib.dom. */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const registerProcessor: (
  name: string,
  processor: new () => AudioWorkletProcessor & { process: (inputs: Float32Array[][]) => boolean },
) => void;

/** Copies each block of the microphone's first channel to the page; outputs silence. */
class Capture extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0] ?? null;
    if (channel !== null && channel.length > 0) this.port.postMessage(channel.slice());
    return true;
  }
}

registerProcessor("capture", Capture);
