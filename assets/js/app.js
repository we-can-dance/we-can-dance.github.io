// ══════════════════════════════════════════
// CONFIG — fill these in from your Supabase project settings
// ══════════════════════════════════════════
const SUPABASE_URL  = 'https://icvcarkmkwpkdrkqiphp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljdmNhcmtta3dwa2Rya3FpcGhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MDA3NzUsImV4cCI6MjA5NzQ3Njc3NX0.sTraWnRoaQA4hha0p_0NtNpsIf2-sLbcDr4e4Q0FQLw';

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser    = null;
let currentProfile = null;
let allSongs       = [];
let allClasses     = [];
let allProfiles    = [];
let currentSongId  = null;
let activeClassFilter = null;

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  setTimeout(() => el.className = '', 2800);
}

function fmt(secs) {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function downloadFile(url, filename) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast('Download failed', 'error');
  }
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════
document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  const btn   = document.getElementById('login-btn');
  const err   = document.getElementById('login-error');
  err.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    err.textContent = error.message; err.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

['logout-btn', 'logout-btn-2'].forEach(id => {
  document.getElementById(id).addEventListener('click', async () => {
    await sb.auth.signOut();
  });
});

sb.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user;
    // Load from cache immediately so the app shows without waiting for DB
    const cached = localStorage.getItem('dl_profile');
    if (cached) {
      currentProfile = JSON.parse(cached);
      updateProfileUI(currentProfile);
    }
    showApp();
    // Fetch fresh profile from DB in background (non-blocking)
    // so role/name stay up to date without blocking the UI
    fetchProfileBackground();
  } else if (event === 'SIGNED_OUT') {
    currentUser = null; currentProfile = null;
    localStorage.removeItem('dl_profile');
    document.getElementById('app-view').style.display = 'none';
    document.getElementById('login-view').style.display = 'flex';
  }
});

function fetchProfileBackground() {
  sb.from('profiles').select('*').eq('id', currentUser.id).single().then(({ data, error }) => {
    if (data && !error) {
      currentProfile = data;
      localStorage.setItem('dl_profile', JSON.stringify(data));
      updateProfileUI(data);
      // Refresh nav visibility with latest role
      const role = data.role;
      document.getElementById('upload-nav').style.display         = (role === 'admin' || role === 'superuser') ? 'flex'  : 'none';
      document.getElementById('upload-nav-section').style.display = (role === 'admin' || role === 'superuser') ? 'block' : 'none';
      document.getElementById('admin-nav').style.display          = role === 'admin' ? 'flex'  : 'none';
      document.getElementById('admin-nav-section').style.display  = role === 'admin' ? 'block' : 'none';
    }
  });
}

// ── Mobile sidebar toggle ──
function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}
document.getElementById('hamburger').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
});
document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', closeSidebar);
});

function updateProfileUI(data) {
  document.getElementById('header-name').textContent = data?.full_name || data?.email || '';
  const badge = document.getElementById('header-role');
  badge.textContent = data?.role || 'user';
  badge.className = 'role-badge ' + (data?.role || 'user');
}

// ══════════════════════════════════════════
// APP BOOTSTRAP
// ══════════════════════════════════════════
async function showApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'flex';

  const role = currentProfile?.role;
  if (role === 'admin' || role === 'superuser') {
    document.getElementById('upload-nav').style.display = 'flex';
    document.getElementById('upload-nav-section').style.display = 'block';
  }
  if (role === 'admin') {
    document.getElementById('admin-nav').style.display = 'flex';
    document.getElementById('admin-nav-section').style.display = 'block';
  }

  await Promise.all([loadClasses(), loadSongs()]);
  buildClassNav();
  renderLibrary();
}

// ══════════════════════════════════════════
// NAV
// ══════════════════════════════════════════
document.querySelectorAll('.nav-item[data-section]').forEach(item => {
  item.addEventListener('click', () => showSection(item.dataset.section));
});

function showSection(name, opts = {}) {
  document.querySelectorAll('.nav-item[data-section]').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (navEl) navEl.classList.add('active');

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById('section-' + name);
  if (sec) sec.classList.add('active');

  if (name === 'admin') loadAdminData();
  if (name === 'upload') populateUploadClasses();
  if (name === 'library') {
    activeClassFilter = opts.classId || null;
    renderLibrary();
  }
}

