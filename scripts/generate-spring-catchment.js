#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';

const BNG = 'EPSG:27700';
const WGS84 = 'EPSG:4326';
const WALES_DTM_COG_URL = 'https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dtm_16bit_cog.tif';

proj4.defs(BNG, '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.1502,0.247,0.8421,-20.4894 +units=m +no_defs');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function numberArg(name, fallback) {
  const value = Number(argValue(name, fallback));
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function run(command, args, options = {}) {
  if (options.log !== false) console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 1024 * 1024 * 20,
  });
  if (result.status !== 0) {
    throw new Error([
      `$ ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function wgs84ToBng({ lat, lon }) {
  const [easting, northing] = proj4(WGS84, BNG, [lon, lat]);
  return { easting, northing };
}

function bngToWgs84({ easting, northing }) {
  const [lon, lat] = proj4(BNG, WGS84, [easting, northing]);
  return { lat, lon };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function polygonCoordinates(featureCollection) {
  const feature = featureCollection.features?.find(candidate => candidate.geometry?.type === 'Polygon');
  if (!feature) throw new Error('Boundary GeoJSON must contain a Polygon feature.');
  return feature.geometry.coordinates[0].map(([lon, lat]) => ({ lat, lon }));
}

function bngBoundsForPoints(points, bufferMetres) {
  const bngPoints = points.map(wgs84ToBng);
  return {
    minE: Math.floor(Math.min(...bngPoints.map(point => point.easting)) - bufferMetres),
    maxE: Math.ceil(Math.max(...bngPoints.map(point => point.easting)) + bufferMetres),
    minN: Math.floor(Math.min(...bngPoints.map(point => point.northing)) - bufferMetres),
    maxN: Math.ceil(Math.max(...bngPoints.map(point => point.northing)) + bufferMetres),
  };
}

function parseMarkedGrassStats(output) {
  const stats = {};
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    const marker = line.match(/^__([A-Z_]+)__$/);
    if (marker) {
      current = marker[1].toLowerCase();
      stats[current] = {};
      continue;
    }
    if (!current) continue;
    const [key, value] = line.split('=');
    if (!key || value === undefined) continue;
    const numeric = Number(value);
    stats[current][key.trim()] = Number.isFinite(numeric) ? numeric : value.trim();
  }
  return stats;
}

function geoJsonRectangle(bounds, properties) {
  const corners = [
    { easting: bounds.minE, northing: bounds.minN },
    { easting: bounds.maxE, northing: bounds.minN },
    { easting: bounds.maxE, northing: bounds.maxN },
    { easting: bounds.minE, northing: bounds.maxN },
    { easting: bounds.minE, northing: bounds.minN },
  ].map(point => {
    const { lat, lon } = bngToWgs84(point);
    return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
  });
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [corners],
    },
  };
}

function pointFeature({ lat, lon }, properties) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates: [Number(lon.toFixed(7)), Number(lat.toFixed(7))],
    },
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function cogWindowForBngBounds(image, bounds) {
  const [minX, , , maxY] = image.getBoundingBox();
  const [resolutionX, resolutionY] = image.getResolution();
  const pixelWidth = Math.abs(resolutionX);
  const pixelHeight = Math.abs(resolutionY);
  const left = Math.max(0, Math.floor((bounds.minE - minX) / pixelWidth));
  const right = Math.min(image.getWidth(), Math.ceil((bounds.maxE - minX) / pixelWidth));
  const top = Math.max(0, Math.floor((maxY - bounds.maxN) / pixelHeight));
  const bottom = Math.min(image.getHeight(), Math.ceil((maxY - bounds.minN) / pixelHeight));
  if (right - left < 2 || bottom - top < 2) throw new Error('COG window is too small.');
  return { left, top, right, bottom };
}

async function readCogGrid({ cogUrl, bounds, resolutionMetres }) {
  console.log(`Reading DEM window from ${cogUrl}`);
  const tiff = await fromUrl(cogUrl);
  const image = await tiff.getImage();
  const window = cogWindowForBngBounds(image, bounds);
  const nativeWidth = window.right - window.left;
  const nativeHeight = window.bottom - window.top;
  const width = Math.max(2, Math.ceil(nativeWidth / resolutionMetres));
  const height = Math.max(2, Math.ceil(nativeHeight / resolutionMetres));
  const [values] = await image.readRasters({
    window: [window.left, window.top, window.right, window.bottom],
    width,
    height,
    interleave: false,
  });
  const noData = Number(image.getGDALNoData());
  const [minX, , , maxY] = image.getBoundingBox();
  const readBounds = {
    minE: minX + window.left,
    maxE: minX + window.right,
    minN: maxY - window.bottom,
    maxN: maxY - window.top,
  };
  const cellSize = (readBounds.maxE - readBounds.minE) / width;
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    const valuesRow = [];
    for (let col = 0; col < width; col += 1) {
      const value = Number(values[row * width + col]);
      valuesRow.push(Number.isFinite(value) && value !== noData ? value : -9999);
    }
    rows.push(valuesRow);
  }
  return {
    bounds: readBounds,
    width,
    height,
    cellSize,
    noData: -9999,
    rows,
    nativeWindow: { width: nativeWidth, height: nativeHeight },
  };
}

async function writeAsciiGrid(path, grid) {
  await mkdir(dirname(path), { recursive: true });
  const header = [
    `ncols ${grid.width}`,
    `nrows ${grid.height}`,
    `xllcorner ${grid.bounds.minE}`,
    `yllcorner ${grid.bounds.minN}`,
    `cellsize ${grid.cellSize}`,
    `NODATA_value ${grid.noData}`,
  ];
  const body = grid.rows.map(row => row.map(value => Number(value).toFixed(3)).join(' '));
  await writeFile(path, `${header.concat(body).join('\n')}\n`);
  await writeFile(path.replace(/\.asc$/i, '.prj'), `PROJCS["OSGB36 / British National Grid",GEOGCS["OSGB36",DATUM["OSGB_1936",SPHEROID["Airy 1830",6377563.396,299.3249646]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",49],PARAMETER["central_meridian",-2],PARAMETER["scale_factor",0.9996012717],PARAMETER["false_easting",400000],PARAMETER["false_northing",-100000],UNIT["metre",1]]\n`);
}

async function writeColorFile(path) {
  await writeFile(path, [
    '0 255 255 255 0',
    '1 210 235 255 80',
    '10 115 180 255 140',
    '100 20 90 220 210',
    '1000 0 30 120 255',
    'nv 255 255 255 0',
  ].join('\n'));
}

async function writeSnapHelper(path) {
  await writeFile(path, `#!/usr/bin/env python3
import json
import math
import sys
from osgeo import gdal

tif_path, east_s, north_s, radius_s, meta_path = sys.argv[1:6]
target_e = float(east_s)
target_n = float(north_s)
radius = float(radius_s)
dataset = gdal.Open(tif_path)
if dataset is None:
    raise SystemExit(f"Could not open {tif_path}")
band = dataset.GetRasterBand(1)
array = band.ReadAsArray()
no_data = band.GetNoDataValue()
gt = dataset.GetGeoTransform()

best = None
nearest = None
for row in range(dataset.RasterYSize):
    for col in range(dataset.RasterXSize):
        value = float(array[row][col])
        if no_data is not None and value == no_data:
            continue
        if math.isnan(value):
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
`);
}

async function main() {
  const siteId = argValue('--site-id', 'tumptonics');
  const lat = numberArg('--lat', 51.664158);
  const lon = numberArg('--lon', -2.855463);
  const boundaryPath = argValue('--boundary', 'local/water-walk/tumptonics/workable-boundary.geojson');
  const bufferMetres = numberArg('--buffer-metres', 250);
  const resolutionMetres = numberArg('--resolution-metres', 2);
  const snapRadiusMetres = numberArg('--snap-radius-metres', 30);
  const outputDir = resolve(process.cwd(), argValue('--output-dir', `local/water-walk/${siteId}/spring-catchment`));
  const cogUrl = argValue('--cog-url', WALES_DTM_COG_URL);
  const grassMemoryMb = numberArg('--grass-memory-mb', 600);
  const engine = argValue('--engine', 'grass');
  if (engine !== 'grass') throw new Error(`Unsupported spring catchment engine: ${engine}`);
  const spring = { lat, lon };
  const springBng = wgs84ToBng(spring);
  const boundary = await readJson(boundaryPath);
  const boundaryPoints = polygonCoordinates(boundary);
  const bounds = bngBoundsForPoints([...boundaryPoints, spring], bufferMetres);
  await mkdir(outputDir, { recursive: true });

  const demPath = resolve(outputDir, 'dem-window.asc');
  const basinTifPath = resolve(outputDir, 'catchment.tif');
  const accumulationTifPath = resolve(outputDir, 'flow-accumulation.tif');
  const accumulationPngPath = resolve(outputDir, 'flow-accumulation.png');
  const colorFilePath = resolve(outputDir, 'flow-accumulation-colors.txt');
  const catchmentRawVectorPath = resolve(outputDir, 'catchment-raw-bng.geojson');
  const catchmentVectorPath = resolve(outputDir, 'catchment.geojson');
  const snappedOutletPath = resolve(outputDir, 'snapped-outlet.txt');
  const snappedOutletMetaPath = resolve(outputDir, 'snapped-outlet.json');
  const snapHelperPath = resolve(outputDir, 'snap-outlet.py');
  const metaPath = resolve(outputDir, 'qa.json');

  const demGrid = await readCogGrid({ cogUrl, bounds, resolutionMetres });
  await writeAsciiGrid(demPath, demGrid);
  await writeColorFile(colorFilePath);
  await writeSnapHelper(snapHelperPath);

  const grassScript = [
    'set -euo pipefail',
    `r.in.gdal input="${demPath}" output=dem --overwrite --quiet`,
    'g.region raster=dem',
    `r.watershed -as elevation=dem accumulation=accumulation drainage=drainage basin=basin threshold=10 memory=${grassMemoryMb} --overwrite --quiet`,
    `r.out.gdal -f input=accumulation output="${accumulationTifPath}" format=GTiff type=Float32 createopt="COMPRESS=DEFLATE" --overwrite --quiet`,
    `python3 "${snapHelperPath}" "${accumulationTifPath}" "${springBng.easting}" "${springBng.northing}" "${snapRadiusMetres}" "${snappedOutletMetaPath}" > "${snappedOutletPath}"`,
    `SNAPPED_OUTLET="$(cat "${snappedOutletPath}")"`,
    'echo "Snapped outlet: ${SNAPPED_OUTLET}"',
    `r.water.outlet input=drainage output=spring_catchment coordinates="$SNAPPED_OUTLET" --overwrite --quiet`,
    `r.out.gdal input=spring_catchment output="${basinTifPath}" format=GTiff type=Byte createopt="COMPRESS=DEFLATE" --overwrite --quiet`,
    `r.to.vect input=spring_catchment output=spring_catchment_vector type=area --overwrite --quiet`,
    `v.out.ogr input=spring_catchment_vector output="${catchmentRawVectorPath}" format=GeoJSON --overwrite --quiet`,
    'echo "__DEM__"',
    'r.univar -g map=dem',
    'echo "__ACCUMULATION__"',
    'r.univar -g map=accumulation',
    'echo "__CATCHMENT__"',
    'r.univar -g map=spring_catchment',
  ].join('\n');
  const grassOutput = run('grass', ['--tmp-project', BNG, '--exec', 'bash', '-lc', grassScript], {
    maxBuffer: 1024 * 1024 * 50,
  });
  const markedStats = parseMarkedGrassStats(grassOutput);
  const demStats = markedStats.dem || {};
  const accumulationStats = markedStats.accumulation || {};
  const catchmentStats = markedStats.catchment || {};
  const snappedOutletMeta = await readJson(snappedOutletMetaPath);

  await rm(catchmentVectorPath, { force: true });
  run('ogr2ogr', [
    '-t_srs',
    WGS84,
    catchmentVectorPath,
    catchmentRawVectorPath,
  ], { maxBuffer: 1024 * 1024 * 20 });

  run('gdaldem', [
    'color-relief',
    accumulationTifPath,
    colorFilePath,
    accumulationPngPath,
    '-of',
    'PNG',
    '-alpha',
  ], { maxBuffer: 1024 * 1024 * 20 });

  const demWindowFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      geoJsonRectangle(bounds, {
        id: `${siteId}-dem-window`,
        kind: 'demWindow',
        bufferMetres,
        resolutionMetres,
      }),
    ],
  };
  const springFeatureCollection = {
    type: 'FeatureCollection',
    features: [pointFeature(spring, {
      id: `${siteId}-spring`,
      kind: 'springOutlet',
    })],
  };
  const qa = {
    siteId,
    engine,
    source: 'DataMapWales LiDAR DTM COG',
    sourceUrl: cogUrl,
    boundaryPath,
    generatedAt: new Date().toISOString(),
    spring,
    springBng: {
      easting: Number(springBng.easting.toFixed(3)),
      northing: Number(springBng.northing.toFixed(3)),
    },
    bounds,
    demReadBounds: demGrid.bounds,
    demNativeWindow: demGrid.nativeWindow,
    bufferMetres,
    resolutionMetres,
    snapRadiusMetres,
    snappedOutlet: snappedOutletMeta,
    outputs: {
      dem: demPath,
      catchmentRaster: basinTifPath,
      catchmentVector: catchmentVectorPath,
      catchmentRawVector: catchmentRawVectorPath,
      flowAccumulationRaster: accumulationTifPath,
      flowAccumulationPng: accumulationPngPath,
    },
    stats: {
      dem: demStats,
      accumulation: accumulationStats,
      catchment: catchmentStats,
    },
  };
  await writeJson(resolve(outputDir, 'dem-window.geojson'), demWindowFeatureCollection);
  await writeJson(resolve(outputDir, 'spring.geojson'), springFeatureCollection);
  await writeJson(metaPath, qa);
  console.log(JSON.stringify({
    siteId,
    engine,
    outputDir,
    demMin: demStats.min,
    demMax: demStats.max,
    accumulationMax: accumulationStats.max,
    catchmentCells: catchmentStats.sum,
    catchmentAreaHa: Number(((catchmentStats.sum || 0) * resolutionMetres * resolutionMetres / 10000).toFixed(4)),
    snappedOutlet: snappedOutletMeta.snappedCell,
    springBng: qa.springBng,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
