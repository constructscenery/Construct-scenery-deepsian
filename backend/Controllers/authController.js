const bcrypt = require('bcryptjs');
const db = require('../config/db');
const multer = require('multer');
const { store, deleteFile } = require('../services/fileStorage');
const {
  signAccessToken,
  generateRefreshToken,
  refreshExpiresAt,
} = require('../config/jwt');

const VALID_ROLES = [
  'managing_director',
  'construction_accountant',
  'construction_coordinator',
];

// ─── POST /api/auth/signup ─────────────────────────────────────────────────────
const signup = async (req, res) => {
  const { email, password, full_name, role } = req.body;

  if (!email || !password || !full_name || !role)
    return res.status(400).json({ error: 'email, password, full_name, and role are required' });

  if (!VALID_ROLES.includes(role))
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });

  try {
    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (existing.length) return res.status(400).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const { encrypt } = require('../config/crypto');
    const display_password = encrypt(password);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, display_password, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role, created_at`,
      [email.toLowerCase().trim(), password_hash, display_password, full_name, role]
    );

    res.status(201).json({ message: 'User created successfully', user: rows[0] });
  } catch (err) {
    console.error('signup error:', err);
    res.status(500).json({ error: 'Server error during signup' });
  }
};

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  try {
    const { rows } = await db.query(
      'SELECT id, email, password_hash, full_name, role, avatar_url, is_active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];

    // Same generic error for both "not found" and "wrong password" (security: no user enumeration)
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.is_active === false) return res.status(403).json({ error: 'Account is deactivated. Please contact your administrator.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const access_token   = signAccessToken(user);
    const refresh_token  = generateRefreshToken();
    const expires_at     = refreshExpiresAt();

    await db.query(
      'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [refresh_token, user.id, expires_at]
    );

    res.json({
      access_token,
      refresh_token,
      expires_in: 3600,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, avatar_url: user.avatar_url || null },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
};

// ─── POST /api/auth/logout ─────────────────────────────────────────────────────
// Requires authenticate middleware — revokes the supplied refresh token
const logout = async (req, res) => {
  const { refresh_token } = req.body;
  try {
    if (refresh_token) {
      await db.query(
        'DELETE FROM refresh_tokens WHERE token = $1 AND user_id = $2',
        [refresh_token, req.user.id]
      );
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('logout error:', err);
    res.status(500).json({ error: 'Server error during logout' });
  }
};

// ─── GET /api/auth/me ──────────────────────────────────────────────────────────
// Returns the authenticated user's fresh profile from the database
const getMe = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { rows } = await db.query(
      'SELECT id, email, role, full_name, avatar_url FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('getMe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/auth/refresh ────────────────────────────────────────────────────
// Token rotation: validates refresh token, issues new access + refresh tokens,
// deletes the old refresh token (one-time use)
const refreshToken = async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token)
    return res.status(400).json({ error: 'refresh_token is required' });

  try {
    const { rows } = await db.query(
      `SELECT rt.token, rt.user_id,
              u.id, u.email, u.full_name, u.role, u.avatar_url
       FROM   refresh_tokens rt
       JOIN   users u ON u.id = rt.user_id
       WHERE  rt.token = $1
         AND  rt.expires_at > NOW()`,
      [refresh_token]
    );

    const record = rows[0];
    if (!record) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    // Rotate — delete old token first
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);

    const user = { id: record.id, email: record.email, full_name: record.full_name, role: record.role, avatar_url: record.avatar_url || null };
    const new_access_token  = signAccessToken(user);
    const new_refresh_token = generateRefreshToken();
    const new_expires_at    = refreshExpiresAt();

    await db.query(
      'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [new_refresh_token, record.id, new_expires_at]
    );

    res.json({
      access_token:  new_access_token,
      refresh_token: new_refresh_token,
      expires_in:    3600,
      user,
    });
  } catch (err) {
    console.error('refreshToken error:', err);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
};

// ─── POST /api/auth/forgot-password ───────────────────────────────────────────
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const normalised = email.toLowerCase().trim();

  try {
    const { rows } = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [normalised]
    );

    // Always return success to prevent user-enumeration
    if (!rows.length) {
      return res.json({ message: 'If that email is registered, an OTP has been sent.' });
    }

    const otp       = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await db.query('DELETE FROM password_reset_otps WHERE email = $1', [normalised]);
    await db.query(
      'INSERT INTO password_reset_otps (email, otp, expires_at) VALUES ($1, $2, $3)',
      [normalised, otp, expiresAt]
    );

    const { sendEmail } = require('../config/email');
    await sendEmail({
      to: email,
      subject: 'Deepsian — Password Reset OTP',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
            <div style="background:#0f172a;padding:6px 12px;border-radius:6px;display:inline-block">
              <span style="color:#fff;font-size:13px;font-weight:900;letter-spacing:2px">DEEPSIAN</span>
            </div>
          </div>
          <h2 style="color:#0f172a;font-size:20px;margin:0 0 8px">Password Reset Request</h2>
          <p style="color:#475569;font-size:14px;margin:0 0 24px">Use the code below to reset your Deepsian password. This code expires in <strong>15 minutes</strong>.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
            <p style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px">Your OTP</p>
            <p style="font-size:40px;font-weight:700;letter-spacing:12px;color:#0f172a;margin:0">${otp}</p>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:0">If you did not request this reset, you can safely ignore this email. Your password will not be changed.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
          <p style="color:#94a3b8;font-size:11px;margin:0">Construct Scenery Limited · info@constructscenery.co.uk</p>
        </div>
      `,
    });

    res.json({ message: 'If that email is registered, an OTP has been sent.' });
  } catch (err) {
    console.error('forgotPassword error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/auth/verify-otp ─────────────────────────────────────────────────
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });

  try {
    const { rows } = await db.query(
      `SELECT id FROM password_reset_otps
       WHERE  email = $1
         AND  otp   = $2
         AND  expires_at > NOW()`,
      [email.toLowerCase().trim(), otp]
    );

    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' });

    res.json({ message: 'OTP verified' });
  } catch (err) {
    console.error('verifyOtp error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/auth/reset-password ────────────────────────────────────────────
const resetPassword = async (req, res) => {
  const { email, otp, new_password } = req.body;
  if (!email || !otp || !new_password)
    return res.status(400).json({ error: 'email, otp, and new_password are required' });

  if (new_password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const normalised = email.toLowerCase().trim();

  try {
    const { rows } = await db.query(
      `SELECT id FROM password_reset_otps
       WHERE  email = $1
         AND  otp   = $2
         AND  expires_at > NOW()`,
      [normalised, otp]
    );

    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const password_hash = await bcrypt.hash(new_password, 12);

    await db.query('UPDATE users SET password_hash = $1 WHERE email = $2', [password_hash, normalised]);
    await db.query('DELETE FROM password_reset_otps WHERE email = $1', [normalised]);
    // Invalidate all refresh tokens for this user on password change
    await db.query(
      'DELETE FROM refresh_tokens WHERE user_id = (SELECT id FROM users WHERE email = $1)',
      [normalised]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('resetPassword error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── PATCH /api/auth/profile ──────────────────────────────────────────────────
// Allows the authenticated user to update their own name, email, and/or password.
const updateProfile = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { full_name, email, current_password, new_password } = req.body;

  if (!full_name && !email && !new_password)
    return res.status(400).json({ error: 'Nothing to update' });

  try {
    const { rows } = await db.query(
      'SELECT id, email, password_hash, full_name, role, avatar_url FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Password change requires current password verification
    if (new_password) {
      if (!current_password)
        return res.status(400).json({ error: 'current_password is required to change password' });
      if (new_password.length < 8)
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid)
        return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Check email uniqueness if changing email
    const newEmail = email ? email.toLowerCase().trim() : user.email;
    if (email && newEmail !== user.email) {
      const { rows: existing } = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [newEmail, req.user.id]
      );
      if (existing.length) return res.status(400).json({ error: 'Email already in use' });
    }

    const newFullName     = full_name?.trim() || user.full_name;
    const newPasswordHash = new_password ? await bcrypt.hash(new_password, 12) : user.password_hash;

    const { rows: updated } = await db.query(
      `UPDATE users
       SET full_name = $1, email = $2, password_hash = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, full_name, role, avatar_url`,
      [newFullName, newEmail, newPasswordHash, req.user.id]
    );

    // If password changed, revoke all refresh tokens (force re-login on other devices)
    if (new_password) {
      await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
    }

    res.json({ message: 'Profile updated', user: updated[0] });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/auth/profile/avatar ────────────────────────────────────────────
// Multer middleware for avatar — images only, 10 MB max
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(Object.assign(new Error('Only image files (JPEG, PNG, WebP, GIF, HEIC) are allowed'), { status: 400 }));
  },
}).single('avatar');

const uploadAvatar = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  try {
    // Fetch old avatar key so we can delete it from S3 after
    const { rows: existingRows } = await db.query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
    const oldUrl = existingRows[0]?.avatar_url || null;

    // Store new avatar under avatars/ prefix
    const ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase();
    const key = `avatars/${req.user.id}-${Date.now()}.${ext}`;

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const BUCKET = process.env.AWS_S3_BUCKET || 'deepsiant-assets-prod';
    const REGION = process.env.AWS_REGION || 'eu-north-1';
    const s3 = new S3Client({
      region: REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'image/jpeg',
    }));

    const avatar_url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

    const { rows: [updatedUser] } = await db.query(
      'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, full_name, role, avatar_url',
      [avatar_url, req.user.id]
    );

    // Delete old avatar from S3 asynchronously if it existed
    if (oldUrl) {
      try {
        const oldKey = oldUrl.includes('.amazonaws.com/') ? oldUrl.split('.amazonaws.com/')[1] : null;
        if (oldKey) await deleteFile(oldKey);
      } catch (delErr) {
        console.warn('Could not delete old avatar:', delErr.message);
      }
    }

    res.json({ message: 'Avatar updated', avatar_url, user: updatedUser });
  } catch (err) {
    console.error('uploadAvatar error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

module.exports = { signup, login, logout, getMe, refreshToken, forgotPassword, verifyOtp, resetPassword, updateProfile, avatarUpload, uploadAvatar };
