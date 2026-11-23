import { supabase } from './lib/supabase.js';
import { signIn, signOut, signUp, requestPasswordReset } from './lib/auth.js';

const app = document.querySelector('#app');
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
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggleButton.setAttribute('aria-expanded', String(opening));
    if (opening) await root._refreshNotifications?.();
  });

  if (notificationChannel) {
    await supabase.removeChannel(notificationChannel);
    notificationChannel = null;
  }

  const refresh = async () => {
    const { data, error } = await supabase.from('notifications')
      .select('id, type, actor_id, review_id, created_at, read_at, profiles!notifications_actor_id_fkey(username, display_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('[Ludus] Falha ao carregar notificações:', error);
      list.innerHTML = '<p class="notifications__empty">Não foi possível carregar as notificações.</p>';
      return;
    }

    const rows = data || [];
    const unreadCount = rows.filter((item) => !item.read_at).length;
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.hidden = unreadCount === 0;

    if (!rows.length) {
      list.innerHTML = '<p class="notifications__empty">Tudo tranquilo por aqui. Suas novidades aparecerão aqui.</p>';
      return;
    }

    list.innerHTML = rows.map((item) => {
      const actor = item.profiles?.display_name || item.profiles?.username || 'Alguém';
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
  const avatar = nested ? '' : (profile.avatar_url
    ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="" loading="lazy">'
    : profilePlaceholderMarkup());
  const commentLikes = likes.filter((like) => like.comment_id === comment.id);
  const isLiked = commentLikes.some((like) => like.user_id === user.id);
  const children = childrenByParent.get(comment.id) || [];
  const menu = '<details class="review-comment__menu"><summary aria-label="Opções do comentário" title="Opções">⋯</summary><div class="review-comment__menu-panel">' +
    (comment.user_id === user.id
      ? '<button type="button" data-comment-action="edit">Editar comentário</button><button type="button" data-comment-action="delete">Excluir comentário</button>'
      : '<button type="button" data-comment-action="report">Denunciar comentário</button>') +
    '</div></details>';
  return '<article class="review-comment' + (nested ? ' review-comment--reply' : '') + '" data-comment-id="' + comment.id + '">' +
    '<div class="review-comment__meta' + (nested ? ' review-comment__meta--reply' : '') + '">' +
    (nested ? '' : '<span class="review-comment__avatar">' + avatar + '</span>') +
    '<button class="review-comment__author" type="button" data-profile-username="' + escapeHTML(username) + '">' + escapeHTML(username) + '</button>' + menu + '</div>' +
    '<p class="review-comment__body">' + escapeHTML(comment.body) + '</p>' +
    '<form class="review-comment__edit-form" data-edit-comment-form hidden><textarea rows="2" maxlength="1000" required>' + escapeHTML(comment.body) + '</textarea><button type="submit">Salvar</button><button type="button" data-cancel-edit>Cancelar</button></form>' +
    '<div class="review-comment__actions"><button type="button" class="review-comment__like' + (isLiked ? ' is-liked' : '') + '" data-like-comment aria-pressed="' + isLiked + '">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-8.8-5.9-8.8-12.2A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4C20.8 15.1 12 21 12 21Z"></path></svg><span data-comment-like-count>' + (commentLikes.length || '') + '</span></button>' +
    '<button type="button" class="review-comment__reply" data-reply-comment>Responder</button></div>' +
    '<form class="review-comment__reply-form" data-reply-form data-parent-comment-id="' + comment.id + '" hidden><textarea rows="2" maxlength="1000" placeholder="Responder a ' + escapeHTML(username) + '..." required></textarea><button type="submit">Enviar resposta</button></form>' +
    (children.length ? '<button type="button" class="review-comment__replies-toggle" data-toggle-replies data-reply-count="' + children.length + '" aria-expanded="false"><span>Exibir respostas (' + children.length + ')</span></button><div class="review-comment__replies" hidden>' + children.map((child) => renderReviewCommentMarkup(child, user, likes, childrenByParent, true)).join('') + '</div>' : '') +
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
  const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'jogador';
  return `  <header class="side-menu side-menu--left">
    <a class="topbar-brand side-menu__brand" href="#inicio" aria-label="Ludus — início">Ludus</a>
    <nav class="side-menu__navigation" aria-label="Navegação principal">
      <button class="side-menu__item is-active" type="button" data-feed-mode="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg><span>Página inicial</span></button>
      <button class="side-menu__item" type="button" data-open-search><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m15.8 15.8 5 5"/></svg><span>Buscar</span></button>
      <button class="side-menu__item" type="button" data-side-profile><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.6 3.1-5.5 7-5.5s6.3 1.9 7 5.5"/></svg><span>Perfil</span></button>
      <button class="side-menu__item" type="button" data-side-settings><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.5-1.1-1.8-3.1-1.8.7a7.8 7.8 0 0 0-2.6-1.5L14.4 3h-4.8L9.3 5.5a7.8 7.8 0 0 0-2.6 1.5l-1.8-.7-1.8 3.1 1.5 1.1a7.7 7.7 0 0 0 0 3l-1.5 1.1 1.8 3.1 1.8-.7a7.8 7.8 0 0 0 2.6 1.5l.3 2.5h4.8l.3-2.5a7.8 7.8 0 0 0 2.6-1.5l1.8.7 1.8-3.1Z"/></svg><span>Configurações</span></button>
      <button class="side-menu__item" type="button" data-feed-mode="saved"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/></svg><span>Listas salvas</span></button>
    </nav>
  </header>
  <nav class="bottom-nav" aria-label="Navegação inferior">
    <button class="bottom-nav__item is-active" type="button" data-bottom-home aria-label="Início" title="Início"><i class="fa-solid fa-house" aria-hidden="true"></i></button>
    <button class="bottom-nav__item" type="button" data-bottom-search aria-label="Pesquisar" title="Pesquisar"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button>
    <button class="bottom-nav__item bottom-nav__review" type="button" data-bottom-review aria-label="Avaliar" title="Avaliar"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
    ${notificationControlMarkup()}
    <button class="bottom-nav__item" type="button" data-bottom-profile aria-label="Perfil" title="Perfil"><i class="fa-regular fa-user" aria-hidden="true"></i></button>
  </nav>`;
}

function sharedFeedHeaderMarkup() {
  return `  <header class="app-topbar">
      <div class="container-fluid">
        <div class="row app-topbar__row">
          <div class="col-xs-4 app-topbar__left">
            <button class="app-topbar__avatar app-topbar__menu-button" type="button" data-header-avatar aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded="false"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>
          </div>
          <div class="col-xs-4 app-topbar__center">
            <a class="app-topbar__brand" href="#inicio" aria-label="Ludus — início">Ludus</a>
          </div>
          <div class="col-xs-4 app-topbar__right"></div>
        </div>
      </div>
    </header>
    <nav class="feed-navigation feed-navigation--header" aria-label="Navegação do feed">
      <div class="feed-tabs" role="tablist" aria-label="Navegação do feed">
        <button class="feed-tabs__button is-active" type="button" role="tab" aria-selected="true" data-feed-mode="home">Para Você</button>
        <button class="feed-tabs__button" type="button" role="tab" aria-selected="false" data-feed-mode="following">Seguindo</button>
      </div>
    </nav>
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
        <button class="mobile-drawer__item" type="button" data-drawer-profile><i class="fa-regular fa-user" aria-hidden="true"></i><span>Meu Perfil</span></button>
        <button class="mobile-drawer__item" type="button" data-drawer-saved><i class="fa-regular fa-bookmark" aria-hidden="true"></i><span>Listas Salvas</span></button>
        <button class="mobile-drawer__item" type="button" data-drawer-settings><i class="fa-solid fa-gear" aria-hidden="true"></i><span>Configurações</span></button>
      </nav>
      <div class="mobile-drawer__review-container"><button class="btn btn-primary btn-block mobile-drawer__review" type="button" data-drawer-review>Avaliar</button></div>
    </aside>`;
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

async function setupSharedSideMenu(user, profile = null) {
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
  setupMobileDrawer(user, profile);
  const username = root.querySelector('[data-side-username]');
  const avatar = root.querySelector('[data-side-avatar]');
  if (username) username.textContent = profile?.display_name || profile?.username || user.user_metadata?.display_name || user.email?.split('@')[0] || 'jogador';
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

async function renderSignedIn(user, initialFeedMode = 'home') {
  // Evita reconstruir o feed quando o Supabase restaura/renova a sessão ao voltar à aba.
  // A tela já está montada e os dados permanecem visíveis, sem piscar para o estado de carregamento.
  if (activeUser?.id === user.id && app.querySelector('[data-feed-list]') &&
      !getProfileUsernameFromLocation() && !getGameIdFromLocation() && !getReviewIdFromLocation()) return;
  activeUser = user;
  const reviewRouteId = getReviewIdFromLocation();
  if (reviewRouteId) { renderReviewPage(user, reviewRouteId); return; }
  const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'jogador';
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

  const username = app.querySelector('[data-username]');
  const avatar = app.querySelector('[data-avatar]');
  if (username) username.textContent = fallbackName;
  if (avatar) avatar.innerHTML = profilePlaceholderMarkup();

  const profileResult = await supabase.from('profiles')
    .select('username, display_name, avatar_url, banner_url, bio')
    .eq('id', user.id).maybeSingle();

  const drawerAvatar = app.querySelector('[data-drawer-avatar]');
  if (drawerAvatar && profileResult.data?.avatar_url) {
    drawerAvatar.innerHTML = '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="Foto do perfil">';
  }
  setupMobileDrawer(user, profileResult.data);
  if (profileResult.data) {
    if (username) username.textContent = profileResult.data.username || fallbackName;
    const sideUsername = app.querySelector('[data-side-username]');
    const sideAvatar = app.querySelector('[data-side-avatar]');
    if (sideUsername) sideUsername.textContent = profileResult.data.display_name || profileResult.data.username || fallbackName;
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
    try { await signOut(); renderAuth('login'); }
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
      .select('id, user_id, game_id, rating, body, status, liked_game, created_at, profiles!reviews_user_id_fkey(username, display_name, avatar_url), games!reviews_game_id_fkey(title, cover_url, hero_url, release_year, developer, platforms)')
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
        (gameYear ? '<span class="review-card__game-year">' + escapeHTML(gameYear) + '</span>' : '');
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
      const menuMarkup = '<details class="review-menu"><summary aria-label="Mais opções da review" title="Mais opções"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></summary><div class="review-menu__panel">' +
        (isOwner ? '<button type="button" data-review-action="edit">Editar review</button><button type="button" class="is-danger" data-review-action="delete">Excluir review</button>' : '<button type="button" data-review-action="report">Denunciar review</button>') + '</div></details>';
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
      if (action === 'edit' && review.user_id === user.id) {
        openReviewComposer(user, review);
      } else if (action === 'delete' && review.user_id === user.id) {
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
        const reason = window.prompt('Por que deseja denunciar esta review?\\n1 — Spam\\n2 — Assédio ou discurso de ódio\\n3 — Spoiler sem aviso\\n4 — Conteúdo impróprio\\n5 — Outro');
        if (reason === null) return;
        const reasons = { '1': 'spam', '2': 'harassment', '3': 'spoiler', '4': 'inappropriate', '5': 'other' };
        if (!reasons[reason.trim()]) { window.alert('Escolha uma opção de 1 a 5.'); return; }
        const details = window.prompt('Deseja adicionar algum detalhe? (opcional)') || '';
        const { error: reportError } = await supabase.from('review_reports').insert({
          reporter_id: user.id, review_id: review.id, reason: reasons[reason.trim()], details: details.slice(0, 1000)
        });
        if (reportError) {
          console.error('[Ludus] Falha ao denunciar review:', reportError);
          window.alert(reportError.code === '23505' ? 'Você já denunciou esta review.' : 'Não foi possível enviar a denúncia. Tente novamente.');
          return;
        }
        window.alert('Denúncia enviada. Obrigado por ajudar a manter a comunidade segura.');
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

      context.fillStyle = '#11151c';
      context.fillRect(0, 0, 1080, 1920);
      if (coverImage) {
        context.save();
        context.filter = 'blur(48px)';
        context.globalAlpha = 0.55;
        context.drawImage(coverImage, -100, -100, 1280, 2120);
        context.restore();
      } else {
        const fallbackBackground = context.createLinearGradient(0, 0, 1080, 1920);
        fallbackBackground.addColorStop(0, '#514579');
        fallbackBackground.addColorStop(0.55, '#222831');
        fallbackBackground.addColorStop(1, '#11151c');
        context.fillStyle = fallbackBackground;
        context.fillRect(0, 0, 1080, 1920);
      }
      context.fillStyle = 'rgba(13,17,24,0.76)';
      context.fillRect(0, 0, 1080, 1920);
      context.fillStyle = 'rgba(255,255,255,0.72)';
      context.font = '700 22px Arial, sans-serif';
      context.textAlign = 'left';
      context.fillText('LUDUS  /  GAME REVIEW', 72, 82);
      context.strokeStyle = 'rgba(255,255,255,0.35)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(72, 108);
      context.lineTo(1008, 108);
      context.stroke();
      context.fillStyle = 'rgba(255,255,255,0.62)';
      context.font = '600 18px Arial, sans-serif';
      context.fillText('EDIÇÃO DA COMUNIDADE', 72, 145);
      context.textAlign = 'right';
      context.fillText('Nº ' + String(review.id).slice(0, 6).toUpperCase(), 1008, 145);

      const heroArea = { x: 72, y: 185, width: 936, height: 1040 };
      let imageRect;
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
        roundRectPath(context, imageRect.x, imageRect.y, imageRect.width, imageRect.height, 8);
        context.clip();
        context.drawImage(coverImage, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        const imageShade = context.createLinearGradient(0, imageRect.y + imageRect.height * 0.48, 0, imageRect.y + imageRect.height);
        imageShade.addColorStop(0, 'rgba(0,0,0,0)');
        imageShade.addColorStop(0.45, 'rgba(0,0,0,0.24)');
        imageShade.addColorStop(1, 'rgba(0,0,0,0.88)');
        context.fillStyle = imageShade;
        context.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        context.restore();
      } else {
        imageRect = { x: 110, y: 285, width: 860, height: 820 };
        const placeholder = context.createLinearGradient(imageRect.x, imageRect.y, imageRect.x + imageRect.width, imageRect.y + imageRect.height);
        placeholder.addColorStop(0, '#514579');
        placeholder.addColorStop(1, '#29313d');
        context.fillStyle = placeholder;
        roundRectPath(context, imageRect.x, imageRect.y, imageRect.width, imageRect.height, 8);
        context.fill();
        context.fillStyle = '#ffffff';
        context.font = '700 30px Arial, sans-serif';
        context.textAlign = 'center';
        context.fillText('CAPA INDISPONÍVEL', 540, 690);
      }

      const gameTitle = game.title || 'Jogo';
      const titleY = imageRect.y + imageRect.height - 300;
      context.fillStyle = '#ffffff';
      context.font = '800 54px Arial, sans-serif';
      const titleHeight = drawWrappedText(context, gameTitle, 540, titleY, 820, 62, 2, 54);
      const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
      const ratingY = titleY + titleHeight + 30;
      context.fillStyle = '#ffffff';
      context.font = '800 54px Arial, sans-serif';
      context.textAlign = 'center';
      context.fillText(rating.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), 540, ratingY);
      context.fillStyle = '#e2b85d';
      context.font = '400 31px Arial, sans-serif';
      context.fillText('★'.repeat(Math.max(0, Math.min(5, Math.round(rating)))), 540, ratingY + 43);
      const statusTags = [
        review.liked_game ? '♥  FAVORITO' : '',
        review.status === 'completed' ? '🏆  ZERADO' : ''
      ].filter(Boolean);
      if (statusTags.length) {
        const tagY = ratingY + 75;
        const totalWidth = statusTags.length * 170 + (statusTags.length - 1) * 14;
        let tagCenter = 540 - totalWidth / 2 + 85;
        statusTags.forEach((tag) => {
          drawPill(context, tag, tagCenter, tagY, 'rgba(112,96,171,0.88)', '#ffffff');
          tagCenter += 184;
        });
      }

      const reviewText = String(review.body || '').trim();
      const reviewStartY = 1300;
      context.fillStyle = '#b7a9e8';
      context.font = '700 18px Arial, sans-serif';
      context.textAlign = 'left';
      context.fillText('A CRÍTICA', 72, reviewStartY);
      context.strokeStyle = 'rgba(255,255,255,0.3)';
      context.beginPath();
      context.moveTo(72, reviewStartY + 18);
      context.lineTo(1008, reviewStartY + 18);
      context.stroke();
      context.fillStyle = 'rgba(255,255,255,0.94)';
      context.font = '400 29px Arial, sans-serif';
      const reviewHeight = reviewText
        ? drawWrappedText(context, '“' + reviewText + '”', 540, reviewStartY + 78, 900, 43, 5, 29)
        : 0;
      const signatureY = Math.min(1665, Math.max(1535, reviewStartY + 92 + reviewHeight));
      context.strokeStyle = 'rgba(255,255,255,0.28)';
      context.beginPath();
      context.moveTo(72, signatureY - 48);
      context.lineTo(1008, signatureY - 48);
      context.stroke();
      if (avatarImage) {
        context.save();
        context.beginPath();
        context.arc(540, signatureY + 4, 37, 0, Math.PI * 2);
        context.clip();
        context.drawImage(avatarImage, 503, signatureY - 33, 74, 74);
        context.restore();
      } else {
        context.fillStyle = '#7060ab';
        context.beginPath();
        context.arc(540, signatureY + 4, 37, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = '#ffffff';
      context.font = '700 25px Arial, sans-serif';
      context.textAlign = 'center';
      context.fillText('@' + (review.profiles?.username || 'jogador'), 540, signatureY + 72);

      context.strokeStyle = 'rgba(255,255,255,0.28)';
      context.beginPath();
      context.moveTo(72, 1800);
      context.lineTo(1008, 1800);
      context.stroke();
      context.fillStyle = '#ffffff';
      context.font = '800 32px Arial, sans-serif';
      context.textAlign = 'center';
      context.fillText('LUDUS', 540, 1850);
      context.fillStyle = 'rgba(255,255,255,0.66)';
      context.font = '400 19px Arial, sans-serif';
      context.fillText(window.location.host + window.location.pathname, 540, 1884);
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
      .select('id, user_id, body, created_at, parent_comment_id, profiles!review_comments_user_id_fkey(username, avatar_url)')
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
    '<div class="review-detail__content"><div class="review-detail__author"><span class="review-detail__avatar">' + avatar + '</span><div><strong>' + escapeHTML(profile.display_name || profile.username || 'Jogador') + '</strong><small>' + escapeHTML(profile.username || '') + ' · ' + formatDate(review.created_at) + '</small></div></div>' +
    '<h1>' + escapeHTML(game.title || 'Jogo') + (game.release_year ? ' <small>' + escapeHTML(game.release_year) + '</small>' : '') + '</h1><div class="review-detail__rating">' + '★'.repeat(review.rating) + '☆'.repeat(5-review.rating) + '</div><div class="review-detail__status">' + escapeHTML(statusLabel(review.status)) + (review.liked_game ? ' · Gostei deste jogo' : '') + '</div>' +
    (review.body ? '<p class="review-detail__body">' + escapeHTML(review.body) + '</p>' : '') + '</div></div><section class="review-detail__discussion"><h2>Discussão <span>' + commentRows.length + ' comentários</span></h2><div class="review-detail__comments">' + commentsMarkup + '</div><form class="review-detail__form" data-detail-comment-form><textarea rows="3" maxlength="1000" placeholder="Escreva um comentário…" required></textarea><button type="submit">Enviar comentário ↗</button></form></section></article>';
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
    const author = profile.display_name || profile.username || 'Jogador';
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
}

function navigateToSearch(currentUser, query = '') {
  const nextHash = '#/buscar';
  if (window.location.hash !== nextHash) window.history.pushState({ page: 'search' }, '', nextHash);
  renderSearchPage(currentUser, query);
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
        '<span class="search-result__avatar">' + avatar + '</span><span class="search-result__info"><strong>' + escapeHTML(profile.display_name || profile.username) + '</strong><small>@' + escapeHTML(profile.username) + '</small></span></button>';
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

function navigateToFeed(currentUser, mode = 'home') {
  if (window.location.hash !== '#inicio') {
    window.history.pushState({ page: 'feed' }, '', '#inicio');
  }
  renderSignedIn(currentUser, mode);
}

async function renderProfilePage(currentUser, username) {
  const requestId = (renderProfilePage.requestId || 0) + 1;
  renderProfilePage.requestId = requestId;
  app.innerHTML = `
    <div class="feed-shell">
      ${sharedSideMenuMarkup(currentUser)}
      <main class="feed-center-column feed-main profile-main">
        ${sharedFeedHeaderMarkup()}
        <div class="feed-main__container">
          <div class="profile-page__content">
            <div class="profile-page__loading">Carregando perfil…</div>
          </div>
        </div>
      </main>
      <footer class="side-menu side-menu--right" aria-label="Coluna lateral direita"></footer>
    </div>`;
  setupSharedSideMenu(currentUser);

  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('id, username, display_name, bio, avatar_url, banner_url')
    .eq('username', username).maybeSingle();
  if (requestId !== renderProfilePage.requestId) return;
  if (profileError || !profile) {
    app.querySelector('.profile-page__content').innerHTML = '<div class="profile-page__empty"><p class="eyebrow">PERFIL INDISPONÍVEL</p><h1>Não encontramos este jogador.</h1><button type="button" class="profile-page__back" data-profile-back>← Voltar ao feed</button></div>';
    app.querySelector('[data-profile-back]')?.addEventListener('click', () => navigateToFeed(currentUser));
    return;
  }

  const [followers, following, followState, reviewsResult] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', profile.id),
    supabase.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', profile.id),
    currentUser.id === profile.id
      ? Promise.resolve({ data: null })
      : supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('following_id', profile.id).maybeSingle(),
    supabase.from('reviews')
      .select('id, rating, body, status, liked_game, created_at, games!reviews_game_id_fkey(title, cover_url, release_year)')
      .eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20)
  ]);
  if (requestId !== renderProfilePage.requestId) return;
  let isFollowing = Boolean(followState.data);
  const displayName = profile.display_name || profile.username;
  const avatar = profile.avatar_url
    ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">'
    : '<span>' + escapeHTML(displayName.trim().charAt(0).toUpperCase() || 'L') + '</span>';
  const banner = profile.banner_url
    ? '<img class="profile-page__banner-image" src="' + escapeHTML(profile.banner_url) + '" alt="">'
    : '<div class="profile-page__banner-empty"></div>';
  const reviewCards = (reviewsResult.data || []).map((review) => {
    const game = review.games?.title || 'Jogo';
    const year = review.games?.release_year ? ' (' + escapeHTML(review.games.release_year) + ')' : '';
    const cover = review.games?.cover_url
      ? '<img class="profile-review__cover" src="' + escapeHTML(review.games.cover_url) + '" alt="">'
      : '<div class="profile-review__cover profile-review__cover--empty">Sem capa</div>';
    return '<article class="profile-review">' + cover + '<div><strong>' + escapeHTML(game) + year + '</strong><div class="profile-review__meta"><span class="profile-review__stars">' + '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating) + '</span><span>' + statusLabel(review.status) + '</span><time>' + formatDate(review.created_at) + '</time></div>' + (review.body ? '<p>' + escapeHTML(review.body) + '</p>' : '') + (review.liked_game ? '<small class="profile-review__liked"><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"></path></svg> Gostei deste jogo</small>' : '') + '</div></article>';
  }).join('');

  app.querySelector('.profile-page__content').innerHTML =
    '<section class="profile-page__hero"><div class="profile-page__banner">' + banner + '</div>' +
    '<div class="profile-page__identity"><div class="profile-page__avatar">' + avatar + '</div>' +
    '<div class="profile-page__heading"><p class="eyebrow">JOGADOR LUDUS</p><h1>' + escapeHTML(displayName) + '</h1><span>' + escapeHTML(profile.username) + '</span></div>' +
    (profile.id !== currentUser.id ? '<button class="profile-follow' + (isFollowing ? ' is-following' : '') + '" type="button" data-profile-follow>' + (isFollowing ? 'Seguindo' : 'Seguir') + '</button>' : '<button class="profile-panel__you profile-edit-trigger" type="button" data-edit-profile>Editar perfil ↗</button>') +
    '</div>' + (profile.bio ? '<p class="profile-page__bio">' + escapeHTML(profile.bio) + '</p>' : '') +
    '<div class="profile-page__stats"><div><strong data-followers-count>' + (followers.count || 0) + '</strong><span>Seguidores</span></div><div><strong>' + (following.count || 0) + '</strong><span>Seguindo</span></div><div><strong>' + ((reviewsResult.data || []).length) + '</strong><span>Avaliações recentes</span></div></div></section>' +
    '<section class="profile-page__reviews"><div class="profile-page__section-heading"><div><p class="eyebrow">HISTÓRICO DO JOGADOR</p><h2>Avaliações</h2></div><span>' + ((reviewsResult.data || []).length).toString().padStart(2, '0') + ' / 20</span></div>' +
    (reviewsResult.error ? '<p class="profile-page__empty">Não foi possível carregar as avaliações.</p>' : reviewCards || '<p class="profile-page__empty">Este jogador ainda não publicou avaliações.</p>') + '</section>';

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
      followButton.textContent = isFollowing ? 'Seguindo' : 'Seguir';
      followButton.classList.toggle('is-following', isFollowing);
      followButton.disabled = false;
      const count = app.querySelector('[data-followers-count]');
      count.textContent = String(Math.max(0, Number(count.textContent) + (isFollowing ? 1 : -1)));
    });
  }

  const editProfileButton = app.querySelector('[data-edit-profile]');
  editProfileButton?.addEventListener('click', () => openProfileEditor(currentUser, profile));
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
          <label class="profile-editor__upload"><span>Foto de perfil</span><div class="profile-editor__preview profile-editor__preview--avatar" data-avatar-preview>${profile.avatar_url ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">' : '<span>' + escapeHTML((profile.display_name || profile.username || 'L').charAt(0).toUpperCase()) + '</span>'}</div><input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif"><small>PNG, JPG, WEBP ou GIF · até 5 MB</small></label>
          <label class="profile-editor__upload"><span>Imagem de capa</span><div class="profile-editor__preview profile-editor__preview--banner" data-banner-preview>${profile.banner_url ? '<img src="' + escapeHTML(profile.banner_url) + '" alt="">' : '<span>Prévia da capa</span>'}</div><input type="file" name="banner" accept="image/png,image/jpeg,image/webp,image/gif"><small>PNG, JPG, WEBP ou GIF · até 5 MB</small></label>
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

  for (const [field, previewSelector] of [['avatar', '[data-avatar-preview]'], ['banner', '[data-banner-preview]']]) {
    const input = form.elements[field];
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const preview = form.querySelector(previewSelector);
      const objectUrl = URL.createObjectURL(file);
      preview.innerHTML = '<img src="' + objectUrl + '" alt="Prévia">';
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
      <main class="container auth-shell auth-shell--welcome">
        <div class="row">
          <section class="col-sm-8 col-sm-offset-2 text-center">
            <h1>Ludus</h1>
            <p class="lead">Uma comunidade para compartilhar o que você joga.</p>
            <p>
              <button class="btn btn-default" type="button" data-mode="login">Entrar</button>
              <button class="btn btn-primary" type="button" data-mode="signup">Criar conta</button>
            </p>
          </section>
        </div>
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
    '<p class="form-message alert alert-info" data-message role="status" aria-live="polite" hidden></p></form>',
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
        if (result.session?.user) renderSignedIn(result.user);
        else showMessage('Cadastro recebido! Confira seu e-mail para confirmar a conta.', 'success');
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
  renderAuth('login');
  let authReady = false;
  supabase.auth.onAuthStateChange((event, session) => {
    authReady = true;
    if (event === 'SIGNED_IN' && session?.user) renderSignedIn(session.user);
    if (event === 'SIGNED_OUT') { activeUser = null; renderAuth('login'); }
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
  if (username) renderProfilePage(activeUser, username);
  else if (gameId) renderGamePage(activeUser, gameId);
  else if (reviewId) renderReviewPage(activeUser, reviewId);
  else if (window.location.hash === '#/buscar') renderSearchPage(activeUser);
  else renderSignedIn(activeUser);
});
