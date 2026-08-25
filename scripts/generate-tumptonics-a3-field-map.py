#!/usr/bin/env python3
"""
Generate clean A3 landscape field-observation maps for the Tump Farm survey area.

Outputs:
- Primary black-and-white field observation PDF.
- Terrain/hydrology interpretation PDF with identical extent.

The map deliberately avoids a normal coloured basemap. It uses the supplied
quadrilateral as the print extent, Welsh Government/DataMapWales LiDAR DTM, the
Trees Outside Woodland WFS layer, and OpenStreetMap where the live Overpass API
responds quickly enough.
"""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import requests
from matplotlib.collections import LineCollection, PatchCollection
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.path import Path as MplPath
from osgeo import gdal
from pyproj import Transformer


ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "local/water-walk/tumptonics"
OUT_DIR = SITE_DIR / "a3-field-map"
DOCS_DIR = ROOT / "docs/client-reports/out"

FIELD_PDF = DOCS_DIR / "tump-farm-a3-field-observation-map.pdf"
TERRAIN_PDF = DOCS_DIR / "tump-farm-a3-terrain-observation-map.pdf"
FIELD_PNG = ROOT / "docs/client-reports/assets/tump-farm-a3-field-observation-map.png"
TERRAIN_PNG = ROOT / "docs/client-reports/assets/tump-farm-a3-terrain-observation-map.png"

DTM_COG = "https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dtm_16bit_cog.tif"
TOW_WFS = "https://datamap.gov.wales/geoserver/geonode/wfs"
FLOW_RASTER = SITE_DIR / "spring-catchment-2m/flow-accumulation.tif"

BOUNDARY_LAT_LON = [
    (51.66543997898531, -2.8549538482497065),
    (51.6651391991454, -2.8522637555204726),
    (51.66184037114777, -2.8532494120414613),
    (51.66261936765667, -2.8565412505124574),
]
SPRING_LAT_LON = (51.664158, -2.855463)

BNG = "EPSG:27700"
WGS84 = "EPSG:4326"


def ensure_dirs() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    FIELD_PNG.parent.mkdir(parents=True, exist_ok=True)


def transform_lat_lon(points: list[tuple[float, float]]) -> np.ndarray:
    transformer = Transformer.from_crs(WGS84, BNG, always_xy=True)
    lon = [p[1] for p in points]
    lat = [p[0] for p in points]
    east, north = transformer.transform(lon, lat)
    return np.column_stack([east, north]).astype(float)


def transform_lon_lat(points: list[tuple[float, float]]) -> np.ndarray:
    transformer = Transformer.from_crs(WGS84, BNG, always_xy=True)
    lon = [p[0] for p in points]
    lat = [p[1] for p in points]
    east, north = transformer.transform(lon, lat)
    return np.column_stack([east, north]).astype(float)


def bng_to_lat_lon(easting: float, northing: float) -> tuple[float, float]:
    transformer = Transformer.from_crs(BNG, WGS84, always_xy=True)
    lon, lat = transformer.transform(easting, northing)
    return lat, lon


class Rotator:
    def __init__(self, boundary_bng: np.ndarray):
        centroid = boundary_bng.mean(axis=0)
        centred = boundary_bng - centroid
        _, _, vh = np.linalg.svd(centred, full_matrices=False)
        ux = vh[0]
        if ux[0] < 0:
            ux = -ux
        uy = np.array([-ux[1], ux[0]])
        self.origin = centroid
        self.ux = ux
        self.uy = uy

    def xy(self, points_bng: np.ndarray) -> np.ndarray:
        delta = points_bng - self.origin
        return np.column_stack([delta @ self.ux, delta @ self.uy])

    def vector_xy(self, vector_bng: np.ndarray) -> np.ndarray:
        return np.array([vector_bng @ self.ux, vector_bng @ self.uy])


