import type { CarId } from '@/domain/model'
import type { LobbyPlayer } from './controlProtocol'
import type { PlayerIdentity } from './playerIdentity'

interface PeerChoice {
  readonly car: CarId
  readonly identity: PlayerIdentity
  readonly name?: string
  readonly accepted: boolean
  readonly choice: number
}

/** Round-scoped consent and roster authority, independent of native delivery and scene timing. */
export class NearbyLobby {
  private readonly peers = new Map<string, PeerChoice>()
  private accepted = false
  private choice = 0
  private revision = 0
  private readonly pendingRosters = new Set<number>()
  private remote: LobbyPlayer[] = []
  private unlocking = false
  private transferComplete = false

  get localAccepted(): boolean { return this.accepted }
  get localChoice(): number { return this.choice }
  get unlockPending(): boolean { return this.unlocking }
  get peerCount(): number { return this.peers.size }

  peer(id: string): PeerChoice | undefined { return this.peers.get(id) }
  peerIds(): string[] { return [...this.peers.keys()] }
  removePeer(id: string): void { this.peers.delete(id) }

  reset(): void {
    this.peers.clear()
    this.accepted = false
    this.choice = 0
    this.revision = 0
    this.pendingRosters.clear()
    this.remote = []
    this.unlocking = false
    this.transferComplete = false
  }

  setLocalReady(accepted: boolean, guest: boolean): void {
    if (guest && !accepted && this.accepted) this.unlocking = true
    this.accepted = accepted
    this.choice++
  }

  readyPending(slot: number): boolean {
    return this.accepted && !this.remote.some(player => player.slot === slot && player.choice === this.choice && player.accepted)
  }

  beginRoster(): number {
    const revision = ++this.revision
    this.pendingRosters.add(revision)
    return revision
  }

  finishRoster(revision: number): void { this.pendingRosters.delete(revision) }

  acknowledgedChoice(slot: number, choice: number): boolean {
    return this.remote.some(player => player.slot === slot && player.choice >= choice)
  }

  receiveChoice(id: string, choice: PeerChoice): boolean {
    const previous = this.peers.get(id)
    if (previous && choice.choice <= previous.choice) return false
    this.peers.set(id, choice)
    return true
  }

  receiveRoster(revision: number, players: LobbyPlayer[], slot: number): boolean {
    if (revision <= this.revision) return false
    const local = players.find(player => player.slot === slot)
    if (!local) return false
    this.revision = revision
    this.remote = players
    if (this.unlocking && local.choice === this.choice && !local.accepted) this.unlocking = false
    return true
  }

  completeTransfer(): void { this.transferComplete = true }

  canStage(guests: ReadonlyMap<string, number>): boolean {
    return this.transferComplete && this.pendingRosters.size === 0 && this.accepted && guests.size > 0 &&
      [...guests.keys()].every(id => this.peers.get(id)?.accepted === true)
  }

  players(guest: boolean, slot: number, car: CarId, name: string | undefined, guests: ReadonlyMap<string, number>): LobbyPlayer[] {
    const local = { slot, car, name: name ?? null, accepted: guest ? false : this.accepted, choice: this.choice }
    if (guest) return this.remote.length ? this.remote : [local]
    const players: LobbyPlayer[] = [local]
    for (const [id, slot] of guests) {
      const player = this.peers.get(id)
      players.push({ slot, car: player?.car ?? null, name: player?.name ?? null,
        accepted: player?.accepted ?? false, choice: player?.choice ?? 0 })
    }
    return players.sort((a, b) => a.slot - b.slot)
  }
}
