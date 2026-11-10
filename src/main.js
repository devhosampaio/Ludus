import './styles/main.css';
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

function renderSignedIn(user) {
  const name = user.user_metadata?.display_name || user.email || 'jogador';
  app.innerHTML = [
    '<main class="signed-shell">',
    '<a class="brand" href="./">L<span>.</span></a>',
    '<p class="eyebrow">SUA JORNADA COMEÇA AQUI</p>',
    '<h1>Bem-vindo,<br><em></em>.</h1>',
    '<p class="signed-shell__copy">Sua conta está conectada. Em breve, seu feed de jogos estará aqui.</p>',
    '<button class="submit-button signed-shell__button" type="button" data-signout>Sair da conta <span>↗</span></button>',
    '</main>'
  ].join('');
  app.querySelector('h1 em').textContent = name;
  app.querySelector('[data-signout]').addEventListener('click', async () => {
    try { await signOut(); renderAuth('login'); }
    catch (error) { console.error('[Ludus] Falha ao sair:', error); }
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
  // Mostra a interface imediatamente; a restauração da sessão não deve bloquear a página.
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
