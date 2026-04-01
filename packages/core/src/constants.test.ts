import { describe, expect, test } from "bun:test";
import {
	AgentAccessRequestSchema,
	CreateCredentialSchema,
	CreateSessionSchema,
	GrantPermissionSchema,
	PolicyRuleSchema,
} from "./schemas";
import {
	ERROR_CODES,
	accessActions,
	accessOutcomes,
	approvalStatuses,
	connectorTypes,
	credentialTypes,
	deliveryModes,
	environments,
	ownerScopes,
	principalTypes,
	sensitivities,
	sessionStatuses,
	socialProviders,
	sourceTypes,
} from "./constants";

/**
 * Tests that all constant arrays and schema validation rules match the
 * expected product invariants. These act as regression guards against
 * accidental removal or mutation of security-critical enums.
 */

describe("deliveryModes", () => {
	test("includes all expected modes", () => {
		expect(deliveryModes).toContain("reveal");
		expect(deliveryModes).toContain("env_inject");
		expect(deliveryModes).toContain("file_mount");
		expect(deliveryModes).toContain("browser_fill");
		expect(deliveryModes).toContain("operation_only");
	});

	test("default delivery mode is env_inject, not reveal", () => {
		// The product invariant: default delivery mode is NOT reveal
		const result = AgentAccessRequestSchema.safeParse({
			credentialName: "test",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.deliveryMode).toBe("env_inject");
			expect(result.data.deliveryMode).not.toBe("reveal");
		}
	});
});

describe("credentialTypes", () => {
	test("includes all expected types", () => {
		const expected = [
			"api_key",
			"login",
			"token",
			"json_blob",
			"pii",
			"other",
			"oauth_client",
			"service_account_json",
			"cookie_session",
		];
		for (const t of expected) {
			expect(credentialTypes).toContain(t);
		}
	});

	test("has exactly the expected count", () => {
		expect(credentialTypes.length).toBe(9);
	});
});

describe("accessOutcomes", () => {
	test("includes all expected outcomes for audit trail", () => {
		expect(accessOutcomes).toContain("allowed");
		expect(accessOutcomes).toContain("denied");
		expect(accessOutcomes).toContain("pending_approval");
		expect(accessOutcomes).toContain("expired");
	});
});

describe("accessActions", () => {
	test("includes read and denied", () => {
		expect(accessActions).toContain("read");
		expect(accessActions).toContain("denied");
	});
});

describe("approvalStatuses", () => {
	test("includes full lifecycle", () => {
		expect(approvalStatuses).toContain("pending");
		expect(approvalStatuses).toContain("approved");
		expect(approvalStatuses).toContain("denied");
		expect(approvalStatuses).toContain("expired");
	});
});

describe("principalTypes", () => {
	test("includes human, app, agent, workload", () => {
		expect(principalTypes).toContain("human");
		expect(principalTypes).toContain("app");
		expect(principalTypes).toContain("agent");
		expect(principalTypes).toContain("workload");
	});
});

describe("sensitivities", () => {
	test("ordered low to critical", () => {
		expect(sensitivities[0]).toBe("low");
		expect(sensitivities[1]).toBe("medium");
		expect(sensitivities[2]).toBe("high");
		expect(sensitivities[3]).toBe("critical");
	});
});

describe("environments", () => {
	test("includes dev, staging, prod", () => {
		expect(environments).toContain("dev");
		expect(environments).toContain("staging");
		expect(environments).toContain("prod");
	});
});

describe("sourceTypes", () => {
	test("includes native and external", () => {
		expect(sourceTypes).toContain("native");
		expect(sourceTypes).toContain("external");
	});
});

describe("connectorTypes", () => {
	test("includes native and known vault providers", () => {
		expect(connectorTypes).toContain("native");
		expect(connectorTypes).toContain("onepassword");
		expect(connectorTypes).toContain("aws_secrets_manager");
		expect(connectorTypes).toContain("hashicorp_vault");
	});
});

describe("sessionStatuses", () => {
	test("includes full lifecycle", () => {
		expect(sessionStatuses).toContain("active");
		expect(sessionStatuses).toContain("expired");
		expect(sessionStatuses).toContain("revoked");
	});
});

describe("socialProviders", () => {
	test("includes github and google", () => {
		expect(socialProviders).toContain("github");
		expect(socialProviders).toContain("google");
	});
});

describe("ownerScopes", () => {
	test("includes user, org, system", () => {
		expect(ownerScopes).toContain("user");
		expect(ownerScopes).toContain("org");
		expect(ownerScopes).toContain("system");
	});
});

