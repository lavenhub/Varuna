import { createServerFn } from "@tanstack/react-start";
import { apiGet, apiPost } from "./client";
import type { ChatResponseModel, ResponsePlanModel } from "./types";

/** Response service — deterministic rule-based plan (source of truth) + a
 * chatbot that only *explains* that plan, grounded in real values. */

const generatePlanFn = createServerFn({ method: "POST" })
  .inputValidator((data: { incidentId: string }) => data)
  .handler(async ({ data }) => apiPost<ResponsePlanModel>("/api/response/generate", data));

const chatFn = createServerFn({ method: "POST" })
  .inputValidator((data: { incidentId: string; question: string }) => data)
  .handler(async ({ data }) => apiPost<ChatResponseModel>("/api/response/chat", data));

const suggestedFn = createServerFn({ method: "GET" }).handler(async () =>
  apiGet<{ questions: string[] }>("/api/response/suggested-questions"),
);

export const responseApi = {
  generate: (incidentId: string) => generatePlanFn({ data: { incidentId } }),
  chat: (incidentId: string, question: string) => chatFn({ data: { incidentId, question } }),
  suggestedQuestions: () => suggestedFn(),
};
