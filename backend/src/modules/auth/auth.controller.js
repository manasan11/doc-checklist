const authService = require('./auth.service');

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  const result = await authService.authenticate(username, password);
  if (!result || result.error) {
    return res.status(401).json({ error: result?.error || 'Invalid credentials' });
  }

  const user = result.user;
  const token = authService.generateToken(user);

  return res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      department: user.department
    }
  });
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address or username is required' });
    }

    const origin = req.headers.origin || req.headers.referer;
    const result = await authService.requestPasswordReset(email, origin);

    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json(result);
  } catch (err) {
    console.error('[AuthController] forgotPassword error:', err);
    return res.status(500).json({ error: 'Failed to process forgot password request: ' + err.message });
  }
}

function verifyToken(req, res) {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ valid: false, error: 'Reset token is required' });
  }

  const result = authService.verifyResetToken(token);
  if (!result.valid) {
    return res.status(400).json(result);
  }

  return res.json(result);
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  const result = await authService.resetPassword(token, newPassword);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({
    message: result.message,
    email: result.email
  });
}

async function changePassword(req, res) {
  const { newPassword, confirmPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ error: 'New password is required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirm password do not match.' });
  }

  const result = await authService.changePassword(req.user.id, req.user.email, newPassword);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({
    message: result.message
  });
}

module.exports = {
  login,
  forgotPassword,
  verifyToken,
  resetPassword,
  changePassword
};

