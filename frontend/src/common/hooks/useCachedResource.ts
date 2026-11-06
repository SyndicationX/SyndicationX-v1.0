import { useCallback, useEffect, useRef, useState } from "react"

type CacheEntry<T> = { data: T; at: number }

const resourceCache = new Map<string, CacheEntry<unknown>>()
const resourceInflight = new Map<string, Promise<unknown>>()
const resourceGeneration = new Map<string, number>()

export function peekCachedResource<T>(key: string): T | undefined {
  const hit = resourceCache.get(key)
  return hit ? (hit.data as T) : undefined
}

export function cachedResourceIsFresh(key: string, ttlMs: number): boolean {
  const hit = resourceCache.get(key)
  return hit != null && Date.now() - hit.at < ttlMs
}

export function writeCachedResource<T>(key: string, data: T): void {
  resourceCache.set(key, { data, at: Date.now() })
}

/** Run async work over a list without opening every request at once. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  if (items.length === 0) return
  let cursor = 0
  const size = Math.max(1, Math.min(limit, items.length))
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        if (shouldStop?.()) return
        const index = cursor
        cursor += 1
        await worker(items[index]!, index)
      }
    }),
  )
}

type UseCachedResourceOptions<T> = {
  key: string
  fetcher: () => Promise<T>
  enabled?: boolean
  /** Show a cached value immediately, then refresh once it is older than this. */
  ttlMs?: number
}

/**
 * Loads data without blocking a second visit.
 * A fresh cached value renders on the first paint. A stale value stays on
 * screen while a refresh runs in the background.
 */
export function useCachedResource<T>({
  key,
  fetcher,
  enabled = true,
  ttlMs = 20_000,
}: UseCachedResourceOptions<T>) {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const completedNonce = useRef(0)
  const [nonce, setNonce] = useState(0)
  const [trackedKey, setTrackedKey] = useState(key)
  const [data, setData] = useState<T | undefined>(() => peekCachedResource<T>(key))
  const [error, setError] = useState<Error | null>(null)
  const [phase, setPhase] = useState<"idle" | "loading" | "refreshing">(() => {
    if (!enabled) return "idle"
    const cached = peekCachedResource<T>(key)
    if (cached && cachedResourceIsFresh(key, ttlMs)) return "idle"
    return cached ? "refreshing" : "loading"
  })

  if (trackedKey !== key) {
    const cached = peekCachedResource<T>(key)
    const fresh = cached != null && cachedResourceIsFresh(key, ttlMs)
    setTrackedKey(key)
    setData(cached)
    setError(null)
    setPhase(
      !enabled ? "idle" : fresh ? "idle" : cached ? "refreshing" : "loading",
    )
  }

  useEffect(() => {
    if (!enabled) {
      setPhase("idle")
      return
    }
    let cancelled = false
    const cached = resourceCache.get(key) as CacheEntry<T> | undefined
    if (cached) setData(cached.data)
    const forced = nonce !== completedNonce.current
    const fresh =
      cached != null && Date.now() - cached.at < ttlMs && !forced
    if (fresh) {
      setPhase("idle")
      setError(null)
      return
    }
    setPhase(cached ? "refreshing" : "loading")
    if (forced) {
      resourceGeneration.set(key, (resourceGeneration.get(key) ?? 0) + 1)
    }
    const generation = resourceGeneration.get(key) ?? 0
    const existing = !forced ? resourceInflight.get(key) : undefined
    const promise = (existing ?? fetcherRef.current()) as Promise<T>
    if (!existing) resourceInflight.set(key, promise)

    void promise
      .then((value) => {
        if ((resourceGeneration.get(key) ?? 0) !== generation) return
        resourceCache.set(key, { data: value, at: Date.now() })
        if (cancelled) return
        completedNonce.current = nonce
        setData(value)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if ((resourceGeneration.get(key) ?? 0) !== generation) return
        completedNonce.current = nonce
        setError(err instanceof Error ? err : new Error("Could not load data."))
      })
      .finally(() => {
        if (!existing && resourceInflight.get(key) === promise) {
          resourceInflight.delete(key)
        }
        if (!cancelled) setPhase("idle")
      })

    return () => {
      cancelled = true
    }
  }, [key, enabled, ttlMs, nonce])

  const reload = useCallback(() => {
    setNonce((current) => current + 1)
  }, [])

  return {
    data,
    /** True only when there is nothing to render yet. */
    isLoading: enabled && data === undefined && phase !== "idle",
    /** True when cached data is visible and a refresh is in flight. */
    isRefreshing: enabled && data !== undefined && phase === "refreshing",
    error,
    reload,
  }
}
