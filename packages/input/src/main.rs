//! glance-input: native macOS mouse helper.
//!
//! Protocol: one JSON object per line on stdin, exactly one JSON line per
//! request on stdout (flushed immediately). An optional `id` is echoed back.
//! Replies are `{"ok":true,...}` or `{"ok":false,"error":"..."}`; every reply
//! also carries `"trusted"` (AXIsProcessTrusted).
//!
//! Ops:
//!   {"op":"move","x":N,"y":N}      global CG points (origin top-left of main display).
//!                                  Posts LeftMouseDragged/RightMouseDragged while a
//!                                  button is held (after "down"), else MouseMoved.
//!                                  Also calls CGWarpMouseCursorPosition (works without
//!                                  Accessibility). Reply: {"x","y"} = resulting pos.
//!   {"op":"click","button":"left"|"right","double":bool?}  at current cursor position;
//!                                  double click's 2nd down/up carry clickState = 2.
//!   {"op":"scroll","dy":N,"dx":N?} pixel-unit scroll wheel event.
//!                                  SIGN: CG convention, passed through unchanged:
//!                                  dy > 0 = wheel up (view reveals content above, i.e.
//!                                  content moves DOWN on screen); dy < 0 = wheel down
//!                                  (content moves up, page scrolls toward its end).
//!                                  dx > 0 = scroll left, dx < 0 = scroll right.
//!                                  (macOS "natural scrolling" is applied by the system
//!                                  to real devices only, not to synthetic events.)
//!   {"op":"down"|"up","button":"left"|"right"}  press/release for drags.
//!   {"op":"pos"}                   -> {"ok":true,"x":N,"y":N}
//!   {"op":"trusted"}               -> {"ok":true,"trusted":bool}
//!   {"op":"ping"}                  -> {"ok":true}
//!
//! Accessibility trust: CGEventPost-based ops (click/scroll/down/up and the posted
//! MouseMoved/Dragged event) are silently dropped by macOS when the process is not
//! trusted. Cursor warp (move) and pos work without trust, but warp alone does not
//! generate mouse events, so hover/drag in apps needs trust.

use serde_json::{json, Map, Value};
use std::io::{self, BufRead, Write};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Button {
    Left,
    Right,
}

/// Abstraction over the OS so request handling is testable without Accessibility.
pub trait Backend {
    /// Move cursor to (x, y). `drag` = button currently held, if any.
    fn move_to(&mut self, x: f64, y: f64, drag: Option<Button>) -> Result<(), String>;
    /// Post a mouse button transition at the current cursor position.
    fn button(&mut self, b: Button, down: bool, click_state: i64) -> Result<(), String>;
    fn scroll(&mut self, dy: i32, dx: i32) -> Result<(), String>;
    fn pos(&self) -> (f64, f64);
    fn trusted(&self) -> bool;
}

pub struct Handler<B: Backend> {
    pub backend: B,
    pub held: Option<Button>,
}

fn parse_button(v: &Value) -> Result<Button, String> {
    match v.get("button").and_then(Value::as_str) {
        Some("left") => Ok(Button::Left),
        Some("right") => Ok(Button::Right),
        Some(o) => Err(format!("bad button: {o}")),
        None => Err("missing button".into()),
    }
}

fn num(v: &Value, k: &str) -> Result<f64, String> {
    match v.get(k) {
        Some(n) => n
            .as_f64()
            .filter(|f| f.is_finite())
            .ok_or_else(|| format!("{k} must be a finite number")),
        None => Err(format!("missing {k}")),
    }
}

impl<B: Backend> Handler<B> {
    pub fn new(backend: B) -> Self {
        Handler { backend, held: None }
    }

