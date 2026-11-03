// Accessibility traversal: breadth-first over the focused window, bounded by node count, depth and wall-clock time.
import AppKit
import ApplicationServices

let attrNames: [String] = [
    "AXRole", "AXSubrole", "AXTitle", "AXDescription", "AXValue", "AXPlaceholderValue", "AXHelp",
    "AXPosition", "AXSize", "AXEnabled", "AXChildren", "AXVisibleChildren", "AXTitleUIElement",
]

func nowMs() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }

struct Fetched {
    var role = "", subrole: String?, title: String?, desc: String?, value: String?, placeholder: String?, help: String?
    var frame: Box?
    var enabled: Bool?
    var children: [AXUIElement] = []
    var visibleChildren: [AXUIElement] = []
    var titleEl: AXUIElement?
}

func stringOf(_ v: CFTypeRef?) -> String? {
    guard let v = v else { return nil }
    if CFGetTypeID(v) == CFStringGetTypeID() { return (v as! String) }
    if let a = v as? NSAttributedString { return a.string }
    return nil
}

func axErrorValue(_ v: CFTypeRef) -> Bool {
    CFGetTypeID(v) == AXValueGetTypeID() && AXValueGetType(v as! AXValue) == .axError
}

func fetch(_ el: AXUIElement) -> Fetched? {
    var out: CFArray?
    let err = AXUIElementCopyMultipleAttributeValues(el, attrNames as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &out)
    guard err == .success, let arr = out as? [AnyObject], arr.count == attrNames.count else { return nil }
    func v(_ i: Int) -> CFTypeRef? {
        let o = arr[i] as CFTypeRef
        return axErrorValue(o) ? nil : o
    }
    var f = Fetched()
    f.role = stringOf(v(0)) ?? ""
    f.subrole = stringOf(v(1))
    f.title = stringOf(v(2))
    f.desc = stringOf(v(3))
    f.value = stringOf(v(4))
    f.placeholder = stringOf(v(5))
    f.help = stringOf(v(6))
    var p = CGPoint.zero, s = CGSize.zero
    if let pv = v(7), CFGetTypeID(pv) == AXValueGetTypeID(), let sv = v(8), CFGetTypeID(sv) == AXValueGetTypeID(),
       AXValueGetValue(pv as! AXValue, .cgPoint, &p), AXValueGetValue(sv as! AXValue, .cgSize, &s) {
        f.frame = Box(x: Double(p.x), y: Double(p.y), w: Double(s.width), h: Double(s.height))
    }
    if let e = v(9), CFGetTypeID(e) == CFBooleanGetTypeID() { f.enabled = CFBooleanGetValue((e as! CFBoolean)) }
    if let c = v(10) as? [AXUIElement] { f.children = c }
    if let c = v(11) as? [AXUIElement] { f.visibleChildren = c }
    if let t = v(12), CFGetTypeID(t) == AXUIElementGetTypeID() { f.titleEl = (t as! AXUIElement) }
    return f
}

func hasPressAction(_ el: AXUIElement) -> Bool {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success, let a = names as? [String] else { return false }
    return a.contains("AXPress")
}

/// Visible screen area (union of displays) in top-left global points.
func screensBounds() -> Box {
    let screens = NSScreen.screens
    guard let primary = screens.first else { return Box(x: 0, y: 0, w: 1e6, h: 1e6) }
    let H = Double(primary.frame.height)
    var minX = Double.infinity, minY = Double.infinity, maxX = -Double.infinity, maxY = -Double.infinity
    for s in screens {
        let f = s.frame
        minX = min(minX, Double(f.minX)); maxX = max(maxX, Double(f.maxX))
        minY = min(minY, H - Double(f.maxY)); maxY = max(maxY, H - Double(f.minY))
    }
    return Box(x: minX, y: minY, w: maxX - minX, h: maxY - minY)
}

final class Walker {
    var budgetMs: Double
    var maxNodes = 2500
    var maxDepth = 28
    var maxCandidates = 450
    var maxChildren = 300
    let start = nowMs()
    var nodes = 0
    var truncated = false
    var cands: [Candidate] = []
    var refs: [AXUIElement] = []

    init(budgetMs: Double) { self.budgetMs = budgetMs }

    var expired: Bool { nowMs() - start > budgetMs }

    /// Text of a subtree (static text values / titles), used to name rows and unlabeled buttons.
    func textOf(_ el: AXUIElement, depth: Int = 3, budget: inout Int, into pieces: inout [String]) {
        if budget <= 0 || pieces.count >= 4 { return }
        budget -= 1
        guard let f = fetch(el) else { return }
        if f.role == "AXStaticText" {
            let t = cleanName(f.value ?? f.title ?? f.desc ?? "")
            if !t.isEmpty && pieces.last != t { pieces.append(t) }
            return
        }
        if f.role == "AXTextField" {   // list rows (Finder names) hold their text in a cell text field
            let t = cleanName(f.value ?? f.title ?? "")
            if !t.isEmpty && pieces.last != t { pieces.append(t) }
            return
        }
        if f.role == "AXTextArea" || f.role == "AXImage" { return }
        if depth <= 0 { return }
        for c in f.children.prefix(12) { textOf(c, depth: depth - 1, budget: &budget, into: &pieces) }
    }

