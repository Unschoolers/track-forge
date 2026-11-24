import { describe, expect, it } from 'vitest'
import { NearbyLobby } from '@/application/multiplayer/nearbyLobby'
import { DEFAULT_PLAYER_IDENTITY as identity } from '@/application/multiplayer/playerIdentity'

describe('NearbyLobby', () => {
  it('requires transfer and consent from every connected peer, then resets for the next round', () => {
    const lobby = new NearbyLobby()
    const guests = new Map([['red', 1], ['blue', 2]])
    lobby.setLocalReady(true, false)
    lobby.receiveChoice('red', { car: 'red', identity, accepted: true, choice: 1 })
    expect(lobby.canStage(guests)).toBe(false)
    lobby.receiveChoice('blue', { car: 'blue', identity, accepted: true, choice: 1 })
    expect(lobby.canStage(guests)).toBe(false)
    lobby.completeTransfer()
    expect(lobby.nextRevision()).toBe(1)
    expect(lobby.nextRevision()).toBe(2)
    expect(lobby.canStage(guests)).toBe(true)
    lobby.receiveChoice('blue', { car: 'blue', identity, accepted: false, choice: 2 })
    expect(lobby.canStage(guests)).toBe(false)
    expect(lobby.receiveChoice('blue', { car: 'blue', identity, accepted: true, choice: 1 })).toBe(false)
    expect(lobby.canStage(guests)).toBe(false)
    guests.delete('blue')
    lobby.removePeer('blue')
    expect(lobby.canStage(guests)).toBe(true)
    lobby.reset()
    expect(lobby.canStage(guests)).toBe(false)
    expect(lobby.peerCount).toBe(0)
    expect(lobby.localAccepted).toBe(false)
  })

  it('unlocks only when the host confirms the current cancellation, not a stale roster', () => {
    const lobby = new NearbyLobby()
    const host = { slot: 0, car: 'blue' as const, name: null, accepted: false, choice: 0 }
    const guest = { slot: 1, car: 'red' as const, name: null, accepted: true, choice: 1 }
    lobby.setLocalReady(true, true)
    expect(lobby.readyPending(1)).toBe(true)
    expect(lobby.receiveRoster(1, [host, guest], 1)).toBe(true)
    expect(lobby.readyPending(1)).toBe(false)
    expect(lobby.acknowledgedChoice(1, 1)).toBe(true)
    expect(lobby.acknowledgedChoice(1, 2)).toBe(false)
    lobby.setLocalReady(false, true)
    expect(lobby.unlockPending).toBe(true)
    expect(lobby.receiveRoster(1, [host, { ...guest, accepted: false, choice: 2 }], 1)).toBe(false)
    expect(lobby.unlockPending).toBe(true)
    lobby.receiveRoster(2, [host, { ...guest, accepted: false }], 1)
    expect(lobby.unlockPending).toBe(true)
    lobby.receiveRoster(3, [host, { ...guest, accepted: false, choice: 2 }], 1)
    expect(lobby.unlockPending).toBe(false)
  })
})
