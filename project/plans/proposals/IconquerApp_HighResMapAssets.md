# Design Proposal: Phase 3 -- High-Resolution Map Asset Pipeline

**Date:** 2026-04-23
**Status:** Proposed
**Scope:** Multi-resolution asset pipeline for IconquerApp, replacing the legacy 2002-era art with device-appropriate high-resolution map textures across iPhone, iPad, and Mac.

---

## 1. Objective

The IconquerApp currently ships the original 2002 art assets verbatim: a single Background.jpg (1820x950) and 42 country PNG overlays at fixed pixel sizes (e.g., Alaska 183x137, Greenland 559x208). These assets were designed for a 1024x768 desktop era and look blurry on modern Retina displays, especially iPad Pro (2732x2048) and 6.7" iPhones (2796x1290).

**Problems solved:**

1. **Blurry maps on Retina devices.** The 1820px background is below @1x density on iPad Pro. Country PNGs render at sub-native resolution on every Apple device sold since 2012.
2. **No multi-resolution strategy.** A single resolution is loaded regardless of device, wasting memory on small screens or looking poor on large ones.
3. **No asset catalog integration.** Assets are loaded from flat files at runtime, bypassing Xcode Asset Catalog optimizations (app thinning, on-demand resources, device-specific slicing).
4. **Custom map authors have no spec.** The plugin-based map system accepts arbitrary bundles but provides no resolution requirements, color profile guidance, or validation.

**Master Plan Reference:** Phase 3 -- High-Resolution Map Assets. Prerequisite for the GameBoardView visual map renderer defined in the SwiftUI Port proposal.

---

## 2. Proposed Architecture

### New Files

| File | Purpose |
|------|---------|
| `IconquerApp/Model/MapAssetLoader.swift` | Resolution-aware asset loader with memory-budget enforcement |
| `IconquerApp/Model/MapAssetManifest.swift` | Codable manifest describing available resolutions in a map bundle |
| `IconquerApp/Model/MapTextureCache.swift` | LRU texture cache with device-specific memory limits |
| `IconquerApp/Model/MapAssetValidator.swift` | Validates a map bundle against the asset specification |
| `IconquerApp/Resources/Assets.xcassets/Maps/` | Xcode Asset Catalog with @1x/@2x/@3x variants per country |
| `IconquerCore/Map/MapAssetReference.swift` | Asset directory reference and resolution metadata in UnifiedMapFile |
| `scripts/generate-map-assets.sh` | Pipeline script: source art to multi-resolution raster output |
| `scripts/validate-map-bundle.swift` | Swift script to validate a map bundle against the spec |
| `docs/MapAuthorGuide.md` | Requirements for community/custom map authors (created only when explicitly requested) |

### Modified Files

| File | Change |
|------|--------|
| `IconquerCore/Map/UnifiedMapFile.swift` | Add optional `assetReference: MapAssetReference?` field |
| `IconquerCore/Map/MapLayout.swift` | Add `designResolution` field (the pixel dimensions the layout coordinates target) |
| `IconquerApp/Views/GameBoardView.swift` | Consume `MapAssetLoader` instead of raw file paths |

### Module Placement

- **IconquerCore** gets the `MapAssetReference` model type (pure data, no UIKit/AppKit dependency).
- **IconquerApp** gets all asset-loading, caching, and validation logic (platform-specific, imports SwiftUI/UIKit).
- Scripts live in the iconquer repo root `scripts/` directory.

---

## 3. API Surface

### MapAssetReference (IconquerCore)

```swift
/// Metadata describing how to locate and select visual assets for a map.
/// Lives in UnifiedMapFile so the map bundle is self-describing.
public struct MapAssetReference: Codable, Sendable {
    /// Relative path from the map bundle root to the asset directory.
    /// Example: "assets/" containing "Background@2x.jpg", "Alaska@2x.png", etc.
    public var assetDirectory: String

    /// The design resolution the layout coordinates were authored against.
    /// Country positions in MapLayout are expressed in this coordinate space.
    public var designResolution: DesignResolution

    /// Available scale factors in this bundle (e.g., [1, 2, 3]).
    public var availableScales: [Int]

    /// Background image base filename (without scale suffix or extension).
    public var backgroundBaseName: String

    /// File format for the background image.
    public var backgroundFormat: ImageFormat

    /// File format for country overlay images.
    public var countryFormat: ImageFormat

    /// Color profile requirement. All assets must embed this profile.
    public var colorProfile: ColorProfile

    public struct DesignResolution: Codable, Sendable {
        public var width: Int
        public var height: Int
    }

    public enum ImageFormat: String, Codable, Sendable {
        case png
        case jpeg
        case heic
        case webp
    }

    public enum ColorProfile: String, Codable, Sendable {
        case sRGB = "sRGB"
        case displayP3 = "Display P3"
    }
}
```

