/*  LinkedIn Fraud Job Detector — content.js
    Works on: feed, company pages, profile pages, job pages
*/

(function() {
'use strict';

// Prevent multiple injections
if (window.__LINKEDIN_FRAUD_DETECTOR_LOADED__) {
  return; // Exit early if already loaded
}
window.__LINKEDIN_FRAUD_DETECTOR_LOADED__ = true;

// ─── Config ───────────────────────────────────────────────────
const CFG = {
  DAILY_LIMIT   : 2,   // >2 posts in one day → suspicious (stricter)
  ROLE_VARIETY  : 3,   // >3 different roles   → suspicious (lowered)
  SAME_REPEAT   : 2,   // same role 2+ times   → suspicious
  SCAN_DELAY    : 800, // ms debounce
  // Multi-window fake detection (more accurate)
  FAKE_STRICT   : { posts: 5, days: 5 },   // 5+ in 5 days = DEFINITE fake
  FAKE_LIKELY   : { posts: 4, days: 5 },   // 4+ in 5 days = LIKELY fake
  FAKE_WINDOW   : { posts: 5, days: 7 },   // 5+ in 7 days = fake
  FAKE_SUSPICIOUS: { posts: 3, days: 5 },  // 3+ in 5 days = SUSPICIOUS
  FAKE_VERY_SUSPICIOUS: { posts: 2, days: 3 }, // 2+ in 3 days = VERY SUSPICIOUS
  OBSERVATION_DAYS: 10, // 5+ posts seen within 10 days of first observation = fake
  ONLY_HIRING_THRESHOLD: 2, // If all posts are hiring and >= 2, suspicious
};

const STORAGE_KEY = 'recruiterData';

// ─── Role keywords used for extraction ────────────────────────
const JOB_KEYWORDS = [
  'hiring','we are hiring','is hiring','#hiring','hiring for','we\'re hiring',
  'join us','job opening','job opportunity','job vacancy','open position',
  'immediate joiner','urgent hiring','looking for','vacancy','opening for',
  'apply now','send your resume','send cv','share your resume','dm me',
  'interested candidates','walk in','walkin','freshers','experienced',
  'recruiter','recruitment','apply for','share cv','send resume',
  'job role','opportunity for','position open','referral','referrals',
  '#job','#jobs','#careers','#opening','dear connections','dear connection'
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

async function logPost(profileUrl, name, role, dateStr, contentSnippet = '') {
  const rec = await getRecruiter(profileUrl);
  if (name && name !== 'Unknown') rec.name = name;
  // Dedupe: same role+date+snippet = same post. Different snippet = different post (avoids undercounting)
  const snippet = (contentSnippet || '').slice(0, 80).replace(/\s+/g, ' ').trim();
  const dup = rec.posts.find(p => 
    p.role === role && p.date === dateStr && (snippet ? p.snippet === snippet : true)
  );
  if (!dup) {
    rec.posts.push({ role, date: dateStr, ts: Date.now(), snippet: snippet || undefined });
    await saveRecruiter(profileUrl, rec);
  }
  return rec;
}

// ─── Parse date safely ────────────────────────────────────────
function parsePostDate(p) {
  if (!p || !p.date) return null;
  try {
    const d = new Date(p.date + 'T12:00:00');
    return isNaN(d.getTime()) ? null : d;
  } catch (_) {
    return null;
  }
}

// ─── Check if posts indicate fake/spam pattern ──────────────────
function analyzeHiringPattern(posts, firstSeen) {
  if (!posts || posts.length === 0) return { isFake: false, count: 0, days: 0, reason: '', confidence: 0 };
  
  const now = Date.now();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  
  // Method 0: ALL posts are hiring posts (100% hiring ratio) - very suspicious
  // If we've tracked posts and ALL of them are hiring, this is a fake account
  if (posts.length >= CFG.ONLY_HIRING_THRESHOLD) {
    // All posts we track are hiring posts (we only log hiring posts)
    // So if someone has 2+ posts and they're all hiring, that's suspicious
    const daysSinceFirstSeen = firstSeen ? (now - firstSeen) / MS_PER_DAY : 999;
    if (firstSeen && daysSinceFirstSeen <= 7 && posts.length >= 2) {
      return {
        isFake: true,
        count: posts.length,
        days: Math.round(daysSinceFirstSeen),
        reason: `Posted ${posts.length} hiring posts in ${Math.round(daysSinceFirstSeen)} days - ALL posts are hiring (100% hiring ratio)`,
        confidence: 85,
        recentPosts: posts
      };
    }
  }
  
  // Method 1: Observation-based (most reliable) - we've seen N posts since first seeing this recruiter
  // Skip if firstSeen is missing (legacy data) to avoid false positives
  const daysSinceFirstSeen = firstSeen ? (now - firstSeen) / MS_PER_DAY : 999;
  if (firstSeen && posts.length >= 3 && daysSinceFirstSeen <= 5) {
    return {
      isFake: true,
      count: posts.length,
      days: Math.round(daysSinceFirstSeen),
      reason: `Posted ${posts.length} hiring posts within ${Math.round(daysSinceFirstSeen)} days of observation`,
      confidence: 95,
      recentPosts: posts
    };
  }
  
  // Method 2: Date-based with multiple windows
  const recent3 = posts.filter(p => {
    const d = parsePostDate(p);
    if (!d) return false;
    const cutoff = new Date(now - 3 * MS_PER_DAY);
    return d >= cutoff;
  });
  const recent5 = posts.filter(p => {
    const d = parsePostDate(p);
    if (!d) return false;
    const cutoff = new Date(now - 5 * MS_PER_DAY);
    return d >= cutoff;
  });
  const recent7 = posts.filter(p => {
    const d = parsePostDate(p);
    if (!d) return false;
    const cutoff = new Date(now - 7 * MS_PER_DAY);
    return d >= cutoff;
  });
  
  // 5+ in 5 days = DEFINITE fake
  if (recent5.length >= CFG.FAKE_STRICT.posts) {
    return {
      isFake: true,
      count: recent5.length,
      days: 5,
      reason: `Posted ${recent5.length} hiring posts in last 5 days`,
      confidence: 98,
      recentPosts: recent5
    };
  }
  
  // 4+ in 5 days = LIKELY fake
  if (recent5.length >= CFG.FAKE_LIKELY.posts) {
    return {
      isFake: true,
      count: recent5.length,
      days: 5,
      reason: `Posted ${recent5.length} hiring posts in last 5 days`,
      confidence: 90,
      recentPosts: recent5
    };
  }
  
  // 3+ in 5 days = SUSPICIOUS (new threshold)
  if (recent5.length >= CFG.FAKE_SUSPICIOUS.posts) {
    return {
      isFake: true,
      count: recent5.length,
      days: 5,
      reason: `Posted ${recent5.length} hiring posts in last 5 days`,
      confidence: 80,
      recentPosts: recent5
    };
  }
  
  // 2+ in 3 days = VERY SUSPICIOUS (catches cases like Arushi)
  if (recent3.length >= CFG.FAKE_VERY_SUSPICIOUS.posts) {
    return {
      isFake: true,
      count: recent3.length,
      days: 3,
      reason: `Posted ${recent3.length} hiring posts in last 3 days - suspicious pattern`,
      confidence: 75,
      recentPosts: recent3
    };
  }
  
  // 5+ in 7 days = fake
  if (recent7.length >= CFG.FAKE_WINDOW.posts) {
    return {
      isFake: true,
      count: recent7.length,
      days: 7,
      reason: `Posted ${recent7.length} hiring posts in last 7 days`,
      confidence: 92,
      recentPosts: recent7
    };
  }
  
  return {
    isFake: false,
    count: Math.max(recent3.length, recent5.length, recent7.length),
    days: recent3.length >= recent5.length ? 3 : (recent5.length >= recent7.length ? 5 : 7),
    reason: '',
    confidence: 0,
    recentPosts: recent3.length >= recent5.length ? recent3 : (recent5.length >= recent7.length ? recent5 : recent7)
  };
}

// ─── Generate personalized fake post message ──────────────────
function generateFakePostMessage(rec, hiringAnalysis) {
  const name = rec.name || 'This recruiter';
  const count = hiringAnalysis.count;
  const days = hiringAnalysis.days;
  const confidence = hiringAnalysis.confidence || 90;
  
  const messages = [
    `🚨 FAKE POST DETECTED - DO NOT APPLY`,
    ``,
    `⚠️ Why this post is likely FAKE (${confidence}% confidence):`,
    ``,
    `• ${name} has posted ${count} hiring posts in the last ${days} days`,
    `• ${hiringAnalysis.reason}`,
    `• Legitimate recruiters rarely post more than 1-2 jobs per week`,
    `• This pattern indicates spam/fake job postings or resume harvesting`,
    `• Could be a scam to collect personal info, resumes, or payment`,
    ``,
    `💡 Recommendation:`,
    `• Do NOT apply to this post`,
    `• Do NOT share personal information or documents`,
    `• Report suspicious activity to LinkedIn`,
    `• Apply only through official company career pages`,
    ``,
    `🔍 Profile Analysis:`,
    `• Total hiring posts tracked: ${rec.posts.length}`,
    `• Risk Level: CRITICAL - Likely Fraudulent`
  ];
  
  return messages.join('\n');
}

// ─── Scoring ──────────────────────────────────────────────────
function score(rec) {
  const posts = rec.posts || [];
  // Use firstSeen if available; for legacy data without it, use old timestamp so observation-based won't trigger
  const firstSeen = rec.firstSeen || (Date.now() - 365 * 24 * 60 * 60 * 1000);
  if (!posts.length) return { level: 'unknown', pts: 0, reasons: [], roles: [], byDate: {}, isFake: false, fakeMessage: '' };

  let pts = 0;
  const reasons = [];
  let isFake = false;
  let fakeMessage = '';

  // Primary: Multi-window fake detection (most accurate)
  const hiringAnalysis = analyzeHiringPattern(posts, firstSeen);
  if (hiringAnalysis.isFake) {
    pts += 100;
    isFake = true;
    reasons.push(`🚨 CRITICAL: ${hiringAnalysis.reason} - LIKELY FAKE`);
    fakeMessage = generateFakePostMessage(rec, hiringAnalysis);
  }

  // Group by date
  const byDate = {};
  posts.forEach(p => { (byDate[p.date] = byDate[p.date] || []).push(p); });
  const dayCounts = Object.values(byDate).map(a => a.length);
  const maxDay = dayCounts.length ? Math.max(...dayCounts) : 0;

  if (maxDay >= CFG.DAILY_LIMIT) {
    pts += 40;
    reasons.push(`Posted ${maxDay} jobs in a single day`);
  }

  const roles = [...new Set(posts.map(p => p.role).filter(Boolean))];
  if (roles.length >= CFG.ROLE_VARIETY) {
    pts += 30;
    reasons.push(`${roles.length} different roles posted`);
  }
  
  // Additional: If all posts are hiring (we only track hiring posts), that's suspicious
  if (posts.length >= 2) {
    pts += 20;
    reasons.push(`All ${posts.length} tracked posts are hiring posts (100% hiring ratio)`);
  }

  const roleCnt = {};
  posts.forEach(p => { if (p.role) roleCnt[p.role] = (roleCnt[p.role] || 0) + 1; });
  Object.entries(roleCnt).forEach(([r, c]) => {
    if (c >= CFG.SAME_REPEAT) { pts += 25; reasons.push(`"${r}" posted ${c} times`); }
  });

  if (posts.length >= 6) { pts += 15; reasons.push(`${posts.length} total hiring posts observed`); }
  if (posts.length >= 8) { pts += 10; }

  // Lower threshold for high risk - catch more suspicious cases
  const level = isFake || pts >= 45 ? 'high' : pts >= 20 ? 'medium' : 'low';
  return { level, pts, reasons, roles, byDate, roleCnt, isFake, fakeMessage, hiringAnalysis };
}

// ─── DOM: find recruiter URL from a post element ──────────────
function getAuthorFromPost(postEl) {
  // Multiple selectors for different LinkedIn layouts (feed, profile, company pages)
  const selectors = [
    // Feed selectors
    '.feed-shared-actor__meta a[href*="/in/"]',
    '.feed-shared-actor__meta a[href*="/company/"]',
    '.feed-shared-actor a[href*="/in/"]',
    '.feed-shared-actor a[href*="/company/"]',
    '.update-components-actor__meta a[href*="/in/"]',
    '.update-components-actor__meta a[href*="/company/"]',
    '.update-components-actor__title a',
    // Profile/company page selectors
    '.profile-creator-shared-feed-update__container a[href*="/in/"]',
    '.profile-creator-shared-feed-update__container a[href*="/company/"]',
    '.feed-shared-actor__name-link',
    '.update-components-actor__name-link',
    // Generic selectors
    'a.app-aware-link[href*="/in/"]',
    'a.app-aware-link[href*="/company/"]',
    'a[data-control-name="actor"][href*="/in/"]',
    'a[data-control-name="actor"][href*="/company/"]',
    // Fallback: any link with /in/ or /company/ in the post header
    'header a[href*="/in/"]',
    'header a[href*="/company/"]',
  ];

  for (const sel of selectors) {
    const el = postEl.querySelector(sel);
    if (el && el.href) {
      const url = normalizeProfileUrl(el.href);
      if (url) {
        // Try multiple ways to get the name
        const name = el.querySelector('.update-components-actor__name, .feed-shared-actor__name, .feed-shared-actor__name-link, span[aria-hidden="true"]')?.innerText?.trim()
          || el.textContent?.trim()
          || el.innerText?.trim()
          || el.getAttribute('aria-label')
          || 'Unknown';
        const cleanName = name.split('\n')[0].split('•')[0].trim();
        if (cleanName && cleanName !== 'Unknown') {
          return { url, name: cleanName };
        }
      }
    }
  }
  
  // Last resort: check if we're on a company/profile page, use URL
  const pathMatch = window.location.pathname.match(/\/(in|company)\/([^/]+)/);
  if (pathMatch) {
    const url = `https://www.linkedin.com/${pathMatch[1]}/${pathMatch[2]}`;
    const pageTitle = document.querySelector('h1, .text-heading-xlarge, .pv-text-details__left-panel h1')?.innerText?.trim();
    return { url, name: pageTitle || pathMatch[2] };
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
  if (!txt || typeof txt !== 'string') return null;
  const t = txt.toLowerCase().trim();
  const now = new Date();

  // Today: just now, minutes, hours
  if (t.includes('just now') || t.includes('moment') || t.includes('now') ||
      /\d+\s*(min|minute)s?/.test(t) || /\d+\s*h(?:our)?s?/.test(t) || /\d+\s*sec/.test(t) ||
      /^\d+\s*h$/.test(t) || /^\d+h$/.test(t)) {
    return todayStr();
  }
  // Days: "2d", "2 d", "2 days", "1 day"
  const dayMatch = t.match(/(\d+)\s*d(?:ay)?s?/i) || t.match(/(\d+)\s*d\b/i) || t.match(/^(\d+)d$/i);
  if (dayMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(dayMatch[1], 10));
    return d.toISOString().slice(0, 10);
  }
  // Weeks: "1w", "2 w", "1 week"
  const wkMatch = t.match(/(\d+)\s*w(?:eek)?s?/i) || t.match(/(\d+)\s*w\b/i) || t.match(/^(\d+)w$/i);
  if (wkMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(wkMatch[1], 10) * 7);
    return d.toISOString().slice(0, 10);
  }
  // Months: "1mo", "2 mo"
  const moMatch = t.match(/(\d+)\s*mo(?:nth)?s?/i) || t.match(/(\d+)\s*mo\b/i) || t.match(/^(\d+)mo$/i);
  if (moMatch) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - parseInt(moMatch[1], 10));
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
    '[data-placeholder="What do you want to talk about?"]',
    '.feed-shared-inline-show-more-text',
  ];
  for (const s of sel) {
    const el = postEl.querySelector(s);
    if (el?.innerText?.trim()) return el.innerText.trim();
  }
  // Fallback: get all text from post container
  const textEl = postEl.querySelector('.feed-shared-update-v2, [data-urn]');
  return (textEl || postEl).innerText?.trim() || '';
}

