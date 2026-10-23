class ApiError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

module.exports = ApiError;