### MapAssetLoader (IconquerApp)

```swift
/// Loads map assets at the appropriate resolution for the current device.
/// Thread-safe: all public methods are isolated to MainActor or Sendable.
@MainActor
@Observable
public final class MapAssetLoader {

    /// Memory budget in bytes. Defaults per device class.
    public let memoryBudget: Int

    /// Initialize with a map bundle and optional memory override.
    /// - Parameters:
    ///   - bundleURL: URL to the map bundle directory.
    ///   - manifest: Parsed MapAssetManifest from the bundle.
    ///   - memoryBudget: Override the default device-class budget (bytes).
    public init(
        bundleURL: URL,
        manifest: MapAssetManifest,
        memoryBudget: Int? = nil
    )

    /// Load the background image at the best scale for the current device.
    /// Returns a downsampled image if the full-resolution version exceeds budget.
    public func loadBackground() async throws -> PlatformImage

    /// Load a country overlay image by country ID.
    /// Uses the texture cache; evicts LRU entries if budget is exceeded.
    public func loadCountry(_ countryId: String) async throws -> PlatformImage

    /// Preload all country textures for the visible viewport.
    /// Call this during GameBoardView.onAppear or when zoom level changes.
    public func preloadCountries(_ countryIds: [String]) async throws

    /// Current memory usage of cached textures in bytes.
    public var currentMemoryUsage: Int { get }

    /// Flush all cached textures. Call on memory warning.
    public func flushCache()
}

/// Platform-abstracted image type.
#if canImport(UIKit)
public typealias PlatformImage = UIImage
#elseif canImport(AppKit)
public typealias PlatformImage = NSImage
#endif
```

### MapAssetManifest (IconquerApp)

```swift
/// Parsed manifest file (manifest.json) found at the root of a map asset bundle.
public struct MapAssetManifest: Codable, Sendable {
    /// Map name, must match UnifiedMapFile.name.
    public var mapName: String
    /// Version of the asset bundle (semver string).
    public var version: String
    /// Available resolution tiers.
    public var tiers: [ResolutionTier]

    public struct ResolutionTier: Codable, Sendable {
        /// Scale factor: 1, 2, or 3.
        public var scale: Int
        /// Subdirectory containing assets at this scale (e.g., "@2x/").
        public var directory: String
        /// Background image dimensions at this scale.
        public var backgroundSize: ImageSize
        /// Expected total size of all assets at this tier, in bytes.
        public var estimatedSizeBytes: Int
    }

    public struct ImageSize: Codable, Sendable {
        public var width: Int
        public var height: Int
    }
}
```

### MapTextureCache (IconquerApp)

```swift
/// LRU cache for decoded map textures with a hard memory ceiling.
/// Actor-isolated for thread safety.
public actor MapTextureCache {
    /// Initialize with a maximum memory budget in bytes.
    public init(budgetBytes: Int)

    /// Retrieve a cached image, or nil if not present.
    public func get(_ key: String) -> PlatformImage?

    /// Insert an image into the cache. Evicts LRU entries if over budget.
    public func set(_ key: String, image: PlatformImage, sizeBytes: Int)

    /// Current memory consumption in bytes.
    public var currentUsage: Int { get }

    /// Evict all entries.
    public func flush()
}
```

### MapAssetValidator (IconquerApp)

