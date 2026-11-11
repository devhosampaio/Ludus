import { supabase } from './lib/supabase.js';
import { signIn, signOut, signUp, requestPasswordReset } from './lib/auth.js';

const app = document.querySelector('#app');
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

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
    .format(new Date(value)).replace('.', '');
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

  if (notificationChannel) {
    await supabase.removeChannel(notificationChannel);
    notificationChannel = null;
  }

  const trigger = root.querySelector('[data-notifications-toggle]');
  const panel = root.querySelector('[data-notifications-panel]');
  const list = root.querySelector('[data-notifications-list]');
  const badge = root.querySelector('[data-notification-count]');

  const refresh = async () => {
    const { data, error } = await supabase.from('notifications')
      .select('id, type, actor_id, review_id, created_at, read_at, profiles!notifications_actor_id_fkey(username, display_name)')
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
      return '<button class="notifications__item' + (item.read_at ? '' : ' is-unread') + '" type="button" data-notification-id="' + item.id + '" data-notification-type="' + item.type + '" data-review-id="' + (item.review_id || '') + '" data-actor-username="' + escapeHTML(username) + '">' +
        '<span class="notifications__item-dot" aria-hidden="true"></span><span class="notifications__item-content"><span><strong>' + escapeHTML(actor) + '</strong> ' + message + '</span><time>' + formatDate(item.created_at) + '</time></span></button>';
    }).join('');
  };

  root.addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-notifications-toggle]');
    if (toggle) {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if (opening) await refresh();
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


async function renderSignedIn(user) {
  activeUser = user;
  const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'jogador';
  app.innerHTML = `
    <div class="feed-shell">
      <aside class="sidebar">
        <a class="brand sidebar__brand" href="./" aria-label="Ludus início">L<span>.</span></a>
        <p class="sidebar__label">ESPAÇO DE JOGO</p>
        <nav class="side-nav" aria-label="Navegação principal">
          <a class="side-nav__link is-active" href="#inicio"><span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7"></path><path d="M5 9v12h14V9M9 21v-7h6v7"></path></svg></span> Início</a>
          <a class="side-nav__link" href="#explorar" data-inert-link><span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg></span> Explorar</a>
          <a class="side-nav__link" href="#perfil" data-open-own-profile><span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"></circle><path d="M4.5 21a7.5 7.5 0 0 1 15 0"></path></svg></span> Meu perfil</a>
        </nav>
        <div class="sidebar__bottom">
          <div class="sidebar-user"><span class="sidebar-user__avatar" data-avatar> L </span><span><strong data-display-name></strong><small data-username></small></span></div>
          <button class="logout-button" type="button" data-signout>Sair da conta ↗</button>
        </div>
      </aside>
      <main class="feed-main">
        <header class="feed-topbar">
          <div><p class="eyebrow" data-today></p><h1>Seu universo de jogos<span>.</span></h1></div>
          <div class="feed-topbar__actions">${notificationControlMarkup()}<button class="record-button" type="button" data-open-composer>+ Registrar jogo</button><div class="feed-topbar__mark">LUDUS <span>01 / FEED</span></div></div>
        </header>
        <section class="feed-welcome">
          <div><p class="eyebrow">BEM-VINDO AO LUDUS</p><h2>Todo jogo deixa<br>uma <em>história.</em></h2><p>Um espaço para registrar o que você joga e descobrir o que move outras pessoas.</p></div>
          <div class="feed-welcome__symbol" aria-hidden="true">L<span>.</span></div>
        </section>
        <section class="feed-content" aria-label="Atividade da comunidade">
          <div class="section-heading"><div><p class="eyebrow">DA COMUNIDADE</p><h2>Atividade recente</h2></div><span class="section-heading__index">01 — 20</span></div>
          <div class="feed-list" data-feed-list><div class="feed-loading">Carregando as histórias da comunidade…</div></div>
        </section>
      </main>
    </div>`;

  app.querySelector('[data-open-composer]').addEventListener('click', () => openReviewComposer(user));
  app.querySelector('[data-open-own-profile]').addEventListener('click', (event) => {
    event.preventDefault();
    if (profileResult.data?.username) navigateToProfile(user, profileResult.data.username);
  });
  app.querySelector('[data-today]').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()).toUpperCase();
  const displayName = app.querySelector('[data-display-name]');
  const username = app.querySelector('[data-username]');
  const avatar = app.querySelector('[data-avatar]');
  displayName.textContent = fallbackName;
  avatar.textContent = fallbackName.trim().charAt(0).toUpperCase() || 'L';

  app.querySelector('[data-signout]').addEventListener('click', async () => {
    try { await signOut(); renderAuth('login'); }
    catch (error) { console.error('[Ludus] Falha ao sair:', error); }
  });

  const profileResult = await supabase.from('profiles')
    .select('username, display_name, avatar_url')
    .eq('id', user.id).maybeSingle();

  if (profileResult.data) {
    displayName.textContent = profileResult.data.display_name || fallbackName;
    username.textContent = '@' + profileResult.data.username;
    if (profileResult.data.avatar_url) {
      avatar.innerHTML = '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="">';
    }
  } else {
    username.textContent = '';
  }

  const routeUsername = getProfileUsernameFromLocation();
  if (routeUsername) {
    await renderProfilePage(user, routeUsername);
    return;
  }

  setupNotifications(user);

  const feedList = app.querySelector('[data-feed-list]');
  const { data: reviews, error } = await supabase.from('reviews')
    .select('id, user_id, game_id, rating, body, status, liked_game, created_at, profiles!reviews_user_id_fkey(username, display_name, avatar_url), games!reviews_game_id_fkey(title, cover_url, release_year, developer)')
    .order('created_at', { ascending: false }).limit(20);

  if (error) {
    console.error('[Ludus] Falha ao carregar feed:', error);
    feedList.innerHTML = '<div class="feed-empty"><span class="feed-empty__number">!</span><h3>Não foi possível carregar o feed.</h3><p>Verifique sua conexão e tente atualizar a página.</p><button type="button" class="feed-retry" data-retry> Tentar novamente ↗</button></div>';
    feedList.querySelector('[data-retry]').addEventListener('click', () => renderSignedIn(user));
    return;
  }

  if (!reviews?.length) {
    feedList.innerHTML = '<div class="feed-empty"><span class="feed-empty__number">01</span><h3>O feed ainda está em silêncio.</h3><p>As primeiras histórias aparecem aqui quando alguém publicar uma avaliação. Que tal começar registrando um jogo que marcou você?</p><span class="feed-empty__note">CADA JOGO TEM UMA HISTÓRIA.</span></div>';
    return;
  }

  const reviewIds = reviews.map((review) => review.id);
  const { data: likes, error: likesError } = await supabase.from('review_likes')
    .select('review_id, user_id').in('review_id', reviewIds);
  if (likesError) console.error('[Ludus] Falha ao carregar curtidas:', likesError);
  const likeRows = likes || [];
  const likeCounts = likeRows.reduce((counts, like) => {
    counts[like.review_id] = (counts[like.review_id] || 0) + 1;
    return counts;
  }, {});
  const likedReviewIds = new Set(likeRows.filter((like) => like.user_id === user.id).map((like) => like.review_id));
  const { data: commentRows, error: commentsCountError } = await supabase.from('review_comments')
    .select('review_id').in('review_id', reviewIds);
  if (commentsCountError) console.error('[Ludus] Falha ao carregar contagem de comentários:', commentsCountError);
  const commentCounts = (commentRows || []).reduce((counts, comment) => {
    counts[comment.review_id] = (counts[comment.review_id] || 0) + 1;
    return counts;
  }, {});

  feedList.innerHTML = reviews.map((review) => {
    const author = review.profiles?.display_name || review.profiles?.username || 'jogador';
    const handle = review.profiles?.username ? '@' + review.profiles.username : '';
    const game = review.games?.title || 'Jogo';
    const gameYear = review.games?.release_year ? String(review.games.release_year) : '';
    const cover = review.games?.cover_url
      ? '<img class="review-card__cover" src="' + escapeHTML(review.games.cover_url) + '" alt="Capa de ' + escapeHTML(game) + '" loading="lazy">'
      : '<div class="review-card__cover review-card__cover--empty">L<span>.</span></div>';
    const stars = '★'.repeat(review.rating) + '<span class="review-card__stars-muted">' + '★'.repeat(5 - review.rating) + '</span>';
    const isLiked = likedReviewIds.has(review.id);
    return '<article class="review-card" data-review-id="' + review.id + '">' + cover +
      '<div class="review-card__body"><div class="review-card__meta"><button class="review-card__author" type="button" data-profile-username="' + escapeHTML(review.profiles?.username || '') + '">' + escapeHTML(author) + '</button><span>' + escapeHTML(handle) + '</span><time>' + formatDate(review.created_at) + '</time></div>' +
      '<h3>' + escapeHTML(game) + (gameYear ? ' <small class="review-card__year">(' + escapeHTML(gameYear) + ')</small>' : '') + '</h3><div class="review-card__details"><span class="review-card__stars" aria-label="Nota ' + review.rating + ' de 5">' + stars + '</span>' +
      (review.status ? '<span class="review-card__status">' + statusLabel(review.status) + '</span>' : '') +
      (review.liked_game ? '<span class="review-card__liked"><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"></path></svg> Gostei</span>' : '') + '</div>' +
      (review.body ? '<p class="review-card__text">' + escapeHTML(review.body) + '</p>' : '') +
      '<div class="review-card__actions">' + (review.user_id === user.id ? '<button class="review-card__edit" type="button" data-edit-review>Editar</button>' : '') + '<button class="review-card__like' + (isLiked ? ' is-liked' : '') + '" type="button" data-like-review aria-pressed="' + isLiked + '"><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"></path></svg> <span data-like-label>' + (isLiked ? 'Curtido' : 'Curtir') + '</span> <span class="review-card__like-count" data-like-count>' + (likeCounts[review.id] || 0) + '</span></button><button class="review-card__comments-toggle" type="button" data-comments-toggle aria-expanded="false">Conversar <span data-comment-count>' + (commentCounts[review.id] || 0) + '</span></button></div><section class="review-comments" data-comments-panel hidden></section></div></article>';
  }).join('');

  feedList.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault();
    const card = form.closest('[data-review-id]');
    const textarea = form.querySelector('textarea');
    const submit = form.querySelector('button[type="submit"]');
    const body = textarea.value.trim();
    if (!body || !card) return;
    submit.disabled = true;
    const { error: insertError } = await supabase.from('review_comments').insert({
      review_id: card.dataset.reviewId,
      user_id: user.id,
      body
    });
    if (insertError) {
      console.error('[Ludus] Falha ao publicar comentário:', insertError);
      submit.disabled = false;
      return;
    }
    const count = card.querySelector('[data-comment-count]');
    count.textContent = String(Number(count.textContent) + 1);
    await loadReviewComments(user, card);
  });

  feedList.addEventListener('click', async (event) => {
    const profileButton = event.target.closest('[data-profile-username]');
    if (profileButton?.dataset.profileUsername) {
      navigateToProfile(user, profileButton.dataset.profileUsername);
      return;
    }
    const commentsToggle = event.target.closest('[data-comments-toggle]');
    if (commentsToggle) {
      const card = commentsToggle.closest('[data-review-id]');
      const panel = card?.querySelector('[data-comments-panel]');
      if (!panel) return;
      const opening = panel.hidden;
      panel.hidden = !opening;
      commentsToggle.setAttribute('aria-expanded', String(opening));
      if (opening && panel.dataset.loaded !== 'true') {
        await loadReviewComments(user, card);
      }
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
      const count = card.querySelector('[data-comment-count]');
      count.textContent = String(Math.max(0, Number(count.textContent) - 1));
      return;
    }
    const editButton = event.target.closest('[data-edit-review]');
    if (editButton) {
      const card = editButton.closest('[data-review-id]');
      const review = reviews.find((item) => item.id === card?.dataset.reviewId);
      if (review && review.user_id === user.id) openReviewComposer(user, review);
      return;
    }
    const button = event.target.closest('[data-like-review]');
    if (!button || button.disabled) return;
    const card = button.closest('[data-review-id]');
    const reviewId = card?.dataset.reviewId;
    if (!reviewId) return;
    const wasLiked = button.getAttribute('aria-pressed') === 'true';
    button.disabled = true;
    const result = wasLiked
      ? await supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id)
      : await supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id });
    if (result.error) {
      console.error('[Ludus] Falha ao atualizar curtida:', result.error);
      button.disabled = false;
      return;
    }
    const count = button.querySelector('[data-like-count]');
    const nextLiked = !wasLiked;
    count.textContent = String(Math.max(0, Number(count.textContent) + (nextLiked ? 1 : -1)));
    button.setAttribute('aria-pressed', String(nextLiked));
    button.classList.toggle('is-liked', nextLiked);
    button.querySelector('[data-like-label]').textContent = nextLiked ? 'Curtido' : 'Curtir';
    button.disabled = false;
  });
}


