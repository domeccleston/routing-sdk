import { workflowPanel, workflowLabel } from "./workflow-panel.js";

const $ = (id) => document.getElementById(id);
let csrfToken = "",
  actionPending = false;
let offset = 0,
  selected = null,
  loading = false;
const emptyDetail = $("detail").cloneNode(true);
function clearDetail() {
  selected = null;
  $("detail").replaceChildren(...Array.from(emptyDetail.cloneNode(true).childNodes));
}
const limit = 25;
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function outcome(record) {
  return record.status === "completed" ? (record.decision?.outcome ?? "completed") : record.status;
}
function badge(record) {
  const value = outcome(record);
  return node("span", value.replaceAll("_", " "), `badge ${value}`);
}
function label(record) {
  return String(record.input.companyName ?? record.input.company ?? record.id.slice(0, 8));
}
function section(title, value) {
  const part = node("section");
  part.append(node("h3", title, "section-title"), node("pre", JSON.stringify(value, null, 2)));
  return part;
}
function show(record) {
  const detail = $("detail");
  detail.replaceChildren();
  const heading = node("div", undefined, "detail-heading");
  heading.append(node("h2", label(record)), badge(record));
  detail.append(heading, node("p", record.id, "detail-meta"));
  const data = node("dl");
  for (const [key, value] of Object.entries({
    Received: new Date(record.receivedAt).toLocaleString(),
    Duration: record.durationMs === null ? "In progress" : `${record.durationMs} ms`,
    Rule: record.decision?.ruleId ?? record.decision?.route ?? "—",
    Pool: record.decision?.poolId ?? "—",
    Person: record.decision?.personId ?? record.decision?.target?.repId ?? "—",
    Configuration: record.configVersion.slice(0, 12),
  }))
    data.append(node("dt", key), node("dd", value));
  detail.append(data);
  detail.append(
    workflowPanel(record.workflow, {
      token: csrfToken,
      onChanged: refresh,
      onBusy: (busy) => {
        actionPending = busy;
      },
    }),
  );
  if (record.decision?.redirectUrl || record.decision?.target) {
    detail.append(node("h3", "Destination", "section-title"));
    const url = record.decision.redirectUrl ?? record.decision.target.url;
    if (
      typeof url === "string" &&
      ((url.startsWith("/") && !url.startsWith("//")) || url.startsWith("https://"))
    ) {
      const a = node("a", url);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      detail.append(a);
    }
  }
  detail.append(section("Submitted fields", record.input));
  if (record.error) detail.append(section("Failure", record.error));
  if (record.decision) {
    detail.append(
      section("Provider facts", record.decision.facts),
      node("h3", "Rule trace", "section-title"),
    );
    for (const step of record.decision.trace) {
      const item = node("div", undefined, "trace-item");
      item.append(
        node("b", `${step.matched ? "✓" : "–"} ${step.rule}`),
        node(
          "span",
          `${step.condition.field} ${step.condition.operator} ${JSON.stringify(step.condition.value)} · actual: ${JSON.stringify(step.actual ?? null)}`,
        ),
      );
      detail.append(item);
    }
    if (record.decision.reason) detail.append(section("Reason", record.decision.reason));
    if (record.decision.warnings.length)
      detail.append(section("Warnings", record.decision.warnings));
  }
}
async function refresh() {
  // Polling must not replace a note or steal focus while the user reviews a proposal.
  if (loading || actionPending || $("detail").contains(document.activeElement)) return;
  loading = true;
  try {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      status: $("status").value,
    });
    const response = await fetch(`/admin/api/submissions?${query}`, { cache: "no-store" });
    if (!response.ok)
      throw new Error("Unable to load submissions. Check the local server and try again.");
    const { records, total, csrfToken: token } = await response.json();
    csrfToken = token;
    $("error").hidden = true;
    $("total").textContent = total;
    $("routed").textContent = records.filter((r) =>
      ["assigned", "routed"].includes(outcome(r)),
    ).length;
    $("unrouted").textContent = records.filter((r) =>
      ["unassigned", "not_routed", "unresolved"].includes(outcome(r)),
    ).length;
    $("failed").textContent = records.filter((r) => r.status === "failed").length;
    $("rows").replaceChildren();
    $("empty").hidden = records.length > 0;
    for (const record of records) {
      const row = node("tr");
      if (record.id === selected) row.className = "selected";
      const company = node("td");
      const button = node("button", label(record), "row-button");
      button.onclick = () => {
        selected = record.id;
        show(record);
        document.querySelectorAll("tbody tr").forEach((r) => r.classList.remove("selected"));
        row.className = "selected";
      };
      company.append(button, node("small", record.id.slice(0, 8)));
      const decision = node("td");
      decision.append(
        badge(record),
        node("small", record.decision?.ruleId ?? record.decision?.route ?? "—"),
      );
      decision.append(
        node(
          "small",
          workflowLabel(record.workflow),
          record.workflow?.status === "awaiting_approval" ? "needs-review" : "",
        ),
      );
      row.append(
        company,
        decision,
        node(
          "td",
          new Date(record.receivedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
      );
      $("rows").append(row);
    }
    const current = records.find((r) => r.id === selected);
    if (current && !actionPending && !$("detail").contains(document.activeElement)) show(current);
    $("previous").disabled = offset === 0;
    $("next").disabled = offset + limit >= total;
    $("page").textContent = total
      ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`
      : "0 submissions";
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    loading = false;
  }
}
$("status").onchange = () => {
  offset = 0;
  clearDetail();
  refresh();
};
$("refresh").onclick = refresh;
$("previous").onclick = () => {
  offset = Math.max(0, offset - limit);
  clearDetail();
  refresh();
};
$("next").onclick = () => {
  offset += limit;
  clearDetail();
  refresh();
};
refresh();
setInterval(refresh, 5000);
