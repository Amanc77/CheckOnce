/*  LinkedIn Fraud Job Detector — content.js
    Works on: feed, company pages, profile pages, job pages
*/

'use strict';

// ─── Config ───────────────────────────────────────────────────
const CFG = {
  DAILY_LIMIT   : 3,   // >3 posts in one day → suspicious
  ROLE_VARIETY  : 5,   // >5 different roles   → suspicious
  SAME_REPEAT   : 2,   // same role 2+ times   → suspicious
  SCAN_DELAY    : 800, // ms debounce
};

const STORAGE_KEY = 'recruiterData';

// ─── Role keywords used for extraction ────────────────────────
const JOB_KEYWORDS = [
  'hiring','we are hiring','is hiring','join us','job opening','job opportunity',
  'immediate joiner','urgent hiring','looking for','vacancy','opening for',
  'apply now','send your resume','send cv','share your resume','dm me',
  'interested candidates','walk in','walkin','freshers','experienced',
  'recruiter','recruitment'
];

const ROLE_PATTERNS = [
  /(?:hiring|looking\s+for|opening\s+for|role\s*[:\-]?|position\s*[:\-]?)[\s:–\-]+([A-Za-z][\w\s\/\+\#]{2,45}?)(?:\s*[\n\r\|,!?]|$)/im,
  /([A-Za-z][\w\s\/\+\#]{2,40}?)\s+(?:engineer|developer|analyst|designer|manager|lead|architect|consultant|specialist|intern|associate|executive|officer|tester|qa|devops|sde|swe)/i,
  /#([A-Za-z][\w]{2,30}(?:Engineer|Developer|Analyst|Manager|Designer|Lead|Architect|Intern|Associate|Executive|Tester|QA|DevOps|SDE|SWE))/i,
];

// ─── Utility ──────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "2024-02-19"
}

function extractRole(text) {
  for (const p of ROLE_PATTERNS) {
    const m = text.match(p);
    if (m) {
      const role = (m[1] || m[2] || '').trim().replace(/\s+/g, ' ');
      if (role.length > 2 && role.length < 60) return role;
    }
  }
  return 'Job Position';
}

function isJobPost(text) {
  const lower = text.toLowerCase();
  return JOB_KEYWORDS.some(k => lower.includes(k));
}

// ─── Storage helpers ──────────────────────────────────────────
function getData() {
  return new Promise(r => chrome.storage.local.get([STORAGE_KEY], d => r(d[STORAGE_KEY] || {})));
}
function setData(all) {
  return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: all }, r));
}

async function getRecruiter(url) {
  const all = await getData();
  return all[url] || { url, name: '', posts: [], firstSeen: Date.now() };
}

async function saveRecruiter(url, rec) {
  const all = await getData();
  all[url] = rec;
  await setData(all);
}

async function logPost(profileUrl, name, role, dateStr) {
  const rec = await getRecruiter(profileUrl);
  if (name && name !== 'Unknown') rec.name = name;
  const dup = rec.posts.find(p => p.role === role && p.date === dateStr);
  if (!dup) {
    rec.posts.push({ role, date: dateStr, ts: Date.now() });
    await saveRecruiter(profileUrl, rec);
  }
  return rec;
}

// ─── Scoring ──────────────────────────────────────────────────
function score(rec) {
  const posts = rec.posts || [];
  if (!posts.length) return { level: 'unknown', pts: 0, reasons: [], roles: [], byDate: {} };

  let pts = 0;
  const reasons = [];

  // Group by date
  const byDate = {};
  posts.forEach(p => { (byDate[p.date] = byDate[p.date] || []).push(p); });

  const maxDay = Math.max(...Object.values(byDate).map(a => a.length));
  if (maxDay >= CFG.DAILY_LIMIT) {
    pts += 35;
    reasons.push(`Posted ${maxDay} jobs in a single day`);
  }

  const roles = [...new Set(posts.map(p => p.role).filter(Boolean))];
  if (roles.length >= CFG.ROLE_VARIETY) {
    pts += 25;
    reasons.push(`${roles.length} different roles posted`);
  }

  const roleCnt = {};
  posts.forEach(p => { if (p.role) roleCnt[p.role] = (roleCnt[p.role] || 0) + 1; });
  Object.entries(roleCnt).forEach(([r, c]) => {
    if (c >= CFG.SAME_REPEAT) { pts += 20; reasons.push(`"${r}" posted ${c} times`); }
  });

  if (posts.length >= 10) { pts += 10; reasons.push(`${posts.length} total job posts observed`); }

  const level = pts >= 60 ? 'high' : pts >= 25 ? 'medium' : 'low';
  return { level, pts, reasons, roles, byDate, roleCnt };
}

