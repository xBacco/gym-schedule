// Wrapper testabili attorno a supabase.auth.*.
// Il rendering DOM (renderAuthScreen) è in fondo e non è coperto da test puri.

const ERR_MAP = {
  invalid_credentials: "Email o password errati.",
  email_not_confirmed: "Conferma l'email prima di accedere (controlla la posta).",
  user_already_registered: "Questa email è già registrata.",
  weak_password: "Password troppo debole (minimo 8 caratteri).",
  over_email_send_rate_limit: "Troppi tentativi. Riprova tra qualche minuto.",
  email_address_invalid: "Indirizzo email non valido.",
};

export function mapAuthError(err) {
  if (!err) return "Errore di autenticazione.";
  if (err.code && ERR_MAP[err.code]) return ERR_MAP[err.code];
  if (err.message) return `Errore di autenticazione: ${err.message}`;
  return "Errore di autenticazione.";
}

export async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: mapAuthError(error) };
  return { ok: true, user: data.user };
}

export async function signUp(client, email, password, redirectTo) {
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) return { ok: false, error: mapAuthError(error) };
  return { ok: true, user: data.user };
}

export async function resetPassword(client, email, redirectTo) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { ok: false, error: mapAuthError(error) };
  return { ok: true };
}

export async function updatePassword(client, newPassword) {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: mapAuthError(error) };
  return { ok: true };
}

export async function signOut(client) {
  const { error } = await client.auth.signOut();
  if (error) return { ok: false, error: mapAuthError(error) };
  return { ok: true };
}

export async function resendConfirmation(client, email) {
  const { error } = await client.auth.resend({ type: "signup", email });
  if (error) return { ok: false, error: mapAuthError(error) };
  return { ok: true };
}

// ---- DOM render (browser-only, non testato direttamente) ----
// Implementato nel Task 9 dopo che HTML+CSS sono pronti.
