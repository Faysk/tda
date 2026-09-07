"""Prepare the two reviewed local packs. No network, uploads, or code execution."""
import argparse
import hashlib
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

PACKS = {
    "pipipi-lore-premium": [f"assets/{name}.webp" for name in
        ["pipipi", "casa", "corredores", "super_herois", "cadeira", "ultimo_dia", "acordou"]],
    "parallax_art_demo": [f"parallax_art_demo/assets/{name}.svg" for name in
        ["00-sky", "01-mountains", "02-castle", "03-fog-back", "04-crowd", "05-hero", "06-foreground", "07-fog-front"]],
}
TAGS = {"svg", "defs", "filter", "feTurbulence", "feColorMatrix", "feGaussianBlur", "linearGradient", "radialGradient", "stop", "mask", "rect", "path", "circle", "ellipse", "g", "feOffset", "feMerge", "feMergeNode"}
def digest(data):
    return hashlib.sha256(data).hexdigest()

def check_svg(data):
    text = data.decode("utf-8")
    if re.search(r"<!|<\?", text):
        raise ValueError("SVG declarations are outside this reviewed profile")
    root = ET.fromstring(text)
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("Not SVG")
    ids = {el.attrib["id"] for el in root.iter() if "id" in el.attrib}
    for el in root.iter():
        if el.tag.removeprefix("{http://www.w3.org/2000/svg}") not in TAGS:
            raise ValueError("SVG element outside reviewed static profile")
        for key, value in el.attrib.items():
            if key.lower().startswith("on") or "href" in key.lower() or key == "style":
                raise ValueError("SVG active/reference attribute")
            if re.search(r"(?:https?:|data:|javascript:|@import)", value, re.I):
                raise ValueError("SVG external resource")
            if "\\" in value:
                raise ValueError("Escaped SVG resource syntax")
            for ref in re.findall(r"url\s*\((.*?)\)", value, re.I):
                if not ref.startswith("#") or ref[1:] not in ids:
                    raise ValueError("SVG unresolved/nonlocal resource")
    viewbox = [float(n) for n in root.attrib["viewBox"].split()]
    if viewbox != [0, 0, 1920, 1080]:
        raise ValueError("Unexpected layer canvas")
    return {"mime": "image/svg+xml", "width": 1920, "height": 1080,
            "svgValidation": "static-profile-local-references-only"}

def prepare(downloads, output):
    output.mkdir(parents=True, exist_ok=True)
    packages = []
    for name, selected in PACKS.items():
        archive = downloads / f"{name}.zip"
        package = {"packageId": name, "archiveName": archive.name,
                   "archiveSha256": digest(archive.read_bytes()), "assets": []}
        with zipfile.ZipFile(archive) as bundle:
            if len(bundle.namelist()) != len(set(bundle.namelist())):
                raise ValueError("Duplicate archive entry")
            for member in selected:
                info = bundle.getinfo(member)
                if info.file_size > 16 * 1024 * 1024:
                    raise ValueError("Asset too large")
                data = bundle.read(member)
                local = Path(name) / Path(member).name
                dest = output / local
                dest.parent.mkdir(exist_ok=True)
                if dest.exists():
                    if dest.read_bytes() != data:
                        raise ValueError("Local asset collision")
                else:
                    with dest.open("xb") as handle:
                        handle.write(data)
                asset = {"assetId": Path(member).stem, "sourceEntry": member,
                         "localPath": local.as_posix(), "filename": Path(member).name,
                         "bytes": len(data), "sha256": digest(data)}
                if member.endswith(".svg"):
                    asset.update(check_svg(data))
                package["assets"].append(asset)
            package["excludedEntries"] = [i.filename for i in bundle.infolist()
                                          if not i.is_dir() and i.filename not in selected]
        package["assetSetSha256"] = digest("\n".join(
            f"{a['filename']}:{a['sha256']}" for a in sorted(package["assets"], key=lambda a: a["filename"])
        ).encode())
        packages.append(package)
    (output / "prepared.json").write_text(json.dumps({"schemaVersion": 1, "packages": packages}, indent=2) + "\n", encoding="utf-8")
    print("LOCAL_PACKS_PREPARED 7 WebP + 8 SVG; no upload")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--downloads", type=Path, default=Path.home() / "Downloads")
    parser.add_argument("--output", type=Path, default=Path(".local/lore-assets"))
    args = parser.parse_args()
    prepare(args.downloads, args.output)
