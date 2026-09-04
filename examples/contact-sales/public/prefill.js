const form = document.querySelector("form");
const selector = document.getElementById("scenario");
const summary = document.getElementById("scenario-summary");
let scenarios = [];

function clearForm() {
  form.reset();
  selector.value = "";
  summary.textContent = "";
}
document.getElementById("clear-form").addEventListener("click", clearForm);
selector.addEventListener("change", () => {
  const scenario = scenarios[Number(selector.value)];
  if (selector.value === "" || !scenario) {
    clearForm();
    return;
  }
  // Reset first so optional fields from the previous scenario cannot linger.
  form.reset();
  for (const [name, value] of Object.entries(scenario.input)) {
    const field = form.elements.namedItem(name);
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    ) {
      field.value = String(value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  summary.textContent = `Expected: ${scenario.expected.outcome === "assigned" ? "Cal.com booking" : "success page"} · ${scenario.expected.route}. You can edit the fields before submitting.`;
});

async function loadScenarios() {
  try {
    const response = await fetch("/demo-scenarios");
    if (!response.ok) throw new Error("Could not load scenarios");
    scenarios = await response.json();
    selector.replaceChildren(new Option("Choose a scenario…", ""));
    scenarios.forEach((scenario, index) => selector.add(new Option(scenario.name, String(index))));
    selector.disabled = false;
  } catch {
    selector.replaceChildren(new Option("Scenarios unavailable", ""));
    summary.textContent = "You can still fill in the form manually. Reload to retry.";
  }
}
loadScenarios();
