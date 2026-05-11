// Minimal local HTTP proxy that fetches an upstream radio stream and pipes
// it back to the webview, sidestepping CORS. The webview hits:
//
//     http://127.0.0.1:<port>/stream?url=<encoded upstream URL>
//
// We forward the response body as-is with permissive CORS headers and copy
// over Content-Type / Icy-* metadata when present. We also request ICY
// inline metadata, parse the StreamTitle from it, strip it before forwarding
// the audio bytes downstream, and emit a `current-track` Tauri event on
// title changes.

use std::convert::Infallible;
use std::net::SocketAddr;
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
use reqwest::Client;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use url::Url;

type BoxedBody = BoxBody<Bytes, std::io::Error>;

#[derive(Serialize, Clone)]
struct TrackEvent {
    title: String,
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

/// Extract `StreamTitle='...'` from an ICY metadata string.
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

/// Wrap an upstream stream that has ICY inline metadata. Strip the metadata
/// bytes from the downstream output and emit `current-track` events on
/// title changes.
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
                            // null-strip and parse as latin-1ish utf-8
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
    http: Client,
    app: AppHandle,
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

    if let Ok(target) = Url::parse(&upstream) {
        match target.host_str() {
            Some(host) => {
                let lower = host.to_lowercase();
                let is_local = lower == "localhost"
                    || lower.ends_with(".localhost")
                    || lower == "127.0.0.1"
                    || lower.starts_with("10.")
                    || lower.starts_with("192.168.")
                    || lower.starts_with("169.254.")
                    || lower == "0.0.0.0";
                if is_local {
                    return Ok(text(StatusCode::FORBIDDEN, "local upstream blocked"));
                }
            }
            None => return Ok(text(StatusCode::BAD_REQUEST, "invalid upstream url")),
        }
    } else {
        return Ok(text(StatusCode::BAD_REQUEST, "invalid upstream url"));
    }

    log::info!("proxy GET {}", upstream);

    let upstream_req = http
        .get(&upstream)
        .header("Icy-MetaData", "1")
        .header("User-Agent", "RadioSampler/0.1");

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

    let body: BoxedBody = if let Some(n) = metaint {
        log::info!("upstream serves ICY metadata every {n} bytes");
        let s = strip_icy_metadata(upstream_resp.bytes_stream(), n, app);
        let frames = s.map_ok(Frame::data);
        BodyExt::boxed(StreamBody::new(frames))
    } else {
        let s = upstream_resp
            .bytes_stream()
            .map_ok(Frame::data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));
        BodyExt::boxed(StreamBody::new(s))
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

/// Spawn the proxy on a random free port. Returns (port, thread handle).
pub fn spawn(http: Client, app: AppHandle) -> (u16, JoinHandle<()>) {
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

                loop {
                    let (stream, _) = match listener.accept().await {
                        Ok(p) => p,
                        Err(e) => {
                            log::warn!("accept error: {e}");
                            continue;
                        }
                    };
                    let io = TokioIo::new(stream);
                    let client = http.clone();
                    let app_h = app.clone();
                    tokio::spawn(async move {
                        let _ = http1::Builder::new()
                            .serve_connection(
                                io,
                                service_fn(move |req| handle(req, client.clone(), app_h.clone())),
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
