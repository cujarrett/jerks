import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core'
import { DOCUMENT, DecimalPipe, isPlatformBrowser } from '@angular/common'
import { AttackStats, Stats } from './stats'
import { LiveSource } from './live-source'
import { BORDERS_PATH, LAND_PATH, MAP_HEIGHT, MAP_WIDTH, project } from './us-map'

// One 12-hour bucket per frame, so a sweep of the 30 days takes about eight seconds.
const FRAME_MS = 140
// A ping's ring fades in about a second, then its element goes.
const PING_FRAMES = 9
// homelab-stats rebuilds its answer every five minutes.
const REFRESH_MS = 5 * 60_000
// The count holds back its last attacks and adds them one at a time, like a live feed.
// Each one flashes its city, so the map moves only when the number does.
// HELD_BACK: at most this many, and never more than a tenth of the total.
// TRICKLE_MS: the average gap between two of them, so a hundred take about 75 seconds.
const HELD_BACK = 100
const TRICKLE_MS = 750

// Plain words for each kind of file homelab-stats sorts a request into.
// Written to sit mid-sentence. The list capitalises the first letter in CSS.
const KINDS: Record<string, string> = {
  env: 'passwords in .env files',
  wordpress: 'WordPress logins',
  php: 'PHP admin pages',
  git: 'source code in .git',
  keys: 'cloud and SSH keys',
  backup: 'database backups',
  other: 'other hidden files',
}

