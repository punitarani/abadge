import type { ErrorCode } from "./constants";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 403);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 409);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super("RATE_LIMITED", "Too many requests", 429);
    this.name = "RateLimitError";
  }
}

export class PolicyViolationError extends AppError {
  constructor(message: string) {
    super("POLICY_VIOLATION", message, 403);
    this.name = "PolicyViolationError";
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(message: string) {
    super("APPROVAL_REQUIRED", message, 202);
    this.name = "ApprovalRequiredError";
  }
}

export class SessionExpiredError extends AppError {
  constructor(message: string) {
    super("SESSION_EXPIRED", message, 401);
    this.name = "SessionExpiredError";
  }
}

export class DeliveryModeError extends AppError {
  constructor(message: string) {
    super("DELIVERY_MODE_NOT_ALLOWED", message, 400);
    this.name = "DeliveryModeError";
  }
}
