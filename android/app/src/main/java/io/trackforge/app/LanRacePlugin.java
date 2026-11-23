package io.trackforge.app;

import android.util.Base64;
import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Local Wi-Fi peer transport, compatible with the Tauri Windows LAN adapter.
 * The application owns all race protocol and lobbies; this plugin only carries
 * bounded packets, discovers hosts and reports peer lifecycle.
 */
@CapacitorPlugin(name = "TrackLan")
public class LanRacePlugin extends Plugin {
    private static final int DISCOVERY_PORT = 47831;
    private static final int RACE_PORT = 47832;
    private static final int MAX_PAYLOAD = 16_003;
    private static final int MAX_FRAME = 24_000;
    private static final int MAX_GUESTS = 7;
    private static final byte[] DISCOVER = "TF_LAN_1_SCAN".getBytes(StandardCharsets.US_ASCII);
    private static final String RESPONSE = "TF_LAN_1|";

    private final Object gate = new Object();
    private final Map<String, Peer> peers = new HashMap<>();
    private final Set<String> discovered = new HashSet<>();
    private volatile int generation;
    private long nextPeer;
    private volatile String mode = "idle";
    private volatile boolean locked;
    private ServerSocket server;
    private DatagramSocket discovery;
    private WifiManager.MulticastLock wifiDiscoveryLock;

    private static final class Peer {
        final Socket socket;
        final BufferedOutputStream output;
        volatile boolean acceptedHere;
        volatile boolean acceptedThere;
        volatile boolean connected;
        Peer(Socket socket) throws IOException {
            this.socket = socket;
            socket.setTcpNoDelay(true);
            this.output = new BufferedOutputStream(socket.getOutputStream());
        }
        synchronized void send(JSONObject packet) throws IOException {
            byte[] line = (packet.toString() + "\n").getBytes(StandardCharsets.UTF_8);
            if (line.length > MAX_FRAME) throw new IOException("LAN packet too large");
            output.write(line);
            output.flush();
        }
        void close() {
            try { socket.close(); } catch (IOException ignored) { /* already closed */ }
        }
    }

    private static JSONObject frame(String type) {
        JSONObject result = new JSONObject();
        try { result.put("t", type); } catch (JSONException error) { throw new IllegalStateException(error); }
        return result;
    }

    private void emit(String type, String id, String field, String value) {
        JSObject event = new JSObject();
        event.put("type", type);
        event.put("id", id);
        if (field != null) event.put(field, value);
        notifyListeners("lanEvent", event);
    }

    private void error(String message) {
        emit("error", "", "message", message);
    }

