package io.trackforge.app;

import android.Manifest;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import com.google.android.gms.tasks.Task;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(name = "TrackNearby", permissions = {
    @Permission(alias = "bluetooth", strings = {
        Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE
    }),
    @Permission(alias = "wifi", strings = {Manifest.permission.NEARBY_WIFI_DEVICES}),
    @Permission(alias = "fineLocation", strings = {Manifest.permission.ACCESS_FINE_LOCATION}),
    @Permission(alias = "coarseLocation", strings = {Manifest.permission.ACCESS_COARSE_LOCATION})
})
public class NearbyRacePlugin extends Plugin {
    private static final String SERVICE_ID = "io.trackforge.app.arcade.v1";
    private static final Strategy STRATEGY = Strategy.P2P_STAR;
    private static final int MAX_BYTES = 16_003;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> connected = new HashSet<>();
    private final Map<Long, PoseSend> pendingPoses = new HashMap<>();
    private ConnectionsClient client;
    private int generation;

    private record PoseSend(PluginCall call, Set<String> remaining) {}

    private ConnectionsClient client() {
        if (client == null) client = Nearby.getConnectionsClient(getContext());
        return client;
    }

    @PluginMethod public void host(PluginCall call) { main.post(() -> open(call)); }
    @PluginMethod public void scan(PluginCall call) { main.post(() -> open(call)); }

    private String[] permissions() {
        if (Build.VERSION.SDK_INT >= 33) return new String[]{"bluetooth", "wifi"};
        if (Build.VERSION.SDK_INT >= 31) return new String[]{"bluetooth", "coarseLocation", "fineLocation"};
        if (Build.VERSION.SDK_INT >= 29) return new String[]{"coarseLocation", "fineLocation"};
        return new String[]{"coarseLocation"};
    }