```swift
/// Validates a map asset bundle against the specification.
public struct MapAssetValidator: Sendable {
    public struct ValidationResult: Sendable {
        public var isValid: Bool
        public var errors: [String]
        public var warnings: [String]
    }

    /// Validate a map bundle at the given URL.
    /// Checks: manifest presence, file existence for all countries at all scales,
    /// dimension correctness, transparency (PNG alpha channel), color profile embedding.
    public static func validate(bundleURL: URL, mapFile: UnifiedMapFile) async -> ValidationResult
}
```

---

## 4. Asset Specification

### Resolution Targets

The design resolution (the coordinate space MapLayout positions are authored in) is **1820x950** -- matching the original Background.jpg. All scale factors multiply from this base.

| Scale | Background (JPEG) | Country PNGs | Target Devices |
|-------|--------------------|-------------|----------------|
| @1x | 1820 x 950 | Original dimensions | Mac (non-Retina), low-memory fallback |
| @2x | 3640 x 1900 | 2x original dimensions | iPhone, iPad, Mac Retina |
| @3x | 5460 x 2850 | 3x original dimensions | iPhone Pro Max (6.7" and 6.9") |

### File Format Requirements

| Asset Type | Format | Requirements |
|-----------|--------|-------------|
| Background | JPEG (.jpg) | Quality 85+, no alpha channel, progressive encoding recommended |
| Country overlays | PNG (.png) | 32-bit RGBA, transparent background, anti-aliased edges |
| Background (optional) | HEIC (.heic) | Quality 80+, for on-device storage savings; JPEG required as fallback |

### Color Profile

All assets must embed the **sRGB IEC61966-2.1** color profile. Display P3 is accepted for devices that support wide color, but sRGB is the required baseline. Assets without an embedded profile will be assumed sRGB.

### Country PNG Transparency Requirements

- Alpha channel must be fully transparent (0) outside the country boundary.
- Country fill area must be fully opaque (255) or semi-transparent for the tinting system to work. Recommended: fully white (RGB 255,255,255) fill at full opacity, allowing the app to apply player-color tinting via `.colorMultiply()` or blend modes.
- Anti-aliased edges: 1-2 pixel feather along country boundaries.

### Naming Convention

```
<CountryName>@<scale>x.<ext>
Background@<scale>x.<ext>
```

Examples: `Alaska@2x.png`, `Background@3x.jpg`, `Greenland@1x.png`

Spaces in country names use the same encoding as the original assets (literal spaces in filenames, matching `Countries.json` keys).

---

## 5. Asset Pipeline

### Source Art Strategy

Given the 2002-era raster originals, two parallel paths are supported:

#### Path A: AI Upscaling (for legacy maps)

1. **Input:** Original @1x assets from `public/maps/iconquer-world/`.
2. **Upscale:** Use Real-ESRGAN or similar neural upscaler to generate @2x and @3x variants.
3. **Post-process:** Color-correct to match original palette, sharpen edges, verify alpha channel integrity on PNGs.
4. **Validate:** Run `validate-map-bundle.swift` to confirm dimensions, format, and profile.

#### Path B: Vector-to-Raster (for new maps)

1. **Author:** Create country boundaries as vector paths in SVG or Adobe Illustrator.
2. **Export:** Rasterize at @1x, @2x, @3x using the pipeline script.
3. **Background:** Author or commission a background illustration; export as JPEG at all three scales.
4. **Validate:** Run `validate-map-bundle.swift`.

### Pipeline Script (`scripts/generate-map-assets.sh`)

```bash
#!/bin/bash
# Usage: generate-map-assets.sh <source-dir> <output-dir>
#
# For vector sources (SVG):
#   Rasterizes at @1x, @2x, @3x using rsvg-convert or Inkscape CLI.
#
# For raster sources (upscaling path):
#   Expects @1x originals; calls realesrgan-ncnn-vulkan for 2x and 3x.
#
# Post-processing:
#   - sips to embed sRGB profile
#   - pngquant for PNG optimization (lossless)
#   - jpegoptim for JPEG optimization
#   - Generates manifest.json with dimensions and estimated sizes
```

### Output Directory Structure

```
maps/iconquer-world/
    manifest.json
    @1x/
        Background.jpg
        Alaska.png
        Alberta.png
        ... (42 country PNGs)
    @2x/
        Background.jpg
        Alaska.png
        ...
    @3x/
        Background.jpg
        Alaska.png
        ...
```

