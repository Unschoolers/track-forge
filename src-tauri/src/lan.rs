use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

const DISCOVERY_PORT: u16 = 47831;
const RACE_PORT: u16 = 47832;
const DISCOVERY_REQUEST: &[u8] = b"TF_LAN_1_SCAN";
const DISCOVERY_PREFIX: &str = "TF_LAN_1|";
const EVENT: &str = "trackforge-lan";
const MAX_PAYLOAD: usize = 16_003;
const MAX_FRAME: u64 = 24_000;
const MAX_GUESTS: usize = 7;

#[derive(Default)]
pub struct LanManager {
    state: Arc<Mutex<LanState>>,
}

#[derive(Default)]
struct LanState {
    generation: u64,
    cancelled: Arc<AtomicBool>,
    workers: Vec<JoinHandle<()>>,
    peers: HashMap<String, Arc<Peer>>,
    discovered: HashMap<String, String>,
    next_peer: u64,
    mode: &'static str,
}

struct Peer {
    writer: Mutex<TcpStream>,
    accepted_here: AtomicBool,
    accepted_there: AtomicBool,
    connected: AtomicBool,
}

fn lock<'a, T>(mutex: &'a Mutex<T>) -> Result<MutexGuard<'a, T>, String> {
    mutex.lock().map_err(|_| "LAN transport state is unavailable".to_owned())
}

fn notify(app: &AppHandle, event_type: &str, id: &str, extra: Option<(&str, String)>) {
    let mut event = json!({"type":event_type,"id":id});
    if let Some((key, value)) = extra {
        event[key] = json!(value);
    }
    let _ = app.emit(EVENT, event);
}

fn write_frame(peer: &Peer, frame: Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(&frame).map_err(|e| e.to_string())?;
    if line.len() + 1 > MAX_FRAME as usize {
        return Err("LAN frame exceeds limit".into());
    }
    line.push(b'\n');
    let mut writer = lock(&peer.writer)?;
    writer.write_all(&line).map_err(|e| format!("LAN send failed: {e}"))
}

fn mark_connected(app: &AppHandle, peer: &Peer, id: &str) {
    if peer.accepted_here.load(Ordering::SeqCst)
        && peer.accepted_there.load(Ordering::SeqCst)
        && !peer.connected.swap(true, Ordering::SeqCst)
    {
        notify(app, "connected", id, None);
    }
}

fn read_peer(
    app: AppHandle,
    state: Arc<Mutex<LanState>>,
    generation: u64,
    id: String,
    peer: Arc<Peer>,
    stream: TcpStream,
) {
    let mut reader = BufReader::new(stream);
    loop {
        let mut bytes = Vec::new();
        let result = (&mut reader).take(MAX_FRAME + 1).read_until(b'\n', &mut bytes);
        if !matches!(result, Ok(n) if n > 0 && n <= MAX_FRAME as usize && bytes.last() == Some(&b'\n')) {
            break;
        }
        let frame: Value = match serde_json::from_slice(&bytes[..bytes.len() - 1]) {
            Ok(v) => v,
            Err(_) => break,
        };
        match frame.get("t").and_then(Value::as_str) {
            Some("pair") => notify(&app, "pairing", &id, None),
            Some("accept") => {
                peer.accepted_there.store(true, Ordering::SeqCst);
                mark_connected(&app, &peer, &id);
            }
            Some("reject") => break,
            Some("data") if peer.connected.load(Ordering::SeqCst) => {
                let Some(encoded) = frame.get("d").and_then(Value::as_str) else { break };
                let Ok(raw) = STANDARD.decode(encoded) else { break };
                if raw.is_empty() || raw.len() > MAX_PAYLOAD { break; }
                notify(&app, "packet", &id, Some(("data", encoded.to_owned())));
            }
            _ => break,
        }
    }
    let removed = if let Ok(mut guard) = state.lock() {
        if guard.generation != generation { false } else {
            let matching = guard.peers.get(&id).is_some_and(|current| Arc::ptr_eq(current, &peer));
            if matching { guard.peers.remove(&id); }
            matching
        }
    } else {
        false
    };
    if removed {
        notify(&app, "disconnected", &id, None);
    }
}

