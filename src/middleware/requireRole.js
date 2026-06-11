// Gates a route to one or more roles. Must run after the auth middleware.
// Usage: router.get('/x', auth, requireRole('requester'), handler)
module.exports = function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource' });
    }
    return next();
  };
};
