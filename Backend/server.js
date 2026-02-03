// server.js
// Minimal Express + Postgres backend for WireConnect registration & login
// OPEN CORS version (no origin restrictions)
// Usage:
// 1) npm init -y
// 2) npm install express cors bcryptjs pg dotenv
// 3) set env var DATABASE_URL (Postgres connection string) in .env or environment
// 4) node server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres pool from DATABASE_URL env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // if using self-signed or local dev, you might need ssl:false; production typically uses ssl:true
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized:false } : false
});

// === OPEN CORS ===
// Allow all origins and credentials (no origin restrictions)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Ensure users table exists (simple migration)
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
`;
pool.query(initSql).catch(err => {
  console.error('Failed to ensure users table exists:', err);
  process.exit(1);
});

// Helpers
function validEmail(email){
  return /\S+@\S+\.\S+/.test(email || '');
}
function validPhone(ph){
  if(!ph) return false;
  const cleaned = ph.replace(/\s+/g,'');
  return /^(?:\+234|0)?\d{10}$/.test(cleaned);
}
function uid(){
  return Math.floor(1000000000 + Math.random()*9000000000).toString();
}

// POST /api/register
app.post('/api/register', async (req, res) => {
  try {
    const {
      role, email, phone, fullname, username,
      state, lga, city, gender, specializations, password
    } = req.body || {};

    // server-side validation
    if(!email || !validEmail(email)) return res.status(400).json({ success:false, message:'Invalid email' });
    if(!phone || !validPhone(phone)) return res.status(400).json({ success:false, message:'Invalid phone' });
    if(!fullname || fullname.trim().length < 3) return res.status(400).json({ success:false, message:'Invalid full name' });
    if(!username || username.trim().length < 3) return res.status(400).json({ success:false, message:'Invalid username' });
    if(!state || !lga || !city) return res.status(400).json({ success:false, message:'State/LGA/City required' });
    if(!password || password.length < 6) return res.status(400).json({ success:false, message:'Password must be at least 6 characters' });

    // duplicates check using queries
    const client = await pool.connect();
    try {
      // Use parameterized queries to avoid injection
      const dupQuery = `
        SELECT email, username, phone FROM users
        WHERE email = $1 OR username = $2 OR phone = $3
        LIMIT 1
      `;
      const dupRes = await client.query(dupQuery, [email, username, phone]);
      if(dupRes.rows.length){
        return res.status(409).json({ success:false, message: 'Email, username or phone already exists' });
      }

      // hash password
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);

      const newUser = {
        id: uid(),
        role: role || 'client',
        email,
        phone,
        fullname,
        username,
        state,
        lga,
        city,
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
        newUser.id,
        newUser.role,
        newUser.email,
        newUser.phone,
        newUser.fullname,
        newUser.username,
        newUser.state,
        newUser.lga,
        newUser.city,
        newUser.gender,
        newUser.specializations,
        newUser.password_hash,
        newUser.kyc_status
      ]);

      return res.json({ success:true, message:'Account created successfully' });

    } finally {
      client.release();
    }

  } catch(err){
    console.error('Server error /api/register', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// POST /api/login
app.post('/api/login', async (req,res) => {
  try {
    const { login, password } = req.body;

    if(!login || !password){
      return res.status(400).json({ success:false, message:'Login and password required' });
    }

    const client = await pool.connect();
    try {
      // find user by email OR username OR phone
      const query = `
        SELECT * FROM users 
        WHERE email=$1 OR username=$1 OR phone=$1
        LIMIT 1
      `;
      const result = await client.query(query, [login]);

      if(!result.rows.length){
        return res.status(404).json({ success:false, message:'User not found' });
      }

      const user = result.rows[0];

      // check password
      const match = await bcrypt.compare(password, user.password_hash);
      if(!match){
        return res.status(401).json({ success:false, message:'Incorrect password' });
      }

      // Success — remove sensitive fields before sending
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
        created_at: user.created_at
      };

      console.log(`✅ User logged in: ${user.username}`);

      return res.json({ success:true, message:'Login successful', user: safeUser });

    } finally {
      client.release();
    }

  } catch(err){
    console.error('Server error /api/login', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.get('/', (req,res)=> res.send('WireConnect backend (Postgres) running'));

// start server
app.listen(PORT, ()=> {
  console.log(`WireConnect backend listening on http://localhost:${PORT}`);
});