// Pure logic (no Accessibility calls): role mapping, name choice, filtering, ordering. Unit-testable through `glance-ax normalize`.
import Foundation

struct Box: Codable, Equatable {
    var x: Double, y: Double, w: Double, h: Double
    var maxX: Double { x + w }
    var maxY: Double { y + h }
    func intersection(_ o: Box) -> Box? {
        let nx = max(x, o.x), ny = max(y, o.y)
        let mx = min(maxX, o.maxX), my = min(maxY, o.maxY)
        if mx <= nx || my <= ny { return nil }
        return Box(x: nx, y: ny, w: mx - nx, h: my - ny)
    }
    func contains(_ o: Box, slack: Double = 1) -> Bool {
        o.x >= x - slack && o.y >= y - slack && o.maxX <= maxX + slack && o.maxY <= maxY + slack
    }
}

/// What the walker reads from one accessibility node.
struct RawNode: Codable {
    var role: String
    var subrole: String?
    var title: String?
    var description: String?
    var value: String?
    var placeholder: String?
    var help: String?
    var titleText: String?       // text of AXTitleUIElement
    var childText: String?       // text gathered from descendants (rows, unnamed buttons)
    var x: Double, y: Double, w: Double, h: Double
    var enabled: Bool?
    var hasPress: Bool?          // supports AXPress (for generic AXGroup / AXImage / AXStaticText)
}

struct Candidate {
    var role: String
    var name: String
    var box: Box
    var idx: Int                 // index into the walker's node/ref arrays (-1 in tests)
}

struct OutElement: Codable {
    var id: Int
    var role: String
    var name: String
    var box: Box
}

let maxElements = 80
let minSide: Double = 8

/// Collapse whitespace, replace double quotes, trim, cap at 80 chars (same rules as packages/elements/extract.js `clean`).
func cleanName(_ s: String) -> String {
    let collapsed = s.replacingOccurrences(of: "\"", with: "'")
        .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    // U+FFFC (attachment), zero-width and bidi marks add noise
    let noise = CharacterSet(charactersIn: "\u{FFFC}\u{200B}\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{2066}\u{2067}\u{2068}\u{2069}")
    let t = String(String.UnicodeScalarView(collapsed.unicodeScalars.filter { !noise.contains($0) }))
        .trimmingCharacters(in: .whitespaces)
    return String(t.prefix(80)).trimmingCharacters(in: .whitespaces)
}

/// Role as the extractor names it, or nil when the AX role is not clickable by itself.
func mapRole(_ role: String, subrole: String?) -> String? {
    switch role {
    case "AXButton", "AXMenuButton", "AXDisclosureTriangle": return "button"
    case "AXPopUpButton", "AXComboBox": return "combobox"
    case "AXLink": return "link"
    case "AXMenuItem", "AXMenuBarItem": return "menuitem"
    case "AXTextField":
        return subrole == "AXSearchField" ? "searchbox" : "textbox"
    case "AXSearchField": return "searchbox"
    case "AXTextArea": return "textbox"
    case "AXCheckBox":
        return (subrole == "AXSwitch" || subrole == "AXToggle") ? "switch" : "checkbox"
    case "AXRadioButton":
        return subrole == "AXTabButton" ? "tab" : "radio"
    case "AXTab": return "tab"
    case "AXSlider": return "slider"
    case "AXRow", "AXOutlineRow": return "row"
    default: return nil
    }
}

/// Roles where a missing own name may be filled from descendant text.
let nameFromChildren: Set<String> = ["button", "link", "menuitem", "tab", "radio", "checkbox", "switch", "row"]
/// Generic roles that only count when they support AXPress.
let pressOnly: Set<String> = ["AXGroup", "AXImage", "AXStaticText", "AXCell", "AXUnknown"]

func firstNonEmpty(_ xs: [String?]) -> String {
    for x in xs { if let x = x { let c = cleanName(x); if !c.isEmpty { return c } } }
    return ""
}

