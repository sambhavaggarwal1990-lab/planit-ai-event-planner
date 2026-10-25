import test from "node:test";
import assert from "node:assert/strict";
import { checklistKey, createStore, type StorageLike } from "../public/js/store.ts";

const memory = (): StorageLike => {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};

test("saves and loads values", () => {
  const store = createStore("k", memory());
  assert.deepEqual(store.load(), {});
  store.save({ a: true });
  assert.deepEqual(store.load(), { a: true });
});

test("survives corrupt data and blocked storage", () => {
  const corrupt = memory();
  corrupt.setItem("k", "{not json");
  assert.deepEqual(createStore("k", corrupt).load(), {});
  const blocked: StorageLike = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
  };
  const store = createStore("k", blocked);
  assert.deepEqual(store.load(), {});
  assert.doesNotThrow(() => store.save({ a: true }));
});

test("checklistKey is case-insensitive", () => {
  assert.equal(checklistKey("Venue", "Parking"), "venue|parking");
});
