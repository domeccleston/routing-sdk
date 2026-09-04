function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function workflowLabel(workflow) {
  if (!workflow) return "No research workflow";
  if (workflow.status === "awaiting_approval") return "Needs review";
  if (workflow.status === "completed")
    return workflow.context?.mode === "fixture"
      ? "Workflow complete · mock CRM"
      : "Workflow complete";
  return `${workflow.stage} · ${workflow.status}`.replaceAll("_", " ");
}

export function workflowPanel(workflow, { token, onChanged, onBusy }) {
  const fixture = workflow?.context?.mode === "fixture";
  const liveAttio = workflow?.context?.mode === "live-attio";
  const liveResearch = workflow?.context?.researchMode === "live";
  const panel = node("section", undefined, "workflow-panel");
  const heading = node("div", undefined, "detail-heading");
  heading.append(node("h3", "Research", "section-title"));
  panel.append(heading);
  if (!workflow) {
    panel.append(node("p", "No research workflow for this submission.", "muted"));
    return panel;
  }
  heading.append(node("span", workflowLabel(workflow), `badge ${workflow.status}`));
  if (fixture)
    panel.append(
      node(
        "p",
        liveResearch
          ? "Live research · notifications and CRM updates are simulated"
          : "Demo scenario · notifications and CRM updates are simulated",
        "pool-note",
      ),
    );
  if (liveAttio)
    panel.append(
      node(
        "p",
        liveResearch
          ? "Live Attio and research · notifications are simulated"
          : "Live Attio · research and notifications are simulated",
        "pool-note",
      ),
    );
  const crmUrl = workflow.outputs?.crm?.url;
  if (typeof crmUrl === "string") {
    try {
      const url = new URL(crmUrl);
      if (url.protocol === "https:" && url.hostname === "app.attio.com") {
        const link = node("a", "Open company in Attio ↗");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        panel.append(link);
      }
    } catch {
      /* Ignore invalid provider URLs. */
    }
  }
  if (workflow.research) {
    const brief = fixture
      ? workflow.research.brief.replace(/^Fixture research for /, "Demo scenario for ")
      : workflow.research.brief;
    panel.append(node("p", brief, "research-brief"));
    if (workflow.research.review) {
      panel.append(
        node("h4", `Routing review · ${workflow.research.review.status.replaceAll("-", " ")}`),
        node("p", workflow.research.review.reason),
      );
    }
    for (const finding of workflow.research.findings ?? []) {
      panel.append(node("p", finding.description));
    }
    if (workflow.research.session)
      panel.append(node("p", `Research session: ${workflow.research.session.id}`, "pool-note"));
    if (workflow.research.sources.length) {
      const sources = node("ul");
      for (const source of workflow.research.sources) {
        const item = node("li");
        try {
          const url = new URL(source);
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
          const link = node("a", source);
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          item.append(link);
          sources.append(item);
        } catch {
          /* Ignore invalid or unsafe source URLs. */
        }
      }
      panel.append(node("h4", "Sources"), sources);
    } else
      panel.append(
        node(
          "p",
          fixture ? "No external sources — demo scenario output." : "No sources provided.",
          "pool-note",
        ),
      );
    for (const change of workflow.research.proposedChanges) {
      const proposal = node("div", undefined, "workflow-proposal");
      proposal.append(
        node("strong", `${change.field} → ${JSON.stringify(change.value)}`),
        node("p", change.reason),
      );
      panel.append(proposal);
    }
  } else
    panel.append(
      node(
        "p",
        workflow.status === "failed"
          ? "Research did not complete."
          : "Research will appear here when ready.",
        "muted",
      ),
    );
  if (workflow.lastError) panel.append(node("p", workflow.lastError, "workflow-error"));
  if (workflow.resolution) {
    panel.append(
      node(
        "p",
        `${workflow.resolution.action === "accept-changes" ? "Changes accepted" : "Original assignment retained"} · ${workflow.resolution.actor}`,
        "pool-note",
      ),
    );
    panel.append(node("p", workflow.resolution.note));
  }
  const message = node("p", "", "workflow-feedback");
  message.setAttribute("role", "status");
  const controls = node("div", undefined, "workflow-actions");
  async function act(action, body) {
    onBusy(true);
    controls.querySelectorAll("button, textarea").forEach((element) => {
      element.disabled = true;
    });
    message.textContent = "Saving…";
    let succeeded = false;
    try {
      const response = await fetch(
        `/admin/api/workflows/${encodeURIComponent(workflow.id)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Admin-Token": token },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok)
        throw new Error("Unable to apply action. Refresh to check the current state, then retry.");
      succeeded = true;
      message.textContent = "Saved.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      onBusy(false);
      controls.querySelectorAll("button, textarea").forEach((element) => {
        element.disabled = false;
      });
    }
    if (succeeded) {
      document.activeElement?.blur();
      await onChanged();
    }
  }
  if (workflow.status === "awaiting_approval") {
    const label = node("label", "Review note");
    const note = node("textarea");
    note.rows = 2;
    note.maxLength = 2000;
    note.required = true;
    label.append(note);
    controls.append(label);
    const actions = workflow.research?.proposedChanges.length
      ? [
          ["Accept changes", "accept-changes"],
          ["Keep original", "keep-initial"],
        ]
      : [["Reviewed — keep assignment", "keep-initial"]];
    for (const [text, action] of actions) {
      const button = node("button", text);
      button.type = "button";
      button.onclick = () => {
        if (!note.value.trim()) {
          note.reportValidity();
          message.textContent = "Add a review note first.";
          note.focus();
          return;
        }
        void act("resolve", { action, note: note.value.trim() });
      };
      controls.append(button);
    }
    panel.append(
      node(
        "p",
        fixture
          ? "Approval affects only the mock CRM outcome. It does not change the calendar or booked host."
          : "Approval releases the CRM stage. It does not change the calendar or booked host.",
        "pool-note",
      ),
    );
  } else if (workflow.status === "failed") {
    const button = node("button", "Retry failed stage");
    button.type = "button";
    button.onclick = () => {
      void act("retry", {});
    };
    controls.append(button);
  }
  panel.append(controls, message);
  return panel;
}
