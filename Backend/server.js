// server.js
// Requirements:
// npm i express cors bcryptjs pg dotenv multer multer-storage-cloudinary cloudinary
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized:false } : false
});

// open CORS
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' })); // allow some room for base64 if demo

// multi upload (we'll support both disk and cloudinary; choose at runtime)
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ---------- LOCAL DISK STORAGE (kept as fallback) ----------
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'kyc');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // keep original name with timestamp prefix to avoid collisions
    const name = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, name);
  }
});

const uploadDisk = multer({
  storage: diskStorage,
  limits: {
    // adjust as needed
    fileSize: 50 * 1024 * 1024 // 50MB per file
  }
});

// ------------------ DB init & migrations (idempotent) ------------------
// Create core tables if missing, and run safe ALTERs to add missing columns for older DBs.
const initSql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  fullname TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  lga TEXT NOT NULL,
  city TEXT NOT NULL,
  gender TEXT,
  specializations TEXT[],
  password_hash TEXT NOT NULL,
  kyc_status TEXT DEFAULT 'Unverified',
  avatar_url TEXT,
  profile_complete boolean DEFAULT false,
  account_details JSONB,
  kyc_documents TEXT[],
  kyc_submitted_at TIMESTAMP WITH TIME ZONE,
  online boolean DEFAULT false,
  lat double precision,
  lng double precision,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  client_id TEXT REFERENCES users(id),
  tech_id TEXT REFERENCES users(id),
  amount NUMERIC,
  currency TEXT DEFAULT 'NGN',
  method TEXT,
  status TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  claimant_id TEXT REFERENCES users(id),
  defendant_id TEXT REFERENCES users(id),
  reason TEXT,
  details TEXT,
  status TEXT DEFAULT 'open',
  admin_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  fullname TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES users(id),
  role_required TEXT NOT NULL DEFAULT 'technician',
  state TEXT NOT NULL,
  city TEXT,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  job_type TEXT,
  description TEXT,
  price NUMERIC,
  status TEXT NOT NULL DEFAULT 'created',
  assigned_tech_id TEXT REFERENCES users(id),
  assigned_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  workers_needed INTEGER DEFAULT 1,
  estimated_days INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kyc_requests (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  id_type TEXT,
  id_number TEXT,
  id_images TEXT[],
  selfie TEXT,                 -- ✅ ADDED HERE
  work_video TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  decided_at TIMESTAMP WITH TIME ZONE
);
`;

// Additional safe ALTERs to add columns that may be missing in older DBs
const alterUsersSql = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_details JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_documents TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS online boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
`;

// Ensure older DBs have the new columns (safe ALTER statements)
const alterJobsSql = `
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workers_needed INTEGER DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_days INTEGER DEFAULT 1;
`;
//Ensure older DBs have the new colums
const alterStaffSql = `
ALTER TABLE staff ADD COLUMN IF NOT EXISTS fullname TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
`;
//Ensure older DBs have new columns
const alterKycSql = `
ALTER TABLE kyc_requests ADD COLUMN IF NOT EXISTS selfie TEXT;
`;
// Ensure messages table exists (some versions referenced it)
const createMessagesTableSql = `
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
`;

(async ()=> {
  try{
    await pool.query(initSql);
    await pool.query(alterUsersSql);
    await pool.query(alterKycSql);
    await pool.query(alterJobsSql);
    await pool.query(createMessagesTableSql);
    console.log('DB ready and migrations applied.');
  } catch(err){
    console.error('DB init/migration error', err);
    process.exit(1);
  }
})();

