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
  // Frames played since the page opened. It keeps counting, so the sweep never stops.
  // First sweep: dots play in. Every sweep after: the map stays full and cities ping as their bucket passes.
  protected readonly tick = signal(0)
  // One flash and one ring per city that sent requests in the bucket under the playhead.
  protected readonly pings = signal<Ping[]>([])

  protected readonly viewBox = `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`
  protected readonly land = LAND_PATH
  protected readonly borders = BORDERS_PATH

  private readonly buckets = computed(() => this.data()?.timestamps.length ?? 0)

  // Buckets on the map so far. It stops at the bucket count when the first sweep ends.
  private readonly shown = computed(() => Math.min(this.tick(), this.buckets()))

  // The bucket under the playhead, or -1 before the first frame.
  private readonly playhead = computed(() => {
    const n = this.buckets()
    return n === 0 || this.tick() === 0 ? -1 : (this.tick() - 1) % n
  })

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
    return this.placed()
      .filter((p) => p.upTo[f] > 0)
      .map((p) => ({
        name: `${p.city}, ${p.region}`,
        x: p.x,
        y: p.y,
        r: p.radius(p.upTo[f]),
        title: `${p.city}, ${p.region}: ${p.upTo[f].toLocaleString('en-US')} requests`,
      }))
  })

  // The five busiest cities, counting up with the first sweep.
  protected readonly worst = computed(() => {
    const f = this.shown()
    return this.placed()
      .slice(0, 5)
      .map((p) => ({ name: `${p.city}, ${p.region}`, count: p.upTo[f] }))
  })

  protected readonly worstCity = computed(() => this.placed()[0]?.city ?? '')

  private readonly seriesUpTo = computed(() => {
    const d = this.data()
    return d
      ? runningTotal(
          d.series.length,
          d.series.map((count, i) => [i, count]),
        )
      : [0]
  })

  protected readonly count = computed(() => this.seriesUpTo()[this.shown()] ?? 0)

  protected readonly summary = computed(() => {
    const d = this.data()
    if (!d) return 'Map of the US cities that scanner requests came from'
    return `Map of the ${this.placed().length} US cities that sent ${d.probes.toLocaleString('en-US')} scanner requests in the last 30 days`
  })

  private fetched = 0
  private nextId = 0
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
      this.timer = setInterval(() => this.step(), FRAME_MS)
    })
  }

  private step() {
    // A hidden tab keeps its place, so the sweep picks up where the reader left it.
    if (this.buckets() === 0 || this.document.visibilityState !== 'visible') return
    const t = this.tick() + 1
    this.tick.set(t)
    const i = this.playhead()
    const born: Ping[] = []
    for (const p of this.placed()) {
      const requests = p.upTo[i + 1] - p.upTo[i]
      if (requests <= 0) continue
      const heat = Math.min(1, 0.5 + Math.log10(requests) / 6)
      born.push({ id: this.nextId++, x: p.x, y: p.y, r: p.radius(p.upTo[i + 1]), heat, born: t })
    }
    this.pings.update((live) => [...live.filter((p) => t - p.born < PING_FRAMES), ...born])
    // A page left open stays live. The new numbers arrive between two sweeps.
    if (i === this.buckets() - 1 && Date.now() - this.fetched >= REFRESH_MS) this.load()
  }

  private async load() {
    this.fetched = Date.now()
    try {
      const { data, at } = await this.stats.attacks()
      this.data.set(data)
      this.updatedAt.set(at)
      this.failed.set(false)
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