async function loadReviewComments(user, card) {
  if (!card) return;
  const panel = card.querySelector('[data-comments-panel]');
  if (!panel) return;
  panel.innerHTML = '<p class="review-comments__loading">Carregando conversa…</p>';
  const { data: comments, error } = await supabase.from('review_comments')
    .select('id, user_id, body, created_at, profiles!review_comments_user_id_fkey(username, display_name, avatar_url)')
    .eq('review_id', card.dataset.reviewId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) {
    console.error('[Ludus] Falha ao carregar comentários:', error);
    panel.innerHTML = '<p class="review-comments__empty">Não foi possível carregar os comentários.</p>';
    return;
  }
  const rows = comments || [];
  panel.innerHTML = '<div class="review-comments__list">' +
    (rows.length ? rows.map((comment) => {
      const name = comment.profiles?.display_name || comment.profiles?.username || 'jogador';
      return '<article class="review-comment"><div class="review-comment__meta"><strong>' + escapeHTML(name) + '</strong><span>@' + escapeHTML(comment.profiles?.username || 'jogador') + '</span><time>' + formatDate(comment.created_at) + '</time>' +
        (comment.user_id === user.id ? '<button type="button" data-delete-comment="' + comment.id + '" aria-label="Excluir comentário">Excluir</button>' : '') +
        '</div><p>' + escapeHTML(comment.body) + '</p></article>';
    }).join('') : '<p class="review-comments__empty">Ainda não há comentários. Comece a conversa.</p>') +
    '</div><form class="review-comments__form" data-comment-form><textarea rows="2" maxlength="1000" placeholder="Escreva um comentário…" required></textarea><button type="submit">Publicar ↗</button></form>';
  panel.dataset.loaded = 'true';
}

