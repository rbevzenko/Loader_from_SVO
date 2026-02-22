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

const API_BASE = window.location.origin;
const PAGE_SIZE = 20;

const app = (() => {
  // ── State ──────────────────────────────────────────────────────────────
  let offset = 0;
  let isLoading = false;
  let hasMore = true;
  let lightboxItems = [];
  let lightboxIndex = 0;

  // ── DOM refs ───────────────────────────────────────────────────────────
  const feed = document.getElementById('postFeed');
  const spinner = document.getElementById('loadingSpinner');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const emptyState = document.getElementById('emptyState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = statusBadge.querySelector('.status-text');
  const lightbox = document.getElementById('lightbox');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxContent = document.getElementById('lightboxContent');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');

  // ── Helpers ────────────────────────────────────────────────────────────
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function linkify(text) {
    if (!text) return '';
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(
      /(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  function formatNum(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  function mediaUrl(url) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return API_BASE + url;
  }

  // ── Status ─────────────────────────────────────────────────────────────
  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.telegram_connected) {
        statusBadge.className = 'status-badge connected';
        statusText.textContent = `${formatNum(data.total_posts)} постов`;
      } else {
        statusBadge.className = 'status-badge disconnected';
        statusText.textContent = 'Нет подключения';
      }
    } catch {
      statusBadge.className = 'status-badge disconnected';
      statusText.textContent = 'Ошибка';
    }
  }

  // ── Post Rendering ─────────────────────────────────────────────────────
  function renderMedia(post) {
    const gallery = post.media_gallery || [];
    const hasGallery = gallery.length > 1;
    const primaryUrl = mediaUrl(post.media_url);
    const type = post.media_type;

    if (hasGallery) {
      const photos = gallery.filter(m => m.media_type === 'photo' && m.media_url);
      if (photos.length > 0) {
        const displayCount = Math.min(photos.length, 4);
        const extraCount = photos.length - displayCount;
        const countClass = `count-${Math.min(displayCount, 4)}`;
        const items = photos.slice(0, displayCount).map((m, i) => {
          const url = mediaUrl(m.media_url);
          const isLast = i === displayCount - 1 && extraCount > 0;
          return `
            <div class="gallery-item" data-gallery-index="${i}" data-post-id="${post.id}">
              <img src="${url}" alt="Фото ${i + 1}" loading="lazy" decoding="async"/>
              ${isLast ? `<div class="gallery-more-overlay">+${extraCount}</div>` : ''}
            </div>`;
        }).join('');
        return `<div class="media-gallery ${countClass}" data-gallery-post="${post.id}">${items}</div>`;
      }
    }

    if (!primaryUrl) return '';

    if (type === 'photo') {
      return `
        <div class="post-media" data-media-url="${primaryUrl}" data-media-type="photo">
          <img src="${primaryUrl}" alt="Фото" loading="lazy" decoding="async"/>
        </div>`;
    }

    if (type === 'video') {
      return `
        <div class="post-media" data-media-url="${primaryUrl}" data-media-type="video">
          <video src="${primaryUrl}" preload="metadata" muted playsinline></video>
          <div class="play-overlay"><div class="play-icon"></div></div>
        </div>`;
    }

    if (type === 'gif') {
      return `
        <div class="post-media">
          <video src="${primaryUrl}" autoplay loop muted playsinline></video>
        </div>`;
    }

    return '';
  }

  function renderPost(post) {
    const card = document.createElement('article');
    card.className = 'post-card';
    card.dataset.postId = post.id;

    const mediaHtml = renderMedia(post);
    const textHtml = post.text ? (() => {
      const linked = linkify(post.text);
      const isLong = post.text.length > 600;
      return `
        <div class="post-body">
          <div class="post-text${isLong ? ' truncated' : ''}">${linked}</div>
          ${isLong ? '<button class="read-more-btn" aria-expanded="false">Читать далее</button>' : ''}
        </div>`;
    })() : '';

    const viewsHtml = post.views > 0 ? `
      <span class="stat-item">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 3C5 3 1.73 7.11 1.05 9.76a1 1 0 000 .48C1.73 12.89 5 17 10 17s8.27-4.11 8.95-6.76a1 1 0 000-.48C18.27 7.11 15 3 10 3zm0 11a4 4 0 110-8 4 4 0 010 8zm0-6a2 2 0 100 4 2 2 0 000-4z"/></svg>
        ${formatNum(post.views)}
      </span>` : '';

    const forwardsHtml = post.forwards > 0 ? `
      <span class="stat-item">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/></svg>
        ${formatNum(post.forwards)}
      </span>` : '';

    card.innerHTML = `
      ${mediaHtml}
      ${textHtml}
      <div class="post-footer">
        <time class="post-date" datetime="${post.date}">${formatDate(post.date)}</time>
        <div class="post-stats">${viewsHtml}${forwardsHtml}</div>
      </div>
    `;

    // Read more toggle
    const readMoreBtn = card.querySelector('.read-more-btn');
    if (readMoreBtn) {
      readMoreBtn.addEventListener('click', () => {
        const textEl = card.querySelector('.post-text');
        const expanded = readMoreBtn.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          textEl.classList.add('truncated');
          readMoreBtn.textContent = 'Читать далее';
          readMoreBtn.setAttribute('aria-expanded', 'false');
        } else {
          textEl.classList.remove('truncated');
          readMoreBtn.textContent = 'Свернуть';
          readMoreBtn.setAttribute('aria-expanded', 'true');
        }
      });
    }

    // Single media click → lightbox
    const singleMedia = card.querySelector('.post-media[data-media-type="photo"]');
    if (singleMedia) {
      singleMedia.addEventListener('click', () => {
        openLightbox([{ type: 'photo', url: singleMedia.dataset.mediaUrl }], 0);
      });
    }
    const videoMedia = card.querySelector('.post-media[data-media-type="video"]');
    if (videoMedia) {
      videoMedia.addEventListener('click', () => {
        openLightbox([{ type: 'video', url: videoMedia.dataset.mediaUrl }], 0);
      });
    }

    // Gallery click
    const galleryEl = card.querySelector('.media-gallery');
    if (galleryEl) {
      const gallery = post.media_gallery.filter(m => m.media_url);
      const urls = gallery.map(m => ({
        type: m.media_type,
        url: mediaUrl(m.media_url),
      }));
      galleryEl.addEventListener('click', (e) => {
        const item = e.target.closest('.gallery-item');
        if (item) {
          const idx = parseInt(item.dataset.galleryIndex, 10) || 0;
          openLightbox(urls, idx);
        }
      });
    }

    return card;
  }

  // ── Lightbox ───────────────────────────────────────────────────────────
  function openLightbox(items, idx) {
    lightboxItems = items;
    lightboxIndex = idx;
    showLightboxItem();
    lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    const hasPrev = items.length > 1;
    lightboxPrev.classList.toggle('hidden', !hasPrev);
    lightboxNext.classList.toggle('hidden', !hasPrev);
  }

  function closeLightbox() {
    lightbox.classList.add('hidden');
    document.body.style.overflow = '';
    lightboxContent.innerHTML = '';
  }

  function showLightboxItem() {
    const item = lightboxItems[lightboxIndex];
    if (!item) return;
    if (item.type === 'photo') {
      lightboxContent.innerHTML = `<img src="${item.url}" alt="Фото"/>`;
    } else if (item.type === 'video') {
      lightboxContent.innerHTML = `<video src="${item.url}" controls autoplay></video>`;
    }
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  lightboxPrev.addEventListener('click', () => {
    lightboxIndex = (lightboxIndex - 1 + lightboxItems.length) % lightboxItems.length;
    showLightboxItem();
  });
  lightboxNext.addEventListener('click', () => {
    lightboxIndex = (lightboxIndex + 1) % lightboxItems.length;
    showLightboxItem();
  });
  document.addEventListener('keydown', (e) => {
    if (lightbox.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxPrev.click();
    if (e.key === 'ArrowRight') lightboxNext.click();
  });

  // ── Data Fetching ──────────────────────────────────────────────────────
  async function fetchPosts() {
    if (isLoading || !hasMore) return;
    isLoading = true;
    spinner.classList.remove('hidden');
    loadMoreWrap.classList.add('hidden');
    loadMoreBtn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/posts?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      hasMore = data.has_more;
      offset += data.posts.length;

      if (offset === data.posts.length && data.posts.length === 0) {
        emptyState.classList.remove('hidden');
      }

      const fragment = document.createDocumentFragment();
      data.posts.forEach(p => fragment.appendChild(renderPost(p)));
      feed.appendChild(fragment);

      if (hasMore) loadMoreWrap.classList.remove('hidden');
      errorState.classList.add('hidden');
    } catch (err) {
      errorMessage.textContent = `Не удалось загрузить посты: ${err.message}`;
      if (offset === 0) {
        errorState.classList.remove('hidden');
      }
    } finally {
      isLoading = false;
      spinner.classList.add('hidden');
      loadMoreBtn.disabled = false;
    }
  }

  // ── Infinite Scroll ────────────────────────────────────────────────────
  const observerTarget = document.createElement('div');
  observerTarget.style.height = '1px';
  document.querySelector('.feed-container').appendChild(observerTarget);

  const ioObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore && !isLoading) {
      fetchPosts();
    }
  }, { rootMargin: '200px' });
  ioObserver.observe(observerTarget);

  // ── Load More Button (fallback / additional) ───────────────────────────
  loadMoreBtn.addEventListener('click', fetchPosts);

  // ── Init ───────────────────────────────────────────────────────────────
  function reload() {
    offset = 0;
    hasMore = true;
    isLoading = false;
    feed.innerHTML = '';
    emptyState.classList.add('hidden');
    errorState.classList.add('hidden');
    fetchPosts();
    fetchStatus();
  }

  reload();
  fetchStatus();
  setInterval(fetchStatus, 30_000);

  // ── Pull to Refresh ───────────────────────────────────────────────────
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
      el.style.height = Math.min(pullDist * 0.5, 52) + 'px';
      const progress = Math.min(pullDist / THRESHOLD, 1);
      icon.style.transform = `rotate(${progress * 180}deg)`;
      label.textContent = progress >= 1 ? 'Отпустите для обновления' : 'Потяните для обновления';
    }, { passive: true });

    document.addEventListener('touchend', async () => {
      if (!tracking) return;
      tracking = false;
      if (pullDist >= THRESHOLD) {
        el.style.height = '48px';
        icon.style.transform = '';
        el.classList.add('refreshing');
        label.textContent = 'Обновление...';
        await new Promise(res => { reload(); setTimeout(res, 800); });
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

  return { reload };
})();
