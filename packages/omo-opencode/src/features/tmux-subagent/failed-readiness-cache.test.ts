import { describe, expect, test } from "bun:test"

import { FailedReadinessCache } from "./failed-readiness-cache"

describe("FailedReadinessCache", () => {
  test("#given active and expired sessions #when expiry is swept #then expired entries return once and active entries remain", () => {
    // given
    const cache = new FailedReadinessCache({ ttlMs: 300_000 })
    cache.remember({ sessionId: "expired", title: "expired", mode: "interactive" }, 0)
    cache.remember({ sessionId: "active", title: "active", mode: "interactive" }, 1)

    // when
    const expired = cache.takeExpired(300_000)

    // then
    expect(expired.map((session) => session.sessionId)).toEqual(["expired"])
    expect(cache.values().map((session) => session.sessionId)).toEqual(["active"])
    expect(cache.takeExpired(300_000)).toEqual([])
  })

  test("#given remembered session #when cleared #then cache reports no work", () => {
    // given
    const cache = new FailedReadinessCache({ ttlMs: 300_000 })
    cache.remember({ sessionId: "session", title: "session", mode: "interactive" }, 0)

    // when
    cache.clear("session")

    // then
    expect(cache.size).toBe(0)
    expect(cache.values()).toEqual([])
  })
})
