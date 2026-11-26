package io.trackforge.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class AdaptivePeerRatesTest {
    @Test public void healthyPosePacingBelongsToTheApplicationNotTheBridgeClock() {
        AdaptivePeerRates rates = new AdaptivePeerRates();
        // A correctly paced JS stream may arrive at 30/31 ms intervals after
        // crossing the bridge. Do not discard those samples a second time.
        long now = 1000;
        for (int gap : new int[]{33, 30, 31, 39, 34, 33}) {
            assertTrue(rates.canSend("peer", false, now));
            rates.sent("peer", false, now);
            rates.delivered("peer", false, now + 5);
            now += gap;
        }
        rates.failed("peer", now);
        rates.sent("peer", false, now);
        assertFalse(rates.canSend("peer", false, now + 34));
        assertTrue(rates.canSend("peer", false, now + 67));
        rates.sent("healthy", true, now);
        assertFalse(rates.canSend("healthy", true, now + 34));
    }

    @Test public void reducesOnlyTheCongestedPeerThroughEveryRequestedRate() {
        AdaptivePeerRates rates = new AdaptivePeerRates();
        assertEquals(30, rates.rateHz("slow"));
        for (int expected : new int[]{15, 8, 4, 2, 1}) {
            rates.failed("slow", 1000);
            assertEquals(expected, rates.rateHz("slow"));
            assertEquals(30, rates.rateHz("healthy"));
        }
        rates.sent("slow", false, 1100);
        assertFalse(rates.canSend("slow", false, 1500));
        assertTrue(rates.canSend("slow", false, 2100));
        assertTrue(rates.canSend("healthy", false, 1500));
    }

    @Test public void requiresSustainedSuccessfulDeliveryToClimbAndClearsPeerState() {
        AdaptivePeerRates rates = new AdaptivePeerRates();
        rates.failed("peer", 0);
        assertEquals(15, rates.rateHz("peer"));
        for (int i = 0; i < 7; i++) {
            long now = 4000 + i * 70;
            rates.sent("peer", false, now);
            rates.delivered("peer", false, now + 15);
        }
        assertEquals(15, rates.rateHz("peer"));
        rates.sent("peer", false, 4490);
        rates.delivered("peer", false, 4505);
        assertEquals(30, rates.rateHz("peer"));
        rates.failed("peer", 5000);
        rates.disconnect("peer");
        assertEquals(30, rates.rateHz("peer"));
        rates.failed("peer", 6000);
        rates.clear();
        assertEquals(30, rates.rateHz("peer"));
    }

    @Test public void slowProgressNeverIncreasesPoseRateAndRespectsLowerCadence() {
        AdaptivePeerRates rates = new AdaptivePeerRates();
        rates.failed("peer", 0);
        rates.failed("peer", 500);
        rates.failed("peer", 1000);
        rates.failed("peer", 1500);
        assertEquals(2, rates.rateHz("peer"));
        rates.sent("peer", true, 2000);
        assertFalse(rates.canSend("peer", true, 2200));
        assertTrue(rates.canSend("peer", true, 2500));
        for (int i = 0; i < 20; i++) rates.delivered("peer", true, 8000 + i);
        assertEquals(2, rates.rateHz("peer"));
    }
}
