import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core'
import { MAP_HEIGHT, MAP_WIDTH } from './us-map'

// The walls a request meets, from the outside in.
// r: the ring's radius on the drawing.
const WALLS = [
  { name: 'Cloudflare', does: 'Turns known bots away at the edge.', r: 290 },
  { name: 'Tunnel', does: 'The only way in. The router has no open ports.', r: 242 },
  { name: 'Traefik', does: 'Refuses any visitor past 300 requests a minute.', r: 194 },
  {
    name: 'Web server',
    does: 'Answers “not found” for files no visitor asks for. The attacks stop here.',
    r: 146,
  },
  { name: 'Istio', does: 'Lets each app talk only to the apps it named.', r: 98 },
  {
    name: 'Pod',
    does: 'Runs without root, on a read-only disk, with no key to the cluster.',
    r: 50,
  },
]

// The attacks on the map are requests for files, so the web server is the wall that answers them.
const STOP = 3

// These watch every wall, so they have no ring of their own.
const AROUND = [
  { name: 'Kyverno', does: 'Runs my images only if my own build made them.' },
  { name: 'Trivy and Renovate', does: 'Find known holes and patch them.' },
  { name: 'Alerts', does: 'Message me if a probe ever gets an answer.' },
]

// A flash on the map: its id and where its city sits.
export interface Hit {
  id: number
  x: number
  y: number
}

@Component({
  selector: 'app-defenses',
  templateUrl: './defenses.html',
  styleUrl: './defenses.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Defenses {
  // The map's live flashes. Each one sends a dot at the rings.
  readonly hits = input.required<Hit[]>()

  protected readonly walls = WALLS.map((w, i) => ({
    ...w,
    stop: i === STOP,
    // Walls no attack reached are drawn quieter.
    calm: i > STOP,
    // The name sits in the band just inside its ring. The pod's sits in the middle.
    labelY: i === WALLS.length - 1 ? 6 : 31 - w.r,
  }))
  protected readonly around = AROUND

  // The wall under the pointer, by name. Its ring and its row light up together.
  protected readonly active = signal<string | null>(null)
  protected readonly stopAt = WALLS[STOP].r

  // A dot flies in from the side of the map its city is on.
  // Seven nearby lanes per city, so a busy one does not draw a single line.
  protected readonly shots = computed(() =>
    this.hits().map((h) => {
      const bearing = Math.atan2(h.y - MAP_HEIGHT / 2, h.x - MAP_WIDTH / 2) * (180 / Math.PI)
      return { id: h.id, turn: `rotate(${Math.round(bearing) + ((h.id % 7) - 3) * 2})` }
    }),
  )
}
