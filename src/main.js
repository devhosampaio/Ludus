import { supabase } from './lib/supabase.js';
import { signIn, signOut, signUp, requestPasswordReset } from './lib/auth.js';

const app = document.querySelector('#app');

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

async function renderSignedIn(user) {
  const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'jogador';
  app.innerHTML = `
    <div class="feed-shell">
      <aside class="sidebar">
        <a class="brand sidebar__brand" href="./" aria-label="Ludus início">L<span>.</span></a>
        <p class="sidebar__label">ESPAÇO DE JOGO</p>
        <nav class="side-nav" aria-label="Navegação principal">
          <a class="side-nav__link is-active" href="#inicio"><span>⌂</span> Início</a>
          <a class="side-nav__link" href="#explorar" data-inert-link><span>⌕</span> Explorar</a>
          <a class="side-nav__link" href="#perfil" data-inert-link><span>◉</span> Meu perfil</a>
        </nav>
        <div class="sidebar__bottom">
          <div class="sidebar-user"><span class="sidebar-user__avatar" data-avatar> L </span><span><strong data-display-name></strong><small data-username></small></span></div>
          <button class="logout-button" type="button" data-signout>Sair da conta ↗</button>
        </div>
      </aside>
      <main class="feed-main">
        <header class="feed-topbar">
          <div><p class="eyebrow" data-today></p><h1>Seu universo de jogos<span>.</span></h1></div>
          <div class="feed-topbar__actions"><button class="record-button" type="button" data-open-composer>+ Registrar jogo</button><div class="feed-topbar__mark">LUDUS <span>01 / FEED</span></div></div>
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

  const feedList = app.querySelector('[data-feed-list]');
  const { data: reviews, error } = await supabase.from('reviews')
    .select('id, rating, body, status, liked_game, created_at, profiles(username, display_name, avatar_url), games(title, cover_url, release_year, developer)')
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

  feedList.innerHTML = reviews.map((review) => {
    const author = review.profiles?.display_name || review.profiles?.username || 'jogador';
    const handle = review.profiles?.username ? '@' + review.profiles.username : '';
    const game = review.games?.title || 'Jogo';
    const cover = review.games?.cover_url
      ? '<img class="review-card__cover" src="' + escapeHTML(review.games.cover_url) + '" alt="Capa de ' + escapeHTML(game) + '" loading="lazy">'
      : '<div class="review-card__cover review-card__cover--empty">L<span>.</span></div>';
    const stars = '★'.repeat(review.rating) + '<span class="review-card__stars-muted">' + '★'.repeat(5 - review.rating) + '</span>';
    return '<article class="review-card">' + cover +
      '<div class="review-card__body"><div class="review-card__meta"><strong>' + escapeHTML(author) + '</strong><span>' + escapeHTML(handle) + '</span><time>' + formatDate(review.created_at) + '</time></div>' +
      '<h3>' + escapeHTML(game) + '</h3><div class="review-card__details"><span class="review-card__stars" aria-label="Nota ' + review.rating + ' de 5">' + stars + '</span>' +
      (review.status ? '<span class="review-card__status">' + statusLabel(review.status) + '</span>' : '') +
      (review.liked_game ? '<span class="review-card__liked">♥ Gostei</span>' : '') + '</div>' +
      (review.body ? '<p class="review-card__text">' + escapeHTML(review.body) + '</p>' : '') + '</div></article>';
  }).join('');
}


async function openReviewComposer(user) {
  const existing = app.querySelector('.composer-overlay');
  existing?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'composer-overlay';
  overlay.innerHTML = `
    <section class="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
      <button class="composer__close" type="button" aria-label="Fechar" data-close>×</button>
      <p class="eyebrow">SUA PRÓXIMA HISTÓRIA</p>
      <h2 id="composer-title">Registrar um jogo<span>.</span></h2>
      <label class="composer__label" for="game-search">Qual jogo você jogou?</label>
      <input class="composer__search" id="game-search" type="search" placeholder="Buscar pelo nome do jogo…" autocomplete="off">
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
        <label class="composer__liked"><input type="checkbox" name="liked_game"> <span>♥ Gostei deste jogo</span></label>
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
  let selectedGame = null;
  let timer;

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
      results.innerHTML = data.data.map((game) =>
        '<button class="composer__result" type="button" data-game-id="' + Number(game.id) + '" data-game-name="' + escapeHTML(game.name) + '">' +
        '<span>' + escapeHTML(game.name) + '</span><span>Selecionar ↗</span></button>'
      ).join('');
    }, 350);
  });

  results.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-game-id]');
    if (!button) return;
    results.innerHTML = '<p class="composer__hint">Preparando jogo…</p>';
    const { data, error } = await supabase.functions.invoke('steamgriddb', {
      body: { action: 'save', game: { id: Number(button.dataset.gameId), name: button.dataset.gameName } }
    });
    if (error || data?.error || !data?.game) {
      results.innerHTML = '<p class="composer__hint">' + escapeHTML(data?.error || 'Não foi possível selecionar esse jogo.') + '</p>';
      return;
    }
    selectedGame = data.game;
    results.innerHTML = '';
    selected.hidden = false;
    selected.innerHTML = (selectedGame.cover_url ? '<img src="' + escapeHTML(selectedGame.cover_url) + '" alt="">' : '<span class="composer__cover-empty">L.</span>') +
      '<span><strong>' + escapeHTML(selectedGame.title) + '</strong><small>Jogo selecionado</small></span>' +
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
    submit.textContent = 'Publicando…';
    message.textContent = '';
    const { error } = await supabase.from('reviews').insert({
      user_id: user.id,
      game_id: selectedGame.id,
      rating: Number(values.rating),
      status: values.status,
      liked_game: form.elements.liked_game.checked,
      body: String(values.body || '').trim() || null,
    });
    if (error) {
      console.error('[Ludus] Falha ao publicar avaliação:', error);
      message.textContent = error.code === '23505'
        ? 'Você já publicou uma avaliação deste jogo. A edição estará disponível em breve.'
        : 'Não foi possível publicar. Verifique sua conexão e tente novamente.';
      submit.disabled = false;
      submit.textContent = 'Publicar avaliação ↗';
      return;
    }
    close();
    await renderSignedIn(user);
  });
}

