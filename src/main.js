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
          <div class="feed-topbar__mark">LUDUS <span>01 / FEED</span></div>
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