    /// Handle one request line, return one reply line (no trailing newline).
    pub fn handle_line(&mut self, line: &str) -> String {
        let req: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => return self.finish(None, Err(format!("bad json: {e}"))),
        };
        if !req.is_object() {
            return self.finish(None, Err("request must be a JSON object".into()));
        }
        let id = req.get("id").cloned();
        let r = self.dispatch(&req);
        self.finish(id, r)
    }

    fn finish(&self, id: Option<Value>, r: Result<Map<String, Value>, String>) -> String {
        let mut m = Map::new();
        match r {
            Ok(fields) => {
                m.insert("ok".into(), json!(true));
                for (k, v) in fields {
                    m.insert(k, v);
                }
            }
            Err(e) => {
                m.insert("ok".into(), json!(false));
                m.insert("error".into(), json!(e));
            }
        }
        m.insert("trusted".into(), json!(self.backend.trusted()));
        if let Some(id) = id {
            m.insert("id".into(), id);
        }
        Value::Object(m).to_string()
    }

    fn pos_fields(&self) -> Map<String, Value> {
        let (x, y) = self.backend.pos();
        let mut m = Map::new();
        m.insert("x".into(), json!(x));
        m.insert("y".into(), json!(y));
        m
    }

    fn dispatch(&mut self, req: &Value) -> Result<Map<String, Value>, String> {
        let op = req
            .get("op")
            .and_then(Value::as_str)
            .ok_or("missing op")?
            .to_string();
        match op.as_str() {
            "ping" => Ok(Map::new()),
            "trusted" => Ok(Map::new()), // "trusted" is added to every reply
            "pos" => Ok(self.pos_fields()),
            "move" => {
                let x = num(req, "x")?;
                let y = num(req, "y")?;
                self.backend.move_to(x, y, self.held)?;
                Ok(self.pos_fields())
            }
            "click" => {
                let b = parse_button(req)?;
                let double = req.get("double").and_then(Value::as_bool).unwrap_or(false);
                // "second":true = only the second pair (clickState 2): used after a click already went out.
                let second = req.get("second").and_then(Value::as_bool).unwrap_or(false);
                if second {
                    self.backend.button(b, true, 2)?;
                    self.backend.button(b, false, 2)?;
                    return Ok(Map::new());
                }
                self.backend.button(b, true, 1)?;
                self.backend.button(b, false, 1)?;
                if double {
                    self.backend.button(b, true, 2)?;
                    self.backend.button(b, false, 2)?;
                }
                Ok(Map::new())
            }
            "down" => {
                let b = parse_button(req)?;
                self.backend.button(b, true, 1)?;
                self.held = Some(b);
                Ok(Map::new())
            }
            "up" => {
                let b = parse_button(req)?;
                self.backend.button(b, false, 1)?;
                if self.held == Some(b) {
                    self.held = None;
                }
                Ok(Map::new())
            }
            "scroll" => {
                let dy = num(req, "dy")?;
                let dx = match req.get("dx") {
                    None | Some(Value::Null) => 0.0,
                    Some(_) => num(req, "dx")?,
                };
                self.backend.scroll(dy.round() as i32, dx.round() as i32)?;
                Ok(Map::new())
            }
            other => Err(format!("unknown op: {other}")),
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{Backend, Button};
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    type CGEventRef = *mut c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    #[link(name = "CoreFoundation", kind = "framework")]
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *mut c_void) -> CGEventRef;
        fn CGEventGetLocation(e: CGEventRef) -> CGPoint;
        fn CGEventCreateMouseEvent(
            source: *mut c_void,
            ty: u32,
            pos: CGPoint,
            button: u32,
        ) -> CGEventRef;
        fn CGEventCreateScrollWheelEvent2(
            source: *mut c_void,
            units: u32,
            wheel_count: u32,
            w1: i32,
            w2: i32,
            w3: i32,
        ) -> CGEventRef;
        fn CGEventSetIntegerValueField(e: CGEventRef, field: u32, v: i64);
        fn CGEventPost(tap: u32, e: CGEventRef);
        fn CGWarpMouseCursorPosition(p: CGPoint) -> i32;
        fn CFRelease(o: *const c_void);
        fn AXIsProcessTrusted() -> u8;
    }

    const K_HID_TAP: u32 = 0;
    const LEFT_DOWN: u32 = 1;
    const LEFT_UP: u32 = 2;
    const RIGHT_DOWN: u32 = 3;
    const RIGHT_UP: u32 = 4;
    const MOUSE_MOVED: u32 = 5;
    const LEFT_DRAGGED: u32 = 6;
    const RIGHT_DRAGGED: u32 = 7;
    const FIELD_CLICK_STATE: u32 = 1;
    const SCROLL_UNIT_PIXEL: u32 = 0;

    pub struct Mac;

    fn cg_button(b: Button) -> u32 {
        match b {
            Button::Left => 0,
            Button::Right => 1,
        }
    }

    impl Mac {
        fn post(&self, e: CGEventRef) -> Result<(), String> {
            if e.is_null() {
                return Err("failed to create CGEvent".into());
            }
            unsafe {
                CGEventPost(K_HID_TAP, e);
                CFRelease(e as *const c_void);
            }
            Ok(())
        }
    }

    impl Backend for Mac {
        fn move_to(&mut self, x: f64, y: f64, drag: Option<Button>) -> Result<(), String> {
            let p = CGPoint { x, y };
            unsafe {
                // Warp works without Accessibility and makes the position exact.
                CGWarpMouseCursorPosition(p);
            }
            let (ty, b) = match drag {
                Some(Button::Left) => (LEFT_DRAGGED, 0),
                Some(Button::Right) => (RIGHT_DRAGGED, 1),
                None => (MOUSE_MOVED, 0),
            };
            // Posted event lets apps see hover/drag (needs Accessibility trust).
            let e = unsafe { CGEventCreateMouseEvent(std::ptr::null_mut(), ty, p, b) };
            self.post(e)
        }

        fn button(&mut self, b: Button, down: bool, click_state: i64) -> Result<(), String> {
            let p = self.pos();
            let ty = match (b, down) {
                (Button::Left, true) => LEFT_DOWN,
                (Button::Left, false) => LEFT_UP,
                (Button::Right, true) => RIGHT_DOWN,
                (Button::Right, false) => RIGHT_UP,
            };
            let e = unsafe {
                CGEventCreateMouseEvent(
                    std::ptr::null_mut(),
                    ty,
                    CGPoint { x: p.0, y: p.1 },
                    cg_button(b),
                )
            };
            if e.is_null() {
                return Err("failed to create CGEvent".into());
            }
            unsafe { CGEventSetIntegerValueField(e, FIELD_CLICK_STATE, click_state) };
            self.post(e)
        }

        fn scroll(&mut self, dy: i32, dx: i32) -> Result<(), String> {
            let count = if dx != 0 { 2 } else { 1 };
            let e = unsafe {
                CGEventCreateScrollWheelEvent2(
                    std::ptr::null_mut(),
                    SCROLL_UNIT_PIXEL,
                    count,
                    dy,
                    dx,
                    0,
                )
            };
            self.post(e)
        }

        fn pos(&self) -> (f64, f64) {
            unsafe {
                let e = CGEventCreate(std::ptr::null_mut());
                if e.is_null() {
                    return (0.0, 0.0);
                }
                let p = CGEventGetLocation(e);
                CFRelease(e as *const c_void);
                (p.x, p.y)
            }
        }

        fn trusted(&self) -> bool {
            unsafe { AXIsProcessTrusted() != 0 }
        }
    }
}

