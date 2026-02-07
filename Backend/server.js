// server.js
// Requirements:
// npm i express cors bcryptjs pg dotenv
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

// open CORS
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' })); // allow some room for base64 if demo

// DB init & migrations (idempotent)
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
  assigned_tech_id TEXT REFERENCES users(id), -- primary assigned (legacy)
  assigned_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  workers_needed INTEGER DEFAULT 1,
  estimated_days INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  -- new columns for better assignment handling
  declined_techs TEXT[] DEFAULT '{}',
  notified_techs TEXT[] DEFAULT '{}',
  seen_by_tech TEXT[] DEFAULT '{}',
  assigned_tech_ids TEXT[] DEFAULT '{}', -- allows multiple technicians to be attached
  accepted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS kyc_requests (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  id_type TEXT,
  id_number TEXT,
  id_images TEXT[],
  work_video TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  decided_at TIMESTAMP WITH TIME ZONE
);

-- messages table (if missing in older DBs)
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
`;

// Ensure older DBs have the new columns (safe ALTER statements)
const alterSql = `
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workers_needed INTEGER DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_days INTEGER DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS declined_techs TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notified_techs TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seen_by_tech TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_tech_ids TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE;
`;


(async ()=> {
  try{
    await pool.query(initSql);
    await pool.query(alterSql);
    console.log('DB ready.');
  } catch(err){
    console.error('DB init error', err);
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

  // read job to find already-declined
  let jobRow;
  try {
    const r = await pool.query(`SELECT id, declined_techs, notified_techs, assigned_tech_id, assigned_tech_ids, workers_needed FROM jobs WHERE id=$1`, [jobId]);
    if(!r.rows.length){
      return false;
    }
    jobRow = r.rows[0];
  } catch(err) {
    console.error('attemptAssign read job error', err);
    return false;
  }

  const declined = Array.isArray(jobRow.declined_techs) ? jobRow.declined_techs : [];
  const alreadyAssignedIds = Array.isArray(jobRow.assigned_tech_ids) ? jobRow.assigned_tech_ids : [];

  // find next candidate that is not in declined list and not already offered/assigned
  let candidateIndex = -1;
  for(let i = attemptIndex; i < techs.length; i++){
    const t = techs[i];
    if(!t || !t.id) continue;
    if(declined.includes(t.id)) continue;
    if(alreadyAssignedIds.includes(t.id)) continue;
    candidateIndex = i; break;
  }

  if(candidateIndex === -1){
    // no one available
    await pool.query(`UPDATE jobs SET status='pending_assignment' WHERE id=$1`, [jobId]);
    return false;
  }

  const tech = techs[candidateIndex];
  const clientConn = await pool.connect();
  try {
    const now = new Date();
    // expiry window for technician acceptance: 3 minutes (user requested)
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000);

    // Try to "reserve" the job for this technician if job is still create/pending_assignment
    const res = await clientConn.query(`
      UPDATE jobs
      SET assigned_tech_id=$1, status='pending_accept', assigned_at=now(), expires_at=$2, notified_techs = array_append(COALESCE(notified_techs, '{}'::text[]), $1)
      WHERE id=$3 AND status IN ('created','pending_assignment')
      RETURNING *
    `, [tech.id, expiresAt.toISOString(), jobId]);

    if(!res.rows.length) {
      // reservation failed (someone else took it) -> try next
      return await attemptAssign(jobId, techs, candidateIndex + 1);
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
          // mark this tech as declined (did not respond) and release assignment
          await pool.query(`
            UPDATE jobs
            SET status='pending_assignment',
                assigned_tech_id=NULL,
                assigned_at=NULL,
                expires_at=NULL,
                declined_techs = array_append(COALESCE(declined_techs, '{}'::text[]), $1)
            WHERE id=$2
          `, [tech.id, jobId]);

          // attempt next tech (fire and forget)
          try{
            // build a fresh tech list from online users in same state (safer than reusing stale array)
            const j = (await pool.query(`SELECT state, lat, lng FROM jobs WHERE id=$1`, [jobId])).rows[0];
            if(j){
              const rows = (await pool.query(`SELECT id, lat, lng FROM users WHERE role='worker' AND online=true AND state=$1`, [j.state])).rows;
              const techsWithDist = rows
                .filter(t2 => t2.lat && t2.lng && j.lat && j.lng)
                .map(t2 => ({ id:t2.id, lat:t2.lat, lng:t2.lng, distance: distanceMeters(j.lat, j.lng, t2.lat, t2.lng) }))
                .sort((a,b)=>a.distance-b.distance);
              await attemptAssign(jobId, techsWithDist, 0);
            }
          }catch(e){ /* ignore */ }
        }
      }catch(e){ console.error('timeout handler error', e); }
    }, 3 * 60 * 1000); // 3 minutes

    // Return tech profile to caller so frontend can display immediately
    return trow || { id: tech.id };
  } finally {
    clientConn.release();
  }
}

// ------------------ End helpers ------------------

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

// Login
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

      const safeUser = {
        id: user.id, role: user.role, email: user.email, phone: user.phone,
        fullname: user.fullname, username: user.username, state: user.state, lga: user.lga,
        city: user.city, gender: user.gender, specializations: user.specializations, kyc_status: user.kyc_status,
        avatar_url: user.avatar_url, profile_complete: user.profile_complete,
        account_details: user.account_details, online: user.online, lat: user.lat, lng: user.lng, created_at: user.created_at
      };

      return res.json({ success:true, message:'Login successful', user: safeUser });
    } finally { client.release(); }
  }catch(e){
    console.error('Server error /api/login', e);
    return res.status(500).json({ success:false, message:'Server error' });
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
      price,
      workers_needed
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
      (id, client_id, state, city, address, lat, lng, job_type, description, price, status, workers_needed)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      'created',
      Number.isFinite(Number(workers_needed)) ? Number(workers_needed) : 1
    ]);

    // Fetch technicians (candidates) in the state who are online
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
// By default, return only jobs that are pending_accept AND not already seen by the tech
// Use ?includeSeen=true to include seen ones.
app.get('/api/assigned-jobs', async (req,res)=>{
  try{
    const techId = req.query.techId;
    const includeSeen = (req.query.includeSeen === 'true' || req.query.includeSeen === '1');
    if(!techId) return res.status(400).json({ success:false, message:'techId required' });

    if(includeSeen){
      const rows = (await pool.query(`SELECT j.* FROM jobs j WHERE j.assigned_tech_id = $1 AND j.status = 'pending_accept' ORDER BY j.assigned_at DESC`, [techId])).rows;
      return res.json({ success:true, jobs: rows });
    } else {
      // only jobs not yet marked seen by this tech
      const rows = (await pool.query(`
        SELECT j.* FROM jobs j
        WHERE j.assigned_tech_id = $1
          AND j.status = 'pending_accept'
          AND (NOT ($1 = ANY(COALESCE(j.seen_by_tech, '{}'::text[]))))
        ORDER BY j.assigned_at DESC
      `, [techId])).rows;
      return res.json({ success:true, jobs: rows });
    }
  }catch(e){ console.error('/api/assigned-jobs', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Mark job as seen by technician (so the server knows the tech has been notified and won't re-offer)
app.post('/api/job/:id/mark-seen', async (req,res) => {
  try{
    const jobId = req.params.id;
    const { techId } = req.body || {};
    if(!jobId || !techId) return res.status(400).json({ success:false, message:'job id and techId required' });

    await pool.query(`
      UPDATE jobs
      SET seen_by_tech = (
        CASE
          WHEN NOT ($1 = ANY(COALESCE(seen_by_tech, '{}'::text[]))) THEN array_append(COALESCE(seen_by_tech, '{}'::text[]), $1)
          ELSE seen_by_tech
        END
      )
      WHERE id=$2
    `, [techId, jobId]);

    return res.json({ success:true, message:'Marked seen' });
  }catch(e){ console.error('/api/job/:id/mark-seen', e); return res.status(500).json({ success:false, message:'Server error' }); }
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
      if(job.assigned_tech_id !== techId){
        // allow accept if tech is in assigned_tech_ids (for multi-worker acceptance) OR is the assigned_tech_id
        const assignedIds = Array.isArray(job.assigned_tech_ids) ? job.assigned_tech_ids : [];
        if(!assignedIds.includes(techId)){
          return res.status(403).json({ success:false, message:'Not assigned to this technician' });
        }
      }

      if(action === 'accept'){
        // If job expects multiple workers, append to assigned_tech_ids and check completion
        const needed = Number(job.workers_needed || 1);
        const current = Array.isArray(job.assigned_tech_ids) ? job.assigned_tech_ids.slice() : [];
        // ensure techId not duplicated
        if(!current.includes(techId)) current.push(techId);

        // Update DB: add tech to assigned_tech_ids (if not present)
        await clientConn.query(`
          UPDATE jobs
          SET assigned_tech_ids = (
            CASE WHEN NOT ($1 = ANY(COALESCE(assigned_tech_ids,'{}'::text[]))) THEN array_append(COALESCE(assigned_tech_ids,'{}'::text[]), $1) ELSE assigned_tech_ids END
          )
          WHERE id=$2
        `, [techId, jobId]);

        // refetch to get updated array length
        const after = (await clientConn.query(`SELECT assigned_tech_ids, workers_needed FROM jobs WHERE id=$1`, [jobId])).rows[0];
        const updatedAssigned = Array.isArray(after.assigned_tech_ids) ? after.assigned_tech_ids : [];
        const updatedLen = updatedAssigned.length;

        if(updatedLen >= (Number(after.workers_needed) || 1)){
          // we have enough technicians -> mark job accepted
          await clientConn.query(`UPDATE jobs SET status='accepted', accepted_at=now(), expires_at=NULL WHERE id=$1`, [jobId]);
        } else {
          // still waiting for more techs; keep status as pending_assignment or 'partial' depending on your choice
          // We'll set status to 'partial' to indicate some acceptances received but not complete
          await clientConn.query(`UPDATE jobs SET status='partial' WHERE id=$1`, [jobId]);

          // Try to assign more technicians to fill remaining slots
          try {
            const j = (await clientConn.query(`SELECT state, lat, lng FROM jobs WHERE id=$1`, [jobId])).rows[0];
            if(j){
              const rows = (await clientConn.query(`SELECT id, lat, lng FROM users WHERE role='worker' AND online=true AND state=$1`, [j.state])).rows;
              let techsWithDist = rows
                .filter(t2 => t2.lat && t2.lng && j.lat && j.lng)
                .map(t2 => ({ id: t2.id, lat: t2.lat, lng: t2.lng, distance: distanceMeters(j.lat, j.lng, t2.lat, t2.lng) }))
                .sort((a,b) => a.distance - b.distance);

              // exclude any already declined or already in assigned_tech_ids
              const declined = Array.isArray(job.declined_techs) ? job.declined_techs : [];
              const exclude = new Set([...(Array.isArray(job.assigned_tech_ids)?job.assigned_tech_ids:[]), ...declined, ...updatedAssigned]);
              techsWithDist = techsWithDist.filter(t => !exclude.has(t.id));

              // attempt assign for remaining
              await attemptAssign(jobId, techsWithDist, 0);
            }
          } catch(e){ console.warn('attempt additional assignment after accept error', e); }
        }

        return res.json({ success:true, message:'Job accepted' });

      } else {
        // decline -> mark this tech id as declined and try next technician
        await clientConn.query(`
          UPDATE jobs
          SET status='pending_assignment', assigned_tech_id=NULL, assigned_at=NULL, expires_at=NULL,
              declined_techs = array_append(COALESCE(declined_techs, '{}'::text[]), $1)
          WHERE id=$2
        `, [techId, jobId]);

        // Now attempt assign to next available techs
        try{
          const j = (await clientConn.query(`SELECT state, lat, lng FROM jobs WHERE id=$1`, [jobId])).rows[0];
          if(j){
            const rows = (await clientConn.query(`SELECT id, lat, lng FROM users WHERE role = 'worker' AND online = true AND state = $1`, [j.state])).rows;
            let techsWithDist = rows.map(t => ({ id: t.id, lat: t.lat, lng: t.lng, distance: distanceMeters(j.lat, j.lng, t.lat, t.lng) }));
            techsWithDist = techsWithDist.filter(t => t.id !== techId).sort((a,b)=>a.distance-b.distance);
            await attemptAssign(jobId, techsWithDist);
          }
        }catch(e){ /* ignore */ }

        return res.json({ success:true, message:'Job declined; assigning next technician' });
      }
    } finally { clientConn.release(); }
  }catch(e){ console.error('/api/job/:id/respond', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Job status (client)
app.get('/api/job/:id/status', async (req,res)=>{
  try{
    const jobId = req.params.id;
    const r = await pool.query(`SELECT id,status,assigned_tech_id,assigned_tech_ids,assigned_at,expires_at, estimated_days, workers_needed FROM jobs WHERE id=$1`, [jobId]);
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
    // fetch technician profile(s) if assigned
    let techRows = [];
    if(job.assigned_tech_id){
      const single = (await pool.query(`SELECT id, fullname, username, phone, email, lat, lng, state, city FROM users WHERE id=$1`, [job.assigned_tech_id])).rows[0] || null;
      if(single) techRows.push(single);
    }
    if(Array.isArray(job.assigned_tech_ids) && job.assigned_tech_ids.length){
      const ids = job.assigned_tech_ids.filter(Boolean);
      if(ids.length){
        const resTechs = (await pool.query(`SELECT id, fullname, username, phone, email, lat, lng, state, city FROM users WHERE id = ANY($1::text[])`, [ids])).rows;
        techRows = techRows.concat(resTechs);
      }
    }

    return res.json({ success:true, job, client: clientRow, technicians: techRows });
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

// Submit KYC
app.post('/api/kyc/submit', async (req,res)=>{
  try{
    const { userId, id_type, id_number, id_images, work_video, notes } = req.body || {};
    if(!userId || !id_type || !id_number || !Array.isArray(id_images) || id_images.length === 0){
      return res.status(400).json({ success:false, message:'userId, id_type, id_number and at least one id_images required' });
    }
    const client = await pool.connect();
    try{
      const usr = (await client.query(`SELECT id FROM users WHERE id=$1`, [userId])).rows[0];
      if(!usr) return res.status(404).json({ success:false, message:'User not found' });

      const ins = await client.query(`INSERT INTO kyc_requests (user_id, id_type, id_number, id_images, work_video, notes, status) VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id, submitted_at`, [userId, id_type, id_number, id_images, work_video||null, notes||null]);
      const reqId = ins.rows[0].id;

      await client.query(`UPDATE users SET kyc_status='pending', kyc_documents=$1, kyc_submitted_at=now() WHERE id=$2`, [id_images, userId]);

      return res.json({ success:true, message:'KYC submitted and pending review', requestId: reqId });
    } finally { client.release(); }
  }catch(e){ console.error('/api/kyc/submit', e); return res.status(500).json({ success:false, message:'Server error' }); }
});

// Get user's KYC status
app.get('/api/kyc/status/:userId', async (req,res)=>{
  try{
    const userId = req.params.userId;
    const r = await pool.query(`SELECT kyc_status, kyc_documents, kyc_submitted_at FROM users WHERE id=$1`, [userId]);
    if(!r.rows.length) return res.status(404).json({ success:false, message:'User not found' });
    return res.json({ success:true, status: r.rows[0] });
  }catch(e){ console.error('/api/kyc/status/:userId', e); return res.status(500).json({ success:false, message:'Server error' }); }
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

      return res.json({ success:true, message:\`KYC \${newStatus}\` });
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