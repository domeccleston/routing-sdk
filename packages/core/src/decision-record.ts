import type { FormSchema } from "./schema.js";
import type { AssignmentResult } from "./router.js";

export interface SubmissionRecord {
  id: string;
  receivedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: "pending" | "completed" | "failed";
  configVersion: string;
  input: Record<string, unknown>;
  decision: AssignmentResult | null;
  error: { code: string; fields?: string[] } | null;
}

export interface DecisionStore {
  create(record: SubmissionRecord): void;
  complete(id: string, decision: AssignmentResult, durationMs: number): void;
  fail(id: string, error: NonNullable<SubmissionRecord["error"]>, durationMs: number): void;
  get(id: string): SubmissionRecord | null;
  list(options?: { status?: string; limit?: number; offset?: number }): {
    records: SubmissionRecord[];
    total: number;
  };
}

/** Persist only declared fields; never stringify arbitrary input or provider errors. */
export function redactSubmission(
  schema: FormSchema,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const value = input[key];
    if (value === undefined || field.privacy === "omit") continue;
    if (field.privacy === "mask" || (field.type === "email" && field.privacy !== "plain")) {
      result[key] = "[redacted]";
    } else if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      result[key] = value;
    }
  }
  return result;
}

export function redactDecision(schema: FormSchema, decision: AssignmentResult): AssignmentResult {
  const snapshot = decision;
  return {
    ...snapshot,
    trace: snapshot.trace.map((step) => {
      const field = step.condition.field.startsWith("input.")
        ? schema[step.condition.field.slice(6)]
        : undefined;
      return field &&
        (field.privacy === "omit" ||
          field.privacy === "mask" ||
          (field.type === "email" && field.privacy !== "plain"))
        ? { ...step, actual: "[redacted]", condition: { ...step.condition, value: "[redacted]" } }
        : step;
    }),
  };
}
