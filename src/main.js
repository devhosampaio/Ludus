import { supabase } from './lib/supabase.js';
import { signIn, signOut, signUp, resendSignupConfirmation, requestPasswordReset } from './lib/auth.js';

const app = document.querySelector('#app');
const THEME_STORAGE_KEY = 'ludus-theme';
function getCurrentTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
}
function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  try { localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch {}
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const isDark = nextTheme === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    const label = button.querySelector('[data-theme-label]');
    if (label) label.textContent = isDark ? 'Tema claro' : 'Tema escuro';
    const icon = button.querySelector('svg, i');
    if (icon) {
      if (icon.tagName.toLowerCase() === 'svg') {
        icon.innerHTML = isDark
          ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'
          : '<path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/>';
      } else {
        icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      }
    }
  });
}
applyTheme(getCurrentTheme());
document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-theme-toggle]');
  if (!toggle) return;
  applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
});
document.title = 'Ludus | Comunidade de jogos';
let activeUser = null;

function showMessage(message, type = 'info') {
  const target = document.querySelector('[data-message]');
  if (!target) return;
  target.textContent = message;
  target.dataset.type = type;
  target.hidden = !message;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function profilePlaceholderMarkup() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"></circle><path d="M5 19.5c.6-3.6 3.1-5.6 7-5.6s6.4 2 7 5.6"></path></svg>';
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
    .format(new Date(value)).replace('.', '');
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'agora';
  const units = [
    ['ano', 31536000], ['mês', 2592000], ['dia', 86400],
    ['hora', 3600], ['minuto', 60]
  ];
  for (const [label, size] of units) {
    const amount = Math.floor(seconds / size);
    if (amount >= 1) return amount + ' ' + label + (amount > 1 && label !== 'mês' ? 's' : amount > 1 && label === 'mês' ? 'es' : '') + ' atrás';
  }
  return 'agora';
}

function statusIconMarkup(status) {
  const icons = {
    completed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3.5h8v3a4 4 0 0 1-8 0v-3ZM8 5.5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 0v3.5m-4 4h8m-6-4h4v4H8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    playing: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h10a4 4 0 0 1 3.9 3.1l1.4 6.1a2.8 2.8 0 0 1-4.7 2.6l-2.2-2.1H8.6l-2.2 2.1a2.8 2.8 0 0 1-4.7-2.6l1.4-6.1A4 4 0 0 1 7 6Zm1.2 2.5v4m-2-2h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    abandoned: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m8.5 8.5 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };
  return icons[status] || '';
}

function statusLabel(status) {
  return status === 'completed' ? 'Zerado' : '';
}


let notificationChannel = null;

function notificationControlMarkup() {
  return '<div class="notifications bottom-nav__notifications" data-notifications>' +
    '<button class="notifications__trigger bottom-nav__item" type="button" data-notifications-toggle aria-label="Notificações" aria-expanded="false" title="Notificações">' +
    '<i class="fa-regular fa-bell" aria-hidden="true"></i>' +
    '<span class="notifications__count" data-notification-count hidden>0</span></button>' +
    '<section class="notifications__panel" data-notifications-panel hidden>' +
    '<header class="notifications__header"><strong>Notificações</strong><button type="button" data-notifications-read-all>Marcar todas como lidas</button></header>' +
    '<div class="notifications__list" data-notifications-list><p class="notifications__empty">Carregando…</p></div></section></div>';
}

async function setupNotifications(user) {
  const root = app.querySelector('[data-notifications]');
  if (!root) return;

  const panel = root.querySelector('[data-notifications-panel]');
  const toggleButton = root.querySelector('[data-notifications-toggle]');
  const list = root.querySelector('[data-notifications-list]');
  const badge = root.querySelector('[data-notification-count]');

  toggleButton?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigateToNotifications(user);
  });

  if (notificationChannel) {
    await supabase.removeChannel(notificationChannel);
    notificationChannel = null;
  }

  const refresh = async () => {
    const { data, error } = await fetchAllPages(() => supabase.from('notifications')
      .select('id, type, actor_id, review_id, created_at, read_at, profiles!notifications_actor_id_fkey(username, display_name, avatar_url)')
      .order('created_at', { ascending: false }));

    if (error) {
      console.error('[Ludus] Falha ao carregar notificações:', error);
      list.innerHTML = '<p class="notifications__empty">Não foi possível carregar as notificações.</p>';
      return;
    }

    const rows = data || [];
    const unreadCount = rows.filter((item) => !item.read_at).length;
    if (badge) {
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.hidden = unreadCount === 0;
    }

    if (!rows.length) {
      list.innerHTML = '<p class="notifications__empty">Tudo tranquilo por aqui. Suas novidades aparecerão aqui.</p>';
      return;
    }

    list.innerHTML = rows.map((item) => {
      const actor = item.profiles?.username || 'Alguém';
      const username = item.profiles?.username || '';
      const message = item.type === 'review_liked'
        ? 'curtiu sua avaliação.'
        : item.type === 'review_commented'
          ? 'comentou sua avaliação.'
          : 'começou a seguir você.';
      const avatar = item.profiles?.avatar_url
        ? '<img src="' + escapeHTML(item.profiles.avatar_url) + '" alt="">'
        : profilePlaceholderMarkup();
      return '<div class="notifications__item-row"><button class="notifications__item' + (item.read_at ? '' : ' is-unread') + '" type="button" data-notification-id="' + item.id + '" data-notification-type="' + item.type + '" data-review-id="' + (item.review_id || '') + '" data-actor-username="' + escapeHTML(username) + '">' +
        '<span class="notifications__avatar" aria-hidden="true">' + avatar + '</span><span class="notifications__item-content"><span><strong>' + escapeHTML(actor) + '</strong> ' + message + '</span><time>' + formatDate(item.created_at) + '</time></span></button>' +
        '<button class="notifications__delete" type="button" data-delete-notification="' + item.id + '" aria-label="Excluir notificação" title="Excluir notificação">×</button></div>';
    }).join('');
  };
  root._refreshNotifications = refresh;

  root.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-delete-notification]');
    if (deleteButton) {
      deleteButton.disabled = true;
      const { error } = await supabase.from('notifications').delete()
        .eq('id', deleteButton.dataset.deleteNotification).eq('recipient_id', user.id);
      if (error) {
        console.error('[Ludus] Falha ao excluir notificação:', error);
        deleteButton.disabled = false;
        return;
      }
      await refresh();
      return;
    }

    const readAll = event.target.closest('[data-notifications-read-all]');
    if (readAll) {
      readAll.disabled = true;
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('recipient_id', user.id).is('read_at', null);
      if (error) console.error('[Ludus] Falha ao marcar notificações como lidas:', error);
      await refresh();
      readAll.disabled = false;
      return;
    }

    const item = event.target.closest('[data-notification-id]');
    if (!item) return;
    item.disabled = true;
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('id', item.dataset.notificationId).eq('recipient_id', user.id);
    if (error) {
      console.error('[Ludus] Falha ao marcar notificação como lida:', error);
      item.disabled = false;
      return;
    }

    const type = item.dataset.notificationType;
    const reviewId = item.dataset.reviewId;
    const actorUsername = item.dataset.actorUsername;
    if (type === 'new_follower' && actorUsername) {
      navigateToProfile(user, actorUsername);
    } else {
      navigateToFeed(user);
      if (reviewId) {
        window.setTimeout(() => {
          const reviewCard = document.querySelector('[data-review-id="' + reviewId + '"]');
          reviewCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 550);
      }
    }
  });

  notificationChannel = supabase.channel('notifications:' + user.id)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: 'recipient_id=eq.' + user.id
    }, () => refresh())
    .subscribe();

  await refresh();
}


async function fetchAllPages(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await buildQuery().range(offset, offset + 999);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
    if (!data || data.length < 1000) return { data: rows, error: null };
  }
}

function withRequestTimeout(promise, milliseconds, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => window.setTimeout(() => resolve(fallback), milliseconds))
  ]).catch((error) => ({ ...fallback, error }));
}

async function fetchReviewRows(table, columns, reviewIds) {
  const batches = [];
  for (let index = 0; index < reviewIds.length; index += 100) {
    batches.push(reviewIds.slice(index, index + 100));
  }
  const results = await Promise.all(batches.map((ids) =>
    fetchAllPages(() => supabase.from(table).select(columns).in('review_id', ids))
  ));
  return {
    data: results.flatMap((result) => result.data || []),
    error: results.find((result) => result.error)?.error || null
  };
}

async function fetchCommentLikeRows(commentIds) {
  if (!commentIds.length) return { data: [], error: null };
  const batches = [];
  for (let index = 0; index < commentIds.length; index += 100) {
    batches.push(commentIds.slice(index, index + 100));
  }
  const results = await Promise.all(batches.map((ids) =>
    fetchAllPages(() => supabase.from('review_comment_likes').select('comment_id, user_id').in('comment_id', ids))
  ));
  return {
    data: results.flatMap((result) => result.data || []),
    error: results.find((result) => result.error)?.error || null
  };
}

function renderReviewCommentMarkup(comment, user, likes, childrenByParent, nested = false) {
  const profile = comment.profiles || {};
  const username = profile.username || 'jogador';
  const displayName = username;
  const avatar = profile.avatar_url
    ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="" loading="lazy">'
    : profilePlaceholderMarkup();
  const commentLikes = likes.filter((like) => like.comment_id === comment.id);
  const isLiked = commentLikes.some((like) => like.user_id === user.id);
  const children = childrenByParent.get(comment.id) || [];
  const menu = '<details class="review-comment__menu"><summary aria-label="Opções do comentário" title="Opções">⋯</summary><div class="review-comment__menu-panel">' +
    (comment.user_id === user.id
      ? '<button type="button" data-comment-action="edit">Editar comentário</button><button type="button" data-comment-action="delete">Excluir comentário</button>'
      : '<button type="button" data-comment-action="report">Denunciar comentário</button>') +
    '</div></details>';
  return '<article class="review-comment' + (nested ? ' review-comment--reply' : '') + '" data-comment-id="' + comment.id + '">' +
    '<div class="review-comment__meta"><span class="review-comment__avatar">' + avatar + '</span>' +
    '<div class="review-comment__identity"><button class="review-comment__author" type="button" data-profile-username="' + escapeHTML(username) + '">' + escapeHTML(displayName) + '</button><span class="review-comment__username">@' + escapeHTML(username) + '</span><time class="review-comment__time" datetime="' + escapeHTML(comment.created_at) + '">' + escapeHTML(formatDate(comment.created_at)) + '</time></div>' + menu + '</div>' +
    '<p class="review-comment__body">' + escapeHTML(comment.body) + '</p>' +
    '<form class="review-comment__edit-form" data-edit-comment-form hidden><textarea rows="2" maxlength="1000" required>' + escapeHTML(comment.body) + '</textarea><div class="review-comment__form-actions"><button type="submit">Salvar</button><button type="button" data-cancel-edit>Cancelar</button></div></form>' +
    '<div class="review-comment__actions"><button type="button" class="review-comment__like' + (isLiked ? ' is-liked' : '') + '" data-like-comment aria-pressed="' + isLiked + '">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-8.8-5.9-8.8-12.2A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4C20.8 15.1 12 21 12 21Z"></path></svg><span data-comment-like-count>' + (commentLikes.length || '') + '</span></button>' +
    '<button type="button" class="review-comment__reply" data-reply-comment><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10 4 15l5 5M4 15h9a7 7 0 0 0 7-7V5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>Responder</span></button></div>' +
    '<form class="review-comment__reply-form" data-reply-form data-parent-comment-id="' + comment.id + '" hidden><textarea rows="2" maxlength="1000" placeholder="Responder a ' + escapeHTML(username) + '..." required></textarea><button type="submit">Enviar resposta</button></form>' +
    (children.length ? '<button type="button" class="review-comment__replies-toggle" data-toggle-replies data-reply-count="' + children.length + '" aria-expanded="false"><span>Ver ' + children.length + (children.length === 1 ? ' resposta' : ' respostas') + '</span></button><div class="review-comment__replies" hidden>' + children.map((child) => renderReviewCommentMarkup(child, user, likes, childrenByParent, true)).join('') + '</div>' : '') +
    '</article>';
}
function renderCommentsSection(reviewId, comments, likes, user) {
  const childrenByParent = new Map();
  (comments || []).forEach((comment) => {
    const key = comment.parent_comment_id || '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(comment);
  });
  childrenByParent.forEach((items) => items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
  const firstComments = childrenByParent.get('') || [];
  const markup = firstComments.slice(0, 5).map((comment) =>
    renderReviewCommentMarkup(comment, user, likes || [], childrenByParent)
  ).join('');
  const total = (comments || []).length;
  return '<section class="review-comments" data-comments-panel data-review-comments="' + reviewId + '">' +
    '<button type="button" class="review-comments__view" data-view-comments>Visualizar comentários' + (total ? ' (' + total + ')' : '') + '</button>' +
    '<div class="review-comments__tree" data-comments-tree hidden><div class="review-comments__list">' +
    (markup || '<p class="review-comments__empty">Seja o primeiro a comentar nesta review.</p>') + '</div>' +
    (total > 5 ? '<button type="button" class="review-comments__all" data-view-all-comments>Ver todos</button>' : '') +
    '</div>' +
    '<form class="review-comments__form" data-comment-form><textarea rows="2" maxlength="1000" placeholder="Comentar nesta review..." required></textarea><button type="submit" aria-label="Enviar comentário" title="Enviar comentário"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button></form>' +
    '</section>';
}
function sharedSideMenuMarkup(user) {
  const fallbackName = user.email?.split('@')[0] || 'jogador';
  return `  <header class="side-menu side-menu--left">
    <a class="topbar-brand side-menu__brand" href="#inicio" aria-label="Ludus — início">Ludus</a>
    <nav class="side-menu__navigation" aria-label="Navegação principal">
      <button class="side-menu__item is-active" type="button" data-feed-mode="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg><span>Página inicial</span></button>
      <button class="side-menu__item" type="button" data-open-search><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m15.8 15.8 5 5"/></svg><span>Buscar</span></button>
      <button class="side-menu__item" type="button" data-side-profile><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.6 3.1-5.5 7-5.5s6.3 1.9 7 5.5"/></svg><span>Perfil</span></button>
      <button class="side-menu__item" type="button" data-side-settings><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.5-1.1-1.8-3.1-1.8.7a7.8 7.8 0 0 0-2.6-1.5L14.4 3h-4.8L9.3 5.5a7.8 7.8 0 0 0-2.6 1.5l-1.8-.7-1.8 3.1 1.5 1.1a7.7 7.7 0 0 0 0 3l-1.5 1.1 1.8 3.1 1.8-.7a7.8 7.8 0 0 0 2.6 1.5l.3 2.5h4.8l.3-2.5a7.8 7.8 0 0 0 2.6-1.5l1.8.7 1.8-3.1Z"/></svg><span>Configurações</span></button>
      <button class="side-menu__item side-menu__theme-toggle" type="button" data-theme-toggle aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/></svg><span data-theme-label>Tema escuro</span></button>
      <button class="side-menu__item" type="button" data-feed-mode="saved"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/></svg><span>Listas salvas</span></button>
    </nav>
  </header>
  <nav class="bottom-nav" aria-label="Navegação inferior">
    <button class="bottom-nav__item is-active" type="button" data-bottom-home aria-label="Início" title="Início"><i class="fa-solid fa-house" aria-hidden="true"></i></button>
    <button class="bottom-nav__item" type="button" data-bottom-search aria-label="Pesquisar" title="Pesquisar"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button>
    <button class="bottom-nav__item bottom-nav__review" type="button" data-bottom-review aria-label="Avaliar" title="Avaliar"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
    ${notificationControlMarkup()}
    <button class="bottom-nav__item" type="button" data-bottom-profile aria-label="Perfil" title="Perfil"><span class="bottom-nav__profile-avatar" data-bottom-profile-avatar aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"></circle><path d="M5 19.5c.6-3.6 3.1-5.6 7-5.6s6.4 2 7 5.6"></path></svg></span></button>
  </nav>`;
}

function sharedHeaderMarkup({ action = 'menu', showBrand = true, showFeedTabs = false } = {}) {
  const isBackAction = action === 'back';
  const leftAction = isBackAction
    ? '<button class="app-topbar__avatar app-topbar__menu-button" type="button" data-header-back aria-label="Voltar"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>'
    : '<button class="app-topbar__avatar app-topbar__menu-button" type="button" data-header-avatar aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded="false"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>';
  const feedTabs = showFeedTabs ? '<nav class="feed-navigation feed-navigation--header" aria-label="Navegação do feed"><div class="feed-tabs" role="tablist" aria-label="Navegação do feed"><button class="feed-tabs__button is-active" type="button" role="tab" aria-selected="true" data-feed-mode="home">Para Você</button><button class="feed-tabs__button" type="button" role="tab" aria-selected="false" data-feed-mode="following">Seguindo</button></div></nav>' : '';
  return `<header class="app-topbar${showFeedTabs ? ' app-topbar--feed' : ''}">
    <div class="container-fluid">
      <div class="row app-topbar__row">
        <div class="${showBrand ? 'col-xs-4' : 'col-xs-12'} app-topbar__left">${leftAction}</div>
        ${showBrand ? '<div class="col-xs-4 app-topbar__center"><a class="app-topbar__brand" href="#inicio" aria-label="Ludus — início">Ludus</a></div><div class="col-xs-4 app-topbar__right"></div>' : ''}
      </div>
    </div>
    ${feedTabs}
  </header>`;
}

function sharedFeedHeaderMarkup() {
  return `${sharedHeaderMarkup({ showFeedTabs: true })}
    <div class="mobile-drawer-backdrop" data-drawer-close hidden></div>
    <aside class="mobile-drawer" data-mobile-drawer role="dialog" aria-modal="true" aria-label="Menu principal" hidden>
      <header class="mobile-drawer__profile">
        <span class="mobile-drawer__avatar" data-drawer-avatar>${profilePlaceholderMarkup()}</span>
        <strong class="mobile-drawer__username" data-drawer-username></strong>
        <div class="mobile-drawer__stats" aria-label="Estatísticas do perfil">
          <span><strong data-following-count>0</strong><span>Seguindo</span></span>
          <span><strong data-followers-count>0</strong><span>Seguidores</span></span>
        </div>
      </header>
      <nav class="mobile-drawer__navigation" aria-label="Navegação principal">
        <button class="mobile-drawer__item" type="button" data-drawer-home><i class="fa-solid fa-house" aria-hidden="true"></i><span>Página Inicial</span></button>
        <button class="mobile-drawer__item" type="button" data-drawer-search><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Pesquisar</span></button>
        <button class="mobile-drawer__item" type="button" data-drawer-profile><i class="fa-solid fa-user" aria-hidden="true"></i><span>Meu Perfil</span></button>
        <button class="mobile-drawer__item" type="button" data-drawer-saved><i class="fa-solid fa-bookmark" aria-hidden="true"></i><span>Listas Salvas</span></button>
        <button class="mobile-drawer__item" type="button" data-drawer-settings><i class="fa-solid fa-gear" aria-hidden="true"></i><span>Configurações</span></button>
        <button class="mobile-drawer__item" type="button" data-theme-toggle aria-pressed="false"><i class="fa-solid fa-moon" aria-hidden="true"></i><span data-theme-label>Tema escuro</span></button>
      </nav>
      <div class="mobile-drawer__review-container"><button class="btn btn-primary btn-block mobile-drawer__review" type="button" data-drawer-review>Avaliar</button></div>
    </aside>`;
}
function setupBottomNavAutoHide() {
  const navigation = app.querySelector('.bottom-nav');
  if (!navigation) return;

  // Mantém a navegação fora do feed-shell: transformações/animações do conteúdo
  // não podem alterar o referencial de posicionamento fixed da barra.
  if (navigation.parentElement !== app) app.appendChild(navigation);

  app.__bottomNavScrollController?.abort();
  navigation.classList.remove('is-scroll-hidden');
}
function triggerPageTransition() {
  const shell = app.querySelector('.feed-shell');
  if (!shell) return;
  shell.classList.remove('is-page-entering');
  void shell.offsetWidth;
  shell.classList.add('is-page-entering');
  shell.addEventListener('animationend', (event) => {
    if (event.target === shell) shell.classList.remove('is-page-entering');
  }, { once: true });
}

function setupMobileDrawer(user, profile = null) {
  const trigger = app.querySelector('[data-header-avatar]');
  const drawer = app.querySelector('[data-mobile-drawer]');
  const backdrop = app.querySelector('.mobile-drawer-backdrop');
  if (!trigger || !drawer) return;
  const drawerAvatar = drawer.querySelector('[data-drawer-avatar]');
  const drawerUsername = drawer.querySelector('[data-drawer-username]');
  const followingCount = drawer.querySelector('[data-following-count]');
  const followersCount = drawer.querySelector('[data-followers-count]');
  const fallbackUsername = user.user_metadata?.username || user.email?.split('@')[0] || 'jogador';
  if (profile?.avatar_url && drawerAvatar) {
    drawerAvatar.innerHTML = '<img src="' + escapeHTML(profile.avatar_url) + '" alt="Foto do perfil">';
  }
  if (drawerUsername) drawerUsername.textContent = profile?.username || fallbackUsername;

  if (trigger.dataset.drawerBound) return;
  trigger.dataset.drawerBound = 'true';

  let closeTimer = null;
  const close = () => {
    if (drawer.hidden || drawer.classList.contains('is-closing')) return;
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    drawer.classList.add('is-closing');
    trigger.setAttribute('aria-expanded', 'false');
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      drawer.hidden = true;
      backdrop.hidden = true;
      drawer.classList.remove('is-closing');
    }, 240);
  };
  const open = () => {
    window.clearTimeout(closeTimer);
    drawer.classList.remove('is-closing');
    drawer.hidden = false;
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    window.requestAnimationFrame(() => {
      drawer.classList.add('is-open');
      backdrop.classList.add('is-open');
    });
  };

  trigger.addEventListener('click', () => drawer.hidden ? open() : close());
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      drawer.hidden ? open() : close();
    }
  });
  backdrop.addEventListener('click', close);
  drawer.querySelector('[data-drawer-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !drawer.hidden) {
      close();
      trigger.focus();
    }
  });

  drawer.querySelector('[data-drawer-home]')?.addEventListener('click', () => { close(); navigateToFeed(user); });
  drawer.querySelector('[data-drawer-search]')?.addEventListener('click', () => { close(); navigateToSearch(user); });
  drawer.querySelector('[data-drawer-profile]')?.addEventListener('click', () => {
    close();
    if (profile?.username) navigateToProfile(user, profile.username);
  });
  drawer.querySelector('[data-drawer-saved]')?.addEventListener('click', () => { close(); navigateToFeed(user, 'saved'); });
  drawer.querySelector('[data-drawer-settings]')?.addEventListener('click', () => {
    close();
    if (profile) openProfileEditor(user, profile);
  });
  drawer.querySelector('[data-drawer-review]')?.addEventListener('click', () => {
    close();
    openReviewComposer(user);
  });

  Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', user.id),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user.id)
  ]).then(([followingResult, followersResult]) => {
    if (followingCount) followingCount.textContent = String(followingResult.count ?? 0);
    if (followersCount) followersCount.textContent = String(followersResult.count ?? 0);
    if (followingResult.error) console.error('[Ludus] Falha ao carregar total de seguindo:', followingResult.error);
    if (followersResult.error) console.error('[Ludus] Falha ao carregar total de seguidores:', followersResult.error);
  });
}

