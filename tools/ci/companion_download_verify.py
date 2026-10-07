"""Verify the same-origin MSI delivery without allowing redirects."""
import argparse
import hashlib
import json
import re
import time
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_download(opener, url, expected_size, expected_sha):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with opener.open(request, timeout=60) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError("STABLE_DOWNLOAD_NOT_DIRECT")
        if response.headers.get("Content-Length") != str(expected_size):
            raise ValueError("STABLE_DOWNLOAD_LENGTH_INVALID")
        disposition = response.headers.get("Content-Disposition", "").lower()
        if "attachment" not in disposition or "tdacompanion-x64.msi" not in disposition:
            raise ValueError("STABLE_DOWNLOAD_DISPOSITION_INVALID")
        digest = hashlib.sha256()
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > expected_size:
                raise ValueError("STABLE_DOWNLOAD_OVERSIZED")
            digest.update(chunk)
        if total != expected_size or digest.hexdigest() != expected_sha:
            raise ValueError("STABLE_DOWNLOAD_BYTES_INVALID")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--candidate-manifest", required=True)
    parser.add_argument("--promotion-manifest", required=True)
    args = parser.parse_args()
    match = re.fullmatch(r"companion-v(\d+\.\d+\.\d+)", args.tag)
    if not match:
        raise ValueError("STABLE_TAG_INVALID")
    with open(args.candidate_manifest, encoding="utf-8") as source:
        candidate = json.load(source)
    with open(args.promotion_manifest, encoding="utf-8") as source:
        promotion = json.load(source)
    version = match.group(1)
    expected_size = candidate["assets"]["msi"]["size"]
    expected_sha = promotion["assets"]["msi"]["sha256"]
    if (candidate["version"] != version or promotion["stable_tag"] != args.tag
            or candidate["assets"]["msi"]["sha256"] != expected_sha):
        raise ValueError("STABLE_MANIFEST_IDENTITY_INVALID")
    opener = urllib.request.build_opener(NoRedirect)
    base = "https://dnd.faysk.dev/api/downloads/companion/windows"
    for attempt in range(12):
        with opener.open(urllib.request.Request(base + "/manifest", headers={
            "Cache-Control": "no-cache", "Accept": "application/json"}), timeout=30) as response:
            value = json.load(response)
        asset = value.get("asset", {})
        if (value.get("channel") == "stable" and value.get("tag") == args.tag
                and value.get("version") == version and asset.get("size") == expected_size
                and asset.get("sha256") == expected_sha):
            break
        if attempt == 11:
            raise ValueError("CANONICAL_WEB_STABLE_MANIFEST_MISMATCH")
        time.sleep(5)
    for suffix in ("", "?tag=" + args.tag):
        verify_download(opener, base + suffix, expected_size, expected_sha)
    print("CANONICAL_WEB_STABLE_VERIFIED tag=" + args.tag + " sha256=" + expected_sha)


if __name__ == "__main__":
    main()
