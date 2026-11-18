import { AppError } from "../errors/app-error.js";

export function notFound(req, res, next) {
  next(new AppError(404, "NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
}