function setupDeveloperInspector() {
  if (document.querySelector('[data-dev-inspector-toggle]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dev-inspector-toggle';
  button.dataset.devInspectorToggle = '';
  button.setAttribute('aria-label', 'Modo de desenvolvedor');
  button.title = 'Modo de desenvolvedor';
  button.innerHTML = '<i class="fa-solid fa-wrench" aria-hidden="true"></i>';

  const panel = document.createElement('section');
  panel.className = 'dev-inspector-panel';
  panel.dataset.devInspectorPanel = '';
  panel.hidden = true;
  panel.innerHTML = '<header class="dev-inspector-panel__header"><strong>Modo de desenvolvedor</strong><button type="button" data-dev-inspector-close aria-label="Fechar">×</button></header>' +
    '<p>Contornar elementos e exibir informações:</p>' +
    '<label><input type="checkbox" data-dev-field="tag" checked> Nome do elemento</label>' +
    '<label><input type="checkbox" data-dev-field="class" checked> Nome da classe</label>' +
    '<label><input type="checkbox" data-dev-field="dimensions" checked> Dimensões</label>' +
    '<label><input type="checkbox" data-dev-field="font" checked> Fonte e peso</label>' +
    '<label><input type="checkbox" data-dev-field="id"> ID</label>';

  const layer = document.createElement('div');
  layer.className = 'dev-inspector-layer';
  layer.dataset.devInspectorLayer = '';
  layer.hidden = true;
  document.body.append(button, panel, layer);

  let active = false;
  let frame = 0;
  const fields = () => Object.fromEntries([...panel.querySelectorAll('[data-dev-field]')].map((input) => [input.dataset.devField, input.checked]));
  const ignored = (element) => element === button || panel.contains(element) || layer.contains(element) ||
    element.closest('[data-dev-inspector-panel], [data-dev-inspector-layer], [data-dev-inspector-toggle]') ||
    element.hidden || getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden';

  const draw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!active) return;
      layer.replaceChildren();
      const selected = fields();
      const elements = document.body.querySelectorAll('body *');
      elements.forEach((element) => {
        if (ignored(element)) return;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0 ||
            rect.top > innerHeight || rect.left > innerWidth) return;
        const style = getComputedStyle(element);
        const outline = document.createElement('div');
        outline.className = 'dev-inspector-outline';
        outline.style.left = rect.left + 'px';
        outline.style.top = rect.top + 'px';
        outline.style.width = rect.width + 'px';
        outline.style.height = rect.height + 'px';
        const details = [];
        if (selected.tag) details.push(element.tagName.toLowerCase());
        if (selected.class && typeof element.className === 'string' && element.className.trim()) details.push('.' + element.className.trim().replace(/\s+/g, '.'));
        if (selected.dimensions) details.push(Math.round(rect.width) + ' × ' + Math.round(rect.height) + 'px');
        if (selected.font) details.push(style.fontSize + ' / ' + style.fontWeight);
        if (selected.id && element.id) details.push('#' + element.id);
        if (details.length) {
          const label = document.createElement('span');
          label.className = 'dev-inspector-outline__label';
          label.textContent = details.join(' | ');
          outline.append(label);
        }
        layer.append(outline);
      });
    });
  };
  const toggle = (enabled) => {
    active = enabled;
    panel.hidden = !enabled;
    layer.hidden = !enabled;
    button.classList.toggle('is-active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    if (enabled) draw();
    else layer.replaceChildren();
  };
  button.addEventListener('click', () => toggle(!active));
  panel.querySelector('[data-dev-inspector-close]').addEventListener('click', () => toggle(false));
  panel.querySelectorAll('[data-dev-field]').forEach((input) => input.addEventListener('change', draw));
  window.addEventListener('scroll', draw, { passive: true });
  window.addEventListener('resize', draw);
  const observer = new MutationObserver((records) => {
    if (active && records.some((record) => !layer.contains(record.target) && !panel.contains(record.target) && record.target !== button)) draw();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
}

async function setupSharedSideMenu(user, profile = null) {
  setupBottomNavAutoHide();
  const root = app.querySelector('.side-menu--left');
  if (!root) return;
  // A navegação não deve depender da resposta da consulta de perfil.
  root.querySelector('[data-open-search]')?.addEventListener('click', () => navigateToSearch(user));
  app.querySelector('[data-bottom-home]')?.addEventListener('click', () => navigateToFeed(user));
  app.querySelector('[data-bottom-search]')?.addEventListener('click', () => navigateToSearch(user));
  app.querySelector('[data-bottom-review]')?.addEventListener('click', () => openReviewComposer(user));
  app.querySelector('[data-bottom-profile]')?.addEventListener('click', () => {
    if (profile?.username) navigateToProfile(user, profile.username);
    else supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (data?.username) navigateToProfile(user, data.username); });
  });
  if (!profile) {
    const { data } = await supabase.from('profiles')
      .select('username, display_name, avatar_url, bio')
      .eq('id', user.id).maybeSingle();
    profile = data;
  }
  if (!root.isConnected) return;
  const bottomProfileAvatar = app.querySelector('[data-bottom-profile-avatar]');
  if (bottomProfileAvatar) {
    bottomProfileAvatar.innerHTML = profile?.avatar_url
      ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"></circle><path d="M5 19.5c.6-3.6 3.1-5.6 7-5.6s6.4 2 7 5.6"></path></svg>';
  }
  setupMobileDrawer(user, profile);
  const username = root.querySelector('[data-side-username]');
  const avatar = root.querySelector('[data-side-avatar]');
  if (username) username.textContent = profile?.username || user.email?.split('@')[0] || 'jogador';
  if (avatar && profile?.avatar_url) avatar.innerHTML = '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">';
  root.querySelector('[data-side-profile]')?.addEventListener('click', () => {
    if (profile?.username) navigateToProfile(user, profile.username);
  });
  root.querySelector('[data-side-settings]')?.addEventListener('click', () => {
    if (profile) openProfileEditor(user, profile);
  });
  root.querySelectorAll('[data-feed-mode]').forEach((button) => {
    button.addEventListener('click', () => navigateToFeed(user, button.dataset.feedMode || 'home'));
  });
  app.querySelectorAll('.feed-center-column [data-feed-mode]').forEach((button) => {
    button.addEventListener('click', () => navigateToFeed(user));
  });
  setupNotifications(user);
}

function isAdminRoute() {
  return window.location.hash === '#/admin' || window.location.hash.startsWith('#/admin/');
}

async function renderAdminPage(currentUser) {
  const parts = window.location.hash.split('/');
  const section = parts[2] || 'inicio';
  const sections = {
    inicio: { title: 'Visão geral', description: 'Resumo da comunidade e das atividades administrativas.' },
    usuarios: { title: 'Usuários', description: 'Consulte contas, acompanhe a atividade e gerencie acessos.' },
    denuncias: { title: 'Denúncias', description: 'Acompanhe denúncias recebidas pela comunidade.' },
    conteudos: { title: 'Conteúdos', description: 'Ferramentas de moderação de avaliações e comentários.' },
    comunicados: { title: 'Comunicados', description: 'Avisos e comunicados para a comunidade.' },
    historico: { title: 'Histórico', description: 'Registro das ações administrativas.' }
  };
  const active = sections[section] ? section : 'inicio';
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const verifiedUser = authData?.user;
  if (authError || !verifiedUser || verifiedUser.id !== currentUser.id ||
      verifiedUser.app_metadata?.role !== 'admin') {
    app.innerHTML = `
      <main class="admin-access-denied">
        <a class="admin-access-denied__brand" href="#inicio">Ludus</a>
        <section><i class="fa-solid fa-lock" aria-hidden="true"></i><h1>Acesso restrito</h1>
        <p>Esta área é exclusiva para administradores do Ludus.</p><a href="#inicio">Voltar ao Ludus</a></section>
      </main>`;
    return;
  }

  const { data: profile } = await supabase.from('profiles')
    .select('username, avatar_url').eq('id', verifiedUser.id).maybeSingle();
  const username = profile?.username || 'administrador';
  const nav = [
    ['inicio', 'fa-chart-pie', 'Visão geral'],
    ['usuarios', 'fa-users', 'Usuários'],
    ['denuncias', 'fa-flag', 'Denúncias'],
    ['conteudos', 'fa-layer-group', 'Conteúdos'],
    ['comunicados', 'fa-bullhorn', 'Comunicados'],
    ['historico', 'fa-clock-rotate-left', 'Histórico']
  ];
  const navMarkup = nav.map(([key, icon, label]) => `
    <a class="admin-nav__item ${active === key ? 'is-active' : ''}" href="#/admin/${key}" ${active === key ? 'aria-current="page"' : ''}>
      <i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>
    </a>`).join('');
  const avatarMarkup = profile?.avatar_url
    ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">'
    : '<i class="fa-solid fa-user" aria-hidden="true"></i>';
  const current = sections[active];

  app.innerHTML = `
    <div class="admin-layout">
      <aside class="admin-sidebar">
        <a class="admin-brand" href="#/admin"><span>Ludus</span><small>ADMIN</small></a>
        <nav class="admin-nav" aria-label="Navegação administrativa">
          <span class="admin-nav__label">MENU</span>${navMarkup}
        </nav>
        <a class="admin-back-link" href="#inicio"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>Voltar ao Ludus</span></a>
      </aside>
      <main class="admin-main">
        <header class="admin-mobile-header">
          <a class="admin-brand" href="#/admin"><span>Ludus</span><small>ADMIN</small></a>
          <button class="admin-menu-toggle" type="button" data-admin-menu-toggle aria-expanded="false" aria-controls="admin-mobile-menu" aria-label="Abrir menu">
            <i class="fa-solid fa-bars" aria-hidden="true"></i>
          </button>
        </header>
        <div class="admin-mobile-backdrop" data-admin-menu-backdrop hidden></div>
        <nav class="admin-mobile-menu" id="admin-mobile-menu" data-admin-mobile-menu aria-label="Menu administrativo" hidden>
          <div class="admin-mobile-menu__head"><strong>Navegação</strong><button type="button" data-admin-menu-close aria-label="Fechar menu"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
          ${navMarkup}
          <a class="admin-nav__item admin-mobile-menu__back" href="#inicio"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>Voltar ao Ludus</span></a>
        </nav>
        <header class="admin-topbar">
          <span class="admin-topbar__context">Painel administrativo</span>
          <div class="admin-account"><span class="admin-account__avatar">${avatarMarkup}</span><span><strong>@${escapeHTML(username)}</strong><small>Administrador</small></span></div>
        </header>
        <section class="admin-content">
          <div class="admin-page-heading"><div><h1>${current.title}</h1><p>${current.description}</p></div></div>
          ${active === 'inicio' ? `
            <div class="admin-dashboard" data-admin-dashboard>
              <div class="admin-dashboard__metrics" data-admin-dashboard-metrics>
                <div class="admin-metric admin-metric--loading"></div><div class="admin-metric admin-metric--loading"></div>
                <div class="admin-metric admin-metric--loading"></div><div class="admin-metric admin-metric--loading"></div>
              </div>
              <section class="admin-dashboard__section">
                <div class="admin-dashboard__section-heading"><h2>Atividade administrativa</h2><a href="#/admin/historico">Ver histórico</a></div>
                <div class="admin-activity" data-admin-dashboard-activity><p class="admin-dashboard__loading">Carregando atividade…</p></div>
              </section>
            </div>` : active === 'usuarios' ? `
              <div class="admin-users">
                <div class="admin-users__toolbar">
                  <label class="admin-users__search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" placeholder="Buscar por nome de usuário..." autocomplete="off" data-admin-user-search></label>
                  <button class="admin-users__refresh" type="button" data-admin-user-refresh aria-label="Atualizar lista"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>
                </div>
                <div class="admin-users__filters" role="group" aria-label="Filtrar usuários">
                  <button type="button" class="is-active" data-admin-user-filter="all">Todos</button>
                  <button type="button" data-admin-user-filter="admins">Administradores</button>
                  <button type="button" data-admin-user-filter="suspended">Suspensos</button>
                </div>
                <div class="admin-users__summary" data-admin-user-summary>Carregando usuários…</div>
                <div class="admin-users__list" data-admin-user-list><div class="admin-users__loading"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Carregando usuários…</div></div>
                <div class="admin-users__pagination" data-admin-user-pagination></div>
              </div>` : `
              <div class="admin-empty-state"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><h2>${current.title}</h2><p>${current.description}</p><span>Esta seção ainda não está disponível.</span></div>`}
        </section>
      </main>
    </div>`;

  const toggle = app.querySelector('[data-admin-menu-toggle]');
  const menu = app.querySelector('[data-admin-mobile-menu]');
  const backdrop = app.querySelector('[data-admin-menu-backdrop]');
  const closeMenu = () => {
    menu.hidden = true;
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menu');
    document.body.classList.remove('admin-menu-open');
  };
  toggle?.addEventListener('click', () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    backdrop.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    toggle.setAttribute('aria-label', opening ? 'Fechar menu' : 'Abrir menu');
    document.body.classList.toggle('admin-menu-open', opening);
  });
  app.querySelector('[data-admin-menu-close]')?.addEventListener('click', closeMenu);
  backdrop?.addEventListener('click', closeMenu);
  menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  const handleAdminMenuEscape = (event) => {
    if (event.key === 'Escape' && menu && !menu.hidden) closeMenu();
  };
  document.addEventListener('keydown', handleAdminMenuEscape);

  if (active === 'inicio') setupAdminDashboard();
  if (active === 'usuarios') setupAdminUsersSection(verifiedUser);
}

async function setupAdminDashboard() {
  const metrics = app.querySelector('[data-admin-dashboard-metrics]');
  const activity = app.querySelector('[data-admin-dashboard-activity]');
  if (!metrics || !activity) return;
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'dashboard' } });
  if (error || data?.error) {
    metrics.innerHTML = '<p class="admin-dashboard__error">Não foi possível carregar os indicadores.</p>';
    activity.innerHTML = '<p class="admin-dashboard__error">Tente atualizar a página.</p>';
    return;
  }
  const cards = [
    ['Usuários', data.users, 'fa-users', 'Contas cadastradas'],
    ['Avaliações', data.reviews, 'fa-star', 'Publicações na comunidade'],
    ['Denúncias', data.reports, 'fa-flag', 'Recebidas pela comunidade'],
    ['Suspensões', data.suspended, 'fa-user-slash', 'Contas atualmente suspensas']
  ];
  metrics.innerHTML = cards.map(([label, value, icon, note]) => `
    <article class="admin-metric"><span class="admin-metric__icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
      <span class="admin-metric__label">${label}</span><strong>${Number(value || 0).toLocaleString('pt-BR')}</strong><small>${note}</small></article>`).join('');
  const logs = data.activity || [];
  activity.innerHTML = logs.length ? logs.map((item) => {
    const action = item.action === 'USER_SUSPENDED' ? 'Conta suspensa' : item.action === 'USER_REACTIVATED' ? 'Conta reativada' : 'Cargo administrativo alterado';
    const actor = item.actor_username ? '@' + item.actor_username : 'Administrador';
    const target = item.target_username ? ' · @' + item.target_username : '';
    const icon = item.action === 'USER_SUSPENDED' ? 'fa-user-slash' : item.action === 'USER_REACTIVATED' ? 'fa-user-check' : 'fa-shield-halved';
    return `<article class="admin-activity__item"><span class="admin-activity__icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span class="admin-activity__copy"><strong>${action}</strong><small>${escapeHTML(actor + target)}</small></span><time>${escapeHTML(relativeTime(item.created_at))}</time></article>`;
  }).join('') : '<p class="admin-activity__empty">Nenhuma ação administrativa registrada ainda.</p>';
}

function setupAdminUsersSection(adminUser) {
  const search = app.querySelector('[data-admin-user-search]');
  const list = app.querySelector('[data-admin-user-list]');
  const summary = app.querySelector('[data-admin-user-summary]');
  const pagination = app.querySelector('[data-admin-user-pagination]');
  const filterButtons = [...app.querySelectorAll('[data-admin-user-filter]')];
  if (!search || !list || !summary || !pagination) return;

  let page = 1;
  let filter = 'all';
  let requestId = 0;
  let searchTimer = null;

  const formatDate = (value) => {
    if (!value) return 'Nunca';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };

  const load = async () => {
    const currentRequest = ++requestId;
    list.innerHTML = '<div class="admin-users__loading"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Carregando usuários…</div>';
    pagination.innerHTML = '';
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'list', query: search.value.trim(), filter, page }
    });
    if (currentRequest !== requestId) return;
    if (error || data?.error) {
      list.innerHTML = '<div class="admin-users__message admin-users__message--error">' + escapeHTML(data?.error || error?.message || 'Não foi possível carregar os usuários.') + '</div>';
      summary.textContent = 'Falha ao carregar a lista.';
      return;
    }
    const users = data?.users || [];
    const total = Number(data?.total || 0);
    const perPage = Number(data?.per_page || 20);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    summary.textContent = total + (total === 1 ? ' usuário encontrado' : ' usuários encontrados');

    if (!users.length) {
      list.innerHTML = '<div class="admin-users__empty"><i class="fa-solid fa-user-slash" aria-hidden="true"></i><strong>Nenhum usuário encontrado</strong><span>Tente alterar a busca ou o filtro.</span></div>';
    } else {
      list.innerHTML = users.map((user) => {
        const isSelf = user.id === adminUser.id;
        const avatar = user.avatar_url
          ? '<img src="' + escapeHTML(user.avatar_url) + '" alt="">'
          : '<i class="fa-solid fa-user" aria-hidden="true"></i>';
        const role = user.role === 'admin';
        const suspended = user.is_suspended;
        const actions = isSelf
          ? '<span class="admin-user-row__self">Sua conta</span>'
          : '<div class="admin-user-row__actions">' +
            (role ? '<button type="button" data-admin-user-action="demote" data-user-id="' + escapeHTML(user.id) + '" data-username="' + escapeHTML(user.username) + '">Remover administrador</button>' :
              '<button type="button" data-admin-user-action="promote" data-user-id="' + escapeHTML(user.id) + '" data-username="' + escapeHTML(user.username) + '">Tornar administrador</button>') +
            (role ? '' : suspended
              ? '<button type="button" data-admin-user-action="reactivate" data-user-id="' + escapeHTML(user.id) + '" data-username="' + escapeHTML(user.username) + '">Reativar conta</button>'
              : '<button type="button" class="is-danger" data-admin-user-action="suspend" data-user-id="' + escapeHTML(user.id) + '" data-username="' + escapeHTML(user.username) + '">Suspender conta</button>') +
            '</div>';
        return '<article class="admin-user-row">' +
          '<span class="admin-user-row__avatar">' + avatar + '</span>' +
          '<div class="admin-user-row__identity"><div class="admin-user-row__name"><a href="#/perfil/' + encodeURIComponent(user.username) + '">@' + escapeHTML(user.username) + '</a>' +
          (role ? '<span class="admin-user-row__role">ADMIN</span>' : '') +
          (suspended ? '<span class="admin-user-row__status is-suspended">SUSPENSO</span>' : '<span class="admin-user-row__status">ATIVO</span>') +
          '</div><span class="admin-user-row__meta">Cadastro: ' + formatDate(user.created_at) + ' · Último acesso: ' + formatDate(user.last_sign_in_at) + '</span></div>' +
          '<div class="admin-user-row__activity"><strong>' + (user.review_count ?? '—') + '</strong><span>avaliações</span></div>' +
          actions + '</article>';
      }).join('');
    }

    if (totalPages > 1) {
      pagination.innerHTML = '<button type="button" data-admin-user-page="prev" ' + (page <= 1 ? 'disabled' : '') + '>Anterior</button><span>Página ' + page + ' de ' + totalPages + '</span><button type="button" data-admin-user-page="next" ' + (page >= totalPages ? 'disabled' : '') + '>Próxima</button>';
    }
  };

  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { page = 1; load(); }, 250);
  });
  filterButtons.forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.adminUserFilter || 'all';
    page = 1;
    filterButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    load();
  }));
  app.querySelector('[data-admin-user-refresh]')?.addEventListener('click', load);
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-admin-user-action]');
    if (!button) return;
    const action = button.dataset.adminUserAction;
    const userId = button.dataset.userId;
    const username = button.dataset.username || 'este usuário';
    const messages = {
      suspend: 'Suspender @' + username + '?',
      reactivate: 'Reativar a conta de @' + username + '?',
      promote: 'Tornar @' + username + ' administrador? Essa pessoa terá acesso à área administrativa.',
      demote: 'Remover o cargo de administrador de @' + username + '?'
    };
    let payload;
    if (action === 'suspend') {
      const reason = window.prompt('Informe o motivo da suspensão de @' + username + ':');
      if (!reason?.trim()) return;
      const durationInput = window.prompt('Duração em dias (7, 30, 90...) ou 0 para suspensão permanente:', '7');
      if (durationInput === null) return;
      const durationDays = Number(durationInput.trim());
      if (!Number.isInteger(durationDays) || durationDays < 0 || durationDays > 3650) {
        window.alert('Informe 0 ou um número inteiro entre 1 e 3650 dias.');
        return;
      }
      if (!window.confirm(messages[action] + '\\nDuração: ' + (durationDays === 0 ? 'permanente' : durationDays + ' dias') + '\\nMotivo: ' + reason.trim())) return;
      payload = { action: 'suspend', user_id: userId, reason: reason.trim(), duration_days: durationDays };
    } else {
      if (!window.confirm(messages[action] || 'Confirmar esta ação?')) return;
      payload = action === 'reactivate' ? { action: 'reactivate', user_id: userId }
        : { action: 'set_role', user_id: userId, role: action === 'promote' ? 'admin' : 'user' };
    }
    button.disabled = true;
    const { data, error } = await supabase.functions.invoke('admin-users', { body: payload });
    if (error || data?.error) {
      window.alert(data?.error || error?.message || 'Não foi possível concluir a ação.');
      button.disabled = false;
      return;
    }
    await load();
  });
  pagination.addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-user-page]');
    if (!button || button.disabled) return;
    page += button.dataset.adminUserPage === 'next' ? 1 : -1;
    load();
  });
  load();
}

