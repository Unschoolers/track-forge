package io.trackforge.app;

import static org.junit.Assert.*;
import java.util.Set;
import org.junit.Test;

public class TransientPayloadWindowTest {
    @Test public void slowRecipientCannotHoldBackHealthyPeersOrQueueOldPoses() {
        TransientPayloadWindow window = new TransientPayloadWindow();
        Set<String> all = Set.of("slow", "fast", "other");
        assertEquals(all, window.available(all, false));
        window.start(1, all, false);

        assertTrue(window.complete(1, "fast"));
        assertEquals(Set.of("fast"), window.available(all, false));
        window.start(2, Set.of("fast"), false);
        assertEquals(Set.of(), window.available(all, false));
        assertTrue(window.complete(1, "other"));
        assertEquals(Set.of("other"), window.available(all, false));

        // The first packet may still be in progress at the slow phone. Only
        // the newest batch is sent to the fast phone after its delivery.
        assertTrue(window.complete(2, "fast"));
        assertEquals(Set.of("fast", "other"), window.available(all, false));
        assertEquals(1, window.pendingCount());
        window.abandon(1);
        assertEquals(all, window.available(all, false));
        assertEquals(0, window.pendingCount());
    }

    @Test public void progressUsesIndependentWindowAndDisconnectReleasesBoth() {
        TransientPayloadWindow window = new TransientPayloadWindow();
        window.start(1, Set.of("slow", "fast"), false);
        window.start(2, Set.of("slow"), true);
        assertEquals(Set.of("fast"), window.available(Set.of("fast", "slow"), true));
        window.disconnect("slow");
        assertEquals(Set.of("slow"), window.available(Set.of("slow"), true));
        assertFalse(window.contains(2));
        assertTrue(window.contains(1));
        assertFalse(window.complete(2, "slow"));
        window.clear();
        assertEquals(0, window.pendingCount());
        assertEquals(Set.of("fast", "slow"), window.available(Set.of("fast", "slow"), false));
    }
}
