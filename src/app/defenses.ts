import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { MAP_HEIGHT, MAP_WIDTH } from './us-map'

// The walls a request meets, from the outside in.
// name: the job the wall does, so a reader needs no product names.
// tool: the product and the feature of it this cluster uses for that job, small beside the name.
// r: the ring's radius on the drawing.
// key: the API's word for the wall, on the three it can count. An uncounted wall shows no number.
// behind: every counted attack was answered before this wall, so it stopped none of them.
//   True of the mesh, which only refuses calls between pods. Internet traffic never asks it.
//   Not true of the container, which every request to a web server runs inside.
const WALLS: { name: string; tool: string; r: number; key?: string; behind?: boolean }[] = [
  { name: 'WAF', tool: 'Cloudflare Bot Fight Mode and WAF rules', r: 290, key: 'waf' },
  { name: 'Firewall', tool: 'UniFi router and ISP NAT', r: 242 },
  { name: 'Gateway', tool: 'Traefik rate limit', r: 194, key: 'gateway' },
  { name: 'Web server', tool: 'nginx deny by default', r: 146, key: 'web' },
  { name: 'Service mesh', tool: 'Istio mTLS and allow lists', r: 98, behind: true },
  { name: 'Container', tool: 'Kubernetes non-root, read-only', r: 50 },
]

// Until the API sends counts, every dot stops at the web server, which answers most file requests.
// Firewall: the router and the ISP's NAT drop unasked connections, and neither counts them.
// So its row has no number, and no dot stops there.
const STOP = 3

// A flash on the map: its id and where its city sits.
// edge: the flash came from a Cloudflare data centre, so the WAF stopped it.
export interface Hit {
  id: number
  x: number
  y: number
  edge?: boolean
}

// The rings play slower than the map, so a reader can follow each dot.
// TICK_MS: one batch of the map's flashes per tick, so the 30 days take 8 seconds.
// SHOT_TICKS: a dot's flight takes 1 second in the CSS, then its element goes.
// QUEUED_MAX: batches kept while the rings are out of view. The sweep is 60 of them.
const TICK_MS = 133
const SHOT_TICKS = 8
const QUEUED_MAX = 300