// ══════════════════════════════════════════
// CLASSES NAV
// ══════════════════════════════════════════
async function loadClasses() {
  const { data } = await sb.from('classes').select('*').order('name');
  allClasses = data || [];
}

function buildClassNav() {
  const container = document.getElementById('classes-nav-items');
  container.innerHTML = '';
  allClasses.forEach(cls => {
    const div = document.createElement('div');
    div.className = 'nav-item';
    div.dataset.section = 'library';
    div.innerHTML = `
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      ${cls.name}`;
    div.addEventListener('click', () => {
      activeClassFilter = cls.id;
      showSection('library', { classId: cls.id });
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      div.classList.add('active');
    });
    container.appendChild(div);
  });
}

// ══════════════════════════════════════════
// SONGS — LOAD & RENDER
// ══════════════════════════════════════════
async function loadSongs() {
  const { data } = await sb
    .from('songs')
    .select(`*, song_classes(class_id)`)
    .order('title');
  allSongs = data || [];

  const styles = [...new Set(allSongs.map(s => s.dance_style).filter(Boolean))];
  const styleFilter = document.getElementById('filter-style');
  styleFilter.innerHTML = '<option value="">All Styles</option>';
  styles.forEach(st => {
    const o = document.createElement('option'); o.value = st; o.textContent = st;
    styleFilter.appendChild(o);
  });

  const classFilter = document.getElementById('filter-class');
  classFilter.innerHTML = '<option value="">All Classes</option>';
  allClasses.forEach(cls => {
    const o = document.createElement('option'); o.value = cls.id; o.textContent = cls.name;
    classFilter.appendChild(o);
  });
}

document.getElementById('search-input').addEventListener('input', renderLibrary);
document.getElementById('filter-class').addEventListener('change', renderLibrary);
document.getElementById('filter-style').addEventListener('change', renderLibrary);

function renderLibrary() {
  const search  = document.getElementById('search-input').value.toLowerCase();
  const classId = document.getElementById('filter-class').value || activeClassFilter;
  const style   = document.getElementById('filter-style').value;

  const songs = allSongs.filter(s => {
    const matchSearch = !search ||
      (s.title || '').toLowerCase().includes(search) ||
      (s.artist || '').toLowerCase().includes(search) ||
      (s.dance_style || '').toLowerCase().includes(search);
    const matchClass = !classId || (s.song_classes || []).some(sc => sc.class_id === classId);
    const matchStyle = !style || s.dance_style === style;
    return matchSearch && matchClass && matchStyle;
  });

  const grid = document.getElementById('song-grid');
  if (!songs.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
        <p>No songs found</p>
      </div>`;
    return;
  }

  grid.innerHTML = songs.map(s => {
    const classNames = (s.song_classes || []).map(sc => {
      const cls = allClasses.find(c => c.id === sc.class_id);
      return cls ? `<span class="tag">${cls.name}</span>` : '';
    }).join('');
    return `
      <div class="song-card" data-id="${s.id}">
        <button class="play-btn-card" data-id="${s.id}" title="Play">
          <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <div class="song-title">${s.title}</div>
        <div class="song-artist">${s.artist || '—'}</div>
        <div class="song-meta-tags">
          ${s.dance_style ? `<span class="tag style">${s.dance_style}</span>` : ''}
          ${s.ragam      ? `<span class="tag">${s.ragam}</span>`               : ''}
          ${s.talam      ? `<span class="tag">${s.talam}</span>`               : ''}
          ${classNames}
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.song-card').forEach(card => {
    card.addEventListener('click', () => openSong(card.dataset.id));
  });
  grid.querySelectorAll('.play-btn-card').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); playSong(btn.dataset.id); });
  });
}

// ══════════════════════════════════════════
// SONG DETAIL
// ══════════════════════════════════════════
document.getElementById('back-to-library').addEventListener('click', () => showSection('library'));

