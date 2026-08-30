const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const {
  register,
  login,
  refresh,
  logout,
  verifyEmail,
  verifyPhone,
  getMe,
  updateProfile,
  changeEmail,
  verifyEmailChange,
  getActivity,
  uploadAvatar,
  setPIN,
  verifyPIN,
  setup2FA,
  verify2FA,
  disable2FA,
  forgotPassword,
  resetPassword,
  regenerateBackupCodes,
  getBackupCodeCount,
  changePassword,
  validateResetToken,
  revokeDeviceTrust,
} = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const geoRestriction = require('../middleware/geoRestriction');
const { verifyCsrf } = require('../middleware/csrf');
const { listSessions, revokeSession, revokeAllSessions } = require('../controllers/sessionController');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

const PASSWORD_MIN_LENGTH = parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 8;

function checkPasswordStrength(password) {
  const unmet = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    unmet.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) unmet.push('at least one uppercase letter');
  if (!/[a-z]/.test(password)) unmet.push('at least one lowercase letter');
  if (!/\d/.test(password)) unmet.push('at least one digit');
  if (!/[^A-Za-z0-9]/.test(password)) unmet.push('at least one special character');
  return unmet;
}

router.post(
  '/register',
  geoRestriction,
  [
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('email').isEmail().normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Password is required')
      .custom((value) => {
        const unmet = checkPasswordStrength(value);
        if (unmet.length > 0) {
          throw new Error(`Password does not meet requirements: ${unmet.join(', ')}`);
        }
        return true;
      }),
  ],
  validate,
  register
);

router.post(
  '/login',
  geoRestriction,
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  validate,
  login
);

router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  validate,
  forgotPassword
);

router.post(
  '/reset-password',
  [
    body('token').trim().notEmpty().withMessage('Reset token is required'),
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  resetPassword
);

router.get('/reset-password/validate', validateResetToken);

router.post('/refresh', verifyCsrf, refresh);
router.post('/logout', verifyCsrf, logout);

router.get('/verify-email', verifyEmail);
router.post(
  '/verify-phone',
  authMiddleware,
  [body('otp').matches(/^\d{6}$/).withMessage('OTP must be 6 digits')],
  validate,
  verifyPhone
);
router.get('/me', authMiddleware, getMe);
router.patch('/me', authMiddleware, updateProfile);
router.post(
  '/change-email',
  authMiddleware,
  [
    body('new_email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  changeEmail
);
router.get('/verify-email-change', verifyEmailChange);
router.get('/activity', authMiddleware, getActivity);

router.post(
  '/set-pin',
  authMiddleware,
  [body('pin').matches(/^\d{4,6}$/).withMessage('PIN must be 4-6 digits')],
  validate,
  setPIN
);

router.post(
  '/verify-pin',
  authMiddleware,
  [body('pin').matches(/^\d{4,6}$/).withMessage('PIN must be 4-6 digits')],
  validate,
  verifyPIN
);

router.post('/2fa/setup', authMiddleware, setup2FA);

router.post(
  '/2fa/verify',
  authMiddleware,
  [body('totp_code').matches(/^\d{6}$/).withMessage('TOTP code must be 6 digits')],
  validate,
  verify2FA
);

router.post(
  '/2fa/disable',
  authMiddleware,
  [body('password').notEmpty().withMessage('Password is required')],
  validate,
  disable2FA
);

router.post(
  '/2fa/backup-codes/regenerate',
  authMiddleware,
  [body('totp_code').matches(/^\d{6}$/).withMessage('TOTP code must be 6 digits')],
  validate,
  regenerateBackupCodes
);

router.get('/2fa/backup-codes/count', authMiddleware, getBackupCodeCount);

// Avatar upload — 5 MB limit, memory storage (magic bytes checked in controller)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, and WebP files are allowed'));
  },
});

// Change password — invalidates all other active sessions
router.patch(
  '/password',
  authMiddleware,
  [
    body('current_password').notEmpty().withMessage('Current password is required'),
    body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ],
  validate,
  changePassword
);

router.post(
  '/avatar',
  authMiddleware,
  avatarUpload.single('avatar'),
  uploadAvatar
);

// Session management
router.get('/sessions', authMiddleware, listSessions);
router.delete('/sessions', authMiddleware, revokeAllSessions);
router.delete('/sessions/:id', authMiddleware, revokeSession);

// Device trust (issue #995) — clears the httpOnly device-trust cookie.
router.delete('/device-trust', authMiddleware, revokeDeviceTrust);

module.exports = router;
