// errors.mjs — a failure the user can act on (bad flag, unusable config file, unknown id).
// The CLI prints these as one "error: ..." line with no stack trace and exits 1. Messages
// must never quote the contents of a user's config file: it may hold secrets.
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}
