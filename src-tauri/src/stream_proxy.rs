// Local HTTP proxy that fetches an upstream radio stream and pipes it back
// to the webview, sidestepping CORS. The webview hits:
//
//     http://127.0.0.1:<port>/stream?url=<encoded upstream URL>
//
// We also request ICY inline metadata, strip it from the audio bytes before
// forwarding, and emit a `current-track` Tauri event on title changes. The
// stream's self-reported name (icy-name response header) is forwarded as a
// `station-name` event so the UI can show what the upstream actually
// identifies as, instead of trusting the radio-browser directory entry.

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::thread::JoinHandle;

use async_stream::stream;
use bytes::{Bytes, BytesMut};
use futures_util::{Stream, StreamExt, TryStreamExt};
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::net::{lookup_host, TcpListener};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use url::Url;

use crate::USER_AGENT;

type BoxedBody = BoxBody<Bytes, std::io::Error>;

/// Cap on concurrent in-flight `/stream` requests. A malicious page could
/// otherwise open unbounded upstream connections through this proxy.
const MAX_CONCURRENT_STREAMS: usize = 4;

#[derive(Serialize, Clone)]
struct TrackEvent {
    title: String,
}

#[derive(Serialize, Clone)]
struct StationNameEvent {
    name: String,
}

fn cors_headers(resp: &mut Response<BoxedBody>) {
    let h = resp.headers_mut();
    h.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    h.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, OPTIONS"),
    );
    h.insert("Access-Control-Allow-Headers", HeaderValue::from_static("*"));
}

fn full_body(bytes: Bytes) -> BoxedBody {
    Full::new(bytes)
        .map_err(|e: Infallible| -> std::io::Error { match e {} })
        .boxed()
}

fn empty(status: StatusCode) -> Response<BoxedBody> {
    let mut r = Response::builder()
        .status(status)
        .body(full_body(Bytes::new()))
        .unwrap();
    cors_headers(&mut r);
    r
}

fn text(status: StatusCode, msg: &str) -> Response<BoxedBody> {
    let mut r = Response::builder()
        .status(status)
        .body(full_body(Bytes::from(msg.to_owned())))
        .unwrap();
    r.headers_mut()
        .insert("Content-Type", HeaderValue::from_static("text/plain"));
    cors_headers(&mut r);
    r
}

/// Returns true if the given IP must not be reachable via this proxy.
/// Covers loopback, unspecified, private, link-local, multicast, broadcast,
/// documentation, and reserved ranges across both IPv4 and IPv6 — including
/// IPv6 `::1`, `::`, `fe80::/10` (link-local) and `fc00::/7` (unique local),
/// which the previous string-prefix check missed.
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            // is_private covers 10/8, 172.16/12, 192.168/16.
            v4.is_loopback()
                || v4.is_unspecified()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_documentation()
                // 0.0.0.0/8 (current network) is partially covered by is_unspecified
                // for the all-zero case; reject the whole /8 for safety.
                || v4.octets()[0] == 0
                // 240.0.0.0/4 reserved (excluding broadcast handled above).
                || v4.octets()[0] >= 240
                // 100.64.0.0/10 carrier-grade NAT.
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            // is_loopback covers ::1; is_unspecified covers ::.
            if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
                return true;
            }
            // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — apply v4 rules.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            if let Some(v4) = v6.to_ipv4() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            let seg0 = v6.segments()[0];
            // fe80::/10 — link-local. (Ipv6Addr::is_unicast_link_local is
            // unstable on 1.75, so byte-check the high 10 bits.)
            if (seg0 & 0xffc0) == 0xfe80 {
                return true;
            }
            // fc00::/7 — unique local addresses (ULA).
            if (seg0 & 0xfe00) == 0xfc00 {
                return true;
            }
            // fec0::/10 — deprecated site-local; reject defensively.
            if (seg0 & 0xffc0) == 0xfec0 {
                return true;
            }
            false
        }
    }
}

/// Resolves `host:port` and returns the addresses iff every resolved IP is
/// safe (not in a blocked range). Any blocked IP fails the whole lookup —
/// this is what closes the DNS-rebinding window: we both validate *and* hand
/// the resolved sockets straight to reqwest, so the upstream fetch cannot
/// re-resolve to a different address later.
async fn resolve_and_validate(host: &str, port: u16) -> Result<Vec<SocketAddr>, &'static str> {
    // Literal IPs in the URL skip DNS but must still be validated.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("blocked address");
        }
        return Ok(vec![SocketAddr::new(ip, port)]);
    }

    let iter = lookup_host((host, port))
        .await
        .map_err(|_| "dns lookup failed")?;
    let addrs: Vec<SocketAddr> = iter.collect();
    if addrs.is_empty() {
        return Err("dns lookup returned no addresses");
    }
    if addrs.iter().any(|a| is_blocked_ip(a.ip())) {
        return Err("upstream resolves to a blocked address");
    }
    Ok(addrs)
}

