package io.trackforge.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.wifi.WifiManager;
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
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import com.google.android.gms.tasks.Task;
import java.util.ArrayList;
import java.util.ArrayDeque;
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
    private static final String SERVICE_ID = "io.trackforge.app.arcade.v2";
    private static final Strategy STRATEGY = Strategy.P2P_STAR;
    private static final int MAX_BYTES = 16_003;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> connected = new HashSet<>();
    private final Map<Long, PendingSend> pendingSends = new HashMap<>();
    private ConnectionsClient client;
    private int generation;
    private final ArrayDeque<JSObject> events = new ArrayDeque<>();
    private long sentPackets, receivedPackets, sentBytes, receivedBytes;
    private String phase = "idle";

    private void record(String operation, String outcome, Integer status) {
        JSObject event = new JSObject();
        event.put("time", System.currentTimeMillis());
        event.put("operation", operation);
        event.put("outcome", outcome);
        if (status != null) { event.put("statusCode", status); event.put("statusName", ConnectionsStatusCodes.getStatusCodeString(status)); }
        if (events.size() == 200) events.removeFirst();
        events.addLast(event);
    }

    private static String playServicesStatusName(int code) {
        return switch (code) {
            case ConnectionResult.SUCCESS -> "SUCCESS";
            case ConnectionResult.SERVICE_MISSING -> "SERVICE_MISSING";
            case ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED -> "SERVICE_VERSION_UPDATE_REQUIRED";
            case ConnectionResult.SERVICE_DISABLED -> "SERVICE_DISABLED";
            case ConnectionResult.SERVICE_INVALID -> "SERVICE_INVALID";
            case ConnectionResult.SERVICE_UPDATING -> "SERVICE_UPDATING";
            default -> "OTHER";
        };
    }

    private static Integer statusCode(Exception error) {
        return error instanceof ApiException ? ((ApiException) error).getStatusCode() : null;
    }

    private static String failureMessage(String fallback, Integer code) {
        if (code == null) return fallback;
        String name = ConnectionsStatusCodes.getStatusCodeString(code);
        if (name.startsWith("MISSING_PERMISSION_")) return "Nearby Race needs the required device permissions. Check app permissions and try again.";
        if (code == ConnectionsStatusCodes.MISSING_SETTING_LOCATION_MUST_BE_ON) return "Turn on device location to use Nearby Race.";
        if (code == ConnectionsStatusCodes.STATUS_BLUETOOTH_ERROR || code == ConnectionsStatusCodes.STATUS_RADIO_ERROR)
            return "Nearby Race could not use the wireless radios. Check that Bluetooth and Wi-Fi are enabled.";
        if (name.equals("STATUS_ALREADY_ADVERTISING")) return "A nearby room is already being hosted. Stop it before hosting again.";
        if (name.equals("STATUS_ALREADY_DISCOVERING")) return "A nearby search is already active. Stop it before trying again.";
        if (name.equals("API_CONNECTION_FAILED_ALREADY_IN_USE")) return "Nearby Connections is in use by another app. Close it and try again.";
        return fallback;
    }

    @PluginMethod public void diagnostics(PluginCall call) {
        main.post(() -> {
            JSObject report = new JSObject();
            report.put("schemaVersion", 1); report.put("platform", "android"); report.put("phase", phase);
            report.put("sdkInt", Build.VERSION.SDK_INT); report.put("androidVersion", Build.VERSION.RELEASE);
            report.put("targetSdk", getContext().getApplicationInfo().targetSdkVersion);
            report.put("manufacturer", Build.MANUFACTURER);
            report.put("model", Build.MODEL);
            report.put("strategy", "P2P_STAR");
            try {
                PackageInfo app = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
                report.put("appVersion", app.versionName);
                report.put("appVersionCode", Build.VERSION.SDK_INT >= 28 ? app.getLongVersionCode() : app.versionCode);
            } catch (PackageManager.NameNotFoundException e) { report.put("appVersion", "unavailable"); }
            int playStatus = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext());
            JSObject play = new JSObject(); play.put("availabilityCode", playStatus);
            play.put("availabilityName", GoogleApiAvailability.getInstance().getErrorString(playStatus));
            try {
                PackageInfo info = getContext().getPackageManager().getPackageInfo("com.google.android.gms", 0);
                play.put("versionName", info.versionName);
                play.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            } catch (PackageManager.NameNotFoundException e) { play.put("versionName", "unavailable"); }
            report.put("playServices", play);
            JSObject permissions = new JSObject();
            for (String permission : new String[]{Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_WIFI_STATE, Manifest.permission.CHANGE_WIFI_STATE, Manifest.permission.NEARBY_WIFI_DEVICES}) {
                permissions.put(permission, getContext().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED ? "granted" : "not_granted");
            }
            report.put("permissions", permissions);
            JSObject toggles = new JSObject();
            try {
                WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                toggles.put("wifi", wifi == null ? "unavailable" : (wifi.isWifiEnabled() ? "on" : "off"));
            } catch (SecurityException e) { toggles.put("wifi", "permission_required"); }
            try {
                BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
                BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
                toggles.put("bluetooth", adapter == null ? "unavailable" : (adapter.isEnabled() ? "on" : "off"));
            } catch (SecurityException e) { toggles.put("bluetooth", "permission_required"); }
            try {
                LocationManager location = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
                boolean enabled = Build.VERSION.SDK_INT >= 28 ? location.isLocationEnabled() :
                    location.isProviderEnabled(LocationManager.GPS_PROVIDER) || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                toggles.put("location", enabled ? "on" : "off");
            } catch (RuntimeException e) { toggles.put("location", "unavailable"); }
            report.put("toggles", toggles);
            JSObject counters = new JSObject(); counters.put("sentPackets", sentPackets); counters.put("sentBytes", sentBytes);
            counters.put("receivedPackets", receivedPackets); counters.put("receivedBytes", receivedBytes);
            counters.put("connectedCount", connected.size()); counters.put("pendingSends", pendingSends.size());
            report.put("counters", counters);
            JSArray history = new JSArray(); for (JSObject event : events) history.put(event);
            report.put("events", history); call.resolve(report);
        });
    }

    private record PendingSend(PluginCall call, Set<String> remaining) {}

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
        phase = call.getString("name") != null ? "host" : "scan";
        record(phase, "requested", null);
        int playStatus = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext());
        if (playStatus != ConnectionResult.SUCCESS) {
            record(phase, "play_services_unavailable", null);
            call.reject("Nearby Race requires up-to-date Google Play services.");
            return;
        }
        String[] permissions = permissions();
        for (String alias : permissions) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                record(phase, "requesting_permissions", null);
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
                record(phase, "permission_denied", null);
                call.reject("Allow Nearby devices permissions to use Nearby Race.");
                return;
            }
        }
        int active = ++generation;
        String name = call.getString("name");
        if (name != null) {
            resolve(client().startAdvertising(name, SERVICE_ID, lifecycle(active),
                new AdvertisingOptions.Builder().setStrategy(STRATEGY).build()), call, "host", "Could not host a nearby room.");
        } else {
            resolve(client().startDiscovery(SERVICE_ID, new EndpointDiscoveryCallback() {
                @Override public void onEndpointFound(String id, DiscoveredEndpointInfo info) {
                    if (active == generation) record("discovery", "endpoint_found", null);
                    emit(active, "found", id, "name", info.getEndpointName());
                }
                @Override public void onEndpointLost(String id) {
                    if (active == generation) record("discovery", "endpoint_lost", null);
                    emit(active, "lost", id, null, null);
                }
            }, new DiscoveryOptions.Builder().setStrategy(STRATEGY).build()), call, "scan", "Could not search for nearby rooms.");
        }
    }

    @PluginMethod public void connect(PluginCall call) {
        main.post(() -> resolve(client().requestConnection("Track Forge racer", call.getString("id"), lifecycle(generation)),
            call, "connect", "Could not connect to this room."));
    }

    @PluginMethod public void respond(PluginCall call) {
        main.post(() -> {
            String id = call.getString("id");
            Task<Void> task = Boolean.TRUE.equals(call.getBoolean("accepted"))
                ? client().acceptConnection(id, payloads(generation)) : client().rejectConnection(id);
            resolve(task, call, "respond", "Could not confirm this connection.");
        });
    }

    @PluginMethod public void lock(PluginCall call) {
        main.post(() -> {
            client().stopAdvertising();
            record("lock", "completed", null);
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
            sentPackets++; sentBytes += bytes.length;
            Payload payload = Payload.fromBytes(bytes);
            long id = payload.getId();
            boolean pose = bytes[0] == 1 || bytes[0] == 3;
            // Task success means the transfer was queued. Keep control and track
            // packets pending until each endpoint reports successful delivery.
            pendingSends.put(id, new PendingSend(call, recipients));
            client().sendPayload(new ArrayList<>(recipients), payload)
                .addOnFailureListener(error -> { record("send", "failed", statusCode(error)); finishSend(id, "Could not send nearby data."); });
            main.postDelayed(() -> {
                if (!pendingSends.containsKey(id)) return;
                record("send", "timeout", null);
                client().cancelPayload(id);
                finishSend(id, "Nearby data transfer timed out.");
            }, pose ? 250 : 10_000);
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
        phase = "idle";
        record("stop", "completed", null);
        if (client != null) {
            client.stopAdvertising();
            client.stopDiscovery();
            client.stopAllEndpoints();
        }
        connected.clear();
        pendingSends.values().forEach(send -> send.call().resolve());
        pendingSends.clear();
    }

    private ConnectionLifecycleCallback lifecycle(int active) {
        return new ConnectionLifecycleCallback() {
            @Override public void onConnectionInitiated(String id, ConnectionInfo info) {
                if (active == generation) record("connection", "initiated", null);
                emit(active, "pairing", id, "code", info.getAuthenticationDigits());
            }

            @Override public void onConnectionResult(String id, ConnectionResolution resolution) {
                if (active != generation) return;
                record("connection", resolution.getStatus().isSuccess() ? "connected" : "failed", resolution.getStatus().getStatusCode());
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
                record("connection", "disconnected", null);
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
                    receivedPackets++; receivedBytes += bytes.length;
                    emit(active, "packet", id, "data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                }
            }

            @Override public void onPayloadTransferUpdate(String endpoint, PayloadTransferUpdate update) {
                if (active != generation || update.getStatus() == PayloadTransferUpdate.Status.IN_PROGRESS) return;
                long id = update.getPayloadId();
                PendingSend pending = pendingSends.get(id);
                if (pending == null || !pending.remaining().remove(endpoint)) return;
                if (update.getStatus() != PayloadTransferUpdate.Status.SUCCESS) {
                    record("send", "transfer_failed", null);
                    finishSend(id, "Nearby data could not reach a player.");
                } else if (pending.remaining().isEmpty()) {
                    finishSend(id, null);
                }
            }
        };
    }

    private void finishSend(long id, String error) {
        PendingSend pending = pendingSends.remove(id);
        if (pending == null) return;
        if (error == null) pending.call().resolve();
        else pending.call().reject(error);
    }

    private void emit(int active, String type, String id, String key, String value) {
        if (active != generation) return;
        JSObject event = new JSObject();
        event.put("type", type);
        event.put("id", id);
        if (key != null) event.put(key, value);
        notifyListeners("nearbyEvent", event);
    }

    private void resolve(Task<Void> task, PluginCall call, String operation, String error) {
        record(operation, "started", null);
        task.addOnSuccessListener(ignored -> { record(operation, "succeeded", null); call.resolve(); })
            .addOnFailureListener(failure -> {
                Integer code = statusCode(failure); record(operation, "failed", code);
                call.reject(failureMessage(error, code), failure);
            });
    }
}
