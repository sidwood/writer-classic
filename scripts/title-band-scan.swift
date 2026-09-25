// Pixel scan of a clone window capture for editor text under the title bar.
//   swift scripts/title-band-scan.swift docs/evidence/classic-golden/golden-clone.png
// Near-grey ink counts; transparent corner pixels, the traffic lights (x < 80pt)
// and the centred title (±60pt) are excluded.
import AppKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let rep = NSBitmapImageRep(data: try! Data(contentsOf: url))!
let scale = 2.0, bar = 32.0
func ink(_ x: Int, _ y: Int) -> Bool {
  guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), c.alphaComponent > 0.5 else { return false }
  let l = 0.299 * c.redComponent + 0.587 * c.greenComponent + 0.114 * c.blueComponent
  return l < 0.55 && max(c.redComponent, c.greenComponent, c.blueComponent) - min(c.redComponent, c.greenComponent, c.blueComponent) < 0.12
}
let w = rep.pixelsWide, h = rep.pixelsHigh, barPx = Int(bar * scale)
let titleFrom = w / 2 - Int(60 * scale), titleTo = w / 2 + Int(60 * scale), lights = Int(80 * scale)
var bandInk = 0
for y in 0..<barPx { for x in 0..<w where x >= lights && !(x >= titleFrom && x < titleTo) { if ink(x, y) { bandInk += 1 } } }
var first = -1
outer: for y in 0..<h { for x in 0..<w where x >= Int(5 * scale) && !(y < barPx && (x < lights || (x >= titleFrom && x < titleTo))) { if ink(x, y) { first = y; break outer } } }
print("image \(w)x\(h) px at 2x, title bar \(bar)pt")
print("near-grey ink in the top \(bar)pt, excluding traffic lights (x<80pt) and centred title (±60pt): \(bandInk) px")
print("first near-grey editor ink: \(Double(first) / scale)pt below the frame top, \(Double(first) / scale - bar)pt below the title bar")
var where_: [Int: (Int, Int)] = [:]
for y in 0..<barPx { for x in 0..<w where x >= lights && !(x >= titleFrom && x < titleTo) { if ink(x, y) { let r = where_[y] ?? (x, x); where_[y] = (min(r.0, x), max(r.1, x)) } } }
for (y, r) in where_.sorted(by: { $0.key < $1.key }) { print("row \(y): x \(r.0)-\(r.1)") }
