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

  // ── DOM ────────────────────────────────────────────────────────────────
  const feed        = document.getElementById('postFeed');
  const spinner     = document.getElementById('loadingSpinner');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn  = document.getElementById('loadMoreBtn');
  const emptyState  = document.getElementById('emptyState');
  const errorState  = document.getElementById('errorState');
  const errorMsg    = document.getElementById('errorMessage');
  const updatedText = document.getElementById('updatedText');
  const lightbox    = document.getElementById('lightbox');
  const lbClose     = document.getElementById('lightboxClose');
  const lbContent   = document.getElementById('lightboxContent');
  const lbPrev      = document.getElementById('lightboxPrev');
  const lbNext      = document.getElementById('lightboxNext');

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

    const mediaHtml = buildMedia(post);
    const tgUrl = `https://t.me/${CHANNEL}/${post.id}`;

    let bodyHtml = '';
    if (post.text) {
      const linked = linkify(post.text);
      const long   = post.text.length > 600;
      bodyHtml = `<div class="post-body">
        <div class="post-text${long ? ' truncated' : ''}">${linked}</div>
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
        offset += newPosts.length;
        const frag = document.createDocumentFragment();
        newPosts.forEach(p => frag.appendChild(renderPost(p)));
        feed.insertBefore(frag, feed.firstChild);
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

    document.addEventListener('touchstart', e => {
      if (window.scrollY > 2) return;
      startY = e.touches[0].clientY;
      tracking = true;
      pullDist = 0;
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (!tracking) return;
      pullDist = Math.max(0, e.touches[0].clientY - startY);
      if (pullDist <= 0) return;
      e.preventDefault(); // block native scroll/PTR while pulling
      el.style.height = Math.min(pullDist * 0.5, 52) + 'px';
      const progress = Math.min(pullDist / THRESHOLD, 1);
      icon.style.transform = `rotate(${progress * 180}deg)`;
      label.textContent = progress >= 1 ? 'Отпустите для обновления' : 'Потяните для обновления';
    }, { passive: false });

    document.addEventListener('touchend', async () => {
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
    }, { passive: true });
  })();

  // ── Pagination ─────────────────────────────────────────────────────────
  function showPage() {
    const page = allPosts.slice(offset, offset + PAGE_SIZE);
    if (page.length === 0) return;
    const frag = document.createDocumentFragment();
    page.forEach(p => frag.appendChild(renderPost(p)));
    feed.appendChild(frag);
    offset += page.length;

    const hasMore = offset < allPosts.length;
    loadMoreWrap.classList.toggle('hidden', !hasMore);
  }

  loadMoreBtn.addEventListener('click', showPage);

  // Infinite scroll
  const sentinel = document.createElement('div');
  sentinel.style.height = '1px';
  document.querySelector('.feed-container').appendChild(sentinel);
  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && offset < allPosts.length) showPage();
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

  init();
})();
