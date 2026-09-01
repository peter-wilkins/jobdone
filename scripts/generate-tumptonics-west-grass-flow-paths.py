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


def run_grass(dem_path: Path) -> dict[str, Any]:
    accumulation_tif = RUN_DIR / "flow-accumulation.tif"
    script = "\n".join(
        [
            "set -euo pipefail",
            f'r.in.gdal input="{dem_path}" output=dem --overwrite --quiet',
            "g.region raster=dem",
            "r.watershed -as elevation=dem accumulation=accumulation drainage=drainage basin=basin threshold=10 memory=600 --overwrite --quiet",
            f'r.out.gdal -f input=accumulation output="{accumulation_tif}" format=GTiff type=Float32 createopt="COMPRESS=DEFLATE" --overwrite --quiet',
            'echo "__DEM__"',
            "r.univar -g map=dem",
            'echo "__ACCUMULATION__"',
            "r.univar -g map=accumulation",
        ]
    )
    output = run(["grass", "--tmp-project", BNG, "--exec", "bash", "-lc", script])
    return {
        "accumulationTif": str(accumulation_tif),
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
    boundary_bng: np.ndarray,
    bounds: tuple[float, float, float, float],
) -> None:
    dem, xs, ys = read_raster(dem_path)
    flow, flow_xs, flow_ys = read_raster(accumulation_tif)
    mask = area_mask(flow_xs, flow_ys, boundary_bng)

    fig = plt.figure(figsize=(16.54, 11.69), dpi=180)
    ax = fig.add_axes([0.04, 0.065, 0.92, 0.86])
    ax.set_title("Tump Farm west area — GRASS LiDAR flow paths", loc="left", fontsize=16, fontweight="bold", pad=10)
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

    draw_flow_paths(ax, flow, flow_xs, flow_ys, mask)
    closed = np.vstack([boundary_bng, boundary_bng[0]])
    ax.plot(closed[:, 0], closed[:, 1], color="#111111", linewidth=1.9, zorder=9)

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
        "DataMapWales/Welsh Government 1 m LiDAR DTM 32-bit COG; GRASS r.watershed flow accumulation. Blue paths show modelled surface-flow concentration, not proven spring recharge.",
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
    bounds: tuple[float, float, float, float],
    boundary_bng: np.ndarray,
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
        "boundaryAreaM2": polygon_area_m2(boundary_bng),
        "boundaryAreaHa": polygon_area_m2(boundary_bng) / 10000,
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
            "pdf": str(PDF_PATH),
            "png": str(PNG_PATH),
            "transparentPng": str(TRANSPARENT_PNG_PATH),
        },
        "stats": grass["stats"],
        "notes": [
            "This is GRASS r.watershed flow accumulation for the bounded area.",
            "No outlet catchment was calculated because this polygon request did not define an outlet point.",
        ],
    }
    text = json.dumps(qa, indent=2) + "\n"
    (RUN_DIR / "qa.json").write_text(text)
    QA_PATH.write_text(text)


def main() -> None:
    ensure_dirs()
    boundary_bng = transform_lat_lon(BOUNDARY_LAT_LON)
    bounds = padded_bounds(boundary_bng, pad_m=45)
    dem_path = write_dem(bounds, resolution_m=1)
    grass = run_grass(dem_path)
    accumulation_tif = Path(grass["accumulationTif"])
    draw_pdf_and_png(dem_path, accumulation_tif, boundary_bng, bounds)
    write_qa(dem_path, accumulation_tif, bounds, boundary_bng, grass)
    print(json.dumps({
        "pdf": str(PDF_PATH),
        "png": str(PNG_PATH),
        "transparentPng": str(TRANSPARENT_PNG_PATH),
        "qa": str(QA_PATH),
    }, indent=2))


if __name__ == "__main__":
    main()
