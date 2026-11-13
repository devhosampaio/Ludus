import { supabase } from './lib/supabase.js';
import { signIn, signOut, signUp, requestPasswordReset } from './lib/auth.js';

const app = document.querySelector('#app');
document.title = 'Ludus | Rede Social dos Gamers';
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
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.1"></circle><path d="M4.5 21a7.5 7.5 0 0 1 15 0"></path></svg>';
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
    abandoned: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15.5" cy="4.5" r="2" fill="currentColor"/><path d="m12 8 3-1 2 3 3 1m-8-3-3 4-3 1m6-5 2 4-2 4m-4-3-2 5m8-6 4 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  return icons[status] || '';
}

function statusLabel(status) {
  return ({ playing: 'Jogando', completed: 'Zerado', abandoned: 'Abandonado' })[status] || '';
}


let notificationChannel = null;

function notificationControlMarkup() {
  return '<div class="notifications" data-notifications>' +
    '<button class="notifications__trigger" type="button" data-notifications-toggle aria-label="Notificações" aria-expanded="false" title="Notificações">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>' +
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
async function renderSignedIn(user) {
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
      <header class="app-topbar">
        <div class="app-topbar__content">
          <a class="brand topbar__brand" href="./" aria-label="Ludus início">L<span>.</span></a>
          <div class="header-actions">
          <div class="header-search">
            <button class="header-search__toggle" type="button" data-search-toggle aria-label="Abrir busca" aria-expanded="false" title="Buscar">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>
            </button>
            <input type="search" data-header-search placeholder="Buscar..." autocomplete="off" aria-label="Buscar jogos ou jogadores">
            <div class="header-search__results" data-header-search-results hidden></div>
          </div>
          ${notificationControlMarkup()}
          </div>
          <details class="account-menu" data-account-details>
            <summary class="sidebar-user" data-account-menu>
              <span class="sidebar-user__avatar" data-avatar> L </span>
              <span class="sidebar-user__identity"><strong data-username></strong></span>
              <svg class="sidebar-user__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg>
            </summary>
            <div class="account-menu__panel" data-account-panel>
              <button type="button" data-open-own-profile>Ver perfil</button>
              <button type="button" data-account-settings>Configurações da conta</button>
              <div></div>
              <button type="button" data-signout>Encerrar sessão <span>↗</span></button>
            </div>
          </details>
        </div>
      </header>
      <main class="feed-main">
        <aside class="feed-ad feed-ad--left" aria-label="Espaço reservado para publicidade"></aside>
        <section class="feed-welcome" aria-label="Boas-vindas">
          <h1>Bem-vindo de volta, <strong data-welcome-name></strong>. Aqui está o que andam jogando...</h1>
          <p>A página inicial vai se adaptando conforme você segue novos jogadores no Ludus.</p>
        </section>
        <section class="newcomers-section" aria-labelledby="newcomers-title">
          <div class="newcomers-section__heading feed-section-heading">
            <h2 class="feed-section-heading__title" id="newcomers-title">NOVOS NO LUDUS</h2>
          </div>
          <div class="newcomers-list" data-newcomers-list>
            <div class="newcomers-list__loading">Descobrindo novas histórias…</div>
          </div>
        </section>
        <nav class="feed-navigation" aria-label="Navegação do feed"><div class="feed-tabs" role="tablist" aria-label="Navegação do feed"><button class="feed-tabs__button is-active" type="button" role="tab" aria-selected="true" data-feed-mode="home">Início</button><button class="feed-tabs__button" type="button" role="tab" aria-selected="false" data-feed-mode="popular">Para você</button><button class="feed-tabs__button" type="button" role="tab" aria-selected="false" data-feed-mode="following">Seguindo</button><button class="feed-tabs__button" type="button" role="tab" aria-selected="false" data-feed-mode="recent">Recentes</button></div></nav>
        <section class="feed-content" aria-label="Atividade da comunidade">
          <div class="section-heading feed-section-heading"><div class="feed-heading__inner"><h2 class="feed-section-heading__title" data-feed-title>Para você</h2></div></div>
          <div class="feed-list" data-feed-list><div class="feed-loading">Carregando as histórias da comunidade…</div></div>
        </section>
        <aside class="feed-ad feed-ad--right" aria-label="Espaço reservado para publicidade"></aside>
      </main>
    </div>`;

  const earlySearchWrap = app.querySelector('.header-search');
  const earlySearchToggle = app.querySelector('[data-search-toggle]');
  const earlySearchInput = app.querySelector('[data-header-search]');
  const earlySearchResults = app.querySelector('[data-header-search-results]');
  earlySearchToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const opening = !earlySearchWrap.classList.contains('is-open');
    earlySearchWrap.classList.toggle('is-open', opening);
    earlySearchToggle.setAttribute('aria-expanded', String(opening));
    if (opening) earlySearchInput.focus();
    else {
      earlySearchInput.value = '';
      earlySearchResults.hidden = true;
      earlySearchResults.innerHTML = '';
    }
  });
  document.addEventListener('click', (event) => {
    if (!earlySearchWrap.contains(event.target) && earlySearchWrap.classList.contains('is-open')) {
      earlySearchWrap.classList.remove('is-open');
      earlySearchToggle.setAttribute('aria-expanded', 'false');
      earlySearchResults.hidden = true;
    }
  });
  setupNotifications(user);

  const username = app.querySelector('[data-username]');
  const avatar = app.querySelector('[data-avatar]');
  username.textContent = fallbackName;
  avatar.innerHTML = profilePlaceholderMarkup();

  const profileResult = await supabase.from('profiles')
    .select('username, display_name, avatar_url, banner_url, bio')
    .eq('id', user.id).maybeSingle();

  const welcomeName = app.querySelector('[data-welcome-name]');
  if (profileResult.data) {
    username.textContent = profileResult.data.username || fallbackName;
    welcomeName.textContent = profileResult.data.display_name || profileResult.data.username || fallbackName;
    if (profileResult.data.avatar_url) {
      avatar.innerHTML = '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="">';
    }
  } else {
    username.textContent = '';
    welcomeName.textContent = fallbackName;
  }

  const accountDetails = app.querySelector('[data-account-details]');
  const closeAccountMenu = () => { accountDetails.open = false; };
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-account-details]')) closeAccountMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAccountMenu();
  });
  app.querySelector('[data-open-own-profile]').addEventListener('click', () => {
    closeAccountMenu();
    if (profileResult.data?.username) navigateToProfile(user, profileResult.data.username);
  });
  app.querySelector('[data-account-settings]').addEventListener('click', () => {
    closeAccountMenu();
    if (profileResult.data) openProfileEditor(user, profileResult.data);
  });
  app.querySelector('[data-signout]').addEventListener('click', async () => {
    try { await signOut(); renderAuth('login'); }
    catch (error) { console.error('[Ludus] Falha ao sair:', error); }
  });

  const headerSearch = app.querySelector('[data-header-search]');
  const searchResults = app.querySelector('[data-header-search-results]');
  const searchWrap = app.querySelector('.header-search');
  const searchToggle = app.querySelector('[data-search-toggle]');
  let searchTimer;
  headerSearch.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const query = headerSearch.value.trim().replace(/^@/, '');
    if (query.length < 2) {
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      app.querySelectorAll('.review-card').forEach((card) => { card.hidden = false; });
      return;
    }
    searchTimer = window.setTimeout(async () => {
      const safeQuery = query.replace(/[,%()]/g, ' ').trim();
      const [players, games, steamGrid] = await Promise.all([
        supabase.from('profiles').select('username, display_name, avatar_url').or('username.ilike.%' + safeQuery + '%,display_name.ilike.%' + safeQuery + '%').limit(5),
        supabase.from('games').select('id, title, release_year, cover_url').ilike('title', '%' + safeQuery + '%').limit(5),
        supabase.functions.invoke('steamgriddb', { body: { action: 'search', query: safeQuery } })
      ]);
      if (headerSearch.value.trim().replace(/^@/, '') !== query) return;
      const playerItems = (players.data || []).map((profile) =>
        '<button type="button" class="header-search__result header-search__result--player" data-search-profile="' + escapeHTML(profile.username) + '">' +
        (profile.avatar_url ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">' : '<span class="header-search__avatar">' + profilePlaceholderMarkup() + '</span>') +
        '<strong>' + escapeHTML(profile.username) + '</strong></button>'
      ).join('');
      const localGames = (games.data || []).map((game) => ({ ...game, source: 'local' }));
      const localTitles = new Set(localGames.map((game) => game.title.trim().toLocaleLowerCase()));
      const externalGames = (steamGrid.data?.data || [])
        .filter((game) => !localTitles.has(String(game.name || '').trim().toLocaleLowerCase()))
        .map((game) => ({
          id: game.id,
          title: game.name,
          release_year: game.release_year || null,
          cover_url: game.cover_url || null,
          source: 'steamgrid'
        }));
      const uniqueGames = [...new Map([...localGames, ...externalGames].map((game) => [game.source + ':' + game.id, game])).values()];
      const gameItems = uniqueGames.slice(0, 8).map((game) =>
        '<button type="button" class="header-search__result header-search__result--game" ' +
        (game.source === 'steamgrid' ? 'data-search-steamgrid-id="' + escapeHTML(game.id) + '" data-search-steamgrid-name="' + escapeHTML(game.title) + '"' : 'data-search-game-id="' + escapeHTML(game.id) + '"') + '>' +
        (game.cover_url ? '<span class="header-search__game-banner" style="background-image:linear-gradient(90deg, transparent 45%, #302c3d 100%),url(&quot;' + escapeHTML(game.cover_url) + '&quot;)"></span>' : '<span class="header-search__game-banner header-search__game-banner--empty"></span>') +
        '<strong>' + escapeHTML(game.title) + (game.release_year ? ' <small>(' + escapeHTML(game.release_year) + ')</small>' : '') + '</strong></button>'
      ).join('');
      searchResults.innerHTML = playerItems + gameItems || '<p class="header-search__empty">Nenhum resultado encontrado.</p>';
      searchResults.hidden = false;
    }, 220);
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
      searchWrap.classList.remove('is-open');
      searchToggle.setAttribute('aria-expanded', 'false');
      searchResults.hidden = true;
    }
  });

  searchResults.addEventListener('click', async (event) => {
    const player = event.target.closest('[data-search-profile]');
    const game = event.target.closest('[data-search-game-id]');
    const steamGridGame = event.target.closest('[data-search-steamgrid-id]');
    if (player) {
      searchResults.hidden = true;
      navigateToProfile(user, player.dataset.searchProfile);
    } else if (game) {
      searchResults.hidden = true;
      headerSearch.blur();
      navigateToGame(user, game.dataset.searchGameId);
    } else if (steamGridGame) {
      steamGridGame.disabled = true;
      steamGridGame.classList.add('is-loading');
      const { data, error } = await supabase.functions.invoke('steamgriddb', {
        body: { action: 'save', game: { id: steamGridGame.dataset.searchSteamgridId, name: steamGridGame.dataset.searchSteamgridName } }
      });
      if (error || !data?.game?.id) {
        console.error('[Ludus] Não foi possível adicionar o jogo encontrado:', error || data?.error);
        steamGridGame.disabled = false;
        steamGridGame.classList.remove('is-loading');
        return;
      }
      searchResults.hidden = true;
      headerSearch.blur();
      navigateToGame(user, data.game.id);
    }
  });

  const routeUsername = getProfileUsernameFromLocation();
  if (routeUsername) {
    await renderProfilePage(user, routeUsername);
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
  const { data: reviews, error } = await fetchAllPages(() => supabase.from('reviews')
    .select('id, user_id, game_id, rating, body, status, liked_game, created_at, profiles!reviews_user_id_fkey(username, display_name, avatar_url), games!reviews_game_id_fkey(title, cover_url, hero_url, release_year, developer, platforms)')
    .order('created_at', { ascending: false }));

  if (error) {
    console.error('[Ludus] Falha ao carregar feed:', error);
    feedList.innerHTML = '<div class="feed-empty"><span class="feed-empty__number">!</span><h3>Não foi possível carregar o feed.</h3><p>Verifique sua conexão e tente atualizar a página.</p><button type="button" class="feed-retry" data-retry> Tentar novamente ↗</button></div>';
    feedList.querySelector('[data-retry]').addEventListener('click', () => renderSignedIn(user));
    return;
  }

  const reviewIds = reviews.map((review) => review.id);
  const { data: likes, error: likesError } = reviewIds.length
    ? await fetchReviewRows('review_likes', 'review_id, user_id', reviewIds)
    : { data: [], error: null };
  if (likesError) console.error('[Ludus] Falha ao carregar curtidas:', likesError);
  const likeRows = likes || [];
  const likeCounts = likeRows.reduce((counts, like) => {
    counts[like.review_id] = (counts[like.review_id] || 0) + 1;
    return counts;
  }, {});
  const likedReviewIds = new Set(likeRows.filter((like) => like.user_id === user.id).map((like) => like.review_id));
  const { data: commentRows, error: commentsCountError } = reviewIds.length
    ? await fetchReviewRows('review_comments', 'id, review_id, user_id, body, created_at, parent_comment_id, profiles!review_comments_user_id_fkey(username, display_name, avatar_url)', reviewIds)
    : { data: [], error: null };
  if (commentsCountError) console.error('[Ludus] Falha ao carregar comentários:', commentsCountError);
  const commentCounts = (commentRows || []).reduce((counts, comment) => {
    counts[comment.review_id] = (counts[comment.review_id] || 0) + 1;
    return counts;
  }, {});
  const { data: savedReviewRowsData, error: savedReviewsError } = await fetchAllPages(() => supabase
    .from('review_saves').select('review_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false }));
  if (savedReviewsError) console.error('[Ludus] Falha ao carregar Minha lista:', savedReviewsError);
  const savedReviewRows = savedReviewRowsData || [];
  const savedReviewIds = new Set(savedReviewRows.map((saved) => saved.review_id));
  const savedAtByReview = new Map(savedReviewRows.map((saved) => [saved.review_id, saved.created_at]));
  const { data: saveCountRows, error: saveCountsError } = reviewIds.length
    ? await supabase.rpc('get_review_save_counts', { p_review_ids: reviewIds })
    : { data: [], error: null };
  if (saveCountsError) console.error('[Ludus] Falha ao carregar contagem de itens salvos:', saveCountsError);
  const saveCounts = (saveCountRows || []).reduce((counts, saved) => {
    counts[saved.review_id] = Number(saved.save_count || 0);
    return counts;
  }, {});
  const commentIds = (commentRows || []).map((comment) => comment.id);
  const { data: commentLikeRows, error: commentLikesError } = await fetchCommentLikeRows(commentIds);
  if (commentLikesError) console.error('[Ludus] Falha ao carregar curtidas dos comentários:', commentLikesError);
  const commentsByReview = (commentRows || []).reduce((grouped, comment) => {
    if (!grouped[comment.review_id]) grouped[comment.review_id] = [];
    grouped[comment.review_id].push(comment);
    return grouped;
  }, {});

  const { data: followedProfiles, error: followedError } = await fetchAllPages(() => supabase.from('follows')
    .select('following_id').eq('follower_id', user.id));
  if (followedError) console.error('[Ludus] Falha ao carregar quem você segue:', followedError);
  const followedIds = new Set((followedProfiles || []).map((item) => item.following_id));

  const gameTitleCounts = (reviews || []).reduce((counts, review) => {
    const title = String(review.games?.title || '').trim().toLocaleLowerCase('pt-BR');
    if (title) counts.set(title, (counts.get(title) || 0) + 1);
    return counts;
  }, new Map());
  const feedTabs = app.querySelector('[data-feed-mode="popular"]').closest('.feed-tabs');
  const newcomersSection = app.querySelector('.newcomers-section');
  const newcomersList = app.querySelector('[data-newcomers-list]');
  const renderNewcomers = () => {
    const newestReviews = [...(reviews || [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 6);
    if (!newestReviews.length) {
      newcomersList.innerHTML = '<p class="newcomers-list__empty">As primeiras avaliações da comunidade aparecerão aqui.</p>';
      return;
    }
    newcomersList.innerHTML = newestReviews.map((review) => {
      const profile = review.profiles || {};
      const username = profile.username || 'jogador';
      const gameData = review.games || {};
      const game = gameData.title || 'Jogo';
      const avatar = profile.avatar_url
        ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="" loading="lazy">'
        : profilePlaceholderMarkup();
      const cover = gameData.cover_url
        ? '<img class="newcomers-review__cover" src="' + escapeHTML(gameData.cover_url) + '" alt="Capa de ' + escapeHTML(game) + '" loading="lazy">'
        : '<span class="newcomers-review__cover newcomers-review__cover--empty">L<span>.</span></span>';
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
  newcomersSection.addEventListener('click', (event) => {
    const gameButton = event.target.closest('[data-open-game]');
    if (gameButton?.dataset.openGame) {
      navigateToGame(user, gameButton.dataset.openGame);
      return;
    }
    const profileButton = event.target.closest('[data-profile-username]');
    if (profileButton?.dataset.profileUsername) navigateToProfile(user, profileButton.dataset.profileUsername);
  });

  const feedWelcome = app.querySelector('.feed-welcome');
  const feedContent = app.querySelector('.feed-content');
  let activeFeedMode = 'home';
  const renderFeed = (mode = 'home') => {
    activeFeedMode = mode;
    const isHome = mode === 'home';
    feedWelcome.hidden = !isHome;
    newcomersSection.hidden = !isHome;
    feedContent.hidden = false;
    feedList.classList.toggle('is-popular-feed', mode === 'popular');

    let visibleReviews = [...(reviews || [])];
    if (mode === 'following') {
      visibleReviews = visibleReviews.filter((review) => followedIds.has(review.user_id));
    } else if (mode === 'saved') {
      visibleReviews = visibleReviews.filter((review) => savedReviewIds.has(review.id));
      visibleReviews.sort((a, b) => new Date(savedAtByReview.get(b.id) || b.created_at) - new Date(savedAtByReview.get(a.id) || a.created_at));
    } else if (mode === 'popular') {
      visibleReviews.sort((a, b) => {
        const scoreA = (likeCounts[a.id] || 0) + (commentCounts[a.id] || 0) + (saveCounts[a.id] || 0);
        const scoreB = (likeCounts[b.id] || 0) + (commentCounts[b.id] || 0) + (saveCounts[b.id] || 0);
        return scoreB - scoreA || new Date(b.created_at) - new Date(a.created_at);
      });
    } else {
      visibleReviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    const feedTitle = app.querySelector('[data-feed-title]');
    const activeTab = feedTabs.querySelector('[data-feed-mode="' + mode + '"]');
    if (feedTitle) feedTitle.textContent = isHome ? 'Últimas avaliações' : (activeTab?.textContent.trim() || 'Avaliações');

    feedTabs.querySelectorAll('[data-feed-mode]').forEach((button) => {
      const active = button.dataset.feedMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
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
      const normalizedGameTitle = game.trim().toLocaleLowerCase('pt-BR');
      const showGameYear = Boolean(gameYear && (gameTitleCounts.get(normalizedGameTitle) || 0) > 1);
      const gameTitleMarkup = '<span class="review-card__game-title">' + escapeHTML(game) + '</span>' +
        (showGameYear ? '<span class="review-card__game-year">(' + escapeHTML(gameYear) + ')</span>' : '');
      const platformList = Array.isArray(gameData.platforms) ? gameData.platforms : [];
      const platformText = platformList.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean).join(', ');
      const gameMeta = [platformText, gameYear, gameData.developer].filter(Boolean).map(escapeHTML).join(' <span aria-hidden="true">·</span> ');
      const cover = '<button class="review-card__cover-wrap" type="button" data-open-game="' + escapeHTML(review.game_id) + '" aria-label="Abrir página de ' + escapeHTML(game) + '">' + (gameData.cover_url
        ? '<img class="review-card__cover" src="' + escapeHTML(gameData.cover_url) + '" alt="Capa de ' + escapeHTML(game) + '" loading="lazy">'
        : '<span class="review-card__cover review-card__cover--empty">L<span>.</span></span>') + '</button>';
      const stars = '★'.repeat(review.rating) + '<span class="review-card__stars-muted">' + '★'.repeat(5 - review.rating) + '</span>';
      const isLiked = likedReviewIds.has(review.id);
      const avatarMarkup = review.profiles?.avatar_url
        ? '<img src="' + escapeHTML(review.profiles.avatar_url) + '" alt="" loading="lazy">'
        : profilePlaceholderMarkup();
      const isOwner = review.user_id === user.id;
      const menuMarkup = '<details class="review-menu"><summary aria-label="Mais opções da review" title="Mais opções"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle></svg></summary><div class="review-menu__panel">' +
        (isOwner ? '<button type="button" data-review-action="edit">Editar review</button><button type="button" class="is-danger" data-review-action="delete">Excluir review</button>' : '<button type="button" data-review-action="report">Denunciar review</button>') + '</div></details>';
      const likeTotal = likeCounts[review.id] || 0;
      const commentTotal = commentCounts[review.id] || 0;
      const saveTotal = saveCounts[review.id] || 0;
      const isSaved = savedReviewIds.has(review.id);
      const socialActions = '<div class="review-card__social-actions"><button class="review-card__like' + (isLiked ? ' is-liked' : '') + '" type="button" data-like-review aria-label="Curtir avaliação" title="Curtir avaliação" aria-pressed="' + isLiked + '"><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M12 21s-8.8-5.9-8.8-12.2A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4C20.8 15.1 12 21 12 21Z"></path></svg><span class="review-card__like-count" data-like-count>' + String(likeTotal) + '</span></button><button type="button" class="review-card__comments-toggle" data-open-review-comments aria-label="Abrir comentários" title="Abrir comentários"><svg class="ui-icon ui-icon--comment" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.25 11.5a7.75 7.75 0 0 1-7.75 7.75 8 8 0 0 1-3.5-.8L4 20l1.35-4.15a7.7 7.7 0 0 1-.85-3.6 7.75 7.75 0 0 1 7.75-7.75h.5a7.75 7.75 0 0 1 7.5 7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="review-card__comment-count" data-comment-count>' + String(commentTotal) + '</span></button><button type="button" class="review-card__bookmark' + (isSaved ? ' is-saved' : '') + '" data-save-review aria-label="' + (isSaved ? 'Remover da lista' : 'Adicionar à lista') + '" title="' + (isSaved ? 'Na sua lista' : 'Adicionar à lista') + '" aria-pressed="' + isSaved + '"><svg class="ui-icon ui-icon--bookmark" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h10a1.75 1.75 0 0 1 1.75 1.75V21L12 16.5 5.25 21V5.5A1.75 1.75 0 0 1 7 3.75Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="review-card__save-count" data-save-count>' + String(saveTotal) + '</span></button></div>';
      const body = review.body || '';
      const reviewText = body ? '<div class="review-card__text-wrap"><p class="review-card__text" data-review-text>' + escapeHTML(body) + '</p></div>' : '';
      const reviewAuthor = '<div class="review-card__header"><div class="review-card__meta"><div class="review-card__author-line"><button class="review-card__author" type="button" data-profile-username="' + escapeHTML(username) + '"><span class="review-card__author-avatar">' + avatarMarkup + '</span><span class="review-card__author-name">' + escapeHTML(author) + '</span></button><span class="review-card__posted-at">' + relativeTime(review.created_at) + '</span></div>' + menuMarkup + '</div></div>';
      const reviewDetails = '<div class="review-card__details"><span class="review-card__stars" aria-label="Nota ' + review.rating + ' de 5">' + stars + '</span>' +
        (review.liked_game ? '<span class="review-card__liked" aria-label="Gostou do jogo" title="Gostou do jogo"><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M12 21s-8.8-5.9-8.8-12.2A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4C20.8 15.1 12 21 12 21Z"></path></svg></span>' : '') +
        (review.status ? '<span class="review-card__status" aria-label="' + statusLabel(review.status) + '" title="' + statusLabel(review.status) + '">' + statusIconMarkup(review.status) + '<span class="review-card__status-label">' + statusLabel(review.status) + '</span></span>' : '') + '</div>';
      return '<article class="review-card" data-review-id="' + review.id + '">' +
        '<div class="review-card__game-layout">' +
          (gameData.hero_url ? '<div class="review-card__backdrop" aria-hidden="true"><img src="' + escapeHTML(gameData.hero_url) + '" alt="" loading="lazy"></div>' : '') +
          '<div class="review-card__cover-column">' + cover + '</div>' +
          '<div class="review-card__body">' + reviewAuthor + '<h3 class="review-card__game-heading">' + gameTitleMarkup + '</h3>' + reviewDetails + '</div>' +
        '</div>' +
        reviewText +
        '<div class="review-card__actions">' + socialActions + '</div></article>';
    }).join('');
  };

  feedTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-feed-mode]');
    if (button) renderFeed(button.dataset.feedMode);
  });
  renderFeed('home');

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

    const gameCoverButton = event.target.closest('[data-open-game]');
    if (gameCoverButton) {
      const gameId = gameCoverButton.dataset.openGame;
      if (gameId) navigateToGame(user, gameId);
      return;
    }
    const profileButton = event.target.closest('[data-profile-username]');
    if (profileButton?.dataset.profileUsername) {
      navigateToProfile(user, profileButton.dataset.profileUsername);
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
  app.innerHTML = '<main class="profile-page review-detail-page"><header class="profile-page__topbar"><a class="brand" href="#inicio">L<span>.</span></a><div class="profile-page__topbar-label"><span>COMUNIDADE / DISCUSSÕES</span><strong>COMENTÁRIOS</strong></div><button class="profile-page__back" type="button" data-review-back>← <span>Voltar ao feed</span></button></header><div class="profile-page__content"><div class="profile-page__loading">Carregando avaliação…</div></div></main>';
  app.querySelector('[data-review-back]')?.addEventListener('click', () => navigateToFeed(currentUser));
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
    <main class="profile-page game-page">
      <header class="profile-page__topbar">
        <a class="brand" href="#inicio" data-game-back aria-label="Ludus início">L<span>.</span></a>
        <div class="profile-page__topbar-label"><span>CATÁLOGO / JOGOS</span><strong>JOGO</strong></div>
        ${notificationControlMarkup()}
        <button class="profile-page__back" type="button" data-game-back>← <span>Voltar ao feed</span></button>
      </header>
      <div class="profile-page__content">
        <div class="profile-page__loading">Carregando jogo…</div>
      </div>
    </main>`;
  app.querySelectorAll('[data-game-back]').forEach((button) => {
    button.addEventListener('click', () => navigateToFeed(currentUser));
  });
  setupNotifications(currentUser);

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
    ? 'style="background-image:linear-gradient(90deg, rgb(48 44 61 / 18%), #302c3d 100%),url(&quot;' + escapeHTML(game.hero_url) + '&quot;)"'
    : '';
  const cover = game.cover_url
    ? '<img class="game-page__cover" src="' + escapeHTML(game.cover_url) + '" alt="">'
    : '<div class="game-page__cover game-page__cover--empty">L.</div>';
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

function navigateToFeed(currentUser) {
  if (window.location.hash !== '#inicio') {
    window.history.pushState({ page: 'feed' }, '', '#inicio');
  }
  renderSignedIn(currentUser);
}

async function renderProfilePage(currentUser, username) {
  const requestId = (renderProfilePage.requestId || 0) + 1;
  renderProfilePage.requestId = requestId;
  app.innerHTML = `
    <main class="profile-page">
      <header class="profile-page__topbar">
        <a class="brand" href="#inicio" data-profile-back aria-label="Ludus início">L<span>.</span></a>
        <div class="profile-page__topbar-label"><span>COMUNIDADE / JOGADORES</span><strong>PERFIL</strong></div>
        ${notificationControlMarkup()}
        <button class="profile-page__back" type="button" data-profile-back>← <span>Voltar ao feed</span></button>
      </header>
      <div class="profile-page__content">
        <div class="profile-page__loading">Carregando perfil…</div>
      </div>
    </main>`;
  app.querySelectorAll('[data-profile-back]').forEach((button) => {
    button.addEventListener('click', () => navigateToFeed(currentUser));
  });
  setupNotifications(currentUser);

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
      : '<div class="profile-review__cover profile-review__cover--empty">L.</div>';
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
  app.querySelector('.profile-editor-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'profile-editor-overlay';
  overlay.innerHTML = `
    <section class="profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
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
  app.append(overlay);
  const form = overlay.querySelector('[data-profile-form]');
  const message = overlay.querySelector('[data-editor-message]');
  const close = () => overlay.remove();
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

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
      close();
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
        <div class="composer__field">
          <label for="review-status">Status</label>
          <select id="review-status" name="status"><option value="playing">Jogando</option><option value="completed">Zerado</option><option value="abandoned">Abandonado</option></select>
        </div>
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
      : '<span class="composer__cover-empty">L.</span>') +
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
      status: values.status,
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
      <main class="auth-shell auth-shell--welcome">
        <section class="auth-intro" aria-label="Ludus">
          <a class="brand" href="./" aria-label="Ludus início">L<span>.</span></a>
          <div class="auth-welcome-content">
            <h1>Todo jogo<br>deixa uma <em>história.</em></h1>
            <div class="auth-welcome-actions">
              <button class="auth-welcome-button auth-welcome-button--login" type="button" data-mode="login">
                <span>Entrar</span>
                <span class="auth-welcome-button__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M3 12h12m-5-5 5 5-5 5"/></svg>
                </span>
              </button>
              <button class="auth-welcome-button auth-welcome-button--signup" type="button" data-mode="signup">
                <span>Criar conta</span>
                <span class="auth-welcome-button__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0M19 8v8m-4-4h8"/></svg>
                </span>
              </button>
            </div>
          </div>
          <span class="auth-intro__credit">GRAND THEFT AUTO VI — ROCKSTAR GAMES</span>
        </section>
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
    '<main class="auth-shell auth-shell--split">',
    '<section class="auth-intro" aria-label="Ludus">',
    '<a class="brand" href="./" aria-label="Ludus início">L<span>.</span></a>',
    '<div class="auth-welcome-content">',
    '<h1>Todo jogo<br>deixa uma <em>história.</em></h1>',
    '</div>',
    '<span class="auth-intro__credit">GRAND THEFT AUTO VI — ROCKSTAR GAMES</span>',
    '</section>',
    '<section class="auth-panel" aria-label="' + (isSignup ? 'Criar conta' : 'Entrar no Ludus') + '"><div class="auth-panel__inner">',
    '<nav class="auth-switch" aria-label="Acesso à conta"><button class="auth-switch__button ' + (!isSignup ? 'is-active' : '') + '" type="button" data-mode="login" ' + (!isSignup ? 'aria-current="page"' : '') + '>Entrar</button><button class="auth-switch__button ' + (isSignup ? 'is-active' : '') + '" type="button" data-mode="signup" ' + (isSignup ? 'aria-current="page"' : '') + '>Criar conta</button></nav>',
    '<div class="auth-panel__heading">',
    '<h2>' + (isSignup ? 'Crie sua conta.' : 'Entre no Ludus.') + '</h2>',
    '</div>',

    '<form class="auth-form" id="auth-form">' + fields,
    '<label class="field"><span>' + (isSignup ? 'E-mail' : 'E-mail ou nome de usuário') + '</span><input name="' + (isSignup ? 'email' : 'identifier') + '" type="' + (isSignup ? 'email' : 'text') + '" placeholder="' + (isSignup ? 'voce@email.com' : 'E-mail ou usuário') + '" autocomplete="' + (isSignup ? 'email' : 'username') + '" required></label>',
    '<label class="field"><span>Senha</span><div class="password-field"><input name="password" type="password" minlength="6" placeholder="Mínimo de 6 caracteres" autocomplete="' + passwordAutocomplete + '" required><button class="password-toggle" type="button" data-password-toggle aria-label="Mostrar senha" title="Mostrar senha"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></label>',
    (!isSignup ? '<button class="text-button" type="button" data-reset>Esqueceu sua senha?</button>' : ''),
    (isSignup ? '<div class="auth-consents"><label class="auth-consent"><input type="checkbox" name="age_confirmed" required><span>Tenho mais de 16 anos</span></label><label class="auth-consent"><input type="checkbox" name="terms_accepted" required><span>Concordo com os <button class="terms-link" type="button" data-terms-open>termos de serviço</button></span></label></div>' : ''),
    '<button class="submit-button" type="submit"><span>' + (isSignup ? 'Criar minha conta' : 'Entrar') + '</span><span class="submit-button__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M3 12h12m-5-5 5 5-5 5"/></svg></span></button>',
    '<p class="form-message" data-message role="status" aria-live="polite" hidden></p></form>',
    '<div class="terms-modal" data-terms-modal hidden><div class="terms-modal__backdrop" data-terms-close></div><section class="terms-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="terms-title"><button class="terms-modal__close" type="button" data-terms-close aria-label="Fechar">×</button><p class="eyebrow">LUDUS · COMUNIDADE</p><h3 id="terms-title">Termos de serviço</h3><p>Este é um texto provisório. Os termos oficiais de serviço do Ludus ainda serão publicados.</p><p>Ao utilizar a plataforma, esperamos que todas as pessoas tratem a comunidade com respeito, não publiquem conteúdo ilegal ou ofensivo e respeitem os direitos de terceiros.</p><p>As funcionalidades, regras de convivência, privacidade e condições de uso serão detalhadas nesta página quando os termos oficiais forem definidos.</p><p class="terms-modal__note">VERSÃO PLACEHOLDER — NÃO É O TEXTO FINAL</p></section></div>',
    '</div></section></main>'
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
  app.innerHTML = '<main class="setup-shell"><a class="brand" href="./">L<span>.</span></a><p class="eyebrow">CONFIGURAÇÃO NECESSÁRIA</p><h1>Estamos preparando<br><em>o Ludus.</em></h1><p>As credenciais públicas do Supabase ainda não foram carregadas nesta publicação.</p></main>';
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
  else renderSignedIn(activeUser);
});
