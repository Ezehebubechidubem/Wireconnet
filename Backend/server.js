// server.js
// WireConnect backend (extended): register, login, dashboard, booking + job acceptance
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized:false } : false
});

// OPEN CORS for your workflow
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- DB setup / migrations (idempotent) ---
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
  kyc_status TEXT DEFAULT 'not_required',
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
  status TEXT NOT NULL DEFAULT 'created', -- created, pending_assignment, pending_accept, accepted, declined, in_progress, completed, cancelled
  assigned_tech_id TEXT REFERENCES users(id),
  assigned_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
`;

// run initialization
(async ()=>{
  try{
    await pool.query(initSql);
    // ensure online/lat/lng columns exist in users (for tech location & availability)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS online boolean DEFAULT false;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lat double precision;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lng double precision;`);
    console.log('DB initialized/migrated.');
  } catch(err){
    console.error('DB init error', err);
    process.exit(1);
  }
})();

// --- Helpers ---
function validEmail(email){ return /\S+@\S+\.\S+/.test(email || ''); }
function validPhone(ph){ if(!ph) return false; const cleaned = ph.replace(/\s+/g,''); return /^(?:\+234|0)?\d{10}$/.test(cleaned); }
function uid(){ return Math.floor(1000000000 + Math.random()*9000000000).toString(); }

// Haversine distance (meters)
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

// attemptAssign will try technicians in order (techs array = rows with id, lat, lng)
async function attemptAssign(jobId, techs, attemptIndex = 0){
  if(attemptIndex >= techs.length){
    // no available techs
    console.log('No more techs to assign for job', jobId);
    await pool.query(`UPDATE jobs SET status='pending_assignment' WHERE id=$1`, [jobId]);
    return false;
  }

  const tech = techs[attemptIndex];
  const client = await pool.connect();
  try {
    // Try to set assigned_tech_id only if job still in assignable state
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60*1000); // 60s acceptance window
    const res = await client.query(`
      UPDATE jobs
      SET assigned_tech_id=$1, status='pending_accept', assigned_at=now(), expires_at=$2
      WHERE id=$3 AND status IN ('created','pending_assignment')
      RETURNING *`, [tech.id, expiresAt.toISOString(), jobId]);

    if(!res.rows.length){
      // job changed meanwhile; skip
      console.log('Job not assignable now', jobId);
      return false;
    }

    console.log('Assigned job', jobId, 'to tech', tech.id, 'expires at', expiresAt.toISOString());

    // Setup server-side timeout: if technician doesn't accept in 60s, mark as declined and try next
    setTimeout(async ()=>{
      try{
        const check = await pool.query(`SELECT status, assigned_tech_id FROM jobs WHERE id=$1`, [jobId]);
        if(!check.rows.length) return;
        const js = check.rows[0];
        if(js.status === 'pending_accept' && js.assigned_tech_id === tech.id){
          // timed out -> treat as decline and try next
          console.log('Tech timed out; auto-declining', tech.id, 'for job', jobId);
          await pool.query(`UPDATE jobs SET status='pending_assignment', assigned_tech_id=NULL, assigned_at=NULL, expires_at=NULL WHERE id=$1`, [jobId]);
          // try next
          await attemptAssign(jobId, techs, attemptIndex + 1);
        }
      }catch(e){ console.error('timeout handler error', e); }
    }, 60*1000);

    // success for now (waiting for technician action)
    return true;

  } finally {
    client.release();
  }
}

// --- ROUTES ---

// Registration (unchanged)
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
        kyc_status: (role === 'worker') ? 'pending' : 'not_required'
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

