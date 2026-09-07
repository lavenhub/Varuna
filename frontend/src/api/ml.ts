import { classifyImage } from "@/lib/oily/api.functions";
import type { MLPrediction } from "@/lib/oily/types";

/**
 * ML detection service. Wraps the real Varuna SAR segmenter behind a single
 * typed call. `dataUrl` is a FileReader data: URL; only the base64 payload is
 * forwarded to the backend. The staged "analysis progress" UI is a presentation
 * concern handled by the detect page — the model output itself comes from here.
 */
export const mlApi = {
  async classify(file: { name: string; size: number }, dataUrl: string): Promise<MLPrediction> {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return classifyImage({ data: { fileName: file.name, fileDataBase64: base64 } });
  },
  modelVersion: "varuna-cnn-v1",
};
