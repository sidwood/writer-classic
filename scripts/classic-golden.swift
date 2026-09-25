// Light-mode golden for the editor layout, run by scripts/classic-golden.sh.
//
//   swift scripts/classic-golden.swift classic <dir> <fixture.md>
//     Captures the installed iA Writer Classic window showing <fixture.md> to
//     <dir>/golden-classic.png and writes <dir>/golden-classic.json. Exits 2 and
//     records the denial when macOS refuses screen capture.
//   swift scripts/classic-golden.swift measure <dir>
//     Measures both images and writes <dir>/golden-result.json. Exits 0 when the
//     text inset, top padding, line pitch and cap height agree, 1 when they differ,
//     and 2 when the Classic capture is missing. Only near-grey ink counts, so the
//     accent-coloured caret and Vim cursor block are ignored.
//   swift scripts/classic-golden.swift selfcheck <dir>
//     Checks the comparator against a simulated same-origin Classic capture.
import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

let args = CommandLine.arguments
let dir = URL(fileURLWithPath: args.count > 2 ? args[2] : ".")

func write(_ object: Any, _ name: String) {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
  try! data.write(to: dir.appendingPathComponent(name))
}

func classicWindows() -> [[String: Any]] {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
  return list.filter {
    ($0[kCGWindowOwnerName as String] as? String) == "iA Writer Classic"
      && ($0[kCGWindowLayer as String] as? Int) == 0
  }
}

func bounds(_ window: [String: Any]) -> CGRect {
  CGRect(dictionaryRepresentation: window[kCGWindowBounds as String] as! CFDictionary)!
}

/// Captures one window through ScreenCaptureKit. Returns the error text when macOS refuses.
func capture(_ id: CGWindowID) async -> Result<CGImage, Error> {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let window = content.windows.first(where: { $0.windowID == id }) else {
      return .failure(NSError(domain: "classic-golden", code: 1, userInfo: [NSLocalizedDescriptionKey: "window \(id) is not shareable"]))
    }
    let configuration = SCStreamConfiguration()
    let scale = NSScreen.main?.backingScaleFactor ?? 2
    configuration.width = Int(window.frame.width * scale)
    configuration.height = Int(window.frame.height * scale)
    configuration.showsCursor = false
    let filter = SCContentFilter(desktopIndependentWindow: window)
    return .success(try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration))
  } catch {
    return .failure(error)
  }
}

func titlebarHeight() -> CGFloat {
  let frame = NSWindow.frameRect(forContentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: [.titled])
  return frame.height - 100
}

func captureClassic() async -> Int32 {
  let fixture = URL(fileURLWithPath: args[3])
  let before = classicWindows()
  var report: [String: Any] = [
    "screenCaptureAccess": CGPreflightScreenCaptureAccess(),
    "classicWindowsBefore": before.map { NSStringFromRect(bounds($0)) },
  ]
  // Attempt the capture on a Classic window that is already open, so a denial is
  // recorded before any document is opened in the user's running Classic.
  if let first = before.first, case .failure(let error) = await capture(first[kCGWindowNumber as String] as! CGWindowID) {
    report["denied"] = "ScreenCaptureKit refused Classic window \(first[kCGWindowNumber as String]!): \(error.localizedDescription)"
    write(report, "golden-classic.json")
    return 2
  }
  if before.isEmpty && !CGPreflightScreenCaptureAccess() {
    report["denied"] = "Screen Recording is not granted and no Classic window is open"
    write(report, "golden-classic.json")
    return 2
  }
  let known = Set(before.map { $0[kCGWindowNumber as String] as! CGWindowID })
  let open = Process()
  open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  open.arguments = ["-a", "/Applications/iA Writer Classic.app", fixture.path]
  try! open.run()
  open.waitUntilExit()
  var window: [String: Any]?
  for _ in 0..<40 {
    try? await Task.sleep(nanoseconds: 250_000_000)
    window = classicWindows().first { !known.contains($0[kCGWindowNumber as String] as! CGWindowID) }
    if window != nil { break }
  }
  guard let window else {
    report["error"] = "Classic did not open a window for \(fixture.path)"
    write(report, "golden-classic.json")
    return 2
  }
  try? await Task.sleep(nanoseconds: 1_500_000_000)
  let id = window[kCGWindowNumber as String] as! CGWindowID
  let captured = await capture(id)
  guard case .success(let image) = captured else {
    if case .failure(let error) = captured { report["denied"] = "ScreenCaptureKit refused Classic window \(id): \(error.localizedDescription)" }
    write(report, "golden-classic.json")
    return 2
  }
  let rep = NSBitmapImageRep(cgImage: image)
  try! rep.representation(using: .png, properties: [:])!.write(to: dir.appendingPathComponent("golden-classic.png"))
  let frame = bounds(window)
  report["windowWidth"] = frame.width
  report["windowHeight"] = frame.height
  // Classic is a standard NSDocument titled window. Its title bar height is the
  // system height for that style; the capture's top edge is the frame's top edge.
  report["titlebarHeight"] = titlebarHeight()
  report["imageOriginBelowFrame"] = 0
  report["backingScale"] = CGFloat(image.width) / frame.width
  write(report, "golden-classic.json")
  return 0
}

