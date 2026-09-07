#!/bin/bash
# Resilient resumable download for the Zenodo test-set archive: retries with
# -C - (resume) on any failure, including mid-transfer connection drops that
# curl's own --retry doesn't always catch, until the file is fully complete.
set -u
cd "$(dirname "$0")/../data/raw/zenodo_part3"
URL="https://zenodo.org/records/13761290/files/02_Test_images_and_ground_truth.7z?download=1"
FILE="02_Test_images_and_ground_truth.7z"
TARGET_SIZE=9859650011

while true; do
  current=$(stat -c%s "$FILE" 2>/dev/null || echo 0)
  if [ "$current" -ge "$TARGET_SIZE" ]; then
    echo "DOWNLOAD_COMPLETE size=$current"
    break
  fi
  echo "resuming from $current bytes..."
  curl -L -C - -o "$FILE" "$URL" --retry 5 --retry-delay 3 --connect-timeout 20
  code=$?
  echo "curl exited with code $code, sleeping 5s before retry check"
  sleep 5
done
