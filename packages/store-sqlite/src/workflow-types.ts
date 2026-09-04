import type { AssignmentResult, AssignmentStore } from "@open-routing/core";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type WorkflowStage = string;
export type WorkflowStatus = "pending" | "running" | "awaiting_approval" | "completed" | "failed";

export interface WorkflowStart {
  definition: string;
  initialStage: string;
}
export interface WorkflowStepResult {
  output: JsonValue;
  transition: { type: "next" | "wait"; stage: string } | { type: "complete" };
}

export interface WorkflowRecord {
  id: string;
  definition: string;
  assignment: AssignmentResult;
  /** Explicitly supplied, persisted verbatim; never automatically copies raw form input. */
  context: JsonValue;
  stage: WorkflowStage;
  status: WorkflowStatus;
  outputs: Record<string, JsonValue>;
  resumeAt: string | null;
  resolution: JsonValue;
  attempts: number;
  availableAt: number;
  leaseUntil: number | null;
  claimToken: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStore {
  /** Use this store in a router to atomically enqueue research with its assignment. */
  assignmentStore(context: JsonValue, start: WorkflowStart): AssignmentStore;
  get(id: string): WorkflowRecord | null;
  list(options?: { status?: WorkflowStatus; limit?: number; offset?: number }): WorkflowRecord[];
  claim(options?: {
    leaseMs?: number;
    maxAttempts?: number;
    definition?: string;
  }): WorkflowRecord | null;
  renew(id: string, claimToken: string, leaseMs: number): void;
  complete(id: string, claimToken: string, result: WorkflowStepResult): void;
  fail(
    id: string,
    claimToken: string,
    error: string,
    options?: { maxAttempts?: number; retryDelayMs?: number },
  ): void;
  resolve(id: string, resolution: JsonValue): void;
  retry(id: string): void;
}

export interface WorkflowHandlerContext {
  workflow: WorkflowRecord;
  signal: AbortSignal;
  /** Stable across retries of this stage; pass to external services where supported. */
  idempotencyKey: string;
}

export interface WorkflowDefinition {
  id: string;
  steps: Record<string, (context: WorkflowHandlerContext) => Promise<WorkflowStepResult>>;
}
