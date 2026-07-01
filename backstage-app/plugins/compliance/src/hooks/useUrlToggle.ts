import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlToggle<T extends string = string>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = (searchParams.get(key) as T | null) ?? defaultValue;

  const setValue = useCallback(
    (next: T) => {
      setSearchParams(prev => {
        const params = new URLSearchParams(prev);
        if (next === defaultValue || next === '') {
          params.delete(key);
        } else {
          params.set(key, next);
        }
        return params;
      }, { replace: true });
    },
    [key, defaultValue, setSearchParams],
  );

  return [value, setValue];
}
