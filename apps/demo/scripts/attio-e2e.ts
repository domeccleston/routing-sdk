import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

// Explicit live integration runner. Keeps the labelled test company for inspection.
const apiKey = process.env.ATTIO_API_KEY;
const memberId = process.env.ATTIO_WORKSPACE_MEMBER_ID;
const domain = process.env.ATTIO_E2E_DOMAIN;
const base = process.env.ROUTING_BASE_URL ?? "http://localhost:3002";
assert(apiKey && memberId && domain, "Set the Attio key, member ID and test domain");
assert(
  /^routing-sdk-e2e-[a-z0-9-]+\.example\.com$/.test(domain),
  "Use a labelled subdomain of the reserved example.com domain",
);
const companyName = `Open Routing E2E — ${domain}`;
const key = `live-e2e:${domain}`;
async function queryCompany() {
  const response = await fetch("https://api.attio.com/v2/objects/companies/records/query", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filter: { domains: domain } }),
  });
  assert.equal(response.status, 200, "Attio company query");
  return (await response.json()).data;
}
const before = await queryCompany();
assert(
  before.length === 0 || (before.length === 1 && before[0].values.name?.[0]?.value === companyName),
  "Refusing to modify an unrelated company",
);
const form = new URLSearchParams({
  fullName: "Open Routing integration test",
  workEmail: `test@${domain}`,
  companyName,
  companySize: "501-1000",
  requestedSeats: "250",
  requestType: "sales",
  _researchScenario: "changes",
  _submissionId: key,
});
const post = () => fetch(`${base}/route`, { method: "POST", body: form, redirect: "manual" });
const submitted = await post();
assert.equal(submitted.status, 303, "Form submission should redirect immediately");
assert.equal(submitted.headers.get("location"), "https://cal.com/dom-eccleston/30min");
const page = await fetch(`${base}/admin/api/submissions`).then((response) => response.json());
const lead = page.records.find(
  (record: { input: { companyName?: string } }) => record.input.companyName === companyName,
);
assert(lead?.workflow, "Workflow persisted with the submission");
assert.equal(lead.workflow.context.mode, "live-attio", "Server must be in live Attio mode");
const id = lead.workflow.id;
async function waitFor(status: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const workflow = await fetch(`${base}/admin/api/workflows/${id}`).then((response) =>
      response.json(),
    );
    if (workflow.status === status) return workflow;
    assert.notEqual(
      workflow.status,
      "failed",
      `Workflow failed at ${workflow.stage}: ${workflow.lastError}`,
    );
    await delay(250);
  }
  throw new Error(`Workflow did not reach ${status}`);
}
if (lead.workflow.status !== "completed") {
  await waitFor("awaiting_approval");
  if (!before.length)
    assert.equal((await queryCompany()).length, 0, "No Attio write before approval");
  const response = await fetch(`${base}/admin/api/workflows/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": page.csrfToken, Origin: base },
    body: JSON.stringify({
      action: "accept-changes",
      note: "Approved labelled live Attio integration test; research is simulated.",
    }),
  });
  assert.equal(response.status, 200, "Approval accepted");
}
const completed = await waitFor("completed");
const records = await queryCompany();
assert.equal(records.length, 1, "Exactly one Attio company matches the test domain");
const record = records[0];
assert.equal(record.id.record_id, completed.outputs.crm.recordId);
assert.equal(record.values.account_owner?.[0]?.referenced_actor_id, memberId);
assert.equal(record.values.routing_qualification?.[0]?.value, "strong-fit");
assert.equal(record.values.routing_research?.[0]?.value, completed.research.brief);
assert.equal((await post()).status, 303);
const afterReplay = await fetch(`${base}/admin/api/workflows/${id}`).then((response) =>
  response.json(),
);
assert.deepEqual(afterReplay, completed, "Submission replay must not rerun the workflow");
assert.equal((await queryCompany()).length, 1);
console.log(
  JSON.stringify(
    {
      status: "passed",
      base,
      workflowId: id,
      attioRecordId: record.id.record_id,
      attioUrl: record.web_url ?? completed.outputs.crm.url,
      domain,
      ownerVerified: true,
      researchVerified: true,
      qualificationVerified: true,
      replayVerified: true,
    },
    null,
    2,
  ),
);