fn extract_stream_title(meta: &str) -> Option<String> {
    let key = "StreamTitle=";
    let start = meta.find(key)? + key.len();
    let bytes = meta.as_bytes();
    if start >= bytes.len() {
        return None;
    }
    let quote = bytes[start];
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    let from = start + 1;
    let end_rel = meta[from..].find(quote as char)?;
    let title = meta[from..from + end_rel].trim().to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

/// Pulls ICY inline metadata out of the upstream byte stream, yielding only
/// the audio bytes downstream and emitting `current-track` events on changes.
fn strip_icy_metadata<S>(
    mut upstream: S,
    metaint: usize,
    app: AppHandle,
) -> impl Stream<Item = Result<Bytes, std::io::Error>>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    stream! {
        enum State { Audio(usize), MetaLen, Meta(usize) }
        let mut state = State::Audio(metaint);
        let mut meta_buf = BytesMut::new();
        let mut current_title: Option<String> = None;

        while let Some(chunk) = upstream.next().await {
            let chunk = match chunk {
                Ok(b) => b,
                Err(e) => {
                    yield Err(std::io::Error::new(std::io::ErrorKind::Other, e));
                    return;
                }
            };
            let mut data: &[u8] = &chunk;
            while !data.is_empty() {
                match state {
                    State::Audio(remaining) => {
                        let take = remaining.min(data.len());
                        let (audio, rest) = data.split_at(take);
                        if !audio.is_empty() {
                            yield Ok(Bytes::copy_from_slice(audio));
                        }
                        data = rest;
                        if take == remaining {
                            state = State::MetaLen;
                        } else {
                            state = State::Audio(remaining - take);
                        }
                    }
                    State::MetaLen => {
                        let len = data[0] as usize * 16;
                        data = &data[1..];
                        if len == 0 {
                            state = State::Audio(metaint);
                        } else {
                            meta_buf.clear();
                            meta_buf.reserve(len);
                            state = State::Meta(len);
                        }
                    }
                    State::Meta(remaining) => {
                        let take = remaining.min(data.len());
                        meta_buf.extend_from_slice(&data[..take]);
                        data = &data[take..];
                        if take == remaining {
                            // ICY metadata frames are null-padded to the next 16-byte boundary.
                            let trimmed: Vec<u8> = meta_buf
                                .iter()
                                .copied()
                                .take_while(|&b| b != 0)
                                .collect();
                            if let Ok(s) = std::str::from_utf8(&trimmed) {
                                if let Some(title) = extract_stream_title(s) {
                                    if current_title.as_deref() != Some(&title) {
                                        let _ = app.emit("current-track", TrackEvent { title: title.clone() });
                                        current_title = Some(title);
                                    }
                                }
                            }
                            state = State::Audio(metaint);
                        } else {
                            state = State::Meta(remaining - take);
                        }
                    }
                }
            }
        }
    }
}

