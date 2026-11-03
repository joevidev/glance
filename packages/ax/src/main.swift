// glance-ax: Accessibility view of the frontmost macOS app, in the Glance element schema.
//   glance-ax trusted
//   glance-ax frontmost
//   glance-ax elements [--pid N] [--budget MS] [--max N] [--bare]
//   glance-ax press <id|x,y> [--pid N]
//   glance-ax normalize            (stdin: {"clip":{x,y,w,h}?,"nodes":[RawNode]}; no GUI needed, used by the tests)
import AppKit
import ApplicationServices

setvbuf(stdout, nil, _IOFBF, 1 << 16)

let enc: JSONEncoder = {
    let e = JSONEncoder()
    e.outputFormatting = [.withoutEscapingSlashes]
    return e
}()

func emit<T: Encodable>(_ v: T) {
    if let d = try? enc.encode(v), let s = String(data: d, encoding: .utf8) { print(s) }
    fflush(stdout)
}

struct Failure: Encodable { var ok = false; var trusted: Bool; var error: String }
struct TrustedOut: Encodable { var ok = true; var trusted: Bool }
struct FrontOut: Encodable { var ok = true; var trusted: Bool; var app: String; var bundleId: String?; var pid: Int32; var window: Box?; var windowTitle: String? }
struct ElementsOut: Encodable {
    var ok = true, trusted = true
    var app: String, bundleId: String?, pid: Int32
    var window: Box?, windowTitle: String?
    var count: Int, nodes: Int, ms: Int, truncated: Bool
    var note: String?
    var elements: [OutElement]
}
struct PressOut: Encodable { var ok: Bool; var role: String?; var name: String?; var error: String? }

let args = Array(CommandLine.arguments.dropFirst())
let cmd = args.first ?? "elements"

func opt(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let missingMsg = "Accessibility permission is missing for the process that launched glance-ax. Allow it in System Settings > Privacy & Security > Accessibility (Electron, or your terminal app), then restart."

func trusted(prompt: Bool = false) -> Bool {
    if prompt { return AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary) }
    return AXIsProcessTrusted()
}

func target() -> NSRunningApplication? {
    if let p = opt("--pid"), let n = Int32(p) { return NSRunningApplication(processIdentifier: n) }
    return NSWorkspace.shared.frontmostApplication
}

func requireTrust() {
    if !trusted() {
        emit(Failure(trusted: false, error: missingMsg))
        exit(2)
    }
}