// ─── Badge UI ─────────────────────────────────────────────────
function insertBadge(postEl, sc, author) {
  // Remove existing badge if present (to update with new score)
  const existingBadge = postEl.querySelector('.frd-badge');
  if (existingBadge) {
    existingBadge.remove();
  }

  const { level, pts, reasons, roles, isFake, fakeMessage } = sc;
  const emoji = isFake ? '🚨' : level === 'high' ? '🚨' : level === 'medium' ? '⚠️' : '✅';
  const label = isFake ? 'FAKE POST - DO NOT APPLY'
              : level === 'high' ? 'HIGH RISK — Likely Fraudulent'
              : level === 'medium' ? 'SUSPICIOUS Recruiter'
              : 'Looks Genuine';

  const badge = document.createElement('div');
  badge.className = `frd-badge frd-${isFake ? 'fake' : level}`;
  
  // If fake, show prominent warning
  const warningSection = isFake && fakeMessage 
    ? `<div class="frd-fake-warning">
        <div class="frd-fake-title">⚠️ FAKE POST DETECTED</div>
        <div class="frd-fake-message">${fakeMessage.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed) return '<br>';
          // Escape HTML and format
          const escaped = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          // Make emojis and bold text stand out
          return `<div>${escaped}</div>`;
        }).join('')}</div>
      </div>`
    : '';

  badge.innerHTML = `
    <div class="frd-top">
      <span class="frd-emoji">${emoji}</span>
      <span class="frd-label">${label}</span>
      <span class="frd-pts">Risk: ${pts}</span>
      <button class="frd-toggle">▼ Details</button>
    </div>
    <div class="frd-body">
      ${warningSection}
      ${reasons.length
        ? reasons.map(r => `<div class="frd-reason">• ${r}</div>`).join('')
        : '<div class="frd-reason">No suspicious patterns detected</div>'}
      ${roles.length ? `<div class="frd-roles">${roles.slice(0,8).map(r=>`<span class="frd-tag">${r}</span>`).join('')}</div>` : ''}
      <a class="frd-link" href="${author.url}" target="_blank">View Recruiter Profile →</a>
      ${isFake ? '<div class="frd-do-not-apply">🚫 DO NOT APPLY TO THIS POST</div>' : ''}
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

  // Auto-expand if fake
  if (isFake) {
    badge.querySelector('.frd-body').style.display = 'block';
    badge.querySelector('.frd-toggle').textContent = '▲ Hide';
  }

  // Insert before post content - safely check parent
  const insertTarget = postEl.querySelector(
    '.update-components-text, .feed-shared-update-v2__description, .feed-shared-text'
  ) || postEl.firstElementChild;

  if (insertTarget && insertTarget.parentNode === postEl) {
    try {
      postEl.insertBefore(badge, insertTarget);
    } catch (e) {
      // Fallback if insertBefore fails
      postEl.prepend(badge);
    }
  } else if (postEl.firstElementChild) {
    try {
      postEl.insertBefore(badge, postEl.firstElementChild);
    } catch (e) {
      postEl.prepend(badge);
    }
  } else {
    postEl.prepend(badge);
  }
}

// ─── Analyze selected post ────────────────────────────────────
async function analyzeSelectedPost(postEl) {
  const text = getPostText(postEl);
  if (!text || !isJobPost(text)) {
    showNotification('This post does not appear to be a job posting.', 'info');
    return;
  }

  const author = getAuthorFromPost(postEl);
  if (!author) {
    showNotification('Could not find the author of this post.', 'error');
    return;
  }

  showNotification(`Analyzing ${author.name}'s profile...`, 'info');

  // Get existing data
  const rec = await getRecruiter(author.url);
  const role = extractRole(text);
  const dateStr = getPostDate(postEl);

  // Log this post (with text snippet for better deduplication)
  await logPost(author.url, author.name, role, dateStr, text);
  
  // Re-fetch to get updated data
  const updatedRec = await getRecruiter(author.url);
  const sc = score(updatedRec);

  // Show badge
  insertBadge(postEl, sc, author);

  // If fake, show alert
  if (sc.isFake) {
    showNotification('🚨 FAKE POST DETECTED! Check the warning badge above.', 'error');
  } else {
    showNotification(`Analysis complete. Risk level: ${sc.level}`, 'success');
  }
}