function getProfileUsernameFromLocation() {
  const match = window.location.hash.match(/^#\/perfil\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
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
    '<div class="profile-page__heading"><p class="eyebrow">JOGADOR LUDUS</p><h1>' + escapeHTML(displayName) + '</h1><span>@' + escapeHTML(profile.username) + '</span></div>' +
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
        <label class="profile-editor__field"><span>Nome de usuário</span><div class="profile-editor__username"><b>@</b><input name="username" type="text" minlength="3" maxlength="16" pattern="[A-Za-z0-9._-]+" required value="${escapeHTML(profile.username || '')}" autocomplete="username"></div><small>3 a 16 caracteres: letras, números, pontos, _ ou -</small></label>
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
      message.textContent = 'O nome de usuário deve ter de 3 a 16 caracteres. Use letras, números, pontos, _ ou -.';
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

async function openReviewComposer(user, existingReview = null) {
  const existing = app.querySelector('.composer-overlay');
  existing?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'composer-overlay';
  overlay.innerHTML = `
    <section class="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
      <button class="composer__close" type="button" aria-label="Fechar" data-close>×</button>
      <p class="eyebrow">${existingReview ? 'SUA HISTÓRIA' : 'SUA PRÓXIMA HISTÓRIA'}</p>
      <h2 id="composer-title">${existingReview ? 'Editar avaliação' : 'Registrar um jogo'}<span>.</span></h2>
      <label class="composer__label" for="game-search" ${existingReview ? 'hidden' : ''}>Qual jogo você jogou?</label>
      <input class="composer__search" id="game-search" type="search" placeholder="Buscar pelo nome do jogo…" autocomplete="off" ${existingReview ? 'hidden disabled' : ''}>
      <div class="composer__results" data-game-results aria-live="polite"></div>
      <div class="composer__selected" data-selected hidden></div>
      <form class="composer__form" data-review-form hidden>
        <div class="composer__field">
          <label for="review-rating">Sua nota</label>
          <select id="review-rating" name="rating" required>
            <option value="5">5 — Obra-prima</option><option value="4">4 — Muito bom</option><option value="3">3 — Bom</option><option value="2">2 — Regular</option><option value="1">1 — Não gostei</option>
          </select>
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
  let selectedGame = existingReview ? { id: existingReview.game_id, ...(existingReview.games || {}) } : null;
  let timer;
  if (existingReview) {
    const game = existingReview.games || {};
    selected.hidden = false;
    selected.innerHTML = (game.cover_url ? '<img src="' + escapeHTML(game.cover_url) + '" alt="">' : '<span class="composer__cover-empty">L.</span>') +
      '<span><strong>' + escapeHTML(game.title || 'Jogo') + (game.release_year ? ' <small class="review-card__year">(' + escapeHTML(game.release_year) + ')</small>' : '') + '</strong><small>Jogo da avaliação</small></span>';
    form.hidden = false;
    form.elements.rating.value = String(existingReview.rating);
    form.elements.status.value = existingReview.status || 'playing';
    form.elements.liked_game.checked = Boolean(existingReview.liked_game);
    form.elements.body.value = existingReview.body || '';
    form.querySelector('[type="submit"]').textContent = 'Salvar alterações ↗';
  }

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
    selected.hidden = false;
    selected.innerHTML = (selectedGame.cover_url ? '<img src="' + escapeHTML(selectedGame.cover_url) + '" alt="">' : '<span class="composer__cover-empty">L.</span>') +
      '<span><strong>' + escapeHTML(selectedGame.title) + (selectedGame.release_year ? ' <small class="review-card__year">(' + escapeHTML(selectedGame.release_year) + ')</small>' : '') + '</strong><small>Jogo selecionado</small></span>' +
      '<button type="button" data-change-game>Trocar</button>';
    selected.querySelector('[data-change-game]').addEventListener('click', () => {
      selectedGame = null; selected.hidden = true; form.hidden = true; search.focus();
    });
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
    await renderSignedIn(user);
  });
}

function renderAuth(mode = 'login') {
  const isSignup = mode === 'signup';
  const fields = isSignup
    ? '<label class="field"><span>Nome de usuário</span><input name="username" type="text" minlength="3" maxlength="16" pattern="[A-Za-z0-9._-]+" placeholder="seu.nome" autocomplete="username" required><small>3 a 24 caracteres. Use letras, números ou _</small></label><label class="field"><span>Como podemos chamar você?</span><input name="displayName" type="text" maxlength="60" placeholder="Seu nome" autocomplete="name" required></label>'
    : '';
  const passwordAutocomplete = isSignup ? 'new-password' : 'current-password';

  app.innerHTML = [
    '<main class="auth-shell">',
    '<section class="auth-intro" aria-label="Ludus">',
    '<a class="brand" href="./" aria-label="Ludus início">L<span>.</span></a>',
    '<div class="auth-intro__copy"><h1>Todo jogo<br>deixa uma <em>história.</em></h1></div>',
    '<span class="auth-intro__credit">GRAND THEFT AUTO VI — ROCKSTAR GAMES</span>',
    '</section>',
    '<section class="auth-panel"><div class="auth-panel__inner">',
    '<div class="auth-panel__heading"><p class="eyebrow">' + (isSignup ? 'COMECE SUA JORNADA' : 'BEM-VINDO DE VOLTA') + '</p>',
    '<h2>' + (isSignup ? 'Crie sua conta.' : 'Entre no Ludus.') + '</h2>',
    '</div>',
    '<div class="auth-tabs" role="group" aria-label="Acesso à conta">',
    '<button class="auth-tabs__button ' + (!isSignup ? 'is-active' : '') + '" type="button" data-mode="login">Entrar</button>',
    '<button class="auth-tabs__button ' + (isSignup ? 'is-active' : '') + '" type="button" data-mode="signup">Criar conta</button></div>',
    '<form class="auth-form" id="auth-form">' + fields,
    '<label class="field"><span>E-mail</span><input name="email" type="email" placeholder="voce@email.com" autocomplete="email" required></label>',
    '<label class="field"><span>Senha</span><input name="password" type="password" minlength="6" placeholder="Mínimo de 6 caracteres" autocomplete="' + passwordAutocomplete + '" required></label>',
    (!isSignup ? '<button class="text-button" type="button" data-reset>Esqueceu sua senha?</button>' : ''),
    (isSignup ? '<div class="auth-consents"><label class="auth-consent"><input type="checkbox" name="age_confirmed" required><span>Tenho mais de 16 anos</span></label><label class="auth-consent"><input type="checkbox" name="terms_accepted" required><span>Concordo com os termos de serviço</span></label></div>' : ''),
    '<button class="submit-button" type="submit">' + (isSignup ? 'Criar minha conta <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/><path d="m13 5 6 7-6 7"/></svg>' : 'Entrar <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/><path d="M3 12h12m-5-5 5 5-5 5"/></svg>') + '</button>',
    '<p class="form-message" data-message role="status" aria-live="polite" hidden></p></form>',
    '<p class="auth-panel__legal">Ao continuar, você concorda em usar o Ludus com respeito à comunidade.</p>',
    '</div></section></main>'
  ].join('');

  app.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => renderAuth(button.dataset.mode));
  });

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
        const result = await signIn(values);
        renderSignedIn(result.user);
      }
    } catch (error) {
      showMessage(error.message || 'Não foi possível concluir. Tente novamente.', 'error');
      submit.disabled = false;
      submit.textContent = isSignup ? 'Criar minha conta ↗' : 'Entrar ↗';
    }
  });

  const resetButton = app.querySelector('[data-reset]');
  resetButton?.addEventListener('click', async () => {
    const email = app.querySelector('[name="email"]').value.trim();
    if (!email) {
      showMessage('Informe seu e-mail acima para receber o link de recuperação.', 'error');
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
  if (username) renderProfilePage(activeUser, username);
  else renderSignedIn(activeUser);
});
