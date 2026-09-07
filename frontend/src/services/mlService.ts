import { classifyImage } from "@/lib/oily/api.functions";
import type { MLPrediction } from "@/lib/oily/types";

/**
 * ML service abstraction.
 *
 * The UI never knows this crosses a process boundary — it just gets a
 * MLPrediction back. `dataUrl` is the uploaded SAR image's data: URL (as
 * produced by FileReader.readAsDataURL), forwarded as raw bytes to the
 * Varuna detection service (see api.functions.ts / MODEL_INTEGRATION_PLAN.md).
 */
export async function classifySpillImage(
  file: { name: string; size: number },
  dataUrl: string,
): Promise<MLPrediction> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const result = await classifyImage({
    data: { fileName: file.name, fileDataBase64: base64 },
  });
  return result satisfies MLPrediction;
}
