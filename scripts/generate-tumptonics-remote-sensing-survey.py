#!/usr/bin/env python3
"""
Generate a first-pass remote-sensing field survey plan for Tump Farm.

Inputs:
- Existing local LiDAR DEM/flow accumulation from the spring-catchment work.
- Public Sentinel-2 L2A COGs from Element84 Earth Search.
- The guessed workable boundary GeoJSON supplied for the site.

Outputs:
- Numbered infiltration-test points as GeoJSON/JSON.
- A map PNG combining land-condition zones and LiDAR flow accumulation.
- A short HTML report suitable for PDF export.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import subprocess
import warnings
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import requests
from matplotlib.colors import ListedColormap
from matplotlib.path import Path as MplPath
from osgeo import gdal
from pyproj import Transformer


ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "local/water-walk/tumptonics"
LIDAR_DIR = SITE_DIR / "spring-catchment-2m"
OUT_DIR = SITE_DIR / "remote-sensing-survey"
CACHE_DIR = OUT_DIR / "sentinel-cache"
DOCS_DIR = ROOT / "docs/client-reports"
ASSET_DIR = DOCS_DIR / "assets"
PDF_DIR = DOCS_DIR / "out"

BOUNDARY_PATH = SITE_DIR / "workable-boundary.geojson"
SPRING_PATH = LIDAR_DIR / "spring.geojson"
FLOW_PATH = LIDAR_DIR / "flow-accumulation.tif"
DEM_PATH = LIDAR_DIR / "dem-window.asc"

MAP_ASSET = ASSET_DIR / "tumptonics-remote-sensing-infiltration-map.png"
REPORT_HTML = DOCS_DIR / "tumptonics-remote-sensing-infiltration-survey.html"
REPORT_PDF = PDF_DIR / "tumptonics-remote-sensing-infiltration-survey.pdf"
POINTS_GEOJSON = OUT_DIR / "infiltration-test-points.geojson"
ANALYSIS_JSON = OUT_DIR / "analysis.json"

TARGET_SRS = "EPSG:27700"
PIXEL_SIZE_M = 10
SENTINEL_START = "2024-01-01T00:00:00Z"
SENTINEL_END = "2025-12-31T23:59:59Z"
MAX_SCENES = 4
MIN_SCENE_GAP_DAYS = 90


def read_geojson(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def feature_coords(feature_collection: dict[str, Any]) -> list[tuple[float, float]]:
    geom = feature_collection["features"][0]["geometry"]
    if geom["type"] == "Point":
        lon, lat = geom["coordinates"]
        return [(lon, lat)]
    if geom["type"] == "Polygon":
        return [(lon, lat) for lon, lat in geom["coordinates"][0]]
    raise ValueError(f"Unsupported geometry: {geom['type']}")


def transform_points(points: list[tuple[float, float]], src: str, dst: str) -> np.ndarray:
    transformer = Transformer.from_crs(src, dst, always_xy=True)
    xs, ys = transformer.transform([p[0] for p in points], [p[1] for p in points])
    return np.column_stack([xs, ys])


def output_grid(boundary_bng: np.ndarray, padding_m: int = 50) -> tuple[list[float], int, int]:
    min_e = math.floor((boundary_bng[:, 0].min() - padding_m) / PIXEL_SIZE_M) * PIXEL_SIZE_M
    max_e = math.ceil((boundary_bng[:, 0].max() + padding_m) / PIXEL_SIZE_M) * PIXEL_SIZE_M
    min_n = math.floor((boundary_bng[:, 1].min() - padding_m) / PIXEL_SIZE_M) * PIXEL_SIZE_M
    max_n = math.ceil((boundary_bng[:, 1].max() + padding_m) / PIXEL_SIZE_M) * PIXEL_SIZE_M
    width = int(round((max_e - min_e) / PIXEL_SIZE_M))
    height = int(round((max_n - min_n) / PIXEL_SIZE_M))
    return [min_e, min_n, max_e, max_n], width, height


def grid_centres(bounds: list[float], width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    min_e, min_n, max_e, max_n = bounds
    xs = min_e + (np.arange(width) + 0.5) * PIXEL_SIZE_M
    ys = max_n - (np.arange(height) + 0.5) * PIXEL_SIZE_M
    return np.meshgrid(xs, ys)


def mask_for_boundary(boundary_bng: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    path = MplPath(boundary_bng)
    pts = np.column_stack([xs.ravel(), ys.ravel()])
    return path.contains_points(pts).reshape(xs.shape)


def stac_search(boundary_wgs84: list[tuple[float, float]]) -> list[dict[str, Any]]:
    lons = [p[0] for p in boundary_wgs84]
    lats = [p[1] for p in boundary_wgs84]
    bbox = [min(lons) - 0.002, min(lats) - 0.002, max(lons) + 0.002, max(lats) + 0.002]
    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": bbox,
        "datetime": f"{SENTINEL_START}/{SENTINEL_END}",
        "query": {"eo:cloud_cover": {"lt": 15}},
        "limit": 100,
        "sortby": [{"field": "properties.datetime", "direction": "asc"}],
    }
    response = requests.post("https://earth-search.aws.element84.com/v1/search", json=body, timeout=30)
    response.raise_for_status()
    items = response.json().get("features", [])

    selected: list[dict[str, Any]] = []
    last_date: dt.date | None = None
    for item in items:
        date = dt.datetime.fromisoformat(item["properties"]["datetime"].replace("Z", "+00:00")).date()
        if last_date is not None and (date - last_date).days < MIN_SCENE_GAP_DAYS:
            continue
        selected.append(item)
        last_date = date
        if len(selected) >= MAX_SCENES:
            break
    return selected


def read_asset_to_grid(href: str, bounds: list[float], width: int, height: int, alg: str) -> np.ndarray:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = href.rsplit("/", 2)[-2] + "-" + href.rsplit("/", 1)[-1].replace(".tif", f"-{width}x{height}.npy")
    cache_path = CACHE_DIR / cache_key
    if cache_path.exists():
        return np.load(cache_path)

    gdal.SetConfigOption("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    gdal.SetConfigOption("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    ds = gdal.Open("/vsicurl/" + href)
    if ds is None:
        raise RuntimeError(f"Could not open Sentinel asset: {href}")
    warped = gdal.Warp(
        "",
        ds,
        format="MEM",
        dstSRS=TARGET_SRS,
        outputBounds=bounds,
        width=width,
        height=height,
        resampleAlg=alg,
    )
    if warped is None:
        raise RuntimeError(f"Could not warp Sentinel asset: {href}")
    arr = warped.ReadAsArray().astype(np.float32)
    np.save(cache_path, arr)
    return arr


def read_local_raster_to_grid(path: Path, bounds: list[float], width: int, height: int, alg: str) -> np.ndarray:
    ds = gdal.Open(str(path))
    if ds is None:
        raise RuntimeError(f"Could not open raster: {path}")
    warped = gdal.Warp(
        "",
        ds,
        format="MEM",
        dstSRS=TARGET_SRS,
        outputBounds=bounds,
        width=width,
        height=height,
        resampleAlg=alg,
    )
    if warped is None:
        raise RuntimeError(f"Could not warp raster: {path}")
    return warped.ReadAsArray().astype(np.float32)


def sentinel_indices(items: list[dict[str, Any]], bounds: list[float], width: int, height: int, site_mask: np.ndarray):
    ndvi_layers = []
    ndmi_layers = []
    used = []
    skipped = []
    for item in items:
        props = item["properties"]
        date = props["datetime"][:10]
        assets = item["assets"]
        try:
            red = read_asset_to_grid(assets["red"]["href"], bounds, width, height, "bilinear")
            nir = read_asset_to_grid(assets["nir"]["href"], bounds, width, height, "bilinear")
            swir = read_asset_to_grid(assets["swir16"]["href"], bounds, width, height, "bilinear")
        except Exception as exc:
            skipped.append({"date": date, "reason": str(exc)})
            continue

        valid = site_mask & (red > 0) & (nir > 0) & (swir > 0)
        if valid.sum() < max(10, int(site_mask.sum() * 0.35)):
            skipped.append({"date": date, "reason": "too few clear pixels inside workable boundary"})
            continue

        ndvi = (nir - red) / np.maximum(nir + red, 1)
        ndmi = (nir - swir) / np.maximum(nir + swir, 1)
        ndvi[~valid] = np.nan
        ndmi[~valid] = np.nan
        ndvi_layers.append(ndvi)
        ndmi_layers.append(ndmi)
        used.append(
            {
                "id": item["id"],
                "date": date,
                "cloudCover": round(float(props.get("eo:cloud_cover", 0)), 1),
                "sitePixels": int(valid.sum()),
            }
        )

    if len(used) < 3:
        raise RuntimeError(f"Only {len(used)} usable Sentinel scenes found; skipped={skipped}")

    ndvi_stack = np.stack(ndvi_layers)
    ndmi_stack = np.stack(ndmi_layers)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        ndvi_median = np.nanmedian(ndvi_stack, axis=0)
        ndmi_median = np.nanmedian(ndmi_stack, axis=0)
        ndvi_std = np.nanstd(ndvi_stack, axis=0)
        ndmi_std = np.nanstd(ndmi_stack, axis=0)
    return {
        "ndviMedian": ndvi_median,
        "ndmiMedian": ndmi_median,
        "ndviStd": ndvi_std,
        "ndmiStd": ndmi_std,
        "usedScenes": used,
        "skippedScenes": skipped,
    }


def standardise(values: np.ndarray) -> np.ndarray:
    mean = np.nanmean(values, axis=0)
    std = np.nanstd(values, axis=0)
    std[std == 0] = 1
    return (values - mean) / std


def kmeans(features: np.ndarray, k: int = 5, iterations: int = 60) -> np.ndarray:
    rng = np.random.default_rng(42)
    first_axis = features[:, 0]
    seeds = []
    for q in np.linspace(0.05, 0.95, k):
        target = np.quantile(first_axis, q)
        idx = int(np.argmin(np.abs(first_axis - target)))
        seeds.append(features[idx])
    centres = np.array(seeds)
    centres += rng.normal(0, 0.01, centres.shape)

    labels = np.zeros(features.shape[0], dtype=np.int16)
    for _ in range(iterations):
        dist = ((features[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
        new_labels = dist.argmin(axis=1).astype(np.int16)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
        for label in range(k):
            rows = features[labels == label]
            if len(rows):
                centres[label] = rows.mean(axis=0)
    return labels


def classify_zones(indices: dict[str, Any], site_mask: np.ndarray) -> tuple[np.ndarray, list[dict[str, Any]]]:
    ndvi = indices["ndviMedian"]
    ndmi = indices["ndmiMedian"]
    ndvi_std = indices["ndviStd"]
    valid = site_mask & np.isfinite(ndvi) & np.isfinite(ndmi) & np.isfinite(ndvi_std)
    raw = np.column_stack([ndvi[valid], ndmi[valid], ndvi_std[valid]])
    labels = kmeans(standardise(raw), k=5)

    zone_grid = np.full(site_mask.shape, -1, dtype=np.int16)
    zone_grid[valid] = labels

    summaries = []
    for label in range(5):
        mask = zone_grid == label
        med_ndvi = float(np.nanmedian(ndvi[mask]))
        med_ndmi = float(np.nanmedian(ndmi[mask]))
        med_std = float(np.nanmedian(ndvi_std[mask]))
        summaries.append(
            {
                "id": int(label),
                "pixels": int(mask.sum()),
                "ndviMedian": round(med_ndvi, 3),
                "ndmiMedian": round(med_ndmi, 3),
                "ndviStd": round(med_std, 3),
            }
        )

    ndvi_values = np.array([z["ndviMedian"] for z in summaries])
    ndmi_values = np.array([z["ndmiMedian"] for z in summaries])
    std_values = np.array([z["ndviStd"] for z in summaries])
    condition_rank = np.argsort(ndvi_values + ndmi_values)
    wet_rank = np.argsort(ndmi_values)
    variable_rank = np.argsort(std_values)

    for z in summaries:
        label = z["id"]
        if label == int(condition_rank[0]):
            name = "weaker / drier vegetation"
        elif label == int(condition_rank[-1]):
            name = "vigorous / moist vegetation"
        elif label == int(variable_rank[-1]):
            name = "seasonally variable vegetation"
        elif label == int(wet_rank[-1]):
            name = "persistent moisture signal"
        else:
            name = "mixed pasture condition"
        z["name"] = name
    return zone_grid, summaries


def percentile_mask(values: np.ndarray, site_mask: np.ndarray, percentile: float, high: bool) -> np.ndarray:
    finite = site_mask & np.isfinite(values)
    cutoff = np.nanpercentile(values[finite], percentile)
    return finite & ((values >= cutoff) if high else (values <= cutoff))


def select_test_points(
    xs: np.ndarray,
    ys: np.ndarray,
    site_mask: np.ndarray,
    zone_grid: np.ndarray,
    zone_summaries: list[dict[str, Any]],
    indices: dict[str, Any],
    flow: np.ndarray,
    spring_bng: tuple[float, float],
) -> list[dict[str, Any]]:
    ndvi = indices["ndviMedian"]
    ndmi = indices["ndmiMedian"]
    ndvi_std = indices["ndviStd"]
    flow_log = np.log1p(np.maximum(flow, 0))
    valid = site_mask & np.isfinite(ndvi) & np.isfinite(ndmi) & np.isfinite(ndvi_std) & np.isfinite(flow_log)

    condition = standardise(np.column_stack([ndvi[valid], ndmi[valid]])).sum(axis=1)
    condition_grid = np.full(site_mask.shape, np.nan, dtype=np.float32)
    condition_grid[valid] = condition

    high_flow = percentile_mask(flow_log, valid, 75, True)
    low_flow = percentile_mask(flow_log, valid, 35, False)
    poor = percentile_mask(condition_grid, valid, 30, False)
    good = percentile_mask(condition_grid, valid, 70, True)

    selected: list[dict[str, Any]] = []

    def far_enough(row: int, col: int, min_dist_m: float = 24) -> bool:
        for point in selected:
            dx = xs[row, col] - point["easting"]
            dy = ys[row, col] - point["northing"]
            if math.hypot(dx, dy) < min_dist_m:
                return False
        return True

    def pick(mask: np.ndarray, score: np.ndarray, reason: str, min_dist_m: float = 24) -> None:
        candidates = np.argwhere(mask & np.isfinite(score))
        if len(candidates) == 0:
            return
        order = np.argsort(score[mask & np.isfinite(score)])[::-1]
        candidate_rows = candidates[order]
        for row, col in candidate_rows:
            row = int(row)
            col = int(col)
            if far_enough(row, col, min_dist_m):
                add_point(row, col, reason)
                return

    def add_point(row: int, col: int, reason: str) -> None:
        zone_id = int(zone_grid[row, col])
        zone = next((z for z in zone_summaries if z["id"] == zone_id), {"name": "unknown"})
        selected.append(
            {
                "id": f"T{len(selected) + 1:02d}",
                "easting": float(xs[row, col]),
                "northing": float(ys[row, col]),
                "zoneId": zone_id,
                "zone": zone["name"],
                "flowAccumulation": float(flow[row, col]),
                "ndviMedian": float(ndvi[row, col]),
                "ndmiMedian": float(ndmi[row, col]),
                "ndviStd": float(ndvi_std[row, col]),
                "reason": reason,
            }
        )

    pick(high_flow & poor, flow_log - condition_grid, "High predicted convergence with weaker/drier vegetation.")
    pick(high_flow & good, flow_log + condition_grid, "High predicted convergence with vigorous/moist vegetation.")
    pick(low_flow & poor, -condition_grid - flow_log, "Low-flow hillslope with weaker/drier vegetation.")
    pick(low_flow & good, condition_grid - flow_log, "Low-flow hillslope with vigorous/moist vegetation.")
    pick(valid, ndmi, "Persistent moisture signal; investigate whether it is soil, vegetation or drainage.")
    pick(valid, ndvi_std, "Seasonally variable vegetation; useful check on management or moisture sensitivity.")

    # Paired comparison across the sharpest adjacent zone/condition boundary.
    boundary_candidates = []
    for dy, dx in [(0, 1), (1, 0)]:
        a = zone_grid[:-dy or None, :-dx or None]
        b = zone_grid[dy:, dx:]
        different = (a >= 0) & (b >= 0) & (a != b)
        rows, cols = np.where(different)
        for row, col in zip(rows, cols):
            r2 = row + dy
            c2 = col + dx
            diff = abs(float(condition_grid[row, col]) - float(condition_grid[r2, c2]))
            if math.isfinite(diff):
                boundary_candidates.append((diff, int(row), int(col), int(r2), int(c2)))
    boundary_candidates.sort(reverse=True)
    for _, r1, c1, r2, c2 in boundary_candidates[:200]:
        step_r = r2 - r1
        step_c = c2 - c1
        core_a = (r1 - step_r * 2, c1 - step_c * 2)
        core_b = (r2 + step_r * 2, c2 + step_c * 2)
        if not (
            0 <= core_a[0] < zone_grid.shape[0]
            and 0 <= core_a[1] < zone_grid.shape[1]
            and 0 <= core_b[0] < zone_grid.shape[0]
            and 0 <= core_b[1] < zone_grid.shape[1]
            and zone_grid[core_a] == zone_grid[r1, c1]
            and zone_grid[core_b] == zone_grid[r2, c2]
            and valid[core_a]
            and valid[core_b]
        ):
            continue
        r1, c1 = core_a
        r2, c2 = core_b
        if far_enough(r1, c1, 18) and far_enough(r2, c2, 18):
            add_point(r1, c1, "Paired comparison across an apparent land-condition boundary, side A; placed into the zone core where possible.")
            add_point(r2, c2, "Paired comparison across an apparent land-condition boundary, side B; placed into the zone core where possible.")
            break

    spring_e, spring_n = spring_bng
    dist_to_spring = np.hypot(xs - spring_e, ys - spring_n)
    pick(valid & (dist_to_spring > 50), flow_log, "Highest local flow accumulation away from the spring exclusion zone.")

    # Fill to ten points with representatives from the largest remaining zones.
    for zone in sorted(zone_summaries, key=lambda z: z["pixels"], reverse=True):
        if len(selected) >= 10:
            break
        mask = valid & (zone_grid == zone["id"])
        pick(mask, -np.abs(condition_grid - np.nanmedian(condition_grid[mask])), f"Representative point for {zone['name']}.")

    transformer = Transformer.from_crs(TARGET_SRS, "EPSG:4326", always_xy=True)
    for point in selected:
        lon, lat = transformer.transform(point["easting"], point["northing"])
        point["lon"] = float(lon)
        point["lat"] = float(lat)
    return selected


def write_points_geojson(points: list[dict[str, Any]]) -> None:
    features = []
    for point in points:
        props = {k: v for k, v in point.items() if k not in {"lon", "lat", "easting", "northing"}}
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Point", "coordinates": [point["lon"], point["lat"]]},
            }
        )
    POINTS_GEOJSON.write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=2))


def render_map(
    bounds: list[float],
    xs: np.ndarray,
    ys: np.ndarray,
    site_mask: np.ndarray,
    boundary_bng: np.ndarray,
    spring_bng: tuple[float, float],
    dem: np.ndarray,
    flow: np.ndarray,
    zone_grid: np.ndarray,
    points: list[dict[str, Any]],
) -> None:
    min_e, min_n, max_e, max_n = bounds
    gy, gx = np.gradient(dem)
    shade = 1 - np.clip((gx * -0.6 + gy * 0.8) / 10 + 0.5, 0, 1)
    flow_log = np.log1p(np.maximum(flow, 0))
    flow_threshold = np.nanpercentile(flow_log[site_mask], 78)
    flow_overlay = np.ma.masked_where(~site_mask | (flow_log < flow_threshold), flow_log)

    zone_plot = np.ma.masked_where(~site_mask | (zone_grid < 0), zone_grid)
    colors = ["#b85c38", "#6f9f3f", "#d5b14b", "#2d9c8f", "#7c66b8"]
    cmap = ListedColormap(colors)

    fig, ax = plt.subplots(figsize=(9, 10.5), dpi=180)
    ax.imshow(shade, extent=[min_e, max_e, min_n, max_n], cmap="Greys", alpha=0.8, origin="upper")
    ax.imshow(zone_plot, extent=[min_e, max_e, min_n, max_n], cmap=cmap, alpha=0.42, origin="upper", interpolation="nearest")
    ax.imshow(flow_overlay, extent=[min_e, max_e, min_n, max_n], cmap="Blues", alpha=0.62, origin="upper")
    ax.plot(boundary_bng[:, 0], boundary_bng[:, 1], color="#111111", linewidth=2.2)
    ax.scatter([spring_bng[0]], [spring_bng[1]], marker="*", s=210, color="#0b5fff", edgecolor="white", linewidth=1.2, zorder=6)
    ax.text(spring_bng[0] + 8, spring_bng[1] + 8, "spring", color="#0b3677", fontsize=9, weight="bold")

    label_offsets = [(7, 7), (7, -13), (-18, 7), (-18, -13)]
    for index, point in enumerate(points):
        dx, dy = label_offsets[index % len(label_offsets)]
        ax.scatter([point["easting"]], [point["northing"]], s=95, color="#ffffff", edgecolor="#111111", linewidth=1.5, zorder=7)
        ax.text(point["easting"] + dx, point["northing"] + dy, point["id"], fontsize=9, weight="bold", color="#111111", zorder=8)

    ax.set_title("Tump Farm: first-pass infiltration survey map", loc="left", fontsize=15, weight="bold")
    ax.set_xlabel("British National Grid easting (m)")
    ax.set_ylabel("British National Grid northing (m)")
    ax.set_aspect("equal")
    ax.grid(color="white", alpha=0.25, linewidth=0.6)
    ax.text(
        0.01,
        0.01,
        "Grey = LiDAR hillshade | blue = higher predicted surface-flow accumulation | colours = Sentinel-2 land-condition clusters",
        transform=ax.transAxes,
        fontsize=8,
        color="#222",
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "none", "pad": 4},
    )
    fig.tight_layout()
    MAP_ASSET.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(MAP_ASSET)
    plt.close(fig)


def html_escape(value: Any) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def write_report(points: list[dict[str, Any]], zones: list[dict[str, Any]], scenes: list[dict[str, Any]]) -> None:
    rows = "\n".join(
        f"""
        <tr>
          <td><strong>{p['id']}</strong></td>
          <td>{p['lat']:.6f}, {p['lon']:.6f}</td>
          <td>{html_escape(p['zone'])}</td>
          <td>{html_escape(p['reason'])}</td>
        </tr>
        """
        for p in points
    )
    zone_rows = "\n".join(
        f"<tr><td>{z['id']}</td><td>{html_escape(z['name'])}</td><td>{z['ndviMedian']}</td><td>{z['ndmiMedian']}</td><td>{z['ndviStd']}</td></tr>"
        for z in zones
    )
    scene_text = ", ".join(f"{s['date']} ({s['cloudCover']}% cloud)" for s in scenes)
    rel_map = MAP_ASSET.relative_to(DOCS_DIR)
    REPORT_HTML.write_text(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tump Farm Remote-Sensing Infiltration Survey Plan</title>
  <style>
    @page {{ size: A4; margin: 14mm; }}
    body {{ font-family: Arial, sans-serif; color: #17211b; line-height: 1.35; }}
    h1 {{ font-size: 24px; margin: 0 0 8px; }}
    h2 {{ font-size: 16px; margin: 18px 0 6px; }}
    p, li {{ font-size: 11px; }}
    .lede {{ font-size: 12px; margin-bottom: 10px; }}
    img {{ width: 100%; border: 1px solid #ccd6cc; }}
    table {{ border-collapse: collapse; width: 100%; font-size: 10px; }}
    th, td {{ border: 1px solid #d6ded6; padding: 5px 6px; vertical-align: top; }}
    th {{ background: #eef4ee; text-align: left; }}
    .note {{ background: #f3f6ec; border-left: 4px solid #7a9d42; padding: 8px 10px; }}
  </style>
</head>
<body>
  <h1>Tump Farm Remote-Sensing Infiltration Survey Plan</h1>
  <p class="lede">Purpose: choose a small number of infiltration-test locations that compare different land-condition signals and different hydrological positions before the site visit.</p>

  <img src="{rel_map}" alt="Remote-sensing infiltration survey map" />

  <h2>Numbered Test Locations</h2>
  <table>
    <thead><tr><th>ID</th><th>Coordinate</th><th>Satellite zone</th><th>Reason for testing</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>

  <h2>Method</h2>
  <p>The terrain layer uses the existing 2&nbsp;m LiDAR-derived flow accumulation for the spring area. The vegetation layer uses Sentinel-2 Level-2A scenes from {scene_text}. For each clear scene, NDVI and NDMI were calculated inside the assumed workable boundary. Pixels were clustered by median vegetation vigour, median moisture signal and seasonal variability.</p>
  <p>The test points were then selected by simple stratified rules: high-flow versus low-flow topographic positions, stronger versus weaker vegetation condition, persistent moisture signals, seasonal variability, and paired points across the sharpest apparent land-condition boundary.</p>

  <h2>Land-Condition Clusters</h2>
  <table>
    <thead><tr><th>Cluster</th><th>Interpretation</th><th>NDVI median</th><th>NDMI median</th><th>NDVI variability</th></tr></thead>
    <tbody>{zone_rows}</tbody>
  </table>

  <h2>How To Use This In The Field</h2>
  <p>At each numbered point, run the same infiltration-ring protocol, take a photo, record ground cover, visible compaction, grazing pressure, slope position, current moisture, drains/pipes/culverts, and farmer comments. For boundary-paired tests, avoid the fence line itself: place the ring comfortably inside the apparent zone, ideally 10-20&nbsp;m from the physical boundary if the field allows it.</p>
  <p>The ring test is mainly measuring near-surface infiltration behaviour and saturated hydraulic conductivity at a small patch scale. That is useful for comparing trampling, grazing compaction, surface crusting and root/macropore effects, but it is not a direct spring-recharge measurement.</p>

  <div class="note">
    <strong>Limit:</strong> this map identifies contrasts worth checking. It does not prove why those contrasts exist, and it does not prove spring recharge. Sentinel-2 is 10&nbsp;m scale for the main vegetation bands, so narrow hedges and fence-line changes can be mixed across pixels. NDMI is also weather-sensitive, especially immediately after rain. A DEM routes surface runoff if runoff occurs; infiltration tests help estimate whether runoff is actually generated.
  </div>
</body>
</html>
""",
        encoding="utf-8",
    )