async function renderSignedIn(user, initialFeedMode = 'home') {
  setupDeveloperInspector();
  // Evita reconstruir o feed quando o Supabase restaura/renova a sessão ao voltar à aba.
  // A tela já está montada e os dados permanecem visíveis, sem piscar para o estado de carregamento.
  if (activeUser?.id === user.id && app.querySelector('[data-feed-list]') &&
      !getProfileUsernameFromLocation() && !getGameIdFromLocation() && !getReviewIdFromLocation() && !getReviewReportIdFromLocation() && !isAdminRoute()) return;
  activeUser = user;
  if (isAdminRoute()) { await renderAdminPage(user); return; }
  const reportRouteId = getReviewReportIdFromLocation();
  if (reportRouteId) { renderReviewReportPage(user, reportRouteId); return; }
  const reviewRouteId = getReviewIdFromLocation();
  if (reviewRouteId) { renderReviewPage(user, reviewRouteId); return; }
  const fallbackName = user.email?.split('@')[0] || 'jogador';
  app.innerHTML = `
    <div class="feed-shell">
      ${sharedSideMenuMarkup(user)}
      <main class="feed-center-column feed-main">
      ${sharedFeedHeaderMarkup()}
        <div class="feed-main__container">
        <aside class="feed-ad feed-ad--left" aria-label="Espaço reservado para publicidade"></aside>


        <section class="newcomers-section" aria-hidden="true" hidden>
          <div class="newcomers-section__heading"><button type="button" data-newcomers-more hidden></button></div>
          <div class="newcomers-list" data-newcomers-list></div>
        </section>
        <section class="feed-content" aria-label="Atividade da comunidade">
          <div class="feed-list feed-list--loading" data-feed-list aria-busy="true" aria-label="Carregando avaliações"><article class="feed-skeleton-card" aria-hidden="true"><div class="feed-skeleton-card__cover skeleton-shimmer"></div><div class="feed-skeleton-card__body"><div class="feed-skeleton-card__author"><span class="feed-skeleton-card__avatar skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--author skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--date skeleton-shimmer"></span></div><div class="feed-skeleton-card__line feed-skeleton-card__line--title skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--meta skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text-short skeleton-shimmer"></div><div class="feed-skeleton-card__actions"><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span></div></div></article><article class="feed-skeleton-card" aria-hidden="true"><div class="feed-skeleton-card__cover skeleton-shimmer"></div><div class="feed-skeleton-card__body"><div class="feed-skeleton-card__author"><span class="feed-skeleton-card__avatar skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--author skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--date skeleton-shimmer"></span></div><div class="feed-skeleton-card__line feed-skeleton-card__line--title skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--meta skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text-short skeleton-shimmer"></div><div class="feed-skeleton-card__actions"><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span></div></div></article><article class="feed-skeleton-card" aria-hidden="true"><div class="feed-skeleton-card__cover skeleton-shimmer"></div><div class="feed-skeleton-card__body"><div class="feed-skeleton-card__author"><span class="feed-skeleton-card__avatar skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--author skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--date skeleton-shimmer"></span></div><div class="feed-skeleton-card__line feed-skeleton-card__line--title skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--meta skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text-short skeleton-shimmer"></div><div class="feed-skeleton-card__actions"><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span></div></div></article><article class="feed-skeleton-card" aria-hidden="true"><div class="feed-skeleton-card__cover skeleton-shimmer"></div><div class="feed-skeleton-card__body"><div class="feed-skeleton-card__author"><span class="feed-skeleton-card__avatar skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--author skeleton-shimmer"></span><span class="feed-skeleton-card__line feed-skeleton-card__line--date skeleton-shimmer"></span></div><div class="feed-skeleton-card__line feed-skeleton-card__line--title skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--meta skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text skeleton-shimmer"></div><div class="feed-skeleton-card__line feed-skeleton-card__line--text-short skeleton-shimmer"></div><div class="feed-skeleton-card__actions"><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span><span class="skeleton-shimmer"></span></div></div></article></div>
        </section>
        </div>
      </main>
      <footer class="side-menu side-menu--right" aria-label="Coluna lateral direita"><aside class="feed-ad feed-ad--right" aria-label="Espaço reservado para publicidade"></aside></footer>
    </div>`;

  setupNotifications(user);
  setupBottomNavAutoHide();

  const username = app.querySelector('[data-username]');
  const avatar = app.querySelector('[data-avatar]');
  if (username) username.textContent = fallbackName;
  if (avatar) avatar.innerHTML = profilePlaceholderMarkup();

  const profileResult = await supabase.from('profiles')
    .select('username, display_name, avatar_url, banner_url, bio')
    .eq('id', user.id).maybeSingle();

  const bottomProfileAvatar = app.querySelector('[data-bottom-profile-avatar]');
  if (bottomProfileAvatar) {
    bottomProfileAvatar.innerHTML = profileResult.data?.avatar_url
      ? '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="">'
      : profilePlaceholderMarkup();
  }

  app.querySelector('[data-bottom-profile]')?.addEventListener('click', () => {
    const username = profileResult.data?.username;
    if (username) navigateToProfile(user, username);
  });

  const drawerAvatar = app.querySelector('[data-drawer-avatar]');
  if (drawerAvatar && profileResult.data?.avatar_url) {
    drawerAvatar.innerHTML = '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="Foto do perfil">';
  }
  setupMobileDrawer(user, profileResult.data);
  if (profileResult.data) {
    if (username) username.textContent = profileResult.data.username || fallbackName;
    const sideUsername = app.querySelector('[data-side-username]');
    const sideAvatar = app.querySelector('[data-side-avatar]');
    if (sideUsername) sideUsername.textContent = profileResult.data.username || fallbackName;
    if (sideAvatar && profileResult.data.avatar_url) sideAvatar.innerHTML = '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="">';
    if (avatar && profileResult.data.avatar_url) {
      avatar.innerHTML = '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="">';
    }
  } else {
    if (username) username.textContent = '';
  }

  const accountDetails = app.querySelector('[data-account-details]');
  const closeAccountMenu = () => { if (accountDetails) accountDetails.open = false; };
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-account-details]')) closeAccountMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAccountMenu();
  });
  app.querySelector('[data-open-own-profile]')?.addEventListener('click', () => {
    closeAccountMenu();
    if (profileResult.data?.username) navigateToProfile(user, profileResult.data.username);
  });
  app.querySelector('[data-account-settings]')?.addEventListener('click', () => {
    closeAccountMenu();
    if (profileResult.data) openProfileEditor(user, profileResult.data);
  });
  app.querySelector('[data-side-settings]')?.addEventListener('click', () => {
    if (profileResult.data) openProfileEditor(user, profileResult.data);
  });
  app.querySelector('[data-side-profile]')?.addEventListener('click', () => {
    if (profileResult.data?.username) navigateToProfile(user, profileResult.data.username);
  });
  app.querySelector('[data-signout]')?.addEventListener('click', async () => {
    try { await signOut(); renderAuth('welcome'); }
    catch (error) { console.error('[Ludus] Falha ao sair:', error); }
  });

  const notificationRoot = app.querySelector('[data-notifications]');
  const notificationsButton = notificationRoot?.querySelector('[data-notifications-toggle]');
  const notificationPanel = notificationRoot?.querySelector('[data-notifications-panel]');

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (notificationRoot && !notificationRoot.contains(event.target) && notificationPanel && !notificationPanel.hidden) {
      notificationPanel.hidden = true;
      notificationsButton?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (notificationPanel) notificationPanel.hidden = true;
      notificationsButton?.setAttribute('aria-expanded', 'false');
    }
  });

  const routeUsername = getProfileUsernameFromLocation();
  if (routeUsername) {
    await renderProfilePage(user, routeUsername);
    return;
  }
  if (window.location.hash === '#/buscar') {
    await renderSearchPage(user);
    return;
  }
  const routeGameId = getGameIdFromLocation();
  if (routeGameId) {
    await renderGamePage(user, routeGameId);
    return;
  }
  const routeReviewId = getReviewIdFromLocation();
  if (routeReviewId) {
    await renderReviewPage(user, routeReviewId);
    return;
  }

  const feedList = app.querySelector('[data-feed-list]');
  const { data: reviews, error } = await withRequestTimeout(
    fetchAllPages(() => supabase.from('reviews')
      .select('id, user_id, game_id, rating, body, status, liked_game, created_at, profiles!reviews_user_id_fkey(username, display_name, avatar_url), games!reviews_game_id_fkey(title, cover_url, hero_url, steamgriddb_id, release_year, developer, platforms)')
      .order('created_at', { ascending: false })),
    15000,
    { data: [], error: new Error('A consulta principal do feed excedeu o tempo limite.') }
  );

  if (error) {
    console.error('[Ludus] Falha ao carregar feed:', error);
    feedList.classList.remove('feed-list--loading');
    feedList.setAttribute('aria-busy', 'false');
    feedList.innerHTML = '<div class="feed-empty"><span class="feed-empty__number">!</span><h3>Não foi possível carregar o feed.</h3><p>Verifique sua conexão e tente atualizar a página.</p><button type="button" class="feed-retry" data-retry> Tentar novamente ↗</button></div>';
    feedList.querySelector('[data-retry]').addEventListener('click', () => renderSignedIn(user));
    return;
  }

  const gamesMissingYear = [...new Set((reviews || [])
    .filter((review) => review.games?.steamgriddb_id && !review.games?.release_year)
    .map((review) => Number(review.games.steamgriddb_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 50);
  if (gamesMissingYear.length) {
    try {
      const { data: yearSync } = await supabase.functions.invoke('steamgriddb', {
        body: { action: 'sync_years', game_ids: gamesMissingYear }
      });
      const yearsBySteamGridId = new Map((yearSync?.games || []).map((game) => [Number(game.steamgriddb_id), game.release_year]));
      (reviews || []).forEach((review) => {
        const year = yearsBySteamGridId.get(Number(review.games?.steamgriddb_id));
        if (year) review.games.release_year = year;
      });
    } catch (yearSyncError) {
      console.warn('[Ludus] Não foi possível atualizar os anos de lançamento:', yearSyncError);
    }
  }

  const reviewIds = reviews.map((review) => review.id);
  const emptyResult = { data: [], error: null };
  let likeCounts = {};
  let likedReviewIds = new Set();
  let commentCounts = {};
  let savedReviewRows = [];
  let savedReviewIds = new Set();
  let savedAtByReview = new Map();
  let saveCounts = {};
  let followedIds = new Set();
  const gameTitleCounts = (reviews || []).reduce((counts, review) => {
    const title = String(review.games?.title || '').trim().toLocaleLowerCase('pt-BR');
    if (title) counts.set(title, (counts.get(title) || 0) + 1);
    return counts;
  }, new Map());
  const feedTabs = app.querySelector('.feed-tabs');
  feedTabs?.querySelector('[data-create-review]')?.addEventListener('click', () => openReviewComposer(user));
  const newcomersSection = app.querySelector('.newcomers-section');
  const newcomersList = app.querySelector('[data-newcomers-list]');
  let showAllNewcomers = false;
  const newcomersMoreButton = app.querySelector('[data-newcomers-more]');
  const renderNewcomers = () => {
    newcomersList.classList.remove('is-loading');
    newcomersList.setAttribute('aria-busy', 'false');
    const newestReviewsByGame = new Map();
    [...(reviews || [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((review) => {
        if (review.game_id && !newestReviewsByGame.has(review.game_id)) {
          newestReviewsByGame.set(review.game_id, review);
        }
      });
    const newestReviews = [...newestReviewsByGame.values()];
    const visibleNewcomers = showAllNewcomers ? newestReviews : newestReviews.slice(0, 7);
    newcomersMoreButton.hidden = newestReviews.length <= 7;
    newcomersMoreButton.textContent = showAllNewcomers ? 'Ver menos' : 'Ver mais';
    newcomersMoreButton.setAttribute('aria-expanded', String(showAllNewcomers));
    if (!newestReviews.length) {
      newcomersList.innerHTML = '<p class="newcomers-list__empty">Os jogos avaliados pela comunidade aparecerão aqui.</p>';
      return;
    }
    newcomersList.innerHTML = visibleNewcomers.map((review) => {
      const profile = review.profiles || {};
      const username = profile.username || 'jogador';
      const gameData = review.games || {};
      const game = gameData.title || 'Jogo';
      const avatar = profile.avatar_url
        ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="" loading="lazy">'
        : profilePlaceholderMarkup();
      const cover = gameData.cover_url
        ? '<img class="newcomers-review__cover" src="' + escapeHTML(gameData.cover_url) + '" alt="Capa de ' + escapeHTML(game) + '" loading="lazy">'
        : '<span class="newcomers-review__cover newcomers-review__cover--empty">Sem capa</span>';
      const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
      const ratingMarkup = '<span class="newcomers-review__stars" aria-label="' + rating + ' de 5 estrelas">' + '★'.repeat(rating) + '</span>';
      const likedMarkup = review.liked_game
        ? '<span class="newcomers-review__liked" title="Curtiu o jogo" aria-label="Curtiu o jogo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8.8-5.9-8.8-12.2A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4C20.8 15.1 12 21 12 21Z" fill="currentColor"/></svg></span>'
        : '';
      const critiqueMarkup = review.body
        ? '<span class="newcomers-review__critique" title="Publicou uma resenha" aria-label="Publicou uma resenha"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.75h9.5L19 8.2v12.05H5zM14 3.75V8.5h4.75M8 12h8M8 15.5h8M8 8.5h2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
        : '';
      return '<article class="newcomers-review" data-newcomer-review="' + escapeHTML(review.id) + '">' +
        '<div class="newcomers-review__art">' +
          '<button class="newcomers-review__game" type="button" data-open-game="' + escapeHTML(review.game_id) + '" aria-label="Abrir página de ' + escapeHTML(game) + '">' + cover + '</button>' +
          '<button class="newcomers-review__avatar" type="button" data-profile-username="' + escapeHTML(username) + '" aria-label="Ver perfil de ' + escapeHTML(username) + '">' + avatar + '</button>' +
        '</div>' +
        '<button class="newcomers-review__username" type="button" data-profile-username="' + escapeHTML(username) + '">' + escapeHTML(username) + '</button>' +
        '<div class="newcomers-review__metadata">' + ratingMarkup + likedMarkup + critiqueMarkup + '</div>' +
      '</article>';
    }).join('');
  };
  renderNewcomers();
  newcomersMoreButton.addEventListener('click', () => {
    showAllNewcomers = !showAllNewcomers;
    renderNewcomers();
  });
  newcomersSection.addEventListener('click', (event) => {
    const gameButton = event.target.closest('[data-open-game]');
    if (gameButton?.dataset.openGame) {
      navigateToGame(user, gameButton.dataset.openGame);
      return;
    }
    const profileButton = event.target.closest('[data-profile-username]');
    if (profileButton?.dataset.profileUsername) navigateToProfile(user, profileButton.dataset.profileUsername);
  });

  const feedContent = app.querySelector('.feed-content');
  let activeFeedMode = 'home';
  const renderFeed = (mode = 'home') => {
    try {
    feedList.classList.remove('feed-list--loading');
    feedList.setAttribute('aria-busy', 'false');
    activeFeedMode = mode;
    const isHome = mode === 'home';
    newcomersSection.hidden = true;
    feedContent.hidden = false;
    feedList.classList.toggle('is-popular-feed', mode === 'popular');

    let visibleReviews = [...(reviews || [])];
    if (mode === 'following') {
      visibleReviews = visibleReviews.filter((review) => followedIds.has(review.user_id));
      visibleReviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (mode === 'saved') {
      visibleReviews = visibleReviews.filter((review) => savedReviewIds.has(review.id));
      visibleReviews.sort((a, b) => new Date(savedAtByReview.get(b.id) || b.created_at) - new Date(savedAtByReview.get(a.id) || a.created_at));
    } else if (mode === 'popular' || mode === 'home') {
      visibleReviews.sort((a, b) => {
        const scoreA = (likeCounts[a.id] || 0) + (commentCounts[a.id] || 0) + (saveCounts[a.id] || 0);
        const scoreB = (likeCounts[b.id] || 0) + (commentCounts[b.id] || 0) + (saveCounts[b.id] || 0);
        return scoreB - scoreA || new Date(b.created_at) - new Date(a.created_at);
      });
    } else {
      visibleReviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    const feedModeButtons = [...feedTabs.querySelectorAll('[data-feed-mode]')];
    const activeModeIndex = Math.max(0, feedModeButtons.findIndex((button) => button.dataset.feedMode === mode));
    feedTabs.style.setProperty('--active-offset', `${activeModeIndex * 100}%`);
    feedModeButtons.forEach((button) => {
      const active = button.dataset.feedMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    app.querySelectorAll('.side-menu__item[data-feed-mode]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.feedMode === mode);
    });

    if (!visibleReviews.length) {
      const message = mode === 'following'
        ? 'As avaliações de quem você segue aparecerão aqui.'
        : mode === 'saved'
          ? 'As avaliações que você adicionar à lista aparecerão aqui.'
          : 'Ainda não há avaliações publicadas pela comunidade.';
      feedList.innerHTML = '<div class="feed-empty"><span class="feed-empty__number">01</span><h3>O feed ainda está em silêncio.</h3><p>' + message + '</p><span class="feed-empty__note">CADA JOGO TEM UMA HISTÓRIA.</span></div>';
      return;
    }

    feedList.innerHTML = visibleReviews.map((review) => {
      const username = review.profiles?.username || 'jogador';
      const author = username;
      const gameData = review.games || {};
      const game = gameData.title || 'Jogo';
      const gameYear = gameData.release_year ? String(gameData.release_year) : '';
      const gameTitleMarkup = '<span class="review-card__game-title">' + escapeHTML(game) + '</span>' +
        (gameYear ? '<span class="review-card__game-year">(' + escapeHTML(gameYear) + ')</span>' : '');
      const platformList = Array.isArray(gameData.platforms) ? gameData.platforms : [];
      const platformText = platformList.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean).join(', ');
      const gameMeta = [platformText, gameYear, gameData.developer].filter(Boolean).map(escapeHTML).join(' <span aria-hidden="true">·</span> ');
      const cover = '<a class="review-card__cover-wrap" href="#/jogo/' + encodeURIComponent(review.game_id) + '" data-open-game="' + escapeHTML(review.game_id) + '" aria-label="Abrir página de ' + escapeHTML(game) + '">' + (gameData.cover_url
        ? '<img class="review-card__cover" src="' + escapeHTML(gameData.cover_url) + '" alt="Capa de ' + escapeHTML(game) + '" loading="lazy">'
        : '<span class="review-card__cover review-card__cover--empty">Sem capa</span>') + '</a>';
      const stars = '★'.repeat(review.rating) + '<span class="review-card__stars-muted">' + '★'.repeat(5 - review.rating) + '</span>';
      const isLiked = likedReviewIds.has(review.id);
      const avatarMarkup = review.profiles?.avatar_url
        ? '<img src="' + escapeHTML(review.profiles.avatar_url) + '" alt="" loading="lazy">'
        : profilePlaceholderMarkup();
      const isOwner = review.user_id === user.id;
      const menuMarkup = '<details class="review-menu"><summary aria-label="Mais opções da avaliação" title="Mais opções"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></summary><div class="review-menu__panel">' +
        (isOwner ? '<button type="button" class="is-danger" data-review-action="delete"><i class="fa-solid fa-trash" aria-hidden="true"></i><span>Excluir avaliação</span></button>' : '<button type="button" data-review-action="report"><i class="fa-solid fa-flag" aria-hidden="true"></i><span>Denunciar avaliação</span></button>') + '</div></details>';
      const likeTotal = likeCounts[review.id] || 0;
      const commentTotal = commentCounts[review.id] || 0;
      const saveTotal = saveCounts[review.id] || 0;
      const isSaved = savedReviewIds.has(review.id);
      const body = review.body || '';
      const reviewText = body ? '<div class="review-card__text-wrap"><p class="review-card__text" data-review-text>' + escapeHTML(body) + '</p></div>' : '';
      const ratingValue = Number(review.rating).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const reviewDetails = '<div class="review-card__details"><span class="review-card__rating"><i class="fa-solid fa-star" aria-hidden="true"></i><span>' + ratingValue + '</span></span>' +
        (review.liked_game ? '<i class="fa-solid fa-heart review-card__liked" aria-label="Favorito" title="Favorito"></i>' : '') +
        (review.status === 'completed' ? '<i class="fa-solid fa-trophy review-card__completed" aria-label="Zerado" title="Zerado"></i>' : '') + '</div>';
      const reviewAuthor = '<div class="review-card__header"><div class="review-card__identity"><a class="review-card__author" href="#/perfil/' + encodeURIComponent(username) + '" data-profile-username="' + escapeHTML(username) + '"><span class="review-card__author-avatar">' + avatarMarkup + '</span><span class="review-card__author-name">' + escapeHTML(author) + '</span></a><i class="fa-solid fa-circle review-card__timestamp-separator" aria-hidden="true"></i><time class="review-card__timestamp" datetime="' + escapeHTML(review.created_at) + '">' + escapeHTML(relativeTime(review.created_at)) + '</time></div>' + menuMarkup + '</div>';
      const socialActions = '<div class="review-card__social-actions">' +
        '<button class="review-card__like' + (isLiked ? ' is-liked' : '') + '" type="button" data-like-review aria-label="Curtir avaliação" title="Curtir avaliação" aria-pressed="' + isLiked + '"><i class="' + (isLiked ? 'fa-solid' : 'fa-regular') + ' fa-heart" aria-hidden="true"></i><span class="review-card__like-count" data-like-count>' + String(likeTotal) + '</span></button>' +
        '<button type="button" class="review-card__comments-toggle" data-open-review-comments aria-label="Comentar" title="Comentar"><i class="fa-regular fa-comment" aria-hidden="true"></i><span class="review-card__comment-count" data-comment-count>' + String(commentTotal) + '</span></button>' +
        '<button type="button" class="review-card__bookmark' + (isSaved ? ' is-saved' : '') + '" data-save-review aria-label="Salvar avaliação" title="Salvar avaliação" aria-pressed="' + isSaved + '"><i class="' + (isSaved ? 'fa-solid' : 'fa-regular') + ' fa-bookmark" aria-hidden="true"></i><span class="review-card__save-count" data-save-count>' + String(saveTotal) + '</span></button>' +
        '<button type="button" class="review-card__share" data-share-review aria-label="Compartilhar avaliação" title="Compartilhar avaliação"><i class="fa-solid fa-share" aria-hidden="true"></i></button></div>';
      return '<article class="review-card" data-review-id="' + review.id + '">' +
        reviewAuthor +
        '<div class="review-card__game-layout"><div class="review-card__cover-column">' + cover + '</div>' +
        '<div class="review-card__body"><h3 class="review-card__game-heading">' + gameTitleMarkup + '</h3>' + reviewDetails + '</div></div>' +
        reviewText + '<div class="review-card__actions">' + socialActions + '</div></article>';
    }).join('');
    } catch (renderError) {
      console.error('[Ludus] Falha ao montar as publicações do feed:', renderError);
      feedList.classList.remove('feed-list--loading');
      feedList.setAttribute('aria-busy', 'false');
      feedList.innerHTML = '<div class="feed-empty"><span class="feed-empty__number">!</span><h3>As avaliações foram carregadas, mas não puderam ser exibidas.</h3><p>Ocorreu um erro ao montar as publicações. Atualize a página e tente novamente.</p><small class="feed-empty__note">' + escapeHTML(renderError?.message || 'Erro desconhecido') + '</small></div>';
    }
  };

  app.addEventListener('click', (event) => {
    const button = event.target.closest('.side-menu__item[data-feed-mode], .feed-tabs [data-feed-mode]');
    if (button) renderFeed(button.dataset.feedMode);
  });
  renderFeed(initialFeedMode);

  // As publicações aparecem imediatamente; os dados sociais complementares chegam em segundo plano.
  void (async () => {
    const [likesResult, commentsResult, savedResult, saveCountsResult, followedResult] = await Promise.all([
    reviewIds.length
      ? withRequestTimeout(fetchReviewRows('review_likes', 'review_id, user_id', reviewIds), 8000, { data: [], error: new Error('Tempo limite ao carregar curtidas.') })
      : emptyResult,
    reviewIds.length
      ? withRequestTimeout(fetchReviewRows('review_comments', 'id, review_id, user_id, body, created_at, parent_comment_id, profiles!review_comments_user_id_fkey(username, display_name, avatar_url)', reviewIds), 8000, { data: [], error: new Error('Tempo limite ao carregar comentários.') })
      : emptyResult,
    withRequestTimeout(fetchAllPages(() => supabase.from('review_saves').select('review_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false })), 8000, { data: [], error: new Error('Tempo limite ao carregar Minha lista.') }),
    reviewIds.length
      ? withRequestTimeout(supabase.rpc('get_review_save_counts', { p_review_ids: reviewIds }), 8000, { data: [], error: new Error('Tempo limite ao carregar contagem de itens salvos.') })
      : emptyResult,
    withRequestTimeout(fetchAllPages(() => supabase.from('follows').select('following_id').eq('follower_id', user.id)), 8000, { data: [], error: new Error('Tempo limite ao carregar quem você segue.') })
    ]);
    const { data: likes, error: likesError } = likesResult;
    const { data: commentRows, error: commentsCountError } = commentsResult;
    const { data: savedReviewRowsData, error: savedReviewsError } = savedResult;
    const { data: saveCountRows, error: saveCountsError } = saveCountsResult;
    const { data: followedProfiles, error: followedError } = followedResult;
    if (likesError) console.error('[Ludus] Falha ao carregar curtidas:', likesError);
    if (commentsCountError) console.error('[Ludus] Falha ao carregar comentários:', commentsCountError);
    if (savedReviewsError) console.error('[Ludus] Falha ao carregar Minha lista:', savedReviewsError);
    if (saveCountsError) console.error('[Ludus] Falha ao carregar contagem de itens salvos:', saveCountsError);
    if (followedError) console.error('[Ludus] Falha ao carregar quem você segue:', followedError);
    const likeRows = likes || [];
    likeCounts = likeRows.reduce((counts, like) => {
    counts[like.review_id] = (counts[like.review_id] || 0) + 1;
    return counts;
  }, {});
    likedReviewIds = new Set(likeRows.filter((like) => like.user_id === user.id).map((like) => like.review_id));
    commentCounts = (commentRows || []).reduce((counts, comment) => {
    counts[comment.review_id] = (counts[comment.review_id] || 0) + 1;
    return counts;
  }, {});
    savedReviewRows = savedReviewRowsData || [];
    savedReviewIds = new Set(savedReviewRows.map((saved) => saved.review_id));
    savedAtByReview = new Map(savedReviewRows.map((saved) => [saved.review_id, saved.created_at]));
    saveCounts = (saveCountRows || []).reduce((counts, saved) => {
    counts[saved.review_id] = Number(saved.save_count || 0);
    return counts;
  }, {});
    followedIds = new Set((followedProfiles || []).map((item) => item.following_id));

    renderFeed(activeFeedMode);
  })();

  feedList.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-comment-form], [data-reply-form], [data-edit-comment-form]');
    if (!form) return;
    event.preventDefault();
    const card = form.closest('[data-review-id]');
    const textarea = form.querySelector('textarea');
    const submit = form.querySelector('button[type="submit"]');
    const body = textarea.value.trim();
    if (!body || !card) return;
    submit.disabled = true;
    let result;
    if (form.matches('[data-edit-comment-form]')) {
      const comment = form.closest('[data-comment-id]');
      result = await supabase.from('review_comments').update({ body })
        .eq('id', comment?.dataset.commentId).eq('user_id', user.id);
    } else {
      result = await supabase.from('review_comments').insert({
        review_id: card.dataset.reviewId,
        user_id: user.id,
        body,
        parent_comment_id: form.dataset.parentCommentId || null
      });
    }
    if (result.error) {
      console.error('[Ludus] Falha ao salvar comentário:', result.error);
      submit.disabled = false;
      return;
    }
    await loadReviewComments(user, card);
  });

  feedList.addEventListener('click', async (event) => {
    const readMore = event.target.closest('[data-read-more]');
    if (readMore) {
      const text = readMore.closest('.review-card__text-wrap')?.querySelector('[data-review-text]');
      if (text) {
        const expanded = text.classList.toggle('is-expanded');
        text.classList.toggle('is-truncated', !expanded);
        readMore.textContent = expanded ? 'ler menos' : 'ler mais';
      }
      return;
    }
    const reviewAction = event.target.closest('[data-review-action]');
    if (reviewAction) {
      const card = reviewAction.closest('[data-review-id]');
      const review = reviews.find((item) => item.id === card?.dataset.reviewId);
      const action = reviewAction.dataset.reviewAction;
      const menu = reviewAction.closest('.review-menu');
      if (!review || !card) return;
      menu.open = false;
      if (action === 'delete' && review.user_id === user.id) {
        if (!window.confirm('Tem certeza de que deseja excluir esta review? Essa ação não pode ser desfeita.')) return;
        reviewAction.disabled = true;
        const { error: deleteError } = await supabase.from('reviews').delete().eq('id', review.id).eq('user_id', user.id);
        if (deleteError) {
          console.error('[Ludus] Falha ao excluir review:', deleteError);
          reviewAction.disabled = false;
          window.alert('Não foi possível excluir a review. Tente novamente.');
          return;
        }
        const index = reviews.findIndex((item) => item.id === review.id);
        if (index >= 0) reviews.splice(index, 1);
        card.remove();
      } else if (action === 'report' && review.user_id !== user.id) {
        navigateToReviewReport(user, review.id);
      }
      return;
    }

    const gameCoverLink = event.target.closest('[data-open-game]');
    if (gameCoverLink) {
      event.preventDefault();
      const gameId = gameCoverLink.dataset.openGame;
      if (gameId) navigateToGame(user, gameId);
      return;
    }
    const profileLink = event.target.closest('[data-profile-username]');
    if (profileLink?.dataset.profileUsername) {
      event.preventDefault();
      navigateToProfile(user, profileLink.dataset.profileUsername);
      return;
    }
    const openReviewComments = event.target.closest('[data-open-review-comments]');
    if (openReviewComments) {
      const reviewCard = openReviewComments.closest('[data-review-id]');
      if (reviewCard) navigateToReview(user, reviewCard.dataset.reviewId);
      return;
    }
    const viewComments = event.target.closest('[data-view-comments]');
    if (viewComments) {
      const panel = viewComments.closest('[data-comments-panel]');
      const tree = panel?.querySelector('[data-comments-tree]');
      if (tree) {
        tree.hidden = !tree.hidden;
        viewComments.setAttribute('aria-expanded', String(!tree.hidden));
        viewComments.textContent = (tree.hidden ? 'Visualizar comentários' : 'Ocultar comentários') +
          (Number(cardCommentCount(panel)?.textContent || 0) ? ' (' + cardCommentCount(panel).textContent + ')' : '');
      }
      return;
    }
    const repliesToggle = event.target.closest('[data-toggle-replies]');
    if (repliesToggle) {
      const comment = repliesToggle.closest('[data-comment-id]');
      const replies = comment?.querySelector(':scope > .review-comment__replies');
      if (replies) {
        replies.hidden = !replies.hidden;
        repliesToggle.setAttribute('aria-expanded', String(!replies.hidden));
        repliesToggle.querySelector('span').textContent = (replies.hidden ? 'Exibir respostas (' : 'Ocultar respostas (') + repliesToggle.dataset.replyCount + ')';
      }
      return;
    }
    const viewAll = event.target.closest('[data-view-all-comments]');
    if (viewAll) {
      const reviewCard = viewAll.closest('[data-review-id]');
      if (reviewCard) navigateToReview(user, reviewCard.dataset.reviewId);
      return;
    }
    const commentAction = event.target.closest('[data-comment-action]');
    if (commentAction) {
      const comment = commentAction.closest('[data-comment-id]');
      const menu = commentAction.closest('.review-comment__menu');
      const action = commentAction.dataset.commentAction;
      const card = commentAction.closest('[data-review-id]');
      if (!comment || !card) return;
      if (menu) menu.open = false;
      if (action === 'edit') {
        const form = comment.querySelector('[data-edit-comment-form]');
        form.hidden = false;
        comment.querySelector('.review-comment__body').hidden = true;
        form.querySelector('textarea')?.focus();
      } else if (action === 'delete') {
        if (!window.confirm('Excluir este comentário e suas respostas?')) return;
        const { error: deleteError } = await supabase.from('review_comments').delete()
          .eq('id', comment.dataset.commentId).eq('user_id', user.id);
        if (deleteError) { console.error('[Ludus] Falha ao excluir comentário:', deleteError); window.alert('Não foi possível excluir o comentário.'); return; }
        await loadReviewComments(user, card);
      } else if (action === 'report') {
        const reason = window.prompt('Motivo da denúncia:\\n1 — Spam\\n2 — Assédio ou discurso de ódio\\n3 — Spoiler sem aviso\\n4 — Conteúdo impróprio\\n5 — Outro');
        if (reason === null) return;
        const reasons = { '1':'spam', '2':'harassment', '3':'spoiler', '4':'inappropriate', '5':'other' };
        if (!reasons[reason.trim()]) { window.alert('Escolha uma opção de 1 a 5.'); return; }
        const details = window.prompt('Detalhes adicionais (opcional):') || '';
        const { error: reportError } = await supabase.from('comment_reports').insert({
          comment_id: comment.dataset.commentId, reporter_id: user.id, reason: reasons[reason.trim()], details: details.slice(0, 1000)
        });
        if (reportError) {
          console.error('[Ludus] Falha ao denunciar comentário:', reportError);
          window.alert(reportError.code === '23505' ? 'Você já denunciou este comentário.' : 'Não foi possível enviar a denúncia.');
        } else window.alert('Denúncia enviada. Obrigado por ajudar a manter a comunidade segura.');
      }
      return;
    }
    const cancelEdit = event.target.closest('[data-cancel-edit]');
    if (cancelEdit) {
      const comment = cancelEdit.closest('[data-comment-id]');
      const form = comment?.querySelector('[data-edit-comment-form]');
      if (form) { form.hidden = true; comment.querySelector('.review-comment__body').hidden = false; }
      return;
    }
    const replyButton = event.target.closest('[data-reply-comment]');
    if (replyButton) {
      const comment = replyButton.closest('[data-comment-id]');
      const form = comment?.querySelector('[data-reply-form]');
      if (form) {
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('textarea')?.focus();
      }
      return;
    }
    const commentLikeButton = event.target.closest('[data-like-comment]');
    if (commentLikeButton) {
      if (commentLikeButton.disabled) return;
      const comment = commentLikeButton.closest('[data-comment-id]');
      const commentId = comment?.dataset.commentId;
      if (!commentId) return;
      const wasLiked = commentLikeButton.getAttribute('aria-pressed') === 'true';
      const count = commentLikeButton.querySelector('[data-comment-like-count]');
      commentLikeButton.disabled = true;
      const result = wasLiked
        ? await supabase.from('review_comment_likes').delete().eq('comment_id', commentId).eq('user_id', user.id)
        : await supabase.from('review_comment_likes').insert({ comment_id: commentId, user_id: user.id });
      if (result.error) {
        console.error('[Ludus] Falha ao curtir comentário:', result.error);
      } else {
        const nextLiked = !wasLiked;
        const nextCount = Math.max(0, Number(count.textContent || 0) + (nextLiked ? 1 : -1));
        commentLikeButton.setAttribute('aria-pressed', String(nextLiked));
        commentLikeButton.classList.toggle('is-liked', nextLiked);
        count.textContent = nextCount || '';
      }
      commentLikeButton.disabled = false;
      return;
    }
    const deleteComment = event.target.closest('[data-delete-comment]');
    if (deleteComment) {
      const commentId = deleteComment.dataset.deleteComment;
      deleteComment.disabled = true;
      const { error: deleteError } = await supabase.from('review_comments').delete()
        .eq('id', commentId).eq('user_id', user.id);
      if (deleteError) {
        console.error('[Ludus] Falha ao excluir comentário:', deleteError);
        deleteComment.disabled = false;
        return;
      }
      const card = deleteComment.closest('[data-review-id]');
      await loadReviewComments(user, card);
      return;
    }
    const shareButton = event.target.closest('[data-share-review]');
    if (shareButton) {
      const shareCard = shareButton.closest('[data-review-id]');
      const review = reviews.find((item) => String(item.id) === String(shareCard?.dataset.reviewId));
      if (!review) return;
      const shareUrl = new URL('#/review/' + review.id, window.location.href).toString();
      const game = review.games || {};
      const storyModal = document.createElement('div');
      storyModal.className = 'story-share-modal';
      storyModal.setAttribute('role', 'dialog');
      storyModal.setAttribute('aria-modal', 'true');
      storyModal.setAttribute('aria-label', 'Compartilhar avaliação');
      storyModal.innerHTML = '<div class="story-share-modal__panel">' +
        '<div class="story-share-modal__header"><strong>Compartilhar avaliação</strong><button type="button" class="story-share-modal__close" data-story-close aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>' +
        '<div class="story-share-modal__preview"><canvas class="story-share-modal__canvas" width="1080" height="1920" aria-label="Prévia do card de compartilhamento"></canvas></div>' +
        '<div class="story-share-modal__actions"><button type="button" class="btn btn-default" data-story-download><i class="fa-solid fa-download" aria-hidden="true"></i> Baixar imagem</button><button type="button" class="btn btn-primary" data-story-share><i class="fa-solid fa-share-nodes" aria-hidden="true"></i> Compartilhar</button></div></div>';
      document.body.appendChild(storyModal);
      const canvas = storyModal.querySelector('canvas');
      const context = canvas.getContext('2d');
      const loadStoryImage = async (url, allowProxy = true) => {
        if (!url) return null;
        const load = (source) => new Promise((resolve) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = source;
        });
        const directImage = await load(url);
        if (directImage || !allowProxy) return directImage;
        try {
          const parsedUrl = new URL(url, window.location.href);
          const proxyUrl = 'https://images.weserv.nl/?url=' + encodeURIComponent(parsedUrl.host + parsedUrl.pathname + parsedUrl.search) + '&output=png';
          return await load(proxyUrl);
        } catch {
          return null;
        }
      };
      const coverElement = shareCard?.querySelector('.review-card__cover');
      const coverUrl = game.cover_url || coverElement?.currentSrc || coverElement?.src || '';
      const [coverImage, avatarImage] = await Promise.all([
        loadStoryImage(coverUrl),
        loadStoryImage(review.profiles?.avatar_url, false)
      ]);
      const roundRectPath = (ctx, x, y, width, height, radius) => {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
      };
      const drawWrappedText = (ctx, text, centerX, y, maxWidth, lineHeight, maxLines, fontSize) => {
        const words = String(text || '').trim().split(/\\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        for (const word of words) {
          const candidate = line ? line + ' ' + word : word;
          if (ctx.measureText(candidate).width > maxWidth && line) {
            lines.push(line);
            line = word;
            if (lines.length === maxLines) break;
          } else line = candidate;
        }
        if (line && lines.length < maxLines) lines.push(line);
        const textWasTruncated = lines.join(' ').length < String(text || '').trim().length;
        if (textWasTruncated && lines.length) {
          let last = lines[lines.length - 1];
          while (ctx.measureText(last + '…').width > maxWidth && last.length > 1) last = last.slice(0, -1);
          lines[lines.length - 1] = last + '…';
        }
        ctx.textAlign = 'center';
        lines.forEach((item, index) => ctx.fillText(item, centerX, y + index * lineHeight));
        return lines.length * lineHeight;
      };
      const drawPill = (ctx, label, centerX, y, fill, textColor) => {
        ctx.font = '700 19px Arial, sans-serif';
        const width = ctx.measureText(label).width + 34;
        const x = centerX - width / 2;
        ctx.fillStyle = fill;
        roundRectPath(ctx, x, y - 25, width, 38, 19);
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.fillText(label, centerX, y);
      };

      // Card de compartilhamento minimalista: capa, avaliação e autoria.
      context.fillStyle = '#f7f6f2';
      context.fillRect(0, 0, 1080, 1920);

      context.fillStyle = '#7060ab';
      context.font = '700 28px Arial, sans-serif';
      context.textAlign = 'center';
      context.fillText('LUDUS', 540, 92);

      const heroArea = { x: 150, y: 155, width: 780, height: 970 };
      let imageRect = heroArea;
      if (coverImage) {
        const scale = Math.min(heroArea.width / coverImage.width, heroArea.height / coverImage.height);
        const imageWidth = coverImage.width * scale;
        const imageHeight = coverImage.height * scale;
        imageRect = {
          x: (1080 - imageWidth) / 2,
          y: heroArea.y + (heroArea.height - imageHeight) / 2,
          width: imageWidth,
          height: imageHeight
        };
        context.save();
        roundRectPath(context, imageRect.x, imageRect.y, imageRect.width, imageRect.height, 6);
        context.clip();
        context.drawImage(coverImage, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        context.restore();
      } else {
        context.fillStyle = '#e8e5df';
        roundRectPath(context, heroArea.x, heroArea.y, heroArea.width, heroArea.height, 6);
        context.fill();
        context.fillStyle = '#77737f';
        context.font = '400 26px Arial, sans-serif';
        context.textAlign = 'center';
        context.fillText('Capa indisponível', 540, 650);
      }

      const gameTitle = game.title || 'Jogo';
      context.fillStyle = '#28262d';
      context.font = '700 50px Arial, sans-serif';
      const titleHeight = drawWrappedText(context, gameTitle, 540, 1215, 850, 60, 2, 50);

      const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
      const ratingY = 1215 + titleHeight + 52;
      context.fillStyle = '#b88a32';
      context.font = '400 38px Arial, sans-serif';
      context.textAlign = 'center';
      context.fillText('★'.repeat(Math.max(0, Math.min(5, Math.round(rating)))), 540, ratingY);
      context.fillStyle = '#28262d';
      context.font = '600 25px Arial, sans-serif';
      context.fillText(rating.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' / 5', 540, ratingY + 43);

      const reviewText = String(review.body || '').trim();
      if (reviewText) {
        context.fillStyle = '#55515b';
        context.font = '400 27px Arial, sans-serif';
        drawWrappedText(context, reviewText, 540, 1455, 820, 42, 5, 27);
      }

      context.fillStyle = '#55515b';
      context.font = '500 24px Arial, sans-serif';
      context.textAlign = 'center';
      context.fillText('@' + (review.profiles?.username || 'jogador'), 540, 1775);
      context.fillStyle = '#96919b';
      context.font = '400 18px Arial, sans-serif';
      context.fillText('ludus', 540, 1820);
      const closeStoryModal = () => storyModal.remove();
      storyModal.addEventListener('click', (modalEvent) => {
        if (modalEvent.target === storyModal || modalEvent.target.closest('[data-story-close]')) closeStoryModal();
      });
      storyModal.querySelector('[data-story-download]').addEventListener('click', () => {
        canvas.toBlob((blob) => {
          if (!blob) return;
          const downloadUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = 'ludus-review-' + review.id + '.png';
          link.click();
          URL.revokeObjectURL(downloadUrl);
        }, 'image/png');
      });
      storyModal.querySelector('[data-story-share]').addEventListener('click', async () => {
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          const file = new File([blob], 'ludus-review-' + review.id + '.png', { type: 'image/png' });
          try {
            if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Minha avaliação no Ludus', text: shareUrl });
            else {
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = file.name;
              link.click();
              setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            }
          } catch (error) {
            if (error.name !== 'AbortError') console.error('[Ludus] Falha ao compartilhar imagem:', error);
          }
        }, 'image/png');
      });
      const closeOnEscape = (keyEvent) => {
        if (keyEvent.key === 'Escape') {
          closeStoryModal();
          document.removeEventListener('keydown', closeOnEscape);
        }
      };
      document.addEventListener('keydown', closeOnEscape);
      return;
    }
    const saveButton = event.target.closest('[data-save-review]');
    if (saveButton) {
      if (saveButton.disabled) return;
      const saveCard = saveButton.closest('[data-review-id]');
      const saveReviewId = saveCard?.dataset.reviewId;
      if (!saveReviewId) return;
      const wasSaved = savedReviewIds.has(saveReviewId);
      saveButton.disabled = true;
      const saveResult = wasSaved
        ? await supabase.from('review_saves').delete().eq('review_id', saveReviewId).eq('user_id', user.id)
        : await supabase.from('review_saves').insert({ review_id: saveReviewId, user_id: user.id });
      if (saveResult.error) {
        console.error('[Ludus] Falha ao atualizar Minha lista:', saveResult.error);
        window.alert('Não foi possível atualizar sua lista. Tente novamente.');
        saveButton.disabled = false;
        return;
      }
      if (wasSaved) {
        savedReviewIds.delete(saveReviewId);
        savedAtByReview.delete(saveReviewId);
        saveCounts[saveReviewId] = Math.max(0, (saveCounts[saveReviewId] || 0) - 1);
        const savedIndex = savedReviewRows.findIndex((saved) => saved.review_id === saveReviewId);
        if (savedIndex >= 0) savedReviewRows.splice(savedIndex, 1);
      } else {
        const savedAt = new Date().toISOString();
        savedReviewIds.add(saveReviewId);
        savedAtByReview.set(saveReviewId, savedAt);
        saveCounts[saveReviewId] = (saveCounts[saveReviewId] || 0) + 1;
        savedReviewRows.unshift({ review_id: saveReviewId, created_at: savedAt });
      }
      renderFeed(activeFeedMode);
      return;
    }
    const button = event.target.closest('[data-like-review]');
    if (!button || button.dataset.likePending === 'true') return;
    const card = button.closest('[data-review-id]');
    const reviewId = card?.dataset.reviewId;
    if (!reviewId) return;
    const wasLiked = button.getAttribute('aria-pressed') === 'true';
    const count = card.querySelector('[data-like-count]');
    if (!count) return;
    const nextLiked = !wasLiked;
    const previousCount = Number(count.textContent || 0);
    const nextLikeCount = Math.max(0, previousCount + (nextLiked ? 1 : -1));
    button.setAttribute('aria-pressed', String(nextLiked));
    button.classList.toggle('is-liked', nextLiked);
    const heartIcon = button.querySelector('i');
    heartIcon?.classList.toggle('fa-solid', nextLiked);
    heartIcon?.classList.toggle('fa-regular', !nextLiked);
    count.textContent = String(nextLikeCount);
    button.dataset.likePending = 'true';
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
      const request = wasLiked
        ? supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id).abortSignal(controller.signal)
        : supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id }).abortSignal(controller.signal);
      const result = await request;
      if (result.error) throw result.error;
      // O estado visual já foi atualizado de forma otimista antes da resposta do servidor.
    } catch (error) {
      button.setAttribute('aria-pressed', String(wasLiked));
      button.classList.toggle('is-liked', wasLiked);
      heartIcon?.classList.toggle('fa-solid', wasLiked);
      heartIcon?.classList.toggle('fa-regular', !wasLiked);
      count.textContent = String(previousCount);
      console.error('[Ludus] Falha ao atualizar curtida:', error);
      if (controller.signal.aborted) {
        console.warn('[Ludus] A requisição de curtida excedeu 10 segundos e foi cancelada.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      delete button.dataset.likePending;
    }
  });
}


async function loadReviewComments(user, card) {
  if (!card) return;
  const panel = card.querySelector('[data-comments-panel]');
  if (!panel) return;
  panel.innerHTML = '<p class="review-comments__loading">Atualizando comentários…</p>';
  const { data: comments, error } = await supabase.from('review_comments')
    .select('id, review_id, user_id, body, created_at, parent_comment_id, profiles!review_comments_user_id_fkey(username, display_name, avatar_url)')
    .eq('review_id', card.dataset.reviewId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.error('[Ludus] Falha ao carregar comentários:', error);
    panel.innerHTML = '<p class="review-comments__empty">Não foi possível carregar os comentários.</p>';
    return;
  }
  const rows = comments || [];
  const { data: likes, error: likesError } = await fetchCommentLikeRows(rows.map((comment) => comment.id));
  if (likesError) console.error('[Ludus] Falha ao carregar curtidas dos comentários:', likesError);
  panel.outerHTML = renderCommentsSection(card.dataset.reviewId, rows, likes || [], user);
  const count = card.querySelector('[data-comment-count]');
  if (count) count.textContent = rows.length || '';
}

function navigateToReview(currentUser, reviewId) {
  if (!reviewId) return;
  const nextHash = '#/review/' + encodeURIComponent(reviewId);
  if (window.location.hash !== nextHash) window.history.pushState({ page: 'review', reviewId }, '', nextHash);
  renderReviewPage(currentUser, reviewId);
}

function cardCommentCount(panel) {
  return panel?.closest('[data-review-id]')?.querySelector('[data-comment-count]');
}

function getProfileUsernameFromLocation() {
  const match = window.location.hash.match(/^#\/perfil\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getGameIdFromLocation() {
  const parts = window.location.hash.split('/');
  return parts[1] === 'jogo' && parts[2] ? decodeURIComponent(parts[2]) : null;
}

function getReviewIdFromLocation() {
  const parts = window.location.hash.split('/');
  return parts[1] === 'review' && parts[2] ? decodeURIComponent(parts[2]) : null;
}

function getReviewReportIdFromLocation() {
  const parts = window.location.hash.split('/');
  return parts[1] === 'denunciar-avaliacao' && parts[2] ? decodeURIComponent(parts[2]) : null;
}

function navigateToReviewReport(currentUser, reviewId) {
  if (!reviewId) return;
  const nextHash = '#/denunciar-avaliacao/' + encodeURIComponent(reviewId);
  if (window.location.hash !== nextHash) window.history.pushState({ page: 'review-report', reviewId }, '', nextHash);
  renderReviewReportPage(currentUser, reviewId);
}

async function renderReviewReportPage(currentUser, reviewId) {
  const requestId = (renderReviewReportPage.requestId || 0) + 1;
  renderReviewReportPage.requestId = requestId;
  app.innerHTML = `<div class="feed-shell">${sharedSideMenuMarkup(currentUser)}<main class="feed-center-column feed-main profile-main">${sharedFeedHeaderMarkup()}<div class="feed-main__container"><div class="profile-page__content"><div class="profile-page__loading">Carregando avaliação…</div></div></div></main><footer class="side-menu side-menu--right" aria-label="Coluna lateral direita"></footer></div>`;
  setupSharedSideMenu(currentUser);
  const { data: review, error } = await supabase.from('reviews')
    .select('id, user_id, body, created_at, profiles!reviews_user_id_fkey(username, display_name), games!reviews_game_id_fkey(title, cover_url, release_year)')
    .eq('id', reviewId).maybeSingle();
  if (requestId !== renderReviewReportPage.requestId) return;
  const content = app.querySelector('.profile-page__content');
  if (error || !review || review.user_id === currentUser.id) {
    content.innerHTML = '<section class="review-report-page"><h1>Não é possível denunciar esta avaliação</h1><p>A avaliação não foi encontrada ou não está disponível para denúncia.</p><button type="button" class="review-report-page__back" data-report-back>Voltar</button></section>';
    content.querySelector('[data-report-back]')?.addEventListener('click', () => navigateToFeed(currentUser));
    return;
  }
  const game = review.games || {};
  const author = review.profiles?.username || 'jogador';
  const cover = game.cover_url
    ? '<img class="review-report-page__cover" src="' + escapeHTML(game.cover_url) + '" alt="">'
    : '<span class="review-report-page__cover review-report-page__cover--empty" aria-hidden="true"><i class="fa-solid fa-gamepad"></i></span>';
  content.innerHTML = '<section class="review-report-page" aria-labelledby="review-report-title">' +
    '<button type="button" class="review-report-page__back" data-report-back><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>Voltar à avaliação</span></button>' +
    '<header class="review-report-page__heading"><span class="review-report-page__eyebrow">SEGURANÇA DA COMUNIDADE</span><h1 id="review-report-title">Denunciar avaliação</h1><p>Conte o que há de errado com esta publicação. Sua denúncia será analisada pela equipe do Ludus.</p></header>' +
    '<article class="review-report-page__context">' + cover + '<div class="review-report-page__context-copy"><strong>' + escapeHTML(game.title || 'Jogo') + (game.release_year ? ' (' + escapeHTML(game.release_year) + ')' : '') + '</strong><span>Avaliação de ' + escapeHTML(author) + '</span>' + (review.body ? '<p>' + escapeHTML(review.body.length > 180 ? review.body.slice(0, 180) + '…' : review.body) + '</p>' : '') + '</div></article>' +
    '<form id="review-report-form" class="review-report-page__form" data-review-report-form>' +
    '<fieldset><legend>Por que você está denunciando esta avaliação?</legend><p class="review-report-page__hint">Selecione o motivo que melhor descreve o problema.</p>' +
    '<label class="review-report-page__option"><input type="radio" name="report-reason" value="spam" required><span><strong>Spam</strong><small>Publicidade, conteúdo repetitivo ou enganoso.</small></span></label>' +
    '<label class="review-report-page__option"><input type="radio" name="report-reason" value="harassment"><span><strong>Assédio ou discurso de ódio</strong><small>Ataques, ameaças ou discriminação.</small></span></label>' +
    '<label class="review-report-page__option"><input type="radio" name="report-reason" value="spoiler"><span><strong>Spoiler sem aviso</strong><small>Revelações importantes sem sinalização.</small></span></label>' +
    '<label class="review-report-page__option"><input type="radio" name="report-reason" value="inappropriate"><span><strong>Conteúdo impróprio</strong><small>Conteúdo ofensivo ou inadequado.</small></span></label>' +
    '<label class="review-report-page__option"><input type="radio" name="report-reason" value="other"><span><strong>Outro motivo</strong><small>O problema não se encaixa nas opções acima.</small></span></label></fieldset>' +
    '<label class="review-report-page__details-label" for="review-report-details">Detalhes adicionais <span>(opcional)</span></label><textarea id="review-report-details" name="details" rows="4" maxlength="1000" placeholder="Explique melhor o que aconteceu…"></textarea>' +
    '<p class="review-report-page__feedback" data-report-feedback role="status" aria-live="polite" hidden></p>' +
    '</form>' +
    '<div class="review-report-page__actions" data-report-actions><button type="button" class="review-report-page__cancel" data-report-back>Cancelar</button><button type="submit" form="review-report-form" class="review-report-page__submit"><i class="fa-solid fa-flag" aria-hidden="true"></i><span>Enviar denúncia</span></button></div>' +
    '</section>';
  content.querySelectorAll('[data-report-back]').forEach((button) => button.addEventListener('click', () => navigateToReview(currentUser, review.id)));
  const form = content.querySelector('[data-review-report-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const reason = form.querySelector('input[name="report-reason"]:checked')?.value;
    const feedback = form.querySelector('[data-report-feedback]');
    const submit = content.querySelector('.review-report-page__submit');
    if (!reason) {
      feedback.textContent = 'Selecione um motivo para continuar.';
      feedback.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Enviando…';
    feedback.hidden = true;
    const details = form.querySelector('[name="details"]').value.trim().slice(0, 1000);
    const { error: reportError } = await supabase.from('review_reports').insert({
      reporter_id: currentUser.id, review_id: review.id, reason, details
    });
    if (reportError) {
      console.error('[Ludus] Falha ao denunciar avaliação:', reportError);
      feedback.textContent = reportError.code === '23505'
        ? 'Você já enviou uma denúncia para esta avaliação.'
        : 'Não foi possível enviar a denúncia. Tente novamente.';
      feedback.dataset.type = 'error';
      feedback.hidden = false;
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Enviar denúncia';
      return;
    }
    content.querySelector('[data-report-actions]')?.setAttribute('hidden', '');
    form.innerHTML = '<div class="review-report-page__success"><span class="review-report-page__success-icon"><i class="fa-solid fa-check" aria-hidden="true"></i></span><h2>Denúncia enviada</h2><p>Obrigado por ajudar a manter a comunidade segura. Nossa equipe irá analisar esta avaliação.</p><button type="button" data-report-done>Voltar à avaliação</button></div>';
    form.querySelector('[data-report-done]')?.addEventListener('click', () => navigateToReview(currentUser, review.id));
  });
}

async function renderReviewPage(currentUser, reviewId) {
  const requestId = (renderReviewPage.requestId || 0) + 1;
  renderReviewPage.requestId = requestId;
  app.innerHTML = `<div class="feed-shell">${sharedSideMenuMarkup(currentUser)}<main class="feed-center-column feed-main profile-main">${sharedFeedHeaderMarkup()}<div class="feed-main__container"><div class="profile-page__content"><div class="profile-page__loading">Carregando avaliação…</div></div></div></main><footer class="side-menu side-menu--right" aria-label="Coluna lateral direita"></footer></div>`;
  setupSharedSideMenu(currentUser);
  const { data: review, error } = await supabase.from('reviews')
    .select('id, user_id, game_id, rating, body, status, liked_game, created_at, profiles!reviews_user_id_fkey(username, display_name, avatar_url), games!reviews_game_id_fkey(title, cover_url, release_year, developer)')
    .eq('id', reviewId).maybeSingle();
  if (requestId !== renderReviewPage.requestId) return;
  const content = app.querySelector('.profile-page__content');
  if (error || !review) { content.innerHTML = '<div class="profile-page__empty"><h1>Não encontramos esta avaliação.</h1></div>'; return; }
  const game = review.games || {}, profile = review.profiles || {};
  const avatar = profile.avatar_url ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">' : profilePlaceholderMarkup();
  const { data: comments, error: commentsError } = await fetchAllPages(() =>
    supabase.from('review_comments')
      .select('id, user_id, body, created_at, parent_comment_id, profiles!review_comments_user_id_fkey(username, display_name, avatar_url)')
      .eq('review_id', review.id).order('created_at', { ascending: true })
  );
  if (requestId !== renderReviewPage.requestId) return;
  const commentRows = comments || [];
  const { data: commentLikes, error: commentLikesError } = await fetchCommentLikeRows(commentRows.map((comment) => comment.id));
  if (commentLikesError) console.error('[Ludus] Falha ao carregar curtidas dos comentários:', commentLikesError);
  const childrenByParent = new Map();
  commentRows.forEach((comment) => {
    const key = comment.parent_comment_id || '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(comment);
  });
  childrenByParent.forEach((items) => items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
  const commentsMarkup = commentsError ? '<p class="review-comments__empty">Não foi possível carregar os comentários.</p>' :
    (childrenByParent.get('') || []).map((comment) =>
      renderReviewCommentMarkup(comment, currentUser, commentLikes || [], childrenByParent)
    ).join('') || '<p class="review-comments__empty">Ainda não há comentários. Comece a conversa.</p>';
  content.innerHTML = '<article class="review-detail"><div class="review-detail__main">' +
    (game.cover_url ? '<button class="review-detail__cover" type="button" data-detail-game="' + escapeHTML(review.game_id) + '"><img src="' + escapeHTML(game.cover_url) + '" alt="Capa de ' + escapeHTML(game.title || 'jogo') + '"></button>' : '') +
    '<div class="review-detail__content"><div class="review-detail__author"><span class="review-detail__avatar">' + avatar + '</span><div><strong>' + escapeHTML(profile.username || 'jogador') + '</strong><small>' + escapeHTML(profile.username || '') + ' · ' + formatDate(review.created_at) + '</small></div></div>' +
    '<h1>' + escapeHTML(game.title || 'Jogo') + (game.release_year ? ' <small>' + escapeHTML(game.release_year) + '</small>' : '') + '</h1><div class="review-detail__rating">' + '★'.repeat(review.rating) + '☆'.repeat(5-review.rating) + '</div><div class="review-detail__status">' + escapeHTML(statusLabel(review.status)) + (review.liked_game ? ' · Gostei deste jogo' : '') + '</div>' +
    (review.body ? '<p class="review-detail__body">' + escapeHTML(review.body) + '</p>' : '') + '</div></div><section class="review-detail__discussion"><header class="review-detail__discussion-header"><div><h2>Discussão</h2><p>Converse sobre esta avaliação</p></div><span class="review-detail__discussion-count">' + commentRows.length + (commentRows.length === 1 ? ' comentário' : ' comentários') + '</span></header><div class="review-detail__comments">' + commentsMarkup + '</div><form class="review-detail__form" data-detail-comment-form><span class="review-detail__composer-avatar">' + avatar + '</span><div class="review-detail__composer-content"><textarea rows="3" maxlength="1000" placeholder="Compartilhe sua opinião…" required></textarea><div class="review-detail__composer-footer"><span>Até 1.000 caracteres</span><button type="submit"><span>Comentar</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button></div></div></form></section></article>';
  content.querySelector('[data-detail-game]')?.addEventListener('click', () => navigateToGame(currentUser, review.game_id));
  content.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-detail-comment-form], [data-reply-form], [data-edit-comment-form]');
    if (!form) return;
    event.preventDefault();
    const textarea = form.querySelector('textarea');
    const submit = form.querySelector('button[type="submit"]');
    const body = textarea.value.trim();
    if (!body) return;
    submit.disabled = true;
    let result;
    if (form.matches('[data-edit-comment-form]')) {
      const comment = form.closest('[data-comment-id]');
      result = await supabase.from('review_comments').update({ body }).eq('id', comment?.dataset.commentId).eq('user_id', currentUser.id);
    } else {
      result = await supabase.from('review_comments').insert({
        review_id: review.id, user_id: currentUser.id, body, parent_comment_id: form.dataset.parentCommentId || null
      });
    }
    if (result.error) { console.error('[Ludus] Falha ao salvar comentário:', result.error); submit.disabled = false; return; }
    await renderReviewPage(currentUser, reviewId);
  });
  content.addEventListener('click', async (event) => {
    const replyButton = event.target.closest('[data-reply-comment]');
    if (replyButton) {
      const form = replyButton.closest('[data-comment-id]')?.querySelector('[data-reply-form]');
      if (form) { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('textarea')?.focus(); }
      return;
    }
    const repliesToggle = event.target.closest('[data-toggle-replies]');
    if (repliesToggle) {
      const comment = repliesToggle.closest('[data-comment-id]');
      const replies = comment?.querySelector(':scope > .review-comment__replies');
      if (replies) {
        replies.hidden = !replies.hidden;
        repliesToggle.setAttribute('aria-expanded', String(!replies.hidden));
        repliesToggle.querySelector('span').textContent = (replies.hidden ? 'Exibir respostas (' : 'Ocultar respostas (') + repliesToggle.dataset.replyCount + ')';
      }
      return;
    }
    const cancelEdit = event.target.closest('[data-cancel-edit]');
    if (cancelEdit) {
      const comment = cancelEdit.closest('[data-comment-id]');
      const form = comment?.querySelector('[data-edit-comment-form]');
      if (form) { form.hidden = true; comment.querySelector('.review-comment__body').hidden = false; }
      return;
    }
    const likeButton = event.target.closest('[data-like-comment]');
    if (likeButton) {
      const commentId = likeButton.closest('[data-comment-id]')?.dataset.commentId;
      const liked = likeButton.getAttribute('aria-pressed') === 'true';
      const result = liked
        ? await supabase.from('review_comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id)
        : await supabase.from('review_comment_likes').insert({ comment_id: commentId, user_id: currentUser.id });
      if (!result.error) await renderReviewPage(currentUser, reviewId);
      else console.error('[Ludus] Falha ao curtir comentário:', result.error);
      return;
    }
    const actionButton = event.target.closest('[data-comment-action]');
    if (!actionButton) return;
    const comment = actionButton.closest('[data-comment-id]');
    const menu = actionButton.closest('.review-comment__menu');
    const action = actionButton.dataset.commentAction;
    if (menu) menu.open = false;
    if (action === 'edit') {
      const form = comment.querySelector('[data-edit-comment-form]');
      form.hidden = false;
      comment.querySelector('.review-comment__body').hidden = true;
      form.querySelector('textarea')?.focus();
    } else if (action === 'delete') {
      if (!window.confirm('Excluir este comentário e suas respostas?')) return;
      const { error: deleteError } = await supabase.from('review_comments').delete().eq('id', comment.dataset.commentId).eq('user_id', currentUser.id);
      if (deleteError) { window.alert('Não foi possível excluir o comentário.'); return; }
      await renderReviewPage(currentUser, reviewId);
    } else if (action === 'report') {
      const reason = window.prompt('Motivo da denúncia:\\n1 — Spam\\n2 — Assédio ou discurso de ódio\\n3 — Spoiler sem aviso\\n4 — Conteúdo impróprio\\n5 — Outro');
      if (reason === null) return;
      const reasons = { '1':'spam', '2':'harassment', '3':'spoiler', '4':'inappropriate', '5':'other' };
      if (!reasons[reason.trim()]) { window.alert('Escolha uma opção de 1 a 5.'); return; }
      const details = window.prompt('Detalhes adicionais (opcional):') || '';
      const { error: reportError } = await supabase.from('comment_reports').insert({
        comment_id: comment.dataset.commentId, reporter_id: currentUser.id, reason: reasons[reason.trim()], details: details.slice(0,1000)
      });
      if (reportError) window.alert(reportError.code === '23505' ? 'Você já denunciou este comentário.' : 'Não foi possível enviar a denúncia.');
      else window.alert('Denúncia enviada. Obrigado por ajudar a manter a comunidade segura.');
    }
  });
}

function navigateToGame(currentUser, gameId) {
  if (!gameId) return;
  const nextHash = '#/jogo/' + encodeURIComponent(gameId);
  if (window.location.hash !== nextHash) {
    window.history.pushState({ page: 'game', gameId }, '', nextHash);
  }
  renderGamePage(currentUser, gameId);
  triggerPageTransition();
}

async function renderGamePage(currentUser, gameId) {
  const requestId = (renderGamePage.requestId || 0) + 1;
  renderGamePage.requestId = requestId;
  app.innerHTML = `
    <div class="feed-shell">
      ${sharedSideMenuMarkup(currentUser)}
      <main class="feed-center-column feed-main profile-main">
        <div class="app-topbar app-topbar__content">
          <nav class="feed-navigation feed-navigation--header" aria-label="Navegação do perfil">
            <div class="feed-tabs">
              <span class="feed-tabs__button is-active">Seguidores</span>
              <span class="feed-tabs__button">Seguindo</span>
            </div>
          </nav>
        </div>
        <div class="feed-main__container">
          <div class="profile-page__content">
            <div class="profile-page__loading">Carregando jogo…</div>
          </div>
        </div>
      </main>
      <footer class="side-menu side-menu--right" aria-label="Coluna lateral direita"></footer>
    </div>`;
  setupSharedSideMenu(currentUser);

  const { data: game, error } = await supabase.from('games')
    .select('id, steamgriddb_id, title, cover_url, hero_url, release_year, developer, description, platforms, genres')
    .eq('id', gameId).maybeSingle();
  if (requestId !== renderGamePage.requestId) return;
  const content = app.querySelector('.profile-page__content');
  if (error || !game) {
    content.innerHTML = '<div class="profile-page__empty"><p class="eyebrow">JOGO INDISPONÍVEL</p><h1>Não encontramos este jogo no catálogo.</h1><button type="button" class="profile-page__back" data-game-back>← Voltar ao feed</button></div>';
    content.querySelector('[data-game-back]')?.addEventListener('click', () => navigateToFeed(currentUser));
    return;
  }

  const [ownReviewResult, reviewsResult] = await Promise.all([
    supabase.from('reviews').select('id, game_id, rating, body, status, liked_game, games!reviews_game_id_fkey(title, cover_url, release_year)')
      .eq('user_id', currentUser.id).eq('game_id', game.id).maybeSingle(),
    supabase.from('reviews')
      .select('id, rating, body, status, liked_game, created_at, profiles!reviews_user_id_fkey(username, display_name, avatar_url)')
      .eq('game_id', game.id).order('created_at', { ascending: false }).limit(30)
  ]);
  if (requestId !== renderGamePage.requestId) return;

  const bannerStyle = game.hero_url
    ? 'style="background-image:url(&quot;' + escapeHTML(game.hero_url) + '&quot;)"'
    : '';
  const cover = game.cover_url
    ? '<img class="game-page__cover" src="' + escapeHTML(game.cover_url) + '" alt="">'
    : '<div class="game-page__cover game-page__cover--empty">Sem capa</div>';
  const genres = (game.genres || []).slice(0, 5).map((item) => '<span>' + escapeHTML(item) + '</span>').join('');
  const platforms = (game.platforms || []).slice(0, 5).map((item) => '<span>' + escapeHTML(item) + '</span>').join('');
  const reviewCards = (reviewsResult.data || []).map((review) => {
    const profile = review.profiles || {};
    const author = profile.username || 'jogador';
    const avatar = profile.avatar_url
      ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">'
      : '<span class="game-page__review-avatar">' + profilePlaceholderMarkup() + '</span>';
    return '<article class="game-page__review">' + avatar + '<div class="game-page__review-content"><div class="game-page__review-heading"><strong>' + escapeHTML(author) + '</strong><span>' + '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating) + '</span></div><div class="game-page__review-meta">' + statusLabel(review.status) + ' · ' + formatDate(review.created_at) + '</div>' + (review.body ? '<p>' + escapeHTML(review.body) + '</p>' : '') + '</div></article>';
  }).join('');

  content.innerHTML =
    '<section class="game-page__hero"><div class="game-page__backdrop" ' + bannerStyle + '></div><div class="game-page__identity">' + cover +
    '<div class="game-page__details"><p class="eyebrow">JOGO DO CATÁLOGO LUDUS</p><h1>' + escapeHTML(game.title) + '</h1>' +
    '<p class="game-page__subline">' + [game.release_year, game.developer].filter(Boolean).map(escapeHTML).join(' · ') + '</p>' +
    (genres ? '<div class="game-page__tags">' + genres + '</div>' : '') +
    (platforms ? '<div class="game-page__platforms">' + platforms + '</div>' : '') +
    '<button class="game-page__rate" type="button" data-rate-game>' + (ownReviewResult.data ? 'Editar minha avaliação' : 'Avaliar este jogo') + ' ↗</button></div></div>' +
    (game.description ? '<p class="game-page__description">' + escapeHTML(game.description) + '</p>' : '') +
    '</section>' +
    '<section class="profile-page__reviews game-page__reviews"><div class="profile-page__section-heading"><div><p class="eyebrow">COMUNIDADE LUDUS</p><h2>Avaliações</h2></div><span>' + (reviewsResult.data || []).length.toString().padStart(2, '0') + '</span></div>' +
    (reviewsResult.error ? '<p class="profile-page__empty">Não foi possível carregar as avaliações.</p>' : reviewCards || '<p class="profile-page__empty">Este jogo ainda não recebeu avaliações. Seja o primeiro!</p>') + '</section>';

  app.querySelector('[data-rate-game]')?.addEventListener('click', () => {
    openReviewComposer(currentUser, ownReviewResult.data || null, game);
  });
}

function navigateToProfile(currentUser, username) {
  if (!username) return;
  const nextHash = '#/perfil/' + encodeURIComponent(username);
  if (window.location.hash !== nextHash) {
    window.history.pushState({ page: 'profile' }, '', nextHash);
  }
  renderProfilePage(currentUser, username);
  triggerPageTransition();
}

function navigateToSearch(currentUser, query = '') {
  const nextHash = '#/buscar';
  if (window.location.hash !== nextHash) window.history.pushState({ page: 'search' }, '', nextHash);
  renderSearchPage(currentUser, query);
  triggerPageTransition();
}

async function renderSearchPage(currentUser, initialQuery = '') {
  const requestId = (renderSearchPage.requestId || 0) + 1;
  renderSearchPage.requestId = requestId;
  app.innerHTML = `
    <div class="feed-shell">
      ${sharedSideMenuMarkup(currentUser)}
      <main class="feed-center-column feed-main profile-main">
        <div class="app-topbar app-topbar__content search-topbar">
          <form class="search-page__form" role="search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m15.8 15.8 5 5"/></svg>
            <input class="search-page__input" type="search" name="q" placeholder="Buscar jogos ou jogadores..." autocomplete="off" aria-label="Buscar jogos ou jogadores">
          </form>
        </div>
        <div class="feed-main__container search-page__container">
          <section class="search-page__results" aria-live="polite"></section>
        </div>
      </main>
      <footer class="side-menu side-menu--right" aria-label="Coluna lateral direita"></footer>
    </div>`;
  setupSharedSideMenu(currentUser);
  const form = app.querySelector('.search-page__form');
  const input = form?.querySelector('input');
  const results = app.querySelector('.search-page__results');
  if (!input || !results) return;
  input.value = initialQuery;
  let timer = null;
  let sequence = 0;
  const runSearch = async () => {
    const query = input.value.trim();
    const currentSequence = ++sequence;
    if (query.length < 2) { results.innerHTML = ''; return; }
    results.innerHTML = '<p class="search-page__status">Buscando...</p>';
    const safeQuery = query.replace(/[%,()]/g, ' ').trim();
    const [usersResult, gamesResult] = await Promise.all([
      supabase.from('profiles').select('username, display_name, avatar_url, bio')
        .ilike('username', '%' + safeQuery + '%').limit(8),
      supabase.functions.invoke('steamgriddb', { body: { action: 'search', query } })
    ]);
    if (currentSequence !== sequence || input.value.trim() !== query) return;
    const users = usersResult.data || [];
    const games = gamesResult.data?.data || [];
    const userMarkup = users.map((profile) => {
      const avatar = profile.avatar_url
        ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">'
        : profilePlaceholderMarkup();
      return '<button class="search-result search-result--user" type="button" data-search-username="' + escapeHTML(profile.username) + '">' +
        '<span class="search-result__avatar">' + avatar + '</span><span class="search-result__info"><strong>' + escapeHTML(profile.username) + '</strong><small>@' + escapeHTML(profile.username) + '</small></span></button>';
    }).join('');
    const gameMarkup = games.slice(0, 12).map((game) => {
      const date = Number(game.release_date);
      const year = Number.isFinite(date) && date > 0 ? new Date(date * 1000).getUTCFullYear() : null;
      return '<button class="search-result search-result--game" type="button" data-search-game-id="' + Number(game.id) + '" data-search-game-name="' + escapeHTML(game.name) + '" data-search-game-year="' + (year || '') + '">' +
        '<span class="search-result__info"><strong>' + escapeHTML(game.name) + '</strong><small>' + (year || 'Ano não informado') + '</small></span></button>';
    }).join('');
    results.innerHTML = (userMarkup ? '<div class="search-results-group">' + userMarkup + '</div>' : '') +
      (gameMarkup ? '<div class="search-results-group">' + gameMarkup + '</div>' : '') +
      (!userMarkup && !gameMarkup ? '<p class="search-page__status">Nenhum resultado encontrado.</p>' : '');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 300);
  });
  form.addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(timer); runSearch(); });
  results.addEventListener('click', async (event) => {
    const userButton = event.target.closest('[data-search-username]');
    if (userButton) { navigateToProfile(currentUser, userButton.dataset.searchUsername); return; }
    const gameButton = event.target.closest('[data-search-game-id]');
    if (!gameButton) return;
    results.innerHTML = '<p class="search-page__status">Abrindo jogo...</p>';
    const { data, error } = await supabase.functions.invoke('steamgriddb', {
      body: { action: 'save', game: { id: Number(gameButton.dataset.searchGameId), name: gameButton.dataset.searchGameName, release_year: Number(gameButton.dataset.searchGameYear) || null } }
    });
    if (error || data?.error || !data?.game) {
      results.innerHTML = '<p class="search-page__status">Não foi possível abrir este jogo.</p>';
      return;
    }
    navigateToGame(currentUser, data.game.id);
  });
  if (initialQuery.trim()) runSearch();
  else input.focus();
}

