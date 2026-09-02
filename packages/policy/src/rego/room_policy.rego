# Secure Agent Room outbound event policy — OPA mirror of the built-in
# TypeScript PDP (packages/policy/src/index.ts).
#
# The gateway (PEP) can POST the same PolicyInput document to an OPA sidecar
# evaluating this module instead of using the built-in engine. Keep the two in
# sync; the security regression suite exercises the built-in engine.

package booth.room

import rego.v1

default decision := {"result": "deny", "rule": "default", "reason": "deny by default"}

hard_deny_categories := {"credential", "private_key", "api_key", "authentication_token"}

# --- Hard platform floors ---

decision := {"result": "deny", "rule": "platform.secret_disclosure", "reason": "secret material detected"} if {
	input.event.secretFindings > 0
}

decision := {"result": "deny", "rule": "platform.hard_deny_category", "reason": "hard-denied data category"} if {
	input.event.secretFindings == 0
	some c in input.event.categories
	hard_deny_categories[c]
}

decision := {"result": "deny", "rule": "platform.room_not_active", "reason": "room not active"} if {
	input.event.secretFindings == 0
	not hard_denied
	not input.room.state in {"ACTIVE", "COMPLETION_PROPOSED"}
}

hard_denied if {
	some c in input.event.categories
	hard_deny_categories[c]
}

# --- Allow path (all checks pass) ---

decision := {"result": "allow"} if {
	input.event.secretFindings == 0
	not hard_denied
	input.room.state in {"ACTIVE", "COMPLETION_PROPOSED"}
	event_type_allowed
	not contract_forbidden
	not action_needs_approval
	action_permitted
	data_classes_allowed
	sensitivity_ok
}

event_type_allowed if {
	input.event.type in data.participant_policy.allowedEventTypes
}

contract_forbidden if {
	some c in input.event.categories
	c in data.contract.forbiddenDataClasses
}

action_needs_approval if {
	input.event.type == "action_proposal"
	input.event.action in data.contract.approvalRequiredActions
}

action_permitted if {
	input.event.type != "action_proposal"
}

action_permitted if {
	input.event.type == "action_proposal"
	input.event.action in data.contract.permittedActions
	input.event.action in data.participant_policy.autonomousActions
}

data_classes_allowed if {
	every c in input.event.categories {
		data_class_ok(c)
	}
}

data_class_ok("general")

data_class_ok(c) if {
	data.participant_policy.dataClassRules[c] == "ALLOW"
}

sensitivity_rank := {"PUBLIC": 0, "INTERNAL": 1, "CONFIDENTIAL": 2, "RESTRICTED": 3, "SECRET": 4}

sensitivity_ok if {
	sensitivity_rank[input.event.sensitivity] <= sensitivity_rank[data.participant_policy.maxAutoSensitivity]
}
