const jwt = require('jsonwebtoken');
const config = require('../config');
const dataStore = require('../dataStore');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const headerUserId = req.headers['x-user-id'];
  const headerUserEmail = req.headers['x-user-email'];

  // 1. Try decoding valid JWT
  if (token && !token.startsWith('local_') && !token.startsWith('token_')) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      if (decoded) {
        let user = decoded.id ? dataStore.findUserById(decoded.id) : null;
        if (!user && decoded.email) {
          user = dataStore.findUserByEmailOrUsername(decoded.email);
        }
        if (user) {
          req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
          return next();
        }
        // Fallback if user ID changed but email matches
        if (decoded.id && decoded.email) {
          req.user = { id: decoded.id, email: decoded.email, name: decoded.name || 'User', role: decoded.role || 'user' };
          return next();
        }
      }
    } catch (tokenErr) {
      console.warn('[Auth] Token error:', tokenErr.message);
    }
  }

  // 2. Resolve user by header ID or Email
  let user = null;
  if (headerUserId) {
    user = dataStore.findUserById(headerUserId);
  }
  if (!user && (headerUserEmail || headerUserId)) {
    const identifier = headerUserEmail || headerUserId;
    user = dataStore.findUserByEmailOrUsername(identifier);
  }

  if (user) {
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    return next();
  }

  return res.status(401).json({ error: 'Authentication required. Please log in.' });
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    jwt.verify(token, config.jwtSecret, (err, decoded) => {
      if (!err) req.user = decoded;
      next();
    });
  } else {
    next();
  }
}

module.exports = {
  authenticateToken,
  optionalAuth
};

