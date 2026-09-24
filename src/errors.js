export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (code = "not_found", message) => new ApiError(404, code, message);
export const badRequest = (code, message) => new ApiError(400, code, message);
export const conflict = (code, message) => new ApiError(409, code, message);
