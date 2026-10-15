// The speech worker's entry points: the recognizer configuration is filled here, so the TypeScript
// side passes only paths and samples, whatever the C structs' layout in this sherpa-onnx release.
#include <stdlib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

const SherpaOnnxOfflineRecognizer *OpenLinguoCreateRecognizer(const char *model,
                                                              const char *tokens) {
  SherpaOnnxOfflineRecognizerConfig config;
  memset(&config, 0, sizeof(config));
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.paraformer.model = model;
  config.model_config.tokens = tokens;
  config.model_config.num_threads = 1;
  config.model_config.provider = "cpu";
  config.decoding_method = "greedy_search";
  return SherpaOnnxCreateOfflineRecognizer(&config);
}

/** The transcript of 16 kHz mono samples, to release with `free`; NULL on failure. */
char *OpenLinguoTranscribe(const SherpaOnnxOfflineRecognizer *recognizer, const float *samples,
                           int32_t count) {
  const SherpaOnnxOfflineStream *stream = SherpaOnnxCreateOfflineStream(recognizer);
  if (stream == NULL) return NULL;
  SherpaOnnxAcceptWaveformOffline(stream, 16000, samples, count);
  SherpaOnnxDecodeOfflineStream(recognizer, stream);
  const SherpaOnnxOfflineRecognizerResult *result = SherpaOnnxGetOfflineStreamResult(stream);
  char *text = result == NULL || result->text == NULL ? NULL : strdup(result->text);
  if (result != NULL) SherpaOnnxDestroyOfflineRecognizerResult(result);
  SherpaOnnxDestroyOfflineStream(stream);
  return text;
}
