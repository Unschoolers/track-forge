package io.trackforge.app;

import java.util.HashMap;
import java.util.Map;

/** Per-destination radio pacing. A slow peer never lowers the cadence of other peers. */
final class AdaptivePeerRates {
    private static final int[] HZ = {30, 15, 8, 4, 2, 1};
    private static final int[] PERIOD_MS = {34, 67, 125, 250, 500, 1000};

    private static final class State {
        int tier;
        int healthy;
        long lastPoseAt = -1;
        long lastProgressAt = -1;
        long lastReductionAt = -1;
    }

    private final Map<String, State> peers = new HashMap<>();
    private State state(String peer) { return peers.computeIfAbsent(peer, ignored -> new State()); }

    int rateHz(String peer) { return HZ[state(peer).tier]; }

    boolean canSend(String peer, boolean progress, long now) {
        State current = state(peer);
        long last = progress ? current.lastProgressAt : current.lastPoseAt;
        return last < 0 || now - last >= (progress
            ? Math.max(150, PERIOD_MS[current.tier]) : PERIOD_MS[current.tier]) - 2;
    }

    void sent(String peer, boolean progress, long now) {
        State current = state(peer);
        if (progress) current.lastProgressAt = now;
        else current.lastPoseAt = now;
    }

    void failed(String peer, long now) {
        State current = state(peer);
        current.healthy = 0;
        if (current.tier < HZ.length - 1) {
            current.tier++;
            current.lastReductionAt = now;
        }
    }

    void delivered(String peer, boolean progress, long now) {
        if (progress) return;
        State current = state(peer);
        long age = now - current.lastPoseAt;
        // A long delivery is congestion even when Google Nearby eventually succeeds.
        if (age > Math.max(160, PERIOD_MS[current.tier] * 2)) {
            failed(peer, now);
            return;
        }
        current.healthy++;
        // Require multiple clean packets and a quiet period before stepping up.
        // A peer at 1 Hz needs at least eight good updates before recovering.
        if (current.tier > 0 && current.healthy >= 8 &&
            current.lastReductionAt >= 0 && now - current.lastReductionAt >= 4000) {
            current.tier--;
            current.healthy = 0;
            current.lastReductionAt = now;
        }
    }

    void disconnect(String peer) { peers.remove(peer); }
    void clear() { peers.clear(); }
}
