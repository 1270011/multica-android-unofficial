/**
 * Display texts for the read-only Agents screens: status line
 * with colour, runtime label and "last run". Shared by More → Agents and the
 * agent detail so both say the same thing.
 */
import type { AgentTask } from "@multica/core/types";
import type { AgentStatus, agentRuntimeLabel } from "@/lib/agent-overview";
import { timeAgo } from "@/lib/time-ago";
import { useT } from "@/lib/i18n";

/** Status text + colour shared by the list and the detail. */
export function useAgentStatusText() {
  const { t } = useT("workspace");
  return (status: AgentStatus) => ({
    text:
      status.key === "working"
        ? t("agent.status.working", { count: status.running })
        : status.key === "queued"
          ? t("agent.status.queued", { count: status.queued })
          : t(`agent.status.${status.key}`),
    className:
      status.key === "working"
        ? "text-primary"
        : status.key === "online"
          ? "text-success"
          : status.key === "unstable" || status.key === "queued"
            ? "text-warning"
            : "text-muted-foreground",
  });
}

export function useRuntimeText() {
  const { t } = useT("workspace");
  return (label: ReturnType<typeof agentRuntimeLabel>) =>
    label.kind === "named"
      ? label.name
      : label.kind === "hidden"
        ? t("agent.runtime_hidden")
        : t("agent.runtime_none");
}

export function useLastRunText() {
  const { t } = useT("workspace");
  return (task: AgentTask | undefined) => {
    if (!task) return t("agent.last_run_none");
    const when = task.completed_at || task.started_at || task.created_at;
    return t("agent.last_run", {
      status: t(`issues:runs.status.${task.status}`),
      when: when ? timeAgo(when) : "",
    });
  };
}