interface Ping {
  id: number
  x: number
  y: number
  r: number
  // How hot the flash is, from 0.5 for one request to 1 for a thousand or more.
  heat: number
  born: number
}

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, LiveSource],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly stats = inject(Stats)
  private readonly platformId = inject(PLATFORM_ID)
  private readonly document = inject(DOCUMENT)

  protected readonly data = signal<AttackStats | null>(null)
  protected readonly failed = signal(false)
  protected readonly updatedAt = signal<number | null>(null)
  // Buckets played so far. The sweep runs once, from 30 days ago to now, and stops.
  protected readonly tick = signal(0)
  // One flash and one ring per city, for each bucket of the sweep and then for each attack that arrives.
  protected readonly pings = signal<Ping[]>([])

  protected readonly viewBox = `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`
  protected readonly land = LAND_PATH
  protected readonly borders = BORDERS_PATH

  private readonly buckets = computed(() => this.data()?.timestamps.length ?? 0)

  // Buckets on the map so far.
  private readonly shown = computed(() => Math.min(this.tick(), this.buckets()))

  // The bucket under the playhead, or -1 before the first frame. It rests on the newest one.
  private readonly playhead = computed(() => this.shown() - 1)

  // How far the playhead is through the 30 days, as a percentage.
  protected readonly progress = computed(() => {
    const n = this.buckets()
    return n < 2 ? 0 : (Math.max(this.playhead(), 0) / (n - 1)) * 100
  })

  // The day and hour under the playhead. Buckets are 12 hours, so the hour says which half of the day.
  protected readonly day = computed(() => {
    const seconds = this.data()?.timestamps[this.playhead()]
    return seconds === undefined
      ? ''
      : new Date(seconds * 1000).toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
        })
  })

  // Each place with its running total after every bucket.
  // Busiest first and never reordered, so small dots draw on top and no dot replays its entrance.
  private readonly placed = computed(() => {
    const d = this.data()
    if (!d) return []
    const n = d.timestamps.length
    const places = d.places.flatMap((p) => {
      const at = project(p.lat, p.lon)
      if (!at) return []
      const upTo = runningTotal(n, p.hits)
      return [{ city: p.city, region: p.region, x: at.x, y: at.y, upTo, total: upTo[n] }]
    })
    const peak = Math.max(...places.map((p) => p.total), 1)
    return places
      .map((p) => ({
        ...p,
        // Area grows with the count, so one busy city cannot cover the map.
        radius: (count: number) => 5 + 22 * Math.sqrt(count / peak),
      }))
      .sort((a, b) => b.total - a.total)
  })

  protected readonly dots = computed(() => {
    const f = this.shown()
    const all = this.seriesUpTo()[f] || 1
    const times = this.data()?.timestamps ?? []
    return this.placed()
      .filter((p) => p.upTo[f] > 0)
      .map((p) => {
        const count = p.upTo[f]
        // The newest bucket on the map so far in which this city sent anything.
        let last = f
        while (last > 1 && p.upTo[last] === p.upTo[last - 1]) last--
        const day = new Date(times[last - 1] * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
        const share = Math.round((count / all) * 100)
        return {
          name: `${p.city}, ${p.region}`,
          x: p.x,
          y: p.y,
          r: p.radius(count),
          detail: `${count.toLocaleString('en-US')} ${count === 1 ? 'attack' : 'attacks'} · ${share < 1 ? 'under 1' : share}% of all · last on ${day}`,
        }
      })
  })

  // The dot under the pointer, and where on the screen its label goes.
  protected readonly hovered = signal<{ name: string; left: number; top: number } | null>(null)

  // The label reads the dot's live numbers, so it keeps up while the count moves.
  protected readonly tip = computed(() => {
    const h = this.hovered()
    const dot = h && this.dots().find((d) => d.name === h.name)
    return h && dot ? { ...h, detail: dot.detail } : null
  })

  // The label is placed from the dot's own box on screen, so it lands right at any map size.
  protected point(name: string, event: Event) {
    const box = (event.currentTarget as Element).getBoundingClientRect()
    this.hovered.set({ name, left: box.left + box.width / 2, top: box.top })
  }

  // The five busiest cities, counting up with the first sweep.
  protected readonly worst = computed(() => {
    const f = this.shown()
    return this.placed()
      .slice(0, 5)
      .map((p) => ({ name: `${p.city}, ${p.region}`, count: p.upTo[f] }))
  })

  // What they asked for, as a share of every attack. A kind this page has no words for is left out.
  protected readonly kinds = computed(() => {
    const d = this.data()
    if (!d?.kinds || d.probes === 0) return []
    return d.kinds
      .filter((k) => KINDS[k.kind])
      .slice(0, 5)
      .map((k) => ({
        kind: k.kind,
        label: KINDS[k.kind],
        share: Math.round((k.count / d.probes) * 100),
      }))
  })

  private readonly seriesUpTo = computed(() => {
    const d = this.data()
    return d
      ? runningTotal(
          d.series.length,
          d.series.map((count, i) => [i, count]),
        )
      : [0]
  })

  // Attacks the count still owes. It never shows more than the real total.
  private readonly owed = signal(0)

  protected readonly count = computed(() => {
    const totals = this.seriesUpTo()
    return Math.min(totals[this.shown()] ?? 0, totals[totals.length - 1] - this.owed())
  })

  protected readonly summary = computed(() => {
    const d = this.data()
    if (!d) return 'Map of the US cities that scanner requests came from'
    return `Map of the ${this.placed().length} US cities that sent ${d.probes.toLocaleString('en-US')} scanner requests in the last 30 days`
  })

  private fetched = 0
  private nextId = 0
  // Counts every frame, so a ping knows when its second is up.
  private frame = 0
  // The cities of the attacks still owed, in the order they will arrive.
  // Shorter than `owed` when some attacks had no location.
  private queue: Point[] = []
  private timer: ReturnType<typeof setInterval> | undefined

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer))
    afterNextRender(async () => {
      if (!isPlatformBrowser(this.platformId)) return
      await this.load()
      const win = this.document.defaultView
      if (win?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // The whole range at once, with nothing moving.
        this.tick.set(this.buckets())
        return
      }
      const total = this.data()?.probes ?? 0
      this.owed.set(Math.min(HELD_BACK, Math.floor(total / 10)))
      this.queue = this.newest(this.owed())
      this.timer = setInterval(() => this.step(), FRAME_MS)
    })
  }

  private step() {
    // A hidden tab keeps its place, so nothing arrives while nobody is looking.
    const n = this.buckets()
    if (n === 0 || this.document.visibilityState !== 'visible') return
    const now = ++this.frame
    const born: Ping[] = []
    if (this.tick() < n) {
      // The sweep. Every city that sent requests in this bucket flashes once.
      const i = this.tick()
      this.tick.set(i + 1)
      for (const p of this.placed()) {
        const requests = p.upTo[i + 1] - p.upTo[i]
        if (requests <= 0) continue
        const heat = Math.min(1, 0.5 + Math.log10(requests) / 6)
        born.push({
          id: this.nextId++,
          x: p.x,
          y: p.y,
          r: p.radius(p.upTo[i + 1]),
          heat,
          born: now,
        })
      }
    } else {
      // After the sweep. One attack arrives at a time, at uneven gaps, and only its city flashes.
      if (this.owed() > 0 && Math.random() < FRAME_MS / TRICKLE_MS) {
        this.owed.update((count) => count - 1)
        const at = this.queue.shift()
        if (at) born.push({ id: this.nextId++, ...at, heat: 0.85, born: now })
      }
      // A page left open stays live.
      if (Date.now() - this.fetched >= REFRESH_MS) this.load()
    }
    this.pings.update((live) => {
      const kept = live.filter((p) => now - p.born < PING_FRAMES)
      return born.length || kept.length !== live.length ? [...kept, ...born] : live
    })
  }

  // Where the newest `count` attacks came from, oldest first.
  private newest(count: number): Point[] {
    const found: Point[] = []
    for (let b = this.buckets() - 1; b >= 0 && found.length < count; b--) {
      const bucket: Point[] = []
      for (const p of this.placed()) {
        const at = { x: p.x, y: p.y, r: p.radius(p.total) }
        for (let k = p.upTo[b + 1] - p.upTo[b]; k > 0; k--) bucket.push(at)
      }
      // The API counts per 12 hours, so the order inside one bucket is made up.
      found.unshift(...shuffle(bucket).slice(0, count - found.length))
    }
    return found
  }

  private async load() {
    this.fetched = Date.now()
    try {
      const { data, at } = await this.stats.attacks()
      const first = this.data() === null
      const shownBefore = first ? data.probes : this.count()
      const totalsBefore = new Map(this.placed().map((p) => [p.city + p.region, p.total]))
      this.data.set(data)
      this.updatedAt.set(at)
      this.failed.set(false)
      // Attacks that arrived since the last fetch trickle in too. The count never jumps up.
      this.owed.set(Math.min(HELD_BACK, Math.max(0, data.probes - shownBefore)))
      if (first) return
      const arrived = this.placed().flatMap((p) => {
        const more = p.total - (totalsBefore.get(p.city + p.region) ?? 0)
        return more > 0 ? new Array<Point>(more).fill({ x: p.x, y: p.y, r: p.radius(p.total) }) : []
      })
      this.queue = shuffle(arrived).slice(0, this.owed())
    } catch {
      this.failed.set(true)
    }
  }
}

// totals[f] is the count in the first f buckets, so totals[0] is always 0.
function runningTotal(buckets: number, hits: number[][]): number[] {
  const totals = new Array<number>(buckets + 1).fill(0)
  for (const [i, count] of hits) if (i >= 0 && i < buckets) totals[i + 1] += count
  for (let f = 1; f <= buckets; f++) totals[f] += totals[f - 1]
  return totals
}

// Where a flash goes on the map, and how big.
interface Point {
  x: number
  y: number
  r: number
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