function navigateToNotifications(currentUser) {
  const nextHash = '#/notificacoes';
  if (window.location.hash !== nextHash) window.history.pushState({ page: 'notifications' }, '', nextHash);
  renderNotificationsPage(currentUser);
  triggerPageTransition();
}

function renderNotificationsPage(currentUser) {
  app.innerHTML = `
    <div class="feed-shell notifications-page">
      <main class="feed-center-column feed-main notifications-page__main">
        ${sharedHeaderMarkup({ action: 'back', showBrand: false })}
        <section class="notifications-page__content">
          <div class="notifications-page__heading">
            <div class="notifications-page__title-group">
              <h1>Notificações</h1>
              <p>Acompanhe as novidades e interações da comunidade.</p>
            </div>
            <button type="button" class="notifications-page__read-all" data-notifications-read-all>Marcar todas como lidas</button>
          </div>
          <div class="notifications notifications-page__list" data-notifications>
            <div class="notifications__list" data-notifications-list><p class="notifications__empty">Carregando…</p></div>
          </div>
        </section>
      </main>
    </div>`;

  app.querySelector('[data-header-back]')?.addEventListener('click', () => navigateToFeed(currentUser));
  setupNotifications(currentUser);
}

function navigateToFeed(currentUser, mode = 'home') {
  if (window.location.hash !== '#inicio') {
    window.history.pushState({ page: 'feed' }, '', '#inicio');
  }
  renderSignedIn(currentUser, mode);
  triggerPageTransition();
}

