#!/usr/bin/env python3
"""
Reads EXIF metadata straight from the original photos in _resources/images
and fills in the matching (currently-empty) fields in data/mosaic-items.json:
camera, shutter, aperture, iso, date, place.

Only overwrites a field if it is currently blank, so manually-entered story
text or corrections are never clobbered by re-running this.

The JSON's "src" may point at the webp copies (_resources/images-web),
which have their EXIF stripped by the ffmpeg conversion - so this script
always looks up the matching *original* file by basename to read metadata.
"""

import json
import sys
from datetime import datetime
from fractions import Fraction
from pathlib import Path

from PIL import ExifTags, Image

REPO_ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = REPO_ROOT / "data" / "mosaic-items.json"
ORIGINALS_DIR = REPO_ROOT / "_resources" / "images"
ORIGINAL_EXTENSIONS = [".jpg", ".jpeg", ".png"]


def find_original(basename):
    for ext in ORIGINAL_EXTENSIONS:
        candidate = ORIGINALS_DIR / f"{basename}{ext}"
        if candidate.exists():
            return candidate
        candidate = ORIGINALS_DIR / f"{basename}{ext.upper()}"
        if candidate.exists():
            return candidate
    # case-insensitive fallback scan
    lower_target = basename.lower()
    for f in ORIGINALS_DIR.iterdir():
        if f.stem.lower() == lower_target and f.suffix.lower() in ORIGINAL_EXTENSIONS:
            return f
    return None


def rational_to_float(value):
    try:
        if isinstance(value, tuple) and len(value) == 2:
            return value[0] / value[1] if value[1] else None
        return float(value)
    except (TypeError, ZeroDivisionError):
        return None


def format_shutter(exposure_time):
    val = rational_to_float(exposure_time)
    if not val:
        return ""
    if val >= 1:
        return f"{val:g}s"
    frac = Fraction(val).limit_denominator(8000)
    return f"1/{frac.denominator}s"


def format_aperture(f_number):
    val = rational_to_float(f_number)
    if not val:
        return ""
    return f"f/{val:g}"


def format_iso(iso_value):
    if not iso_value:
        return ""
    if isinstance(iso_value, (tuple, list)):
        iso_value = iso_value[0]
    return str(iso_value)


def format_date(date_str):
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str.strip(), "%Y:%m:%d %H:%M:%S")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return ""


def dms_to_decimal(dms, ref):
    try:
        degrees = rational_to_float(dms[0]) or 0
        minutes = rational_to_float(dms[1]) or 0
        seconds = rational_to_float(dms[2]) or 0
        decimal = degrees + minutes / 60 + seconds / 3600
        if ref in ("S", "W"):
            decimal = -decimal
        return decimal
    except (IndexError, TypeError):
        return None


def format_place(gps_ifd):
    if not gps_ifd:
        return ""
    lat = gps_ifd.get(2)
    lat_ref = gps_ifd.get(1)
    lon = gps_ifd.get(4)
    lon_ref = gps_ifd.get(3)
    if not (lat and lon and lat_ref and lon_ref):
        return ""
    lat_dec = dms_to_decimal(lat, lat_ref)
    lon_dec = dms_to_decimal(lon, lon_ref)
    if lat_dec is None or lon_dec is None:
        return ""
    return f"{lat_dec:.5f}, {lon_dec:.5f}"


def extract_metadata(path):
    result = {"camera": "", "shutter": "", "aperture": "", "iso": "", "date": "", "place": ""}
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            if not exif:
                return result

            make = (exif.get(271, "") or "").strip()
            model = (exif.get(272, "") or "").strip()
            if make and model.lower().startswith(make.lower()):
                camera = model
            else:
                camera = " ".join(part for part in (make, model) if part)
            result["camera"] = camera

            try:
                exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
            except (KeyError, AttributeError):
                exif_ifd = {}

            result["shutter"] = format_shutter(exif_ifd.get(33434))
            result["aperture"] = format_aperture(exif_ifd.get(33437))
            result["iso"] = format_iso(exif_ifd.get(34855) or exif_ifd.get(34867))
            result["date"] = format_date(exif_ifd.get(36867) or exif_ifd.get(36868))

            try:
                gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
            except (KeyError, AttributeError):
                gps_ifd = {}
            result["place"] = format_place(gps_ifd)
    except Exception as exc:  # noqa: BLE001 - best-effort metadata read
        print(f"  ! could not read EXIF from {path.name}: {exc}", file=sys.stderr)
    return result


def main():
    items = json.loads(JSON_PATH.read_text(encoding="utf-8"))

    updated_count = 0
    no_exif_count = 0
    missing_source = 0

    for item in items:
        basename = Path(item["src"]).stem
        original = find_original(basename)
        if not original:
            missing_source += 1
            continue

        meta = extract_metadata(original)
        if not any(meta.values()):
            no_exif_count += 1
            continue

        changed = False
        for field in ("camera", "shutter", "aperture", "iso", "date", "place"):
            if not item.get(field) and meta.get(field):
                item[field] = meta[field]
                changed = True
        if changed:
            updated_count += 1

    JSON_PATH.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Updated: {updated_count}/{len(items)}")
    print(f"No EXIF found: {no_exif_count}")
    print(f"Original source not found: {missing_source}")


if __name__ == "__main__":
    main()
