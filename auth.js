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

// ---- DOM render (browser-only) ----

let _dom = null;

function dom() {
  if (_dom) return _dom;
  _dom = {
    screen: document.getElementById("auth-screen"),
    app: document.getElementById("app"),
    form: document.getElementById("authForm"),
    email: document.getElementById("authEmail"),
    password: document.getElementById("authPassword"),
    submit: document.getElementById("authSubmit"),
    error: document.getElementById("authError"),
    info: document.getElementById("authInfo"),
    forgot: document.getElementById("authForgot"),
    tabs: document.querySelectorAll(".auth-tab"),
    resetForm: document.getElementById("resetForm"),
    resetEmail: document.getElementById("resetEmail"),
    resetBack: document.getElementById("resetBack"),
    resetMsg: document.getElementById("resetMsg"),
    newPasswordForm: document.getElementById("newPasswordForm"),
    newPassword: document.getElementById("newPassword"),
    newPasswordMsg: document.getElementById("newPasswordMsg"),
  };
  return _dom;
}

let _mode = "login"; // "login" | "signup"

function setMode(mode) {
  _mode = mode;
  const d = dom();
  d.tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === mode));
  d.submit.textContent = mode === "signup" ? "Registrati" : "Entra";
  d.password.autocomplete = mode === "signup" ? "new-password" : "current-password";
  d.error.hidden = true;
  d.info.hidden = true;
}

function showError(node, text) {
  node.textContent = text;
  node.hidden = false;
}

function showInfo(node, text) {
  node.textContent = text;
  node.hidden = false;
}

function showAuthScreen() {
  dom().screen.hidden = false;
  dom().app.hidden = true;
}

export function hideAuthScreen() {
  dom().screen.hidden = true;
  dom().app.hidden = false;
}

export function bindAuthScreen(client, { onLoggedIn, redirectTo }) {
  const d = dom();

  // Tab switch.
  d.tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.tab)));

  // Submit login/signup.
  d.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    d.error.hidden = true;
    d.info.hidden = true;
    d.submit.disabled = true;
    try {
      const email = d.email.value.trim();
      const password = d.password.value;
      const res = _mode === "signup"
        ? await signUp(client, email, password, redirectTo)
        : await signIn(client, email, password);
      if (!res.ok) { showError(d.error, res.error); return; }
      if (_mode === "signup") {
        showInfo(d.info, "Ti ho mandato un'email di conferma. Confermala, poi torna qui e fai login.");
      } else {
        onLoggedIn?.(res.user);
      }
    } finally {
      d.submit.disabled = false;
    }
  });

  // Password dimenticata.
  d.forgot.addEventListener("click", () => {
    d.form.hidden = true;
    d.resetForm.hidden = false;
  });
  d.resetBack.addEventListener("click", () => {
    d.resetForm.hidden = true;
    d.form.hidden = false;
  });
  d.resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = d.resetEmail.value.trim();
    const res = await resetPassword(client, email, `${redirectTo}#reset`);
    if (res.ok) showInfo(d.resetMsg, "Email inviata. Controlla la posta.");
    else showError(d.resetMsg, res.error);
  });

  // Nuova password dopo click sul link reset (hash #reset).
  if (location.hash.startsWith("#reset")) {
    d.form.hidden = true;
    d.newPasswordForm.hidden = false;
  }
  d.newPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await updatePassword(client, d.newPassword.value);
    if (res.ok) {
      showInfo(d.newPasswordMsg, "Password aggiornata. Sto entrando...");
      location.hash = "";
      onLoggedIn?.();
    } else {
      showError(d.newPasswordMsg, res.error);
    }
  });

  return { showAuthScreen };
}