function openFavoriteGamePicker(onSelect, excludedGameIds = []) {
  const existing = app.querySelector('.favorite-picker-overlay');
  existing?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'composer-overlay favorite-picker-overlay';
  overlay.innerHTML = '<section class="composer" role="dialog" aria-modal="true" aria-labelledby="favorite-picker-title">' +
    '<button class="composer__close" type="button" aria-label="Fechar" data-close>×</button>' +
    '<h2 id="favorite-picker-title">Adicionar jogo favorito</h2>' +
    '<input class="composer__search" type="search" placeholder="Buscar pelo nome do jogo…" autocomplete="off" data-favorite-search>' +
    '<div class="composer__results" data-favorite-results aria-live="polite"></div>' +
    '<p class="composer__message" data-favorite-message role="status"></p></section>';
  app.append(overlay);
  const search = overlay.querySelector('[data-favorite-search]');
  const results = overlay.querySelector('[data-favorite-results]');
  const message = overlay.querySelector('[data-favorite-message]');
  let timer = null;
  let busy = false;
  const close = () => overlay.remove();
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    const query = search.value.trim();
    if (query.length < 2) { results.innerHTML = ''; return; }
    results.innerHTML = '<p class="composer__hint">Buscando jogos…</p>';
    timer = window.setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('steamgriddb', { body: { action: 'search', query } });
      if (search.value.trim() !== query) return;
      if (error || data?.error) { results.innerHTML = '<p class="composer__hint">Não foi possível buscar jogos.</p>'; return; }
      const games = (data?.data || []).filter((game) => !excludedGameIds.includes(String(game.id)));
      results.innerHTML = games.length ? games.map((game) => {
        const releaseDate = Number(game.release_date);
        const releaseYear = Number.isFinite(releaseDate) && releaseDate > 0 ? new Date(releaseDate * 1000).getUTCFullYear() : null;
        return '<button class="composer__result" type="button" data-game-id="' + Number(game.id) + '" data-game-name="' + escapeHTML(game.name) + '" data-game-year="' + (releaseYear || '') + '">' +
          '<span class="composer__result-info"><strong>' + escapeHTML(game.name) + '</strong><small>(' + (releaseYear || 'Ano não informado') + ')</small></span><span>Selecionar ↗</span></button>';
      }).join('') : '<p class="composer__hint">Nenhum jogo encontrado.</p>';
    }, 350);
  });
  results.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-game-id]');
    if (!button || busy) return;
    busy = true; button.disabled = true; message.textContent = 'Adicionando jogo…';
    const { data, error } = await supabase.functions.invoke('steamgriddb', { body: { action: 'save', game: { id: Number(button.dataset.gameId), name: button.dataset.gameName, release_year: Number(button.dataset.gameYear) || null } } });
    if (error || data?.error || !data?.game) { message.textContent = data?.error || 'Não foi possível adicionar este jogo.'; button.disabled = false; busy = false; return; }
    const saved = await onSelect(data.game);
    if (saved) close(); else { message.textContent = 'Não foi possível salvar o jogo no perfil.'; button.disabled = false; busy = false; }
  });
  search.focus();
}
function openGameListCreator(user, onCreated) {
  const existing = app.querySelector('.game-list-creator-overlay');
  existing?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'composer-overlay game-list-creator-overlay';
  overlay.innerHTML = '<section class="composer game-list-creator" role="dialog" aria-modal="true" aria-labelledby="game-list-creator-title">' +
    '<button class="composer__close" type="button" aria-label="Fechar" data-close>×</button>' +
    '<h2 id="game-list-creator-title">Criar lista</h2>' +
    '<form data-game-list-form>' +
    '<label class="game-list-creator__field"><span>Nome da lista</span><input name="name" type="text" maxlength="60" required placeholder="Ex.: Jogos para zerar"></label>' +
    '<label class="game-list-creator__field"><span>Descrição (opcional)</span><textarea name="description" rows="2" maxlength="240" placeholder="Sobre esta lista…"></textarea></label>' +
    '<label class="game-list-creator__field"><span>Adicionar jogos</span><input class="composer__search" type="search" placeholder="Buscar pelo nome do jogo…" autocomplete="off" data-list-game-search></label>' +
    '<div class="composer__results" data-list-game-results aria-live="polite"></div>' +
    '<div class="game-list-creator__selected" data-list-game-selected></div>' +
    '<p class="composer__message" data-list-message role="status"></p>' +
    '<div class="game-list-creator__actions"><button class="btn btn-default" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" data-list-save>Salvar lista</button></div>' +
    '</form></section>';
  app.append(overlay);
  const form = overlay.querySelector('[data-game-list-form]');
  const search = overlay.querySelector('[data-list-game-search]');
  const results = overlay.querySelector('[data-list-game-results]');
  const selectedContainer = overlay.querySelector('[data-list-game-selected]');
  const message = overlay.querySelector('[data-list-message]');
  const saveButton = overlay.querySelector('[data-list-save]');
  const selectedGames = [];
  let timer = null;
  let busy = false;
  const close = () => { window.clearTimeout(timer); overlay.remove(); };
  overlay.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  const renderSelected = () => {
    selectedContainer.innerHTML = selectedGames.map((game) =>
      '<span class="game-list-creator__selected-item">' + escapeHTML(game.name) +
      '<button type="button" data-remove-list-game="' + game.id + '" aria-label="Remover ' + escapeHTML(game.name) + '">×</button></span>'
    ).join('');
  };
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    const query = search.value.trim();
    if (query.length < 2) { results.innerHTML = ''; return; }
    results.innerHTML = '<p class="composer__hint">Buscando jogos…</p>';
    timer = window.setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('steamgriddb', { body: { action: 'search', query } });
      if (search.value.trim() !== query) return;
      if (error || data?.error) { results.innerHTML = '<p class="composer__hint">Não foi possível buscar jogos.</p>'; return; }
      const games = (data?.data || []).filter((game) => !selectedGames.some((selected) => String(selected.id) === String(game.id)));
      results.innerHTML = games.length ? games.map((game) => {
        const timestamp = Number(game.release_date);
        const year = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).getUTCFullYear() : null;
        return '<button class="composer__result" type="button" data-select-list-game="' + Number(game.id) + '" data-game-name="' + escapeHTML(game.name) + '" data-game-year="' + (year || '') + '">' +
          '<span class="composer__result-info"><strong>' + escapeHTML(game.name) + '</strong><small>(' + (year || 'Ano não informado') + ')</small></span><span>Adicionar +</span></button>';
      }).join('') : '<p class="composer__hint">Nenhum jogo encontrado.</p>';
    }, 350);
  });
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-select-list-game]');
    if (!button) return;
    const id = button.dataset.selectListGame;
    if (selectedGames.some((game) => String(game.id) === id)) return;
    selectedGames.push({ id: Number(id), name: button.dataset.gameName, release_year: Number(button.dataset.gameYear) || null });
    renderSelected();
    search.dispatchEvent(new Event('input'));
  });
  selectedContainer.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-list-game]');
    if (!button) return;
    const index = selectedGames.findIndex((game) => String(game.id) === button.dataset.removeListGame);
    if (index >= 0) selectedGames.splice(index, 1);
    renderSelected();
    search.dispatchEvent(new Event('input'));
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const name = form.elements.name.value.trim();
    const description = form.elements.description.value.trim();
    if (!name) return;
    busy = true;
    saveButton.disabled = true;
    message.textContent = 'Salvando lista…';
    const { data: list, error: listError } = await supabase.from('game_lists')
      .insert({ user_id: user.id, name, description: description || null, is_public: true, is_default: false })
      .select('id, name, description, is_default, created_at').single();
    if (listError || !list) {
      console.error('[Ludus] Falha ao criar lista:', listError);
      message.textContent = 'Não foi possível criar a lista. Tente novamente.';
      saveButton.disabled = false;
      busy = false;
      return;
    }
    const savedGames = [];
    for (const game of selectedGames) {
      const { data, error } = await supabase.functions.invoke('steamgriddb', {
        body: { action: 'save', game: { id: game.id, name: game.name, release_year: game.release_year } }
      });
      if (error || data?.error || !data?.game) {
        console.error('[Ludus] Falha ao salvar jogo da lista:', error || data?.error);
        await supabase.from('game_lists').delete().eq('id', list.id).eq('user_id', user.id);
        message.textContent = 'Não foi possível salvar os jogos. A lista não foi criada.';
        saveButton.disabled = false;
        busy = false;
        return;
      }
      savedGames.push(data.game);
    }
    if (savedGames.length) {
      const { error: itemsError } = await supabase.from('game_list_items').insert(savedGames.map((game, index) => ({
        list_id: list.id, game_id: game.id, position: index + 1
      })));
      if (itemsError) {
        console.error('[Ludus] Falha ao adicionar jogos à lista:', itemsError);
        await supabase.from('game_lists').delete().eq('id', list.id).eq('user_id', user.id);
        message.textContent = 'Não foi possível adicionar os jogos. A lista não foi criada.';
        saveButton.disabled = false;
        busy = false;
        return;
      }
    }
    onCreated({
      ...list,
      items: savedGames.map((game, index) => ({ id: 'new-' + index, position: index + 1, games: game }))
    });
    close();
  });
  search.focus();
}

