'use strict';

/** An error the client caused and can fix. `status` goes on the response; `position` points into an expression. */
class BiError extends Error {
  constructor(status, message, position) {
    super(message);
    this.status = status;
    if (position !== undefined) this.position = position;
  }
}

const badRequest = (message, position) => new BiError(400, message, position);
const notFound = (message) => new BiError(404, message);

module.exports = { BiError, badRequest, notFound };
