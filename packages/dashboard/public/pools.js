const $ = (id) => document.getElementById(id);
let loading = false;
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function card(pool) {
  const section = node("section", undefined, "pool-card");
  const heading = node("div", undefined, "pool-heading");
  heading.append(node("h2", pool.name), node("span", "Round-robin", "tag"));
  section.append(heading, node("p", pool.poolId, "detail-meta"));
  const byId = new Map(pool.members.map((person) => [person.id, person]));
  const personName = (id) => byId.get(id)?.name ?? id;
  const next = node("div", undefined, "pool-next");
  next.append(
    node("span", "Next up"),
    node("strong", pool.nextPersonId ? personName(pool.nextPersonId) : "No active members"),
  );
  section.append(next);
  const last = pool.lastAssignedPersonId
    ? personName(pool.lastAssignedPersonId)
    : "No assignments yet";
  section.append(node("p", `Last assigned: ${last}`, "pool-note"));
  if (pool.nextPersonId) {
    section.append(node("h3", "Upcoming order", "section-title"));
    const start = pool.eligiblePersonIds.indexOf(pool.nextPersonId);
    const order = [
      ...pool.eligiblePersonIds.slice(start),
      ...pool.eligiblePersonIds.slice(0, start),
    ];
    const list = node("ol", undefined, "pool-order");
    for (const [index, id] of order.entries()) {
      const item = node("li");
      item.append(node("span", personName(id)));
      if (index === 0) item.append(node("span", "Next", "badge assigned"));
      list.append(item);
    }
    section.append(list);
  }
  const inactive = pool.members.filter((person) => !person.active);
  if (inactive.length)
    section.append(
      node("p", `Inactive: ${inactive.map((person) => person.name).join(", ")}`, "pool-note"),
    );
  return section;
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  try {
    const response = await fetch("/admin/api/pools", { cache: "no-store" });
    if (!response.ok)
      throw new Error("Unable to load pools. Check the local server and try again.");
    const { pools } = await response.json();
    $("pools").replaceChildren(...pools.map(card));
    $("empty").hidden = pools.length > 0;
    $("error").hidden = true;
  } catch (error) {
    $("error").textContent = `${error.message} Any displayed rotation may be out of date.`;
    $("error").hidden = false;
  } finally {
    $("loading").hidden = true;
    $("refresh").disabled = false;
    loading = false;
  }
}
$("refresh").onclick = refresh;
refresh();
setInterval(refresh, 5000);