struct Metrics {
  var left: Double, top: Double, pitch: Double, capHeight: Double, lines: Int, firstInk: Double
  var json: [String: Any] {
    ["left": left, "top": top, "pitch": pitch, "capHeight": capHeight, "lines": lines, "firstInk": firstInk]
  }
}

/// Ink metrics in points, measured from the top-left of the text area, which is
/// the bottom edge of the title bar. `skipTop` is how many points of the image
/// lie above that edge.
func measure(_ url: URL, scale: Double, skipTop: Double) -> Metrics? {
  guard let rep = NSBitmapImageRep(data: (try? Data(contentsOf: url)) ?? Data()) else { return nil }
  let width = rep.pixelsWide, height = rep.pixelsHigh
  let first = Int((skipTop * scale).rounded())
  var rows = [Bool](repeating: false, count: height)
  var columns = [[Int]](repeating: [], count: height)
  for y in first..<height {
    for x in 0..<width {
      // Transparent pixels are the window's rounded corners, not ink.
      guard let color = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), color.alphaComponent > 0.5 else { continue }
      let r = color.redComponent, g = color.greenComponent, b = color.blueComponent
      let luminance = 0.299 * r + 0.587 * g + 0.114 * b
      if luminance < 0.55 && max(r, g, b) - min(r, g, b) < 0.12 {
        rows[y] = true
        columns[y].append(x)
      }
    }
  }
  var bands: [(Int, Int)] = []
  var start: Int?
  for y in first..<height {
    if rows[y], start == nil { start = y }
    if !rows[y], let s = start { bands.append((s, y)); start = nil }
  }
  // Line one can carry the caret; measure from lines two to four.
  guard bands.count >= 4 else { return nil }
  let text = Array(bands[1...3])
  let pitch = Double(text[1].0 - text[0].0) / scale
  let left = text.flatMap { band in (band.0..<band.1).flatMap { columns[$0] } }.min() ?? 0
  return Metrics(
    left: Double(left) / scale,
    top: Double(text[0].0 - first) / scale - pitch,
    pitch: pitch,
    capHeight: Double(text[0].1 - text[0].0) / scale,
    lines: bands.count,
    firstInk: Double(bands[0].0 - first) / scale)
}

func number(_ object: Any?) -> Double { (object as? NSNumber)?.doubleValue ?? 0 }

/// Near-grey ink pixels inside the title-bar band, between the traffic lights and
/// the centred title. Editor text drawn under the title bar lands here.
func titleBandInk(_ url: URL, scale: Double, bar: Double) -> Int {
  guard let rep = NSBitmapImageRep(data: (try? Data(contentsOf: url)) ?? Data()) else { return -1 }
  let rows = min(rep.pixelsHigh, Int((bar * scale).rounded()))
  let from = Int((80 * scale).rounded())
  let to = rep.pixelsWide / 2 - Int((60 * scale).rounded())
  var count = 0
  for y in 0..<rows {
    for x in from..<max(from, to) {
      guard let color = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), color.alphaComponent > 0.5 else { continue }
      let r = color.redComponent, g = color.greenComponent, b = color.blueComponent
      if 0.299 * r + 0.587 * g + 0.114 * b < 0.55 && max(r, g, b) - min(r, g, b) < 0.12 { count += 1 }
    }
  }
  return count
}

