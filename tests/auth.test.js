import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAuthError, signIn, signUp, resetPassword } from "../auth.js";

test("mapAuthError: invalid_credentials -> messaggio italiano", () => {
  assert.equal(
    mapAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }),
    "Email o password errati."
  );
});

test("mapAuthError: email_not_confirmed", () => {
  assert.equal(
    mapAuthError({ code: "email_not_confirmed" }),
    "Conferma l'email prima di accedere (controlla la posta)."
  );
});

test("mapAuthError: user_already_registered", () => {
  assert.equal(
    mapAuthError({ code: "user_already_registered" }),
    "Questa email è già registrata."
  );
});

test("mapAuthError: codice ignoto -> messaggio generico", () => {
  assert.equal(
    mapAuthError({ code: "wat", message: "boom" }),
    "Errore di autenticazione: boom"
  );
});

test("mapAuthError: null/undefined -> generico", () => {
  assert.equal(mapAuthError(null), "Errore di autenticazione.");
});

test("signIn: ritorna {ok:true, user} su successo", async () => {
  const fakeClient = {
    auth: {
      signInWithPassword: async ({ email, password }) => {
        assert.equal(email, "a@b.com");
        assert.equal(password, "secret123");
        return { data: { user: { id: "u1", email } }, error: null };
      },
    },
  };
  const res = await signIn(fakeClient, "a@b.com", "secret123");
  assert.equal(res.ok, true);
  assert.equal(res.user.id, "u1");
});

test("signIn: ritorna {ok:false, error} su fallimento (mappato in italiano)", async () => {
  const fakeClient = {
    auth: {
      signInWithPassword: async () => ({ data: { user: null }, error: { code: "invalid_credentials" } }),
    },
  };
  const res = await signIn(fakeClient, "a@b.com", "x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "Email o password errati.");
});

test("signUp: chiama supabase con emailRedirectTo e ritorna ok su successo", async () => {
  let calledWith = null;
  const fakeClient = {
    auth: {
      signUp: async (args) => { calledWith = args; return { data: { user: { id: "u2" } }, error: null }; },
    },
  };
  const res = await signUp(fakeClient, "x@y.it", "pass1234", "https://app/");
  assert.equal(res.ok, true);
  assert.equal(calledWith.email, "x@y.it");
  assert.equal(calledWith.options.emailRedirectTo, "https://app/");
});

test("resetPassword: chiama resetPasswordForEmail con redirectTo", async () => {
  let calledWith = null;
  const fakeClient = {
    auth: {
      resetPasswordForEmail: async (email, opts) => { calledWith = { email, opts }; return { data: {}, error: null }; },
    },
  };
  const res = await resetPassword(fakeClient, "x@y.it", "https://app/#reset");
  assert.equal(res.ok, true);
  assert.equal(calledWith.email, "x@y.it");
  assert.equal(calledWith.opts.redirectTo, "https://app/#reset");
});