async function renderProfilePage(currentUser, username) {
  const requestId = (renderProfilePage.requestId || 0) + 1;
  renderProfilePage.requestId = requestId;
  app.innerHTML = `
    <div class="feed-shell feed-shell--profile">
      ${sharedSideMenuMarkup(currentUser)}
      <main class="feed-center-column feed-main profile-main">
        <div class="feed-main__container">
          <div class="profile-page__content profile-page__content--full">
            <div class="profile-page__loading">Carregando perfil…</div>
          </div>
        </div>
      </main>
      <footer class="side-menu side-menu--right" aria-label="Coluna lateral direita"></footer>
    </div>`;
  setupSharedSideMenu(currentUser);

  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('id, username, display_name, bio, avatar_url, banner_url, created_at')
    .eq('username', username).maybeSingle();
  if (requestId !== renderProfilePage.requestId) return;
  if (profileError || !profile) {
    app.querySelector('.profile-page__content').innerHTML = '<div class="profile-page__empty"><h1>Não encontramos este jogador.</h1><button type="button" class="profile-page__back" data-profile-back>← Voltar ao feed</button></div>';
    app.querySelector('[data-profile-back]')?.addEventListener('click', () => navigateToFeed(currentUser));
    return;
  }

  const { data: favoriteRows, error: favoriteError } = await supabase.from('profile_favorite_games')
    .select('position, games(id, title, cover_url, release_year)')
    .eq('user_id', profile.id).order('position', { ascending: true });
  if (favoriteError) console.error('[Ludus] Falha ao carregar jogos favoritos:', favoriteError);

  const { data: createdLists, error: createdListsError } = await supabase.from('game_lists')
    .select('id, name, description, is_default, created_at, game_list_items(id, position, games(id, title, cover_url))')
    .eq('user_id', profile.id).eq('is_public', true).order('created_at', { ascending: false });
  if (createdListsError) console.error('[Ludus] Falha ao carregar listas públicas:', createdListsError);

  const { data: profileReviews, error: profileReviewsError } = await fetchAllPages(() =>
    supabase.from('reviews')
      .select('id, game_id, rating, body, status, liked_game, created_at, games!reviews_game_id_fkey(title, cover_url, release_year)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
  );
  if (profileReviewsError) console.error('[Ludus] Falha ao carregar avaliações do perfil:', profileReviewsError);

  const followState = currentUser.id === profile.id
    ? { data: null }
    : await supabase.from('follows').select('follower_id')
      .eq('follower_id', currentUser.id).eq('following_id', profile.id).maybeSingle();
  if (requestId !== renderProfilePage.requestId) return;
  let isFollowing = Boolean(followState.data);
  const [followingCountResult, followersCountResult, reviewsCountResult, createdListsCountResult] = await Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id),
    supabase.from('reviews').select('*', { count: 'exact', head: true }).eq('user_id', profile.id),
    supabase.from('game_lists').select('*', { count: 'exact', head: true }).eq('user_id', profile.id).eq('is_public', true)
  ]);
  if (requestId !== renderProfilePage.requestId) return;
  [
    ['seguindo', followingCountResult],
    ['seguidores', followersCountResult],
    ['avaliacoes', reviewsCountResult],
    ['listas', createdListsCountResult]
  ].forEach(([label, result]) => {
    if (result.error) console.error('[Ludus] Falha ao carregar contagem de ' + label + ':', result.error);
  });
  const displayName = profile.username;
  const avatar = profile.avatar_url
    ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">'
    : '<span>' + escapeHTML(displayName.trim().charAt(0).toUpperCase() || 'L') + '</span>';
  const banner = profile.banner_url
    ? '<img class="profile-page__banner-image" src="' + escapeHTML(profile.banner_url) + '" alt="">'
    : '<div class="profile-page__banner-empty"></div>';

  app.querySelector('.profile-page__content').innerHTML =
    '<section class="profile-page__hero"><button class="app-topbar__menu-button profile-page__back-button" type="button" data-profile-backtop aria-label="Voltar ao feed" title="Voltar ao feed"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button><div class="profile-page__banner">' + banner + '</div>' +
    '<div class="profile-page__avatar">' + avatar + '</div>' +
    '<div class="profile-page__identity"><div class="profile-page__heading"><h1>' + escapeHTML(displayName) + '</h1></div>' +
    (profile.id === currentUser.id
      ? '<button class="profile-edit-button" type="button" data-profile-edit>Editar Perfil</button>'
      : '<button class="profile-follow' + (isFollowing ? ' is-following' : '') + '" type="button" data-profile-follow>' + (isFollowing ? 'Seguindo' : 'Seguir') + '</button>') +
    '</div>' +
    (profile.bio?.trim() ? '<div class="profile-page__bio">' + escapeHTML(profile.bio.trim()) + '</div>' : '') +
    (profile.created_at ? '<div class="profile-page__joined"><i class="fa-regular fa-calendar" aria-hidden="true"></i><span>Membro desde ' + escapeHTML(new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(profile.created_at))) + '</span></div>' : '') +
    '<div class="profile-page__stats" aria-label="Estatísticas do perfil">' +
    '<span><strong data-profile-stat="following">' + (followingCountResult.count ?? 0) + '</strong><span>Seguindo</span></span>' +
    '<span><strong data-profile-stat="followers">' + (followersCountResult.count ?? 0) + '</strong><span>Seguidores</span></span>' +
    '<span><strong data-profile-stat="reviews">' + (reviewsCountResult.count ?? 0) + '</strong><span>Avaliações</span></span>' +
    '<span><strong data-profile-stat="lists">' + (createdListsCountResult.count ?? 0) + '</strong><span>Listas</span></span>' +
    '</div>' +
    '<section class="profile-page__favorites" aria-label="Jogos favoritos"><div class="profile-page__favorites-heading"><h2>Jogos favoritos</h2><div class="profile-page__favorites-actions" data-favorites-actions></div></div><div class="profile-page__favorites-list" data-profile-favorites></div></section>' +
    '<section class="profile-page__lists" aria-label="Listas criadas"><div class="profile-page__lists-heading"><h2>Listas criadas</h2><div class="profile-page__lists-heading-actions" data-lists-heading-actions></div></div><div class="profile-page__lists-grid" data-profile-created-lists></div></section>' +
    '<section class="profile-page__published-reviews" aria-label="Avaliações publicadas"><div class="profile-page__reviews-heading"><h2>Avaliações</h2><span>' + (profileReviews || []).length + '</span></div><div class="profile-page__published-reviews-list" data-profile-reviews></div></section>' +
    '</section>';

  app.querySelector('[data-profile-backtop]')?.addEventListener('click', () => navigateToFeed(currentUser));

  const openProfileImage = (image) => {
    const overlay = document.createElement('div');
    overlay.className = 'profile-image-viewer';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Visualização da imagem');
    overlay.innerHTML = '<button class="profile-image-viewer__close" type="button" aria-label="Fechar">×</button><img class="profile-image-viewer__image" src="' + escapeHTML(image.src) + '" alt="' + escapeHTML(image.alt || '') + '">';
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = previousOverflow;
    };
    const handleKeydown = (event) => { if (event.key === 'Escape') close(); };
    const previousOverflow = document.body.style.overflow;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('.profile-image-viewer__close')) close();
    });
    document.addEventListener('keydown', handleKeydown);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    overlay.querySelector('.profile-image-viewer__close').focus();
  };
  app.querySelector('.profile-page__avatar img')?.addEventListener('click', (event) => openProfileImage(event.currentTarget));
  app.querySelector('.profile-page__banner-image')?.addEventListener('click', (event) => openProfileImage(event.currentTarget));

  let favoriteGames = (favoriteRows || []).filter((row) => row.games).map((row) => ({ position: Number(row.position), game: row.games }));
  const favoritesList = app.querySelector('[data-profile-favorites]');
  const isOwnProfile = profile.id === currentUser.id;
  let editingFavoriteGames = false;
  const renderFavoriteGames = () => {
    if (!favoritesList) return;
    const slots = isOwnProfile && favoriteGames.length < 5
      ? [...favoriteGames, { empty: true }]
      : favoriteGames;
    favoritesList.innerHTML = slots.length ? slots.map((item) => item.empty
      ? '<button class="profile-page__favorite-slot" type="button" data-favorite-add aria-label="Adicionar jogo favorito"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>'
      : '<article class="profile-page__favorite" data-favorite-position="' + item.position + '">' +
        (item.game.cover_url ? '<img src="' + escapeHTML(item.game.cover_url) + '" alt="Capa de ' + escapeHTML(item.game.title) + '" loading="lazy">' : '<span class="profile-page__favorite-empty">Sem capa</span>') +
        (editingFavoriteGames ? '<div class="profile-page__favorite-actions"><button type="button" data-favorite-replace="' + item.position + '">Substituir</button><button type="button" data-favorite-remove="' + item.position + '">Remover</button></div>' : '') +
        '</article>').join('')
      : '<p class="profile-page__favorites-empty">Nenhum jogo favorito destacado.</p>';
    const actions = favoritesList.parentElement.querySelector('[data-favorites-actions]');
    if (actions) actions.innerHTML = isOwnProfile && favoriteGames.length
      ? '<button class="profile-page__icon-action" type="button" data-favorites-edit aria-label="' + (editingFavoriteGames ? 'Concluir edição dos favoritos' : 'Editar favoritos') + '" title="' + (editingFavoriteGames ? 'Concluir edição dos favoritos' : 'Editar favoritos') + '"><i class="fa-solid ' + (editingFavoriteGames ? 'fa-check' : 'fa-pen-to-square') + '" aria-hidden="true"></i></button>'
      : '';
    actions?.querySelector('[data-favorites-edit]')?.addEventListener('click', () => {
      editingFavoriteGames = !editingFavoriteGames;
      renderFavoriteGames();
    });
    favoritesList.querySelectorAll('[data-favorite-add]').forEach((button) => {
      button.addEventListener('click', () => {
        const usedIds = favoriteGames.map((item) => String(item.game.id));
        openFavoriteGamePicker(async (game) => {
          const position = [1, 2, 3, 4, 5].find((slot) => !favoriteGames.some((item) => item.position === slot));
          if (!position) return false;
          const { error } = await supabase.from('profile_favorite_games').insert({ user_id: currentUser.id, game_id: game.id, position });
          if (error) { console.error('[Ludus] Falha ao salvar jogo favorito:', error); return false; }
          favoriteGames.push({ position, game });
          renderFavoriteGames(); return true;
        }, usedIds);
      });
    });
    favoritesList.querySelectorAll('[data-favorite-replace]').forEach((button) => {
      button.addEventListener('click', () => {
        const position = Number(button.dataset.favoriteReplace);
        const usedIds = favoriteGames.filter((item) => item.position !== position).map((item) => String(item.game.id));
        openFavoriteGamePicker(async (game) => {
          const { error } = await supabase.from('profile_favorite_games').update({ game_id: game.id }).eq('user_id', currentUser.id).eq('position', position);
          if (error) { console.error('[Ludus] Falha ao substituir jogo favorito:', error); return false; }
          const favorite = favoriteGames.find((item) => item.position === position);
          if (favorite) favorite.game = game;
          renderFavoriteGames(); return true;
        }, usedIds);
      });
    });
    favoritesList.querySelectorAll('[data-favorite-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        const position = Number(button.dataset.favoriteRemove);
        button.disabled = true;
        const { error } = await supabase.from('profile_favorite_games').delete().eq('user_id', currentUser.id).eq('position', position);
        if (error) {
          console.error('[Ludus] Falha ao remover jogo favorito:', error);
          button.disabled = false;
          return;
        }
        favoriteGames = favoriteGames.filter((item) => item.position !== position);
        renderFavoriteGames();
      });
    });
  };
  renderFavoriteGames();

  const profileReviewsContainer = app.querySelector('[data-profile-reviews]');
  if (profileReviewsContainer) {
    const reviews = profileReviews || [];
    profileReviewsContainer.innerHTML = profileReviewsError
      ? '<p class="profile-page__reviews-empty">Não foi possível carregar as avaliações.</p>'
      : reviews.length
        ? reviews.map((review) => {
          const game = review.games || {};
          const gameTitle = game.title || 'Jogo';
          const cover = game.cover_url
            ? '<img src="' + escapeHTML(game.cover_url) + '" alt="Capa de ' + escapeHTML(gameTitle) + '" loading="lazy">'
            : '<span class="profile-page__published-review-cover-empty">Sem capa</span>';
          const rating = Number(review.rating || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          const date = review.created_at ? relativeTime(review.created_at) : '';
          const year = game.release_year ? ' <span class="profile-page__published-review-year">(' + escapeHTML(game.release_year) + ')</span>' : '';
          const body = review.body?.trim()
            ? '<p class="profile-page__published-review-text">' + escapeHTML(review.body.trim()) + '</p>'
            : '';
          const markers = (review.liked_game ? '<i class="fa-solid fa-heart" aria-label="Curtiu o jogo" title="Curtiu o jogo"></i>' : '') +
            (review.status === 'completed' ? '<i class="fa-solid fa-trophy" aria-label="Jogo zerado" title="Jogo zerado"></i>' : '');
          return '<a class="profile-page__published-review" href="#/review/' + encodeURIComponent(review.id) + '" aria-label="Abrir avaliação de ' + escapeHTML(gameTitle) + '">' +
            '<span class="profile-page__published-review-cover">' + cover + '</span>' +
            '<span class="profile-page__published-review-content">' +
              '<span class="profile-page__published-review-title">' + escapeHTML(gameTitle) + year + '</span>' +
              '<span class="profile-page__published-review-meta"><span class="profile-page__published-review-rating"><i class="fa-solid fa-star" aria-hidden="true"></i> ' + rating + '</span>' +
              (date ? '<time datetime="' + escapeHTML(review.created_at) + '">' + escapeHTML(date) + '</time>' : '') + markers + '</span>' +
              body +
            '</span></a>';
        }).join('')
        : '<p class="profile-page__reviews-empty">Este usuário ainda não publicou avaliações.</p>';
  }

  const createdListsContainer = app.querySelector('[data-profile-created-lists]');
  const publicLists = (createdLists || []).map((list) => ({
    ...list,
    items: [...(list.game_list_items || [])].sort((a, b) => (a.position || 0) - (b.position || 0))
  })).sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)));
  if (createdListsContainer) {
    let showAllLists = false;
    const renderCreatedLists = () => {
      const visibleLists = showAllLists ? publicLists : publicLists.slice(0, 5);
      const cards = visibleLists.map((list) => {
        const covers = list.items.filter((item) => item.games?.cover_url).slice(0, 4);
        const coverMarkup = covers.length
          ? covers.map((item) => '<img src="' + escapeHTML(item.games.cover_url) + '" alt="" loading="lazy">').join('')
          : '<span class="profile-page__list-cover-empty">Sem capas</span>';
        return '<article class="profile-page__list-card">' +
          '<div class="profile-page__list-covers">' + coverMarkup + '</div>' +
          '<div class="profile-page__list-info"><h3>' + escapeHTML(list.name) + '</h3>' +
          '<span>' + list.items.length + (list.items.length === 1 ? ' jogo' : ' jogos') + '</span>' +
          (list.description?.trim() ? '<p>' + escapeHTML(list.description.trim()) + '</p>' : '') +
          '</div></article>';
      }).join('');
      const action = publicLists.length > 5 && !showAllLists
        ? '<div class="profile-page__lists-actions"><button type="button" data-lists-view-more>Ver mais</button></div>'
        : '';
      createdListsContainer.innerHTML = (cards || '<p class="profile-page__lists-empty">Nenhuma lista pública criada.</p>') + action;
      const headingActions = app.querySelector('[data-lists-heading-actions]');
      if (headingActions) {
        headingActions.innerHTML = isOwnProfile && publicLists.length < 5
          ? '<button class="profile-page__icon-action" type="button" data-list-create aria-label="Criar lista" title="Criar lista"><i class="fa-solid fa-square-plus" aria-hidden="true"></i></button>'
          : '';
        headingActions.querySelector('[data-list-create]')?.addEventListener('click', () => {
          openGameListCreator(currentUser, async (createdList) => {
            publicLists.push(createdList);
            renderCreatedLists();
          });
        });
      }
      createdListsContainer.querySelector('[data-lists-view-more]')?.addEventListener('click', () => {
        showAllLists = true;
        renderCreatedLists();
      });
    };
    renderCreatedLists();
  }

  const editButton = app.querySelector('[data-profile-edit]');
  editButton?.addEventListener('click', () => openProfileEditor(currentUser, profile));

  const followButton = app.querySelector('[data-profile-follow]');
  if (followButton) {
    followButton.addEventListener('click', async () => {
      if (followButton.disabled) return;
      followButton.disabled = true;
      const result = isFollowing
        ? await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', profile.id)
        : await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: profile.id });
      if (result.error) {
        console.error('[Ludus] Falha ao atualizar relacionamento:', result.error);
        followButton.textContent = 'Tente novamente';
        followButton.disabled = false;
        return;
      }
      isFollowing = !isFollowing;
      const followersStat = app.querySelector('[data-profile-stat="followers"]');
      if (followersStat) followersStat.textContent = String(Math.max(0, Number(followersStat.textContent) + (isFollowing ? 1 : -1)));
      followButton.textContent = isFollowing ? 'Seguindo' : 'Seguir';
      followButton.classList.toggle('is-following', isFollowing);
      followButton.disabled = false;
    });
  }

}
async function openProfileEditor(user, profile) {
  const returnToProfile = window.location.hash.startsWith('#/perfil/');
  await renderSignedIn(user);
  const pageContainer = app.querySelector('.feed-main__container');
  if (!pageContainer) return;
  pageContainer.innerHTML = `
    <section class="profile-editor profile-editor--page" aria-labelledby="profile-editor-title">
      <button class="profile-editor__close" type="button" data-close aria-label="Fechar">×</button>
      <p class="eyebrow">SUA IDENTIDADE NO LUDUS</p>
      <h2 id="profile-editor-title">Editar perfil<span>.</span></h2>
      <form class="profile-editor__form" data-profile-form>
        <label class="profile-editor__field"><span>Nome de exibição</span><input name="display_name" type="text" maxlength="60" required value="${escapeHTML(profile.display_name || '')}"></label>
        <label class="profile-editor__field"><span>Nome de usuário</span><div class="profile-editor__username"><input name="username" type="text" minlength="3" maxlength="16" pattern="[A-Za-z0-9._-]+" required value="${escapeHTML(profile.username || '')}" autocomplete="username"></div><small>Utilize letras, números e caracteres especiais</small></label>
        <label class="profile-editor__field"><span>Biografia</span><textarea name="bio" maxlength="240" rows="3" placeholder="Conte um pouco sobre você…">${escapeHTML(profile.bio || '')}</textarea><small>Até 240 caracteres</small></label>
        <div class="profile-editor__uploads">
          <label class="profile-editor__upload"><span>Foto de perfil</span><div class="profile-editor__preview profile-editor__preview--avatar" data-avatar-preview>${profile.avatar_url ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">' : '<span>' + escapeHTML((profile.display_name || profile.username || 'L').charAt(0).toUpperCase()) + '</span>'}</div><input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif"><small>PNG, JPG, WEBP ou GIF · até 5 MB. GIFs mantêm a animação.</small></label>
          <label class="profile-editor__upload"><span>Imagem de capa</span><div class="profile-editor__preview profile-editor__preview--banner" data-banner-preview>${profile.banner_url ? '<img src="' + escapeHTML(profile.banner_url) + '" alt="">' : '<span>Prévia da capa</span>'}</div><input type="file" name="banner" accept="image/png,image/jpeg,image/webp,image/gif"><small>PNG, JPG, WEBP ou GIF · até 5 MB. GIFs mantêm a animação.</small></label>
        </div>
        <p class="profile-editor__message" data-editor-message role="status"></p>
        <div class="profile-editor__actions"><button type="button" data-cancel>Cancelar</button><button type="submit">Salvar perfil ↗</button></div>
      </form>
    </section>`;
  const editor = pageContainer.querySelector('.profile-editor');
  const form = editor.querySelector('[data-profile-form]');
  const message = editor.querySelector('[data-editor-message]');
  const close = () => {
    if (returnToProfile) renderProfilePage(user, profile.username);
    else renderSignedIn(user);
  };
  editor.querySelector('[data-close]').addEventListener('click', close);
  editor.querySelector('[data-cancel]').addEventListener('click', close);

  let activeCropper = null;
  let activeCropUrl = null;
  let activeCropField = null;

  const cropOverlay = document.createElement('div');
  cropOverlay.className = 'profile-crop-overlay';
  cropOverlay.hidden = true;
  cropOverlay.innerHTML = `
    <section class="profile-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-crop-title">
      <div class="profile-crop-dialog__header">
        <h3 id="profile-crop-title">Ajustar imagem</h3>
        <button type="button" data-crop-cancel aria-label="Fechar">×</button>
      </div>
      <p data-crop-hint></p>
      <div class="profile-crop-dialog__viewport"><img data-crop-image alt="Imagem para recorte"></div>
      <div class="profile-crop-dialog__zoom">
        <label for="profile-crop-zoom">Zoom</label>
        <input id="profile-crop-zoom" data-crop-zoom type="range" min="0" max="100" value="0">
      </div>
      <div class="profile-crop-dialog__actions">
        <button type="button" class="btn btn-default" data-crop-cancel>Cancelar</button>
        <button type="button" class="btn btn-primary" data-crop-apply>Usar imagem</button>
      </div>
    </section>`;
  document.body.appendChild(cropOverlay);
  const cropImage = cropOverlay.querySelector('[data-crop-image]');
  const closeCropper = (restoreInput = true) => {
    activeCropper?.destroy();
    activeCropper = null;
    if (activeCropUrl) URL.revokeObjectURL(activeCropUrl);
    activeCropUrl = null;
    if (restoreInput && activeCropField) activeCropField.input.value = '';
    activeCropField = null;
    cropOverlay.hidden = true;
  };
  cropOverlay.querySelectorAll('[data-crop-cancel]').forEach((button) => {
    button.addEventListener('click', () => closeCropper(true));
  });
  cropOverlay.addEventListener('click', (event) => {
    if (event.target === cropOverlay) closeCropper(true);
  });
  cropOverlay.querySelector('[data-crop-zoom]').addEventListener('input', (event) => {
    if (!activeCropper) return;
    const value = Number(event.target.value);
    activeCropper.zoomTo(1 + value / 100);
  });
  cropOverlay.querySelector('[data-crop-apply]').addEventListener('click', () => {
    if (!activeCropper || !activeCropField) return;
    const isAvatar = activeCropField.field === 'avatar';
    const canvas = activeCropper.getCroppedCanvas({
      width: isAvatar ? 512 : 1600,
      height: isAvatar ? 512 : 500,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    canvas.toBlob((blob) => {
      if (!blob) {
        message.textContent = 'Não foi possível processar esta imagem.';
        return;
      }
      const original = activeCropField.file;
      const cropped = new File([blob], original.name.replace(/\\.[^.]+$/, '') + '-recortada.jpg', {
        type: 'image/jpeg', lastModified: Date.now()
      });
      const transfer = new DataTransfer();
      transfer.items.add(cropped);
      activeCropField.input.files = transfer.files;
      const preview = form.querySelector(activeCropField.previewSelector);
      const previewUrl = URL.createObjectURL(cropped);
      preview.innerHTML = '<img src="' + previewUrl + '" alt="Prévia da imagem recortada">';
      closeCropper(false);
    }, 'image/jpeg', 0.92);
  });

  for (const [field, previewSelector] of [['avatar', '[data-avatar-preview]'], ['banner', '[data-banner-preview]']]) {
    const input = form.elements[field];
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        message.textContent = 'Escolha imagens JPG, PNG, WEBP ou GIF de até 5 MB.';
        input.value = '';
        return;
      }
      closeCropper(false);
      if (file.type === 'image/gif') {
        const preview = form.querySelector(previewSelector);
        const previewUrl = URL.createObjectURL(file);
        preview.innerHTML = '<img src="' + previewUrl + '" alt="Prévia do GIF animado">';
        message.textContent = 'GIF selecionado. A animação será preservada; o recorte manual não estará disponível.';
        return;
      }
      if (typeof window.Cropper === 'undefined') {
        message.textContent = 'O editor de imagem não carregou. Atualize a página e tente novamente.';
        input.value = '';
        return;
      }
      message.textContent = '';
      activeCropField = { field, input, file, previewSelector };
      activeCropUrl = URL.createObjectURL(file);
      cropImage.src = activeCropUrl;
      cropOverlay.querySelector('#profile-crop-title').textContent = field === 'avatar' ? 'Recortar foto de perfil' : 'Recortar imagem de capa';
      cropOverlay.querySelector('[data-crop-hint]').textContent = field === 'avatar'
        ? 'Arraste a imagem e ajuste o zoom. A área circular mostra como sua foto será exibida.'
        : 'Arraste a imagem e ajuste o zoom para definir o enquadramento da capa.';
      cropOverlay.querySelector('[data-crop-zoom]').value = '0';
      cropOverlay.hidden = false;
      cropImage.onload = () => {
        activeCropper?.destroy();
        activeCropper = new window.Cropper(cropImage, {
          aspectRatio: field === 'avatar' ? 1 : 16 / 5,
          viewMode: 1,
          dragMode: 'move',
          autoCropArea: 1,
          responsive: true,
          background: false,
          guides: true,
          center: true,
          highlight: false,
          cropBoxMovable: false,
          cropBoxResizable: false,
          toggleDragModeOnDblclick: false
        });
      };
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const displayName = form.elements.display_name.value.trim();
    const username = form.elements.username.value.trim();
    const bio = form.elements.bio.value.trim();
    if (!/^[a-zA-Z0-9._-]{3,16}$/.test(username)) {
      message.textContent = 'O nome de usuário deve ter de 3 a 16 caracteres. Utilize letras, números e caracteres especiais.';
      return;
    }
    for (const field of ['avatar', 'banner']) {
      const file = form.elements[field].files?.[0];
      if (file && (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
        message.textContent = 'Escolha imagens JPG, PNG, WEBP ou GIF de até 5 MB.';
        return;
      }
    }

    submit.disabled = true;
    submit.textContent = 'Salvando…';
    message.textContent = '';
    try {
      const updates = { display_name: displayName, username, bio };
      for (const field of ['avatar', 'banner']) {
        const file = form.elements[field].files?.[0];
        if (!file) continue;
        const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type];
        const path = user.id + '/' + field + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + extension;
        const { error: uploadError } = await supabase.storage.from('profile-media').upload(path, file, {
          cacheControl: '3600', contentType: file.type, upsert: false
        });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('profile-media').getPublicUrl(path);
        updates[field === 'avatar' ? 'avatar_url' : 'banner_url'] = data.publicUrl;
      }

      const { error: updateError } = await supabase.from('profiles').update(updates).eq('id', user.id);
      if (updateError) throw updateError;
      window.history.replaceState({ page: 'profile' }, '', '#/perfil/' + encodeURIComponent(username));
      await renderProfilePage(user, username);
    } catch (error) {
      console.error('[Ludus] Falha ao atualizar perfil:', error);
      message.textContent = error.code === '23505'
        ? 'Esse nome de usuário já está em uso. Escolha outro.'
        : 'Não foi possível salvar. Verifique sua conexão e tente novamente.';
      submit.disabled = false;
      submit.textContent = 'Salvar perfil ↗';
    }
  });
}