async function openSong(id) {
  currentSongId = id;
  const song = allSongs.find(s => s.id === id);
  if (!song) return;

  showSection('song-detail');

  const { data: noteData } = await sb
    .from('user_notes')
    .select('content')
    .eq('user_id', currentUser.id)
    .eq('song_id', id)
    .maybeSingle();

  const classNames = (song.song_classes || []).map(sc => {
    const cls = allClasses.find(c => c.id === sc.class_id);
    return cls ? `<span class="tag">${cls.name}</span>` : '';
  }).join('') || '—';

  let pdfUrl = '';
  if (song.pdf_path) {
    const { data: signed } = await sb.storage.from('pdfs').createSignedUrl(song.pdf_path, 3600);
    pdfUrl = signed?.signedUrl || '';
  }

  let audioUrl = '';
  if (song.audio_path) {
    const { data: signed } = await sb.storage.from('audio').createSignedUrl(song.audio_path, 3600);
    audioUrl = signed?.signedUrl || '';
  }

  document.getElementById('song-detail-content').innerHTML = `
    <div class="detail-header">
      <div class="detail-icon">🎵</div>
      <div>
        <div class="detail-title">${song.title}</div>
        <div class="detail-artist">${song.artist || '—'}</div>
        <div class="song-meta-tags" style="margin-top:6px">
          ${song.dance_style ? `<span class="tag style">${song.dance_style}</span>` : ''}
          ${song.ragam ? `<span class="tag">${song.ragam}</span>` : ''}
          ${song.talam ? `<span class="tag">${song.talam}</span>` : ''}
        </div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px">
        ${song.audio_path ? `<button class="btn btn-primary" onclick="playSong('${song.id}')">▶ Play</button>` : ''}
        ${audioUrl ? `<button class="btn btn-ghost" onclick="downloadFile('${audioUrl}', '${song.title.replace(/[^a-z0-9]/gi,'_')}.mp3')">↓ Download</button>` : ''}
        ${ (currentProfile?.role === 'admin' || currentProfile?.role === 'superuser') ? `<button class="btn btn-ghost" id="edit-song-btn">✎ Edit</button>` : '' }
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-field">
        <div class="label">Classes</div>
        <div class="value" style="display:flex;gap:4px;flex-wrap:wrap">${classNames}</div>
      </div>
      <div class="detail-field">
        <div class="label">Dance Style</div>
        <div class="value">${song.dance_style || '—'}</div>
      </div>
      <div class="detail-field">
        <div class="label">Ragam</div>
        <div class="value">${song.ragam || '—'}</div>
      </div>
      <div class="detail-field">
        <div class="label">Talam</div>
        <div class="value">${song.talam || '—'}</div>
      </div>
      <div class="detail-field">
        <div class="label">Writer / Composer</div>
        <div class="value">${song.writer || '—'}</div>
      </div>
      <div class="detail-field">
        <div class="label">Artist</div>
        <div class="value">${song.artist || '—'}</div>
      </div>
    </div>

    ${song.description ? `
    <div class="detail-section">
      <div class="detail-section-title">Teacher Notes</div>
      <div class="detail-notes">${song.description}</div>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-section-title">Links</div>
      <div class="links-row">
        ${song.youtube_url ? `
        <a href="${song.youtube_url}" target="_blank" class="link-btn yt">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
            <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58a2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
            <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="var(--bg)"/>
          </svg>
          Watch on YouTube
        </a>` : ''}
        ${pdfUrl ? `
        <a href="${pdfUrl}" target="_blank" class="link-btn pdf">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Download PDF
        </a>` : ''}
        ${!song.youtube_url && !pdfUrl ? '<span style="color:var(--muted);font-size:13px">No links attached</span>' : ''}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        My Notes
        <span style="font-weight:400;font-size:11px;color:var(--muted)">(private — only you can see these)</span>
      </div>
      <div class="notes-area">
        <textarea id="my-notes" placeholder="Write your choreography notes, reminders, cues…">${noteData?.content || ''}</textarea>
        <div class="notes-actions">
          <span id="notes-saved">✓ Saved</span>
          <button class="btn btn-primary btn-sm" id="save-notes-btn">Save Notes</button>
        </div>
      </div>
    </div>

    ${ (currentProfile?.role === 'admin' || currentProfile?.role === 'superuser') ? `
    <div class="detail-section" id="edit-form-section" style="display:none">
      <div class="detail-section-title">Edit Song</div>
      <div class="form-grid">
        <div class="form-group">
          <label>Title *</label>
          <input type="text" id="edit-title" value="${song.title}" />
        </div>
        <div class="form-group">
          <label>Artist</label>
          <input type="text" id="edit-artist" value="${song.artist || ''}" />
        </div>
        <div class="form-group">
          <label>Dance Style</label>
          <input type="text" id="edit-style" value="${song.dance_style || ''}" />
        </div>
        <div class="form-group">
          <label>Ragam</label>
          <input type="text" id="edit-ragam" value="${song.ragam || ''}" />
        </div>
        <div class="form-group">
          <label>Talam</label>
          <input type="text" id="edit-talam" value="${song.talam || ''}" />
        </div>
        <div class="form-group">
          <label>Writer / Composer</label>
          <input type="text" id="edit-writer" value="${song.writer || ''}" />
        </div>
        <div class="form-group full">
          <label>Teacher Notes</label>
          <textarea id="edit-notes">${song.description || ''}</textarea>
        </div>
        <div class="form-group full">
          <label>YouTube Link</label>
          <input type="url" id="edit-youtube" value="${song.youtube_url || ''}" />
        </div>
        <div class="form-group full">
          <label>Classes</label>
          <select id="edit-classes" multiple style="height:100px;">
            ${allClasses.map(c => {
              const assigned = (song.song_classes || []).some(sc => sc.class_id === c.id);
              return `<option value="${c.id}" ${assigned ? 'selected' : ''}>${c.name}</option>`;
            }).join('')}
          </select>
          <p style="font-size:11px;color:var(--muted);margin-top:4px">Hold Ctrl/Cmd to select multiple</p>
        </div>
        <div class="form-group full">
          <label>Audio File</label>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--muted)">${song.audio_path ? '✓ Audio uploaded' : 'No audio'}</span>
            <input type="file" id="edit-audio" accept="audio/*" style="flex:1;min-width:180px" />
            ${song.audio_path ? `<button class="btn btn-danger btn-sm" id="delete-audio-btn" type="button">✕ Delete Audio</button>` : ''}
          </div>
          <div class="upload-progress" id="edit-audio-progress">
            <div class="upload-progress-bar" id="edit-audio-progress-bar" style="width:0%"></div>
          </div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" id="save-edit-btn">Save Changes</button>
        <button class="btn btn-ghost" id="cancel-edit-btn">Cancel</button>
      </div>
    </div>` : ''}
  `;

  document.getElementById('save-notes-btn').addEventListener('click', saveNotes);

  if (currentProfile?.role === 'admin' || currentProfile?.role === 'superuser') {
    document.getElementById('edit-song-btn').addEventListener('click', () => {
      const sec = document.getElementById('edit-form-section');
      sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
      document.getElementById('edit-form-section').style.display = 'none';
    });
    document.getElementById('save-edit-btn').addEventListener('click', () => saveSongEdit(song));
    if (song.audio_path) {
      document.getElementById('delete-audio-btn').addEventListener('click', async () => {
        if (!confirm('Delete the audio file? This cannot be undone.')) return;
        await sb.storage.from('audio').remove([song.audio_path]);
        await sb.from('songs').update({ audio_path: null }).eq('id', song.id);
        toast('Audio deleted');
        await loadSongs();
        openSong(song.id);
      });
    }
  }
}

async function saveSongEdit(song) {
  const title = document.getElementById('edit-title').value.trim();
  if (!title) { toast('Title is required', 'error'); return; }

  const btn = document.getElementById('save-edit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  // Handle audio re-upload
  let newAudioPath = song.audio_path;
  const audioFile = document.getElementById('edit-audio').files[0];
  if (audioFile) {
    btn.textContent = 'Uploading audio…';
    if (song.audio_path) await sb.storage.from('audio').remove([song.audio_path]);
    newAudioPath = `${Date.now()}_${sanitize(audioFile.name)}`;
    document.getElementById('edit-audio-progress').style.display = 'block';
    document.getElementById('edit-audio-progress-bar').style.width = '40%';
    const { error: uploadErr } = await sb.storage.from('audio').upload(newAudioPath, audioFile);
    if (uploadErr) { toast('Audio upload failed: ' + uploadErr.message, 'error'); btn.disabled = false; btn.textContent = 'Save Changes'; return; }
    document.getElementById('edit-audio-progress-bar').style.width = '100%';
  }

  const { error } = await sb.from('songs').update({
    title,
    artist:      document.getElementById('edit-artist').value.trim()  || null,
    dance_style: document.getElementById('edit-style').value.trim()   || null,
    ragam:       document.getElementById('edit-ragam').value.trim()   || null,
    talam:       document.getElementById('edit-talam').value.trim()   || null,
    writer:      document.getElementById('edit-writer').value.trim()  || null,
    description: document.getElementById('edit-notes').value.trim()  || null,
    youtube_url: document.getElementById('edit-youtube').value.trim() || null,
    audio_path:  newAudioPath,
  }).eq('id', song.id);

  if (error) { toast('Error saving: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Save Changes'; return; }

  // Update class assignments
  const selectedClasses = [...document.getElementById('edit-classes').selectedOptions].map(o => o.value);
  await sb.from('song_classes').delete().eq('song_id', song.id);
  if (selectedClasses.length) {
    await sb.from('song_classes').insert(selectedClasses.map(cid => ({ song_id: song.id, class_id: cid })));
  }

  toast('Song updated!');
  await loadSongs();
  openSong(song.id);
}

async function saveNotes() {
  const content = document.getElementById('my-notes').value;
  const { error } = await sb.from('user_notes').upsert({
    user_id:    currentUser.id,
    song_id:    currentSongId,
    content,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,song_id' });

  if (!error) {
    const saved = document.getElementById('notes-saved');
    saved.style.display = 'inline';
    setTimeout(() => saved.style.display = 'none', 2000);
  } else {
    toast('Error saving notes', 'error');
  }
}

// ══════════════════════════════════════════
// AUDIO PLAYER
// ══════════════════════════════════════════
const audio  = document.getElementById('audio-el');
const player = document.getElementById('player');

async function playSong(id) {
  const song = allSongs.find(s => s.id === id);
  if (!song || !song.audio_path) { toast('No audio file for this song', 'error'); return; }

  const { data: signed, error } = await sb.storage.from('audio').createSignedUrl(song.audio_path, 3600);
  if (error || !signed?.signedUrl) { toast('Could not load audio', 'error'); return; }

  audio.src = signed.signedUrl;
  audio.play();
  document.getElementById('player-title').textContent  = song.title;
  document.getElementById('player-artist').textContent = song.artist || '';
  player.classList.add('visible');
  setPlayState(true);
}

function setPlayState(playing) {
  document.getElementById('play-icon').style.display  = playing ? 'none'  : 'block';
  document.getElementById('pause-icon').style.display = playing ? 'block' : 'none';
}

document.getElementById('play-pause-btn').addEventListener('click', () => {
  if (audio.paused) { audio.play(); setPlayState(true); }
  else              { audio.pause(); setPlayState(false); }
});

audio.addEventListener('timeupdate', () => {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  document.getElementById('progress-fill').style.width        = pct + '%';
  document.getElementById('time-current').textContent = fmt(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  document.getElementById('time-total').textContent = fmt(audio.duration);
});

audio.addEventListener('ended', () => setPlayState(false));

document.getElementById('progress-wrap').addEventListener('click', e => {
  const rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

document.getElementById('volume-slider').addEventListener('input', e => {
  audio.volume = e.target.value;
});

document.getElementById('speed-select').addEventListener('change', e => {
  audio.playbackRate = parseFloat(e.target.value);
});

// ══════════════════════════════════════════
// UPLOAD
// ══════════════════════════════════════════
function populateUploadClasses() {
  const sel = document.getElementById('up-classes');
  sel.innerHTML = allClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

document.getElementById('upload-btn').addEventListener('click', async () => {
  const title = document.getElementById('up-title').value.trim();
  if (!title) { toast('Title is required', 'error'); return; }

  const btn = document.getElementById('upload-btn');
  btn.disabled = true; btn.textContent = 'Uploading…';
  document.getElementById('upload-success').style.display = 'none';
  document.getElementById('upload-error').style.display   = 'none';

  try {
    let audioPath = null;
    const audioFile = document.getElementById('up-audio').files[0];
    if (audioFile) {
      audioPath = `${Date.now()}_${sanitize(audioFile.name)}`;
      document.getElementById('audio-progress').style.display = 'block';
      document.getElementById('audio-progress-bar').style.width = '30%';
      const { error: audioErr } = await sb.storage.from('audio').upload(audioPath, audioFile);
      if (audioErr) throw new Error('Audio upload failed: ' + audioErr.message);
      document.getElementById('audio-progress-bar').style.width = '100%';
    }

    let pdfPath = null;
    const pdfFile = document.getElementById('up-pdf').files[0];
    if (pdfFile) {
      pdfPath = `${Date.now()}_${sanitize(pdfFile.name)}`;
      document.getElementById('pdf-progress').style.display = 'block';
      document.getElementById('pdf-progress-bar').style.width = '30%';
      const { error: pdfErr } = await sb.storage.from('pdfs').upload(pdfPath, pdfFile);
      if (pdfErr) throw new Error('PDF upload failed: ' + pdfErr.message);
      document.getElementById('pdf-progress-bar').style.width = '100%';
    }

    const { data: songData, error: songErr } = await sb.from('songs').insert({
      title,
      artist:      document.getElementById('up-artist').value.trim()  || null,
      dance_style: document.getElementById('up-style').value.trim()   || null,
      ragam:       document.getElementById('up-ragam').value.trim()   || null,
      talam:       document.getElementById('up-talam').value.trim()   || null,
      writer:      document.getElementById('up-writer').value.trim()  || null,
      description: document.getElementById('up-notes').value.trim()  || null,
      youtube_url: document.getElementById('up-youtube').value.trim() || null,
      audio_path:  audioPath,
      pdf_path:    pdfPath,
      uploaded_by: currentUser.id
    }).select().single();

    if (songErr) throw new Error(songErr.message);

    const selectedClasses = [...document.getElementById('up-classes').selectedOptions].map(o => o.value);
    if (selectedClasses.length) {
      await sb.from('song_classes').insert(
        selectedClasses.map(cid => ({ song_id: songData.id, class_id: cid }))
      );
    }

    ['up-title','up-artist','up-style','up-ragam','up-talam','up-writer','up-notes','up-youtube'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('up-audio').value = '';
    document.getElementById('up-pdf').value   = '';
    document.getElementById('audio-progress').style.display = 'none';
    document.getElementById('pdf-progress').style.display   = 'none';
    document.getElementById('upload-success').style.display = 'block';

    await loadSongs();
    renderLibrary();

  } catch (err) {
    const errEl = document.getElementById('upload-error');
    errEl.textContent    = err.message;
    errEl.style.display  = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Upload Song';
  }
});

// ══════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

async function loadAdminData() {
  await Promise.all([loadAdminUsers(), loadAdminClasses(), loadAdminAccess()]);
}

// -- Users --
async function loadAdminUsers() {
  document.getElementById('users-loading').style.display = 'block';
  document.getElementById('users-table').style.display   = 'none';
  const { data } = await sb.from('profiles').select('*').order('email');
  allProfiles = data || [];
  const { data: members } = await sb.from('class_members').select('*');

  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = allProfiles.map(u => {
    const userClasses  = (members || []).filter(m => m.user_id === u.id);
    const classTags    = userClasses.map(m => {
      const cls = allClasses.find(c => c.id === m.class_id);
      return cls
        ? `<span class="class-tag">${cls.name}<button onclick="removeFromClass('${u.id}','${m.class_id}','${cls.name}')">×</button></span>`
        : '';
    }).join('');
    const classOptions = allClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    return `<tr>
      <td>${u.email || '—'}</td>
      <td><input type="text" value="${u.full_name || ''}" onblur="updateName('${u.id}', this.value)"
          style="background:transparent;border:none;padding:0;color:var(--text)" placeholder="Set name…" /></td>
      <td>
        <select onchange="updateRole('${u.id}', this.value)">
          <option value="user"      ${u.role==='user'      ?'selected':''}>User</option>
          <option value="superuser" ${u.role==='superuser' ?'selected':''}>Superuser</option>
          <option value="admin"     ${u.role==='admin'     ?'selected':''}>Admin</option>
        </select>
      </td>
      <td>
        ${classTags}
        <select onchange="addToClass('${u.id}', this.value, this)" style="margin-top:4px">
          <option value="">+ Add to class</option>
          ${classOptions}
        </select>
      </td>
      <td></td>
    </tr>`;
  }).join('');

  document.getElementById('users-loading').style.display = 'none';
  document.getElementById('users-table').style.display   = 'table';

  const accessUser = document.getElementById('access-user');
  accessUser.innerHTML = allProfiles.map(u => `<option value="${u.id}">${u.email}</option>`).join('');
}

async function updateRole(userId, role) {
  await sb.from('profiles').update({ role }).eq('id', userId);
  toast('Role updated');
}

async function updateName(userId, name) {
  await sb.from('profiles').update({ full_name: name }).eq('id', userId);
}

async function addToClass(userId, classId, sel) {
  if (!classId) return;
  await sb.from('class_members').upsert({ user_id: userId, class_id: classId }, { onConflict: 'user_id,class_id' });
  sel.value = '';
  toast('Added to class');
  await loadAdminUsers();
}

async function removeFromClass(userId, classId, name) {
  await sb.from('class_members').delete().eq('user_id', userId).eq('class_id', classId);
  toast(`Removed from ${name}`);
  await loadAdminUsers();
}

// -- Classes --
async function loadAdminClasses() {
  document.getElementById('classes-loading').style.display = 'block';
  document.getElementById('classes-table').style.display   = 'none';
  const { data: members } = await sb.from('class_members').select('*');

  const tbody = document.getElementById('classes-tbody');
  tbody.innerHTML = allClasses.map(c => {
    const count = (members || []).filter(m => m.class_id === c.id).length;
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.description || '—'}</td>
      <td>${count} member${count !== 1 ? 's' : ''}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteClass('${c.id}','${c.name}')">Delete</button></td>
    </tr>`;
  }).join('');

  document.getElementById('classes-loading').style.display = 'none';
  document.getElementById('classes-table').style.display   = 'table';
}