function renderAuth(mode = 'login') {
  const isSignup = mode === 'signup';
  const fields = isSignup
    ? '<label class="field"><span>Nome de usuário</span><input name="username" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" placeholder="seu_usuario" autocomplete="username" required><small>3 a 24 caracteres. Use letras, números ou _</small></label><label class="field"><span>Como podemos chamar você?</span><input name="displayName" type="text" maxlength="60" placeholder="Seu nome" autocomplete="name" required></label>'
    : '';
  const passwordAutocomplete = isSignup ? 'new-password' : 'current-password';

  app.innerHTML = [
    '<main class="auth-shell">',
    '<section class="auth-intro" aria-label="Ludus">',
    '<a class="brand" href="./" aria-label="Ludus início">L<span>.</span></a>',
    '<div class="auth-intro__copy"><p class="eyebrow">UM ESPAÇO PARA QUEM JOGA</p>',
    '<h1>Todo jogo<br>deixa uma <em>história.</em></h1>',
    '<p class="auth-intro__description">Registre suas experiências, descubra novos jogos e encontre pessoas que também vivem cada partida.</p></div>',
    '<span class="auth-intro__foot">LUDUS — SUA HISTÓRIA EM JOGO</span>',
    '</section>',
    '<section class="auth-panel"><div class="auth-panel__inner">',
    '<div class="auth-panel__heading"><p class="eyebrow">' + (isSignup ? 'COMECE SUA JORNADA' : 'BEM-VINDO DE VOLTA') + '</p>',
    '<h2>' + (isSignup ? 'Crie sua conta.' : 'Entre no Ludus.') + '</h2>',
    '<p>' + (isSignup ? 'Seu espaço para guardar tudo o que os jogos significam.' : 'Continue de onde sua próxima história começa.') + '</p></div>',
    '<div class="auth-tabs" role="group" aria-label="Acesso à conta">',
    '<button class="auth-tabs__button ' + (!isSignup ? 'is-active' : '') + '" type="button" data-mode="login">Entrar</button>',
    '<button class="auth-tabs__button ' + (isSignup ? 'is-active' : '') + '" type="button" data-mode="signup">Criar conta</button></div>',
    '<form class="auth-form" id="auth-form">' + fields,
    '<label class="field"><span>E-mail</span><input name="email" type="email" placeholder="voce@email.com" autocomplete="email" required></label>',
    '<label class="field"><span>Senha</span><input name="password" type="password" minlength="6" placeholder="Mínimo de 6 caracteres" autocomplete="' + passwordAutocomplete + '" required></label>',
    (!isSignup ? '<button class="text-button" type="button" data-reset>Esqueceu sua senha?</button>' : ''),
    '<button class="submit-button" type="submit">' + (isSignup ? 'Criar minha conta' : 'Entrar') + ' <span>↗</span></button>',
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
    if (event === 'SIGNED_OUT') renderAuth('login');
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
