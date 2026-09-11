/* =========================================================
   DAWN VOCAB DAILY — free, no-key, front-end-only clone
   Data sources (all free, no subscription, no API key):
     - News:        Dawn RSS feeds, read through a public CORS proxy
     - Definitions: dictionaryapi.dev (Free Dictionary API)
     - Urdu:        api.mymemory.translated.net (MyMemory Translation)
     - Pictures:    api.openverse.org (openly-licensed real photos)
     - Voice:       browser's built-in Web Speech API (100% offline/free)
   Everything the user saves lives in localStorage on their device.
   ========================================================= */

const PROXY = url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
const FEEDS = {
  top: 'https://www.dawn.com/feeds/home',
  pakistan: 'https://www.dawn.com/feeds/pakistan',
  world: 'https://www.dawn.com/feeds/world',
  business: 'https://www.dawn.com/feeds/business',
  sport: 'https://www.dawn.com/feeds/sport',
  opinion: 'https://www.dawn.com/feeds/opinion',
};

/* ---------------- state ---------------- */
const store = {
  get(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

let state = {
  deck: store.get('dvd_deck', []),               // saved word objects
  lessons: store.get('dvd_lessons', {}),          // offline-saved lessons keyed by link
  chapters: store.get('dvd_chapters', []),        // never-forget story chapters
  speaking: store.get('dvd_speaking', []),        // read-aloud / pronounce log
  lessonsCompleted: store.get('dvd_lessons_done', 0),
  streak: store.get('dvd_streak', 0),
  lastVisit: store.get('dvd_last_visit', null),

  category: 'top',
  difficulty: 'advanced',
  wordCount: 10,
  currentArticle: null,
  currentWords: [],   // word objects for open lesson
  activeTab: 'summary',
  flashIndex: 0,
  flashFlipped: false,
};

function persist() {
  store.set('dvd_deck', state.deck);
  store.set('dvd_lessons', state.lessons);
  store.set('dvd_chapters', state.chapters);
  store.set('dvd_speaking', state.speaking);
  store.set('dvd_lessons_done', state.lessonsCompleted);
  store.set('dvd_streak', state.streak);
  store.set('dvd_last_visit', state.lastVisit);
}

/* ---------------- streak tracking ---------------- */
(function trackStreak() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastVisit !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    state.streak = state.lastVisit === yesterday ? state.streak + 1 : 1;
    state.lastVisit = today;
    persist();
  }
})();

/* ---------------- helpers ---------------- */
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function toast(msg) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), 2200);
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || d.innerText || '';
}

function showView(id) {
  qsa('.view').forEach(v => v.classList.remove('active'));
  qs('#view-' + id).classList.add('active');
  qsa('.nav-icons button').forEach(b => b.classList.toggle('active', b.dataset.nav === id));
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (id === 'deck') renderDeck();
  if (id === 'story') renderStoryView();
  if (id === 'offline') renderOfflineView();
  if (id === 'dashboard') renderDashboard();
  if (id === 'speaking') renderSpeakingView();
  refreshHomeBadges();
}
qsa('[data-nav]').forEach(el => el.addEventListener('click', () => showView(el.dataset.nav)));

function refreshHomeBadges() {
  qs('#review-badge').textContent = state.deck.length;
  qs('#deck-count-inline').textContent = `(${state.deck.length})`;
  qs('#offline-count-inline').textContent = `(${Object.keys(state.lessons).length})`;
}

