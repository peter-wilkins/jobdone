#!/usr/bin/env python3
"""
Generate a GRASS r.watershed flow-path PDF for the newer east-side Tump Farm
bounded area.

This deliberately uses the same GRASS-style flow-accumulation engine as the
JobDone Water Walk flow layer, rather than the quick local D8 diagnostic.
"""

from __future__ import annotations

import json
import math
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.path import Path as MplPath
from osgeo import gdal
from pyproj import Transformer

gdal.UseExceptions()

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "local/water-walk/tumptonics"
RUN_DIR = SITE_DIR / "west-grass-flow-paths"
ASSETS_DIR = ROOT / "docs/client-reports/assets"
OUT_DIR = ROOT / "docs/client-reports/out"

PDF_PATH = OUT_DIR / "tump-farm-west-grass-flow-paths.pdf"
PNG_PATH = ASSETS_DIR / "tump-farm-west-grass-flow-paths.png"
TRANSPARENT_PNG_PATH = ASSETS_DIR / "tump-farm-west-grass-flow-paths-transparent.png"
QA_PATH = ASSETS_DIR / "tump-farm-west-grass-flow-paths-qa.json"

DTM_COG = "https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dtm_32bit_cog.tif"
BNG = "EPSG:27700"
WGS84 = "EPSG:4326"

BOUNDARY_LAT_LON = [
    (51.664102010494766, -2.848804031109609),
    (51.667358853861025, -2.848167451871935),
    (51.66733156950478, -2.8451926834100747),
    (51.663226105761055, -2.8470582873533776),
]
OUTLET_LAT_LON = (51.66523997968142, -2.850045309084064)


def ensure_dirs() -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def transform_lat_lon(points: list[tuple[float, float]]) -> np.ndarray:
    transformer = Transformer.from_crs(WGS84, BNG, always_xy=True)
    lon = [p[1] for p in points]
    lat = [p[0] for p in points]
    east, north = transformer.transform(lon, lat)
    return np.column_stack([east, north]).astype(float)


def bng_to_lat_lon(easting: float, northing: float) -> tuple[float, float]:
    transformer = Transformer.from_crs(BNG, WGS84, always_xy=True)
    lon, lat = transformer.transform(easting, northing)
    return lat, lon


def padded_bounds(points_bng: np.ndarray, pad_m: float) -> tuple[float, float, float, float]:
    return (
        math.floor(points_bng[:, 0].min() - pad_m),
        math.floor(points_bng[:, 1].min() - pad_m),
        math.ceil(points_bng[:, 0].max() + pad_m),
        math.ceil(points_bng[:, 1].max() + pad_m),
    )


def polygon_area_m2(points_bng: np.ndarray) -> float:
    x = points_bng[:, 0]
    y = points_bng[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)


def convex_hull(points: np.ndarray) -> np.ndarray:
    ordered = sorted((float(x), float(y)) for x, y in points)
    if len(ordered) <= 1:
        return np.array(ordered, dtype=float)

    def cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for point in ordered:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: list[tuple[float, float]] = []
    for point in reversed(ordered):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return np.array(lower[:-1] + upper[:-1], dtype=float)


def run(command: list[str], cwd: Path | None = None) -> str:
    print("> " + " ".join(command))
    result = subprocess.run(
        command,
        cwd=str(cwd or ROOT),
        check=False,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "\n".join(part for part in [result.stdout, result.stderr] if part)
        )
    return result.stdout