describe("ERROR_CODES", () => {
	test("includes all security-critical error codes", () => {
		expect(ERROR_CODES.UNAUTHORIZED).toBe("UNAUTHORIZED");
		expect(ERROR_CODES.ACCESS_DENIED).toBe("ACCESS_DENIED");
		expect(ERROR_CODES.INVALID_API_KEY).toBe("INVALID_API_KEY");
		expect(ERROR_CODES.POLICY_VIOLATION).toBe("POLICY_VIOLATION");
		expect(ERROR_CODES.APPROVAL_REQUIRED).toBe("APPROVAL_REQUIRED");
		expect(ERROR_CODES.SESSION_EXPIRED).toBe("SESSION_EXPIRED");
		expect(ERROR_CODES.SESSION_REVOKED).toBe("SESSION_REVOKED");
		expect(ERROR_CODES.DELIVERY_MODE_NOT_ALLOWED).toBe(
			"DELIVERY_MODE_NOT_ALLOWED",
		);
	});

	test("includes all resource error codes", () => {
		expect(ERROR_CODES.CREDENTIAL_NOT_FOUND).toBe("CREDENTIAL_NOT_FOUND");
		expect(ERROR_CODES.AGENT_NOT_FOUND).toBe("AGENT_NOT_FOUND");
		expect(ERROR_CODES.AGENT_INACTIVE).toBe("AGENT_INACTIVE");
		expect(ERROR_CODES.PERMISSION_NOT_FOUND).toBe("PERMISSION_NOT_FOUND");
		expect(ERROR_CODES.PERMISSION_EXISTS).toBe("PERMISSION_EXISTS");
		expect(ERROR_CODES.CONNECTOR_NOT_FOUND).toBe("CONNECTOR_NOT_FOUND");
		expect(ERROR_CODES.POLICY_NOT_FOUND).toBe("POLICY_NOT_FOUND");
		expect(ERROR_CODES.APPROVAL_NOT_FOUND).toBe("APPROVAL_NOT_FOUND");
		expect(ERROR_CODES.SESSION_NOT_FOUND).toBe("SESSION_NOT_FOUND");
	});
});

describe("schema validation invariants", () => {
	test("CreateCredentialSchema requires value for native sourceType", () => {
		const result = CreateCredentialSchema.safeParse({
			name: "cred",
			type: "api_key",
			sourceType: "native",
		});
		expect(result.success).toBe(false);
	});

	test("CreateCredentialSchema allows missing value for external sourceType", () => {
		const result = CreateCredentialSchema.safeParse({
			name: "cred",
			type: "api_key",
			sourceType: "external",
			connectorId: "conn-1",
		});
		expect(result.success).toBe(true);
	});

	test("CreateCredentialSchema rejects external without connectorId", () => {
		const result = CreateCredentialSchema.safeParse({
			name: "cred",
			type: "api_key",
			sourceType: "external",
		});
		expect(result.success).toBe(false);
	});

	test("GrantPermissionSchema requires agentId and credentialId", () => {
		expect(
			GrantPermissionSchema.safeParse({}).success,
		).toBe(false);
		expect(
			GrantPermissionSchema.safeParse({ agentId: "a1" }).success,
		).toBe(false);
		expect(
			GrantPermissionSchema.safeParse({
				agentId: "a1",
				credentialId: "550e8400-e29b-41d4-a716-446655440000",
			}).success,
		).toBe(true);
	});

	test("GrantPermissionSchema rejects non-uuid credentialId", () => {
		const result = GrantPermissionSchema.safeParse({
			agentId: "a1",
			credentialId: "not-a-uuid",
		});
		expect(result.success).toBe(false);
	});

	test("CreateSessionSchema enforces max TTL of 86400 seconds (24 hours)", () => {
		expect(
			CreateSessionSchema.safeParse({ agentId: "a1", ttlSeconds: 86400 })
				.success,
		).toBe(true);
		expect(
			CreateSessionSchema.safeParse({ agentId: "a1", ttlSeconds: 86401 })
				.success,
		).toBe(false);
	});

	test("CreateSessionSchema rejects zero or negative TTL", () => {
		expect(
			CreateSessionSchema.safeParse({ agentId: "a1", ttlSeconds: 0 }).success,
		).toBe(false);
		expect(
			CreateSessionSchema.safeParse({ agentId: "a1", ttlSeconds: -1 }).success,
		).toBe(false);
	});

	test("PolicyRuleSchema accepts all rule types", () => {
		const ruleTypes = [
			"delivery_mode",
			"environment",
			"sensitivity",
			"destination",
			"ttl",
		];
		for (const type of ruleTypes) {
			expect(PolicyRuleSchema.safeParse({ type }).success).toBe(true);
		}
	});

	test("PolicyRuleSchema rejects unknown rule types", () => {
		expect(
			PolicyRuleSchema.safeParse({ type: "wildcard" }).success,
		).toBe(false);
		expect(
			PolicyRuleSchema.safeParse({ type: "admin_override" }).success,
		).toBe(false);
	});

	test("AgentAccessRequestSchema requires at least one credential identifier", () => {
		expect(
			AgentAccessRequestSchema.safeParse({ purpose: "test" }).success,
		).toBe(false);
		expect(
			AgentAccessRequestSchema.safeParse({ credentialName: "my-key" }).success,
		).toBe(true);
		expect(
			AgentAccessRequestSchema.safeParse({
				credentialId: "550e8400-e29b-41d4-a716-446655440000",
			}).success,
		).toBe(true);
	});
});