def write_pdf() -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "google-chrome",
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            f"--print-to-pdf={REPORT_PDF}",
            str(REPORT_HTML),
        ],
        check=True,
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    boundary_wgs84 = feature_coords(read_geojson(BOUNDARY_PATH))
    boundary_bng = transform_points(boundary_wgs84, "EPSG:4326", TARGET_SRS)
    spring_lon, spring_lat = feature_coords(read_geojson(SPRING_PATH))[0]
    spring_bng_arr = transform_points([(spring_lon, spring_lat)], "EPSG:4326", TARGET_SRS)[0]
    spring_bng = (float(spring_bng_arr[0]), float(spring_bng_arr[1]))

    bounds, width, height = output_grid(boundary_bng)
    xs, ys = grid_centres(bounds, width, height)
    site_mask = mask_for_boundary(boundary_bng, xs, ys)

    items = stac_search(boundary_wgs84)
    indices = sentinel_indices(items, bounds, width, height, site_mask)
    zone_grid, zone_summaries = classify_zones(indices, site_mask)

    flow = read_local_raster_to_grid(FLOW_PATH, bounds, width, height, "bilinear")
    dem = read_local_raster_to_grid(DEM_PATH, bounds, width, height, "bilinear")
    flow[~site_mask] = np.nan
    dem[~np.isfinite(dem)] = np.nanmedian(dem)

    points = select_test_points(xs, ys, site_mask, zone_grid, zone_summaries, indices, flow, spring_bng)
    write_points_geojson(points)
    render_map(bounds, xs, ys, site_mask, boundary_bng, spring_bng, dem, flow, zone_grid, points)
    write_report(points, zone_summaries, indices["usedScenes"])
    write_pdf()

    ANALYSIS_JSON.write_text(
        json.dumps(
            {
                "generatedAt": dt.datetime.now(dt.UTC).isoformat(),
                "sentinelSource": "Element84 Earth Search sentinel-2-l2a",
                "sentinelDateRange": [SENTINEL_START, SENTINEL_END],
                "usedScenes": indices["usedScenes"],
                "skippedScenes": indices["skippedScenes"],
                "landConditionClusters": zone_summaries,
                "testPoints": points,
                "outputs": {
                    "mapPng": str(MAP_ASSET.relative_to(ROOT)),
                    "reportHtml": str(REPORT_HTML.relative_to(ROOT)),
                    "reportPdf": str(REPORT_PDF.relative_to(ROOT)),
                    "pointsGeojson": str(POINTS_GEOJSON.relative_to(ROOT)),
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {REPORT_HTML}")
    print(f"Wrote {REPORT_PDF}")
    print(f"Wrote {POINTS_GEOJSON}")


if __name__ == "__main__":
    main()
