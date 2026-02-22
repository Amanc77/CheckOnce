/* popup.js */
const STORAGE_KEY = 'recruiterData';

// Must match content.js scoring logic exactly
function scoreRec(rec) {
  const posts = rec.posts || [];
  const firstSeen = rec.firstSeen || (Date.now() - 365 * 24 * 60 * 60 * 1000);
  if (!posts.length) return { level: 'unknown', pts: 0, roles: [], isFake: false, recentCount: 0 };
  
  const now = Date.now();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  
  // Method 0: ALL posts are hiring (100% hiring ratio)
  let isFake = false;
  let recentCount = posts.length;
  const daysSinceFirstSeen = (now - firstSeen) / MS_PER_DAY;
  
  if (posts.length >= 2 && daysSinceFirstSeen <= 7) {
    // All tracked posts are hiring posts - very suspicious
    isFake = true;
  }
  
  // Method 1: Observation-based (3+ posts within 5 days of first seeing)
  if (!isFake && firstSeen && posts.length >= 3 && daysSinceFirstSeen <= 5) {
    isFake = true;
  }
  
  // Method 2: Date-based with multiple windows
  if (!isFake) {
    const recent3 = posts.filter(p => {
      try {
        const d = new Date((p.date || '') + 'T12:00:00');
        return !isNaN(d.getTime()) && d >= new Date(now - 3 * MS_PER_DAY);
      } catch (_) { return false; }
    });
    const recent5 = posts.filter(p => {
      try {
        const d = new Date((p.date || '') + 'T12:00:00');
        return !isNaN(d.getTime()) && d >= new Date(now - 5 * MS_PER_DAY);
      } catch (_) { return false; }
    });
    const recent7 = posts.filter(p => {
      try {
        const d = new Date((p.date || '') + 'T12:00:00');
        return !isNaN(d.getTime()) && d >= new Date(now - 7 * MS_PER_DAY);
      } catch (_) { return false; }
    });
    recentCount = Math.max(recent3.length, recent5.length, recent7.length);
    // Multiple thresholds
    isFake = recent5.length >= 5 || recent5.length >= 4 || recent3.length >= 2 || recent7.length >= 5;
  }
  
  let pts = isFake ? 100 : 0;
  const byDate = {};
  posts.forEach(p => { (byDate[p.date] = byDate[p.date] || []).push(p); });
  const dayCounts = Object.values(byDate).map(a => a.length);
  const maxDay = dayCounts.length ? Math.max(...dayCounts) : 0;
  if (maxDay >= 2) pts += 40;
  const roles = [...new Set(posts.map(p => p.role).filter(Boolean))];
  if (roles.length >= 3) pts += 30; // Lowered from 4
  const rc = {};
  posts.forEach(p => { if (p.role) rc[p.role] = (rc[p.role]||0)+1; });
  Object.values(rc).forEach(c => { if (c >= 2) pts += 25; });
  if (posts.length >= 2) pts += 20; // All posts are hiring
  if (posts.length >= 6) pts += 15;
  if (posts.length >= 8) pts += 10;
  const level = isFake || pts >= 45 ? 'high' : pts >= 20 ? 'medium' : 'low'; // Lowered thresholds
  return { level, pts, roles, isFake, recentCount };
}

function showStatus(msg, color='#0a66c2') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.style.background = color === 'red' ? '#fce8e6' : '#e8f3ff';
  el.style.borderColor = color === 'red' ? '#d93025' : '#b6d4f7';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

async function render() {
  const data = await new Promise(r => chrome.storage.local.get([STORAGE_KEY], d => r(d[STORAGE_KEY] || {})));
  const items = Object.entries(data).map(([url, rec]) => ({ url, rec, sc: scoreRec(rec) }));

  const high = items.filter(i => i.sc.level === 'high').length;
  const med  = items.filter(i => i.sc.level === 'medium').length;
  const low  = items.filter(i => i.sc.level === 'low').length;
  const fake = items.filter(i => i.sc.isFake).length;

  document.getElementById('sHigh').textContent = high;
  document.getElementById('sMed').textContent  = med;
  document.getElementById('sLow').textContent  = low;

  const list = document.getElementById('recruiterList');

  if (!items.length) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">📋</div>
      <div class="empty-text">No recruiters tracked yet.<br>Go to LinkedIn, scroll through job posts,<br>and they'll appear here automatically!</div>
    </div>`;
    return;
  }

  items.sort((a, b) => b.sc.pts - a.sc.pts);

  list.innerHTML = items.map(({ url, rec, sc }) => {
    const name = rec.name || 'Unknown Recruiter';
    const initial = name.charAt(0).toUpperCase();
    const icon = sc.isFake ? '🚨' : sc.level === 'high' ? '🚨' : sc.level === 'medium' ? '⚠️' : '✅';
    const posts = (rec.posts||[]).length;
    const roles = sc.roles.length;
    const fakeLabel = sc.isFake ? ` · 🚨 FAKE (${sc.recentCount} posts in 5 days)` : '';
    return `
      <div class="recruiter-item" data-url="${encodeURIComponent(url)}">
        <div class="rec-avatar ${sc.isFake ? 'high' : sc.level}">${initial}</div>
        <div class="rec-info">
          <div class="rec-name">${icon} ${name}${sc.isFake ? ' <span style="color:#d32f2f;font-weight:900;">[FAKE]</span>' : ''}</div>
          <div class="rec-meta">${posts} post${posts!==1?'s':''} · ${roles} role${roles!==1?'s':''}${fakeLabel}</div>
        </div>
        <div class="rec-badge ${sc.isFake ? 'high' : sc.level}">${sc.pts}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.recruiter-item').forEach(item => {
    item.addEventListener('click', () => {
      chrome.tabs.create({ url: decodeURIComponent(item.dataset.url) });
    });
  });
}

// Scan button
document.getElementById('scanBtn').addEventListener('click', async () => {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url || !tab.url.includes('linkedin.com')) {
    showStatus('⚠️ Please navigate to LinkedIn first!', 'red');
    btn.disabled = false;
    btn.textContent = '🔍 Scan This Page Now';
    return;
  }

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'scan' });
    showStatus('✅ Scan complete! Badges added to job posts.');
    await render();
  } catch (e) {
    // Content script might not be ready yet — inject it
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'scan' });
          showStatus('✅ Scan complete!');
          await render();
        } catch (_) {
          showStatus('⚠️ Could not scan. Try refreshing the LinkedIn page.', 'red');
        }
      }, 1500);
    } catch (_) {
      showStatus('⚠️ Error. Refresh LinkedIn and try again.', 'red');
    }
  }

  btn.disabled = false;
  btn.textContent = '🔍 Scan This Page Now';
});

// Clear button
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear all tracked recruiter data?')) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  await render();
  showStatus('🗑 Data cleared.');
});

// Init
render();