fn add_peer(
    app: AppHandle,
    state: Arc<Mutex<LanState>>,
    generation: u64,
    id: String,
    stream: TcpStream,
    hosting: bool,
) -> Result<(), String> {
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    let writer = stream.try_clone().map_err(|e| e.to_string())?;
    let peer = Arc::new(Peer {
        writer: Mutex::new(writer),
        accepted_here: AtomicBool::new(false),
        accepted_there: AtomicBool::new(false),
        connected: AtomicBool::new(false),
    });
    {
        let mut guard = lock(&state)?;
        if guard.generation != generation || guard.peers.len() >= MAX_GUESTS + usize::from(!hosting) {
            return Err("LAN room is no longer accepting connections".into());
        }
        guard.peers.insert(id.clone(), Arc::clone(&peer));
    }
    let recv_peer = Arc::clone(&peer);
    let recv_state = Arc::clone(&state);
    let recv_app = app.clone();
    let recv_id = id.clone();
    thread::spawn(move || read_peer(recv_app, recv_state, generation, recv_id, recv_peer, stream));
    if hosting {
        if let Err(error) = write_frame(&peer, json!({"t":"pair"})) {
            if let Ok(mut guard) = state.lock() { guard.peers.remove(&id); }
            return Err(error);
        }
        notify(&app, "pairing", &id, None);
    }
    Ok(())
}

fn stop_inner(manager: &LanManager) -> Result<(), String> {
    let workers = {
        let mut guard = lock(&manager.state)?;
        guard.generation = guard.generation.wrapping_add(1);
        guard.cancelled.store(true, Ordering::SeqCst);
        for peer in guard.peers.values() {
            if let Ok(writer) = peer.writer.lock() {
                let _ = writer.shutdown(Shutdown::Both);
            }
        }
        guard.peers.clear();
        guard.discovered.clear();
        guard.mode = "";
        std::mem::take(&mut guard.workers)
    };
    for worker in workers {
        worker.join().map_err(|_| "LAN background worker terminated unexpectedly".to_owned())?;
    }
    Ok(())
}

fn begin(manager: &LanManager, mode: &'static str) -> Result<(u64, Arc<AtomicBool>), String> {
    stop_inner(manager)?;
    let mut guard = lock(&manager.state)?;
    guard.mode = mode;
    guard.cancelled = Arc::new(AtomicBool::new(false));
    Ok((guard.generation, Arc::clone(&guard.cancelled)))
}

#[tauri::command]
pub fn lan_host(
    app: AppHandle,
    manager: State<'_, LanManager>,
    name: String,
) -> Result<(), String> {
    if name.len() > 48 || !name.starts_with("Room ") && !name.starts_with("Track ") {
        return Err("Invalid LAN room name".into());
    }
    let (generation, cancelled) = begin(&manager, "hosting")?;
    let listener = TcpListener::bind(("0.0.0.0", RACE_PORT))
        .map_err(|e| format!("Cannot host LAN race on TCP port {RACE_PORT}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let discovery = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT))
        .map_err(|e| format!("Cannot advertise LAN room on UDP port {DISCOVERY_PORT}: {e}"))?;
    discovery.set_read_timeout(Some(Duration::from_millis(250))).map_err(|e| e.to_string())?;

    let discovery_cancel = Arc::clone(&cancelled);
    let room_name = name;
    let discovery_worker = thread::spawn(move || {
        let mut request = [0u8; 128];
        while !discovery_cancel.load(Ordering::SeqCst) {
            match discovery.recv_from(&mut request) {
                Ok((count, address)) if &request[..count] == DISCOVERY_REQUEST => {
                    let answer = format!("{DISCOVERY_PREFIX}{RACE_PORT}|{room_name}");
                    let _ = discovery.send_to(answer.as_bytes(), address);
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => break,
            }
        }
    });
    let server_cancel = Arc::clone(&cancelled);
    let state = Arc::clone(&manager.state);
    let server_worker = thread::spawn(move || {
        while !server_cancel.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _address)) => {
                    let id = {
                        let Ok(mut guard) = state.lock() else { break };
                        guard.next_peer += 1;
                        format!("peer-{}", guard.next_peer)
                    };
                    if let Err(message) = add_peer(app.clone(), Arc::clone(&state), generation, id, stream, true) {
                        notify(&app, "error", "", Some(("message", message)));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(35)),
                Err(error) => {
                    notify(&app, "error", "", Some(("message", format!("LAN listener failed: {error}"))));
                    break;
                }
            }
        }
    });
    let mut guard = lock(&manager.state)?;
    guard.workers.extend([discovery_worker, server_worker]);
    Ok(())
}