def write_dem(bounds: tuple[float, float, float, float], resolution_m: int = 1) -> Path:
    dem_path = RUN_DIR / "dem-window.tif"
    width = int(math.ceil((bounds[2] - bounds[0]) / resolution_m))
    height = int(math.ceil((bounds[3] - bounds[1]) / resolution_m))
    gdal.SetConfigOption("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    gdal.SetConfigOption("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    source = gdal.Open("/vsicurl/" + DTM_COG)
    if source is None:
        raise RuntimeError("Could not open Welsh Government LiDAR DTM COG.")
    warped = gdal.Warp(
        str(dem_path),
        source,
        format="GTiff",
        dstSRS=BNG,
        outputBounds=bounds,
        width=width,
        height=height,
        resampleAlg="bilinear",
        creationOptions=["COMPRESS=DEFLATE"],
    )
    if warped is None:
        raise RuntimeError("Could not write DEM window.")
    warped = None
    source = None
    return dem_path


def write_snap_helper() -> Path:
    helper_path = RUN_DIR / "snap-outlet.py"
    helper_path.write_text(
        """#!/usr/bin/env python3
import json
import math
import sys
from osgeo import gdal

tif_path, east_s, north_s, radius_s, meta_path = sys.argv[1:6]
target_e = float(east_s)
target_n = float(north_s)
radius = float(radius_s)
dataset = gdal.Open(tif_path)
band = dataset.GetRasterBand(1)
array = band.ReadAsArray()
no_data = band.GetNoDataValue()
gt = dataset.GetGeoTransform()

best = None
nearest = None
for row in range(dataset.RasterYSize):
    for col in range(dataset.RasterXSize):
        value = float(array[row][col])
        if (no_data is not None and value == no_data) or math.isnan(value):
            continue
        east = gt[0] + (col + 0.5) * gt[1] + (row + 0.5) * gt[2]
        north = gt[3] + (col + 0.5) * gt[4] + (row + 0.5) * gt[5]
        distance = math.hypot(east - target_e, north - target_n)
        candidate = {
            "easting": east,
            "northing": north,
            "row": row,
            "col": col,
            "distanceMetres": distance,
            "accumulation": value,
        }
        if nearest is None or distance < nearest["distanceMetres"]:
            nearest = candidate
        if distance <= radius and (best is None or value > best["accumulation"]):
            best = candidate

if best is None:
    best = nearest

with open(meta_path, "w", encoding="utf-8") as handle:
    json.dump({
        "target": {"easting": target_e, "northing": target_n},
        "snapRadiusMetres": radius,
        "nearestCell": nearest,
        "snappedCell": best,
    }, handle, indent=2)
    handle.write("\\n")

print(f'{best["easting"]},{best["northing"]}')
"""
    )
    helper_path.chmod(0o755)
    return helper_path


def run_grass(dem_path: Path, outlet_bng: np.ndarray, snap_radius_m: int = 40) -> dict[str, Any]:
    accumulation_tif = RUN_DIR / "flow-accumulation.tif"
    catchment_tif = RUN_DIR / "outlet-catchment.tif"
    snapped_outlet_txt = RUN_DIR / "snapped-outlet.txt"
    snapped_outlet_json = RUN_DIR / "snapped-outlet.json"
    snap_helper = write_snap_helper()
    script = "\n".join(
        [
            "set -euo pipefail",
            f'r.in.gdal input="{dem_path}" output=dem --overwrite --quiet',
            "g.region raster=dem",
            "r.watershed -as elevation=dem accumulation=accumulation drainage=drainage basin=basin threshold=10 memory=600 --overwrite --quiet",
            f'r.out.gdal -f input=accumulation output="{accumulation_tif}" format=GTiff type=Float32 createopt="COMPRESS=DEFLATE" --overwrite --quiet',
            f'python3 "{snap_helper}" "{accumulation_tif}" "{outlet_bng[0]}" "{outlet_bng[1]}" "{snap_radius_m}" "{snapped_outlet_json}" > "{snapped_outlet_txt}"',
            f'SNAPPED_OUTLET="$(cat "{snapped_outlet_txt}")"',
            'echo "Snapped outlet: ${SNAPPED_OUTLET}"',
            f'r.water.outlet input=drainage output=outlet_catchment coordinates="$SNAPPED_OUTLET" --overwrite --quiet',
            f'r.out.gdal input=outlet_catchment output="{catchment_tif}" format=GTiff type=Byte createopt="COMPRESS=DEFLATE" --overwrite --quiet',
            'echo "__DEM__"',
            "r.univar -g map=dem",
            'echo "__ACCUMULATION__"',
            "r.univar -g map=accumulation",
            'echo "__CATCHMENT__"',
            "r.univar -g map=outlet_catchment",
        ]
    )
    output = run(["grass", "--tmp-project", BNG, "--exec", "bash", "-lc", script])
    return {
        "accumulationTif": str(accumulation_tif),
        "catchmentTif": str(catchment_tif),
        "snappedOutlet": json.loads(snapped_outlet_json.read_text()),
        "stats": parse_marked_grass_stats(output),
    }


def parse_marked_grass_stats(output: str) -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    current: str | None = None
    for line in output.splitlines():
        if line.startswith("__") and line.endswith("__"):
            current = line.strip("_").lower()
            stats[current] = {}
            continue
        if current is None or "=" not in line:
            continue
        key, value = line.split("=", 1)
        try:
            stats[current][key] = float(value)
        except ValueError:
            stats[current][key] = value
    return stats


def read_raster(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ds = gdal.Open(str(path))
    if ds is None:
        raise RuntimeError(f"Could not open {path}")
    arr = ds.ReadAsArray().astype(float)
    band = ds.GetRasterBand(1)
    no_data = band.GetNoDataValue()
    if no_data is not None:
        arr[arr == no_data] = np.nan
    gt = ds.GetGeoTransform()
    width = ds.RasterXSize
    height = ds.RasterYSize
    xs = gt[0] + (np.arange(width) + 0.5) * gt[1]
    ys = gt[3] + (np.arange(height) + 0.5) * gt[5]
    return arr, xs, ys


def area_mask(xs: np.ndarray, ys: np.ndarray, boundary_bng: np.ndarray) -> np.ndarray:
    xx, yy = np.meshgrid(xs, ys)
    path = MplPath(boundary_bng)
    return path.contains_points(np.column_stack([xx.ravel(), yy.ravel()])).reshape(xx.shape)


def draw_flow_paths(
    ax: plt.Axes,
    flow: np.ndarray,
    xs: np.ndarray,
    ys: np.ndarray,
    mask: np.ndarray,
    *,
    colour: str = "#0069ff",
    alpha: float = 0.9,
) -> None:
    flow_log = np.log1p(np.maximum(flow, 0))
    finite = flow_log[np.isfinite(flow_log) & mask]
    if finite.size == 0:
        return
    threshold = np.nanpercentile(finite, 84)
    vmax = np.nanpercentile(finite, 99.7)
    signal = np.clip((flow_log - threshold) / max(vmax - threshold, 1e-9), 0, 1)
    signal[~mask] = 0
    rgba = np.zeros(signal.shape + (4,), dtype=float)
    rgba[..., 0] = 0.0
    rgba[..., 1] = 0.42
    rgba[..., 2] = 1.0
    rgba[..., 3] = np.power(signal, 0.55) * alpha
    ax.imshow(
        rgba,
        extent=[xs.min(), xs.max(), ys.min(), ys.max()],
        origin="upper",
        interpolation="nearest",
        zorder=6,
    )


def draw_pdf_and_png(
    dem_path: Path,
    accumulation_tif: Path,
    catchment_tif: Path,
    original_boundary_bng: np.ndarray,
    extended_boundary_bng: np.ndarray,
    outlet_bng: np.ndarray,
    snapped_outlet: dict[str, Any],
    bounds: tuple[float, float, float, float],
) -> None:
    dem, xs, ys = read_raster(dem_path)
    flow, flow_xs, flow_ys = read_raster(accumulation_tif)
    catchment, catchment_xs, catchment_ys = read_raster(catchment_tif)
    mask = area_mask(flow_xs, flow_ys, extended_boundary_bng)

    fig = plt.figure(figsize=(16.54, 11.69), dpi=180)
    ax = fig.add_axes([0.04, 0.065, 0.92, 0.86])
    ax.set_title("Tump Farm west area — GRASS LiDAR outlet catchment", loc="left", fontsize=16, fontweight="bold", pad=10)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_xlim(bounds[0], bounds[2])
    ax.set_ylim(bounds[1], bounds[3])

    gy, gx = np.gradient(dem)
    shade = np.clip(0.58 - gx * 0.035 + gy * 0.045, 0.28, 0.93)
    ax.imshow(
        shade,
        extent=[xs.min(), xs.max(), ys.min(), ys.max()],
        cmap="Greys",
        origin="upper",
        alpha=0.22,
        zorder=0,
    )

    finite_dem = dem[np.isfinite(dem)]
    low = math.ceil(float(np.nanmin(finite_dem)) / 2) * 2
    high = math.floor(float(np.nanmax(finite_dem)) / 2) * 2
    if high > low:
        xx, yy = np.meshgrid(xs, ys)
        ax.contour(xx, yy, dem, levels=np.arange(low, high + 2, 2), colors="#8a8a8a", linewidths=0.35, alpha=0.68, zorder=1)

    catchment_mask = np.where(np.isfinite(catchment) & (catchment > 0), 1.0, np.nan)
    ax.imshow(
        catchment_mask,
        extent=[catchment_xs.min(), catchment_xs.max(), catchment_ys.min(), catchment_ys.max()],
        origin="upper",
        cmap="Wistia",
        alpha=0.22,
        interpolation="nearest",
        zorder=4,
    )
    draw_flow_paths(ax, flow, flow_xs, flow_ys, mask)
    original_closed = np.vstack([original_boundary_bng, original_boundary_bng[0]])
    extended_closed = np.vstack([extended_boundary_bng, extended_boundary_bng[0]])
    ax.plot(extended_closed[:, 0], extended_closed[:, 1], color="#111111", linewidth=1.3, linestyle="--", zorder=8)
    ax.plot(original_closed[:, 0], original_closed[:, 1], color="#111111", linewidth=1.9, zorder=9)
    ax.scatter([outlet_bng[0]], [outlet_bng[1]], marker="*", s=75, facecolor="#dc2626", edgecolor="white", linewidth=1.0, zorder=10)
    snapped = snapped_outlet["snappedCell"]
    ax.scatter([snapped["easting"]], [snapped["northing"]], marker="o", s=35, facecolor="#7c3aed", edgecolor="white", linewidth=0.9, zorder=10)

    bar_x = bounds[0] + 18
    bar_y = bounds[1] + 18
    ax.plot([bar_x, bar_x + 50], [bar_y, bar_y], color="black", linewidth=2.4)
    ax.text(bar_x, bar_y - 7, "0", ha="center", va="top", fontsize=8)
    ax.text(bar_x + 50, bar_y - 7, "50 m", ha="center", va="top", fontsize=8)
    ax.annotate("", xy=(bounds[2] - 24, bounds[3] - 22), xytext=(bounds[2] - 24, bounds[3] - 64), arrowprops={"arrowstyle": "-|>", "lw": 1.8, "color": "black"})
    ax.text(bounds[2] - 24, bounds[3] - 15, "N", ha="center", va="bottom", fontsize=11, fontweight="bold")
    ax.text(
        bounds[0],
        bounds[1] - 8,
        "DataMapWales/Welsh Government 1 m LiDAR DTM 32-bit COG; GRASS r.watershed + r.water.outlet. Yellow shows DEM outlet catchment; blue shows modelled surface-flow concentration.",
        fontsize=7,
        ha="left",
        va="top",
        color="#333333",
    )

    fig.savefig(PDF_PATH)
    fig.savefig(PNG_PATH)
    plt.close(fig)

    fig = plt.figure(figsize=(flow.shape[1] / 100, flow.shape[0] / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(bounds[0], bounds[2])
    ax.set_ylim(bounds[1], bounds[3])
    ax.axis("off")
    draw_flow_paths(ax, flow, flow_xs, flow_ys, mask, colour="#0077ff", alpha=0.92)
    fig.savefig(TRANSPARENT_PNG_PATH, transparent=True, pad_inches=0)
    plt.close(fig)


def write_qa(
    dem_path: Path,
    accumulation_tif: Path,
    catchment_tif: Path,
    bounds: tuple[float, float, float, float],
    original_boundary_bng: np.ndarray,
    extended_boundary_bng: np.ndarray,
    outlet_bng: np.ndarray,
    grass: dict[str, Any],
) -> None:
    corners = [
        bng_to_lat_lon(bounds[0], bounds[1]),
        bng_to_lat_lon(bounds[2], bounds[1]),
        bng_to_lat_lon(bounds[2], bounds[3]),
        bng_to_lat_lon(bounds[0], bounds[3]),
    ]
    qa = {
        "siteId": "tumptonics-west",
        "engine": "grass",
        "source": "DataMapWales/Welsh Government LiDAR DTM 32-bit COG",
        "sourceUrl": DTM_COG,
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "boundaryLatLon": BOUNDARY_LAT_LON,
        "outletLatLon": OUTLET_LAT_LON,
        "outletBng": {
            "easting": float(outlet_bng[0]),
            "northing": float(outlet_bng[1]),
        },
        "snappedOutlet": grass["snappedOutlet"],
        "originalBoundaryAreaM2": polygon_area_m2(original_boundary_bng),
        "originalBoundaryAreaHa": polygon_area_m2(original_boundary_bng) / 10000,
        "extendedBoundaryLatLon": [
            list(bng_to_lat_lon(float(point[0]), float(point[1]))) for point in extended_boundary_bng
        ],
        "extendedBoundaryAreaM2": polygon_area_m2(extended_boundary_bng),
        "extendedBoundaryAreaHa": polygon_area_m2(extended_boundary_bng) / 10000,
        "boundsBng": {
            "minE": bounds[0],
            "minN": bounds[1],
            "maxE": bounds[2],
            "maxN": bounds[3],
        },
        "boundsLatLon": {
            "south": min(lat for lat, _ in corners),
            "west": min(lon for _, lon in corners),
            "north": max(lat for lat, _ in corners),
            "east": max(lon for _, lon in corners),
        },
        "outputs": {
            "dem": str(dem_path),
            "flowAccumulationRaster": str(accumulation_tif),
            "catchmentRaster": str(catchment_tif),
            "pdf": str(PDF_PATH),
            "png": str(PNG_PATH),
            "transparentPng": str(TRANSPARENT_PNG_PATH),
        },
        "stats": grass["stats"],
        "notes": [
            "This is GRASS r.watershed flow accumulation plus r.water.outlet for the supplied spring/outlet point.",
            "The dashed boundary is the minimal convex extension needed to include the outlet point.",
        ],
    }
    text = json.dumps(qa, indent=2) + "\n"
    (RUN_DIR / "qa.json").write_text(text)
    QA_PATH.write_text(text)


def main() -> None:
    ensure_dirs()
    original_boundary_bng = transform_lat_lon(BOUNDARY_LAT_LON)
    outlet_bng = transform_lat_lon([OUTLET_LAT_LON])[0]
    extended_boundary_bng = convex_hull(np.vstack([original_boundary_bng, outlet_bng]))
    bounds = padded_bounds(extended_boundary_bng, pad_m=45)
    dem_path = write_dem(bounds, resolution_m=1)
    grass = run_grass(dem_path, outlet_bng)
    accumulation_tif = Path(grass["accumulationTif"])
    catchment_tif = Path(grass["catchmentTif"])
    draw_pdf_and_png(
        dem_path,
        accumulation_tif,
        catchment_tif,
        original_boundary_bng,
        extended_boundary_bng,
        outlet_bng,
        grass["snappedOutlet"],
        bounds,
    )
    write_qa(
        dem_path,
        accumulation_tif,
        catchment_tif,
        bounds,
        original_boundary_bng,
        extended_boundary_bng,
        outlet_bng,
        grass,
    )
    print(json.dumps({
        "pdf": str(PDF_PATH),
        "png": str(PNG_PATH),
        "transparentPng": str(TRANSPARENT_PNG_PATH),
        "qa": str(QA_PATH),
    }, indent=2))


if __name__ == "__main__":
    main()