document.getElementById('create-class-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-class-name').value.trim();
  if (!name) return;
  const { error } = await sb.from('classes').insert({
    name,
    description: document.getElementById('new-class-desc').value.trim() || null
  });
  if (!error) {
    document.getElementById('new-class-name').value = '';
    document.getElementById('new-class-desc').value = '';
    await loadClasses();
    buildClassNav();
    await loadAdminClasses();
    populateUploadClasses();
    toast('Class created');
  } else {
    toast(error.message, 'error');
  }
});

async function deleteClass(id, name) {
  if (!confirm(`Delete class "${name}"? Songs will not be deleted.`)) return;
  await sb.from('classes').delete().eq('id', id);
  await loadClasses();
  buildClassNav();
  await loadAdminClasses();
  toast('Class deleted');
}

// -- Song Access --
async function loadAdminAccess() {
  document.getElementById('access-loading').style.display = 'block';
  document.getElementById('access-table').style.display   = 'none';
  const { data } = await sb.from('individual_song_access').select('*');

  const tbody = document.getElementById('access-tbody');
  tbody.innerHTML = (data || []).map(row => {
    const song = allSongs.find(s => s.id === row.song_id);
    const user = allProfiles.find(u => u.id === row.user_id);
    return `<tr>
      <td>${song?.title || row.song_id}</td>
      <td>${user?.email || row.user_id}</td>
      <td><button class="btn btn-danger btn-sm" onclick="revokeAccess('${row.song_id}','${row.user_id}')">Revoke</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" style="color:var(--muted);text-align:center;padding:20px">No individual access grants yet</td></tr>';

  const accessSong = document.getElementById('access-song');
  accessSong.innerHTML = allSongs.map(s => `<option value="${s.id}">${s.title}</option>`).join('');

  document.getElementById('access-loading').style.display = 'none';
  document.getElementById('access-table').style.display   = 'table';
}

document.getElementById('grant-access-btn').addEventListener('click', async () => {
  const songId = document.getElementById('access-song').value;
  const userId = document.getElementById('access-user').value;
  if (!songId || !userId) return;
  const { error } = await sb.from('individual_song_access')
    .upsert({ song_id: songId, user_id: userId }, { onConflict: 'user_id,song_id' });
  if (!error) { toast('Access granted'); await loadAdminAccess(); }
  else toast(error.message, 'error');
});

async function revokeAccess(songId, userId) {
  await sb.from('individual_song_access').delete().eq('song_id', songId).eq('user_id', userId);
  toast('Access revoked');
  await loadAdminAccess();
}