switch cmd {
case "trusted":
    let t = trusted(prompt: args.contains("--prompt"))
    emit(TrustedOut(trusted: t))
    exit(t ? 0 : 2)

case "frontmost":
    requireTrust()
    guard let app = target() else { emit(Failure(trusted: true, error: "no frontmost application")); exit(1) }
    let a = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(a, 0.25)
    var wb: Box?, wt: String?
    if let w = focusedWindow(a), let f = fetch(w) { wb = f.frame; wt = cleanName(f.title ?? "") }
    emit(FrontOut(trusted: true, app: app.localizedName ?? "", bundleId: app.bundleIdentifier, pid: app.processIdentifier, window: wb, windowTitle: wt))

case "elements":
    requireTrust()
    guard let app = target() else { emit(Failure(trusted: true, error: "no frontmost application")); exit(1) }
    let t0 = nowMs()
    let r = collectElements(pid: app.processIdentifier, budgetMs: Double(opt("--budget") ?? "") ?? 450, cap: min(Int(opt("--max") ?? "") ?? maxElements, maxElements))
    if args.contains("--bare") {
        emit(r.elements)
    } else {
        emit(ElementsOut(app: app.localizedName ?? "", bundleId: app.bundleIdentifier, pid: app.processIdentifier, window: r.windowBox,
                         windowTitle: r.windowTitle, count: r.elements.count, nodes: r.nodes, ms: Int(nowMs() - t0), truncated: r.truncated,
                         note: r.note, elements: r.elements))
    }

case "press":
    requireTrust()
    guard args.count >= 2 else { emit(PressOut(ok: false, role: nil, name: nil, error: "usage: press <id|x,y>")); exit(1) }
    let spec = args[1]
    if spec.contains(",") {
        let p = spec.split(separator: ",").compactMap { Double($0) }
        guard p.count == 2 else { emit(PressOut(ok: false, role: nil, name: nil, error: "bad x,y")); exit(1) }
        var hit: AXUIElement?
        let err = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(p[0]), Float(p[1]), &hit)
        guard err == .success, let el = hit else { emit(PressOut(ok: false, role: nil, name: nil, error: "no element at point")); exit(1) }
        let f = fetch(el)
        let ok = AXUIElementPerformAction(el, "AXPress" as CFString) == .success
        emit(PressOut(ok: ok, role: f?.role, name: cleanName(f?.title ?? f?.desc ?? ""), error: ok ? nil : "AXPress failed"))
    } else {
        guard let id = Int(spec), let app = target() else { emit(PressOut(ok: false, role: nil, name: nil, error: "bad id")); exit(1) }
        let r = collectElements(pid: app.processIdentifier, budgetMs: 450, cap: maxElements)
        guard id >= 0, id < r.elements.count else { emit(PressOut(ok: false, role: nil, name: nil, error: "id out of range (\(r.elements.count) elements)")); exit(1) }
        let ok = AXUIElementPerformAction(r.refs[id], "AXPress" as CFString) == .success
        emit(PressOut(ok: ok, role: r.elements[id].role, name: r.elements[id].name, error: ok ? nil : "AXPress failed"))
    }

case "verify":
    // Geometry check without screen recording: hit-test the centre of every element and see whether the element under that point is it (or inside it).
    requireTrust()
    guard let app = target() else { emit(Failure(trusted: true, error: "no frontmost application")); exit(1) }
    let r = collectElements(pid: app.processIdentifier, budgetMs: 450, cap: maxElements)
    struct Row: Encodable { var id: Int; var name: String; var ok: Bool; var hitRole: String?; var hitName: String? }
    struct VerifyOut: Encodable { var ok = true; var app: String; var count: Int; var hits: Int; var rows: [Row] }
    var rows: [Row] = []
    for (i, e) in r.elements.enumerated() {
        var hit: AXUIElement?
        let cx = Float(e.box.x + e.box.w / 2), cy = Float(e.box.y + e.box.h / 2)
        var ok = false
        var hr: String?, hn: String?
        if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), cx, cy, &hit) == .success, var cur = hit {
            if let f = fetch(cur) { hr = f.role; hn = cleanName(f.title ?? f.desc ?? f.value ?? "") }
            for _ in 0..<10 {
                if CFEqual(cur, r.refs[i]) { ok = true; break }
                var p: CFTypeRef?
                guard AXUIElementCopyAttributeValue(cur, "AXParent" as CFString, &p) == .success, let pp = p, CFGetTypeID(pp) == AXUIElementGetTypeID() else { break }
                cur = pp as! AXUIElement
            }
        }
        rows.append(Row(id: i, name: e.name, ok: ok, hitRole: hr, hitName: hn))
    }
    emit(VerifyOut(app: app.localizedName ?? "", count: rows.count, hits: rows.filter { $0.ok }.count, rows: rows))

case "normalize":
    struct In: Decodable { var clip: Box?; var nodes: [RawNode] }
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let inp = try? JSONDecoder().decode(In.self, from: data) else { emit(Failure(trusted: true, error: "bad input")); exit(1) }
    let cands = inp.nodes.enumerated().compactMap { evaluate($0.element, clip: inp.clip, idx: $0.offset) }
    emit(finalize(cands).elements)

default:
    FileHandle.standardError.write(Data("usage: glance-ax trusted|frontmost|elements|press|normalize\n".utf8))
    exit(64)
}