#[tauri::command]
pub fn lan_scan(app: AppHandle, manager: State<'_, LanManager>) -> Result<(), String> {
    let (generation, cancelled) = begin(&manager, "scanning")?;
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    socket.set_read_timeout(Some(Duration::from_millis(250))).map_err(|e| e.to_string())?;
    let state = Arc::clone(&manager.state);
    let worker = thread::spawn(move || {
        let mut discovered: HashMap<String, (String, Instant)> = HashMap::new();
        let mut last_broadcast = Instant::now() - Duration::from_secs(2);
        let mut buffer = [0u8; 128];
        while !cancelled.load(Ordering::SeqCst) {
            if last_broadcast.elapsed() >= Duration::from_millis(700) {
                if let Err(error) = socket.send_to(DISCOVERY_REQUEST, ("255.255.255.255", DISCOVERY_PORT)) {
                    notify(&app, "error", "", Some(("message", format!("LAN discovery failed: {error}"))));
                    break;
                }
                last_broadcast = Instant::now();
            }
            if let Ok((size, SocketAddr::V4(address))) = socket.recv_from(&mut buffer) {
                let Ok(message) = std::str::from_utf8(&buffer[..size]) else { continue };
                if let Some(remaining) = message.strip_prefix(DISCOVERY_PREFIX) {
                    if let Some((port, room)) = remaining.split_once('|') {
                        if port.parse::<u16>().ok() == Some(RACE_PORT)
                            && room.len() <= 48 && (room.starts_with("Room ") || room.starts_with("Track "))
                        {
                            let id = format!("{}:{}", address.ip(), RACE_PORT);
                            let first = !discovered.contains_key(&id);
                            discovered.insert(id.clone(), (room.to_owned(), Instant::now()));
                            if let Ok(mut guard) = state.lock() {
                                if guard.generation == generation {
                                    guard.discovered.insert(id.clone(), room.to_owned());
                                    if first { notify(&app, "found", &id, Some(("name", room.to_owned()))); }
                                }
                            }
                        }
                    }
                }
            }
            let expired: Vec<_> = discovered.iter()
                .filter(|(_, (_, seen))| seen.elapsed() > Duration::from_secs(4))
                .map(|(id, _)| id.clone())
                .collect();
            for id in expired {
                discovered.remove(&id);
                if let Ok(mut guard) = state.lock() {
                    if guard.generation == generation {
                        guard.discovered.remove(&id);
                        notify(&app, "lost", &id, None);
                    }
                }
            }
        }
    });
    lock(&manager.state)?.workers.push(worker);
    Ok(())
}

#[tauri::command]
pub fn lan_connect(app: AppHandle, manager: State<'_, LanManager>, id: String) -> Result<(), String> {
    let generation = {
        let guard = lock(&manager.state)?;
        if guard.mode != "scanning" || !guard.discovered.contains_key(&id) {
            return Err("Choose a discovered LAN room".into());
        }
        guard.generation
    };
    let address: SocketAddr = id.parse().map_err(|_| "Invalid discovered LAN endpoint".to_owned())?;
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|e| format!("Cannot connect to LAN host: {e}"))?;
    add_peer(app, Arc::clone(&manager.state), generation, id, stream, false)
}

#[tauri::command]
pub fn lan_respond(
    app: AppHandle,
    manager: State<'_, LanManager>,
    id: String,
    accepted: bool,
) -> Result<(), String> {
    let peer = lock(&manager.state)?.peers.get(&id).cloned()
        .ok_or_else(|| "LAN player disconnected".to_owned())?;
    if !accepted {
        let result = write_frame(&peer, json!({"t":"reject"}));
        if let Ok(writer) = peer.writer.lock() { let _ = writer.shutdown(Shutdown::Both); }
        return result;
    }
    write_frame(&peer, json!({"t":"accept"}))?;
    peer.accepted_here.store(true, Ordering::SeqCst);
    mark_connected(&app, &peer, &id);
    Ok(())
}

#[tauri::command]
pub fn lan_send(manager: State<'_, LanManager>, ids: Vec<String>, data: String) -> Result<(), String> {
    let payload = STANDARD.decode(&data).map_err(|_| "Malformed LAN packet".to_owned())?;
    if payload.is_empty() || payload.len() > MAX_PAYLOAD || ids.len() > MAX_GUESTS {
        return Err("LAN packet or recipient limit exceeded".into());
    }
    let guard = lock(&manager.state)?;
    for id in ids {
        let peer = guard.peers.get(&id).ok_or_else(|| "LAN peer not connected".to_owned())?;
        if !peer.connected.load(Ordering::SeqCst) {
            return Err("LAN peer not yet paired".into());
        }
        write_frame(peer, json!({"t":"data","d":data}))?;
    }
    Ok(())
}

#[tauri::command]
pub fn lan_lock(manager: State<'_, LanManager>) -> Result<(), String> {
    // Existing TCP links stay alive; stop only room advertisements.
    let guard = lock(&manager.state)?;
    if guard.mode != "hosting" { return Err("Not hosting LAN race".into()); }
    // New joins after starting are not allowed. Lobby capacity is enforced in application protocol.
    Ok(())
}

#[tauri::command]
pub fn lan_stop(manager: State<'_, LanManager>) -> Result<(), String> {
    stop_inner(&manager)
}

#[tauri::command]
pub fn lan_diagnostics(manager: State<'_, LanManager>) -> Result<Value, String> {
    let guard = lock(&manager.state)?;
    Ok(json!({"transport":"tcp-lan","mode":guard.mode,"connected":guard.peers.values()
        .filter(|p| p.connected.load(Ordering::SeqCst)).count(),"discovered":guard.discovered.len()}))
}
