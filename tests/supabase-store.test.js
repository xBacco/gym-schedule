import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseStore, ConflictError, AuthError } from "../store.js";

// Mock espressivo del client Supabase. Supporta sia load che save.
function mockClient({ session = { user: { id: "u1" } }, loads = [], saves = [] } = {}) {
  let loadIdx = 0, saveIdx = 0;
  return {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    from(table) {
      assert.equal(table, "user_data");
      const builder = {
        _filters: {},
        select() { return this; },
        eq(col, val) {
          assert.equal(col, "user_id");
          assert.equal(val, session.user.id);
          this._filters[col] = val;
          return this;
        },
        match(f) { this._filters = { ...this._filters, ...f }; return this; },
        maybeSingle: async () => {
          const next = loads[loadIdx++];
          if (!next) throw new Error("mock: loads esaurite");
          return next;
        },
        update(payload) {
          this._update = payload;
          return this;
        },
        upsert(payload, opts) {
          this._upsert = payload;
          this._upsertOpts = opts;
          return this;
        },
        insert(payload) {
          this._insert = payload;
          return this;
        },
        single: async () => {
          const next = saves[saveIdx++];
          if (!next) throw new Error("mock: saves esaurite");
          return next;
        },
      };
      return builder;
    },
  };
}

test("SupabaseStore.load ritorna {data, version} dalla riga utente", async () => {
  const remote = { weeks: { "2026-W22": { label: "1", entries: {} } }, updatedAt: "2026-05-25T10:00:00Z" };
  const client = mockClient({
    loads: [{ data: { data: remote, version: 7 }, error: null }],
  });
  const store = new SupabaseStore(client);
  const result = await store.load();
  assert.deepEqual(result, { data: remote, version: 7 });
});

test("SupabaseStore.load ritorna emptyData quando nessuna riga ancora", async () => {
  const client = mockClient({ loads: [{ data: null, error: null }] });
  const store = new SupabaseStore(client);
  const result = await store.load();
  assert.deepEqual(result, { data: { weeks: {}, updatedAt: null }, version: 0 });
});

test("SupabaseStore.load lancia AuthError quando non c'è sessione", async () => {
  const client = mockClient({ session: null });
  const store = new SupabaseStore(client);
  await assert.rejects(() => store.load(), AuthError);
});

test("SupabaseStore.save aggiorna riga esistente e ritorna nuova version", async () => {
  const blob = { weeks: { "2026-W22": {} }, updatedAt: "2026-05-25T10:00:00Z" };
  const client = mockClient({
    saves: [{ data: { version: 8 }, error: null, count: 1 }],
  });
  const store = new SupabaseStore(client);
  const newVersion = await store.save(blob, 7);
  assert.equal(newVersion, 8);
});

test("SupabaseStore.save su version=0 fa insert iniziale", async () => {
  const blob = { weeks: {}, updatedAt: null };
  const client = mockClient({
    saves: [{ data: { version: 1 }, error: null, count: 1 }],
  });
  const store = new SupabaseStore(client);
  const newVersion = await store.save(blob, 0);
  assert.equal(newVersion, 1);
});

test("SupabaseStore.save lancia ConflictError su PGRST116 (zero rows)", async () => {
  const client = mockClient({
    saves: [{ data: null, error: { code: "PGRST116", message: "0 rows" } }],
  });
  const store = new SupabaseStore(client);
  await assert.rejects(() => store.save({ weeks: {} }, 5), ConflictError);
});

test("SupabaseStore.save lancia AuthError su 401", async () => {
  const client = mockClient({
    saves: [{ data: null, error: { status: 401, message: "Unauthorized" } }],
  });
  const store = new SupabaseStore(client);
  await assert.rejects(() => store.save({ weeks: {} }, 5), AuthError);
});

test("SupabaseStore.save propaga Error generico su altri fallimenti", async () => {
  const client = mockClient({
    saves: [{ data: null, error: { code: "PGRST500", message: "boom" } }],
  });
  const store = new SupabaseStore(client);
  await assert.rejects(() => store.save({ weeks: {} }, 5), /Supabase save failed/);
});