#[cfg(target_os = "macos")]
fn main() {
    let mut h = Handler::new(mac::Mac);
    let stdin = io::stdin();
    let stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let reply = h.handle_line(&line);
        let mut out = stdout.lock();
        if writeln!(out, "{reply}").is_err() || out.flush().is_err() {
            break;
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("glance-input only supports macOS");
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Mock {
        log: Vec<String>,
        p: (f64, f64),
        trusted: bool,
    }

    impl Backend for Mock {
        fn move_to(&mut self, x: f64, y: f64, drag: Option<Button>) -> Result<(), String> {
            self.log.push(format!("move {x} {y} {drag:?}"));
            self.p = (x, y);
            Ok(())
        }
        fn button(&mut self, b: Button, down: bool, cs: i64) -> Result<(), String> {
            self.log.push(format!("btn {b:?} {down} {cs}"));
            Ok(())
        }
        fn scroll(&mut self, dy: i32, dx: i32) -> Result<(), String> {
            self.log.push(format!("scroll {dy} {dx}"));
            Ok(())
        }
        fn pos(&self) -> (f64, f64) {
            self.p
        }
        fn trusted(&self) -> bool {
            self.trusted
        }
    }

    fn h() -> Handler<Mock> {
        Handler::new(Mock::default())
    }

    fn reply(h: &mut Handler<Mock>, s: &str) -> Value {
        serde_json::from_str(&h.handle_line(s)).unwrap()
    }

    #[test]
    fn ping_and_id_echo() {
        let mut h = h();
        let r = reply(&mut h, r#"{"op":"ping","id":7}"#);
        assert_eq!(r["ok"], true);
        assert_eq!(r["id"], 7);
        assert_eq!(r["trusted"], false);
    }

    #[test]
    fn bad_json_does_not_panic() {
        let mut h = h();
        for s in ["", "{", "[1]", "null", r#"{"op":5}"#, r#"{"op":"nope"}"#, r#"{}"#] {
            let r = reply(&mut h, s);
            assert_eq!(r["ok"], false, "input {s}");
            assert!(r["error"].is_string());
        }
    }

    #[test]
    fn move_then_pos() {
        let mut h = h();
        let r = reply(&mut h, r#"{"op":"move","x":300,"y":400.5}"#);
        assert_eq!(r["ok"], true);
        assert_eq!(r["x"], 300.0);
        assert_eq!(r["y"], 400.5);
        let r = reply(&mut h, r#"{"op":"pos"}"#);
        assert_eq!((r["x"].as_f64(), r["y"].as_f64()), (Some(300.0), Some(400.5)));
    }

    #[test]
    fn move_validates() {
        let mut h = h();
        assert_eq!(reply(&mut h, r#"{"op":"move","x":1}"#)["ok"], false);
        assert_eq!(reply(&mut h, r#"{"op":"move","x":"a","y":2}"#)["ok"], false);
    }

    #[test]
    fn click_single_and_double() {
        let mut h = h();
        reply(&mut h, r#"{"op":"click","button":"left"}"#);
        assert_eq!(h.backend.log, ["btn Left true 1", "btn Left false 1"]);
        h.backend.log.clear();
        reply(&mut h, r#"{"op":"click","button":"right","double":true}"#);
        assert_eq!(
            h.backend.log,
            [
                "btn Right true 1",
                "btn Right false 1",
                "btn Right true 2",
                "btn Right false 2"
            ]
        );
        assert_eq!(reply(&mut h, r#"{"op":"click","button":"middle"}"#)["ok"], false);
    }

    #[test]
    fn drag_uses_held_button() {
        let mut h = h();
        reply(&mut h, r#"{"op":"down","button":"left"}"#);
        reply(&mut h, r#"{"op":"move","x":1,"y":2}"#);
        reply(&mut h, r#"{"op":"up","button":"left"}"#);
        reply(&mut h, r#"{"op":"move","x":3,"y":4}"#);
        assert_eq!(
            h.backend.log,
            [
                "btn Left true 1",
                "move 1 2 Some(Left)",
                "btn Left false 1",
                "move 3 4 None"
            ]
        );
    }

    #[test]
    fn scroll_rounds_and_defaults_dx() {
        let mut h = h();
        reply(&mut h, r#"{"op":"scroll","dy":-120.4}"#);
        reply(&mut h, r#"{"op":"scroll","dy":5,"dx":2}"#);
        assert_eq!(h.backend.log, ["scroll -120 0", "scroll 5 2"]);
        assert_eq!(reply(&mut h, r#"{"op":"scroll"}"#)["ok"], false);
    }

    #[test]
    fn trusted_reported() {
        let mut h = Handler::new(Mock { trusted: true, ..Default::default() });
        let r = reply(&mut h, r#"{"op":"trusted"}"#);
        assert_eq!(r["trusted"], true);
        assert_eq!(reply(&mut h, r#"{"op":"pos"}"#)["trusted"], true);
    }
}