func compare() -> Int32 {
  let clone = (try? JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("native-selftest.json")))) as? [String: Any]
  let cloneGolden = clone?["golden"] as? [String: Any] ?? [:]
  let classic = (try? JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("golden-classic.json")))) as? [String: Any] ?? [:]
  var result: [String: Any] = ["clonePage": cloneGolden["page"] ?? NSNull()]
  func fail(_ key: String, _ message: String) -> Int32 {
    result[key] = message
    result["compared"] = false
    result["passed"] = false
    write(result, "golden-result.json")
    print(message)
    return 1
  }
  // Both images are captures of the whole window from the frame's top edge, and
  // both are measured from one origin: the bottom edge of the title bar.
  guard cloneGolden["imageOriginBelowFrame"] != nil, cloneGolden["titlebarHeight"] != nil else {
    return fail("clone", "the clone capture does not record its title bar or framing")
  }
  let cloneTitlebar = number(cloneGolden["titlebarHeight"])
  let cloneSkip = cloneTitlebar - number(cloneGolden["imageOriginBelowFrame"])
  let classicSkip = number(classic["titlebarHeight"]) - number(classic["imageOriginBelowFrame"])
  result["origin"] = [
    "definition": "bottom edge of the title bar",
    "cloneTitlebar": cloneTitlebar,
    "cloneSkipTop": cloneSkip,
    "classicTitlebar": classic["titlebarHeight"] ?? NSNull(),
    "classicSkipTop": classic["titlebarHeight"] == nil ? NSNull() : classicSkip,
  ] as [String: Any]
  if classic["titlebarHeight"] != nil, abs(cloneTitlebar - number(classic["titlebarHeight"])) > 0.5 {
    result["originMismatch"] = "clone and Classic title bars differ in height"
  }
  let scale = number(cloneGolden["backingScale"])
  let cloneURL = dir.appendingPathComponent("golden-clone.png")
  // Editor text may not sit under the title bar.
  let band = titleBandInk(cloneURL, scale: scale, bar: cloneTitlebar)
  result["cloneTitleBandInk"] = band
  if band != 0 {
    return fail("cloneTitleBand", band < 0 ? "no clone capture" : "text ink inside the title-bar band (\(band) pixels)")
  }
  let cloneMetrics = measure(cloneURL, scale: scale, skipTop: cloneSkip)
  result["clone"] = cloneMetrics?.json ?? "no clone capture or fewer than four text lines"
  guard let cloneMetrics else { write(result, "golden-result.json"); return 1 }
  // The page's first line box, moved from page coordinates to the title bar's
  // bottom edge. The first ink must fall inside it, and the line box must start
  // Classic's inset, floor(lineHeight) − 1, below the title bar.
  let page = cloneGolden["page"] as? [String: Any] ?? [:]
  let lineTop = number(page["textTop"]) + number(cloneGolden["pageOriginBelowFrame"]) - cloneTitlebar
  let lineHeight = Double((page["lineHeight"] as? String)?.replacingOccurrences(of: "px", with: "") ?? "") ?? 0
  result["cloneLineTopBelowTitlebar"] = lineTop
  if lineTop < floor(lineHeight) - 1 - 0.5 {
    return fail("cloneTopPadding", "top padding \(lineTop) below the title bar is less than Classic's \(floor(lineHeight) - 1)")
  }
  if !(cloneMetrics.firstInk >= lineTop && cloneMetrics.firstInk <= lineTop + lineHeight) {
    return fail("cloneOrigin", "first ink \(cloneMetrics.firstInk) is outside the first line box \(lineTop)–\(lineTop + lineHeight)")
  }
  result["cloneOrigin"] = "first ink \(cloneMetrics.firstInk) lies in the first line box \(lineTop)–\(lineTop + lineHeight)"
  guard FileManager.default.fileExists(atPath: dir.appendingPathComponent("golden-classic.png").path),
    let classicMetrics = measure(dir.appendingPathComponent("golden-classic.png"), scale: number(classic["backingScale"]), skipTop: classicSkip)
  else {
    result["classic"] = classic["denied"] ?? classic["error"] ?? "no Classic capture"
    result["passed"] = false
    result["compared"] = false
    write(result, "golden-result.json")
    print("Classic was not captured, so nothing was compared: \(result["classic"]!)")
    return 2
  }
  result["classic"] = classicMetrics.json
  let failures = [
    result["originMismatch"] as? String,
    abs(cloneMetrics.left - classicMetrics.left) > 2 ? "text inset from the window side differs" : nil,
    abs(cloneMetrics.top - classicMetrics.top) > 2 ? "top padding differs" : nil,
    abs(cloneMetrics.pitch - classicMetrics.pitch) > 0.75 ? "line pitch (type size) differs" : nil,
    abs(cloneMetrics.capHeight / classicMetrics.capHeight - 1) > 0.12 ? "cap height (type size) differs" : nil,
  ].compactMap { $0 }
  result["failures"] = failures
  result["compared"] = true
  result["passed"] = failures.isEmpty
  write(result, "golden-result.json")
  print(failures.isEmpty ? "Light-mode layout matches Classic" : failures.joined(separator: "\n"))
  return failures.isEmpty ? 0 : 1
}