    private void open(PluginCall call) {
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) != ConnectionResult.SUCCESS) {
            call.reject("Nearby Race requires up-to-date Google Play services.");
            return;
        }
        String[] permissions = permissions();
        for (String alias : permissions) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                requestPermissionForAliases(permissions, call, "permissionResult");
                return;
            }
        }
        permissionResult(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        for (String alias : permissions()) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                call.reject("Allow Nearby devices permissions to use Nearby Race.");
                return;
            }
        }
        int active = ++generation;
        String name = call.getString("name");
        if (name != null) {
            resolve(client().startAdvertising(name, SERVICE_ID, lifecycle(active),
                new AdvertisingOptions.Builder().setStrategy(STRATEGY).build()), call, "Could not host a nearby room.");
        } else {
            resolve(client().startDiscovery(SERVICE_ID, new EndpointDiscoveryCallback() {
                @Override public void onEndpointFound(String id, DiscoveredEndpointInfo info) {
                    emit(active, "found", id, "name", info.getEndpointName());
                }
                @Override public void onEndpointLost(String id) { emit(active, "lost", id, null, null); }
            }, new DiscoveryOptions.Builder().setStrategy(STRATEGY).build()), call, "Could not search for nearby rooms.");
        }
    }

    @PluginMethod public void connect(PluginCall call) {
        main.post(() -> resolve(client().requestConnection("Track Forge racer", call.getString("id"), lifecycle(generation)),
            call, "Could not connect to this room."));
    }

    @PluginMethod public void respond(PluginCall call) {
        main.post(() -> {
            String id = call.getString("id");
            Task<Void> task = Boolean.TRUE.equals(call.getBoolean("accepted"))
                ? client().acceptConnection(id, payloads(generation)) : client().rejectConnection(id);
            resolve(task, call, "Could not confirm this connection.");
        });
    }

    @PluginMethod public void lock(PluginCall call) {
        main.post(() -> {
            client().stopAdvertising();
            call.resolve();
        });
    }

    @PluginMethod public void send(PluginCall call) {
        main.post(() -> {
            String data = call.getString("data", "");
            JSArray requested = call.getArray("ids");
            if (data.length() > 4 * ((MAX_BYTES + 2) / 3) || requested == null || requested.length() > 3) {
                call.reject("Invalid nearby message.");
                return;
            }
            byte[] bytes;
            try { bytes = Base64.decode(data, Base64.DEFAULT); }
            catch (IllegalArgumentException error) { call.reject("Invalid nearby message."); return; }
            if (bytes.length == 0 || bytes.length > MAX_BYTES) {
                call.reject("Invalid nearby message.");
                return;
            }
            Set<String> recipients = new HashSet<>();
            for (int i = 0; i < requested.length(); i++) {
                String id = requested.optString(i);
                if (connected.contains(id)) recipients.add(id);
            }
            if (recipients.isEmpty()) { call.resolve(); return; }
            Payload payload = Payload.fromBytes(bytes);
            if (bytes[0] != 1) {
                resolve(client().sendPayload(new ArrayList<>(recipients), payload), call, "Could not send nearby data.");
                return;
            }
            long id = payload.getId();
            pendingPoses.put(id, new PoseSend(call, recipients));
            client().sendPayload(new ArrayList<>(recipients), payload).addOnFailureListener(error -> finishPose(id));
            main.postDelayed(() -> {
                if (!pendingPoses.containsKey(id)) return;
                client().cancelPayload(id);
                finishPose(id);
            }, 250);
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        main.post(() -> {
            stopConnections();
            call.resolve();
        });
    }

    @Override protected void handleOnDestroy() { main.post(this::stopConnections); }

    private void stopConnections() {
        generation++;
        if (client != null) {
            client.stopAdvertising();
            client.stopDiscovery();
            client.stopAllEndpoints();
        }
        connected.clear();
        pendingPoses.values().forEach(pose -> pose.call().resolve());
        pendingPoses.clear();
    }

    private ConnectionLifecycleCallback lifecycle(int active) {
        return new ConnectionLifecycleCallback() {
            @Override public void onConnectionInitiated(String id, ConnectionInfo info) {
                emit(active, "pairing", id, "code", info.getAuthenticationDigits());
            }

            @Override public void onConnectionResult(String id, ConnectionResolution resolution) {
                if (active != generation) return;
                if (resolution.getStatus().isSuccess()) {
                    connected.add(id);
                    client().stopDiscovery();
                    emit(active, "connected", id, null, null);
                } else {
                    emit(active, "error", id, "message", "Nearby pairing failed or was declined.");
                }
            }

            @Override public void onDisconnected(String id) {
                if (active != generation) return;
                connected.remove(id);
                emit(active, "disconnected", id, null, null);
            }

        };
    }

    private PayloadCallback payloads(int active) {
        return new PayloadCallback() {
            @Override public void onPayloadReceived(String id, Payload payload) {
                if (active != generation || !connected.contains(id)) return;
                byte[] bytes = payload.asBytes();
                if (bytes != null && bytes.length > 0 && bytes.length <= MAX_BYTES) {
                    emit(active, "packet", id, "data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                }
            }

            @Override public void onPayloadTransferUpdate(String endpoint, PayloadTransferUpdate update) {
                if (active != generation || update.getStatus() == PayloadTransferUpdate.Status.IN_PROGRESS) return;
                PoseSend pending = pendingPoses.get(update.getPayloadId());
                if (pending != null && pending.remaining().remove(endpoint) && pending.remaining().isEmpty()) {
                    finishPose(update.getPayloadId());
                }
            }
        };
    }

    private void finishPose(long id) {
        PoseSend pending = pendingPoses.remove(id);
        if (pending != null) pending.call().resolve();
    }

    private void emit(int active, String type, String id, String key, String value) {
        if (active != generation) return;
        JSObject event = new JSObject();
        event.put("type", type);
        event.put("id", id);
        if (key != null) event.put(key, value);
        notifyListeners("nearbyEvent", event);
    }

    private static void resolve(Task<Void> task, PluginCall call, String error) {
        task.addOnSuccessListener(ignored -> call.resolve())
            .addOnFailureListener(failure -> call.reject(error, failure));
    }
}
