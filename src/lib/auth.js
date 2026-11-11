import { supabase } from './supabase.js';

function requireClient() {
  if (!supabase) throw new Error('O serviço ainda não está configurado.');
  return supabase;
}

export async function signUp({ username, displayName, email, password }) {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { username: username.trim(), display_name: displayName.trim() },
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithUsername({ username, password }) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('username-login', {
    body: { username: username.trim(), password }
  });
  if (error || !data?.session) {
    throw new Error(data?.error || 'Usuário ou senha incorretos.');
  }
  const { data: sessionData, error: sessionError } = await client.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
  });
  if (sessionError) throw sessionError;
  return sessionData;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (error) throw error;
}