---

## 6. Asset Catalog Integration

### Xcode Asset Catalog Structure

For the built-in world map, assets are embedded in the Xcode Asset Catalog for automatic app thinning:

```
Assets.xcassets/
    Maps/
        WorldMap/
            Background.imageset/
                Contents.json
                Background@1x.jpg
                Background@2x.jpg
                Background@3x.jpg
            Alaska.imageset/
                Contents.json
                Alaska@1x.png
                Alaska@2x.png
                Alaska@3x.png
            ... (42 country imagesets)
```

Each `Contents.json` follows the standard Xcode format:

```json
{
  "images": [
    { "filename": "Alaska@1x.png", "idiom": "universal", "scale": "1x" },
    { "filename": "Alaska@2x.png", "idiom": "universal", "scale": "2x" },
    { "filename": "Alaska@3x.png", "idiom": "universal", "scale": "3x" }
  ],
  "info": { "version": 1, "author": "xcode" }
}
```

### Custom/Community Maps

Custom maps are NOT embedded in the Asset Catalog. They live in the app's documents directory or are loaded from a URL. The `MapAssetLoader` handles resolution selection at runtime for these bundles using the `manifest.json`.

This two-tier approach means:
- **Built-in maps** benefit from app thinning (only the device's scale factor ships).
- **Custom maps** download all tiers but load only the appropriate one at runtime.

---

## 7. Dynamic Resolution Loading

### Device Classification

```swift
/// Device memory class determines the maximum texture budget.
public enum DeviceMemoryClass: Sendable {
    /// iPhone SE, older iPads: 2-3 GB RAM.
    case constrained
    /// Standard iPhones, iPads: 4-6 GB RAM.
    case standard
    /// iPad Pro, Mac: 8+ GB RAM.
    case expanded

    /// Maximum texture memory budget for map assets, in bytes.
    public var textureBudget: Int {
        switch self {
        case .constrained: return 64 * 1024 * 1024   // 64 MB
        case .standard:    return 128 * 1024 * 1024   // 128 MB
        case .expanded:    return 256 * 1024 * 1024   // 256 MB
        }
    }

    /// Detect the current device class from ProcessInfo.
    public static var current: DeviceMemoryClass {
        let totalMemory = ProcessInfo.processInfo.physicalMemory
        if totalMemory < 4 * 1024 * 1024 * 1024 { return .constrained }
        if totalMemory < 8 * 1024 * 1024 * 1024 { return .standard }
        return .expanded
    }
}
```

### Scale Factor Selection Algorithm

```swift
/// Select the best scale factor given the device screen scale and memory budget.
///
/// - Parameters:
///   - screenScale: The device's native screen scale (UIScreen.main.scale or NSScreen equivalent).
///   - availableScales: Scale factors available in the map bundle.
///   - estimatedSizes: Estimated total texture size at each scale (from manifest).
///   - budget: Maximum texture memory in bytes.
/// - Returns: The highest available scale that fits within budget.
public static func selectScale(
    screenScale: CGFloat,
    availableScales: [Int],
    estimatedSizes: [Int: Int],
    budget: Int
) -> Int
```

The algorithm:
1. Start with the scale matching `ceil(screenScale)`.
2. If the estimated texture size at that scale exceeds the budget, step down.
3. Never go below @1x.
4. Log a warning if forced below native scale.

### Memory Warning Handling

```swift
// In MapAssetLoader
private func observeMemoryWarnings() {
    #if canImport(UIKit)
    NotificationCenter.default.addObserver(
        forName: UIApplication.didReceiveMemoryWarningNotification,
        object: nil,
        queue: .main
    ) { [weak self] _ in
        self?.flushCache()
    }
    #endif
}
```

### Downsampling Strategy

For images that would exceed budget even at @1x, use `ImageIO` downsampling to decode at a reduced resolution without loading the full image into memory:

```swift
/// Downsample an image file to fit within the given pixel dimensions.
/// Uses ImageIO to decode at reduced resolution, avoiding full-size allocation.
public static func downsample(
    imageURL: URL,
    maxPixelSize: Int
) -> PlatformImage?
```

---

## 8. Map Bundle Format

### Updated UnifiedMapFile

The `assetReference` field is optional for backward compatibility. Maps without it fall back to the legacy flat-file loading behavior.

```swift
// Addition to UnifiedMapFile
public struct UnifiedMapFile: Codable, Sendable {
    // ... existing fields ...

    /// Optional reference to high-resolution visual assets.
    /// When nil, the loader falls back to legacy flat-file loading
    /// (Background.jpg + country PNGs in the map directory root).
    public var assetReference: MapAssetReference?
}
```

### Complete Map Bundle Structure

```
my-custom-map/
    map.json              # UnifiedMapFile (game tree + layouts + assetReference)
    manifest.json         # MapAssetManifest (resolution tiers, sizes)
    Countries.json        # Legacy coordinate data (backward compat)
    Continents.json       # Legacy continent data (backward compat)
    @1x/
        Background.jpg
        <Country>.png     # One per country in map.json
    @2x/
        Background.jpg
        <Country>.png
    @3x/
        Background.jpg
        <Country>.png
    localization/          # Optional
        en.lproj/
            CountryNames.strings
        fr.lproj/
            CountryNames.strings
```

### manifest.json Example

```json
{
  "mapName": "Classic World",
  "version": "1.0.0",
  "tiers": [
    {
      "scale": 1,
      "directory": "@1x",
      "backgroundSize": { "width": 1820, "height": 950 },
      "estimatedSizeBytes": 2500000
    },
    {
      "scale": 2,
      "directory": "@2x",
      "backgroundSize": { "width": 3640, "height": 1900 },
      "estimatedSizeBytes": 9500000
    },
    {
      "scale": 3,
      "directory": "@3x",
      "backgroundSize": { "width": 5460, "height": 2850 },
      "estimatedSizeBytes": 21000000
    }
  ]
}
```

---

## 9. New Map Creation Guide (Requirements Summary)

Community map authors must provide:

1. **map.json** -- Valid UnifiedMapFile with countries, continents, at least one MapLayout, and a populated `assetReference`.
2. **manifest.json** -- Valid MapAssetManifest with at least the @1x tier. @2x is strongly recommended; @3x is optional.
3. **Background image** -- JPEG, sRGB profile, at the dimensions specified in manifest.json for each included tier.
4. **Country overlay PNGs** -- One per country defined in map.json. 32-bit RGBA PNG, sRGB profile, transparent background, white fill for tinting. Dimensions must scale proportionally across tiers.
5. **Coordinate consistency** -- MapLayout positions must be authored against the `designResolution` declared in the asset reference. Country overlay PNG positions must align with the layout coordinates.
6. **Validation** -- Run `scripts/validate-map-bundle.swift <bundle-path>` before distribution. Zero errors required; warnings acceptable.

### Minimum Viable Bundle

A map bundle with only @1x assets and a simple layout is valid. The loader will display it on all devices (with upscaling artifacts on Retina screens, but functional).

---

## 10. MCP Schema

**Tool Description:** Validate a map asset bundle for completeness and correctness.

**REQUIRED STRUCTURE (JSON):**
```json
{
  "bundlePath": "/path/to/my-custom-map",
  "strictMode": true
}
```

**Parameter Types:**
- bundlePath (string): Absolute path to the map bundle directory. Required.
- strictMode (boolean): When true, warnings are promoted to errors. Default: false.

**Response:**
```json
{
  "isValid": true,
  "errors": [],
  "warnings": ["@3x tier missing -- iPhone Pro Max will use @2x"],
  "assetCount": 43,
  "totalSizeBytes": {
    "@1x": 2500000,
    "@2x": 9500000
  }
}
```

---

## 11. Constraints and Compliance

| Constraint | How this design complies |
|-----------|------------------------|
| **Concurrency** | `MapTextureCache` is an `actor`. `MapAssetLoader` is `@MainActor @Observable`. All model types are `Sendable` value types. |
| **No force unwraps** | All image loading returns optionals or throws. Guard clauses validate manifest before loading. |
| **Division safety** | Scale factor selection guards against empty `availableScales` arrays. |
| **Swift 6 strict concurrency** | No `@unchecked Sendable`. No mutable shared state outside actors. |
| **No hardcoded constants** | Memory budgets live in `DeviceMemoryClass`. Image quality constants live in the pipeline script config. Design resolution comes from the manifest. |
| **Backward compatibility** | `assetReference` is optional. Maps without it fall back to legacy loading. |
| **MCP Ready** | Validation tool has JSON schema. Asset manifest is machine-readable JSON. |

---

## 12. Backend Abstraction (Compute-Intensive)

Image decoding and downsampling are compute-intensive on large textures.

**Backend Protocol:** Not applicable (no custom compute kernel). All heavy lifting uses Apple's `ImageIO` framework, which internally dispatches to hardware-accelerated decoders.

**Accelerate Usage:** `vImage` may be used for color space conversion if assets arrive in a non-sRGB profile. This is a future optimization -- initial implementation relies on `CGImage` automatic conversion.

**Fallback:** All decoding uses `CGImageSource` (available on all Apple platforms). No Metal dependency for asset loading.

---

## 13. Dependencies

**Internal Dependencies:**
- `IconquerCore/Map/UnifiedMapFile.swift` -- extended with `assetReference` field.
- `IconquerCore/Map/MapLayout.swift` -- `designResolution` awareness.
- `IconquerApp/Views/GameBoardView.swift` -- consumes loaded images.

**External Dependencies:** None. Uses only system frameworks:
- `Foundation` (file I/O, JSON decoding)
- `ImageIO` (downsampled image loading via `CGImageSource`)
- `UIKit` / `AppKit` (platform image types)
- `SwiftUI` (rendering)

**Build Tool Dependencies (pipeline script only, not shipped):**
- `rsvg-convert` or `Inkscape` (vector-to-raster, Path B only)
- `realesrgan-ncnn-vulkan` (AI upscaling, Path A only)
- `sips` (macOS built-in, color profile embedding)
- `pngquant` (PNG optimization, optional)
- `jpegoptim` (JPEG optimization, optional)

---

## 14. Test Strategy

### Test Categories

| Category | Tests |
|----------|-------|
| **Golden path** | Load @2x background and all 42 countries from a valid bundle. Verify non-nil images with correct dimensions. |
| **Scale selection** | Given screen scale 2.0 and budget 128 MB, selects @2x. Given budget 10 MB, falls back to @1x. |
| **Memory budget enforcement** | Load countries until budget is exceeded. Verify LRU eviction occurs and `currentMemoryUsage` stays within bounds. |
| **Cache behavior** | Insert, retrieve, evict. Verify LRU ordering. Verify flush clears all entries. |
| **Manifest parsing** | Decode a valid manifest.json. Decode a manifest with missing optional fields. Reject a manifest with no tiers. |
| **Backward compatibility** | Load a legacy map bundle (no manifest.json, no @2x/@3x). Verify fallback to flat-file loading. |
| **Validation** | Valid bundle returns `.isValid == true`. Missing country PNG returns error. Wrong dimensions return error. Missing @3x returns warning (not error). |
| **Downsampling** | Load a 5460x2850 JPEG and downsample to 1820x950. Verify output dimensions within 1px tolerance. |
| **Edge cases** | Empty country list. Country name with spaces. Bundle URL that does not exist. Corrupt JPEG file. Zero-byte PNG. |
| **Performance** | Preloading all 42 country PNGs at @2x completes in under 500ms on iPhone. Background load completes in under 200ms. |

### Reference Truth

- **Dimension validation:** `sips -g pixelWidth -g pixelHeight` on the generated assets provides ground truth.
- **Memory estimation:** `pixelWidth * pixelHeight * 4` (32-bit RGBA) gives the decoded texture size in bytes. For JPEG backgrounds, the decoded size is the same (JPEG is only compressed on disk).
- **Scale selection:** Deterministic algorithm with explicit inputs; no external reference needed.

### Validation Trace (REQUIRED)

- Background @2x decoded size: 3640 * 1900 * 4 = **27,664,000 bytes** (~26.4 MB).
- Background @3x decoded size: 5460 * 2850 * 4 = **62,244,000 bytes** (~59.4 MB).
- All 42 countries @2x estimated: ~42 * (avg 300x200 * 4 * 4) = ~42 * 960,000 = **~40 MB**.
- Total @2x budget: ~26.4 + ~40 = **~66 MB** -- fits in the 128 MB `standard` budget.
- Total @3x budget: ~59.4 + ~90 = **~150 MB** -- fits in the 256 MB `expanded` budget but exceeds `standard`.
- On a `constrained` device (64 MB budget), @2x total (~66 MB) exceeds budget, so the loader selects @1x. Decoded @1x total: ~6.9 + ~10 = **~17 MB**.

These exact values become assertion targets in the scale-selection tests.

---

## 15. Performance Considerations

### Memory Budget Table

| Device Class | Example Devices | RAM | Texture Budget | Max Scale | Est. Map Memory |
|-------------|----------------|-----|---------------|-----------|----------------|
| Constrained | iPhone SE 3, iPad 9th gen | 3-4 GB | 64 MB | @1x | ~17 MB |
| Standard | iPhone 16, iPad Air | 6 GB | 128 MB | @2x | ~66 MB |
| Expanded | iPad Pro M4, Mac | 8-36 GB | 256 MB | @3x | ~150 MB |

### Loading Strategy

1. **Lazy loading:** Only the background is loaded eagerly. Country PNGs are loaded on first visibility (when the country enters the scroll viewport or is part of the current zoom region).
2. **Preloading:** `preloadCountries(_:)` accepts an array of visible country IDs. Called when zoom/pan changes. Loads in parallel using a `TaskGroup`.
3. **Cache eviction:** LRU eviction when inserting a new texture would exceed the budget. The background image is pinned and never evicted.
4. **Downsampling:** For custom maps with oversized source art, `ImageIO` downsampling decodes at reduced resolution directly from disk, never allocating the full-size bitmap.

### Disk Size Estimates

| Scale | Background (JPEG) | 42 Countries (PNG) | Total |
|-------|-------------------|-------------------|-------|
| @1x | ~1.2 MB | ~2.0 MB | ~3.2 MB |
| @2x | ~4.5 MB | ~7.5 MB | ~12 MB |
| @3x | ~9.5 MB | ~16 MB | ~25.5 MB |
| **All tiers** | | | **~41 MB** |

With Xcode app thinning, only the appropriate tier ships to each device, so the actual download impact is 3-25 MB per map.

---

## 16. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft entry below

**New ADR Draft:**
- Title: Map assets use tiered resolution bundles with runtime scale selection
- Category: architecture
- Key decision: Map bundles ship @1x/@2x/@3x asset tiers in subdirectories with a manifest.json; the app selects the highest tier that fits the device's memory budget, falling back gracefully to @1x.

---

## 17. Open Questions

1. **HEIC for backgrounds?** HEIC offers ~40% size savings over JPEG at equivalent quality and is supported on all target devices (iOS 11+, macOS 10.13+). Should HEIC be the primary background format with JPEG as fallback, or should we keep JPEG primary for maximum compatibility with map authoring tools?

2. **On-Demand Resources (ODR)?** For the built-in world map, assets could be tagged as ODR and downloaded post-install. This reduces initial app download size but adds first-launch latency. Worth it for a ~12-25 MB map?

3. **Vector country overlays?** If new maps are authored in SVG, should the app render SVG directly at native resolution (eliminating the need for @2x/@3x rasters) or always pre-rasterize? SVG rendering has runtime cost but perfect sharpness at any scale.

4. **Existing art licensing?** The 2002-era assets were part of the original iConquer open-source release. Confirm the license permits AI-upscaled derivative works before generating @2x/@3x variants.

5. **Country tinting approach?** The current proposal assumes white-filled PNGs with runtime color multiplication. An alternative is pre-tinted PNGs per player color (6 colors x 42 countries x 3 scales = 756 files). The white-fill approach is strongly preferred for bundle size, but needs confirmation that `.colorMultiply()` produces acceptable visual results.

---

## 18. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (MapAssetLoader, MapTextureCache, MapAssetManifest, MapAssetValidator)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (resolution scaling, memory budgets, asset pipeline)

**Article Name:** MapAssetPipelineGuide.md
(Must NOT match any Swift symbol name to avoid DocC parser conflicts)