async function openReviewComposer(user, existingReview = null, preselectedGame = null) {
  const existing = app.querySelector('.composer-overlay');
  existing?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'composer-overlay';
  overlay.innerHTML = `
    <section class="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
      <button class="composer__close" type="button" aria-label="Fechar" data-close>×</button>
      <p class="eyebrow">${existingReview ? 'SUA HISTÓRIA' : 'SUA PRÓXIMA HISTÓRIA'}</p>
      <h2 id="composer-title">${existingReview ? 'Editar avaliação' : 'Registrar um jogo'}<span>.</span></h2>
      <label class="composer__label" for="game-search" ${(existingReview || preselectedGame) ? 'hidden' : ''}>Qual jogo você jogou?</label>
      <input class="composer__search" id="game-search" type="search" placeholder="Buscar pelo nome do jogo…" autocomplete="off" ${(existingReview || preselectedGame) ? 'hidden disabled' : ''}>
      <div class="composer__results" data-game-results aria-live="polite"></div>
      <div class="composer__selected" data-selected hidden></div>
      <form class="composer__form" data-review-form hidden>
        <div class="composer__field composer__rating-field">
          <label>Sua nota</label>
          <input id="review-rating" type="hidden" name="rating" value="5" required>
          <div class="composer__stars" role="group" aria-label="Escolha uma nota de uma a cinco estrelas">
            <button type="button" class="composer__star is-active" data-rating-value="1" aria-label="1 estrela" aria-pressed="false">★</button><button type="button" class="composer__star is-active" data-rating-value="2" aria-label="2 estrelas" aria-pressed="false">★</button><button type="button" class="composer__star is-active" data-rating-value="3" aria-label="3 estrelas" aria-pressed="false">★</button><button type="button" class="composer__star is-active" data-rating-value="4" aria-label="4 estrelas" aria-pressed="false">★</button><button type="button" class="composer__star is-active" data-rating-value="5" aria-label="5 estrelas" aria-pressed="true">★</button>
          </div>
        </div>
        <label class="composer__field"><input type="checkbox" name="completed"> Zerado</label>
        <label class="composer__liked"><input type="checkbox" name="liked_game"> <span><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"></path></svg> Gostei deste jogo</span></label>
        <label class="composer__field" for="review-body">O que achou? <small>Opcional · até 5.000 caracteres</small></label>
        <textarea id="review-body" name="body" maxlength="5000" rows="4" placeholder="Conte um pouco sobre sua experiência…"></textarea>
        <p class="composer__message" data-composer-message role="status"></p>
        <button class="composer__submit" type="submit">Publicar avaliação ↗</button>
      </form>
    </section>`;
  app.append(overlay);
  const search = overlay.querySelector('#game-search');
  const results = overlay.querySelector('[data-game-results]');
  const selected = overlay.querySelector('[data-selected]');
  const form = overlay.querySelector('[data-review-form]');
  let selectedGame = existingReview
    ? { id: existingReview.game_id, ...(existingReview.games || {}) }
    : preselectedGame ? { ...preselectedGame } : null;
  let timer;
  const renderSelectedGame = async (game, caption = 'Jogo selecionado') => {
    if (!game) return;
    selected.hidden = false;
    selected.innerHTML = (game.cover_url
      ? '<img class="composer__game-cover" src="' + escapeHTML(game.cover_url) + '" alt="">'
      : '<span class="composer__cover-empty">Sem capa</span>') +
      '<span class="composer__game-info"><strong>' + escapeHTML(game.title || 'Jogo') + '</strong>' +
      (game.release_year ? '<small class="composer__game-year">' + escapeHTML(game.release_year) + '</small>' : '') +
      '<span class="composer__average" data-game-average>Calculando média…</span><small class="composer__selected-caption">' + caption + '</small></span>' +
      (caption === 'Jogo selecionado' && !existingReview && !preselectedGame ? '<button type="button" data-change-game>Trocar</button>' : '');
    const averageNode = selected.querySelector('[data-game-average]');
    const { data: ratingRows, error: ratingError } = await fetchAllPages(() =>
      supabase.from('reviews').select('rating').eq('game_id', game.id)
    );
    if (!averageNode || !selected.isConnected) return;
    if (ratingError) {
      averageNode.textContent = 'Média indisponível';
    } else if (!ratingRows.length) {
      averageNode.textContent = 'Ainda sem notas';
    } else {
      const average = ratingRows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / ratingRows.length;
      averageNode.innerHTML = '<strong>' + average.toFixed(1).replace('.', ',') + '</strong> / 5 <small>· ' + ratingRows.length + (ratingRows.length === 1 ? ' avaliação' : ' avaliações') + '</small>';
    }
    selected.querySelector('[data-change-game]')?.addEventListener('click', () => {
      selectedGame = null; selected.hidden = true; form.hidden = true; search.focus();
    });
  };

  const syncRatingStars = (value) => {
    const ratingInput = form.elements.rating;
    ratingInput.value = String(value);
    form.querySelectorAll('[data-rating-value]').forEach((star) => {
      const active = Number(star.dataset.ratingValue) <= Number(value);
      star.classList.toggle('is-active', active);
      star.setAttribute('aria-pressed', String(Number(star.dataset.ratingValue) === Number(value)));
    });
  };

  if (existingReview || preselectedGame) {
    const game = existingReview?.games || preselectedGame || {};
    renderSelectedGame({ ...game, id: existingReview?.game_id || game.id }, existingReview ? 'Jogo da avaliação' : 'Jogo selecionado');
    form.hidden = false;
    if (existingReview) {
      syncRatingStars(existingReview.rating);
      form.elements.status.value = existingReview.status || 'playing';
      form.elements.liked_game.checked = Boolean(existingReview.liked_game);
      form.elements.body.value = existingReview.body || '';
      form.querySelector('[type="submit"]').textContent = 'Salvar alterações ↗';
    }
  }

  form.querySelector('.composer__stars').addEventListener('click', (event) => {
    const star = event.target.closest('[data-rating-value]');
    if (star) syncRatingStars(Number(star.dataset.ratingValue));
  });

  const close = () => overlay.remove();
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', function escape(event) {
    if (event.key === 'Escape' && app.contains(overlay)) { close(); document.removeEventListener('keydown', escape); }
  });

  search.addEventListener('input', () => {
    clearTimeout(timer);
    selectedGame = null;
    selected.hidden = true;
    form.hidden = true;
    const query = search.value.trim();
    if (query.length < 2) { results.innerHTML = ''; return; }
    results.innerHTML = '<p class="composer__hint">Buscando jogos…</p>';
    timer = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('steamgriddb', { body: { action: 'search', query } });
      if (search.value.trim() !== query) return;
      if (error || data?.error) {
        results.innerHTML = '<p class="composer__hint">Não foi possível buscar jogos. ' + escapeHTML(data?.error || '') + '</p>';
        return;
      }
      if (!data?.data?.length) { results.innerHTML = '<p class="composer__hint">Nenhum jogo encontrado. Tente outro nome.</p>'; return; }
      results.innerHTML = data.data.map((game) => {
        const releaseDate = Number(game.release_date);
        const releaseYear = Number.isFinite(releaseDate) && releaseDate > 0
          ? new Date(releaseDate * 1000).getUTCFullYear() : null;
        return '<button class="composer__result" type="button" data-game-id="' + Number(game.id) + '" data-game-name="' + escapeHTML(game.name) + '" data-game-year="' + (releaseYear || '') + '">' +
          '<span class="composer__result-info"><strong>' + escapeHTML(game.name) + '</strong><small>(' + (releaseYear || 'Ano não informado') + ')</small></span><span>Selecionar ↗</span></button>';
      }).join('');
    }, 350);
  });

  results.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-game-id]');
    if (!button) return;
    results.innerHTML = '<p class="composer__hint">Preparando jogo…</p>';
    const { data, error } = await supabase.functions.invoke('steamgriddb', {
      body: { action: 'save', game: { id: Number(button.dataset.gameId), name: button.dataset.gameName, release_year: Number(button.dataset.gameYear) || null } }
    });
    if (error || data?.error || !data?.game) {
      results.innerHTML = '<p class="composer__hint">' + escapeHTML(data?.error || 'Não foi possível selecionar esse jogo.') + '</p>';
      return;
    }
    selectedGame = data.game;
    results.innerHTML = '';
    await renderSelectedGame(selectedGame, 'Jogo selecionado');
    form.hidden = false;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGame) return;
    const submit = form.querySelector('[type="submit"]');
    const message = form.querySelector('[data-composer-message]');
    const values = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    submit.textContent = existingReview ? 'Salvando…' : 'Publicando…';
    message.textContent = '';
    const reviewData = {
      rating: Number(values.rating),
      status: form.elements.completed.checked ? 'completed' : null,
      liked_game: form.elements.liked_game.checked,
      body: String(values.body || '').trim(),
    };
    const result = existingReview
      ? await supabase.from('reviews').update(reviewData).eq('id', existingReview.id).eq('user_id', user.id)
      : await supabase.from('reviews').insert({ ...reviewData, user_id: user.id, game_id: selectedGame.id });
    const { error } = result;
    if (error) {
      console.error('[Ludus] Falha ao salvar avaliação:', error);
      message.textContent = error.code === '23505'
        ? 'Você já publicou uma avaliação deste jogo.'
        : 'Não foi possível ' + (existingReview ? 'salvar as alterações' : 'publicar') + '. Verifique sua conexão e tente novamente.';
      submit.disabled = false;
      submit.textContent = existingReview ? 'Salvar alterações ↗' : 'Publicar avaliação ↗';
      return;
    }
    close();
    navigateToFeed(user);
  });
}

