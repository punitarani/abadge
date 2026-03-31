import type { ErrorCode } from "./constants";

export class AbadgeError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = "AbadgeError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AbadgeError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AbadgeError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AbadgeError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 403);
    this.name = "ForbiddenError";
  }
}

export class PolicyViolationError extends AbadgeError {
  constructor(message: string) {
    super("POLICY_VIOLATION", message, 403);
    this.name = "PolicyViolationError";
  }
}

export class ApprovalRequiredError extends AbadgeError {
  constructor(message: string) {
    super("APPROVAL_REQUIRED", message, 202);
    this.name = "ApprovalRequiredError";
  }
}