def padded_bounds(boundary_bng: np.ndarray, pad_m: float = 35) -> list[float]:
    return [
        math.floor(boundary_bng[:, 0].min() - pad_m),
        math.floor(boundary_bng[:, 1].min() - pad_m),
        math.ceil(boundary_bng[:, 0].max() + pad_m),
        math.ceil(boundary_bng[:, 1].max() + pad_m),
    ]


def read_dtm(bounds: list[float], resolution_m: int = 1) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    cache = OUT_DIR / f"dtm-{resolution_m}m.npy"
    meta = OUT_DIR / f"dtm-{resolution_m}m.json"
    if cache.exists() and meta.exists():
        data = np.load(cache)
        info = json.loads(meta.read_text())
        xs = np.array(info["xs"], dtype=float)
        ys = np.array(info["ys"], dtype=float)
        return data, xs, ys

    width = int(math.ceil((bounds[2] - bounds[0]) / resolution_m))
    height = int(math.ceil((bounds[3] - bounds[1]) / resolution_m))
    gdal.SetConfigOption("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    gdal.SetConfigOption("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    ds = gdal.Open("/vsicurl/" + DTM_COG)
    if ds is None:
        raise RuntimeError("Could not open Welsh Government LiDAR DTM COG")
    warped = gdal.Warp(
        "",
        ds,
        format="MEM",
        dstSRS=BNG,
        outputBounds=bounds,
        width=width,
        height=height,
        resampleAlg="bilinear",
    )
    if warped is None:
        raise RuntimeError("Could not read DTM window")
    arr = warped.ReadAsArray().astype(float)
    arr[arr < -1000] = np.nan
    xs = bounds[0] + (np.arange(width) + 0.5) * ((bounds[2] - bounds[0]) / width)
    ys = bounds[3] - (np.arange(height) + 0.5) * ((bounds[3] - bounds[1]) / height)
    np.save(cache, arr)
    meta.write_text(json.dumps({"xs": xs.tolist(), "ys": ys.tolist()}))
    return arr, xs, ys


def read_flow(bounds: list[float], width: int, height: int) -> np.ndarray | None:
    if not FLOW_RASTER.exists():
        return None
    ds = gdal.Open(str(FLOW_RASTER))
    if ds is None:
        return None
    warped = gdal.Warp(
        "",
        ds,
        format="MEM",
        dstSRS=BNG,
        outputBounds=bounds,
        width=width,
        height=height,
        resampleAlg="bilinear",
    )
    if warped is None:
        return None
    return warped.ReadAsArray().astype(float)


def query_trees_outside_woodland(boundary_lat_lon: list[tuple[float, float]]) -> dict[str, Any]:
    cache = OUT_DIR / "trees-outside-woodland.geojson"
    if cache.exists():
        return json.loads(cache.read_text())
    lats = [p[0] for p in boundary_lat_lon]
    lons = [p[1] for p in boundary_lat_lon]
    bbox = f"{min(lons)-0.001},{min(lats)-0.001},{max(lons)+0.001},{max(lats)+0.001},EPSG:4326"
    response = requests.get(
        TOW_WFS,
        params={
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "geonode:tow_wales",
            "outputFormat": "application/json",
            "bbox": bbox,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    cache.write_text(json.dumps(data))
    return data


def query_osm(boundary_lat_lon: list[tuple[float, float]]) -> dict[str, Any]:
    cache = OUT_DIR / "osm-features.json"
    if cache.exists():
        return json.loads(cache.read_text())

    lats = [p[0] for p in boundary_lat_lon]
    lons = [p[1] for p in boundary_lat_lon]
    south, west, north, east = min(lats) - 0.001, min(lons) - 0.001, max(lats) + 0.001, max(lons) + 0.001
    query = f"""[out:json][timeout:15];(
  way({south},{west},{north},{east})["barrier"];
  node({south},{west},{north},{east})["barrier"="gate"];
  way({south},{west},{north},{east})["highway"];
  way({south},{west},{north},{east})["waterway"];
  way({south},{west},{north},{east})["building"];
  way({south},{west},{north},{east})["natural"="wood"];
  way({south},{west},{north},{east})["landuse"="forest"];
  node({south},{west},{north},{east})["natural"="tree"];
  node({south},{west},{north},{east})["natural"="spring"];
);out body geom;"""
    for url in [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]:
        try:
            response = requests.get(url, params={"data": query}, headers={"User-Agent": "JobDone Tumptonics A3 map generator"}, timeout=18)
            if response.ok:
                data = response.json()
                cache.write_text(json.dumps(data))
                return data
        except Exception:
            continue
    data = {"elements": [], "warning": "Overpass unavailable during generation"}
    cache.write_text(json.dumps(data))
    return data


def rings_from_geometry(geometry: dict[str, Any]) -> list[np.ndarray]:
    if geometry["type"] == "Polygon":
        return [np.array(ring, dtype=float) for ring in geometry["coordinates"][:1]]
    if geometry["type"] == "MultiPolygon":
        return [np.array(poly[0], dtype=float) for poly in geometry["coordinates"] if poly]
    return []


def tow_patches(tow_geojson: dict[str, Any], rotator: Rotator) -> list[MplPolygon]:
    patches: list[MplPolygon] = []
    for feature in tow_geojson.get("features", []):
        for ring in rings_from_geometry(feature.get("geometry", {})):
            # DataMapWales TOW GeoJSON returns BNG coordinates even though the
            # GeoJSON object lacks an explicit CRS member.
            xy = rotator.xy(ring)
            if len(xy) >= 3:
                patches.append(MplPolygon(xy, closed=True))
    return patches


def osm_features(osm: dict[str, Any], rotator: Rotator) -> dict[str, list[Any]]:
    out: dict[str, list[Any]] = {
        "hedge": [],
        "fence": [],
        "track": [],
        "water": [],
        "building": [],
        "wood": [],
        "gate": [],
        "tree": [],
        "spring": [],
    }
    for el in osm.get("elements", []):
        tags = el.get("tags", {})
        if el.get("type") == "node" and "lat" in el and "lon" in el:
            point = transform_lat_lon([(el["lat"], el["lon"])])
            xy = rotator.xy(point)[0]
            if tags.get("barrier") == "gate":
                out["gate"].append(xy)
            elif tags.get("natural") == "tree":
                out["tree"].append(xy)
            elif tags.get("natural") == "spring":
                out["spring"].append(xy)
            continue
        geom = el.get("geometry")
        if not geom:
            continue
        lon_lat = [(p["lon"], p["lat"]) for p in geom]
        bng = transform_lon_lat(lon_lat)
        xy = rotator.xy(bng)
        if len(xy) < 2:
            continue
        if tags.get("building"):
            out["building"].append(xy)
        elif tags.get("barrier") == "hedge":
            out["hedge"].append(xy)
        elif tags.get("barrier") in {"fence", "wall"}:
            out["fence"].append(xy)
        elif tags.get("waterway"):
            out["water"].append(xy)
        elif tags.get("highway"):
            out["track"].append(xy)
        elif tags.get("natural") == "wood" or tags.get("landuse") == "forest":
            out["wood"].append(xy)
    return out


def setup_axes(fig: plt.Figure, title: str) -> plt.Axes:
    ax = fig.add_axes([0.045, 0.075, 0.91, 0.84])
    ax.set_title(title, loc="left", fontsize=16, fontweight="bold", pad=10)
    ax.set_aspect("equal")
    ax.axis("off")
    return ax


def extent_from_boundary(boundary_xy: np.ndarray, margin_m: float = 25) -> tuple[float, float, float, float]:
    return (
        float(boundary_xy[:, 0].min() - margin_m),
        float(boundary_xy[:, 0].max() + margin_m),
        float(boundary_xy[:, 1].min() - margin_m),
        float(boundary_xy[:, 1].max() + margin_m),
    )


def draw_furniture(
    ax: plt.Axes,
    rotator: Rotator,
    bounds_xy: tuple[float, float, float, float],
    boundary_bng: np.ndarray,
    source_note: str,
) -> None:
    min_x, max_x, min_y, max_y = bounds_xy
    ax.set_xlim(min_x, max_x)
    ax.set_ylim(min_y, max_y)

    # 50 m scale bar.
    bar_x = min_x + 20
    bar_y = min_y + 16
    ax.plot([bar_x, bar_x + 50], [bar_y, bar_y], color="black", linewidth=2.4)
    ax.plot([bar_x, bar_x], [bar_y - 3, bar_y + 3], color="black", linewidth=1)
    ax.plot([bar_x + 50, bar_x + 50], [bar_y - 3, bar_y + 3], color="black", linewidth=1)
    ax.text(bar_x + 25, bar_y + 6, "50 m", ha="center", va="bottom", fontsize=8)

    # North arrow in rotated page coordinates.
    north_vec = rotator.vector_xy(np.array([0.0, 1.0]))
    north_vec = north_vec / max(np.linalg.norm(north_vec), 1e-9)
    nx = max_x - 30
    ny = max_y - 50
    ax.annotate("", xy=(nx + north_vec[0] * 28, ny + north_vec[1] * 28), xytext=(nx, ny), arrowprops={"arrowstyle": "-|>", "lw": 1.8, "color": "black"})
    ax.text(nx + north_vec[0] * 34, ny + north_vec[1] * 34, "N", ha="center", va="center", fontsize=11, fontweight="bold")

    lat, lon = bng_to_lat_lon(boundary_bng[:, 0].mean(), boundary_bng[:, 1].mean())
    scale = round((max_x - min_x) / (0.34), -1)  # rough printable width estimate in metres per 340 mm
    ax.text(
        min_x,
        min_y - 8,
        f"Approx. scale 1:{int(scale)} | centre {lat:.5f}, {lon:.5f} | {source_note}",
        fontsize=7,
        ha="left",
        va="top",
        color="#333333",
    )


def apply_clip(artist: Any, clip_patch: MplPolygon | None) -> Any:
    if clip_patch is not None:
        artist.set_clip_path(clip_patch)
    return artist


def draw_osm(ax: plt.Axes, osm: dict[str, list[Any]], clip_patch: MplPolygon | None = None) -> None:
    if osm["track"]:
        ax.add_collection(apply_clip(LineCollection(osm["track"], colors="#555555", linewidths=1.0, linestyles="dashed", zorder=4), clip_patch))
    if osm["water"]:
        ax.add_collection(apply_clip(LineCollection(osm["water"], colors="#222222", linewidths=0.8, linestyles="dotted", zorder=5), clip_patch))
    if osm["hedge"]:
        ax.add_collection(apply_clip(LineCollection(osm["hedge"], colors="black", linewidths=1.7, zorder=7), clip_patch))
    if osm["fence"]:
        ax.add_collection(apply_clip(LineCollection(osm["fence"], colors="black", linewidths=1.1, linestyles="dashdot", zorder=7), clip_patch))
    for building in osm["building"]:
        for patch in ax.fill(building[:, 0], building[:, 1], facecolor="none", edgecolor="black", linewidth=1.0, hatch="////", zorder=6):
            apply_clip(patch, clip_patch)
    for wood in osm["wood"]:
        for patch in ax.fill(wood[:, 0], wood[:, 1], facecolor="none", edgecolor="#333333", linewidth=1.1, zorder=3):
            apply_clip(patch, clip_patch)
    if osm["gate"]:
        pts = np.array(osm["gate"])
        ax.scatter(pts[:, 0], pts[:, 1], marker="s", s=18, facecolor="white", edgecolor="black", linewidth=0.8, zorder=8)
    if osm["tree"]:
        pts = np.array(osm["tree"])
        ax.scatter(pts[:, 0], pts[:, 1], marker="o", s=12, facecolor="white", edgecolor="black", linewidth=0.6, zorder=5)
    if osm["spring"]:
        pts = np.array(osm["spring"])
        ax.scatter(pts[:, 0], pts[:, 1], marker="*", s=60, facecolor="white", edgecolor="black", linewidth=0.8, zorder=8)


def draw_tow(ax: plt.Axes, patches: list[MplPolygon], dense: bool = False, clip_patch: MplPolygon | None = None) -> None:
    if not patches:
        return
    collection = PatchCollection(
        patches,
        facecolor="#eeeeee" if dense else "none",
        edgecolor="#222222",
        linewidth=0.45 if dense else 0.55,
        hatch=None,
        zorder=2,
        alpha=0.75 if dense else 1.0,
    )
    ax.add_collection(apply_clip(collection, clip_patch))


def draw_boundary_and_spring(ax: plt.Axes, boundary_xy: np.ndarray, spring_xy: np.ndarray) -> None:
    closed = np.vstack([boundary_xy, boundary_xy[0]])
    ax.plot(closed[:, 0], closed[:, 1], color="black", linewidth=2.4, zorder=10)
    ax.scatter([spring_xy[0]], [spring_xy[1]], marker="*", s=70, facecolor="white", edgecolor="black", linewidth=1.0, zorder=11)
    ax.text(spring_xy[0] + 5, spring_xy[1] + 4, "spring", fontsize=7, ha="left", va="bottom")


def draw_contours(
    ax: plt.Axes,
    dem: np.ndarray,
    xs: np.ndarray,
    ys: np.ndarray,
    rotator: Rotator,
    interval: int,
    color: str,
    linewidth: float,
    clip_patch: MplPolygon | None = None,
) -> None:
    xx, yy = np.meshgrid(xs, ys)
    xy = rotator.xy(np.column_stack([xx.ravel(), yy.ravel()]))
    xyr = xy.reshape(xx.shape + (2,))
    finite = dem[np.isfinite(dem)]
    if finite.size == 0:
        return
    low = math.ceil(np.nanmin(finite) / interval) * interval
    high = math.floor(np.nanmax(finite) / interval) * interval
    if high <= low:
        return
    levels = np.arange(low, high + interval, interval)
    contour = ax.contour(xyr[:, :, 0], xyr[:, :, 1], dem, levels=levels, colors=color, linewidths=linewidth, alpha=0.72, zorder=1)
    apply_clip(contour, clip_patch)


def draw_hillshade(ax: plt.Axes, dem: np.ndarray, xs: np.ndarray, ys: np.ndarray, rotator: Rotator, clip_patch: MplPolygon | None = None) -> None:
    gy, gx = np.gradient(dem)
    shade = np.clip(0.58 - gx * 0.035 + gy * 0.045, 0.28, 0.93)
    xx, yy = np.meshgrid(xs, ys)
    xy = rotator.xy(np.column_stack([xx.ravel(), yy.ravel()]))
    xyr = xy.reshape(xx.shape + (2,))
    mesh = ax.pcolormesh(
        xyr[:, :, 0],
        xyr[:, :, 1],
        shade,
        cmap="Greys",
        shading="nearest",
        alpha=0.18,
        linewidth=0,
        antialiased=False,
        rasterized=True,
        zorder=0,
    )
    apply_clip(mesh, clip_patch)


def draw_flow(ax: plt.Axes, flow: np.ndarray | None, xs: np.ndarray, ys: np.ndarray, rotator: Rotator, clip_patch: MplPolygon | None = None) -> None:
    if flow is None:
        return
    flow_log = np.log1p(np.maximum(flow, 0))
    threshold = np.nanpercentile(flow_log[np.isfinite(flow_log)], 86)
    mask = np.ma.masked_where(flow_log < threshold, flow_log)
    xx, yy = np.meshgrid(xs, ys)
    xy = rotator.xy(np.column_stack([xx.ravel(), yy.ravel()]))
    xyr = xy.reshape(xx.shape + (2,))
    contour = ax.contour(xyr[:, :, 0], xyr[:, :, 1], mask, levels=5, colors="#111111", linewidths=0.45, linestyles="dotted", zorder=3)
    apply_clip(contour, clip_patch)


def render_maps() -> None:
    ensure_dirs()
    boundary_bng = transform_lat_lon(BOUNDARY_LAT_LON)
    boundary_closed = np.vstack([boundary_bng, boundary_bng[0]])
    spring_bng = transform_lat_lon([SPRING_LAT_LON])[0]
    rotator = Rotator(boundary_bng)
    boundary_xy = rotator.xy(boundary_bng)
    spring_xy = rotator.xy(spring_bng.reshape(1, 2))[0]
    map_extent = extent_from_boundary(boundary_xy, margin_m=22)
    raster_bounds = padded_bounds(boundary_bng, pad_m=45)

    dem, xs, ys = read_dtm(raster_bounds, resolution_m=1)
    flow = read_flow(raster_bounds, width=len(xs), height=len(ys))
    tow = query_trees_outside_woodland(BOUNDARY_LAT_LON)
    osm_raw = query_osm(BOUNDARY_LAT_LON)
    tow_poly = tow_patches(tow, rotator)
    osm = osm_features(osm_raw, rotator)

    source_note = "DataMapWales LiDAR DTM/TOW; OSM if mapped"

    fig = plt.figure(figsize=(16.54, 11.69), dpi=180)
    ax = setup_axes(fig, "Tump Farm — Field Observation Map")
    clip_patch = MplPolygon(boundary_xy, closed=True, transform=ax.transData)
    draw_contours(ax, dem, xs, ys, rotator, interval=2, color="#c9c9c9", linewidth=0.32, clip_patch=clip_patch)
    draw_tow(ax, tow_poly, dense=False, clip_patch=clip_patch)
    draw_osm(ax, osm, clip_patch=clip_patch)
    draw_boundary_and_spring(ax, boundary_xy, spring_xy)
    draw_furniture(ax, rotator, map_extent, boundary_bng, source_note)
    fig.savefig(FIELD_PDF)
    fig.savefig(FIELD_PNG)
    plt.close(fig)

    fig = plt.figure(figsize=(16.54, 11.69), dpi=180)
    ax = setup_axes(fig, "Tump Farm — Terrain Observation Map")
    clip_patch = MplPolygon(boundary_xy, closed=True, transform=ax.transData)
    draw_contours(ax, dem, xs, ys, rotator, interval=2, color="#8a8a8a", linewidth=0.38, clip_patch=clip_patch)
    draw_flow(ax, flow, xs, ys, rotator, clip_patch=clip_patch)
    draw_tow(ax, tow_poly, dense=True, clip_patch=clip_patch)
    draw_osm(ax, osm, clip_patch=clip_patch)
    draw_boundary_and_spring(ax, boundary_xy, spring_xy)
    draw_furniture(ax, rotator, map_extent, boundary_bng, source_note)
    fig.savefig(TERRAIN_PDF)
    fig.savefig(TERRAIN_PNG)
    plt.close(fig)

    qa = {
        "outputs": {
            "fieldPdf": str(FIELD_PDF.relative_to(ROOT)),
            "terrainPdf": str(TERRAIN_PDF.relative_to(ROOT)),
            "fieldPng": str(FIELD_PNG.relative_to(ROOT)),
            "terrainPng": str(TERRAIN_PNG.relative_to(ROOT)),
        },
        "area": {
            "boundaryLatLon": BOUNDARY_LAT_LON,
            "springLatLon": SPRING_LAT_LON,
            "approxScale": "about 1:1000-1:1200 depending printer margins; map is rotated to fill A3 landscape",
        },
        "sources": {
            "dtm": DTM_COG,
            "treesOutsideWoodland": TOW_WFS,
            "osmElements": len(osm_raw.get("elements", [])),
            "towFeatures": len(tow.get("features", [])),
        },
    }
    (OUT_DIR / "qa.json").write_text(json.dumps(qa, indent=2))
    print(json.dumps(qa, indent=2))


if __name__ == "__main__":
    render_maps()
