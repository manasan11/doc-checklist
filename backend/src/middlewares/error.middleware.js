function errorHandler(err, req, res, next) {
  console.error('[Unhandled Error]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error'
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Not Found - ${req.originalUrl}` });
}

module.exports = {
  errorHandler,
  notFoundHandler
};

