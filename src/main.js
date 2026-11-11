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

function profilePlaceholderMarkup() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.1"></circle><path d="M4.5 21a7.5 7.5 0 0 1 15 0"></path></svg>';
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

async function renderSignedIn(user) {
  activeUser = user;
  const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'jogador';
  app.innerHTML = `
    <div class="feed-shell">
      <header class="sidebar">
        <a class="brand sidebar__brand" href="./" aria-label="Ludus início">L<span>.</span></a>
        <div class="header-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>
          <input type="search" data-header-search placeholder="Buscar jogos ou jogadores..." autocomplete="off" aria-label="Buscar jogos ou jogadores">
          <div class="header-search__results" data-header-search-results hidden></div>
        </div>
        <div class="header-actions">
          <button class="record-button" type="button" data-open-composer>+ Fazer review</button>
          ${notificationControlMarkup()}
        </div>
        <div class="sidebar__bottom">
          <details class="account-menu" data-account-details>
            <summary class="sidebar-user" data-account-menu>
              <span class="sidebar-user__avatar" data-avatar> L </span>
              <span class="sidebar-user__identity"><strong data-display-name></strong><small data-username></small></span>
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
        <section class="feed-content" aria-label="Atividade da comunidade">
          <div class="section-heading"><div class="feed-heading__inner"><div class="feed-tabs" role="tablist" aria-label="Ordenar atividade"><button class="feed-tabs__button is-active" type="button" role="tab" aria-selected="true" data-feed-mode="popular">Popular</button><button class="feed-tabs__button" type="button" role="tab" aria-selected="false" data-feed-mode="following">Seguindo</button><button class="feed-tabs__button" type="button" role="tab" aria-selected="false" data-feed-mode="recent">Mais recentes</button></div><h2>Atividade recente</h2></div></div>
          <div class="feed-list" data-feed-list><div class="feed-loading">Carregando as histórias da comunidade…</div></div>
        </section>
        <aside class="feed-ad feed-ad--right" aria-label="Espaço reservado para publicidade"></aside>
      </main>
    </div>`;

  app.querySelector('[data-open-composer]').addEventListener('click', () => openReviewComposer(user));
  const displayName = app.querySelector('[data-display-name]');
  const username = app.querySelector('[data-username]');
  const avatar = app.querySelector('[data-avatar]');
  displayName.textContent = fallbackName;
  avatar.innerHTML = profilePlaceholderMarkup();

  const profileResult = await supabase.from('profiles')
    .select('username, display_name, avatar_url, banner_url, bio')
    .eq('id', user.id).maybeSingle();

  if (profileResult.data) {
    const fullName = profileResult.data.display_name || fallbackName;
    displayName.textContent = fullName.trim().split(/\s+/).slice(0, 2).join(' ');
    username.textContent = profileResult.data.username;
    if (profileResult.data.avatar_url) {
      avatar.innerHTML = '<img src="' + escapeHTML(profileResult.data.avatar_url) + '" alt="">';
    }
  } else {
    username.textContent = '';
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
      const [players, games] = await Promise.all([
        supabase.from('profiles').select('username, display_name, avatar_url').or('username.ilike.%' + safeQuery + '%,display_name.ilike.%' + safeQuery + '%').limit(5),
        supabase.from('games').select('title').ilike('title', '%' + safeQuery + '%').limit(5)
      ]);
      if (headerSearch.value.trim() !== query) return;
      const playerItems = (players.data || []).map((profile) =>
        '<button type="button" class="header-search__result" data-search-profile="' + escapeHTML(profile.username) + '">' +
        (profile.avatar_url ? '<img src="' + escapeHTML(profile.avatar_url) + '" alt="">' : '<span class="header-search__avatar">' + profilePlaceholderMarkup() + '</span>') +
        '<span><strong>' + escapeHTML(profile.display_name || profile.username) + '</strong><small>' + escapeHTML(profile.username) + '</small></span><em>JOGADOR</em></button>'
      ).join('');
      const uniqueGames = [...new Set((games.data || []).map((game) => game.title))];
      const gameItems = uniqueGames.map((title) =>
        '<button type="button" class="header-search__result header-search__result--game" data-search-game="' + escapeHTML(title) + '"><span class="header-search__game-icon">◈</span><span><strong>' + escapeHTML(title) + '</strong><small>Ver avaliações no feed</small></span><em>JOGO</em></button>'
      ).join('');
      searchResults.innerHTML = (playerItems || gameItems)
        ? '<p class="header-search__label">JOGADORES</p>' + (playerItems || '<small class="header-search__empty">Nenhum jogador encontrado</small>') +
          '<p class="header-search__label">JOGOS</p>' + (gameItems || '<small class="header-search__empty">Nenhum jogo encontrado</small>')
        : '<p class="header-search__empty">Nenhum resultado encontrado.</p>';
      searchResults.hidden = false;
    }, 220);
  });
  searchResults.addEventListener('click', (event) => {
    const player = event.target.closest('[data-search-profile]');
    const game = event.target.closest('[data-search-game]');
    if (player) {
      searchResults.hidden = true;
      navigateToProfile(user, player.dataset.searchProfile);
    } else if (game) {
      const title = game.dataset.searchGame.toLocaleLowerCase();
      app.querySelectorAll('.review-card').forEach((card) => {
        card.hidden = !card.querySelector('h3')?.textContent.toLocaleLowerCase().includes(title);
      });
      searchResults.hidden = true;
      headerSearch.value = game.dataset.searchGame;
    }
  });

  const routeUsername = getProfileUsernameFromLocation();
  if (routeUsername) {
    await renderProfilePage(user, routeUsername);
    return;
  }

  setupNotifications(user);

  const feedList = app.querySelector('[data-feed-list]');
  const { data: reviews, error } = await fetchAllPages(() => supabase.from('reviews')
    .select('id, user_id, game_id, rating, body, status, liked_game, created_at, profiles!reviews_user_id_fkey(username, display_name, avatar_url), games!reviews_game_id_fkey(title, cover_url, release_year, developer)')
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
    ? await fetchReviewRows('review_comments', 'review_id', reviewIds)
    : { data: [], error: null };
  if (commentsCountError) console.error('[Ludus] Falha ao carregar contagem de comentários:', commentsCountError);
  const commentCounts = (commentRows || []).reduce((counts, comment) => {
    counts[comment.review_id] = (counts[comment.review_id] || 0) + 1;
    return counts;
  }, {});

  const { data: followedProfiles, error: followedError } = await fetchAllPages(() => supabase.from('follows')
    .select('following_id').eq('follower_id', user.id));
  if (followedError) console.error('[Ludus] Falha ao carregar quem você segue:', followedError);
  const followedIds = new Set((followedProfiles || []).map((item) => item.following_id));
  const feedTabs = app.querySelector('[data-feed-mode="popular"]').closest('.feed-tabs');

  const renderFeed = (mode = 'popular') => {
    let visibleReviews = [...(reviews || [])];
    if (mode === 'following') {
      visibleReviews = visibleReviews.filter((review) => followedIds.has(review.user_id));
    } else if (mode === 'popular') {
      visibleReviews.sort((a, b) => {
        const scoreA = (likeCounts[a.id] || 0) + (commentCounts[a.id] || 0);
        const scoreB = (likeCounts[b.id] || 0) + (commentCounts[b.id] || 0);
        return scoreB - scoreA || new Date(b.created_at) - new Date(a.created_at);
      });
    } else {
      visibleReviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    feedTabs.querySelectorAll('[data-feed-mode]').forEach((button) => {
      const active = button.dataset.feedMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });

    if (!visibleReviews.length) {
      const message = mode === 'following'
        ? 'As avaliações de quem você segue aparecerão aqui.'
        : 'Ainda não há avaliações publicadas pela comunidade.';
      feedList.innerHTML = '<div class="feed-empty"><span class="feed-empty__number">01</span><h3>O feed ainda está em silêncio.</h3><p>' + message + '</p><span class="feed-empty__note">CADA JOGO TEM UMA HISTÓRIA.</span></div>';
      return;
    }

    feedList.innerHTML = visibleReviews.map((review) => {
      const username = review.profiles?.username || 'jogador';
      const author = username;
      const game = review.games?.title || 'Jogo';
      const gameYear = review.games?.release_year ? String(review.games.release_year) : '';
      const cover = '<div class="review-card__cover-wrap">' + (review.games?.cover_url
        ? '<img class="review-card__cover" src="' + escapeHTML(review.games.cover_url) + '" alt="Capa de ' + escapeHTML(game) + '" loading="lazy">'
        : '<div class="review-card__cover review-card__cover--empty">L<span>.</span></div>') + '</div>';
      const stars = '★'.repeat(review.rating) + '<span class="review-card__stars-muted">' + '★'.repeat(5 - review.rating) + '</span>';
      const isLiked = likedReviewIds.has(review.id);
      const avatarMarkup = review.profiles?.avatar_url
        ? '<img src="' + escapeHTML(review.profiles.avatar_url) + '" alt="" loading="lazy">'
        : profilePlaceholderMarkup();
      const isOwner = review.user_id === user.id;
      const menuMarkup = '<details class="review-menu"><summary aria-label="Mais opções da review" title="Mais opções"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg></summary><div class="review-menu__panel">' +
        (isOwner ? '<button type="button" data-review-action="edit">Editar review</button><button type="button" class="is-danger" data-review-action="delete">Excluir review</button>' : '<button type="button" data-review-action="report">Denunciar review</button>') + '</div></details>';
      const socialActions = '<div class="review-card__social-actions"><button class="review-card__like' + (isLiked ? ' is-liked' : '') + '" type="button" data-like-review aria-pressed="' + isLiked + '"><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M12 21s-8.8-5.9-8.8-12.2A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4C20.8 15.1 12 21 12 21Z"></path></svg><span data-like-label>Curtir review</span></button><span class="review-card__like-count" data-like-count>' + (likeCounts[review.id] || 0) + '</span><button class="review-card__comments-toggle" type="button" data-comments-toggle aria-expanded="false"><svg class="ui-icon ui-icon--comment" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M4 3.5h16A2.5 2.5 0 0 1 22.5 6v9a2.5 2.5 0 0 1-2.5 2.5h-8l-5.8 4v-4H4A2.5 2.5 0 0 1 1.5 15V6A2.5 2.5 0 0 1 4 3.5Z"></path></svg><span>Comentar review</span></button><span class="review-card__comment-count" data-comment-count>' + (commentCounts[review.id] || 0) + '</span></div>';
      return '<article class="review-card" data-review-id="' + review.id + '">' +
        '<div class="review-card__cover-column">' + cover + '<div class="review-card__actions">' + socialActions + '</div></div>' +
        '<div class="review-card__body"><div class="review-card__meta"><button class="review-card__author" type="button" data-profile-username="' + escapeHTML(username) + '"><span class="review-card__author-avatar">' + avatarMarkup + '</span><span>' + escapeHTML(author) + '</span></button><time>' + formatDate(review.created_at) + '</time></div>' + menuMarkup +
        '<h3>' + escapeHTML(game) + (gameYear ? ' <small class="review-card__year">' + escapeHTML(gameYear) + '</small>' : '') + '</h3><div class="review-card__details"><span class="review-card__stars" aria-label="Nota ' + review.rating + ' de 5">' + stars + '</span>' +
        (review.status ? '<span class="review-card__status">' + statusLabel(review.status) + '</span>' : '') +
        (review.liked_game ? '<span class="review-card__liked"><svg class="ui-icon ui-icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"></path></svg> Gostei</span>' : '') + '</div><section class="review-comments" data-comments-panel hidden></section></div>' +
        (review.body ? '<p class="review-card__text">' + escapeHTML(review.body) + '</p>' : '') + '</article>';
    }).join('');
  };

  feedTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-feed-mode]');
    if (button) renderFeed(button.dataset.feedMode);
  });
  renderFeed('popular');

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
    const button = event.target.closest('[data-like-review]');
    if (!button || button.disabled) return;
    const card = button.closest('[data-review-id]');
    const reviewId = card?.dataset.reviewId;
    if (!reviewId) return;
    const wasLiked = button.getAttribute('aria-pressed') === 'true';
    const count = card.querySelector('[data-like-count]');
    if (!count) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
      const request = wasLiked
        ? supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id).abortSignal(controller.signal)
        : supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id }).abortSignal(controller.signal);
      const result = await request;
      if (result.error) throw result.error;
      const nextLiked = !wasLiked;
      count.textContent = String(Math.max(0, Number(count.textContent) + (nextLiked ? 1 : -1)));
      button.setAttribute('aria-pressed', String(nextLiked));
      button.classList.toggle('is-liked', nextLiked);
      button.querySelector('[data-like-label]').textContent = 'Curtir review';
    } catch (error) {
      console.error('[Ludus] Falha ao atualizar curtida:', error);
      if (controller.signal.aborted) {
        console.warn('[Ludus] A requisição de curtida excedeu 10 segundos e foi cancelada.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
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
    ? '<label class="field"><span>Nome de usuário</span><input name="username" type="text" minlength="3" maxlength="16" pattern="[A-Za-z0-9._-]+" placeholder="seu.nome" autocomplete="username" required><small>Utilize letras, números e caracteres especiais</small></label><label class="field"><span>Como podemos chamar você?</span><input name="displayName" type="text" maxlength="60" placeholder="Seu nome" autocomplete="name" required></label>'
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
    '<label class="field"><span>' + (isSignup ? 'E-mail' : 'E-mail ou nome de usuário') + '</span><input name="' + (isSignup ? 'email' : 'identifier') + '" type="' + (isSignup ? 'email' : 'text') + '" placeholder="' + (isSignup ? 'voce@email.com' : 'E-mail ou usuário') + '" autocomplete="' + (isSignup ? 'email' : 'username') + '" required></label>',
    '<label class="field"><span>Senha</span><div class="password-field"><input name="password" type="password" minlength="6" placeholder="Mínimo de 6 caracteres" autocomplete="' + passwordAutocomplete + '" required><button class="password-toggle" type="button" data-password-toggle aria-label="Mostrar senha" title="Mostrar senha"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></label>',
    (!isSignup ? '<button class="text-button" type="button" data-reset>Esqueceu sua senha?</button>' : ''),
    (isSignup ? '<div class="auth-consents"><label class="auth-consent"><input type="checkbox" name="age_confirmed" required><span>Tenho mais de 16 anos</span></label><label class="auth-consent"><input type="checkbox" name="terms_accepted" required><span>Concordo com os <button class="terms-link" type="button" data-terms-open>termos de serviço</button></span></label></div>' : ''),
    '<button class="submit-button" type="submit">' + (isSignup ? 'Criar minha conta <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/><path d="m13 5 6 7-6 7"/></svg>' : 'Entrar <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/><path d="M3 12h12m-5-5 5 5-5 5"/></svg>') + '</button>',
    '<p class="form-message" data-message role="status" aria-live="polite" hidden></p></form>',
    '<div class="terms-modal" data-terms-modal hidden><div class="terms-modal__backdrop" data-terms-close></div><section class="terms-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="terms-title"><button class="terms-modal__close" type="button" data-terms-close aria-label="Fechar">×</button><p class="eyebrow">LUDUS · COMUNIDADE</p><h3 id="terms-title">Termos de serviço</h3><p>Este é um texto provisório. Os termos oficiais de serviço do Ludus ainda serão publicados.</p><p>Ao utilizar a plataforma, esperamos que todas as pessoas tratem a comunidade com respeito, não publiquem conteúdo ilegal ou ofensivo e respeitem os direitos de terceiros.</p><p>As funcionalidades, regras de convivência, privacidade e condições de uso serão detalhadas nesta página quando os termos oficiais forem definidos.</p><p class="terms-modal__note">VERSÃO PLACEHOLDER — NÃO É O TEXTO FINAL</p></section></div>',
    '</div></section></main>'
  ].join('');

  app.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => renderAuth(button.dataset.mode));
  });

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
      submit.innerHTML = isSignup ? 'Criar minha conta <span aria-hidden="true">＋</span>' : 'Entrar <span aria-hidden="true">↗</span>';
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
  if (username) renderProfilePage(activeUser, username);
  else renderSignedIn(activeUser);
});
