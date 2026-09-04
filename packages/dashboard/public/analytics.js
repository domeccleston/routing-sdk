const $ = (id) => document.getElementById(id);
let loading = false;
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function chart(id, groups, total) {
  const rows = groups.map(({ label, count }) => {
    const row = node("div", undefined, "analytics-bar");
    const heading = node("div", undefined, "pool-heading");
    heading.append(node("span", label), node("strong", count.toLocaleString()));
    const meter = node("meter");
    meter.min = 0;
    meter.max = Math.max(total, 1);
    meter.value = count;
    meter.setAttribute("aria-label", `${label}: ${count} of ${total} leads`);
    row.append(heading, meter);
    return row;
  });
  $(id).replaceChildren(...(total ? rows : [node("p", "No data yet", "pool-note")]));
}
function table(id, rows, columns) {
  $(id).replaceChildren(
    ...(rows.length
      ? rows.map((values) => {
          const row = node("tr");
          row.append(...values.map((value) => node("td", value)));
          return row;
        })
      : (() => {
          const row = node("tr");
          const cell = node("td", "No data yet");
          cell.colSpan = columns;
          row.append(cell);
          return [row];
        })()),
  );
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  try {
    const response = await fetch("/admin/api/analytics", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load analytics. Try again.");
    const data = await response.json();
    for (const key of ["leads", "assigned", "enriched"])
      $(key).textContent = data[key].toLocaleString();
    $("submission-counts").textContent =
      `${data.submissions.total} recorded submission attempts · ${data.submissions.failed} failed · ${data.submissions.pending} pending · ${data.unassigned} unassigned leads`;
    for (const key of ["sizes", "industries", "countries"]) chart(key, data[key], data.leads);
    table(
      "reps",
      data.reps.map((rep) => [
        rep.name,
        rep.assigned,
        data.assigned ? `${Math.round((rep.assigned / data.assigned) * 100)}%` : "—",
        rep.roundRobin,
        rep.direct,
        "Not tracked",
      ]),
      6,
    );
    table(
      "companies",
      data.companies.map((company) => [
        `${company.name} (${company.domain})`,
        company.employeeCount ?? "Unknown",
        company.industry,
        company.country,
        company.leads,
        company.assigned,
      ]),
      6,
    );
    $("empty").hidden = data.leads > 0;
    $("analytics").hidden = false;
    $("error").hidden = true;
  } catch (error) {
    $("error").textContent = `${error.message} Any displayed figures may be out of date.`;
    $("error").hidden = false;
  } finally {
    $("loading").hidden = true;
    loading = false;
    $("refresh").disabled = false;
  }
}
$("refresh").onclick = refresh;
refresh();
setInterval(refresh, 30000);
