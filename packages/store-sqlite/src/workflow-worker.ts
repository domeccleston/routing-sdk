import { setTimeout as delay } from "node:timers/promises";
import { positiveInteger } from "./workflow-store.js";
import type { WorkflowDefinition, WorkflowStore, WorkflowStepResult } from "./workflow-types.js";

/** One process can poll this worker; multiple processes may share the same local database. */
export function createWorkflowWorker(options: {
  store: WorkflowStore;
  definition: WorkflowDefinition;
  leaseMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}) {
  const { store, definition } = options;
  const leaseMs = positiveInteger(options.leaseMs ?? 60_000);
  const timeoutMs = positiveInteger(options.timeoutMs ?? 300_000);
  const maxAttempts = positiveInteger(options.maxAttempts ?? 3);
  const retryDelayMs = positiveInteger(options.retryDelayMs ?? 5_000);
  async function runOnce(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const workflow = store.claim({ leaseMs, maxAttempts, definition: definition.id });
    if (!workflow) return false;
    const token = workflow.claimToken!;
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error("Worker stopped"));
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Workflow stage timed out")),
      timeoutMs,
    );
    const heartbeat = setInterval(
      () => {
        try {
          store.renew(workflow.id, token, leaseMs);
        } catch {
          controller.abort(new Error("Workflow lease lost"));
        }
      },
      Math.max(1, Math.floor(leaseMs / 3)),
    );
    let abortListener: () => void = () => {};
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", abortListener, { once: true });
      });
      const handler = Object.hasOwn(definition.steps, workflow.stage)
        ? definition.steps[workflow.stage]
        : undefined;
      if (!handler) throw new Error("Unknown workflow step");
      const result = await Promise.race([
        Promise.resolve().then<WorkflowStepResult>(() =>
          handler({
            workflow,
            signal: controller.signal,
            idempotencyKey: `${workflow.id}:${workflow.stage}`,
          }),
        ),
        cancelled,
      ]);
      if (
        result.transition.type !== "complete" &&
        !Object.hasOwn(definition.steps, result.transition.stage)
      )
        throw new Error("Unknown next step");
      store.complete(workflow.id, token, result);
    } catch (error) {
      // Do not save arbitrary provider errors: they may contain credentials or form data.
      try {
        store.fail(
          workflow.id,
          token,
          controller.signal.aborted ? "Stage cancelled or timed out" : "Stage execution failed",
          { maxAttempts, retryDelayMs },
        );
      } catch {
        // A stale worker must never overwrite a newer claimant. Surface other store errors.
        const current = store.get(workflow.id);
        if (current?.claimToken === token && current.leaseUntil! > Date.now()) throw error;
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      signal?.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", abortListener);
    }
    return true;
  }
  return {
    runOnce,
    async run({ signal, pollMs = 1_000 }: { signal: AbortSignal; pollMs?: number }) {
      positiveInteger(pollMs);
      while (!signal.aborted) {
        if (!(await runOnce(signal))) {
          try {
            await delay(pollMs, undefined, { signal });
          } catch (error) {
            if (!signal.aborted) throw error;
          }
        }
      }
    },
  };
}
