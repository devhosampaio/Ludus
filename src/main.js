import './styles/main.css';
import { supabase } from './lib/supabase.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="welcome">
    <div class="welcome__mark" aria-hidden="true">L.</div>
    <p class="welcome__eyebrow">UM ESPAÇO PARA QUEM JOGA</p>
    <h1 class="welcome__title">Ludus<span>.</span></h1>
    <p class="welcome__description">
      Jogos são melhores quando fazem parte de uma história.
    </p>
    <div class="welcome__status">
      <span class="welcome__status-dot"></span>
      <span>Projeto iniciado</span>
    </div>
  </main>
`;

if (!supabase) {
  console.info(
    '[Ludus] Supabase ainda não configurado. Defina as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.'
  );
} else {
  console.info('[Ludus] Cliente Supabase inicializado.');
}