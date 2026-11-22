package io.trackforge.app;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** One outstanding transient sample per endpoint and stream, independent of peers. */
final class TransientPayloadWindow {
    private record Pending(Set<String> remaining, boolean progress) {}

    private final Map<Long, Pending> pending = new HashMap<>();
    private final Set<String> poseBusy = new HashSet<>();
    private final Set<String> progressBusy = new HashSet<>();

    Set<String> available(Collection<String> connected, boolean progress) {
        Set<String> result = new HashSet<>(connected);
        result.removeAll(progress ? progressBusy : poseBusy);
        return result;
    }

    void start(long id, Set<String> endpoints, boolean progress) {
        if (endpoints.isEmpty() || pending.containsKey(id)) throw new IllegalArgumentException("Invalid transient payload");
        pending.put(id, new Pending(new HashSet<>(endpoints), progress));
        (progress ? progressBusy : poseBusy).addAll(endpoints);
    }

    boolean contains(long id) { return pending.containsKey(id); }
    int pendingCount() { return pending.size(); }

    /** Free only the reporting endpoint; another endpoint can still be backlogged. */
    boolean complete(long id, String endpoint) {
        Pending sample = pending.get(id);
        if (sample == null || !sample.remaining().remove(endpoint)) return false;
        (sample.progress() ? progressBusy : poseBusy).remove(endpoint);
        if (sample.remaining().isEmpty()) pending.remove(id);
        return true;
    }

    void abandon(long id) {
        Pending sample = pending.remove(id);
        if (sample == null) return;
        (sample.progress() ? progressBusy : poseBusy).removeAll(sample.remaining());
    }

    void disconnect(String endpoint) {
        poseBusy.remove(endpoint);
        progressBusy.remove(endpoint);
        pending.entrySet().removeIf(entry -> {
            entry.getValue().remaining().remove(endpoint);
            return entry.getValue().remaining().isEmpty();
        });
    }

    void clear() {
        pending.clear();
        poseBusy.clear();
        progressBusy.clear();
    }
}
