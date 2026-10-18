"""Compare captured lobby frames against the actual transparent plume silhouette.

Run after verify-weplay-lobby-exit-browser.mjs --motion-only:
  python scripts/verify-weplay-plume-pixels.py <evidence-directory>
Requires Pillow. Only reads assets and creates local QA evidence.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.stdout.reconfigure(encoding="utf-8")


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public/assets/weplay/naval"
EVIDENCE = Path(sys.argv[1]).resolve()
SOURCE_SIZE = (1672, 941)
TOLERANCE = 1  # Allow a single channel rounding level; record exact differences too.
EDGE_RADIUS = 3  # Screenshot pixels, covering SVG resampling at transparent edges.


def maximum_channel(image):
    red, green, blue = image.convert("RGB").split()
    return ImageChops.lighter(ImageChops.lighter(red, green), blue)


def metrics(delta, mask):
    selected = ImageChops.multiply(delta, mask)
    histogram = selected.histogram()
    return {
        "maxChannelDifference": selected.getextrema()[1],
        "changedPixels": sum(histogram[1:]),
        "changedPixelsAboveTolerance": sum(histogram[TOLERANCE + 1 :]),
        "changedBounds": selected.getbbox(),
    }


def verify(directory):
    manifest = json.loads((directory / "frames.json").read_text(encoding="utf-8"))
    frames = [Image.open(directory / item["name"]).convert("RGB") for item in manifest["frames"]]
    size = frames[0].size
    assert all(frame.size == size for frame in frames), "Capture geometry must stay fixed"
    scale = max(manifest["geometry"]["art"]["width"] / SOURCE_SIZE[0], manifest["geometry"]["art"]["height"] / SOURCE_SIZE[1])

    # Use the union of all five source alpha channels, not their rectangular box.
    # Only the animated side of the fixed-root mask is permitted to change.
    source_union = Image.new("L", SOURCE_SIZE)
    for asset in manifest["assets"]:
        name = asset["href"].split("/")[-1].split("?")[0]
        alpha = Image.open(ASSETS / name).convert("RGBA").getchannel("A")
        alpha = alpha.resize((round(asset["width"]), round(asset["height"])))
        source = Image.new("L", SOURCE_SIZE)
        source.paste(alpha, (round(asset["x"]), round(asset["y"])))
        source_union = ImageChops.lighter(source_union, source)
    ImageDraw.Draw(source_union).rectangle((0, 0, manifest["fixedRootUntilX"], SOURCE_SIZE[1]), fill=0)
    source_union = source_union.point(lambda value: 255 if value else 0)
    allowed = source_union.transform(size, Image.Transform.AFFINE, (1 / scale, 0, 0, 0, 1 / scale, 0), resample=Image.Resampling.BICUBIC)
    allowed = allowed.point(lambda value: 255 if value else 0).filter(ImageFilter.MaxFilter(EDGE_RADIUS * 2 + 1))
    fixed = ImageChops.invert(allowed)
    allowed.save(directory / "allowed-plume-alpha-mask.png")

    def region_mask(box):
        mask = Image.new("L", size)
        box = tuple(round(value * scale) for value in box)
        ImageDraw.Draw(mask).rectangle(box, fill=255)
        return mask

    regions = {
        "backgroundOutsideActualHair": fixed,
        "fixedAttachmentRoot": region_mask((384, 0, 497, 397)),
        "helmetAndFace": region_mask((210, 175, 497, 540)),
        "enemyFleet": region_mask((620, 460, 1650, 790)),
        "leftSkyAndFlags": region_mask((0, 0, 384, 430)),
    }
    maximum = Image.new("L", size)
    for frame in frames[1:]:
        maximum = ImageChops.lighter(maximum, maximum_channel(ImageChops.difference(frames[0], frame)))
    maximum.save(directory / "maximum-rendered-difference.png")
    region_results = {name: metrics(maximum, mask) for name, mask in regions.items()}
    moving_pixels = metrics(maximum, allowed)
    paused_delta = maximum_channel(ImageChops.difference(Image.open(directory / "paused-00.png"), Image.open(directory / "paused-01.png")))
    paused = metrics(paused_delta, Image.new("L", size, 255))
    same_pose = []
    for pose in range(5):
        indices = [index for index, item in enumerate(manifest["frames"]) if item["frame"] == pose]
        pose_delta = Image.new("L", size)
        for index in indices[1:]:
            pose_delta = ImageChops.lighter(pose_delta, maximum_channel(ImageChops.difference(frames[indices[0]], frames[index])))
        same_pose.append({"pose": pose, "captures": [manifest["frames"][index]["name"] for index in indices], **metrics(pose_delta, Image.new("L", size, 255))})
    outside_delta = ImageChops.multiply(maximum, fixed)
    violation_points = [{"x": x, "y": y, "maxChannelDifference": outside_delta.getpixel((x, y))} for y in range(size[1]) for x in range(size[0]) if outside_delta.getpixel((x, y)) > TOLERANCE]
    (directory / "background-difference-points.json").write_text(json.dumps(violation_points, indent=2), encoding="utf-8")

    # One shared palette prevents the proof GIF itself from introducing sky shimmer.
    # The native PNG comparison above remains the source of pixel evidence.
    palette_strip = Image.new("RGB", (320, 180 * len(frames)))
    for index, frame in enumerate(frames):
        palette_strip.paste(frame.resize((320, 180)), (0, index * 180))
    palette = palette_strip.quantize(colors=256, dither=Image.Dither.NONE)
    gif_frames = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    times = [item["elapsedMs"] for item in manifest["frames"]]
    durations = [times[index + 1] - elapsed for index, elapsed in enumerate(times[:-1])]
    durations.append(durations[-1])
    gif_frames[0].save(directory / "plume-proof.gif", save_all=True, append_images=gif_frames[1:], duration=durations, loop=0, optimize=False, disposal=1)

    result = {
        "directory": str(directory),
        "captureSize": size,
        "sourceScale": scale,
        "frameCount": len(frames),
        "observedPoses": sorted(set(item["frame"] for item in manifest["frames"])),
        "meanIntervalMs": manifest["meanIntervalMs"],
        "channelTolerance": TOLERANCE,
        "alphaEdgeAllowancePixels": EDGE_RADIUS,
        "regions": region_results,
        "movingHair": moving_pixels,
        "paused": paused,
        "samePoseRepeatedCaptures": same_pose,
    }
    result["pass"] = all(item["changedPixelsAboveTolerance"] == 0 for item in region_results.values()) and paused["changedPixelsAboveTolerance"] == 0 and moving_pixels["changedPixelsAboveTolerance"] > 0
    (directory / "pixel-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


reports = [verify(EVIDENCE / "motion" / name) for name in ("normal-1280", "reduced-390")]
(EVIDENCE / "plume-pixel-report.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(reports, ensure_ascii=False, indent=2))
sys.exit(0 if all(report["pass"] for report in reports) else 1)