// ─── Show notification ─────────────────────────────────────────
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `frd-notification frd-notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('frd-notification-show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('frd-notification-show');
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// ─── Add click handler to posts for selection ──────────────────
function addPostSelectionHandlers() {
  const postSelectors = [
    'div[data-urn^="urn:li:activity"]',
    'div[data-id^="urn:li:activity"]',
    '.feed-shared-update-v2',
    '.occludable-update',
    'li.profile-creator-shared-feed-update__container',
  ];

  postSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(postEl => {
      if (postEl.dataset.frdSelectable) return;
      postEl.dataset.frdSelectable = '1';
      
      // Add visual indicator on hover
      postEl.style.position = 'relative';
      postEl.style.cursor = 'pointer';
      
      // Add click handler (but don't interfere with existing clicks)
      postEl.addEventListener('click', async (e) => {
        // Only trigger if clicking on the post itself, not on links/buttons
        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || 
            e.target.closest('a') || e.target.closest('button')) {
          return;
        }
        
        // Check if Ctrl/Cmd is pressed for manual analysis
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          await analyzeSelectedPost(postEl);
        }
      }, true);
    });
  });
}

// ─── Main scanner ─────────────────────────────────────────────
async function scanPosts() {
  // All possible post container selectors (feed + company/profile Posts tab + home feed)
  const postSelectors = [
    // Home feed selectors (priority)
    '.feed-shared-update-v2',
    'article.feed-shared-update-v2',
    '.occludable-update',
    'div[data-urn^="urn:li:activity"]',
    'div[data-id^="urn:li:activity"]',
    '[data-urn*="activity"]',
    // Profile/company page selectors
    'li.profile-creator-shared-feed-update__container',
    '.profile-creator-shared-feed-update__container',
    '.scaffold-finite-scroll__content article',
    '.scaffold-finite-scroll__content > div > div',
    'div[data-chameleon-result-urn]',
    // Additional feed selectors
    '.update-components-actor',
    '.feed-shared-actor',
    '[data-activity-id]',
  ];

  let posts = [];
  const seenIds = new Set();
  
  // Try all selectors and combine results (don't break on first match)
  for (const sel of postSelectors) {
    const found = [...document.querySelectorAll(sel)];
    if (found.length) {
      found.forEach(el => {
        // Use data-urn or data-id as unique identifier
        const id = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-activity-id') || null;
        const uniqueKey = id || el;
        
        // Skip if already processed or duplicate
        if (seenIds.has(uniqueKey) || el.dataset.frdDone) return;
        
        seenIds.add(uniqueKey);
        posts.push(el);
      });
    }
  }
  
  // Additional scan for profile/company pages
  if (window.location.pathname.includes('/posts/') || window.location.pathname.includes('/company/') || window.location.pathname.includes('/in/')) {
    const profilePosts = document.querySelectorAll(
      '.scaffold-finite-scroll__content article, ' +
      '.scaffold-finite-scroll__content [data-urn], ' +
      '.profile-creator-shared-feed-update__container, ' +
      '.feed-shared-update-v2'
    );
    profilePosts.forEach(el => {
      const id = el.getAttribute('data-urn') || el.getAttribute('data-id') || null;
      const uniqueKey = id || el;
      if (!seenIds.has(uniqueKey) && !el.dataset.frdDone) {
        seenIds.add(uniqueKey);
        posts.push(el);
      }
    });
  }
  
  // Also scan main feed container (for home feed)
  const mainFeed = document.querySelector('.scaffold-layout__main, .feed-container, [data-test-id="feed-container"]');
  if (mainFeed) {
    const feedPosts = mainFeed.querySelectorAll('.feed-shared-update-v2, article, [data-urn*="activity"]');
    feedPosts.forEach(el => {
      const id = el.getAttribute('data-urn') || el.getAttribute('data-id') || null;
      const uniqueKey = id || el;
      if (!seenIds.has(uniqueKey) && !el.dataset.frdDone) {
        seenIds.add(uniqueKey);
        posts.push(el);
      }
    });
  }

  for (const postEl of posts) {
    // Skip if already processed in this scan (but allow re-scanning on next scan)
    if (postEl.dataset.frdScanning) continue;
    postEl.dataset.frdScanning = '1';

    const text = getPostText(postEl);
    if (!text || !isJobPost(text)) {
      delete postEl.dataset.frdScanning; // Allow re-checking if not a job post
      continue;
    }

    const author = getAuthorFromPost(postEl);
    if (!author) {
      delete postEl.dataset.frdScanning;
      continue;
    }

    const role    = extractRole(text);
    const dateStr = getPostDate(postEl);

    // Log the post first
    await logPost(author.url, author.name, role, dateStr, text);
    
    // Re-fetch recruiter data to get updated posts list (critical for accurate scoring)
    const updatedRec = await getRecruiter(author.url);
    const sc  = score(updatedRec);

    // Always insert/update badge (insertBadge will remove old one if exists)
    insertBadge(postEl, sc, author);
    
    // Mark as done for this scan session
    postEl.dataset.frdDone = '1';
    delete postEl.dataset.frdScanning;
  }
  
  // Add selection handlers
  addPostSelectionHandlers();
}

// ─── Observer ─────────────────────────────────────────────────
const debouncedScan = debounce(scanPosts, CFG.SCAN_DELAY);

// Enhanced observer for better scroll detection
const observer = new MutationObserver((mutations) => {
  let shouldScan = false;
  for (const mutation of mutations) {
    // Check if new posts were added
    if (mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) { // Element node
          // Check if it's a post container or contains posts
          if (node.matches && (
            node.matches('.feed-shared-update-v2, article, [data-urn*="activity"], .occludable-update') ||
            node.querySelector('.feed-shared-update-v2, article, [data-urn*="activity"]')
          )) {
            shouldScan = true;
            break;
          }
        }
      }
    }
    if (shouldScan) break;
  }
  if (shouldScan) {
    debouncedScan();
  }
});

// Observe the entire document for changes (works on scroll)
observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});

// Also listen for scroll events to trigger scan (for infinite scroll)
let scrollTimeout;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    debouncedScan();
  }, 1000); // Scan 1 second after scrolling stops
}, { passive: true });

// ─── Listen for popup message ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.action === 'scan') {
    // Reset done flags so we re-scan everything
    document.querySelectorAll('[data-frd-done]').forEach(el => {
      delete el.dataset.frdDone;
      delete el.dataset.frdScanning;
    });
    // Also remove existing badges to force refresh
    document.querySelectorAll('.frd-badge').forEach(badge => badge.remove());
    scanPosts().then(() => reply({ ok: true }));
    return true; // async reply
  }
  if (msg.action === 'getStats') {
    getData().then(all => reply({ all }));
    return true;
  }
  if (msg.action === 'analyzePost') {
    // Analyze a specific post element
    const postEl = document.querySelector(msg.selector);
    if (postEl) {
      analyzeSelectedPost(postEl).then(() => reply({ ok: true })).catch(e => reply({ error: e.message }));
    } else {
      reply({ error: 'Post not found' });
    }
    return true;
  }
});

// ─── Initial scan ─────────────────────────────────────────────
// Scan immediately and also after page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      scanPosts();
      addPostSelectionHandlers();
    }, 1000);
  });
} else {
  setTimeout(() => {
    scanPosts();
    addPostSelectionHandlers();
  }, 1000);
}

// Also scan when page becomes visible (user switches back to tab)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    setTimeout(() => scanPosts(), 500);
  }
});

// ─── Add instructions overlay ────────────────────────────────
function showInstructions() {
  const instructions = document.createElement('div');
  instructions.id = 'frd-instructions';
  instructions.innerHTML = `
    <div class="frd-instructions-content">
      <div class="frd-instructions-title">🔍 LinkedIn Fake Post Detector</div>
      <div class="frd-instructions-text">
        <strong>How to use:</strong><br>
        • Posts are automatically scanned for fake hiring patterns<br>
        • Press <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd> on Mac) + Click on any post to analyze it manually<br>
        • Fake posts will show a 🚨 warning badge<br>
        • Check the extension popup for detailed statistics
      </div>
      <button class="frd-instructions-close">Got it!</button>
    </div>
  `;
  document.body.appendChild(instructions);
  
  instructions.querySelector('.frd-instructions-close').onclick = () => {
    instructions.remove();
    localStorage.setItem('frd-instructions-seen', 'true');
  };
  
  setTimeout(() => instructions.classList.add('frd-instructions-show'), 100);
}

// Show instructions on first visit
if (!localStorage.getItem('frd-instructions-seen')) {
  setTimeout(showInstructions, 2000);
}

})(); // End of IIFE - prevents redeclaration errors