    /** Keep Android's Wi-Fi receiver awake for broadcast discovery while hosting only. */
    private void acquireWifiDiscoveryLock() throws IOException {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) return; // e.g. wired-only device
        try {
            WifiManager.MulticastLock reception = wifi.createMulticastLock("TrackForgeLanDiscovery");
            reception.setReferenceCounted(false);
            reception.acquire();
            wifiDiscoveryLock = reception;
        } catch (SecurityException exception) {
            throw new IOException("Cannot receive Wi-Fi discovery broadcasts: " + exception.getMessage(), exception);
        }
    }

    private static String localWifiIpv4() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface candidate = interfaces.nextElement();
                String name = candidate.getName();
                if (!candidate.isUp() || candidate.isLoopback() ||
                    !(name.startsWith("wlan") || name.startsWith("eth"))) continue;
                Enumeration<InetAddress> addresses = candidate.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (SocketException error) {
            Log.w("TrackForgeLan", "Could not determine local host address", error);
        }
        return null;
    }

    private static boolean validLanIp(String ip) {
        if (ip == null || ip.length() > 15) return false;
        String[] parts = ip.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        for (int index = 0; index < 4; index++) {
            String part = parts[index];
            if (part.isEmpty() || part.length() > 3 || (part.length() > 1 && part.charAt(0) == '0')) return false;
            for (int i = 0; i < part.length(); i++) {
                if (part.charAt(i) < '0' || part.charAt(i) > '9') return false;
            }
            try {
                octets[index] = Integer.parseInt(part);
                if (octets[index] > 255) return false;
            } catch (NumberFormatException error) { return false; }
        }
        return octets[0] == 10 || octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 ||
            octets[0] == 192 && octets[1] == 168 ||
            octets[0] == 169 && octets[1] == 254;
    }

    private void stopInternal() {
        synchronized (gate) {
            generation++;
            mode = "idle";
            locked = false;
            if (server != null) try { server.close(); } catch (IOException ignored) { /* already closed */ }
            if (discovery != null) discovery.close();
            server = null;
            discovery = null;
            for (Peer peer : peers.values()) peer.close();
            peers.clear();
            discovered.clear();
            if (wifiDiscoveryLock != null) {
                if (wifiDiscoveryLock.isHeld()) wifiDiscoveryLock.release();
                wifiDiscoveryLock = null;
            }
        }
    }

    private void readPeer(String id, Peer peer, int session) {
        try {
            BufferedInputStream input = new BufferedInputStream(peer.socket.getInputStream());
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(256);
            while (true) {
                buffer.reset();
                int ch;
                while ((ch = input.read()) != -1 && ch != '\n') {
                    if (buffer.size() >= MAX_FRAME - 1) throw new IOException("LAN frame exceeded size limit");
                    buffer.write(ch);
                }
                if (ch == -1) break;
                JSONObject packet = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
                String type = packet.optString("t", "");
                switch (type) {
                    case "pair" -> emit("pairing", id, null, null);
                    case "accept" -> {
                        peer.acceptedThere = true;
                        maybeConnected(id, peer);
                    }
                    case "reject" -> { return; }
                    case "data" -> {
                        if (!peer.connected) throw new IOException("Data before LAN pairing");
                        String encoded = packet.optString("d", "");
                        byte[] data = Base64.decode(encoded, Base64.DEFAULT);
                        if (data.length == 0 || data.length > MAX_PAYLOAD) throw new IOException("Invalid LAN data");
                        emit("packet", id, "data", encoded);
                    }
                    default -> throw new IOException("Unsupported LAN frame");
                }
            }
        } catch (IOException | JSONException | IllegalArgumentException exception) {
            android.util.Log.w("TrackForgeLan", "LAN peer connection ended: " + id, exception);
        } finally {
            peer.close();
            synchronized (gate) {
                if (generation == session && peers.get(id) == peer) {
                    peers.remove(id);
                    emit("disconnected", id, null, null);
                }
            }
        }
    }

    private void maybeConnected(String id, Peer peer) {
        synchronized (peer) {
            if (peer.acceptedHere && peer.acceptedThere && !peer.connected) {
                peer.connected = true;
                emit("connected", id, null, null);
            }
        }
    }

    private boolean addPeer(String id, Socket socket, int session, boolean hosting) throws IOException {
        Peer peer = new Peer(socket);
        synchronized (gate) {
            if (generation != session || (hosting && (locked || peers.size() >= MAX_GUESTS))) {
                peer.close();
                return false;
            }
            peers.put(id, peer);
        }
        new Thread(() -> readPeer(id, peer, session), "lan-peer-reader").start();
        if (hosting) {
            peer.send(frame("pair"));
            emit("pairing", id, null, null);
        }
        return true;
    }

    @PluginMethod
    public void host(PluginCall call) {
        String room = call.getString("name");
        if (room == null || room.length() > 48 ||
                !(room.startsWith("Room ") || room.startsWith("Track "))) {
            call.reject("Invalid LAN room name");
            return;
        }
        stopInternal();
        final int session;
        try {
            synchronized (gate) {
                mode = "hosting";
                acquireWifiDiscoveryLock();
                server = new ServerSocket();
                server.setReuseAddress(true);
                server.bind(new InetSocketAddress(RACE_PORT));
                discovery = new DatagramSocket(DISCOVERY_PORT);
                discovery.setSoTimeout(250);
                session = generation;
            }
        } catch (IOException exception) {
            stopInternal();
            call.reject("Cannot open LAN host: " + exception.getMessage());
            return;
        }
        final ServerSocket socketServer = server;
        final DatagramSocket socketDiscovery = discovery;
        new Thread(() -> {
            while (true) {
                try {
                    Socket socket = socketServer.accept();
                    String id;
                    synchronized (gate) { id = "peer-" + (++nextPeer); }
                    if (!addPeer(id, socket, session, true)) socket.close();
                } catch (SocketException closed) { return; }
                catch (IOException exception) {
                    if (generation == session) error("LAN host failed: " + exception.getMessage());
                    return;
                }
            }
        }, "lan-host-accept").start();
        new Thread(() -> {
            byte[] buffer = new byte[128];
            while (!socketDiscovery.isClosed()) {
                DatagramPacket request = new DatagramPacket(buffer, buffer.length);
                try {
                    socketDiscovery.receive(request);
                    if (generation != session) return;
                    String payload = new String(request.getData(), request.getOffset(),
                            request.getLength(), StandardCharsets.US_ASCII);
                    if (!payload.equals(new String(DISCOVER, StandardCharsets.US_ASCII)) || locked) continue;
                    byte[] response = (RESPONSE + RACE_PORT + "|" + room).getBytes(StandardCharsets.UTF_8);
                    socketDiscovery.send(new DatagramPacket(response, response.length,
                            request.getAddress(), request.getPort()));
                } catch (SocketTimeoutException retry) { /* poll stop flag */ }
                catch (SocketException closed) { return; }
                catch (IOException exception) {
                    if (generation == session) error("LAN discovery host failed: " + exception.getMessage());
                    return;
                }
            }
        }, "lan-host-discovery").start();
        JSObject address = new JSObject();
        String hostIp = localWifiIpv4();
        if (hostIp != null) address.put("hostIp", hostIp);
        call.resolve(address);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        stopInternal();
        final DatagramSocket socket;
        final int session;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(250);
            synchronized (gate) {
                mode = "scanning";
                discovery = socket;
                session = generation;
            }
        } catch (IOException exception) {
            call.reject("Cannot scan the local network: " + exception.getMessage());
            return;
        }
        new Thread(() -> {
            Map<String, Long> lastSeen = new HashMap<>();
            byte[] buffer = new byte[128];
            long lastSent = 0;
            while (generation == session && !socket.isClosed()) {
                long now = android.os.SystemClock.elapsedRealtime();
                if (now - lastSent > 700) {
                    try {
                        socket.send(new DatagramPacket(DISCOVER, DISCOVER.length,
                                java.net.InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT));
                    } catch (IOException exception) {
                        if (generation == session) error("LAN search failed: " + exception.getMessage());
                        return;
                    }
                    lastSent = now;
                }
                DatagramPacket response = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(response);
                    String text = new String(response.getData(), response.getOffset(),
                            response.getLength(), StandardCharsets.UTF_8);
                    if (text.startsWith(RESPONSE)) {
                        String[] fields = text.substring(RESPONSE.length()).split("\\|", 2);
                        if (fields.length == 2 && String.valueOf(RACE_PORT).equals(fields[0])
                                && fields[1].length() <= 48
                                && (fields[1].startsWith("Room ") || fields[1].startsWith("Track "))) {
                            String id = response.getAddress().getHostAddress() + ":" + RACE_PORT;
                            synchronized (gate) {
                                if (generation == session) {
                                    if (discovered.add(id)) emit("found", id, "name", fields[1]);
                                    lastSeen.put(id, now);
                                }
                            }
                        }
                    }
                } catch (SocketTimeoutException retry) { /* poll expiry */ }
                catch (SocketException closed) { return; }
                catch (IOException exception) {
                    if (generation == session) error("LAN search failed: " + exception.getMessage());
                    return;
                }
                for (String id : new HashSet<>(lastSeen.keySet())) {
                    if (now - lastSeen.get(id) <= 4_000) continue;
                    lastSeen.remove(id);
                    synchronized (gate) {
                        if (generation == session && discovered.remove(id)) emit("lost", id, null, null);
                    }
                }
            }
        }, "lan-guest-discovery").start();
        call.resolve();
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String id = call.getString("id", "");
        final int session;
        synchronized (gate) {
            if (!"scanning".equals(mode) || !discovered.contains(id)) {
                call.reject("Choose a discovered LAN room");
                return;
            }
            session = generation;
        }
        String[] address = id.split(":", 2);
        if (address.length != 2 || !String.valueOf(RACE_PORT).equals(address[1]) ||
            !validLanIp(address[0])) {
            call.reject("Invalid discovered LAN address");
            return;
        }
        connectToHost(id, address[0], session, call);
    }

    @PluginMethod
    public void connectDirect(PluginCall call) {
        String ip = call.getString("ip", "");
        if (!validLanIp(ip)) {
            call.reject("Enter a private LAN IPv4 address.");
            return;
        }
        final int session;
        synchronized (gate) {
            if (!"scanning".equals(mode)) {
                call.reject("Start searching for LAN races first.");
                return;
            }
            session = generation;
        }
        connectToHost(ip, ip, session, call);
    }

    private void connectToHost(String id, String ip, int session, PluginCall call) {
        new Thread(() -> {
            try {
                Socket socket = new Socket();
                socket.connect(new InetSocketAddress(ip, RACE_PORT), 3_000);
                if (addPeer(id, socket, session, false)) call.resolve();
                else call.reject("LAN room closed");
            } catch (IOException exception) {
                call.reject("Cannot reach " + ip + ":" + RACE_PORT +
                    ". Check Wi-Fi and the host firewall: " + exception.getMessage());
            }
        }, "lan-connect").start();
    }

    @PluginMethod
    public void respond(PluginCall call) {
        String id = call.getString("id", "");
        boolean accepted = Boolean.TRUE.equals(call.getBoolean("accepted"));
        Peer peer;
        synchronized (gate) { peer = peers.get(id); }
        if (peer == null) { call.reject("LAN player disconnected"); return; }
        try {
            peer.send(frame(accepted ? "accept" : "reject"));
            if (accepted) {
                peer.acceptedHere = true;
                maybeConnected(id, peer);
            } else peer.close();
            call.resolve();
        } catch (IOException exception) { call.reject("LAN pairing failed: " + exception.getMessage()); }
    }

    @PluginMethod
    public void lock(PluginCall call) {
        synchronized (gate) {
            if (!"hosting".equals(mode)) { call.reject("Not hosting a LAN race"); return; }
            locked = true;
        }
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        com.getcapacitor.JSArray recipients = call.getArray("ids");
        String encoded = call.getString("data", "");
        if (recipients == null || recipients.length() > MAX_GUESTS) { call.reject("Invalid LAN recipients"); return; }
        byte[] data;
        try { data = Base64.decode(encoded, Base64.DEFAULT); }
        catch (IllegalArgumentException invalid) { call.reject("Malformed LAN payload"); return; }
        if (data.length == 0 || data.length > MAX_PAYLOAD) { call.reject("LAN packet too large"); return; }
        JSONObject message = frame("data");
        try { message.put("d", encoded); } catch (JSONException invalid) { call.reject("Invalid LAN payload"); return; }
        try {
            for (int index = 0; index < recipients.length(); index++) {
                String id = recipients.getString(index);
                Peer peer;
                synchronized (gate) { peer = peers.get(id); }
                if (peer == null || !peer.connected) throw new IOException("LAN player disconnected");
                peer.send(message);
            }
            call.resolve();
        } catch (IOException | JSONException exception) { call.reject("LAN send failed: " + exception.getMessage()); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve();
    }

    @PluginMethod
    public void diagnostics(PluginCall call) {
        JSObject info = new JSObject();
        synchronized (gate) {
            info.put("transport", "tcp-lan");
            info.put("mode", mode);
            info.put("peers", peers.size());
            info.put("discovered", discovered.size());
        }
        call.resolve(info);
    }

    @Override protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }
}
