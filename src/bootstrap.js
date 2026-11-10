import('./main.js').catch((error) => {
  console.error('[Ludus] Falha ao iniciar a aplicação:', error);
  const app = document.querySelector('#app');
  if (app) {
    const detail = error?.message || String(error);
    app.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;padding:32px;background:#302c3d;color:#f5f0e6;font:16px system-ui,sans-serif;text-align:center">
        <div style="max-width:560px">
          <p style="font-size:20px">Não foi possível iniciar o Ludus.</p>
          <p style="opacity:.75;overflow-wrap:anywhere">${detail.replace(/[&<>"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]))}</p>
          <button onclick="location.reload()" style="margin-top:18px;padding:12px 20px">Tentar novamente</button>
        </div>
      </main>`;
  }
});