/* ---------------- speech ---------------- */
function speak(text, label) {
  if (!('speechSynthesis' in window)) { toast('Voice not supported on this browser'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = 0.95;
  window.speechSynthesis.speak(u);
  state.speaking.unshift({ text: label || text, at: new Date().toISOString() });
  state.speaking = state.speaking.slice(0, 100);
  persist();
}

/* ---------------- STOPWORDS (common words we skip when picking vocab) ---------------- */
const STOPWORDS = new Set(`a about above after again against all am an and any are aren't as at be because been
before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during
each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself
him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my
myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll
she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they
they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've
were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't
you you'd you'll you're you've your yours yourself yourselves said says also new one two three first last year years
told say according also many much still even back time day week month news says told according editorial pakistan
lahore karachi islamabad reuters ap afp report reported reports government officials people country world city
state national international minister president dawn`.split(/\s+/));

function classifyDifficulty(word) {
  const n = word.length;
  if (n <= 4) return 'Easy';
  if (n <= 8) return 'Medium';
  return 'Hard';
}

function extractCandidateWords(text, difficulty, count) {
  const raw = (text.match(/[A-Za-z']{4,}/g) || []).map(w => w.toLowerCase());
  const seen = new Set();
  let candidates = [];
  for (const w of raw) {
    const clean = w.replace(/'s$/, '');
    if (STOPWORDS.has(clean) || seen.has(clean) || clean.length < 4) continue;
    seen.add(clean);
    candidates.push(clean);
  }
  // filter by requested difficulty band
  const band = w => {
    const d = classifyDifficulty(w);
    if (difficulty === 'beginner') return d === 'Easy';
    if (difficulty === 'intermediate') return d === 'Medium';
    if (difficulty === 'advanced') return d === 'Hard';
    return true; // mixed
  };
  let filtered = candidates.filter(band);
  if (filtered.length < count) filtered = filtered.concat(candidates.filter(w => !band(w)));
  // longest / rarest-looking first for a bit of quality bias
  filtered.sort((a, b) => b.length - a.length);
  const uniq = [...new Set(filtered)];
  return uniq.slice(0, count);
}

/* ---------------- external free APIs ---------------- */
async function fetchDefinition(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) throw new Error('no def');
    const json = await res.json();
    const entry = json[0];
    const phonetic = entry.phonetic || (entry.phonetics || []).map(p => p.text).find(Boolean) || '';
    const audio = (entry.phonetics || []).map(p => p.audio).find(a => a) || '';
    const meaning = (entry.meanings || [])[0] || {};
    const def = (meaning.definitions || [])[0] || {};
    return {
      phonetic,
      audio,
      pos: meaning.partOfSpeech || 'word',
      definition: def.definition || 'Definition unavailable.',
      example: def.example || `Today's article used the word "${word}".`
    };
  } catch {
    return { phonetic: '', audio: '', pos: 'word', definition: 'Definition unavailable (offline or not found).', example: `Today's article used the word "${word}".` };
  }
}

async function fetchUrdu(word) {
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ur`);
    const json = await res.json();
    return json?.responseData?.translatedText || '';
  } catch { return ''; }
}

async function fetchPicture(word) {
  try {
    const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(word)}&page_size=1`);
    const json = await res.json();
    const item = (json.results || [])[0];
    return item ? (item.thumbnail || item.url) : `https://placehold.co/400x300/eef0da/146b4d?text=${encodeURIComponent(word)}`;
  } catch {
    return `https://placehold.co/400x300/eef0da/146b4d?text=${encodeURIComponent(word)}`;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function buildWordObjects(words, article) {
  const out = [];
  for (const w of words) {
    const [def, urdu] = await Promise.all([fetchDefinition(w), fetchUrdu(w)]);
    out.push({
      word: w,
      display: w[0].toUpperCase() + w.slice(1),
      phonetic: def.phonetic,
      audio: def.audio,
      pos: def.pos,
      difficulty: classifyDifficulty(w),
      definition: def.definition,
      example: def.example,
      urdu,
      lessonTitle: article.title,
      lessonLink: article.link,
      savedAt: null,
    });
    await sleep(120); // be gentle on free APIs
  }
  return out;
}

/* ---------------- RSS fetching ---------------- */
async function fetchFeed(category) {
  const url = FEEDS[category] || FEEDS.top;
  const res = await fetch(PROXY(url));
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const items = [...doc.querySelectorAll('item')].slice(0, 8);
  return items.map(item => {
    const title = item.querySelector('title')?.textContent || 'Untitled';
    const link = item.querySelector('link')?.textContent || '#';
    const pubDate = item.querySelector('pubDate')?.textContent || '';
    const descRaw = item.querySelector('description')?.textContent || '';
    const description = stripHtml(descRaw).trim();
    let image = '';
    const enclosure = item.querySelector('enclosure');
    if (enclosure) image = enclosure.getAttribute('url');
    const mediaContent = item.getElementsByTagName('media:content')[0];
    if (!image && mediaContent) image = mediaContent.getAttribute('url');
    if (!image) {
      const imgMatch = descRaw.match(/<img[^>]+src="([^"]+)"/);
      if (imgMatch) image = imgMatch[1];
    }
    return { title, link, pubDate, description, image };
  });
}

async function fetchFullArticleText(link) {
  try {
    const res = await fetch(PROXY(link));
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const selectors = ['.story__content p', 'article p', '.content p', 'p'];
    for (const sel of selectors) {
      const paras = [...doc.querySelectorAll(sel)].map(p => p.textContent.trim()).filter(t => t.length > 40);
      if (paras.length >= 3) return paras.slice(0, 10).join(' ');
    }
    return '';
  } catch { return ''; }
}

/* ---------------- HOME / article list ---------------- */
async function loadArticles() {
  const list = qs('#article-list');
  list.innerHTML = '<div class="loading">Loading fresh Dawn articles…</div>';
  try {
    const articles = await fetchFeed(state.category);
    if (!articles.length) throw new Error('empty');
    list.innerHTML = '';
    articles.forEach(a => list.appendChild(renderArticleCard(a)));
  } catch (e) {
    list.innerHTML = `<div class="empty-state">Couldn't reach Dawn's feed right now (network or proxy limit).<br>Tap ↻ Refresh to try again.</div>`;
  }
}

function renderArticleCard(article) {
  const div = document.createElement('div');
  div.className = 'article-card';
  const dateStr = article.pubDate ? new Date(article.pubDate).toDateString() : '';
  div.innerHTML = `
    ${article.image ? `<img src="${article.image}" alt="">` : ''}
    <div class="pad">
      <div class="article-date">🕐 ${dateStr}</div>
      <h3 class="article-title">${escapeHtml(article.title)}</h3>
      <p class="article-excerpt">${escapeHtml(article.description).slice(0, 160)}…</p>
      <button class="btn-primary learn-btn">✨ Learn words</button>
    </div>`;
  div.querySelector('.learn-btn').addEventListener('click', () => openLesson(article));
  return div;
}

/* filters */
qsa('#category-row .pill[data-cat]').forEach(btn => btn.addEventListener('click', () => {
  qsa('#category-row .pill[data-cat]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.category = btn.dataset.cat;
  loadArticles();
}));
qs('#refresh-btn').addEventListener('click', loadArticles);
qsa('#difficulty-row .pill').forEach(btn => btn.addEventListener('click', () => {
  qsa('#difficulty-row .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.difficulty = btn.dataset.diff;
}));
qs('#word-count-slider').addEventListener('input', e => {
  state.wordCount = +e.target.value;
  qs('#word-count-label').textContent = state.wordCount;
});
qs('#search-btn').addEventListener('click', doSearch);
qs('#search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
async function doSearch() {
  const q = qs('#search-input').value.trim();
  if (!q) return;
  const list = qs('#article-list');
  list.innerHTML = '<div class="loading">Searching Dawn for "' + escapeHtml(q) + '"…</div>';
  try {
    const articles = await fetchFeed(state.category);
    const filtered = articles.filter(a => (a.title + a.description).toLowerCase().includes(q.toLowerCase()));
    list.innerHTML = '';
    (filtered.length ? filtered : articles).forEach(a => list.appendChild(renderArticleCard(a)));
    if (!filtered.length) toast('No exact match — showing latest instead');
  } catch { list.innerHTML = '<div class="empty-state">Search failed — try again.</div>'; }
}

/* ---------------- LESSON VIEW ---------------- */
async function openLesson(article) {
  state.currentArticle = article;
  state.activeTab = 'summary';
  showView('lesson');
  qs('#lesson-header').innerHTML = `
    <h2 class="lesson-headline">${escapeHtml(article.title)}</h2>
    <a class="lesson-link" href="${article.link}" target="_blank" rel="noopener">Read the full article on Dawn →</a><br>
    <button class="saved-btn outline" id="save-offline-btn">⬇ Save offline</button>`;
  qsa('.tabs-row .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'summary'));
  qs('#tab-content').innerHTML = '<div class="loading">Fetching the article and building your lesson…</div>';

  let fullText = await fetchFullArticleText(article.link);
  if (!fullText || fullText.length < 100) fullText = article.description;
  article.fullText = fullText;

  const words = extractCandidateWords(fullText, state.difficulty, state.wordCount);
  qs('#tab-content').innerHTML = '<div class="loading">Looking up definitions &amp; Urdu meanings…</div>';
  state.currentWords = await buildWordObjects(words.length ? words : extractCandidateWords(fullText, 'mixed', state.wordCount), article);

  state.lessonsCompleted++;
  persist();
  qs('#save-offline-btn').addEventListener('click', () => saveLessonOffline(article));
  renderTab('summary');
}

qsa('.tabs-row .tab-btn').forEach(btn => btn.addEventListener('click', () => {
  qsa('.tabs-row .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTab(btn.dataset.tab);
}));

function renderTab(tab) {
  state.activeTab = tab;
  state.flashIndex = 0; state.flashFlipped = false;
  const c = qs('#tab-content');
  if (!state.currentWords.length) { c.innerHTML = '<div class="loading">No words extracted yet.</div>'; return; }
  const renderers = {
    summary: renderSummaryTab, story: renderStoryTab, article: renderArticleTab,
    flashcards: renderFlashcardsTab, wordlist: renderWordListTab, pictures: renderPicturesTab,
    memory: renderMemoryTab, practice: renderPracticeTab,
  };
  (renderers[tab] || renderSummaryTab)(c);
}

function highlightWords(text, words) {
  let out = escapeHtml(text);
  words.forEach(w => {
    const re = new RegExp(`\\b(${w.word})\\b`, 'gi');
    out = out.replace(re, '<span class="hl" data-word="' + w.word + '">$1</span>');
  });
  return out;
}
function bindHighlightClicks(root) {
  qsa('.hl', root).forEach(span => span.addEventListener('click', () => {
    const wordObj = state.currentWords.find(w => w.word === span.dataset.word);
    if (wordObj) openWordModal(wordObj);
  }));
}

function renderSummaryTab(c) {
  const desc = state.currentArticle.description || 'Summary unavailable for this article.';
  const words = state.currentWords;
  const mentioned = words.filter(w => desc.toLowerCase().includes(w.word));
  const extra = words.filter(w => !mentioned.includes(w)).slice(0, 3);
  let summary = desc;
  if (extra.length) summary += ` This piece also touches on ideas like ${extra.map(w => w.word).join(', ')}.`;
  c.innerHTML = `
    <div class="content-title"><span>Article summary</span>
      <button class="listen-btn" id="listen-summary">🔊 Listen</button></div>
    <div class="body-text" id="summary-text">${highlightWords(summary, words)}</div>
    <p class="small-note">Built from Dawn's own article summary (RSS description), free — no paid AI call.</p>`;
  bindHighlightClicks(c);
  qs('#listen-summary').addEventListener('click', () => speak(summary, 'Article summary'));
}

const STORY_TEMPLATES = [
  w => `When investigators first noticed the situation, everyone agreed it was truly ${w}.`,
  w => `The report described the whole affair as deeply ${w}, catching officials off guard.`,
  w => `Analysts struggled to explain how something so ${w} could happen without warning.`,
  w => `It became clear that the ${w} nature of events would shape the debate for weeks.`,
  w => `Few had expected the situation to turn so ${w} so quickly.`,
  w => `Commentators called the response ${w}, unlike anything seen before.`,
];
function generateStory(words) {
  return words.map((w, i) => STORY_TEMPLATES[i % STORY_TEMPLATES.length](w.word)).join(' ');
}
function renderStoryTab(c) {
  const story = generateStory(state.currentWords);
  c.innerHTML = `
    <div class="content-title"><span>A story with all your words</span>
      <button class="listen-btn" id="listen-story">🔊 Read aloud</button></div>
    <div class="body-text">${highlightWords(story, state.currentWords)}</div>
    <p class="small-note">Template-generated for free from your selected words (no paid AI). Swap in your own OpenAI/Anthropic key in app.js → generateStory() for richer prose.</p>`;
  bindHighlightClicks(c);
  qs('#listen-story').addEventListener('click', () => speak(story, 'Lesson story'));
}

function renderArticleTab(c) {
  const text = state.currentArticle.fullText || state.currentArticle.description;
  c.innerHTML = `
    <div class="content-title"><span>Original article extract</span>
      <button class="listen-btn" id="listen-article">🔊 Read aloud</button></div>
    <p class="small-note" style="margin-bottom:14px;">Tap any word to see its detailed Urdu meaning and save it to your deck.</p>
    <div class="body-text">${highlightWords(text, state.currentWords)}</div>`;
  bindHighlightClicks(c);
  qs('#listen-article').addEventListener('click', () => speak(text, 'Article extract'));
}

function renderFlashcardsTab(c) {
  const words = state.currentWords;
  const i = state.flashIndex;
  const w = words[i];
  const pct = ((i + 1) / words.length) * 100;
  c.innerHTML = `
    <div class="card-meta-row"><span>CARD ${i + 1} OF ${words.length}</span><span>TAP CARD TO FLIP</span></div>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="flashcard" id="flash-el">
      ${state.flashFlipped ? `
        <div class="flash-urdu">${w.urdu || '—'}</div>
        <div class="flash-def">${escapeHtml(w.definition)}</div>
        <button class="pronounce-btn" id="save-flash">${isSaved(w) ? '★ Saved' : '☆ Save to deck'}</button>
      ` : `
        <span class="pos-badge">${w.pos}</span>
        <h3 class="flash-word">${w.display}</h3>
        <span class="flash-phonetic">${w.phonetic || ''}</span>
        <button class="pronounce-btn" id="pronounce-flash">🔊 Pronounce</button>
      `}
    </div>
    <div class="card-nav-row">
      <button class="btn-outline" id="flash-prev" ${i === 0 ? 'disabled' : ''}>← Prev</button>
      <button class="btn-outline" id="flash-next" ${i === words.length - 1 ? 'disabled' : ''}>Next →</button>
    </div>`;
  qs('#flash-el').addEventListener('click', e => {
    if (e.target.closest('button')) return;
    state.flashFlipped = !state.flashFlipped;
    renderFlashcardsTab(c);
  });
  const pron = qs('#pronounce-flash'); if (pron) pron.addEventListener('click', ev => { ev.stopPropagation(); speak(w.word); });
  const sv = qs('#save-flash'); if (sv) sv.addEventListener('click', ev => { ev.stopPropagation(); toggleSaveWord(w); renderFlashcardsTab(c); });
  const prev = qs('#flash-prev'); if (prev) prev.addEventListener('click', () => { state.flashIndex--; state.flashFlipped = false; renderFlashcardsTab(c); });
  const next = qs('#flash-next'); if (next) next.addEventListener('click', () => { state.flashIndex++; state.flashFlipped = false; renderFlashcardsTab(c); });
}

function renderWordListTab(c) {
  c.innerHTML = '<div class="content-title"><span>Word list</span></div>' +
    state.currentWords.map(w => `
      <div class="word-card">
        <div class="word-card-top">
          <div>
            <h3>${w.display}</h3>
            <div class="word-meta">${w.phonetic || ''} · ${w.pos} · <span class="diff-tag">${w.difficulty}</span></div>
          </div>
          <button class="listen-btn" data-word="${w.word}">🔊</button>
        </div>
        <div class="urdu-line">${w.urdu || '—'}</div>
        <div class="eng-def">${escapeHtml(w.definition)}</div>
        <div class="example-line">${escapeHtml(w.example)}</div>
        <button class="save-toggle ${isSaved(w) ? 'saved' : ''}" data-word="${w.word}">${isSaved(w) ? 'Saved' : 'Save'}</button>
      </div>`).join('');
  qsa('.listen-btn[data-word]', c).forEach(b => b.addEventListener('click', () => {
    const w = state.currentWords.find(x => x.word === b.dataset.word); speak(w.word);
  }));
  qsa('.save-toggle', c).forEach(b => b.addEventListener('click', () => {
    const w = state.currentWords.find(x => x.word === b.dataset.word);
    toggleSaveWord(w); renderWordListTab(c);
  }));
}

async function renderPicturesTab(c) {
  c.innerHTML = `
    <div class="content-title"><span>A picture for every word</span></div>
    <p class="small-note" style="margin-bottom:14px;">Real, openly-licensed photos via Openverse — visual memory makes vocabulary stick far longer.</p>
    <div class="pic-grid" id="pic-grid">${state.currentWords.map(w => `
      <div class="pic-card"><img id="img-${w.word}" src="" alt="${w.word}"><div class="pic-label">${w.display}</div></div>`).join('')}</div>`;
  for (const w of state.currentWords) {
    fetchPicture(w.word).then(url => { const img = qs(`#img-${w.word}`); if (img) img.src = url; });
  }
}

function renderMemoryTab(c) {
  const words = state.currentWords.slice(0, 6);
  const tiles = [
    ...words.map(w => ({ key: w.word, label: w.display, type: 'en' })),
    ...words.map(w => ({ key: w.word, label: w.urdu || w.word, type: 'ur' })),
  ].sort(() => Math.random() - 0.5);
  let selected = [];
  let matched = new Set();
  c.innerHTML = `<div class="content-title"><span>Memory game</span></div>
    <p class="small-note" style="margin-bottom:14px;">Match each English word with its Urdu meaning.</p>
    <div class="mem-grid" id="mem-grid"></div>`;
  const grid = qs('#mem-grid');
  tiles.forEach((t, idx) => {
    const el = document.createElement('div');
    el.className = 'mem-tile';
    el.textContent = t.label;
    el.dataset.key = t.key; el.dataset.idx = idx;
    el.addEventListener('click', () => {
      if (matched.has(t.key) || selected.find(s => s.idx === idx)) return;
      el.classList.add('selected');
      selected.push({ idx, key: t.key, el });
      if (selected.length === 2) {
        if (selected[0].key === selected[1].key) {
          matched.add(selected[0].key);
          selected.forEach(s => { s.el.classList.remove('selected'); s.el.classList.add('matched'); });
          selected = [];
          if (matched.size === words.length) toast('🎉 All matched!');
        } else {
          setTimeout(() => { selected.forEach(s => s.el.classList.remove('selected')); selected = []; }, 700);
        }
      }
    });
    grid.appendChild(el);
  });
}

function renderPracticeTab(c) {
  const words = state.currentWords;
  let qIndex = 0, correctCount = 0;
  function renderQ() {
    if (qIndex >= words.length) {
      c.innerHTML = `<div class="content-title"><span>Practice complete 🎉</span></div>
        <p class="body-text" style="font-size:17px;">You scored ${correctCount} / ${words.length}.</p>
        <button class="btn-primary" id="retry-practice">Try again</button>`;
      qs('#retry-practice').addEventListener('click', () => { qIndex = 0; correctCount = 0; renderQ(); });
      return;
    }
    const w = words[qIndex];
    const distractors = words.filter(x => x.word !== w.word).sort(() => Math.random() - 0.5).slice(0, 3).map(x => x.display);
    const options = [w.display, ...distractors].sort(() => Math.random() - 0.5);
    c.innerHTML = `
      <div class="content-title"><span>Practice</span></div>
      <div class="quiz-progress">Question ${qIndex + 1} of ${words.length}</div>
      <div class="quiz-q">Which word means: <strong>“${escapeHtml(w.definition)}”</strong>?</div>
      <div class="quiz-opts">${options.map(o => `<button class="quiz-opt" data-opt="${o}">${o}</button>`).join('')}</div>`;
    qsa('.quiz-opt', c).forEach(btn => btn.addEventListener('click', () => {
      qsa('.quiz-opt', c).forEach(b => b.disabled = true);
      if (btn.dataset.opt === w.display) { btn.classList.add('correct'); correctCount++; }
      else { btn.classList.add('wrong'); qsa('.quiz-opt', c).find(b => b.dataset.opt === w.display)?.classList.add('correct'); }
      setTimeout(() => { qIndex++; renderQ(); }, 900);
    }));
  }
  renderQ();
}

/* ---------------- word save / deck ---------------- */
function isSaved(w) { return state.deck.some(d => d.word === w.word); }
function toggleSaveWord(w) {
  if (isSaved(w)) {
    state.deck = state.deck.filter(d => d.word !== w.word);
    toast(`Removed "${w.display}"`);
  } else {
    state.deck.unshift({ ...w, savedAt: new Date().toISOString() });
    toast(`Saved "${w.display}" ★`);
  }
  persist();
  refreshHomeBadges();
}

function openWordModal(w) {
  qs('#modal-body').innerHTML = `
    <span class="pos-badge">${w.pos} · ${w.difficulty}</span>
    <h2 style="margin:10px 0 2px;">${w.display}</h2>
    <div class="word-meta">${w.phonetic || ''}</div>
    <div class="urdu-line">${w.urdu || '—'}</div>
    <div class="eng-def">${escapeHtml(w.definition)}</div>
    <div class="example-line">${escapeHtml(w.example)}</div>
    <div style="display:flex;gap:10px;margin-top:16px;">
      <button class="pronounce-btn" id="modal-pronounce">🔊 Pronounce</button>
      <button class="pronounce-btn" id="modal-save">${isSaved(w) ? '★ Saved' : '☆ Save to deck'}</button>
    </div>`;
  qs('#word-modal').classList.remove('hidden');
  qs('#modal-pronounce').addEventListener('click', () => speak(w.word));
  qs('#modal-save').addEventListener('click', () => { toggleSaveWord(w); openWordModal(w); });
}
qs('#modal-close').addEventListener('click', () => qs('#word-modal').classList.add('hidden'));
qs('#word-modal').addEventListener('click', e => { if (e.target.id === 'word-modal') e.currentTarget.classList.add('hidden'); });

/* ---------------- DECK VIEW ---------------- */
function renderDeck() {
  qs('#deck-top-bar').innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="num">${state.deck.length}</div><div class="lbl">SAVED WORDS</div></div>
      <div class="stat-box"><div class="num">${new Set(state.deck.map(d => d.lessonLink)).size}</div><div class="lbl">ARTICLES</div></div>
      <div class="stat-box"><div class="num">${state.deck.filter(d => d.difficulty === 'Hard').length}</div><div class="lbl">HARD WORDS</div></div>
    </div>
    ${state.deck.length ? `<button class="link-btn" id="clear-deck-btn" style="color:var(--danger);">🗑 Clear deck</button>` : ''}`;
  const cbtn = qs('#clear-deck-btn');
  if (cbtn) cbtn.addEventListener('click', () => {
    if (confirm('Clear your entire saved-words deck?')) { state.deck = []; persist(); renderDeck(); refreshHomeBadges(); }
  });

  const c = qs('#deck-content');
  if (!state.deck.length) { c.innerHTML = '<div class="empty-state">No saved words yet. Open a lesson and tap ☆ Save on any word.</div>'; return; }
  c.innerHTML = state.deck.map(w => `
    <div class="word-card">
      <div class="word-card-top">
        <div><h3>${w.display}</h3><div class="word-meta">${w.phonetic || ''} · ${w.pos} · <span class="diff-tag">${w.difficulty}</span></div></div>
        <button class="listen-btn" data-word="${w.word}">🔊</button>
      </div>
      <div class="urdu-line">${w.urdu || '—'}</div>
      <div class="eng-def">${escapeHtml(w.definition)}</div>
      <div class="chip-row"><span class="chip">from “${escapeHtml((w.lessonTitle || '').slice(0, 40))}”</span></div>
      <button class="save-toggle saved" data-word="${w.word}">Remove</button>
    </div>`).join('');
  qsa('.listen-btn[data-word]', c).forEach(b => b.addEventListener('click', () => speak(b.dataset.word)));
  qsa('.save-toggle', c).forEach(b => b.addEventListener('click', () => {
    state.deck = state.deck.filter(d => d.word !== b.dataset.word);
    persist(); renderDeck(); refreshHomeBadges();
  }));
}

/* ---------------- STORY VIEW (never-forget story) ---------------- */
function renderStoryView() {
  const included = new Set(state.chapters.flatMap(ch => ch.words));
  const waiting = state.deck.filter(w => !included.has(w.word));
  qs('#story-stats').textContent = `${state.deck.length} saved words · ${state.chapters.length} chapters · ${waiting.length} new words waiting`;
  qs('#add-new-words-btn').disabled = waiting.length === 0;

  const list = qs('#chapters-list');
  if (!state.chapters.length) { list.innerHTML = '<div class="empty-state">No chapters yet. Save some words, then tap "Add new words".</div>'; return; }
  list.innerHTML = state.chapters.map((ch, idx) => `
    <div class="chapter-card">
      <div class="chapter-meta">
        <span class="chapter-date">Chapter ${idx + 1} · ${ch.date}</span>
        <div><button class="icon-btn" data-listen="${idx}">🔊</button><button class="icon-btn" data-del="${idx}">🗑</button></div>
      </div>
      <h3 style="margin:6px 0 10px;">${escapeHtml(ch.title)}</h3>
      <div class="body-text" style="font-size:16px;">${highlightChapterWords(ch.text, ch.words)}</div>
      <div class="chip-row">${ch.words.map(w => `<span class="chip">${w}</span>`).join('')}</div>
    </div>`).join('');
  qsa('[data-listen]', list).forEach(b => b.addEventListener('click', () => speak(state.chapters[+b.dataset.listen].text, 'Story chapter')));
  qsa('[data-del]', list).forEach(b => b.addEventListener('click', () => {
    state.chapters.splice(+b.dataset.del, 1); persist(); renderStoryView();
  }));
}
function highlightChapterWords(text, words) {
  let out = escapeHtml(text);
  words.forEach(w => { out = out.replace(new RegExp(`\\b(${w})\\b`, 'gi'), '<span class="hl">$1</span>'); });
  return out;
}
const CHAPTER_TITLES = ['A Beacon in the Storm', 'Words That Stayed', 'The Turning Page', 'Echoes We Kept', 'A New Chapter Begins'];
qs('#add-new-words-btn').addEventListener('click', () => {
  const included = new Set(state.chapters.flatMap(ch => ch.words));
  const waiting = state.deck.filter(w => !included.has(w.word)).slice(0, 12);
  if (!waiting.length) return;
  const text = generateStory(waiting);
  state.chapters.unshift({
    date: new Date().toISOString().slice(0, 10),
    title: CHAPTER_TITLES[state.chapters.length % CHAPTER_TITLES.length],
    text, words: waiting.map(w => w.word),
  });
  persist(); renderStoryView(); toast('New chapter added ✨');
});
qs('#rewrite-story-btn').addEventListener('click', () => {
  if (!state.deck.length) { toast('Save some words first'); return; }
  if (!confirm('Rewrite the whole story from all saved words? Old chapters will be replaced.')) return;
  const text = generateStory(state.deck.slice(0, 20));
  state.chapters = [{ date: new Date().toISOString().slice(0, 10), title: 'The Story, Rewritten', text, words: state.deck.slice(0, 20).map(w => w.word) }];
  persist(); renderStoryView();
});

/* ---------------- OFFLINE VIEW ---------------- */
function saveLessonOffline(article) {
  state.lessons[article.link] = {
    title: article.title, link: article.link, date: new Date().toISOString().slice(0, 10),
    difficulty: state.difficulty, wordCount: state.currentWords.length,
    description: article.description, words: state.currentWords, fullText: article.fullText,
  };
  persist(); refreshHomeBadges();
  toast('Saved offline ✓');
  qs('#save-offline-btn').textContent = '✓ Saved offline';
}
function renderOfflineView() {
  const items = Object.values(state.lessons);
  qs('#offline-count-label').textContent = `${items.length} lesson${items.length === 1 ? '' : 's'} available offline`;
  const list = qs('#offline-list');
  if (!items.length) { list.innerHTML = '<div class="empty-state">Nothing saved offline yet. Open a lesson and tap "Save offline".</div>'; return; }
  list.innerHTML = items.map(l => `
    <div class="offline-card">
      <div class="offline-meta">🕐 ${l.date} · ${(l.difficulty || '').toUpperCase()} · ${l.wordCount} WORDS</div>
      <h3 style="margin:0 0 8px;">${escapeHtml(l.title)}</h3>
      <p class="article-excerpt">${escapeHtml((l.description || '').slice(0, 140))}…</p>
      <div class="offline-actions">
        <button class="btn-primary" data-open="${l.link}">📖 Open lesson</button>
        <span class="saved-tag">⬇ SAVED</span>
        <button class="icon-btn" data-del="${l.link}">🗑</button>
      </div>
    </div>`).join('');
  qsa('[data-open]', list).forEach(b => b.addEventListener('click', () => {
    const l = state.lessons[b.dataset.open];
    state.currentArticle = { title: l.title, link: l.link, description: l.description, fullText: l.fullText };
    state.currentWords = l.words;
    showView('lesson');
    qs('#lesson-header').innerHTML = `
      <h2 class="lesson-headline">${escapeHtml(l.title)}</h2>
      <a class="lesson-link" href="${l.link}" target="_blank" rel="noopener">Read the full article on Dawn →</a><br>
      <span class="saved-tag" style="margin-top:10px;">⬇ Loaded from offline storage</span>`;
    renderTab('summary');
  }));
  qsa('[data-del]', list).forEach(b => b.addEventListener('click', () => {
    delete state.lessons[b.dataset.del]; persist(); renderOfflineView(); refreshHomeBadges();
  }));
}
qs('#clear-offline-btn').addEventListener('click', () => {
  if (!Object.keys(state.lessons).length) return;
  if (confirm('Clear all offline lessons?')) { state.lessons = {}; persist(); renderOfflineView(); refreshHomeBadges(); }
});

/* ---------------- DASHBOARD ---------------- */
function renderDashboard() {
  qs('#dash-deck').textContent = state.deck.length;
  qs('#dash-lessons').textContent = state.lessonsCompleted;
  qs('#dash-streak').textContent = state.streak;
  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  state.deck.forEach(w => counts[w.difficulty] = (counts[w.difficulty] || 0) + 1);
  qs('#dash-breakdown').innerHTML = Object.entries(counts).map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
      <span>${k}</span><strong>${v}</strong></div>`).join('') || '<p class="small-note">Save some words to see your breakdown.</p>';
}

/* ---------------- SPEAKING HISTORY ---------------- */
function renderSpeakingView() {
  const list = qs('#speaking-list');
  if (!state.speaking.length) { list.innerHTML = '<div class="empty-state">Nothing spoken yet — tap any 🔊 button around the app.</div>'; return; }
  list.innerHTML = state.speaking.slice(0, 50).map(s => `
    <div class="word-card" style="padding:16px 22px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>${escapeHtml(s.text.slice(0, 80))}</span>
        <span class="word-meta">${new Date(s.at).toLocaleString()}</span>
      </div>
    </div>`).join('');
}

/* ---------------- init ---------------- */
refreshHomeBadges();
loadArticles();
