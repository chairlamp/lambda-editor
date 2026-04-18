import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

function installStorageShim(name: "localStorage" | "sessionStorage") {
  const current = globalThis[name];
  if (
    current &&
    typeof current.getItem === "function" &&
    typeof current.setItem === "function" &&
    typeof current.removeItem === "function" &&
    typeof current.clear === "function"
  ) {
    return;
  }

  const store = new Map<string, string>();
  const shim = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };

  Object.defineProperty(globalThis, name, {
    value: shim,
    configurable: true,
    writable: true,
  });
}

installStorageShim("localStorage");
installStorageShim("sessionStorage");

afterEach(() => {
  cleanup();
});
