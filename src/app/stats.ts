import { Injectable } from '@angular/core'

export interface AttackStats {
  probes: number
  sources: number
  // The end of each bucket, in seconds.
  timestamps: number[]
  // Requests per bucket, including the ones with no location.
  series: number[]
  // hits: pairs of bucket index and requests in that bucket.
  // edge: a Cloudflare data centre that stopped requests, not a city they came from.
  places: {
    city: string
    region: string
    lat: number
    lon: number
    edge?: boolean
    hits: number[][]
  }[]
  // Requests by the kind of file asked for, most asked first. The kinds are fixed words.
  // Missing from an API that has not been updated yet.
  kinds?: { kind: string; count: number }[]
  // Requests by the wall that answered them. The walls are fixed words.
  // Missing from an API that has not been updated yet.
  walls?: { wall: string; count: number }[]
}

// The numbers and when the API read them from their source, in milliseconds.
export interface Fresh<T> {
  data: T
  at: number
}

// Same origin, because the site's nginx forwards /api/stats/ to homelab-stats
// and the CSP only allows connect-src 'self'.
const BASE = '/api/stats'

@Injectable({ providedIn: 'root' })
export class Stats {
  async attacks(): Promise<Fresh<AttackStats>> {
    const url = `${BASE}/attacks`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} returned ${res.status}`)
    const at = Date.parse(res.headers.get('last-modified') ?? '')
    return { data: (await res.json()) as AttackStats, at: Number.isNaN(at) ? Date.now() : at }
  }
}
