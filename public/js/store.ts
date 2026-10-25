/** Small wrapper around localStorage that never throws (storage can be blocked or full). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type Checks = Record<string, boolean>;

export function createStore(key: string, storage: StorageLike | undefined = globalThis.localStorage) {
  return {
    load(): Checks {
      try {
        return JSON.parse(storage?.getItem(key) ?? "{}") ?? {};
      } catch {
        return {};
      }
    },
    save(value: Checks): void {
      try {
        storage?.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable: progress simply is not remembered */
      }
    },
  };
}

export const checklistKey = (category: string, item: string): string => `${category}|${item}`.toLowerCase();
