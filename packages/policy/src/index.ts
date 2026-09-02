import {
  HARD_DENY_CATEGORIES,
  sensitivityRank,
  type ParticipantPolicy,
  type PolicyDecision,
  type PolicyInput,
  type TaskContract,
} from "@booth/shared";

/**
 * Policy Decision Point (PDP) interface.
 *
 * The built-in engine is a deterministic TypeScript implementation with the
 * same input document shape OPA would receive, so an OPA sidecar (see
 * ./rego/room_policy.rego) can replace it behind this interface without
 * touching the enforcement point.
 */
export interface PolicyEngine {
  evaluate(
    input: PolicyInput,
    participantPolicy: ParticipantPolicy,
    contract: TaskContract,
  ): PolicyDecision;
}

function deny(rule: string, reason: string): PolicyDecision {
  return { result: "deny", rule, reason };
}
function requireApproval(rule: string, reason: string): PolicyDecision {
  return { result: "require_approval", rule, reason };
}

/**
 * Deny-by-default policy engine.
 *
 * Order matters: hard platform floors run first and cannot be overridden by
 * any configured policy, contract, or agent output.
 */
export class BuiltinPolicyEngine implements PolicyEngine {
  evaluate(
    input: PolicyInput,
    policy: ParticipantPolicy,
    contract: TaskContract,
  ): PolicyDecision {
    const ev = input.event;

    // ---- Hard platform floors (non-configurable) ----

    // 1. Secret material never crosses the boundary.
    if (ev.secretFindings > 0) {
      return deny(
        "platform.secret_disclosure",
        "Detected secret material (credential/key/token). Secrets may never leave the organization boundary.",
      );
    }
    for (const c of ev.categories) {
      if (HARD_DENY_CATEGORIES.has(c)) {
        return deny(
          "platform.hard_deny_category",
          `Data category "${c}" may never be disclosed to a remote organization.`,
        );
      }
    }

    // 2. Only an active room routes events.
    if (input.room.state !== "ACTIVE" && input.room.state !== "COMPLETION_PROPOSED") {
      return deny("platform.room_not_active", `Room is ${input.room.state}; events may not be routed.`);
    }

    // ---- Contract-level rules (agreed by both organizations) ----

    if (contract.forbiddenDataClasses.some((c) => ev.categories.includes(c))) {
      const hit = contract.forbiddenDataClasses.find((c) => ev.categories.includes(c));
      return deny("contract.forbidden_data_class", `Data class "${hit}" is forbidden by the task contract.`);
    }

    if (ev.type === "action_proposal") {
      const action = ev.action ?? "";
      if (contract.approvalRequiredActions.includes(action)) {
        return requireApproval("contract.approval_required_action", `Action "${action}" requires human approval.`);
      }
      if (!contract.permittedActions.includes(action)) {
        return deny("contract.action_not_permitted", `Action "${action}" is not permitted by the task contract.`);
      }
    }

    // ---- Participant-level rules (the sending organization's own policy) ----

    if (!policy.allowedEventTypes.includes(ev.type)) {
      return deny("participant.event_type", `Event type "${ev.type}" is not allowed by participant policy.`);
    }

    if (ev.type === "action_proposal") {
      const action = ev.action ?? "";
      if (policy.approvalRequiredActions.includes(action)) {
        return requireApproval("participant.approval_required_action", `Action "${action}" requires human approval.`);
      }
      if (!policy.autonomousActions.includes(action)) {
        return requireApproval(
          "participant.action_not_autonomous",
          `Action "${action}" is not on the autonomous allowlist; human approval required.`,
        );
      }
    }

    // Disclosure rules per data category. Missing rule => DENY (deny by default).
    let needsApproval: string | null = null;
    for (const c of ev.categories) {
      if (c === "general") continue;
      const rule = policy.dataClassRules[c];
      if (rule === "ALLOW") continue;
      if (rule === "REQUIRE_APPROVAL") {
        needsApproval = c;
        continue;
      }
      return deny("participant.data_class", `Data class "${c}" may not be disclosed under participant policy.`);
    }
    if (needsApproval) {
      return requireApproval("participant.data_class_approval", `Disclosure of "${needsApproval}" requires human approval.`);
    }

    // Sensitivity ceiling for autonomous disclosure.
    if (sensitivityRank(ev.sensitivity) > sensitivityRank(policy.maxAutoSensitivity)) {
      return requireApproval(
        "participant.sensitivity_ceiling",
        `Sensitivity ${ev.sensitivity} exceeds the autonomous ceiling (${policy.maxAutoSensitivity}).`,
      );
    }

    // Contract permitted classes: outbound disclosures must fit the contract scope.
    if (ev.type === "data_response" || ev.type === "evidence_submission") {
      const inScope = ev.categories.every(
        (c) => c === "general" || contract.permittedDataClasses.includes(c),
      );
      if (!inScope) {
        const hit = ev.categories.find((c) => c !== "general" && !contract.permittedDataClasses.includes(c));
        return deny("contract.data_class_out_of_scope", `Data class "${hit}" is outside the task contract scope.`);
      }
    }

    return { result: "allow" };
  }
}

/**
 * A helpful, bounded explanation the agent receives after a denial so it can
 * continue the task instead of deadlocking (spec §52). Contains no sensitive
 * detail — only the boundary and safe alternatives.
 */
export function denialGuidance(decision: Exclude<PolicyDecision, { result: "allow" }>): string {
  if (decision.rule === "platform.secret_disclosure" || decision.rule === "platform.hard_deny_category") {
    return (
      "The requested credential or secret cannot be disclosed. " +
      "Request the specific operation or non-secret metadata instead " +
      "(resource type, region, non-secret identifier, summarized configuration)."
    );
  }
  return (
    "The requested information or action is not permitted under current room policy. " +
    "Allowed alternatives: request permitted data classes, propose an approved action, " +
    "or ask a clarifying question within the task contract scope."
  );
}
