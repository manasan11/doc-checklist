/**
 * Generic request validation middleware helper.
 * Validates request body, params, or query against given required fields.
 */
function validateRequired(fields = [], source = 'body') {
  return (req, res, next) => {
    const data = req[source] || {};
    const missing = [];

    for (const field of fields) {
      if (data[field] === undefined || data[field] === null || String(data[field]).trim() === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required field(s): ${missing.join(', ')}`
      });
    }

    next();
  };
}

module.exports = {
  validateRequired
};