// Login (unchanged)
app.post('/api/login', async (req,res) =>{
  try{
    const { login, password } = req.body;
    if(!login || !password) return res.status(400).json({ success:false, message:'Login and password required' });

    const client = await pool.connect();
    try {
      const q = `SELECT * FROM users WHERE email=$1 OR username=$1 OR phone=$1 LIMIT 1`;
      const r = await client.query(q, [login]);
      if(!r.rows.length) return res.status(404).json({ success:false, message:'User not found' });
      const user = r.rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if(!ok) return res.status(401).json({ success:false, message:'Incorrect password' });

      // mask sensitive
      const safeUser = {
        id: user.id, role: user.role, email: user.email, phone: user.phone,
        fullname: user.fullname, username: user.username, state: user.state, lga: user.lga,
        city: user.city, gender: user.gender, specializations: user.specializations, kyc_status: user.kyc_status,
        online: user.online || false, lat: user.lat, lng: user.lng, created_at: user.created_at
      };

      return res.json({ success:true, message:'Login successful', user: safeUser });

    } finally { client.release(); }
  }catch(e){
    console.error('Server error /api/login', e);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// Dashboard data (announcements + articles + leaderboard)
app.get('/api/dashboard', async (req,res)=>{
  try{
    // optional: accept ?role=technician|client
    const role = (req.query.role || 'client');

    const client = await pool.connect();
    try{
      const ann = (await client.query(`SELECT id,title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 10`)).rows;
      const art = (await client.query(`SELECT id,title,excerpt,created_at FROM articles ORDER BY created_at DESC LIMIT 10`)).rows;

      // leaderboard: top technicians by number of accepted jobs
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

      return res.json({
        success:true,
        announcements: ann,
        articles: art,
        leaderboard: role === 'worker' ? techLeaderboard : clientLeaderboard
      });
    } finally { client.release(); }
  }catch(e){ console.error('err /api/dashboard', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Technician updates status + location
app.post('/api/tech/status', async (req,res) => {
  try{
    const { techId, online, lat, lng } = req.body;
    if(!techId) return res.status(400).json({ success:false, message:'techId required' });
    await pool.query(`UPDATE users SET online=$1, lat=$2, lng=$3 WHERE id=$4`, [!!online, lat || null, lng || null, techId]);
    return res.json({ success:true, message:'Status updated' });
  }catch(e){ console.error('/api/tech/status', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Client books a job -> server attempts to assign nearest online technicians in same state
app.post('/api/book', async (req,res)=>{
  try{
    const {
      clientId, state, city, address, lat, lng, job_type, description, price
    } = req.body || {};

    if(!clientId || !state) return res.status(400).json({ success:false, message:'clientId and state required' });

    const jobId = uid();
    await pool.query(`INSERT INTO jobs (id, client_id, state, city, address, lat, lng, job_type, description, price, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [jobId, clientId, state, city || null, address || null, lat || null, lng || null, job_type || null, description || null, price || null, 'created']);

    // find candidate technicians: online, same state, not assigned currently busy.
    const techRows = (await pool.query(`
      SELECT id, lat, lng FROM users
      WHERE role = 'worker' AND online = true AND state = $1 AND id IS NOT NULL
    `, [state])).rows;

    // if no lat/lng provided for client, just order by null distance (server-side)
    // compute distances (closest first)
    let techsWithDist = techRows.map(t => {
      const d = distanceMeters(lat, lng, t.lat, t.lng);
      return { id: t.id, lat: t.lat, lng: t.lng, distance: d };
    });
    techsWithDist.sort((a,b)=>a.distance - b.distance);

    // attempt assign sequence
    if(techsWithDist.length === 0){
      // no techs; leave job pending assignment
      await pool.query(`UPDATE jobs SET status='pending_assignment' WHERE id=$1`, [jobId]);
      return res.json({ success:true, message:'Job created but no technicians currently available', jobId });
    } else {
      // try assign to first tech (attemptAssign will set expiration + fallback)
      const ok = await attemptAssign(jobId, techsWithDist);
      if(ok){
        return res.json({ success:true, message:'Job created and assigned (pending acceptance)', jobId });
      } else {
        return res.json({ success:true, message:'Job created, could not assign immediately', jobId });
      }
    }
  }catch(e){ console.error('/api/book', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Technician polls assigned pending jobs for them (pending_accept)
app.get('/api/assigned-jobs', async (req,res)=>{
  try{
    const techId = req.query.techId;
    if(!techId) return res.status(400).json({ success:false, message:'techId required' });

    const rows = (await pool.query(`
      SELECT j.* FROM jobs j
      WHERE j.assigned_tech_id = $1 AND j.status = 'pending_accept'
      ORDER BY j.assigned_at DESC
    `, [techId])).rows;

    return res.json({ success:true, jobs: rows });
  }catch(e){ console.error('/api/assigned-jobs', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Technician responds to assigned job: accept or decline
app.post('/api/job/:id/respond', async (req,res)=>{
  try{
    const jobId = req.params.id;
    const { techId, action } = req.body; // action = 'accept'|'decline'
    if(!techId || !action) return res.status(400).json({ success:false, message:'techId and action required' });
    if(!['accept','decline'].includes(action)) return res.status(400).json({ success:false, message:'invalid action' });

    const client = await pool.connect();
    try{
      // fetch job
      const q = await client.query(`SELECT * FROM jobs WHERE id=$1`, [jobId]);
      if(!q.rows.length) return res.status(404).json({ success:false, message:'Job not found' });
      const job = q.rows[0];

      if(job.assigned_tech_id !== techId) return res.status(403).json({ success:false, message:'Not assigned to this technician' });

      if(action === 'accept'){
        // set job accepted
        await client.query(`UPDATE jobs SET status='accepted', expires_at=NULL WHERE id=$1`, [jobId]);
        return res.json({ success:true, message:'Job accepted' });
      } else {
        // decline -> reset assignment and attempt next tech
        await client.query(`UPDATE jobs SET status='pending_assignment', assigned_tech_id=NULL, assigned_at=NULL, expires_at=NULL WHERE id=$1`, [jobId]);

        // find the next technicians (same algorithm as earlier)
        const techRows = (await client.query(`
          SELECT id, lat, lng FROM users
          WHERE role = 'worker' AND online = true AND state = $1 AND id IS NOT NULL
        `, [job.state])).rows;

        // compute distances and sort
        let techsWithDist = techRows.map(t => ({ id: t.id, lat: t.lat, lng: t.lng, distance: distanceMeters(job.lat, job.lng, t.lat, t.lng) }));
        // filter out the just-declined tech
        techsWithDist = techsWithDist.filter(t => t.id !== techId);
        techsWithDist.sort((a,b)=>a.distance - b.distance);

        // attempt assign to next
        await attemptAssign(jobId, techsWithDist);
        return res.json({ success:true, message:'Job declined; assigning next technician' });
      }

    } finally { client.release(); }
  }catch(e){ console.error('/api/job/:id/respond', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// get job status (client)
app.get('/api/job/:id/status', async (req,res)=>{
  try{
    const jobId = req.params.id;
    const r = await pool.query(`SELECT id,status,assigned_tech_id,assigned_at,expires_at FROM jobs WHERE id=$1`, [jobId]);
    if(!r.rows.length) return res.status(404).json({ success:false, message:'Not found' });
    return res.json({ success:true, job: r.rows[0] });
  }catch(e){ console.error('/api/job/:id/status', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// root
app.get('/', (req,res)=> res.send('WireConnect backend (extended) running'));

// start
app.listen(PORT, ()=> console.log(`WireConnect backend listening on port ${PORT}`));