async fn handle(
    req: Request<Incoming>,
    app: AppHandle,
    sem: Arc<Semaphore>,
) -> Result<Response<BoxedBody>, Infallible> {
    if req.method() == Method::OPTIONS {
        return Ok(empty(StatusCode::NO_CONTENT));
    }

    let path = req.uri().path();
    let query = req.uri().query().unwrap_or("");

    if path == "/health" {
        return Ok(text(StatusCode::OK, "ok"));
    }

    if path != "/stream" {
        return Ok(text(StatusCode::NOT_FOUND, "not found"));
    }

    // Concurrency cap: refuse new streams once MAX_CONCURRENT_STREAMS are
    // already in flight. Permit is held until the response body finishes
    // streaming (it's moved into the body's stream closure below).
    let permit = match sem.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => {
            return Ok(text(
                StatusCode::SERVICE_UNAVAILABLE,
                "too many concurrent streams",
            ));
        }
    };

    let parsed = match Url::parse(&format!("http://x/?{query}")) {
        Ok(u) => u,
        Err(_) => return Ok(text(StatusCode::BAD_REQUEST, "bad query")),
    };
    let upstream = match parsed
        .query_pairs()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v.into_owned())
    {
        Some(u) => u,
        None => return Ok(text(StatusCode::BAD_REQUEST, "missing url param")),
    };

    let target = match Url::parse(&upstream) {
        Ok(u) => u,
        Err(_) => return Ok(text(StatusCode::BAD_REQUEST, "invalid upstream url")),
    };

    // Only http(s) upstreams. Blocks file://, gopher://, etc.
    let scheme = target.scheme();
    if scheme != "http" && scheme != "https" {
        return Ok(text(StatusCode::FORBIDDEN, "unsupported scheme"));
    }

    let host = match target.host_str() {
        Some(h) => h.to_string(),
        None => return Ok(text(StatusCode::BAD_REQUEST, "invalid upstream url")),
    };

    // Quick reject for hostnames we know point at the loopback adapter; the
    // OS resolver is also asked below, but this saves a DNS round-trip and
    // catches `localhost` even when nsswitch is misconfigured.
    let lower = host.to_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") {
        return Ok(text(StatusCode::FORBIDDEN, "local upstream blocked"));
    }

    let port = target.port_or_known_default().unwrap_or(80);

    // Resolve once, validate every IP, then pin reqwest to those exact
    // SocketAddrs. This closes the DNS-rebinding window: even if the
    // attacker's authoritative server returns a private IP a moment later,
    // reqwest will only ever connect to the addresses we already approved.
    let addrs = match resolve_and_validate(&host, port).await {
        Ok(a) => a,
        Err(reason) => {
            log::warn!("blocked upstream {host}: {reason}");
            return Ok(text(StatusCode::FORBIDDEN, reason));
        }
    };

    // Per-request client with the resolution pinned. The shared `_http`
    // client doesn't expose `resolve_to_addrs` overrides post-build, so we
    // spin up a small one here. (Cost is negligible next to a streaming
    // radio fetch.)
    let pinned_client = match reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .resolve_to_addrs(&host, &addrs)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("client build failed: {e}");
            return Ok(text(StatusCode::INTERNAL_SERVER_ERROR, "client build failed"));
        }
    };

    log::info!("proxy GET {} (resolved to {} addr(s))", upstream, addrs.len());

    let upstream_req = pinned_client
        .get(&upstream)
        .header("Icy-MetaData", "1");

    let upstream_resp = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("upstream fetch failed: {e}");
            return Ok(text(
                StatusCode::BAD_GATEWAY,
                &format!("upstream error: {e}"),
            ));
        }
    };

    let status = upstream_resp.status();
    let content_type = upstream_resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .cloned();
    let metaint: Option<usize> = upstream_resp
        .headers()
        .get("icy-metaint")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .filter(|n: &usize| *n > 0 && *n < 1024 * 1024);

    // The stream's self-reported name. radio-browser directory entries are
    // community-edited and frequently drift from what the upstream operator
    // is actually broadcasting, so prefer this when present.
    if let Some(name) = upstream_resp
        .headers()
        .get("icy-name")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        let _ = app.emit("station-name", StationNameEvent { name });
    }

    let body: BoxedBody = if let Some(n) = metaint {
        log::info!("upstream serves ICY metadata every {n} bytes");
        let s = Box::pin(strip_icy_metadata(upstream_resp.bytes_stream(), n, app));
        let s = PermitStream::new(s, permit);
        let frames = s.map_ok(Frame::data);
        BodyExt::boxed(StreamBody::new(frames))
    } else {
        let s = Box::pin(
            upstream_resp
                .bytes_stream()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)),
        );
        let s = PermitStream::new(s, permit);
        let frames = s.map_ok(Frame::data);
        BodyExt::boxed(StreamBody::new(frames))
    };

    let mut out = Response::builder()
        .status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK))
        .body(body)
        .unwrap();

    if let Some(ct) = content_type {
        out.headers_mut()
            .insert(HeaderName::from_static("content-type"), ct);
    } else {
        out.headers_mut().insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("audio/mpeg"),
        );
    }
    cors_headers(&mut out);
    Ok(out)
}

/// Wraps a stream so the concurrency-cap permit is dropped only when the
/// wrapped stream is dropped — i.e. when the client disconnects or the
/// upstream finishes. Without this the permit would release the moment
/// `handle` returns, defeating the cap on long-running streams.
struct PermitStream<S> {
    inner: S,
    // Only `Drop` cares about the permit; it owns nothing else.
    _permit: OwnedSemaphorePermit,
}

impl<S> PermitStream<S> {
    fn new(inner: S, permit: OwnedSemaphorePermit) -> Self {
        Self { inner, _permit: permit }
    }
}

impl<S, T, E> Stream for PermitStream<S>
where
    S: Stream<Item = Result<T, E>> + Unpin,
{
    type Item = Result<T, E>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::pin::Pin::new(&mut self.inner).poll_next(cx)
    }
}

/// Spawns the proxy on a random free port and returns (port, thread handle).
/// Each handler builds its own reqwest client per-request because DNS gets
/// pinned per upstream host (see `resolve_to_addrs` in `handle`).
pub fn spawn(app: AppHandle) -> (u16, JoinHandle<()>) {
    let (port_tx, port_rx) = std::sync::mpsc::channel::<u16>();

    let handle = std::thread::Builder::new()
        .name("stream-proxy".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("tokio runtime");

            rt.block_on(async move {
                let addr: SocketAddr = ([127, 0, 0, 1], 0).into();
                let listener = TcpListener::bind(addr).await.expect("bind proxy");
                let local_port = listener.local_addr().expect("local addr").port();
                let _ = port_tx.send(local_port);

                let sem = Arc::new(Semaphore::new(MAX_CONCURRENT_STREAMS));

                loop {
                    let (stream, _) = match listener.accept().await {
                        Ok(p) => p,
                        Err(e) => {
                            log::warn!("accept error: {e}");
                            continue;
                        }
                    };
                    let io = TokioIo::new(stream);
                    let app_h = app.clone();
                    let sem = sem.clone();
                    tokio::spawn(async move {
                        let _ = http1::Builder::new()
                            .serve_connection(
                                io,
                                service_fn(move |req| {
                                    handle(req, app_h.clone(), sem.clone())
                                }),
                            )
                            .await;
                    });
                }
            });
        })
        .expect("spawn proxy thread");

    let port = port_rx.recv().expect("proxy port");
    (port, handle)
}
