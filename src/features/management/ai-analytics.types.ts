export type AiStage = "sms" | "assistant_analyze" | "assistant_plan" | "assistant_report";
export type AiTotals = {
  requests: number; successes: number; failures: number;
  input_tokens: number | null; output_tokens: number | null;
  input_token_requests: number; output_token_requests: number;
};
export type AiReport = {
  days: 7 | 30 | 90; start_at: string; checked_at: string; available: boolean;
  first_counter: string | null; totals: AiTotals | null;
  stages: (AiTotals & { stage: AiStage })[] | null;
};
