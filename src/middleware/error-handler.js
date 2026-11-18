import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const isValidationError = error instanceof ZodError;
  const statusCode = isValidationError
    ? 400
    : Number.isInteger(error.statusCode ?? error.status) &&
        (error.statusCode ?? error.status) >= 400 &&
        (error.statusCode ?? error.status) <= 599
      ? error.statusCode ?? error.status
      : 500;
  const code = isValidationError
    ? "VALIDATION_ERROR"
    : statusCode >= 500 && !(error instanceof AppError)
      ? "INTERNAL_SERVER_ERROR"
      : error.code ?? (statusCode < 500 ? "INVALID_REQUEST" : "INTERNAL_SERVER_ERROR");
  const message = statusCode >= 500 && process.env.NODE_ENV === "production"
    ? "An unexpected error occurred"
    : error.message ?? "An unexpected error occurred";

  if (statusCode >= 500) {
    console.error(error);
  }

  return res.status(statusCode).json({
    error: {
      code,
      message,
      ...(isValidationError
        ? {
            details: error.issues.map(({ code: issueCode, path, message: issueMessage }) => ({
              code: issueCode,
              path,
              message: issueMessage,
            })),
          }
        : error.details
          ? { details: error.details }
          : {}),
    },
  });
}