// ─── DOM: find recruiter URL from a post element ──────────────
function getAuthorFromPost(postEl) {
  // Multiple selectors for different LinkedIn layouts
  const selectors = [
    '.update-components-actor__meta a[href*="/in/"]',
    '.update-components-actor__meta a[href*="/company/"]',
    '.feed-shared-actor__meta a[href*="/in/"]',
    '.feed-shared-actor__meta a[href*="/company/"]',
    '.update-components-actor__title a',
    'a.app-aware-link[href*="/in/"]',
    'a.app-aware-link[href*="/company/"]',
    'a[data-control-name="actor"][href*="/in/"]',
    'a[data-control-name="actor"][href*="/company/"]',
    '.feed-shared-actor a[href*="/in/"]',
    '.feed-shared-actor a[href*="/company/"]',
  ];

  for (const sel of selectors) {
    const el = postEl.querySelector(sel);
    if (el && el.href) {
      const url = normalizeProfileUrl(el.href);
      if (url) {
        const name = el.querySelector('.update-components-actor__name, .feed-shared-actor__name, span[aria-hidden="true"]')?.innerText?.trim()
          || el.innerText?.trim()
          || 'Unknown';
        return { url, name: name.split('\n')[0].trim() };
      }
    }
  }
  return null;
}

function normalizeProfileUrl(href) {
  try {
    const u = new URL(href);
    const m = u.pathname.match(/^\/(in|company)\/([^/?#]+)/);
    if (m) return `https://www.linkedin.com/${m[1]}/${m[2]}`;
  } catch (_) {}
  return null;
}

// ─── DOM: extract date from post ─────────────────────────────
function getPostDate(postEl) {
  const timeEl = postEl.querySelector('time[datetime]');
  if (timeEl?.getAttribute('datetime')) {
    return timeEl.getAttribute('datetime').slice(0, 10);
  }

  // Try text like "2h", "1d", "3w"
  const spanSels = [
    '.update-components-actor__sub-description span[aria-hidden="true"]',
    '.feed-shared-actor__sub-description span[aria-hidden="true"]',
    '.update-components-actor__sub-description',
    'time',
    '[aria-label*=" ago"]',
  ];
  for (const s of spanSels) {
    const el = postEl.querySelector(s);
    const txt = el?.innerText || el?.getAttribute('aria-label') || '';
    const parsed = parseRelativeDate(txt);
    if (parsed) return parsed;
  }
  return todayStr();
}

function parseRelativeDate(txt) {
  if (!txt) return null;
  const t = txt.toLowerCase();
  const now = new Date();

  if (t.includes('just now') || t.includes('moment') || /\d+\s*min/.test(t) || /\d+\s*h/.test(t) || /\d+\s*sec/.test(t)) {
    return todayStr();
  }
  const dayMatch = t.match(/(\d+)\s*d/);
  if (dayMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(dayMatch[1]));
    return d.toISOString().slice(0, 10);
  }
  const wkMatch = t.match(/(\d+)\s*w/);
  if (wkMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(wkMatch[1]) * 7);
    return d.toISOString().slice(0, 10);
  }
  const moMatch = t.match(/(\d+)\s*mo/);
  if (moMatch) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - parseInt(moMatch[1]));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// ─── DOM: get post text ───────────────────────────────────────
function getPostText(postEl) {
  const sel = [
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '.attributed-text-segment-list__content',
    '.break-words',
  ];
  for (const s of sel) {
    const el = postEl.querySelector(s);
    if (el?.innerText?.trim()) return el.innerText.trim();
  }
  return postEl.innerText || '';
}

// ─── Badge UI ─────────────────────────────────────────────────
function insertBadge(postEl, sc, author) {
  if (postEl.querySelector('.frd-badge')) return;

  const { level, pts, reasons, roles } = sc;
  const emoji = level === 'high' ? '🚨' : level === 'medium' ? '⚠️' : '✅';
  const label = level === 'high' ? 'HIGH RISK — Likely Fraudulent'
              : level === 'medium' ? 'SUSPICIOUS Recruiter'
              : 'Looks Genuine';

  const badge = document.createElement('div');
  badge.className = `frd-badge frd-${level}`;
  badge.innerHTML = `
    <div class="frd-top">
      <span class="frd-emoji">${emoji}</span>
      <span class="frd-label">${label}</span>
      <span class="frd-pts">Risk: ${pts}</span>
      <button class="frd-toggle">▼ Details</button>
    </div>
    <div class="frd-body">
      ${reasons.length
        ? reasons.map(r => `<div class="frd-reason">• ${r}</div>`).join('')
        : '<div class="frd-reason">No suspicious patterns detected</div>'}
      ${roles.length ? `<div class="frd-roles">${roles.slice(0,8).map(r=>`<span class="frd-tag">${r}</span>`).join('')}</div>` : ''}
      <a class="frd-link" href="${author.url}" target="_blank">View Recruiter Profile →</a>
    </div>`;

  // Toggle
  badge.querySelector('.frd-toggle').onclick = (e) => {
    e.stopPropagation();
    const body = badge.querySelector('.frd-body');
    const btn  = badge.querySelector('.frd-toggle');
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    btn.textContent = open ? '▼ Details' : '▲ Hide';
  };

  // Insert before post content
  const insertTarget = postEl.querySelector(
    '.update-components-text, .feed-shared-update-v2__description, .feed-shared-text'
  ) || postEl.firstElementChild;

  if (insertTarget) {
    postEl.insertBefore(badge, insertTarget);
  } else {
    postEl.prepend(badge);
  }
}

// ─── Main scanner ─────────────────────────────────────────────
async function scanPosts() {
  // All possible post container selectors
  const postSelectors = [
    'div[data-urn^="urn:li:activity"]',
    'div[data-id^="urn:li:activity"]',
    '.feed-shared-update-v2',
    '.occludable-update',
    'li.profile-creator-shared-feed-update__container',
  ];

  let posts = [];
  for (const sel of postSelectors) {
    const found = [...document.querySelectorAll(sel)];
    if (found.length) { posts = found; break; }
  }

  for (const postEl of posts) {
    if (postEl.dataset.frdDone) continue;
    postEl.dataset.frdDone = '1';

    const text = getPostText(postEl);
    if (!text || !isJobPost(text)) continue;

    const author = getAuthorFromPost(postEl);
    if (!author) continue;

    const role    = extractRole(text);
    const dateStr = getPostDate(postEl);

    const rec = await logPost(author.url, author.name, role, dateStr);
    const sc  = score(rec);

    insertBadge(postEl, sc, author);
  }
}

// ─── Observer ─────────────────────────────────────────────────
const debouncedScan = debounce(scanPosts, CFG.SCAN_DELAY);

const observer = new MutationObserver(debouncedScan);
observer.observe(document.body, { childList: true, subtree: true });

// ─── Listen for popup message ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.action === 'scan') {
    // Reset done flags so we re-scan everything
    document.querySelectorAll('[data-frd-done]').forEach(el => delete el.dataset.frdDone);
    scanPosts().then(() => reply({ ok: true }));
    return true; // async reply
  }
  if (msg.action === 'getStats') {
    getData().then(all => reply({ all }));
    return true;
  }
});

// ─── Initial scan ─────────────────────────────────────────────
setTimeout(scanPosts, 1500);