// Helpers
function validEmail(email){ return /\S+@\S+\.\S+/.test(email || ''); }
function validPhone(ph){ if(!ph) return false; const cleaned = ph.replace(/\s+/g,''); return /^(?:\+234|0)?\d{10}$/.test(cleaned); }
function uid(){ return Math.floor(1000000000 + Math.random()*9000000000).toString(); }
function distanceMeters(lat1, lon1, lat2, lon2){
  if(lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Number.POSITIVE_INFINITY;
  const R = 6371000;
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// attemptAssign helper - now returns assigned technician object or false
// techs: array [{id, lat, lng, distance}, ...]
async function attemptAssign(jobId, techs, attemptIndex = 0){
  if(!Array.isArray(techs) || techs.length === 0) {
    await pool.query(`UPDATE jobs SET status='pending_assignment' WHERE id=$1`, [jobId]);
    return false;
  }

  if(attemptIndex >= techs.length){
    await pool.query(`UPDATE jobs SET status='pending_assignment' WHERE id=$1`, [jobId]);
    return false;
  }

  const tech = techs[attemptIndex];
  const clientConn = await pool.connect();
  try {
    const now = new Date();
    // keep short expiry for technician acceptance (60s)
    const expiresAt = new Date(now.getTime() + 60*1000);

    const res = await clientConn.query(`
      UPDATE jobs
      SET assigned_tech_id=$1, status='pending_accept', assigned_at=now(), expires_at=$2
      WHERE id=$3 AND status IN ('created','pending_assignment')
      RETURNING *`, [tech.id, expiresAt.toISOString(), jobId]);

    if(!res.rows.length) {
      // couldn't reserve the job (maybe status changed) -> move on
      return false;
    }

    // fetch technician profile to return
    const trow = (await clientConn.query(`SELECT id, fullname, username, avatar_url, phone, email, lat, lng FROM users WHERE id=$1`, [tech.id])).rows[0] || null;

    // schedule expiration handler to reassign if technician doesn't respond
    setTimeout(async ()=>{
      try{
        const check = await pool.query(`SELECT status, assigned_tech_id FROM jobs WHERE id=$1`, [jobId]);
        if(!check.rows.length) return;
        const js = check.rows[0];
        if(js.status === 'pending_accept' && js.assigned_tech_id === tech.id){
          // revert assignment and try next
          await pool.query(`UPDATE jobs SET status='pending_assignment', assigned_tech_id=NULL, assigned_at=NULL, expires_at=NULL WHERE id=$1`, [jobId]);
          // attempt next tech (note: this is fire-and-forget, do not await)
          await attemptAssign(jobId, techs, attemptIndex + 1);
        }
      }catch(e){ console.error('timeout handler error', e); }
    }, 60*1000);

    // Return tech profile to caller so frontend can display immediately
    return trow || { id: tech.id };
  } finally {
    clientConn.release();
  }
}

// ------------------ CLOUDINARY CONFIG (optional) ------------------
// We'll configure Cloudinary storage and create uploadCloud. If Cloudinary env vars are not set, we will keep uploadDisk as the active uploader.
let uploadCloud = null;
try {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    const cloudinary = require('cloudinary').v2;
    const { CloudinaryStorage } = require('multer-storage-cloudinary');

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    const cloudStorage = new CloudinaryStorage({
      cloudinary,
      params: async (req, file) => {
        const isVideo = file.mimetype && file.mimetype.startsWith && file.mimetype.startsWith('video/');
        return {
          folder: isVideo ? 'wireconnect/kyc/videos' : 'wireconnect/kyc/images',
          resource_type: isVideo ? 'video' : 'image',
          public_id: `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`
        };
      }
    });

    uploadCloud = multer({ storage: cloudStorage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB per file for cloud
    console.log('Cloudinary configured: using Cloudinary for uploads.');
  } else {
    console.log('Cloudinary not configured: using local disk uploads as fallback.');
  }
} catch (err) {
  console.error('Cloudinary setup error (continuing with disk uploads):', err);
  uploadCloud = null;
}

// Choose the active upload middleware (cloud if available, else disk)
const upload = uploadCloud || uploadDisk;

// ------------------ End helpers ------------------

//Testing password
app.get('/test-admin', async (req,res)=>{
 const ok = await bcrypt.compare(
   "PUT_YOUR_REAL_PASSWORD_HERE",
   process.env.ADMIN_PASSWORD_HASH
 );

 res.json({match: ok});
});
// Registration
app.post('/api/register', async (req, res) => {
  try {
    const {
      role, email, phone, fullname, username,
      state, lga, city, gender, specializations, password
    } = req.body || {};

    if(!email || !validEmail(email)) return res.status(400).json({ success:false, message:'Invalid email' });
    if(!phone || !validPhone(phone)) return res.status(400).json({ success:false, message:'Invalid phone' });
    if(!fullname || fullname.trim().length < 3) return res.status(400).json({ success:false, message:'Invalid full name' });
    if(!username || username.trim().length < 3) return res.status(400).json({ success:false, message:'Invalid username' });
    if(!state || !lga || !city) return res.status(400).json({ success:false, message:'State/LGA/City required' });
    if(!password || password.length < 6) return res.status(400).json({ success:false, message:'Password must be at least 6 characters' });

    const client = await pool.connect();
    try {
      const dupQuery = `SELECT email, username, phone FROM users WHERE email = $1 OR username = $2 OR phone = $3 LIMIT 1`;
      const dupRes = await client.query(dupQuery, [email, username, phone]);
      if(dupRes.rows.length){
        return res.status(409).json({ success:false, message: 'Email, username or phone already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);

      const newUser = {
        id: uid(),
        role: role || 'client',
        email, phone, fullname, username,
        state, lga, city,
        gender: gender || 'other',
        specializations: Array.isArray(specializations) ? specializations : [],
        password_hash: hash,
        kyc_status: (role === 'worker') ? 'not_required' : 'not_required'
      };

      const insertSql = `
        INSERT INTO users (id, role, email, phone, fullname, username, state, lga, city, gender, specializations, password_hash, kyc_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `;
      await client.query(insertSql, [
        newUser.id, newUser.role, newUser.email, newUser.phone,
        newUser.fullname, newUser.username, newUser.state, newUser.lga,
        newUser.city, newUser.gender, newUser.specializations, newUser.password_hash, newUser.kyc_status
      ]);

      return res.json({ success:true, message:'Account created successfully', userId: newUser.id });

    } finally {
      client.release();
    }

  } catch(err){
    console.error('Server error /api/register', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// Login (updated: supports admin via env, staff with redirect, and normal users)
app.post('/api/login', async (req, res) => {
  try {
    const { login, password, email } = req.body || {};
    if (!login || !password) return res.status(400).json({ success: false, message: 'Login and password required' });

    const loginValue = String(login).trim();
    const payloadEmail = email ? String(email).trim() : null;

    // ---------- ADMIN (env-driven) ----------
    // Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH (bcrypt hash) in your environment
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || null;

    if (loginValue === ADMIN_USERNAME || (payloadEmail && payloadEmail === ADMIN_USERNAME)) {
      // If ADMIN_PASSWORD_HASH is present, compare with bcrypt
      if (ADMIN_PASSWORD_HASH && await bcrypt.compare(password, ADMIN_PASSWORD_HASH)) {
        // Admin signed in
        return res.json({
          success: true,
          message: 'Admin login successful',
          role: 'admin',
          user: null
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // ---------- LOOKUP USER IN DB ----------
    const client = await pool.connect();
    try {
      const q = `SELECT * FROM users WHERE email=$1 OR username=$1 OR phone=$1 LIMIT 1`;
      const r = await client.query(q, [loginValue]);
      if (!r.rows.length) return res.status(404).json({ success: false, message: 'User not found' });
      const user = r.rows[0];

      // verify password
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ success: false, message: 'Incorrect password' });

      // normalize role
      const roleRaw = (user.role || '').toString().toLowerCase();

      // build safeUser to return (same fields as before)
      const safeUser = {
        id: user.id,
        role: user.role,
        email: user.email,
        phone: user.phone,
        fullname: user.fullname,
        username: user.username,
        state: user.state,
        lga: user.lga,
        city: user.city,
        gender: user.gender,
        specializations: user.specializations,
        kyc_status: user.kyc_status,
        avatar_url: user.avatar_url,
        profile_complete: user.profile_complete,
        account_details: user.account_details,
        online: user.online,
        lat: user.lat,
        lng: user.lng,
        created_at: user.created_at
      };

      // ---------- STAFF FLOW ----------
      if (roleRaw === 'staff') {
        const BASE = process.env.ADMIN_UI_BASE || 'https://your-admin-ui.example.com';
        const ROLE_ROUTES = {
          'customer-support': `${BASE}/support`,
          'customer support': `${BASE}/support`,
          'transaction-review': `${BASE}/review`,
          'transaction review': `${BASE}/review`,
          'scaling': `${BASE}/scaling`,
          'api manager': `${BASE}/api-manager`,
          'api-manager': `${BASE}/api-manager`,
          'developer': `${BASE}/developer`,
          'kyc': `${BASE}/kyc`,
          'fraud': `${BASE}/fraud`,
          'log': `${BASE}/logs`,
          'notification': `${BASE}/notifications`
        };
        const normalizedRole = (user.specializations && user.specializations[0]) ? String(user.specializations[0]).toLowerCase() : (user.staff_role || '');
        const redirect = ROLE_ROUTES[normalizedRole] || ROLE_ROUTES[(user.role || '').toLowerCase()] || `${BASE}/staff`;

        return res.json({
          success: true,
          message: 'Staff login successful',
          role: 'staff',
          user: safeUser,
          redirect
        });
      }

      // ---------- TECH / CLIENT (regular users) ----------
      if (roleRaw === 'worker' || roleRaw === 'technician') {
        return res.json({ success: true, message: 'Login successful', role: 'worker', user: safeUser });
      }

      return res.json({ success: true, message: 'Login successful', role: roleRaw || 'client', user: safeUser });

    } finally {
      client.release();
    }

  } catch (e) {
    console.error('Server error /api/login', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
// ---------- Admin helper endpoints (overview & logs) ----------

/*
  GET /api/admin/metrics
  GET /api/admin/users
  GET /api/admin/kyc-logs
  GET /api/admin/job-logs
  GET /api/admin/transactions  -- optional (requires transactions table)
  GET /api/admin/disputes     -- optional (requires disputes table)
*/

app.get('/api/admin/metrics', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const rOnlineTech = await client.query(`SELECT COUNT(*)::int as count FROM users WHERE role='worker' AND online = true`);
      const rOfflineTech = await client.query(`SELECT COUNT(*)::int as count FROM users WHERE role='worker' AND (online = false OR online IS NULL)`);
      const rOnlineClient = await client.query(`SELECT COUNT(*)::int as count FROM users WHERE role='client' AND online = true`);
      const rOfflineClient = await client.query(`SELECT COUNT(*)::int as count FROM users WHERE role='client' AND (online = false OR online IS NULL)`);
      const rActive = await client.query(`SELECT COUNT(*)::int as count FROM users`);

      return res.json({
        success: true,
        metrics: {
          online_tech_count: rOnlineTech.rows[0].count,
          offline_tech_count: rOfflineTech.rows[0].count,
          online_client_count: rOnlineClient.rows[0].count,
          offline_client_count: rOfflineClient.rows[0].count,
          active_users_count: rActive.rows[0].count
        }
      });
    } finally { client.release(); }
  } catch (e) {
    console.error('/api/admin/metrics', e);
    return res.status(500).json({ success:false, message:'Server error', error: e.message });
  }
});

app.get('/api/admin/users', async (req, res) => {
  // filters: role=worker|client, online=1|0, limit, offset
  try {
    const role = req.query.role || null;
    const onlineQ = (req.query.online !== undefined) ? (req.query.online === '1' ? true : false) : null;
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;

    const clauses = [];
    const params = [];
    let idx = 1;
    if(role){ clauses.push(`role = $${idx++}`); params.push(role); }
    if(onlineQ !== null){ clauses.push(`online = $${idx++}`); params.push(onlineQ); }

    const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
    const q = `SELECT id, role, fullname, username, email, phone, state, city, lga, avatar_url, online, lat, lng, created_at
               FROM users
               ${where}
               ORDER BY created_at DESC
               LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const r = await pool.query(q, params);
    return res.json({ success:true, users: r.rows });
  } catch(e){
    console.error('/api/admin/users', e);
    return res.status(500).json({ success:false, message:'Server error', error:e.message });
  }
});

app.get('/api/admin/kyc-logs', async (req,res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;
    // join kyc_requests with users for name and avatar
    const rows = (await pool.query(`
      SELECT k.id, k.user_id, k.id_type, k.id_number, k.id_images, k.status, k.notes, k.submitted_at, u.username, u.fullname, u.avatar_url
      FROM kyc_requests k
      JOIN users u ON u.id = k.user_id
      ORDER BY k.submitted_at DESC
      LIMIT $1 OFFSET $2
    `,[limit, offset])).rows;
    return res.json({ success:true, logs: rows });
  } catch(e){
    console.error('/api/admin/kyc-logs', e);
    return res.status(500).json({ success:false, message:'Server error', error:e.message });
  }
});

app.get('/api/admin/job-logs', async (req,res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;
    const rows = (await pool.query(`
      SELECT j.id, j.job_type, j.price, j.status, j.created_at,
             c.id as client_id, c.fullname as client_name, c.avatar_url as client_avatar,
             t.id as tech_id, t.fullname as tech_name, t.avatar_url as tech_avatar
      FROM jobs j
      LEFT JOIN users c ON c.id = j.client_id
      LEFT JOIN users t ON t.id = j.assigned_tech_id
      ORDER BY j.created_at DESC
      LIMIT $1 OFFSET $2
    `,[limit, offset])).rows;
    return res.json({ success:true, jobs: rows });
  } catch(e){
    console.error('/api/admin/job-logs', e);
    return res.status(500).json({ success:false, message:'Server error', error:e.message });
  }
});

// Optional: transactions (requires transactions table)
app.get('/api/admin/transactions', async (req,res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;
    const rows = (await pool.query(`
      SELECT tr.id, tr.job_id, tr.amount, tr.currency, tr.status, tr.method, tr.created_at,
             c.id as client_id, c.fullname as client_name,
             t.id as tech_id, t.fullname as tech_name
      FROM transactions tr
      LEFT JOIN users c ON c.id = tr.client_id
      LEFT JOIN users t ON t.id = tr.tech_id
      ORDER BY tr.created_at DESC
      LIMIT $1 OFFSET $2
    `,[limit, offset])).rows;
    return res.json({ success:true, transactions: rows });
  } catch(e){
    console.error('/api/admin/transactions', e);
    return res.status(500).json({ success:false, message:'Server error', error:e.message });
  }
});

// Optional: disputes (requires disputes table)
app.get('/api/admin/disputes', async (req,res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;
    const rows = (await pool.query(`
      SELECT d.id, d.job_id, d.claimant_id, d.defendant_id, d.reason, d.details, d.status, d.created_at, d.updated_at,
             c.fullname as claimant_name, def.fullname as defendant_name
      FROM disputes d
      LEFT JOIN users c ON c.id = d.claimant_id
      LEFT JOIN users def ON def.id = d.defendant_id
      ORDER BY d.created_at DESC
      LIMIT $1 OFFSET $2
    `,[limit, offset])).rows;
    return res.json({ success:true, disputes: rows });
  } catch(e){
    console.error('/api/admin/disputes', e);
    return res.status(500).json({ success:false, message:'Server error', error:e.message });
  }
});
// Dashboard
app.get('/api/dashboard', async (req,res)=>{
  try{
    const role = (req.query.role || 'client');
    const client = await pool.connect();
    try{
      const ann = (await client.query(`SELECT id,title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 10`)).rows;
      const art = (await client.query(`SELECT id,title,excerpt,created_at FROM articles ORDER BY created_at DESC LIMIT 10`)).rows;
      const techLeaderboard = (await client.query(`
        SELECT u.id,u.username,u.fullname, COUNT(j.*) as jobs_completed
        FROM users u
        LEFT JOIN jobs j ON j.assigned_tech_id = u.id AND j.status = 'completed'
        WHERE u.role = 'worker'
        GROUP BY u.id
        ORDER BY jobs_completed DESC
        LIMIT 10
      `)).rows;
      const clientLeaderboard = (await client.query(`
        SELECT u.id,u.username,u.fullname, COUNT(j.*) as jobs_posted
        FROM users u
        LEFT JOIN jobs j ON j.client_id = u.id
        WHERE u.role = 'client'
        GROUP BY u.id
        ORDER BY jobs_posted DESC
        LIMIT 10
      `)).rows;

      return res.json({ success:true, announcements: ann, articles: art, leaderboard: role === 'worker' ? techLeaderboard : clientLeaderboard });
    } finally { client.release(); }
  }catch(e){ console.error('err /api/dashboard', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Tech status update
app.post('/api/tech/status', async (req,res) => {
  try{
    const { techId, online, lat, lng } = req.body;
    if(!techId) return res.status(400).json({ success:false, message:'techId required' });
    // coerce numeric lat/lng when provided
const nlat = (lat === null || lat === undefined) ? null : Number(lat);
    const nlng = (lng === null || lng === undefined) ? null : Number(lng);
    await pool.query(`UPDATE users SET online=$1, lat=$2, lng=$3 WHERE id=$4`, [!!online, Number.isFinite(nlat) ? nlat : null, Number.isFinite(nlng) ? nlng : null, techId]);
    return res.json({ success:true, message:'Status updated' });
  }catch(e){ console.error('/api/tech/status', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Book job (client)
app.post('/api/book', async (req,res)=>{
  try{

    const {
      clientId,
      state,
      city,
      address,
      lat,
      lng,
      job_type,
      description,
      price
    } = req.body || {};

    if(!clientId || !state){
      return res.status(400).json({
        success:false,
        message:'clientId and state required'
      });
    }

    const jobId = uid();

    // Insert job safely
    await pool.query(`
      INSERT INTO jobs
      (id, client_id, state, city, address, lat, lng, job_type, description, price, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      jobId,
      clientId,
      state,
      city || null,
      address || null,
      lat || null,
      lng || null,
      job_type || null,
      description || null,
      price || null,
      'created'
    ]);

    // Fetch technicians
    const techRows = (await pool.query(`
      SELECT id, lat, lng
      FROM users
      WHERE role='worker'
      AND online=true
      AND state=$1
    `,[state])).rows;

    // SAFE distance calc
    let techsWithDist = techRows
      .filter(t => t.lat && t.lng && lat && lng)
      .map(t => ({
        id:t.id,
        lat:t.lat,
        lng:t.lng,
        distance:distanceMeters(lat,lng,t.lat,t.lng)
      }));

    techsWithDist.sort((a,b)=>a.distance-b.distance);

    // No technicians
    if(techsWithDist.length === 0){
      await pool.query(`
        UPDATE jobs
        SET status='pending_assignment'
        WHERE id=$1
      `,[jobId]);

      return res.json({
        success:true,
        message:'Job created but no technicians available',
        jobId,
        assigned:false
      });
    }

    // Attempt assignment
    const ok = await attemptAssign(jobId, techsWithDist);

    return res.json({
      success:true,
      message: ok
        ? 'Job created and assigned'
        : 'Job created, no immediate assignment',
      jobId,
      assigned: ok
    });

  }catch(e){
    console.error('BOOK ERROR FULL:', e);
    return res.status(500).json({
      success:false,
      message:'Server error',
      error:e.message
    });
  }
});

// Poll assigned jobs for technician
app.get('/api/assigned-jobs', async (req,res)=>{
  try{
    const techId = req.query.techId;
    if(!techId) return res.status(400).json({ success:false, message:'techId required' });
    const rows = (await pool.query(`SELECT j.* FROM jobs j WHERE j.assigned_tech_id = $1 AND j.status = 'pending_accept' ORDER BY j.assigned_at DESC`, [techId])).rows;
    return res.json({ success:true, jobs: rows });
  }catch(e){ console.error('/api/assigned-jobs', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Respond to job (accept/decline)
app.post('/api/job/:id/respond', async (req,res)=>{
  try{
    const jobId = req.params.id;
    const { techId, action } = req.body;
    if(!techId || !action) return res.status(400).json({ success:false, message:'techId and action required' });
    if(!['accept','decline'].includes(action)) return res.status(400).json({ success:false, message:'invalid action' });

    const clientConn = await pool.connect();
    try{
      const q = await clientConn.query(`SELECT * FROM jobs WHERE id=$1`, [jobId]);
      if(!q.rows.length) return res.status(404).json({ success:false, message:'Job not found' });
      const job = q.rows[0];
      if(job.assigned_tech_id !== techId) return res.status(403).json({ success:false, message:'Not assigned to this technician' });

      if(action === 'accept'){
        await clientConn.query(`UPDATE jobs SET status='accepted', expires_at=NULL WHERE id=$1`, [jobId]);
        return res.json({ success:true, message:'Job accepted' });
      } else {
        await clientConn.query(`UPDATE jobs SET status='pending_assignment', assigned_tech_id=NULL, assigned_at=NULL, expires_at=NULL WHERE id=$1`, [jobId]);
        const techRows = (await clientConn.query(`SELECT id, lat, lng FROM users WHERE role = 'worker' AND online = true AND state = $1`, [job.state])).rows;
        let techsWithDist = techRows.map(t => ({ id: t.id, lat: t.lat, lng: t.lng, distance: distanceMeters(job.lat, job.lng, t.lat, t.lng) }));
        techsWithDist = techsWithDist.filter(t => t.id !== techId);
        techsWithDist.sort((a,b)=>a.distance - b.distance);
        await attemptAssign(jobId, techsWithDist);
        return res.json({ success:true, message:'Job declined; assigning next technician' });
      }
    } finally { clientConn.release(); }
  }catch(e){ console.error('/api/job/:id/respond', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Job status (client)
app.get('/api/job/:id/status', async (req,res)=>{
  try{
    const jobId = req.params.id;
    const r = await pool.query(`SELECT id,status,assigned_tech_id,assigned_at,expires_at, estimated_days, workers_needed FROM jobs WHERE id=$1`, [jobId]);
    if(!r.rows.length) return res.status(404).json({ success:false, message:'Not found' });
    return res.json({ success:true, job: r.rows[0] });
  }catch(e){ console.error('/api/job/:id/status', e); return res.status(500).json({ success:false, message:'Server error' }); }
});
// Full job detail (client or technician can call) -> includes client and tech profiles with lat/lng
app.get('/api/job/:id', async (req,res)=>{
  try{
    const jobId = req.params.id;
    const r = await pool.query(`SELECT * FROM jobs WHERE id=$1`, [jobId]);
    if(!r.rows.length) return res.status(404).json({ success:false, message:'Not found' });
    const job = r.rows[0];

    // fetch client profile
    const clientRow = (await pool.query(`SELECT id, fullname, username, phone, email, lat, lng, state, city FROM users WHERE id=$1`, [job.client_id])).rows[0] || null;
    // fetch technician profile if assigned
    let techRow = null;
    if(job.assigned_tech_id){
      techRow = (await pool.query(`SELECT id, fullname, username, phone, email, lat, lng, state, city FROM users WHERE id=$1`, [job.assigned_tech_id])).rows[0] || null;
    }

    return res.json({ success:true, job, client: clientRow, technician: techRow });
  }catch(e){ console.error('/api/job/:id', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// ----------------- NEW: Profile & KYC endpoints -----------------

// Profile update: avatar_url, fullname (optional), account_details { bank, account_number, account_name }
app.post('/api/profile/update', async (req,res)=>{
  try{
    const { userId, avatarUrl, fullname, account } = req.body || {};
    if(!userId) return res.status(400).json({ success:false, message:'userId required' });

    const client = await pool.connect();
    try{
      // update fields provided
      const row = (await client.query(`SELECT * FROM users WHERE id=$1`, [userId])).rows[0];
      if(!row) return res.status(404).json({ success:false, message:'User not found' });

      const newFull = fullname || row.fullname;
      const newAvatar = avatarUrl || row.avatar_url;
      const newAccount = account ? account : row.account_details;

      // determine profile_complete: simple rule -> avatar + account_details present
      const profileComplete = !!(newAvatar && newAccount && newAccount.bank && newAccount.account_number);

      await client.query(`UPDATE users SET fullname=$1, avatar_url=$2, account_details=$3, profile_complete=$4 WHERE id=$5`,
        [newFull, newAvatar, newAccount ? JSON.stringify(newAccount) : null, profileComplete, userId]);

      const updated = (await client.query(`SELECT id,fullname,avatar_url,account_details,profile_complete FROM users WHERE id=$1`, [userId])).rows[0];
      return res.json({ success:true, message:'Profile updated', user: updated });
    } finally { client.release(); }
  }catch(e){ console.error('/api/profile/update', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// debug-friendly KYC submit route (drop-in replacement)
// NOTE: keep this only for debugging; remove detailed error+file dumps in production.
app.post('/api/kyc/submit', (req, res) => {
  // invoke multer middleware manually so we can catch multer errors
  upload.fields([
    { name: 'id_images', maxCount: 6 },
    { name: 'selfie', maxCount: 1 },
    { name: 'work_videos', maxCount: 2 }
  ])(req, res, async (multerErr) => {

    // If multer produced an error, return it as JSON (makes frontend debugging easy)
    if (multerErr) {
      console.error('MULTER ERROR at /api/kyc/submit:', multerErr);
      const out = {
        success: false,
        message: 'Upload error',
        error: {
          code: multerErr.code || null,
          field: multerErr.field || null,
          message: multerErr.message || String(multerErr),
          stack: multerErr.stack ? String(multerErr.stack).split('\n').slice(0,8).join('\n') : null
        }
      };
      return res.status(multerErr.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : 400).json(out);
    }

    // Normal execution path (now multer succeeded and req.files exists)
    try {
      // Log incoming body and files for debugging
      console.log('KYC submit: req.body =', Object.assign({}, req.body));
      // Log summary of files (do not dump file buffers)
      const fileSummary = {};
      if (req.files) {
        Object.keys(req.files).forEach(k => {
          fileSummary[k] = req.files[k].map(f => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            mimetype: f.mimetype,
            size: f.size,
            // path / url / filename may vary by storage; show what's present
            path: f.path || f.secure_url || f.url || f.filename || null
          }));
        });
      }
      console.log('KYC submit: req.files summary =', JSON.stringify(fileSummary, null, 2));

      // --- your existing logic, unchanged, but using req.body & req.files ---
      const { userId, id_type, id_number, notes } = req.body || {};

      const idFiles = (req.files && req.files['id_images']) ? req.files['id_images'] : [];
      const selfieFiles = (req.files && req.files['selfie']) ? req.files['selfie'] : [];
      const videoFiles = (req.files && req.files['work_videos']) ? req.files['work_videos'] : [];

      // validation (same as before)
      if (!userId || !id_type || !id_number || !Array.isArray(idFiles) || idFiles.length === 0) {
        console.warn('/api/kyc/submit validation fail', { userId, id_type, id_number, idImagesCount: idFiles.length });
        return res.status(400).json({
          success: false,
          message: 'userId, id_type, id_number and at least one id_images required',
          debug: {
            userIdProvided: !!userId,
            idTypeProvided: !!id_type,
            idNumberProvided: !!id_number,
            idImagesCount: idFiles.length
          }
        });
      }

      const client = await pool.connect();
      try {
        const usr = (await client.query(`SELECT id FROM users WHERE id=$1`, [userId])).rows[0];
        if (!usr) {
          return res.status(404).json({ success: false, message: 'User not found' });
        }

        // derive usable paths/urls
        const imagePaths = idFiles.map(f => (f.path || f.secure_url || f.url || f.filename || null)).filter(Boolean);
        const selfiePath = selfieFiles.length ? (selfieFiles[0].path || selfieFiles[0].secure_url || selfieFiles[0].url || selfieFiles[0].filename || null) : null;
        const workVideoPath = videoFiles.length ? (videoFiles[0].path || videoFiles[0].secure_url || videoFiles[0].url || videoFiles[0].filename || null) : null;

        // insert into DB (unchanged)
        const ins = await client.query(
          `INSERT INTO kyc_requests (user_id, id_type, id_number, id_images, selfie, work_video, notes, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id, submitted_at`,
          [userId, id_type, id_number, imagePaths, selfiePath, workVideoPath || null, notes || null]
        );
        const reqId = ins.rows[0].id;

        await client.query(
          `UPDATE users SET kyc_status='pending', kyc_documents=$1, kyc_submitted_at=now() WHERE id=$2`,
          [imagePaths, userId]
        );

        // Return success + helpful debug info (files summary) so frontend can show it
        return res.json({
          success: true,
          message: 'KYC submitted and pending review',
          requestId: reqId,
          debug: {
            files: fileSummary,
            imagePaths,
            selfiePath,
            workVideoPath
          }
        });

      } finally {
        client.release();
      }

    } catch (err) {
      // server error — include stack for debugging
      console.error('/api/kyc/submit SERVER ERROR:', err && err.stack ? err.stack : err);
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: {
          message: err && err.message ? err.message : String(err),
          stack: err && err.stack ? String(err.stack).split('\n').slice(0,8).join('\n') : null
        },
        // Do NOT include req.files/content in production responses
        debug: {
          filesPresent: Object.keys(req.files || {}).reduce((acc, k) => { acc[k] = (req.files[k] || []).length; return acc; }, {}),
          body: Object.assign({}, req.body)
        }
      });
    }

  });
});
// Get user's KYC status + latest KYC request (includes admin_note)
app.get('/api/kyc/status/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    // fetch user row
    const userRes = await pool.query(
      `SELECT id, fullname, username, email, kyc_status, kyc_documents, kyc_submitted_at
       FROM users WHERE id = $1`, [userId]
    );
    if (!userRes.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const user = userRes.rows[0];

    // fetch latest kyc_requests record for this user (if any)
    const reqRes = await pool.query(
      `SELECT id, id_type, id_number, id_images, work_video, notes, status, admin_note, submitted_at, decided_at
       FROM kyc_requests
       WHERE user_id = $1
       ORDER BY submitted_at DESC
       LIMIT 1`, [userId]
    );
    const latest = reqRes.rows && reqRes.rows.length ? reqRes.rows[0] : null;

    return res.json({
      success: true,
      user,
      latest_request: latest
    });
  } catch (e) {
    console.error('/api/kyc/status/:userId', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin: list pending KYC requests
app.get('/api/kyc/pending', async (req,res)=>{
  try{
    const rows = (await pool.query(`SELECT k.*, u.username, u.fullname, u.email FROM kyc_requests k JOIN users u ON u.id = k.user_id WHERE k.status = 'pending' ORDER BY k.submitted_at ASC`)).rows;
    return res.json({ success:true, requests: rows });
  }catch(e){ console.error('/api/kyc/pending', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

app.get('/api/user/:id', async (req,res)=> {
  try{
    const id = req.params.id;
    const r = await pool.query(`SELECT id, fullname, username, avatar_url, lat, lng, phone, email, state, city FROM users WHERE id=$1`, [id]);
    if(!r.rows.length) return res.status(404).json({ success:false });
    return res.json(Object.assign({ success:true }, { user: r.rows[0] }));
  } catch(e){
    console.error('/api/user/:id', e);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// Admin: approve/decline a KYC request
app.post('/api/kyc/:reqId/decision', async (req,res)=>{
  try{
    const reqId = req.params.reqId;
    const { adminId, decision, adminNote } = req.body || {};
    if(!adminId || !decision || !['approve','decline'].includes(decision)) return res.status(400).json({ success:false, message:'adminId and decision (approve|decline) required' });
    const client = await pool.connect();
    try{
      const r = await client.query(`SELECT * FROM kyc_requests WHERE id=$1`, [reqId]);
      if(!r.rows.length) return res.status(404).json({ success:false, message:'KYC request not found' });
      const reqRow = r.rows[0];

      const newStatus = decision === 'approve' ? 'approved' : 'declined';
      await client.query(`UPDATE kyc_requests SET status=$1, admin_note=$2, decided_at=now() WHERE id=$3`, [newStatus, adminNote || null, reqId]);
      await client.query(`UPDATE users SET kyc_status=$1 WHERE id=$2`, [decision === 'approve' ? 'approved' : 'declined', reqRow.user_id]);

      return res.json({ success:true, message:`KYC ${newStatus}` });
    } finally { client.release(); }
  }catch(e){ console.error('/api/kyc/:reqId/decision', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Messages endpoints (simple)
app.get('/api/job/:id/messages', async (req, res) => {
  try {
    const jobId = req.params.id;
    if(!jobId) return res.status(400).json({ success:false, message:'job id required' });

    const rows = (await pool.query(
      `SELECT id, job_id, sender_id, text, metadata, created_at
       FROM messages
       WHERE job_id = $1
       ORDER BY created_at ASC`, [jobId]
    )).rows;

    return res.json({ success:true, messages: rows });
  } catch(err) {
    console.error('/api/job/:id/messages', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});
// ---------------- STAFF ADMIN ROUTES ----------------
/**
 * Create staff (admin)
 * Returns generated_password in response (show once to admin)
 */
app.post('/api/admin/staff/create', async (req, res) => {
  try {
    const { fullname, email, role } = req.body || {};
    if (!fullname || !email || !role) {
      return res.status(400).json({ success:false, message: 'fullname, email and role required' });
    }

    const lcEmail = String(email).trim().toLowerCase();

    // check exists
    const existing = await pool.query('SELECT id FROM staff WHERE email=$1', [lcEmail]);
    if (existing.rows.length) {
      return res.status(400).json({ success:false, message: 'Staff with that email already exists' });
    }

    // generate password & hash
    const tempPassword = Math.random().toString(36).slice(-10);
    const hash = await bcrypt.hash(tempPassword, 10);

    const id = uuidv4();

    await pool.query(
      `INSERT INTO staff (id, fullname, email, role, password_hash)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, fullname.trim(), lcEmail, role.trim(), hash]
    );

    return res.json({
      success: true,
      message: 'Staff created',
      generated_password: tempPassword,
      staff: { id, fullname, email: lcEmail, role }
    });

  } catch (err) {
    console.error('/api/admin/staff/create', err && err.stack ? err.stack : err);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});

/**
 * List staff
 */
app.get('/api/admin/staff/list', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, fullname, email, role, created_at FROM staff ORDER BY created_at DESC');
    return res.json({ success:true, staff: r.rows });
  } catch (err) {
    console.error('/api/admin/staff/list', err && err.stack ? err.stack : err);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});

/**
 * Remove staff
 */
app.delete('/api/admin/staff/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM staff WHERE id = $1', [id]);
    return res.json({ success:true, message: 'Staff removed' });
  } catch (err) {
    console.error('/api/admin/staff/:id', err && err.stack ? err.stack : err);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});


app.post('/api/job/:id/message', async (req, res) => {
  try {
    const jobId = req.params.id;
    const { senderId, text, metadata } = req.body || {};
    if(!jobId) return res.status(400).json({ success:false, message:'job id required' });
    if(!senderId || !text) return res.status(400).json({ success:false, message:'senderId and text required' });

    // verify job exists
    const j = await pool.query(`SELECT id FROM jobs WHERE id=$1`, [jobId]);
    if(!j.rows.length) return res.status(404).json({ success:false, message:'Job not found' });

    const ins = await pool.query(
      `INSERT INTO messages (job_id, sender_id, text, metadata) VALUES ($1,$2,$3,$4) RETURNING id, job_id, sender_id, text, metadata, created_at`,
      [jobId, senderId, text, metadata || null]
    );

    // Return created message object
    return res.json({ success:true, message: ins.rows[0] });
  } catch(err) {
    console.error('POST /api/job/:id/message', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// root
app.get('/', (req,res)=> res.send('WireConnect backend (with Profile & KYC) running'));

// start
app.listen(PORT, ()=> console.log(`WireConnect backend listening on port ${PORT}`));