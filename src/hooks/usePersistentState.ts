import { useEffect, useState } from "react";

export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Persistence is a convenience layer; the UI state still works in memory.
    }
  }, [key, value]);

  const clear = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage errors.
    }
    setValue(initialValue);
  };

  return [value, setValue, clear] as const;
}