    func childText(_ el: AXUIElement, children: [AXUIElement], depth: Int) -> String? {
        var pieces: [String] = []
        var budget = 14
        for c in children.prefix(12) { textOf(c, depth: depth, budget: &budget, into: &pieces) }
        return pieces.isEmpty ? nil : pieces.joined(separator: ", ")
    }

    func walk(window: AXUIElement, clip: Box) {
        var queue: [(AXUIElement, Int, Box)] = [(window, 0, clip)]
        var head = 0
        while head < queue.count {
            if expired || nodes >= maxNodes || cands.count >= maxCandidates { truncated = true; break }
            let (el, depth, clip) = queue[head]; head += 1
            guard let f = fetch(el) else { continue }
            nodes += 1
            if let fr = f.frame, fr.w > 0, fr.h > 0, depth > 0, fr.intersection(clip) == nil { continue }

            let mapped = mapRole(f.role, subrole: f.subrole)
            var raw = RawNode(role: f.role, subrole: f.subrole, title: f.title, description: f.desc, value: f.value,
                              placeholder: f.placeholder, help: f.help, titleText: nil, childText: nil,
                              x: f.frame?.x ?? 0, y: f.frame?.y ?? 0, w: f.frame?.w ?? 0, h: f.frame?.h ?? 0,
                              enabled: f.enabled, hasPress: nil)
            var consider = false
            if let m = mapped {
                consider = true
                if let te = f.titleEl, pickName(raw, mapped: m).isEmpty, let tf = fetch(te) { raw.titleText = tf.value ?? tf.title }
                if nameFromChildren.contains(m), pickName(raw, mapped: m).isEmpty || m == "row" {
                    raw.childText = childText(el, children: f.children, depth: m == "row" ? 4 : 2)
                }
            } else if pressOnly.contains(f.role), f.frame != nil {
                raw.hasPress = true
                if evaluate(raw, clip: clip, idx: -1) != nil, hasPressAction(el) { consider = true }
            }
            if consider, let c = evaluate(raw, clip: clip, idx: refs.count) {
                cands.append(c)
                refs.append(el)
            }
            if mapped == "row" { continue }                     // do not descend into list rows: their text already names them
            if depth >= maxDepth { continue }
            var next = f.children
            if ["AXTable", "AXOutline", "AXList", "AXBrowser"].contains(f.role), !f.visibleChildren.isEmpty { next = f.visibleChildren }
            var childClip = clip
            if f.role == "AXScrollArea", let fr = f.frame, let i = fr.intersection(clip) { childClip = i }
            for c in next.prefix(maxChildren) { queue.append((c, depth + 1, childClip)) }
        }
    }
}

struct WalkResult {
    var elements: [OutElement]
    var source: [Candidate]
    var refs: [AXUIElement]
    var nodes: Int
    var truncated: Bool
    var windowBox: Box?
    var windowTitle: String?
    var note: String?
}

func focusedWindow(_ app: AXUIElement) -> AXUIElement? {
    for attr in ["AXFocusedWindow", "AXMainWindow"] {
        var v: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, attr as CFString, &v) == .success, let w = v, CFGetTypeID(w) == AXUIElementGetTypeID() { return (w as! AXUIElement) }
    }
    var v: CFTypeRef?
    if AXUIElementCopyAttributeValue(app, "AXWindows" as CFString, &v) == .success, let ws = v as? [AXUIElement], let w = ws.first { return w }
    return nil
}

func collectElements(pid: pid_t, budgetMs: Double, cap: Int) -> WalkResult {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.25)
    var result = WalkResult(elements: [], source: [], refs: [], nodes: 0, truncated: false, windowBox: nil, windowTitle: nil, note: nil)
    for attempt in 0..<2 {
        guard let win = focusedWindow(app), let wf = fetch(win), let wb = wf.frame else {
            result.note = "no focused window"
            return result
        }
        result.windowBox = wb
        result.windowTitle = cleanName(wf.title ?? "")
        let clip = wb.intersection(screensBounds()) ?? wb
        let w = Walker(budgetMs: budgetMs)
        w.walk(window: win, clip: clip)
        let fin = finalize(w.cands, cap: cap)
        result.elements = fin.elements
        result.source = fin.source
        result.refs = fin.source.map { w.refs[$0.idx] }
        result.nodes = w.nodes
        result.truncated = w.truncated
        // Chromium / Electron apps expose no tree until asked
        if fin.elements.count >= 3 || attempt == 1 { break }
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        Thread.sleep(forTimeInterval: 0.2)
    }
    return result
}