/// The clone window capture with everything below the title bar moved `shift`
/// points down (positive) or up (negative). Moving it up puts text under the bar.
func shifted(_ image: CGImage, scale: Double, bar: Double, shift: Double) -> CGImage {
  let width = image.width, height = image.height
  let barPixels = Int((bar * scale).rounded())
  let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  // Paper under the title bar, sampled from the capture's own page.
  let paper = NSBitmapImageRep(cgImage: image).colorAt(x: width / 2, y: barPixels + 4)?.cgColor ?? CGColor(gray: 0.941, alpha: 1)
  context.setFillColor(paper)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height - barPixels))
  let content = image.cropping(to: CGRect(x: 0, y: barPixels, width: width, height: height - barPixels))!
  let top = barPixels + Int((shift * scale).rounded())
  context.draw(content, in: CGRect(x: 0, y: height - top - content.height, width: width, height: content.height))
  return context.makeImage()!
}

/// Checks the comparator before its verdict counts, with the clone's own window
/// capture as a simulated Classic capture:
/// - the same image has to pass;
/// - its text moved 6pt down has to fail on top padding;
/// - a clone whose text is moved up under the title bar has to fail on the
///   title-bar band.
/// Exits 0 only when all three happen.
func selfcheck() -> Int32 {
  let clone = (try? JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("native-selftest.json")))) as? [String: Any]
  let golden = clone?["golden"] as? [String: Any] ?? [:]
  guard let source = NSBitmapImageRep(data: (try? Data(contentsOf: dir.appendingPathComponent("golden-clone.png"))) ?? Data()),
    let image = source.cgImage
  else {
    print("selfcheck needs golden-clone.png and native-selftest.json in \(dir.path)")
    return 2
  }
  let scale = number(golden["backingScale"])
  let bar = number(golden["titlebarHeight"])
  var outcomes: [String: Any] = [:]
  var ok = true
  let cases: [(String, Double, Bool, Int32, String?)] = [
    ("same image", 0, false, 0, nil),
    ("Classic text 6pt lower", 6, false, 1, "top padding differs"),
    ("clone text under the title bar", -40, true, 1, "cloneTitleBand"),
  ]
  for (name, shift, moveClone, expected, reason) in cases {
    let work = FileManager.default.temporaryDirectory.appendingPathComponent("classic-golden-selfcheck-\(outcomes.count)")
    try? FileManager.default.removeItem(at: work)
    try! FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
    try! FileManager.default.copyItem(at: dir.appendingPathComponent("native-selftest.json"), to: work.appendingPathComponent("native-selftest.json"))
    let moved = NSBitmapImageRep(cgImage: shifted(image, scale: scale, bar: bar, shift: shift))
    let original = NSBitmapImageRep(cgImage: image)
    try! (moveClone ? moved : original).representation(using: .png, properties: [:])!.write(to: work.appendingPathComponent("golden-clone.png"))
    try! (moveClone ? original : moved).representation(using: .png, properties: [:])!.write(to: work.appendingPathComponent("golden-classic.png"))
    let meta: [String: Any] = ["titlebarHeight": bar, "imageOriginBelowFrame": 0, "backingScale": scale, "simulated": true]
    try! JSONSerialization.data(withJSONObject: meta).write(to: work.appendingPathComponent("golden-classic.json"))
    let run = Process()
    run.executableURL = URL(fileURLWithPath: "/usr/bin/swift")
    run.arguments = [CommandLine.arguments[0], "measure", work.path]
    run.standardOutput = FileHandle.nullDevice
    try! run.run()
    run.waitUntilExit()
    let report = (try? JSONSerialization.jsonObject(with: Data(contentsOf: work.appendingPathComponent("golden-result.json")))) as? [String: Any] ?? [:]
    let text = String(describing: report)
    let matched = run.terminationStatus == expected && (reason.map { text.contains($0) } ?? true)
    outcomes[name] = ["exit": run.terminationStatus, "expected": expected, "reason": reason ?? NSNull(), "matched": matched, "result": report]
    if !matched { ok = false }
  }
  outcomes["passed"] = ok
  write(outcomes, "golden-selfcheck.json")
  print(ok ? "Comparator passes the same capture, fails a 6pt shift, and fails text under the title bar" : "Comparator self-check failed")
  return ok ? 0 : 1
}

switch args.count > 1 ? args[1] : "" {
case "classic": exit(await captureClassic())
case "measure": exit(compare())
case "selfcheck": exit(selfcheck())
default:
  FileHandle.standardError.write("usage: classic-golden.swift classic <dir> <fixture> | measure <dir> | selfcheck <dir>\n".data(using: .utf8)!)
  exit(64)
}