/// Best human name for a node: title, description, label element, placeholder, help; static text uses its value; rows use their text.
func pickName(_ n: RawNode, mapped: String) -> String {
    if mapped == "row" { return firstNonEmpty([n.childText, n.title, n.description, n.titleText]) }
    var order: [String?] = [n.title, n.description, n.titleText, n.placeholder]
    // window controls carry no title; Finder's zoom button only has a long action blurb as description
    switch n.subrole {
    case "AXCloseButton": return "close window"
    case "AXMinimizeButton": return "minimize window"
    case "AXZoomButton": return "zoom window"
    case "AXFullScreenButton": return "full screen"
    default: break
    }
    if n.role == "AXStaticText" || mapped == "link" || mapped == "tab" || mapped == "menuitem" { order.append(n.value) }
    order.append(n.childText)
    order.append(n.help)
    return firstNonEmpty(order)
}

/// Raw node -> candidate, or nil when it is not a visible, named, actionable element inside `clip`.
func evaluate(_ n: RawNode, clip: Box?, idx: Int) -> Candidate? {
    if n.enabled == false { return nil }
    var role = mapRole(n.role, subrole: n.subrole)
    if role == nil {
        guard pressOnly.contains(n.role), n.hasPress == true else { return nil }
        role = "button"
    }
    var box = Box(x: n.x, y: n.y, w: n.w, h: n.h)
    if box.w < minSide || box.h < minSide { return nil }
    if let c = clip {
        guard let i = box.intersection(c), i.w >= minSide, i.h >= minSide else { return nil }
        box = i
    }
    let name = pickName(n, mapped: role!)
    if name.isEmpty { return nil }
    return Candidate(role: role!, name: name, box: box, idx: idx)
}

func round1(_ v: Double) -> Double { (v * 10).rounded() / 10 }

/// Drop wrapper duplicates, sort in reading order (|dy| > 12 -> by y, else by x), cap, assign ids 0..n-1.
/// Returns the output elements and, for each, the candidate it came from.
func finalize(_ cands: [Candidate], cap: Int = maxElements) -> (elements: [OutElement], source: [Candidate]) {
    var kept: [Candidate] = []
    for (i, a) in cands.enumerated() {
        // drop a larger element when a smaller one with the same name sits fully inside it
        let wrapper = cands.enumerated().contains { (j, b) in
            i != j && a.name == b.name && a.box.contains(b.box) && (b.box.w < a.box.w || b.box.h < a.box.h)
        }
        if wrapper { continue }
        // exact duplicate (same role, name, box): keep the first
        let dup = kept.contains { $0.name == a.name && $0.role == a.role && abs($0.box.x - a.box.x) < 2 && abs($0.box.y - a.box.y) < 2 && abs($0.box.w - a.box.w) < 2 && abs($0.box.h - a.box.h) < 2 }
        if dup { continue }
        kept.append(a)
    }
    // Reading order: rows are bands of 12 pt anchored at the band's first element (total order, unlike a pairwise |dy| test).
    let byY = kept.enumerated().sorted { ($0.element.box.y, $0.offset) < ($1.element.box.y, $1.offset) }.map { $0.element }
    var sorted: [Candidate] = []
    var band: [Candidate] = []
    var bandY = -Double.infinity
    func flush() { sorted.append(contentsOf: band.sorted { $0.box.x < $1.box.x }); band = [] }
    for c in byY {
        if c.box.y - bandY > 12 { flush(); bandY = c.box.y }
        band.append(c)
    }
    flush()
    let top = Array(sorted.prefix(cap))
    let out = top.enumerated().map { (i, c) in
        OutElement(id: i, role: c.role, name: c.name, box: Box(x: round1(c.box.x), y: round1(c.box.y), w: round1(c.box.w), h: round1(c.box.h)))
    }
    return (out, top)
}