function renderAuth(mode = 'login') {
  const isWelcome = mode === 'welcome';

  if (isWelcome) {
    app.innerHTML = `
      <main class="landing-page">
        <header class="landing-header">
          <a class="landing-brand" href="#" aria-label="Ludus — página inicial">Ludus</a>
          <button class="landing-login" type="button" data-mode="login">Entrar</button>
        </header>

        <section class="landing-hero" aria-labelledby="landing-title">
          <div class="landing-hero__copy">
            <p class="landing-eyebrow">SUA COMUNIDADE GAMER</p>
            <h1 id="landing-title">Seu jeito de <span>viver os jogos.</span></h1>
            <p class="landing-hero__description">Avalie o que você joga, descubra novos títulos e compartilhe suas experiências com outros jogadores.</p>
            <div class="landing-actions">
              <button class="landing-button landing-button--primary" type="button" data-mode="signup">Criar minha conta <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
              <button class="landing-button landing-button--secondary" type="button" data-mode="login">Já tenho uma conta</button>
            </div>
          </div>

          <figure class="landing-artwork">
            <img src="https://www.rockstargames.com/VI/_next/static/media/Jason_and_Lucia_Robbery_landscape.09c8a~do21h4p.jpg?akim=1&imdensity=1&imwidth=1920" alt="Arte promocional de Grand Theft Auto VI com Jason e Lucia em Vice City" fetchpriority="high">
            <figcaption class="landing-artwork__credits"><span>Grand Theft Auto VI</span><span>Rockstar Games</span></figcaption>
          </figure>
        </section>

        <section class="landing-features" aria-label="O que você pode fazer no Ludus">
          <article class="landing-feature">
            <span class="landing-feature__icon"><i class="fa-solid fa-star" aria-hidden="true"></i></span>
            <div><h2>Avalie</h2><p>Registre suas notas e opiniões sobre os jogos que fazem parte da sua história.</p></div>
          </article>
          <article class="landing-feature">
            <span class="landing-feature__icon"><i class="fa-solid fa-compass" aria-hidden="true"></i></span>
            <div><h2>Descubra</h2><p>Encontre novos jogos e veja o que a comunidade está jogando.</p></div>
          </article>
          <article class="landing-feature">
            <span class="landing-feature__icon"><i class="fa-solid fa-users" aria-hidden="true"></i></span>
            <div><h2>Compartilhe</h2><p>Conecte-se com jogadores e acompanhe avaliações e listas.</p></div>
          </article>
        </section>

        <footer class="landing-footer"><span>Ludus</span><span>Uma comunidade feita por quem joga.</span></footer>
      </main>`;

    app.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => renderAuth(button.dataset.mode));
    });
    return;
  }

  const isSignup = mode === 'signup';
  const fields = isSignup
    ? '<label class="field"><span>Nome de usuário</span><input name="username" type="text" minlength="3" maxlength="16" pattern="[A-Za-z0-9._-]+" placeholder="seu.nome" autocomplete="username" required><small>Utilize letras, números e caracteres especiais</small></label><label class="field"><span>Como podemos chamar você?</span><input name="displayName" type="text" maxlength="60" placeholder="Seu nome" autocomplete="name" required></label>'
    : '';
  const passwordAutocomplete = isSignup ? 'new-password' : 'current-password';

  app.innerHTML = [
    '<main class="container auth-shell auth-shell--split">',
    '<div class="row">',
    '<section class="col-sm-6 col-md-5 col-md-offset-1">',
    '<h1>Ludus</h1>',
    '<p class="lead">Entre para acompanhar avaliações e compartilhar seus jogos.</p>',
    '</section>',
    '<section class="col-sm-6 col-md-5 auth-panel panel panel-default" aria-label="' + (isSignup ? 'Criar conta' : 'Entrar no Ludus') + '"><div class="panel-body auth-panel__inner">',
    '<nav class="auth-switch btn-group btn-group-justified" aria-label="Acesso à conta"><div class="btn-group"><button class="btn btn-default auth-switch__button ' + (!isSignup ? 'is-active' : '') + '" type="button" data-mode="login" ' + (!isSignup ? 'aria-current="page"' : '') + '>Entrar</button></div><div class="btn-group"><button class="btn btn-default auth-switch__button ' + (isSignup ? 'is-active' : '') + '" type="button" data-mode="signup" ' + (isSignup ? 'aria-current="page"' : '') + '>Criar conta</button></div></nav>',
    '<div class="auth-panel__heading"><h2>' + (isSignup ? 'Criar conta' : 'Entrar no Ludus') + '</h2></div>',
    '<form class="auth-form" id="auth-form">' + fields,
    '<div class="form-group"><label class="field"><span>' + (isSignup ? 'E-mail' : 'E-mail ou nome de usuário') + '</span><input class="form-control" name="' + (isSignup ? 'email' : 'identifier') + '" type="' + (isSignup ? 'email' : 'text') + '" placeholder="' + (isSignup ? 'voce@email.com' : 'E-mail ou usuário') + '" autocomplete="' + (isSignup ? 'email' : 'username') + '" required></label></div>',
    '<div class="form-group"><label class="field"><span>Senha</span><div class="password-field"><input class="form-control" name="password" type="password" minlength="6" placeholder="Mínimo de 6 caracteres" autocomplete="' + passwordAutocomplete + '" required><button class="btn btn-default password-toggle" type="button" data-password-toggle aria-label="Mostrar senha" title="Mostrar senha">Mostrar</button></div></label></div>',
    (!isSignup ? '<button class="btn btn-link text-button" type="button" data-reset>Esqueceu sua senha?</button>' : ''),
    (isSignup ? '<div class="auth-consents"><div class="checkbox"><label><input type="checkbox" name="age_confirmed" required> Tenho mais de 16 anos</label></div><div class="checkbox"><label><input type="checkbox" name="terms_accepted" required> Concordo com os <button class="btn btn-link terms-link" type="button" data-terms-open>termos de serviço</button></label></div></div>' : ''),
    '<button class="btn btn-primary btn-block submit-button" type="submit">' + (isSignup ? 'Criar minha conta' : 'Entrar') + '</button>',
    '<p class="form-message alert alert-info" data-message role="status" aria-live="polite" hidden></p>',
    (isSignup ? '<button class="btn btn-link" type="button" data-resend-confirmation hidden>Reenviar e-mail de confirmação</button>' : ''),
    '</form>',
    '<div class="terms-modal" data-terms-modal hidden><div class="terms-modal__backdrop" data-terms-close></div><section class="terms-modal__dialog panel panel-default" role="dialog" aria-modal="true" aria-labelledby="terms-title"><div class="panel-body"><button class="close terms-modal__close" type="button" data-terms-close aria-label="Fechar">×</button><h3 id="terms-title">Termos de serviço</h3><p>Este é um texto provisório. Os termos oficiais de serviço do Ludus ainda serão publicados.</p><p>Ao utilizar a plataforma, esperamos que todas as pessoas tratem a comunidade com respeito, não publiquem conteúdo ilegal ou ofensivo e respeitem os direitos de terceiros.</p><p>As funcionalidades, regras de convivência, privacidade e condições de uso serão detalhadas nesta página quando os termos oficiais forem definidos.</p><p>Versão provisória — não é o texto final.</p></div></section></div>',
    '</div></section></div></main>'
  ].join('');

  app.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => renderAuth(button.dataset.mode));
  });

  app.querySelector('.auth-panel')?.querySelector('input')?.focus();

  app.querySelectorAll('[data-password-toggle]').forEach((button) => {
    const input = button.parentElement.querySelector('input');
    const updateVisibility = () => {
      button.hidden = document.activeElement !== input;
    };
    input.addEventListener('focus', () => { button.hidden = false; });
    input.addEventListener('blur', () => { window.setTimeout(updateVisibility, 120); });
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.classList.toggle('is-visible', reveal);
      button.setAttribute('aria-label', reveal ? 'Ocultar senha' : 'Mostrar senha');
      button.title = reveal ? 'Ocultar senha' : 'Mostrar senha';
      input.focus();
    });
    button.hidden = true;
  });

  const termsModal = app.querySelector('[data-terms-modal]');
  app.querySelector('[data-terms-open]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    termsModal.hidden = false;
    termsModal.querySelector('[data-terms-close]').focus();
  });
  termsModal?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') termsModal.hidden = true;
  });
  termsModal?.querySelectorAll('[data-terms-close]').forEach((button) => {
    button.addEventListener('click', () => { termsModal.hidden = true; });
  });
  termsModal?.querySelector('.terms-modal__dialog')?.addEventListener('click', (event) => event.stopPropagation());

  app.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('.submit-button');
    const values = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    submit.textContent = 'Aguarde…';
    showMessage('');

    try {
      if (isSignup) {
        const result = await signUp(values);
        if (result.session?.user) {
          renderSignedIn(result.user);
        } else {
          const resendButton = app.querySelector('[data-resend-confirmation]');
          const emailAlreadyRegistered = result.user?.identities?.length === 0;
          showMessage(
            emailAlreadyRegistered
              ? 'Já existe uma conta associada a esse e-mail e ela pode estar aguardando confirmação. Confira sua caixa de entrada ou solicite um novo envio abaixo.'
              : 'Cadastro recebido. O Ludus solicitou o envio do e-mail de confirmação. Confira também as pastas de spam e promoções.',
            'success'
          );
          if (resendButton) {
            resendButton.hidden = false;
            resendButton.disabled = true;
            resendButton.textContent = 'Aguarde 60 segundos para reenviar';
            window.setTimeout(() => {
              resendButton.disabled = false;
              resendButton.textContent = 'Reenviar e-mail de confirmação';
            }, 60000);
          }
        }
      } else {
        const identifier = values.identifier.trim();
        const result = identifier.includes('@')
          ? await signIn({ email: identifier, password: values.password })
          : await signInWithUsername({ username: identifier.replace(/^@/, ''), password: values.password });
        renderSignedIn(result.user);
      }
    } catch (error) {
      showMessage(error.message || 'Não foi possível concluir. Tente novamente.', 'error');
      submit.disabled = false;
      submit.innerHTML = '<span>' + (isSignup ? 'Criar minha conta' : 'Entrar') + '</span><span class="submit-button__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M3 12h12m-5-5 5 5-5 5"/></svg></span>';
    }
  });

  const resendButton = app.querySelector('[data-resend-confirmation]');
  resendButton?.addEventListener('click', async () => {
    const email = app.querySelector('[name="email"]')?.value.trim();
    if (!email || !email.includes('@')) {
      showMessage('Informe um endereço de e-mail válido para reenviar a confirmação.', 'error');
      return;
    }

    resendButton.disabled = true;
    resendButton.textContent = 'Enviando…';
    showMessage('');
    try {
      await resendSignupConfirmation(email);
      showMessage('Solicitação enviada. Confira sua caixa de entrada e também as pastas de spam e promoções.', 'success');
      resendButton.textContent = 'Aguarde 60 segundos para reenviar';
      window.setTimeout(() => {
        resendButton.disabled = false;
        resendButton.textContent = 'Reenviar e-mail de confirmação';
      }, 60000);
    } catch (error) {
      const code = error.code || error.error || '';
      const message = code === 'email_address_not_authorized'
        ? 'O serviço de e-mail atual não permite enviar para esse endereço. É necessário configurar um SMTP próprio.'
        : code === 'over_email_send_rate_limit' || error.status === 429
          ? 'O limite de envio de e-mails foi atingido. Aguarde antes de tentar novamente.'
          : error.message || 'Não foi possível reenviar o e-mail. Tente novamente mais tarde.';
      showMessage(message, 'error');
      resendButton.disabled = false;
      resendButton.textContent = 'Reenviar e-mail de confirmação';
    }
  });

  const resetButton = app.querySelector('[data-reset]');
  resetButton?.addEventListener('click', async () => {
    const email = app.querySelector('[name="identifier"]').value.trim();
    if (!email || !email.includes('@')) {
      showMessage('Informe seu e-mail para receber o link de recuperação.', 'error');
      return;
    }
    resetButton.disabled = true;
    try {
      await requestPasswordReset(email);
      showMessage('Se esse e-mail estiver cadastrado, você receberá um link para redefinir a senha.', 'success');
    } catch (error) {
      showMessage(error.message || 'Não foi possível enviar o e-mail.', 'error');
    } finally {
      resetButton.disabled = false;
    }
  });
}

if (!supabase) {
  app.innerHTML = '<main class="container"><div class="alert alert-warning" role="alert"><h1>Configuração necessária</h1><p>As credenciais públicas do serviço ainda não foram carregadas nesta publicação.</p></div></main>';
} else {
  renderAuth('welcome');
  let authReady = false;
  supabase.auth.onAuthStateChange((event, session) => {
    authReady = true;
    if (event === 'SIGNED_IN' && session?.user) renderSignedIn(session.user);
    if (event === 'SIGNED_OUT') { activeUser = null; renderAuth('welcome'); }
    if (event === 'INITIAL_SESSION' && session?.user) renderSignedIn(session.user);
  });

  Promise.race([
    supabase.auth.getSession(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('A conexão com o serviço de autenticação demorou demais. Verifique sua internet e tente novamente.')), 8000))
  ]).then(({ data: { session } }) => {
    if (!authReady && session?.user) renderSignedIn(session.user);
  }).catch((error) => {
    console.error('[Ludus] Não foi possível restaurar a sessão:', error);
    const message = document.querySelector('[data-message]');
    if (message) {
      message.textContent = 'Não foi possível verificar sua sessão agora. Você ainda pode tentar entrar novamente.';
      message.dataset.type = 'error';
      message.hidden = false;
    }
  });
}


window.addEventListener('hashchange', () => {
  if (!activeUser) return;
  const username = getProfileUsernameFromLocation();
  const gameId = getGameIdFromLocation();
  const reviewId = getReviewIdFromLocation();
  const reportId = getReviewReportIdFromLocation();
  if (isAdminRoute()) renderAdminPage(activeUser);
  else if (username) renderProfilePage(activeUser, username);
  else if (gameId) renderGamePage(activeUser, gameId);
  else if (reportId) renderReviewReportPage(activeUser, reportId);
  else if (reviewId) renderReviewPage(activeUser, reviewId);
  else if (window.location.hash === '#/buscar') renderSearchPage(activeUser);
  else if (window.location.hash === '#/notificacoes') renderNotificationsPage(activeUser);
  else renderSignedIn(activeUser);
});
