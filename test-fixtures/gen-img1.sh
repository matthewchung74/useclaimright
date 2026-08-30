#!/bin/sh
# Rebuilds IMG1's canonical image fixtures. macOS only — `sips` does the
# rotation, HEIC encoding and resampling, and there is no portable equivalent
# worth a dependency. The outputs are COMMITTED so the browser suite runs
# anywhere; you only need this when the source bill changes or a new edge case
# is worth adding.
#
#   sh test-fixtures/gen-img1.sh && node test-fixtures/gen-by-plan.mjs
#
# Each file exists to test one thing the image path can get wrong:
#   01 a clean scan, the control
#   02 sideways and 03 upside down — the reviewer must SEE it is wrong before
#      spending an audit, because the model cannot tell them
#   04 HEIC, Apple's camera default, which Chrome cannot decode at all
#   05 a portal screenshot, 06 a hurried low-res photo
#   07 a 12MP-class image, for payload size — nothing downscales before upload
#   08 a two-page document as separate images
set -e
cd "$(dirname "$0")"
mkdir -p img1
rm -f img1/*.png img1/*.heic

command -v pdftoppm >/dev/null || { echo "need poppler: brew install poppler" >&2; exit 1; }
command -v sips >/dev/null    || { echo "need macOS sips" >&2; exit 1; }

pdftoppm -png -r 150 fake-bill.pdf img1/tmp
mv img1/tmp-1.png img1/01-normal-scan.png

sips -r 90        img1/01-normal-scan.png --out img1/02-rotated-90.png      >/dev/null
sips -r 180       img1/01-normal-scan.png --out img1/03-upside-down.png     >/dev/null
sips -s format heic img1/01-normal-scan.png --out img1/04-iphone.heic       >/dev/null
sips -Z 900       img1/01-normal-scan.png --out img1/05-screenshot.png      >/dev/null
sips -Z 500       img1/01-normal-scan.png --out img1/06-low-res.png         >/dev/null
sips -z 3024 4032 img1/01-normal-scan.png --out img1/07-full-res-phone.png  >/dev/null
pdftoppm -png -r 150 fake-eob.pdf img1/08-eob-page

ls -1 img1 | sed 's/^/  /'
echo "Now run: node test-fixtures/gen-by-plan.mjs"