@Component({
  selector: 'app-defenses',
  imports: [DecimalPipe],
  templateUrl: './defenses.html',
  styleUrl: './defenses.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Defenses {
  // The map's live flashes. Each one sends a dot at the rings, once they are in view.
  readonly hits = input.required<Hit[]>()
  // How many attacks each wall answered, by the API's word for the wall.
  readonly stops = input<{ wall: string; count: number }[]>([])
  // The count each row shows right now, by the same word. A wall missing here shows its real count.
  // The rings and the dots keep to the real counts, so they hold still while the rows tick.
  readonly shown = input<Record<string, number>>({})

  // The wall under the pointer, by name. Its ring and its row light up together.
  protected readonly active = signal<string | null>(null)

  // Each counted wall's ring and its share of the attacks.
  private readonly odds = computed(() => {
    const counted = this.stops().flatMap((s) => {
      const wall = WALLS.find((w) => w.key === s.wall)
      return wall ? [{ r: wall.r, count: s.count }] : []
    })
    const total = counted.reduce((sum, c) => sum + c.count, 0)
    return total ? counted.map((c) => ({ r: c.r, count: c.count, share: c.count / total })) : []
  })

  // Each wall with how many attacks it stopped, and its share of them for the ring's glow.
  // An API with no counts yet gives them all to the web server, with no number to show.
  protected readonly walls = computed(() => {
    const odds = this.odds()
    const shown = this.shown()
    return WALLS.map((w, i) => {
      const counted = odds.find((o) => o.r === w.r)
      const share = odds.length ? (counted?.share ?? 0) : i === STOP ? 1 : 0
      const count = counted && w.key ? (shown[w.key] ?? counted.count) : 0
      return {
        ...w,
        share,
        count: count > 0 ? count : null,
        // Only once the API's counts are in. Without them nothing is known about any wall.
        none: w.behind === true && odds.length > 0,
        // Walls no attack reached are drawn quieter.
        calm: i > STOP,
        // The name sits in the band just inside its ring. The innermost one sits in the middle.
        labelY: i === WALLS.length - 1 ? 6 : 31 - w.r,
      }
    })
  })

  // A flash from a Cloudflare data centre stops at the WAF, once the API has counted it.
  // For the rest the API says how many attacks each inner wall answered, and not which ones.
  // So those dots are dealt out in the inner walls' shares by id, and a dot keeps its wall.
  private stopFor(hit: Hit): number {
    const waf = WALLS[0].r
    const odds = this.odds()
    if (hit.edge && odds.some((o) => o.r === waf)) return waf
    const inner = odds.filter((o) => o.r !== waf)
    const all = inner.reduce((sum, o) => sum + o.share, 0)
    let u = ((hit.id * 0.618034) % 1) * all
    for (const o of inner) {
      if (u < o.share) return o.r
      u -= o.share
    }
    return WALLS[STOP].r
  }

  private readonly rings = viewChild.required<ElementRef<SVGElement>>('rings')

  // The rings keep their own slower clock, so the map's flashes queue here and play at its pace.
  // seen: the rings have come into view, so the queue plays.
  // queued: flashes not yet sent, one batch per frame of the map.
  // played: every batch sent so far. The rings loop through it when the queue runs dry.
  // flying: the dots in the air now. key is unique per flight, since a looped attack flies again.
  private readonly seen = signal(false)
  private readonly queued: Hit[][] = []
  private readonly played: Hit[][] = []
  private readonly flying = signal<{ hit: Hit; key: number; born: number }[]>([])
  private flights = 0
  private newest = -1
  private tick = 0
  private timer: ReturnType<typeof setInterval> | undefined

  constructor() {
    const destroyRef = inject(DestroyRef)
    destroyRef.onDestroy(() => clearInterval(this.timer))

    effect(() => {
      const fresh = this.hits().filter((h) => h.id > this.newest)
      if (!fresh.length) return
      this.newest = Math.max(...fresh.map((h) => h.id))
      this.queued.push(fresh)
      if (this.queued.length > QUEUED_MAX) this.queued.shift()
      if (untracked(this.seen)) this.play()
    })

    afterNextRender(() => {
      const start = () => {
        this.seen.set(true)
        this.play()
      }
      // A browser with no observer plays the dots from the start.
      if (typeof IntersectionObserver === 'undefined') return start()
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return
          observer.disconnect()
          start()
        },
        { threshold: 0.5 },
      )
      observer.observe(this.rings().nativeElement)
      destroyRef.onDestroy(() => observer.disconnect())
    })
  }

  // Sends one batch per tick, for as long as the page is open.
  // Once the queue is empty it plays the 30 days again, so the rings never go still.
  private play() {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      const now = ++this.tick
      if (!this.queued.length) this.queued.push(...this.played)
      const batch = this.queued.shift() ?? []
      if (batch.length) {
        this.played.push(batch)
        if (this.played.length > QUEUED_MAX) this.played.shift()
      }
      const still = this.flying().filter((s) => now - s.born < SHOT_TICKS)
      const sent = batch.map((hit) => ({ hit, key: this.flights++, born: now }))
      if (sent.length || still.length !== this.flying().length) this.flying.set([...still, ...sent])
    }, TICK_MS)
  }

  // A dot flies in from the side of the map its city is on.
  // Seven nearby lanes per city, so a busy one does not draw a single line.
  protected readonly shots = computed(() =>
    this.flying().map(({ hit: h, key }) => {
      const bearing = Math.atan2(h.y - MAP_HEIGHT / 2, h.x - MAP_WIDTH / 2) * (180 / Math.PI)
      return {
        key,
        turn: `rotate(${Math.round(bearing) + ((h.id % 7) - 3) * 2})`,
        stopAt: this.stopFor(h),
        edge: h.edge === true,
      }
    }),
  )
}
