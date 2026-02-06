<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>WireConnect — Book Job</title>
  <style>
    :root{
      --bg:#f6f8fb;
      --card:#fff;
      --accent:#0b5cff;
      --muted:#6b7280;
      --shadow: 0 8px 30px rgba(16,24,40,0.06);
      --radius:12px;
    }
    html,body{height:100%;margin:0}
    body{
      font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
      background:var(--bg);
      color:#111827;
      display:flex;
      justify-content:center;
      align-items:flex-start;
      padding:18px;
    }

    .wrap{
      width:100%;
      max-width:980px;
      background:var(--card);
      border-radius:12px;
      padding:0;
      box-shadow:var(--shadow);
      box-sizing:border-box;
      overflow:hidden;
    }

    .header-logo img{ width:100%; height:120px; object-fit:cover; display:block; }

    .content { padding:18px; }
    h1{ margin:0; font-size:20px; font-weight:800; font-style:italic; }
    .muted{ color:var(--muted); font-size:13px; }
    label{ display:block; margin-bottom:6px; font-size:14px; font-weight:700 }
    input, select, textarea { width:100%; padding:10px; border-radius:8px; border:1px solid #eef3fb; box-sizing:border-box; margin-bottom:8px; font-size:14px; }
    textarea{ font-family:inherit; min-height:100px; }

    .controls { display:flex; gap:8px; align-items:center; margin-top:8px; flex-wrap:wrap; }
    .btn{ background:var(--accent); color:white; border:0; padding:10px 14px; border-radius:10px; cursor:pointer; font-weight:800 }
    .btn-ghost{ background:transparent; border:1px solid #e6eef9; padding:8px 12px; border-radius:8px; cursor:pointer }
    .estimate{ background:#f0f7ff; padding:10px; border-radius:8px; margin-bottom:8px; font-weight:700 }
    .small{ font-size:13px; color:var(--muted) }

    /* modal styles */
    .modal-backdrop{ position:fixed; inset:0; background:rgba(0,0,0,0.35); display:none; align-items:center; justify-content:center; z-index:9999; }
    .modal{ width:92%; max-width:560px; background:#fff; border-radius:12px; padding:18px; box-shadow:0 12px 48px rgba(2,6,23,0.4); text-align:center; }
    .spinner{ width:64px; height:64px; border-radius:50%; border:8px solid #eef6ff; border-top-color:var(--accent); animation:spin 1s linear infinite; margin:10px auto }
    @keyframes spin{ to{ transform:rotate(360deg) } }
    .tech-card{ display:flex; align-items:center; gap:12px; padding:10px; border-radius:10px; border:1px solid #eef6ff; background:#fbfeff; margin-top:10px }
    .tech-avatar{ width:64px; height:64px; border-radius:10px; object-fit:cover; background:#f0f3ff }
    .modal h3{ margin:0 0 8px; font-size:18px }
    .modal .muted{ color:#374151; margin-bottom:8px; }

    @media(max-width:680px){ .controls{flex-direction:column;align-items:stretch} }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header-logo"><img src="https://i.postimg.cc/ZRSK3pJx/IMG-20260202-144108.png" alt="WireConnect logo"></div>
    <div class="content">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div><h1>Book a Job</h1><div class="muted" id="userGreeting">—</div></div>
        <div style="align-self:flex-start"><a href="dashboard.html" style="text-decoration:none;color:var(--accent);font-weight:800">← Back to dashboard</a></div>
      </div>

      <!-- booking form -->
      <label>Choose job type</label>
      <select id="jobType">
        <option value="conduit">Conduit wiring</option>
        <option value="solar">Solar installation</option>
        <option value="other">Other (custom)</option>
      </select>

      <div id="conduitFields" style="margin-top:8px">
        <label>Number of rooms</label>
        <input id="conduitRooms" type="number" min="1" value="1">
        <label><input id="conduitDB" type="checkbox"> Include DB mounting (₦15,000)</label>
        <label><input id="conduitNEPA" type="checkbox"> Include NEPA connection (₦50,000)</label>
        <label><input id="conduitWiringAdd" type="checkbox"> Add extra wiring (₦5,000 per room)</label>
        <label><input id="conduitFittings" type="checkbox"> Include fittings (₦15,000 per room)</label>
      </div>

      <div id="solarFields" class="hidden" style="margin-top:8px">
        <label>Building type</label>
        <select id="solarBuilding"><option value="bungalow">Bungalow (base)</option><option value="one_story">1 storey</option><option value="two_plus">2+ storey</option></select>
        <label><input id="solarComplex" type="checkbox"> Complex roof / high access (+₦50,000)</label>
      </div>

      <div id="otherFields" class="hidden" style="margin-top:8px">
        <label>Job name</label>
        <input id="otherName" type="text" placeholder="e.g. Plumbing, AC install">
      </div>

      <!-- NEW inputs requested: State, LGA, Town/City, workers, estimated days -->
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:8px;">
        <div>
          <label>State</label>
          <input id="stateInput" type="text" placeholder="e.g. Lagos">
        </div>
        <div>
          <label>LGA</label>
          <input id="lgaInput" type="text" placeholder="e.g. Ikeja">
        </div>
        <div>
          <label>Town / City</label>
          <input id="cityInput" type="text" placeholder="e.g. Lagos Island">
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">
        <div>
          <label>Number of workers needed</label>
          <input id="workersNeeded" type="number" min="1" value="1">
        </div>
        <div>
          <label>Estimated days to finish</label>
          <input id="estimatedDays" type="number" min="1" value="1">
        </div>
      </div>

      <label style="margin-top:8px">Small description (max 500 words)</label>
      <textarea id="description" rows="5" placeholder="Describe the job — location, constraints, etc."></textarea>

      <div class="controls">
        <button id="calcBtn" class="btn" title="Estimate price">Calculate estimate</button>
        <button id="submitBtn" class="btn-ghost" title="Submit booking">Submit booking</button>
        <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
          <div style="background:#f3f8ff; border-radius:8px; padding:10px 12px; border:1px solid #eef3fb; color:var(--muted)">₦</div>
          <div id="priceDisplay" style="font-weight:800;font-size:16px">—</div>
        </div>
        <label style="margin-left:12px;align-self:center"><input id="useAssign" type="checkbox"> use /api/book-assign</label>
      </div>

      <div style="height:12px"></div>
      <div class="estimate" id="estimateBox"><em>Estimate:</em> —</div>
    </div>
  </div>

  <!-- modal -->
  <div id="modalBackdrop" class="modal-backdrop" role="dialog" aria-modal="true" aria-hidden="true">
    <div class="modal" role="document" aria-labelledby="modalTitle">
      <div id="modalContent"></div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
        <button id="modalClose" class="btn-ghost" style="display:none">Close</button>
        <button id="modalOk" class="btn" style="display:none">OK</button>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = 'https://wireconnet-1.onrender.com';

    // DOM refs
    const jobType = document.getElementById('jobType');
    const conduitFields = document.getElementById('conduitFields');
    const solarFields = document.getElementById('solarFields');
    const otherFields = document.getElementById('otherFields');
    const conduitRooms = document.getElementById('conduitRooms');
    const conduitDB = document.getElementById('conduitDB');
    const conduitNEPA = document.getElementById('conduitNEPA');
    const conduitWiringAdd = document.getElementById('conduitWiringAdd');
    const conduitFittings = document.getElementById('conduitFittings');
    const solarBuilding = document.getElementById('solarBuilding');
    const solarComplex = document.getElementById('solarComplex');
    const otherName = document.getElementById('otherName');
    const description = document.getElementById('description');
    const calcBtn = document.getElementById('calcBtn');
    const submitBtn = document.getElementById('submitBtn');
    const estimateBox = document.getElementById('estimateBox');
    const priceDisplay = document.getElementById('priceDisplay');

    const stateInput = document.getElementById('stateInput');
    const lgaInput = document.getElementById('lgaInput');
    const cityInput = document.getElementById('cityInput');
    const workersNeeded = document.getElementById('workersNeeded');
    const estimatedDays = document.getElementById('estimatedDays');
    const useAssign = document.getElementById('useAssign');

    const modalBackdrop = document.getElementById('modalBackdrop');
    const modalContent = document.getElementById('modalContent');
    const modalClose = document.getElementById('modalClose');
    const modalOk = document.getElementById('modalOk');

    // default PRICES
    let PRICES = {
      conduit_per_room: 25000, conduit_db:15000, conduit_nepa:50000,
      conduit_wiring_add_per_room:5000, conduit_fittings_per_room:15000,
      solar_base_bungalow:170000, solar_extra_per_storey:30000, solar_complex:50000
    };

    // modal helpers
    function openModal(html, { showOk=false, onOk=null, closable=true } = {}){
      modalContent.innerHTML = html;
      modalBackdrop.style.display = 'flex';
      modalBackdrop.setAttribute('aria-hidden','false');
      modalOk.style.display = showOk ? 'inline-block' : 'none';
      modalOk.onclick = function(){ if(onOk) onOk(); closeModal(); };
      modalClose.style.display = closable ? 'inline-block' : 'none';
      modalClose.onclick = closeModal;
    }
    function closeModal(){ modalBackdrop.style.display = 'none'; modalBackdrop.setAttribute('aria-hidden','true'); modalContent.innerHTML = ''; modalOk.onclick = null; }

    function showModalLoading(){
      openModal(`<div style="padding:6px 2px"><div class="spinner" aria-hidden="true"></div><h3>Signing you in...</h3><div class="muted">Please wait while we verify your credentials.</div></div>`, { showOk:false, closable:false });
    }

    function showModalAssigned(technicianName, jobId, techId, estimatedDaysVal){
      const html = `<h3>Login successful</h3>
        <div style="font-size:18px;margin-top:6px">${technicianName || 'Technician assigned'}</div>
        <div class="muted" style="margin-top:8px">Job created and assigned. Press OK to go to chat.</div>`;
      openModal(html, { showOk:true, onOk: ()=> {
        // redirect to chat (guaranteed)
        const qs = 'jobId=' + encodeURIComponent(jobId) + (techId ? ('&techId=' + encodeURIComponent(techId)) : '');
        window.location.href = 'chat.html?' + qs;
      }, closable:true });
    }

    function showModalNoTech(){
      openModal(`<h3>No technician available right now</h3><div class="muted">We created your job but couldn't assign a technician at this moment.</div>`, { showOk:false, closable:true });
    }

    function showModalError(msg){
      openModal(`<h3>Error</h3><div class="muted">${msg}</div>`, { showOk:false, closable:true });
    }

    // job type toggle
    jobType.addEventListener('change', ()=> {
      const v = jobType.value;
      conduitFields.classList.toggle('hidden', v!=='conduit');
      solarFields.classList.toggle('hidden', v!=='solar');
      otherFields.classList.toggle('hidden', v!=='other');
    });

    // calculate estimate locally
    function calculateEstimateLocal(){
      const v = jobType.value; let total = 0; let breakdown = [];
      if(v === 'conduit'){
        const rooms = Math.max(1, Number(conduitRooms.value || 1));
        const base = PRICES.conduit_per_room * rooms;
        total += base; breakdown.push(`${rooms} room(s) × ₦${PRICES.conduit_per_room.toLocaleString()} = ₦${base.toLocaleString()}`);
        if(conduitDB.checked){ total += PRICES.conduit_db; breakdown.push(`DB mounting = ₦${PRICES.conduit_db.toLocaleString()}`); }
        if(conduitNEPA.checked){ total += PRICES.conduit_nepa; breakdown.push(`NEPA connection = ₦${PRICES.conduit_nepa.toLocaleString()}`); }
        if(conduitWiringAdd.checked){ const add = PRICES.conduit_wiring_add_per_room * rooms; total += add; breakdown.push(`Extra wiring ${rooms}×₦${PRICES.conduit_wiring_add_per_room.toLocaleString()} = ₦${add.toLocaleString()}`); }
        if(conduitFittings.checked){ const fit = PRICES.conduit_fittings_per_room * rooms; total += fit; breakdown.push(`Fittings ${rooms}×₦${PRICES.conduit_fittings_per_room.toLocaleString()} = ₦${fit.toLocaleString()}`); }
      } else if(v === 'solar'){
        let base = PRICES.solar_base_bungalow; const b = solarBuilding.value;
        if(b === 'bungalow'){ base = PRICES.solar_base_bungalow; breakdown.push(`Bungalow base ₦${base.toLocaleString()}`); }
        else if(b === 'one_story'){ base = PRICES.solar_base_bungalow + PRICES.solar_extra_per_storey; breakdown.push(`1 storey added`); }
        else if(b === 'two_plus'){ base = PRICES.solar_base_bungalow + PRICES.solar_extra_per_storey * 2; breakdown.push(`2+ storey added`); }
        total += base;
        if(solarComplex.checked){ total += PRICES.solar_complex; breakdown.push(`Complex roof = ₦${PRICES.solar_complex.toLocaleString()}`); }
      } else {
        total = 0; breakdown.push('Custom job — enter price or wait for negotiation.');
      }
      return { total, breakdown };
    }

    calcBtn.addEventListener('click', (e)=> {
      e.preventDefault();
      const res = calculateEstimateLocal();
      estimateBox.innerHTML = `<strong>Estimate: ₦${res.total.toLocaleString()}</strong><div class="small" style="margin-top:6px">${res.breakdown.join('<br>')}</div>`;
      priceDisplay.textContent = res.total > 0 ? res.total.toLocaleString() : '—';
    });

    // helper to load user from localStorage
    function loadUser(){ try{ const raw = localStorage.getItem('wc_user'); return raw ? JSON.parse(raw) : null; } catch(e){ return null; } }

    // try to save geolocation (best-effort)
    async function tryGeolocationSave(){
      if(!navigator.geolocation) return;
      try{
        const pos = await new Promise((resolve,reject)=>{
          const t = setTimeout(()=> reject(new Error('geolocation timeout')), 4500);
          navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); resolve(p); }, err => { clearTimeout(t); reject(err); }, { maximumAge:60000, timeout:4500 });
        });
        try{ localStorage.setItem('wc_last_lat', String(pos.coords.latitude)); localStorage.setItem('wc_last_lng', String(pos.coords.longitude)); }catch(e){}
      }catch(e){ /* ignore */ }
    }

    // submit booking: robust handling for backend response shapes
    submitBtn.addEventListener('click', async (ev)=>{
      ev.preventDefault();
      const user = loadUser();
      if(!user){ showModalError('Please login as a client to book.'); return; }

      const jt = jobType.value;
      let job_type = jt;
      let descriptionText = description.value || '';
      if(jt === 'conduit'){ const rooms = Math.max(1, Number(conduitRooms.value || 1)); job_type = 'conduit'; descriptionText = `Conduit wiring — rooms: ${rooms}. ` + descriptionText; }
      else if(jt === 'solar'){ job_type = 'solar'; descriptionText = `Solar install — building: ${solarBuilding.value}. ` + descriptionText; }
      else job_type = otherName.value || 'other';

      const est = calculateEstimateLocal();
      let price = est.total;
      if(price === 0 && jt === 'other'){
        const pRaw = prompt('Enter estimated price in Naira (no commas):', '50000');
        price = Number(pRaw || 0) || 0;
      }

      await tryGeolocationSave();
      const latLocal = parseFloat(localStorage.getItem('wc_last_lat') || 'NaN');
      const lngLocal = parseFloat(localStorage.getItem('wc_last_lng') || 'NaN');

      const payload = {
        clientId: user.id,
        state: (stateInput.value || '').trim(),
        city: (cityInput.value || '').trim(),
        lga: (lgaInput.value || '').trim(),
        address: null,
        lat: Number.isFinite(latLocal) ? latLocal : null,
        lng: Number.isFinite(lngLocal) ? lngLocal : null,
        job_type,
        description: descriptionText,
        price,
        workers_needed: Number(workersNeeded.value) || 1,
        estimated_days: Number(estimatedDays.value) || 1
      };

      // show searching modal
      openModal(`<div style="padding:6px 2px"><div class="spinner" aria-hidden="true"></div><h3>Searching for a technician...</h3><div class="muted">Please wait while we find a nearby available technician.</div></div>`, { showOk:false, closable:false });

      try{
        const endpoint = useAssign.checked ? '/api/book-assign' : '/api/book';
        const controller = new AbortController(); const timeout = setTimeout(()=> controller.abort(), 15000);
        const resp = await fetch(API_BASE + endpoint, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
        clearTimeout(timeout);
        const text = await resp.text().catch(()=>null);
        let body = null;
        try{ body = text ? JSON.parse(text) : null; } catch(e){ body = text; }

        // If backend says success & assigned true -> proceed to fetch assigned tech info (robust)
        if(resp.ok && body && body.success){
          const jobId = body.jobId || (body.job && body.job.id);
          const assignedFlag = !!body.assigned;

          if(assignedFlag){
            // If backend returned technician object use it; otherwise fetch job status and tech profile
            let tech = null;
            if(body.technician && (typeof body.technician === 'object')) tech = body.technician;
            if(!tech && jobId){
              // attempt to get assigned_tech_id by asking for job details/status
              try{
                const sresp = await fetch(API_BASE + '/api/job/' + encodeURIComponent(jobId) + '/status', { method:'GET' });
                if(sresp.ok){
                  const sjs = await sresp.json().catch(()=>null);
                  if(sjs && sjs.success && sjs.job && (sjs.job.assigned_tech_id || sjs.job.assigned_tech_id === 0)){
                    const techId = sjs.job.assigned_tech_id;
                    // fetch tech profile if endpoint exists
                    try {
                      const tresp = await fetch(API_BASE + '/api/user/' + encodeURIComponent(techId), { method:'GET' });
                      if(tresp.ok){
                        const tjs = await tresp.json().catch(()=>null);
                        if(tjs && tjs.success && tjs.user) tech = tjs.user;
                        else if(tjs && tjs.id) tech = tjs; // sometimes returns object directly
                      }
                    } catch(e){}
                    // if fetching profile fails, still redirect using techId
                    const techName = (tech && (tech.fullname || tech.username)) || ('Technician ' + techId);
                    closeModal();
                    // show assigned simple modal then redirect to chat
                    openModal(`<h3>Job matched</h3><div style="font-size:16px;margin-top:8px">${techName}</div><div class="muted" style="margin-top:8px">Press OK to open chat.</div>`, { showOk:true, onOk: ()=> {
                      const qs = 'jobId=' + encodeURIComponent(jobId) + (techId ? ('&techId=' + encodeURIComponent(techId)) : '');
                      window.location.href = 'chat.html?' + qs;
                    }, closable:true });
                    return;
                  }
                }
              }catch(e){}
            }

            // if we reach here and we have tech object
            const techId = tech && (tech.id || tech.user_id || tech._id) ? (tech.id || tech.user_id || tech._id) : null;
            const techName = tech && (tech.fullname || tech.username || tech.name) ? (tech.fullname || tech.username || tech.name) : 'Technician assigned';
            closeModal();
            openModal(`<h3>Job matched</h3><div style="font-size:16px;margin-top:8px">${techName}</div><div class="muted" style="margin-top:8px">Press OK to open chat.</div>`, { showOk:true, onOk: ()=> {
              const qs = 'jobId=' + encodeURIComponent(jobId) + (techId ? ('&techId=' + encodeURIComponent(techId)) : '');
              window.location.href = 'chat.html?' + qs;
            }, closable:true });
            return;
          } else {
            // not assigned now
            closeModal();
            showModalNoTech();
            return;
          }
        } else {
          // backend returned failure or weird non-ok
          closeModal();
          showModalError((body && body.message) ? body.message : 'Failed to create booking');
        }
      }catch(err){
        closeModal();
        const isAbort = err && err.name === 'AbortError';
        showModalError(isAbort ? 'Request timed out' : 'Network error');
      }
    });

    // init: load user and attempt to load prices from backend (silent)
    (function init(){
      const uRaw = localStorage.getItem('wc_user');
      if(!uRaw){ /* don't force redirect here: user may be testing */ }
      else {
        try { const user = JSON.parse(uRaw); document.getElementById('userGreeting').textContent = `${user.fullname || user.username} — ${user.city || user.state || ''}`; } catch(e){}
      }

      (async ()=> {
        try{
          const resp = await fetch(API_BASE + '/api/prices', { method:'GET', cache:'no-store' });
          if(resp.ok){
            const json = await resp.json().catch(()=>null);
            const backendPrices = (json && json.prices) ? json.prices : json;
            if(backendPrices && typeof backendPrices === 'object'){
              for(const k in backendPrices){
                if(Object.prototype.hasOwnProperty.call(PRICES,k) && typeof backendPrices[k] === 'number') PRICES[k] = backendPrices[k];
              }
            }
          }
        }catch(e){}
        const res = calculateEstimateLocal(); estimateBox.innerHTML = `<strong>Estimate: ₦${res.total.toLocaleString()}</strong><div class="small" style="margin-top:6px">${res.breakdown.join('<br>')}</div>`;
        priceDisplay.textContent = res.total > 0 ? res.total.toLocaleString() : '—';
      })();
    })();

    // close modal if backdrop clicked
    modalBackdrop.addEventListener('click', (e)=> { if(e.target === modalBackdrop) closeModal(); });

  </script>
</body>
</html>