function successResponse(res, data = {}, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    ...data
  });
}

function errorResponse(res, message = 'Internal Server Error', statusCode = 500, extra = {}) {
  return res.status(statusCode).json({
    success: false,
    error: message,
    ...extra
  });
}

module.exports = {
  successResponse,
  errorResponse
};

