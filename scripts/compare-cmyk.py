"""Compare validate-cmyk.mjs output with native LittleCMS through Pillow.

Usage: python scripts/compare-cmyk.py /path/to/the/same/printer.icc
Requires Pillow with ImageCms; writes only under ignored test-results/.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageCms

root = Path(__file__).resolve().parent.parent
directory = root / "test-results/cmyk"
source = Image.open(root / "tests/fixtures/color-profiles/swatches-SRGB.png").convert("RGBA")
white = Image.new("RGBA", source.size, (255, 255, 255, 255))
rgb = Image.alpha_composite(white, source).convert("RGB")
transform = ImageCms.buildTransformFromOpenProfiles(
    ImageCms.ImageCmsProfile(str(directory / "source-rgb.icc")),
    ImageCms.ImageCmsProfile(sys.argv[1]), "RGB", "CMYK",
    renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
    flags=ImageCms.Flags.BLACKPOINTCOMPENSATION,
)
expected = ImageCms.applyTransform(rgb, transform)
actual = (directory / "converted-cmyk.bin").read_bytes()
reference = expected.tobytes()
assert len(actual) == len(reference)
differences = [abs(a - b) for a, b in zip(actual, reference)]
result = {
    "referenceEngine": f"Pillow native LittleCMS {ImageCms.core.littlecms_version}",
    "pixels": list(source.size), "channels": 4,
    "renderingIntent": "relative colorimetric", "blackPointCompensation": True,
    "maxChannelDifferenceOutOf255": max(differences),
    "meanChannelDifferenceOutOf255": sum(differences) / len(differences),
    "exactChannelFraction": sum(value == 0 for value in differences) / len(differences),
}
(directory / "comparison-results.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
# Separate LittleCMS versions can differ at rounding boundaries.
assert max(differences) <= 2, "Inspect conversion differences before accepting this result."
