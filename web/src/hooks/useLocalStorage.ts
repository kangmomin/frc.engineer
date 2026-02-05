import { useState, useCallback, useEffect } from 'react';

/**
 * Generic localStorage hook with type safety and validation
 * @param key - localStorage key
 * @param defaultValue - default value if key doesn't exist or validation fails
 * @param validate - optional validation function; returns validated value or null if invalid
 * @returns [value, setValue, reset] - current value, setter function, and reset to default
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  validate?: (parsed: unknown) => T | null
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // Initialize state from localStorage or default
  const [value, setValue] = useState<T>(() => {
    // Guard for SSR/non-browser environments
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return defaultValue;
    }

    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        // If validate function provided, use it; otherwise trust the parsed value
        if (validate) {
          const validated = validate(parsed);
          if (validated !== null) {
            return validated;
          }
          // Validation failed, use default
          return defaultValue;
        }
        return parsed as T;
      }
    } catch {
      // Invalid JSON or localStorage error, use default
    }
    return defaultValue;
  });

  // Sync to localStorage whenever value changes
  useEffect(() => {
    // Guard for SSR/non-browser environments
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage full or other error, silently fail
    }
  }, [key, value]);

  // Wrapper for setValue that handles function updates
  const setStoredValue = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof newValue === 'function'
        ? (newValue as (prev: T) => T)(prev)
        : newValue;
      return resolved;
    });
  }, []);

  // Reset to default value
  const reset = useCallback(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  return [value, setStoredValue, reset];
}
