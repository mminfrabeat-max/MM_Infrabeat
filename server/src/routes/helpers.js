// Shared plumbing for the route files.

// Express 4 does not catch errors thrown inside an async route handler. Without this
// wrapper, a failed data load would leave the browser waiting forever with no reply and
// no error - the exact "blank page" failure we agreed to avoid.
//
// Wrapping a handler in asyncHandler() forwards any thrown error to the error handler in
// index.js, which turns it into a readable JSON message.
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
