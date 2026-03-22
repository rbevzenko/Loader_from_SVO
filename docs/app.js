'use strict';

// ── Theme toggle ────────────────────────────────────────────────────────────
(function () {
  const root = document.documentElement;
  const btn  = document.getElementById('themeToggle');
  const mq   = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(dark) {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  // Listen for OS-level changes (only when user hasn't set a manual preference)
  mq.addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) applyTheme(e.matches);
  });

  if (btn) {
    btn.addEventListener('click', function () {
      const isDark = root.getAttribute('data-theme') === 'dark';
      const next   = !isDark;
      applyTheme(next);
      localStorage.setItem('theme', next ? 'dark' : 'light');
    });
  }
})();

// For GitHub Pages the JSON is served from the same origin
const DATA_URL = 'data/posts.json';
const PAGE_SIZE = 20;
const CHANNEL = 'loaderfromSVO';

const app = (() => {
  // ── State ──────────────────────────────────────────────────────────────
  let allPosts = [];
  let offset = 0;
  let searchQuery = '';
  let bookmarksMode = false;

  // ── DOM ────────────────────────────────────────────────────────────────
  const feed        = document.getElementById('postFeed');
  const spinner     = document.getElementById('loadingSpinner');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn  = document.getElementById('loadMoreBtn');
  const emptyState  = document.getElementById('emptyState');
  const errorState  = document.getElementById('errorState');
  const errorMsg    = document.getElementById('errorMessage');
  const updatedText = document.getElementById('updatedText');
  const refreshBtn  = document.getElementById('refreshBtn');
  const lightbox    = document.getElementById('lightbox');
  const lbClose     = document.getElementById('lightboxClose');
  const lbContent   = document.getElementById('lightboxContent');
  const lbPrev      = document.getElementById('lightboxPrev');
  const lbNext      = document.getElementById('lightboxNext');
  const searchToggle   = document.getElementById('searchToggle');
  const searchBar      = document.getElementById('searchBar');
  const searchInput    = document.getElementById('searchInput');
  const searchClear    = document.getElementById('searchClear');
  const searchCount    = document.getElementById('searchCount');
  const bookmarksToggle = document.getElementById('bookmarksToggle');
  const scrollTopBtn   = document.getElementById('scrollTopBtn');
  const toastEl        = document.getElementById('toast');

  let lbItems = [], lbIdx = 0;

  // ── Helpers ────────────────────────────────────────────────────────────
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 2)  return 'только что';
    if (min < 60) return `${min} мин назад`;
    const h = Math.floor(min / 60);
    if (h < 24)   return `${h} ч назад`;
    const d = Math.floor(h / 24);
    return `${d} д назад`;
  }

  function formatNum(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  function linkify(text) {
    const escaped = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.replace(
      /(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  // ── Lightbox ───────────────────────────────────────────────────────────
  function openLb(items, idx) {
    lbItems = items; lbIdx = idx;
    showLbItem();
    lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const multi = items.length > 1;
    lbPrev.classList.toggle('hidden', !multi);
    lbNext.classList.toggle('hidden', !multi);
  }
  function closeLb() {
    lightbox.classList.add('hidden');
    document.body.style.overflow = '';
    lbContent.innerHTML = '';
  }
  function showLbItem() {
    const it = lbItems[lbIdx];
    if (!it) return;
    lbContent.innerHTML = it.type === 'video'
      ? `<video src="${it.url}" controls autoplay></video>`
      : `<img src="${it.url}" alt="Медиа"/>`;
  }

  lbClose.addEventListener('click', closeLb);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLb(); });
  lbPrev.addEventListener('click', () => { lbIdx = (lbIdx - 1 + lbItems.length) % lbItems.length; showLbItem(); });
  lbNext.addEventListener('click', () => { lbIdx = (lbIdx + 1) % lbItems.length; showLbItem(); });
  document.addEventListener('keydown', e => {
    if (lightbox.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') lbPrev.click();
    if (e.key === 'ArrowRight') lbNext.click();
  });

  // ── Render post ────────────────────────────────────────────────────────
  function buildMedia(post) {
    const photos = (post.photos || []).filter(p => p);
    const videoUrl = post.video_path || null;
    const gifUrl   = post.gif_path   || null;

    if (gifUrl) {
      return `<div class="post-media">
        <video src="${gifUrl}" autoplay loop muted playsinline></video>
      </div>`;
    }

    if (videoUrl) {
      return `<div class="post-media" data-media-type="video" data-media-url="${videoUrl}">
        <video src="${videoUrl}" preload="metadata" muted playsinline></video>
        <div class="play-overlay"><div class="play-icon"></div></div>
      </div>`;
    }

    if (photos.length === 0) return '';

    if (photos.length === 1) {
      return `<div class="post-media" data-media-type="photo" data-media-url="${photos[0]}">
        <img src="${photos[0]}" alt="Фото" loading="lazy" decoding="async"/>
      </div>`;
    }

    // Gallery
    const shown = photos.slice(0, 4);
    const extra = photos.length - shown.length;
    const cls   = `g${Math.min(shown.length, 4)}`;
    const items = shown.map((url, i) => {
      const isLast = i === shown.length - 1 && extra > 0;
      return `<div class="gi" data-gi="${i}">
        <img src="${url}" alt="Фото ${i+1}" loading="lazy" decoding="async"/>
        ${isLast ? `<div class="gi-more">+${extra}</div>` : ''}
      </div>`;
    }).join('');

    return `<div class="media-gallery ${cls}" data-gallery="1">${items}</div>`;
  }

  function renderPost(post) {
    const card = document.createElement('article');
    card.className = 'post-card';
    card.dataset.postId = post.id;
    const isSaved = getSavedIds().has(post.id);

    const mediaHtml = buildMedia(post);
    const tgUrl = `https://t.me/${CHANNEL}/${post.id}`;

    let bodyHtml = '';
    if (post.text) {
      const content = post.text_html || linkify(post.text);
      const long    = post.text.length > 600;
      bodyHtml = `<div class="post-body">
        <div class="post-text${long ? ' truncated' : ''}">${content}</div>
        ${long ? '<button class="read-more-btn" aria-expanded="false">Читать далее</button>' : ''}
      </div>`;
    }

    const viewsHtml = post.views > 0 ? `<span class="stat">
      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 3C5 3 1.73 7.11 1.05 9.76a1 1 0 000 .48C1.73 12.89 5 17 10 17s8.27-4.11 8.95-6.76a1 1 0 000-.48C18.27 7.11 15 3 10 3zm0 11a4 4 0 110-8 4 4 0 010 8zm0-6a2 2 0 100 4 2 2 0 000-4z"/></svg>
      ${formatNum(post.views)}
    </span>` : '';

    card.innerHTML = `
      ${mediaHtml}
      ${bodyHtml}
      <div class="post-footer">
        <time class="post-date" datetime="${post.date}">${formatDate(post.date)}</time>
        <div class="post-meta">
          ${viewsHtml}
          <button class="share-btn" aria-label="Поделиться" title="Поделиться">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
              <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          </button>
          <button class="bookmark-btn${isSaved ? ' saved' : ''}" aria-label="${isSaved ? 'Удалить из закладок' : 'В закладки'}" title="${isSaved ? 'Удалить из закладок' : 'В закладки'}">
            <svg viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
            </svg>
          </button>
          <a class="tg-link comments-link" href="#comments-${post.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            Комментарии
          </a>
          <a class="tg-link" href="${tgUrl}" target="_blank" rel="noopener">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.018 9.509c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.881.712z"/></svg>
            Открыть
          </a>
        </div>
      </div>`;

    // Read-more toggle
    const rmBtn = card.querySelector('.read-more-btn');
    if (rmBtn) {
      rmBtn.addEventListener('click', () => {
        const el = card.querySelector('.post-text');
        const expanded = rmBtn.getAttribute('aria-expanded') === 'true';
        el.classList.toggle('truncated', expanded);
        rmBtn.textContent = expanded ? 'Читать далее' : 'Свернуть';
        rmBtn.setAttribute('aria-expanded', String(!expanded));
      });
    }

    // Single photo/video lightbox
    const singlePhoto = card.querySelector('.post-media[data-media-type="photo"]');
    if (singlePhoto) {
      singlePhoto.addEventListener('click', () =>
        openLb([{ type: 'photo', url: singlePhoto.dataset.mediaUrl }], 0));
    }
    const singleVideo = card.querySelector('.post-media[data-media-type="video"]');
    if (singleVideo) {
      singleVideo.addEventListener('click', () =>
        openLb([{ type: 'video', url: singleVideo.dataset.mediaUrl }], 0));
    }

    // Gallery lightbox
    const gallery = card.querySelector('.media-gallery');
    if (gallery) {
      const photos = (post.photos || []).filter(Boolean);
      const items  = photos.map(u => ({ type: 'photo', url: u }));
      gallery.addEventListener('click', e => {
        const gi = e.target.closest('.gi');
        if (gi) openLb(items, parseInt(gi.dataset.gi, 10) || 0);
      });
    }

    // Share button
    const shareBtn = card.querySelector('.share-btn');
    shareBtn.addEventListener('click', async () => {
      const url = `https://t.me/${CHANNEL}/${post.id}`;
      const text = (post.text || '').slice(0, 200);
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Грузчик из Шереметьево', text, url });
        } else {
          await navigator.clipboard.writeText(url);
          showToast('Ссылка скопирована');
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          try { await navigator.clipboard.writeText(url); showToast('Ссылка скопирована'); }
          catch { showToast('Не удалось скопировать ссылку'); }
        }
      }
    });

    // Bookmark button
    const bookmarkBtn = card.querySelector('.bookmark-btn');
    bookmarkBtn.addEventListener('click', () => {
      const saved = toggleBookmark(post.id);
      const svgEl = bookmarkBtn.querySelector('svg');
      bookmarkBtn.classList.toggle('saved', saved);
      bookmarkBtn.setAttribute('aria-label', saved ? 'Удалить из закладок' : 'В закладки');
      bookmarkBtn.setAttribute('title', saved ? 'Удалить из закладок' : 'В закладки');
      svgEl.setAttribute('fill', saved ? 'currentColor' : 'none');
      showToast(saved ? 'Добавлено в закладки' : 'Удалено из закладок');
      if (bookmarksMode && !saved) card.remove();
    });

    return card;
  }

  // ── Refresh (pull-to-refresh: prepend new posts) ────────────────────────
  async function refresh() {
    try {
      const res = await fetch(DATA_URL + '?t=' + Date.now());
      if (!res.ok) return 0;
      const data = await res.json();
      const fresh = data.posts || [];
      const knownIds = new Set(allPosts.map(p => p.id));
      const newPosts = fresh.filter(p => !knownIds.has(p.id));
      if (newPosts.length > 0) {
        allPosts = [...newPosts, ...allPosts];
        if (!searchQuery && !bookmarksMode) {
          offset += newPosts.length;
          const frag = document.createDocumentFragment();
          newPosts.forEach(p => frag.appendChild(renderPost(p)));
          feed.insertBefore(frag, feed.firstChild);
        }
      }
      if (data.updated_at) updatedText.textContent = timeAgo(data.updated_at);
      return newPosts.length;
    } catch { return 0; }
  }

  // ── Pull to Refresh ─────────────────────────────────────────────────────
  (function () {
    const el = document.getElementById('pullIndicator');
    if (!el) return;
    const icon = el.querySelector('svg');
    const label = el.querySelector('span');
    const THRESHOLD = 64;
    let startY = 0, pullDist = 0, tracking = false;

    function onStart(y) {
      if (window.scrollY > 2) return;
      startY = y; tracking = true; pullDist = 0;
    }
    function onMove(y) {
      if (!tracking) return;
      pullDist = Math.max(0, y - startY);
      if (pullDist <= 0) return;
      el.style.height = Math.min(pullDist * 0.5, 52) + 'px';
      const progress = Math.min(pullDist / THRESHOLD, 1);
      icon.style.transform = `rotate(${progress * 180}deg)`;
      label.textContent = progress >= 1 ? 'Отпустите для обновления' : 'Потяните для обновления';
    }
    async function onEnd() {
      if (!tracking) return;
      tracking = false;
      if (pullDist >= THRESHOLD) {
        el.style.height = '48px';
        icon.style.transform = '';
        el.classList.add('refreshing');
        label.textContent = 'Обновление...';
        await refresh();
        el.classList.remove('refreshing');
      }
      el.style.transition = 'height 0.3s ease';
      el.style.height = '0';
      icon.style.transform = '';
      label.textContent = 'Потяните для обновления';
      setTimeout(() => { el.style.transition = ''; }, 320);
      pullDist = 0;
    }

    // Touch (mobile)
    document.addEventListener('touchstart', e => onStart(e.touches[0].clientY), { passive: true });
    document.addEventListener('touchmove', e => {
      if (!tracking) return;
      const d = Math.max(0, e.touches[0].clientY - startY);
      if (d > 0) e.preventDefault();
      onMove(e.touches[0].clientY);
    }, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });

    // Mouse (desktop)
    document.addEventListener('mousedown', e => { if (e.button === 0) onStart(e.clientY); });
    document.addEventListener('mousemove', e => { if (tracking) onMove(e.clientY); });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('mouseleave', onEnd);
  })();

  // ── Bookmarks ──────────────────────────────────────────────────────────
  const BOOKMARKS_KEY = 'svo_bookmarks';
  function getSavedIds() {
    try { return new Set(JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function toggleBookmark(id) {
    const saved = getSavedIds();
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...saved]));
    return saved.has(id);
  }

  // ── Display filter ─────────────────────────────────────────────────────
  function getDisplayPosts() {
    let posts = allPosts;
    if (bookmarksMode) {
      const saved = getSavedIds();
      posts = posts.filter(p => saved.has(p.id));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      posts = posts.filter(p => (p.text || '').toLowerCase().includes(q));
    }
    return posts;
  }

  function resetFeed() {
    feed.innerHTML = '';
    offset = 0;
    showPage();
  }

  // ── Toast ──────────────────────────────────────────────────────────────
  let _toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastEl.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => toastEl.classList.add('hidden'), 300);
    }, 2200);
  }

  // ── Pagination ─────────────────────────────────────────────────────────
  function showPage() {
    const display = getDisplayPosts();
    const page = display.slice(offset, offset + PAGE_SIZE);

    if (page.length === 0 && offset === 0) {
      // Empty state for search/bookmarks
      if (searchQuery || bookmarksMode) {
        const icon = bookmarksMode ? '🔖' : '🔍';
        const title = bookmarksMode ? 'Нет закладок' : 'Ничего не найдено';
        const desc = bookmarksMode
          ? 'Сохраняйте посты, нажимая иконку закладки.'
          : 'Попробуйте другой запрос.';
        feed.innerHTML = `<div class="empty-state">
          <div class="empty-icon">${icon}</div>
          <h2>${title}</h2><p>${desc}</p>
        </div>`;
      }
      loadMoreWrap.classList.add('hidden');
      return;
    }

    const frag = document.createDocumentFragment();
    page.forEach(p => frag.appendChild(renderPost(p)));
    feed.appendChild(frag);
    offset += page.length;

    const hasMore = offset < display.length;
    loadMoreWrap.classList.toggle('hidden', !hasMore);

    if (searchQuery) {
      searchCount.textContent = `Найдено: ${display.length}`;
    }
  }

  loadMoreBtn.addEventListener('click', showPage);

  // Infinite scroll
  const sentinel = document.createElement('div');
  sentinel.style.height = '1px';
  document.querySelector('.feed-container').appendChild(sentinel);
  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && offset < getDisplayPosts().length) showPage();
  }, { rootMargin: '200px' }).observe(sentinel);

  // ── Load JSON ──────────────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch(DATA_URL + '?t=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      allPosts = data.posts || [];

      if (data.updated_at) {
        updatedText.textContent = timeAgo(data.updated_at);
      }

      spinner.classList.add('hidden');

      if (allPosts.length === 0) {
        emptyState.classList.remove('hidden');
        return;
      }

      showPage();
    } catch (err) {
      spinner.classList.add('hidden');
      errorMsg.textContent = `Ошибка: ${err.message}`;
      errorState.classList.remove('hidden');
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      await refresh();
      refreshBtn.classList.remove('spinning');
    });
  }

  // ── Search ─────────────────────────────────────────────────────────────
  searchToggle.addEventListener('click', () => {
    const isOpen = !searchBar.classList.contains('hidden');
    if (isOpen) {
      searchBar.classList.add('hidden');
      searchToggle.classList.remove('active');
      if (searchQuery) {
        searchQuery = '';
        searchCount.textContent = '';
        resetFeed();
      }
    } else {
      searchBar.classList.remove('hidden');
      searchToggle.classList.add('active');
      searchInput.focus();
    }
  });

  let _searchTimer;
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    searchClear.classList.toggle('hidden', !val);
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      searchQuery = val;
      resetFeed();
    }, 300);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    searchQuery = '';
    searchCount.textContent = '';
    searchInput.focus();
    resetFeed();
  });

  // ── Bookmarks toggle ────────────────────────────────────────────────────
  bookmarksToggle.addEventListener('click', () => {
    bookmarksMode = !bookmarksMode;
    bookmarksToggle.classList.toggle('active', bookmarksMode);
    bookmarksToggle.setAttribute('title', bookmarksMode ? 'Показать все посты' : 'Закладки');
    // Update SVG fill to show filled bookmark when active
    const bsvg = bookmarksToggle.querySelector('svg');
    bsvg.setAttribute('fill', bookmarksMode ? 'currentColor' : 'none');
    resetFeed();
  });

  // ── Scroll to top ───────────────────────────────────────────────────────
  window.addEventListener('scroll', () => {
    scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // ── Comments view ──────────────────────────────────────────────────────────
  const commentsView     = document.getElementById('commentsView');
  const feedMain         = document.querySelector('.feed-container');
  const pullInd          = document.getElementById('pullIndicator');
  const backBtn          = document.getElementById('backBtn');
  const commentsList     = document.getElementById('commentsList');
  const commentsSpinner  = document.getElementById('commentsSpinner');
  const commentsEmpty    = document.getElementById('commentsEmpty');
  const commentsError    = document.getElementById('commentsError');
  const commentsErrorMsg = document.getElementById('commentsErrorMsg');

  function showFeed() {
    commentsView.classList.add('hidden');
    feedMain.classList.remove('hidden');
    pullInd.classList.remove('hidden');
    document.title = 'Грузчик из Шереметьево';
  }

  function renderComment(c) {
    const div = document.createElement('div');
    div.className = 'comment-card';
    const safeAuthor = (c.author || 'Участник').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    div.innerHTML = `
      <div class="comment-header">
        <span class="comment-author">${safeAuthor}</span>
        <time class="comment-date">${formatDate(c.date)}</time>
      </div>
      <div class="comment-text">${c.text ? linkify(c.text) : ''}</div>`;
    return div;
  }

  async function showComments(postId) {
    feedMain.classList.add('hidden');
    pullInd.classList.add('hidden');
    commentsView.classList.remove('hidden');
    commentsList.innerHTML = '';
    commentsEmpty.classList.add('hidden');
    commentsError.classList.add('hidden');
    commentsSpinner.classList.remove('hidden');
    document.title = 'Комментарии — Грузчик из Шереметьево';
    window.scrollTo(0, 0);

    try {
      const res = await fetch(`data/comments/${postId}.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = (data.comments || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      commentsSpinner.classList.add('hidden');
      if (items.length === 0) {
        commentsEmpty.classList.remove('hidden');
        return;
      }
      const frag = document.createDocumentFragment();
      items.forEach(c => frag.appendChild(renderComment(c)));
      commentsList.appendChild(frag);
    } catch (err) {
      commentsSpinner.classList.add('hidden');
      const is404 = err.message.includes('404');
      commentsErrorMsg.textContent = is404
        ? 'Комментарии ещё не загружены. Попробуйте позже.'
        : `Ошибка: ${err.message}`;
      commentsError.classList.remove('hidden');
    }
  }

  function handleRoute() {
    const m = window.location.hash.match(/^#comments-(\d+)$/);
    if (m) showComments(parseInt(m[1], 10));
    else showFeed();
  }

  window.addEventListener('hashchange', handleRoute);
  backBtn.addEventListener('click', () => { history.back(); });
  handleRoute();

  init();
})();
