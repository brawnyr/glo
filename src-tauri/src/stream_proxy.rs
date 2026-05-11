// Minimal local HTTP proxy that fetches an upstream radio stream and pipes
// it back to the webview, sidestepping CORS. The webview hits:
//
//     http://127.0.0.1:<port>/stream?url=<encoded upstream URL>
//
// We forward the response body as-is with permissive CORS headers and copy
// over Content-Type / Icy-* metadata when present.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::thread::JoinHandle;

use bytes::Bytes;
use futures_util::TryStreamExt;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use reqwest::Client;
use tokio::net::TcpListener;
use url::Url;

type BoxedBody = BoxBody<Bytes, std::io::Error>;

fn cors_headers(resp: &mut Response<BoxedBody>) {
    let h = resp.headers_mut();
    h.insert(
        "Access-Control-Allow-Origin",
        HeaderValue::from_static("*"),
    );
    h.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, OPTIONS"),
    );
    h.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("*"),
    );
}

fn full_body(bytes: Bytes) -> BoxedBody {
    Full::new(bytes)
        .map_err(|e: std::convert::Infallible| -> std::io::Error { match e {} })
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

async fn handle(
    req: Request<Incoming>,
    http: Client,
) -> Result<Response<BoxedBody>, Infallible> {
    // CORS preflight
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

    // Parse ?url=... from the query
    let parsed = match Url::parse(&format!("http://x/?{query}")) {
        Ok(u) => u,
        Err(_) => return Ok(text(StatusCode::BAD_REQUEST, "bad query")),
    };
    let upstream = match parsed.query_pairs().find(|(k, _)| k == "url").map(|(_, v)| v.into_owned()) {
        Some(u) => u,
        None => return Ok(text(StatusCode::BAD_REQUEST, "missing url param")),
    };

    // Block obviously-local upstreams to prevent SSRF
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
        .header("Icy-MetaData", "0")
        .header("User-Agent", "RadioSampler/0.1");

    let upstream_resp = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("upstream fetch failed: {e}");
            return Ok(text(StatusCode::BAD_GATEWAY, &format!("upstream error: {e}")));
        }
    };

    let status = upstream_resp.status();
    let content_type = upstream_resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .cloned();

    // Stream the body through as-is
    let stream = upstream_resp
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));
    let body = StreamBody::new(stream).boxed();

    let mut out = Response::builder()
        .status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK))
        .body(body)
        .unwrap();

    if let Some(ct) = content_type {
        out.headers_mut().insert(HeaderName::from_static("content-type"), ct);
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
pub fn spawn(http: Client) -> (u16, JoinHandle<()>) {
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
                    tokio::spawn(async move {
                        let _ = http1::Builder::new()
                            .serve_connection(io, service_fn(move |req| handle(req, client.clone())))
                            .await;
                    });
                }
            });
        })
        .expect("spawn proxy thread");

    let port = port_rx.recv().expect("proxy port");
    (port, handle)
}
