import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, parse } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const port = Number(process.env.PORT || 8097);
const dogSourcePath = process.env.DOG_SOURCE_IMAGE || process.env.SOURCE_IMAGE || '/home/peter/Downloads/dog.jpg';
const windmillSourcePath = process.env.WINDMILL_SOURCE_IMAGE || '/tmp/jobdone-marquetry/cley-windmill.jpg';
const woodSampleDir = process.env.WOOD_SAMPLE_DIR || '/home/peter/Pictures/marquerty/handsome-grain';
const outRoot = process.env.OUT_DIR || '/tmp/jobdone-imagemagick-playground';
const serverStartedAt = new Date().toISOString();
const recipeRendererVersion = 'wood-samples-v1';

const metalizeCopper = ['-colorspace', 'gray', '-shade', '115x52', '-sigmoidal-contrast', '7,47%', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'];
const lineOverlay = ['(', '+clone', '-colorspace', 'gray', '-edge', '1', '-negate', '-blur', '0x0.55', '-level', '16%,88%', ')', '-compose', 'multiply', '-composite'];

const variants = [
  {
    id: 'current',
    label: 'Current',
    args: ['-colorspace', 'gray', '-shade', '135x30', '-level', '10%,90%', '-colorspace', 'HSL', '-channel', 'lightness', '-level', '20%,80%', '+channel', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '35%', '-modulate', '100,50,100'],
  },
  {
    id: 'strong-relief',
    label: 'Stronger relief',
    args: ['-colorspace', 'gray', '-contrast-stretch', '2%x5%', '-shade', '120x45', '-sigmoidal-contrast', '5,50%', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'edge-relief',
    label: 'Edge then relief',
    args: ['(', '+clone', '-colorspace', 'gray', '-edge', '1', '-negate', '-blur', '0x0.6', '-level', '20%,90%', ')', '-compose', 'multiply', '-composite', '-colorspace', 'gray', '-shade', '120x42', '-level', '8%,92%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'edge-relief-deeper',
    label: 'Edge relief deeper',
    args: ['(', '+clone', '-colorspace', 'gray', '-edge', '1', '-negate', '-blur', '0x0.5', '-level', '16%,88%', ')', '-compose', 'multiply', '-composite', '-colorspace', 'gray', '-shade', '115x55', '-sigmoidal-contrast', '7,48%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'edge-relief-deepest',
    label: 'Edge relief deepest',
    args: ['(', '+clone', '-colorspace', 'gray', '-edge', '1.4', '-negate', '-blur', '0x0.45', '-level', '12%,86%', ')', '-compose', 'multiply', '-composite', '-colorspace', 'gray', '-shade', '110x65', '-sigmoidal-contrast', '9,48%', '-level', '4%,96%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '28%'],
  },
  {
    id: 'edge-relief-raised',
    label: 'Edge relief raised',
    args: ['(', '+clone', '-colorspace', 'gray', '-edge', '1', '-negate', '-blur', '0x0.55', '-level', '16%,88%', ')', '-compose', 'multiply', '-composite', '-colorspace', 'gray', '-emboss', '0x1.2', '-shade', '115x50', '-sigmoidal-contrast', '8,45%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '28%'],
  },
  {
    id: 'edge-relief-crisp',
    label: 'Edge relief crisp',
    args: ['(', '+clone', '-colorspace', 'gray', '-edge', '1', '-negate', '-blur', '0x0.35', '-level', '18%,86%', ')', '-compose', 'multiply', '-composite', '-colorspace', 'gray', '-unsharp', '0x1+1.2+0.02', '-shade', '115x58', '-sigmoidal-contrast', '7,48%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '28%'],
  },
  {
    id: 'bg-flatten',
    label: 'Background flattened',
    args: ['(', '+clone', '-colorspace', 'gray', '-blur', '0x10', '-level', '35%,100%', ')', '-compose', 'lighten', '-composite', '-colorspace', 'gray', '-shade', '125x38', '-sigmoidal-contrast', '7,45%', '-level', '8%,92%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '35%'],
  },
  {
    id: 'current-deeper',
    label: 'Current deeper',
    args: ['-colorspace', 'gray', '-shade', '125x45', '-sigmoidal-contrast', '6,48%', '-level', '7%,93%', '-colorspace', 'HSL', '-channel', 'lightness', '-level', '18%,82%', '+channel', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '35%', '-modulate', '100,50,100'],
  },
  {
    id: 'current-crisper',
    label: 'Current crisper',
    args: ['-colorspace', 'gray', '-unsharp', '0x0.8+0.8+0.01', '-shade', '130x42', '-sigmoidal-contrast', '6,48%', '-level', '8%,92%', '-colorspace', 'HSL', '-channel', 'lightness', '-level', '18%,82%', '+channel', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '33%', '-modulate', '100,50,100'],
  },
  {
    id: 'strong-relief-clean',
    label: 'Strong relief clean',
    engine: 'gmic+magick',
    gmic: ['kuwahara', '1.5'],
    args: ['-colorspace', 'gray', '-contrast-stretch', '2%x5%', '-shade', '120x55', '-sigmoidal-contrast', '6,50%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'strong-relief-more-depth',
    label: 'Strong relief more depth',
    args: ['-colorspace', 'gray', '-contrast-stretch', '2%x5%', '-shade', '115x65', '-sigmoidal-contrast', '8,50%', '-level', '4%,96%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'bg-flatten-deeper',
    label: 'Background flattened deeper',
    args: ['(', '+clone', '-colorspace', 'gray', '-blur', '0x12', '-level', '38%,100%', ')', '-compose', 'lighten', '-composite', '-colorspace', 'gray', '-shade', '120x58', '-sigmoidal-contrast', '8,45%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '34%'],
  },
  {
    id: 'bg-flatten-crisper',
    label: 'Background flattened crisper',
    args: ['(', '+clone', '-colorspace', 'gray', '-blur', '0x8', '-level', '33%,100%', ')', '-compose', 'lighten', '-composite', '-colorspace', 'gray', '-unsharp', '0x0.8+0.7+0.01', '-shade', '125x50', '-sigmoidal-contrast', '7,45%', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '34%'],
  },
  {
    id: 'canny-relief',
    label: 'Canny relief',
    args: ['(', '+clone', '-colorspace', 'gray', '-canny', '0x1+10%+30%', '-negate', '-blur', '0x0.7', '-level', '15%,88%', ')', '-compose', 'multiply', '-composite', '-colorspace', 'gray', '-shade', '115x45', '-sigmoidal-contrast', '6,45%', '-level', '7%,93%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'foreground-pop',
    label: 'Foreground pop',
    args: ['-colorspace', 'gray', '-median', '2', '-unsharp', '0x1.2+1.3+0.02', '-shade', '110x50', '-sigmoidal-contrast', '8,42%', '-level', '5%,92%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '28%'],
  },
  {
    id: 'soft-background',
    label: 'Soft background',
    args: ['(', '+clone', '-blur', '0x5', ')', '-compose', 'blend', '-define', 'compose:args=35', '-composite', '-colorspace', 'gray', '-shade', '115x45', '-sigmoidal-contrast', '6,45%', '-level', '8%,93%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'high-contour',
    label: 'High contour',
    args: ['-colorspace', 'gray', '-morphology', 'EdgeOut', 'Diamond:2', '-negate', '-blur', '0x0.8', '-shade', '120x50', '-sigmoidal-contrast', '8,40%', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'bumpmap-metal',
    label: 'Bumpmap metal',
    args: ['(', '+clone', '-colorspace', 'gray', '-edge', '1', '-negate', '-blur', '0x0.7', '-level', '18%,88%', ')', '(', '+clone', '-colorspace', 'gray', '-shade', '115x55', '-sigmoidal-contrast', '8,48%', ')', '-compose', 'bumpmap', '-composite', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'overlay-metal',
    label: 'Overlay metal',
    args: ['(', '+clone', '-colorspace', 'gray', '-shade', '110x55', '-sigmoidal-contrast', '8,50%', ')', '-compose', 'overlay', '-composite', '-colorspace', 'gray', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'etched-relief',
    label: 'Etched relief',
    args: ['-colorspace', 'gray', '-morphology', 'EdgeOut', 'Octagon:2', '-negate', '-blur', '0x0.55', '-level', '20%,90%', '-shade', '110x60', '-sigmoidal-contrast', '9,45%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '28%'],
  },
  {
    id: 'emboss-plus-shade',
    label: 'Emboss plus shade',
    args: ['(', '+clone', '-colorspace', 'gray', '-emboss', '0x1.4', '-level', '18%,88%', ')', '(', '+clone', '-colorspace', 'gray', '-shade', '115x55', '-sigmoidal-contrast', '8,48%', ')', '-compose', 'multiply', '-composite', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'paint-lines-metal',
    label: 'Paint + lines + metal',
    args: ['-paint', '4', '-posterize', '5', ...lineOverlay, ...metalizeCopper],
  },
  {
    id: 'paint-bold-metal',
    label: 'Paint bold metal',
    args: ['-paint', '7', '-posterize', '4', '(', '+clone', '-colorspace', 'gray', '-canny', '0x2+8%+20%', '-negate', '-blur', '0x0.5', '-level', '12%,86%', ')', '-compose', 'multiply', '-composite', ...metalizeCopper],
  },
  {
    id: 'sketch-metal',
    label: 'Sketch metal',
    args: ['-colorspace', 'gray', '-sketch', '0x20+120', '-negate', '-level', '12%,90%', '-shade', '120x48', '-level', '8%,92%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'poster-lines-metal',
    label: 'Poster lines metal',
    args: ['-colorspace', 'gray', '-median', '3', '-posterize', '5', '(', '+clone', '-morphology', 'EdgeOut', 'Diamond:2', '-negate', '-blur', '0x0.7', '-level', '14%,88%', ')', '-compose', 'multiply', '-composite', ...metalizeCopper],
  },
  {
    id: 'sparse-outline-metal',
    label: 'Sparse outline metal',
    args: ['-colorspace', 'gray', '-median', '2', '(', '+clone', '-canny', '0x3+5%+15%', '-negate', '-blur', '0x0.7', '-level', '18%,92%', ')', '-compose', 'multiply', '-composite', '-posterize', '6', ...metalizeCopper],
  },
  {
    id: 'artist-block-metal',
    label: 'Artist block metal',
    args: ['-colorspace', 'gray', '-blur', '0x1.2', '-posterize', '4', '-median', '2', '(', '+clone', '-edge', '1', '-negate', '-blur', '0x0.5', '-level', '15%,88%', ')', '-compose', 'multiply', '-composite', ...metalizeCopper],
  },
  {
    id: 'kuwahara-height-metal',
    label: 'Kuwahara height metal',
    engine: 'gmic+magick',
    gmic: ['kuwahara', '3'],
    args: ['-colorspace', 'gray', '-sigmoidal-contrast', '5,48%', '-shade', '112x58', '-sigmoidal-contrast', '8,48%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'bilateral-height-metal',
    label: 'Bilateral height metal',
    engine: 'gmic+magick',
    gmic: ['smooth', '30,0,1,1,2'],
    args: ['-colorspace', 'gray', '-sigmoidal-contrast', '6,48%', '-shade', '112x60', '-sigmoidal-contrast', '8,48%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'mean-shift-metal',
    label: 'Mean shift metal',
    engine: 'gmic+magick',
    gmic: ['cartoon', '2,60,10,0.55,1.2'],
    args: ['-colorspace', 'gray', '-posterize', '7', '-shade', '112x58', '-sigmoidal-contrast', '8,48%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'kmeans-five-metal',
    label: 'Five tone metal',
    args: ['-posterize', '5', '-colorspace', 'gray', '-median', '2', '-shade', '112x58', '-sigmoidal-contrast', '8,48%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'clean-outline-height',
    label: 'Clean outline height',
    engine: 'gmic+magick',
    gmic: ['kuwahara', '2'],
    args: ['-colorspace', 'gray', '(', '+clone', '-canny', '0x2+4%+14%', '-negate', '-blur', '0x0.6', '-level', '18%,90%', ')', '-compose', 'multiply', '-composite', '-sigmoidal-contrast', '5,48%', '-shade', '112x58', '-sigmoidal-contrast', '8,48%', '-level', '5%,95%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'essence-more-relief',
    label: 'Essence more relief',
    engine: 'gmic+magick',
    gmic: ['kuwahara', '2'],
    args: ['-colorspace', 'gray', '-contrast-stretch', '2%x4%', '-sigmoidal-contrast', '7,48%', '-shade', '108x65', '-sigmoidal-contrast', '9,48%', '-level', '4%,96%', '-colorspace', 'HSL', '-channel', 'lightness', '-level', '16%,84%', '+channel', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'gmic-cartoon-metal',
    label: 'G’MIC cartoon metal',
    engine: 'gmic+magick',
    gmic: ['cartoon', '3,80,15,0.75,1.5'],
    args: ['-colorspace', 'gray', '-shade', '120x50', '-sigmoidal-contrast', '7,48%', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'gmic-smooth-metal',
    label: 'G’MIC smooth metal',
    engine: 'gmic+magick',
    gmic: ['smooth', '30,0,1,1,2'],
    args: ['-colorspace', 'gray', '-shade', '120x50', '-sigmoidal-contrast', '7,48%', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'gmic-kuwahara-metal',
    label: 'G’MIC Kuwahara metal',
    engine: 'gmic+magick',
    gmic: ['kuwahara', '3'],
    args: ['-colorspace', 'gray', '-shade', '120x50', '-sigmoidal-contrast', '7,48%', '-level', '6%,94%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'gmic-pencil-metal',
    label: 'G’MIC pencil metal',
    engine: 'gmic+magick',
    gmic: ['fx_pencilbw', '1,200,0,0,0,0,0,0,0,0,0,0,0,0,0'],
    args: ['-colorspace', 'gray', '-shade', '120x45', '-sigmoidal-contrast', '6,48%', '-level', '7%,93%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'gmic-pencil-clean-metal',
    label: 'G’MIC pencil clean metal',
    engine: 'gmic+magick',
    gmic: ['fx_pencilbw', '1,160,0,0,0,0,0,0,0,0,0,0,0,0,0'],
    args: ['-colorspace', 'gray', '-median', '1', '-blur', '0x0.25', '-level', '8%,92%', '-shade', '120x45', '-sigmoidal-contrast', '6,48%', '-level', '7%,93%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'gmic-pencil-essence-metal',
    label: 'G’MIC pencil essence metal',
    engine: 'gmic+magick',
    gmic: ['fx_pencilbw', '1,130,0,0,0,0,0,0,0,0,0,0,0,0,0'],
    args: ['-colorspace', 'gray', '-blur', '0x0.45', '-sigmoidal-contrast', '4,48%', '-level', '10%,90%', '-shade', '125x42', '-sigmoidal-contrast', '6,48%', '-level', '7%,93%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'gmic-pencil-current-blend',
    label: 'G’MIC pencil current blend',
    engine: 'gmic+magick',
    gmic: ['fx_pencilbw', '1,150,0,0,0,0,0,0,0,0,0,0,0,0,0'],
    args: ['(', '__SOURCE__', '-auto-orient', '-resize', '768x1024>', '-colorspace', 'gray', '-shade', '135x30', '-level', '10%,90%', ')', '(', '+clone', '-colorspace', 'gray', '-blur', '0x0.35', '-level', '12%,90%', ')', '-compose', 'multiply', '-composite', '-sigmoidal-contrast', '5,48%', '-level', '7%,93%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '32%'],
  },
  {
    id: 'gmic-pencil-soft-lines',
    label: 'G’MIC pencil soft lines',
    engine: 'gmic+magick',
    gmic: ['fx_pencilbw', '1,120,0,0,0,0,0,0,0,0,0,0,0,0,0'],
    args: ['-colorspace', 'gray', '-morphology', 'Close', 'Diamond:1', '-blur', '0x0.35', '-level', '12%,88%', '-shade', '122x42', '-sigmoidal-contrast', '5,48%', '-level', '8%,92%', '-colorspace', 'sRGB', '-fill', 'rgb(184,105,55)', '-colorize', '30%'],
  },
  {
    id: 'marquetry-four-veneer',
    label: 'Marquetry four veneer',
    args: ['-auto-level', '-colorspace', 'gray', '-posterize', '4', '-ordered-dither', 'o4x4,4', '-fill', '#8b5a2b', '-opaque', 'black', '-fill', '#b98245', '-opaque', 'gray33', '-fill', '#d6a15c', '-opaque', 'gray67', '-fill', '#f0d49a', '-opaque', 'white'],
  },
  {
    id: 'marquetry-six-flat',
    label: 'Marquetry six flat',
    args: ['-auto-level', '-colorspace', 'gray', '-posterize', '6', '-colorspace', 'sRGB', '-fill', '#3b2415', '-opaque', 'black', '-fill', '#6f4224', '-opaque', 'gray20', '-fill', '#9a6332', '-opaque', 'gray40', '-fill', '#c48a46', '-opaque', 'gray60', '-fill', '#ddb66f', '-opaque', 'gray80', '-fill', '#f3ddb0', '-opaque', 'white'],
  },
  {
    id: 'marquetry-cartoon-veneer',
    label: 'Marquetry cartoon veneer',
    engine: 'gmic+magick',
    gmic: ['cartoon', '3,70,12,0.6,1.2'],
    args: ['-auto-level', '-colorspace', 'gray', '-posterize', '5', '-colorspace', 'sRGB', '-fill', '#4a2b16', '-opaque', 'black', '-fill', '#7a4a25', '-opaque', 'gray25', '-fill', '#ad7338', '-opaque', 'gray50', '-fill', '#d4a15b', '-opaque', 'gray75', '-fill', '#f2d7a2', '-opaque', 'white'],
  },
  {
    id: 'marquetry-boundaries',
    label: 'Marquetry boundaries',
    engine: 'gmic+magick',
    gmic: ['cartoon', '2,50,8,0.5,1.0'],
    args: ['-auto-level', '-colorspace', 'gray', '-posterize', '5', '(', '+clone', '-morphology', 'EdgeOut', 'Diamond:1', '-negate', '-threshold', '45%', ')', '-compose', 'multiply', '-composite', '-colorspace', 'sRGB', '-fill', '#4a2b16', '-opaque', 'black', '-fill', '#7a4a25', '-opaque', 'gray25', '-fill', '#ad7338', '-opaque', 'gray50', '-fill', '#d4a15b', '-opaque', 'gray75', '-fill', '#f2d7a2', '-opaque', 'white'],
  },
  {
    id: 'marquetry-grain-preview',
    label: 'Marquetry grain preview',
    engine: 'gmic+magick',
    gmic: ['cartoon', '3,60,10,0.55,1.1'],
    args: ['-auto-level', '-colorspace', 'gray', '-posterize', '5', '-colorspace', 'sRGB', '(', '+clone', '-size', '768x1024', 'plasma:fractal', '-colorspace', 'gray', '-motion-blur', '0x12+8', '-level', '20%,80%', ')', '-compose', 'soft-light', '-composite', '-fill', '#8b5a2b', '-colorize', '35%'],
  },
  {
    id: 'marquetry-two-samples',
    label: 'Marquetry two samples',
    engine: 'marquetry-js',
    levels: 2,
  },
  {
    id: 'marquetry-three-samples',
    label: 'Marquetry three samples',
    engine: 'marquetry-js',
    levels: 3,
  },
  {
    id: 'marquetry-four-samples',
    label: 'Marquetry four samples',
    engine: 'marquetry-js',
    levels: 4,
  },
  {
    id: 'marquetry-five-samples',
    label: 'Marquetry five samples',
    engine: 'marquetry-js',
    levels: 5,
  },
  {
    id: 'marquetry-sky-flat-three',
    label: 'Marquetry flat sky three',
    engine: 'marquetry-js',
    levels: 3,
    flattenSky: true,
  },
  {
    id: 'marquetry-sky-flat-four',
    label: 'Marquetry flat sky four',
    engine: 'marquetry-js',
    levels: 4,
    flattenSky: true,
  },
  {
    id: 'marquetry-sky-flat-outline',
    label: 'Marquetry flat sky outline',
    engine: 'marquetry-js',
    levels: 4,
    flattenSky: true,
    outline: true,
  },
  {
    id: 'marquetry-composed-three',
    label: 'Marquetry composed three',
    engine: 'marquetry-js',
    levels: 3,
    flattenBackground: true,
    simplifyForeground: true,
    subjectFocus: true,
  },
  {
    id: 'marquetry-composed-four',
    label: 'Marquetry composed four',
    engine: 'marquetry-js',
    levels: 4,
    flattenBackground: true,
    simplifyForeground: true,
    subjectFocus: true,
    outline: true,
  },
  {
    id: 'marquetry-thirds-focus',
    label: 'Marquetry thirds focus',
    engine: 'marquetry-js',
    levels: 4,
    flattenBackground: true,
    simplifyForeground: true,
    subjectFocus: true,
    thirdsFocus: true,
    outline: true,
  },
  {
    id: 'marquetry-big-areas-etched-detail',
    label: 'Marquetry big areas + etched detail',
    engine: 'marquetry-js',
    levels: 3,
    flattenBackground: true,
    simplifyForeground: true,
    subjectFocus: true,
    outline: true,
    etchDetail: true,
  },
];

const clients = new Set();
const generatedGalleries = new Set();
let woodLibraryPromise = null;

function galleryForName(name = 'dogs') {
  const selected = name === 'windmills' ? 'windmills' : 'dogs';
  const marquetry = (variant) => variant.id.startsWith('marquetry-');
  return {
    name: selected,
    title: selected === 'windmills' ? 'Windmills / Marquetry' : 'Dogs / Embossed Metal',
    sourcePath: selected === 'windmills' ? windmillSourcePath : dogSourcePath,
    outDir: join(outRoot, selected),
    variants: variants.filter((variant) => selected === 'windmills' ? marquetry(variant) : !marquetry(variant)),
  };
}

function galleryFromUrl(url) {
  if (url.pathname.startsWith('/windmills')) return galleryForName('windmills');
  return galleryForName('dogs');
}

function galleryPath(gallery, name) {
  return join(gallery.outDir, name);
}

const ammoniteAssetDir = process.env.AMMONITE_ASSET_DIR || '/home/peter/cnc-workshop-tools/local/ammonite-target';
const ammoniteAssets = {
  root: ammoniteAssetDir,
  slug: 'ammonite-sculpture-target-seed-7',
  manifestPath: join(ammoniteAssetDir, 'manifest.json'),
  paramsPath: join(ammoniteAssetDir, 'ammonite-sculpture-target-seed-7.json'),
  previewPath: join(ammoniteAssetDir, 'preview0001.png'),
  stlPath: join(ammoniteAssetDir, 'ammonite-sculpture-target-seed-7.stl'),
  objPath: join(ammoniteAssetDir, 'ammonite-sculpture-target-seed-7.obj'),
  blendPath: join(ammoniteAssetDir, 'ammonite-sculpture-target-seed-7.blend'),
};

const defaultAmmoniteDsl = `form ammonite
  source sculpture-target
  size 650mm

pattern celtic-knot
  source generated-tile
  scale 1.0
  flow spiral
  relief raised 0.8mm

surface outer-ribs
  project pattern celtic-knot

manufacture foam-slab
  slab-thickness 50mm
  registration removable-ears

export stl
export slice-plan
`;

function parseMeasureMm(value) {
  const match = String(value || '').match(/^([0-9]+(?:\.[0-9]+)?)mm$/);
  return match ? Number(match[1]) : null;
}

function parseAmmoniteDsl(source = defaultAmmoniteDsl) {
  const plan = { type: 'threeDRecipe', form: {}, patterns: [], surfaces: [], manufacturing: {}, exports: [] };
  const diagnostics = [];
  let block = null;
  let currentPattern = null;
  let currentSurface = null;
  const lines = String(source || '').replace(/\t/g, '  ').split(/\r?\n/);
  const fail = (line, message) => diagnostics.push({ line, message });
  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^ */)[0].length;
    const parts = line.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    if (indent === 0) block = null;
    if (indent === 0 && command === 'form') {
      if (args.join(' ') !== 'ammonite') fail(lineNumber, 'Expected "form ammonite".');
      plan.form.kind = 'ammonite';
      block = 'form';
      currentPattern = null;
      currentSurface = null;
      continue;
    }
    if (indent === 0 && command === 'pattern') {
      if (args.join(' ') !== 'celtic-knot') fail(lineNumber, 'Only "pattern celtic-knot" is supported in this slice.');
      currentPattern = { kind: 'celtic-knot' };
      plan.patterns.push(currentPattern);
      block = 'pattern';
      currentSurface = null;
      continue;
    }
    if (indent === 0 && command === 'surface') {
      if (args.join(' ') !== 'outer-ribs') fail(lineNumber, 'Only "surface outer-ribs" is supported in this slice.');
      currentSurface = { name: 'outer-ribs' };
      plan.surfaces.push(currentSurface);
      block = 'surface';
      currentPattern = null;
      continue;
    }
    if (indent === 0 && command === 'manufacture') {
      if (args.join(' ') !== 'foam-slab') fail(lineNumber, 'Expected "manufacture foam-slab".');
      plan.manufacturing.process = 'foam-slab';
      block = 'manufacture';
      currentPattern = null;
      currentSurface = null;
      continue;
    }
    if (indent === 0 && command === 'export') {
      if (args.length !== 1 || !['stl', 'obj', 'blend', 'slice-plan'].includes(args[0])) {
        fail(lineNumber, 'Expected export stl, obj, blend, or slice-plan.');
      } else if (!plan.exports.includes(args[0])) {
        plan.exports.push(args[0]);
      }
      continue;
    }
    if (indent === 0) {
      fail(lineNumber, `Unknown top-level command "${command}".`);
      continue;
    }
    if (block === 'form' && command === 'source') {
      if (args.join(' ') !== 'sculpture-target') fail(lineNumber, 'Only "source sculpture-target" is supported in this slice.');
      plan.form.source = 'sculpture-target';
      plan.form.asset = ammoniteAssets.slug;
      continue;
    }
    if (block === 'form' && command === 'size') {
      const mm = parseMeasureMm(args[0]);
      if (args.length !== 1 || mm === null) fail(lineNumber, 'Expected size such as 650mm.');
      plan.form.sizeMm = mm;
      continue;
    }
    if (block === 'pattern' && command === 'source') {
      if (args.join(' ') !== 'generated-tile') fail(lineNumber, 'Only "source generated-tile" is supported in this slice.');
      currentPattern.source = 'generated-tile';
      continue;
    }
    if (block === 'pattern' && command === 'scale') {
      const scale = Number(args[0]);
      if (args.length !== 1 || !Number.isFinite(scale) || scale <= 0) fail(lineNumber, 'Expected positive numeric scale.');
      currentPattern.scale = scale;
      continue;
    }
    if (block === 'pattern' && command === 'flow') {
      if (args.join(' ') !== 'spiral') fail(lineNumber, 'Only "flow spiral" is supported in this slice.');
      currentPattern.flow = 'spiral';
      continue;
    }
    if (block === 'pattern' && command === 'relief') {
      if (args[0] !== 'raised') fail(lineNumber, 'Only raised relief is supported in this slice.');
      const heightMm = parseMeasureMm(args[1]);
      if (args.length !== 2 || heightMm === null) fail(lineNumber, 'Expected relief raised <height>mm.');
      currentPattern.relief = { kind: 'raised', heightMm };
      continue;
    }
    if (block === 'surface' && command === 'project') {
      if (args.join(' ') !== 'pattern celtic-knot') fail(lineNumber, 'Expected "project pattern celtic-knot".');
      currentSurface.projection = { pattern: 'celtic-knot' };
      continue;
    }
    if (block === 'manufacture' && command === 'slab-thickness') {
      const mm = parseMeasureMm(args[0]);
      if (args.length !== 1 || mm === null) fail(lineNumber, 'Expected slab thickness such as 50mm.');
      plan.manufacturing.slabThicknessMm = mm;
      continue;
    }
    if (block === 'manufacture' && command === 'registration') {
      if (args.join(' ') !== 'removable-ears') fail(lineNumber, 'Only "registration removable-ears" is supported in this slice.');
      plan.manufacturing.registration = 'removable-ears';
      continue;
    }
    fail(lineNumber, `Unknown ${block || 'nested'} command "${command}".`);
  }
  if (plan.form.kind !== 'ammonite') fail(0, 'Missing form ammonite.');
  if (plan.form.source !== 'sculpture-target') fail(0, 'Missing source sculpture-target.');
  if (!plan.form.sizeMm) fail(0, 'Missing size.');
  if (!plan.patterns.length) fail(0, 'Missing pattern celtic-knot.');
  if (!plan.surfaces.length) fail(0, 'Missing surface outer-ribs.');
  if (plan.manufacturing.process !== 'foam-slab') fail(0, 'Missing manufacture foam-slab.');
  return { text: source, plan, diagnostics };
}

function celticPatternSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160">
    <rect width="320" height="160" fill="#f6f1df"/>
    <g fill="none" stroke="#3a2414" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 80 C70 10, 120 10, 160 80 S250 150, 300 80"/>
      <path d="M20 80 C70 150, 120 150, 160 80 S250 10, 300 80"/>
      <path d="M80 24 C118 58, 118 102, 80 136"/>
      <path d="M240 24 C202 58, 202 102, 240 136"/>
    </g>
    <g fill="none" stroke="#d7a65a" stroke-width="5" stroke-linecap="round">
      <path d="M20 80 C70 10, 120 10, 160 80 S250 150, 300 80"/>
      <path d="M20 80 C70 150, 120 150, 160 80 S250 10, 300 80"/>
    </g>
  </svg>`;
}

async function ammoniteDiagnostics(parsed) {
  const manifest = JSON.parse(await readFile(ammoniteAssets.manifestPath, 'utf8'));
  const record = manifest.ammonites?.[0] || {};
  const manufacturing = record.manufacturing_plan || {};
  const warnings = [
    manufacturing.warning,
    'Generated slab meshes are visual/planning geometry, not roughing/finishing CAM.',
    'Museum/reference scans require attribution and licence re-check before publication.',
    'Celtic pattern projection is intent-only until Blender/surface projection is implemented.',
  ].filter(Boolean);
  return {
    selectedAsset: record.slug || ammoniteAssets.slug,
    paths: {
      preview: ammoniteAssets.previewPath,
      stl: ammoniteAssets.stlPath,
      obj: ammoniteAssets.objPath,
      blend: ammoniteAssets.blendPath,
      manifest: ammoniteAssets.manifestPath,
    },
    params: record.params || {},
    manufacturing: {
      status: manufacturing.status,
      slabCount: manufacturing.slab_count,
      slabThicknessMm: manufacturing.slab_thickness_mm,
      stockBoundsMm: manufacturing.stock_bounds_mm,
      modelBoundsMm: manufacturing.model_bounds_mm,
      registrationHolesMm: manufacturing.registration_holes_mm,
    },
    warnings,
    requestedPlan: parsed.plan,
  };
}

async function ammonitePage() {
  const parsed = parseAmmoniteDsl();
  const diagnostics = await ammoniteDiagnostics(parsed);
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ammonite 3D DSL</title>
<style>
body { margin: 0; font-family: system-ui, sans-serif; background: #f6f4ef; color: #171717; }
header { position: sticky; top: 0; padding: 12px 16px; background: #fff; border-bottom: 1px solid #ddd; }
h1 { margin: 0; font-size: 18px; }
header p { margin: 4px 0 0; font-size: 13px; color: #555; }
.workspace { display: grid; grid-template-columns: minmax(280px, 0.8fr) minmax(280px, 1fr); gap: 12px; padding: 12px; }
section { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
textarea { box-sizing: border-box; width: 100%; min-height: 280px; padding: 10px; font: 13px ui-monospace, monospace; border: 1px solid #bbb; border-radius: 4px; }
img { display: block; width: 100%; height: auto; background: #eee; }
pre { overflow: auto; padding: 10px; background: #171717; color: #f3f3f3; border-radius: 4px; font-size: 12px; }
ul { padding-left: 18px; }
a { color: #0645ad; }
@media (max-width: 800px) { .workspace { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header><h1>Ammonite 3D DSL</h1><p><a href="/windmills">windmills</a> · <a href="/dogs">dogs</a> · <a href="/ammonites">ammonites</a></p></header>
<main class="workspace">
  <section>
    <h2>Recipe DSL</h2>
    <textarea spellcheck="false" readonly>${escapeHtml(parsed.text)}</textarea>
    <h2>Parsed Recipe Plan</h2>
    <pre>${escapeHtml(JSON.stringify(parsed.plan, null, 2))}</pre>
  </section>
  <section>
    <h2>Preview</h2>
    <img src="/ammonites/assets/preview0001.png" alt="Generated ammonite preview">
    <h2>2D Pattern</h2>
    <img src="/ammonites/patterns/celtic-knot.svg" alt="Generated Celtic knot placeholder pattern">
    <h2>Outputs</h2>
    <ul>
      <li><a href="/ammonites/assets/ammonite-sculpture-target-seed-7.stl">STL</a></li>
      <li><a href="/ammonites/assets/ammonite-sculpture-target-seed-7.obj">OBJ</a></li>
      <li><a href="/ammonites/assets/ammonite-sculpture-target-seed-7.blend">Blend</a></li>
      <li><a href="/ammonites/manifest.json">Manifest JSON</a></li>
    </ul>
    <h2>Diagnostics</h2>
    <pre>${escapeHtml(JSON.stringify(diagnostics, null, 2))}</pre>
  </section>
</main>
</body>
</html>`;
}

function notifyReload() {
  for (const res of clients) {
    res.write(`event: reload\ndata: ${Date.now()}\n\n`);
  }
}

function send(res, status, body, type = 'text/html; charset=utf-8') {
  const data = Buffer.from(body);
  res.writeHead(status, { 'content-type': type, 'content-length': data.length, 'cache-control': 'no-store' });
  res.end(data);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 12);
}

async function generate(gallery = galleryForName('dogs')) {
  await mkdir(gallery.outDir, { recursive: true });
  const errors = {};
  for (const variant of gallery.variants) {
    const output = galleryPath(gallery, `${variant.id}.png`);
    try {
      if (variant.engine === 'marquetry-js') {
        await renderMarquetryJs(gallery.sourcePath, output, {
          levels: variant.levels || 3,
          flattenSky: Boolean(variant.flattenSky),
          flattenBackground: Boolean(variant.flattenBackground),
          simplifyForeground: Boolean(variant.simplifyForeground),
          subjectFocus: Boolean(variant.subjectFocus),
          thirdsFocus: Boolean(variant.thirdsFocus),
          outline: Boolean(variant.outline),
          etchDetail: Boolean(variant.etchDetail),
        });
        continue;
      }
      if (variant.engine === 'gmic+magick') {
        const normalized = galleryPath(gallery, `${variant.id}.input.png`);
        const preprocessed = galleryPath(gallery, `${variant.id}.pre.png`);
        await execFileAsync(process.env.MAGICK_BIN || 'magick', [
          gallery.sourcePath,
          '-auto-orient',
          '-resize',
          '768x1024>',
          normalized,
        ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        await execFileAsync(process.env.GMIC_BIN || 'gmic', [
          'input',
          normalized,
          ...(variant.gmic || []),
          'output',
          preprocessed,
        ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
        await execFileAsync(process.env.MAGICK_BIN || 'magick', [preprocessed, ...variant.args.map((arg) => arg === '__SOURCE__' ? gallery.sourcePath : arg), output], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        continue;
      }
      const args = [
        gallery.sourcePath,
        '-auto-orient',
        '-resize',
        '768x1024>',
        ...variant.args.map((arg) => arg === '__SOURCE__' ? gallery.sourcePath : arg),
        output,
      ];
      await execFileAsync(process.env.MAGICK_BIN || 'magick', args, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      try {
        await stat(output);
      } catch {
        errors[variant.id] = error.message || String(error);
      }
    }
  }
  await writeFile(galleryPath(gallery, 'generation-errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
  await writeFile(galleryPath(gallery, 'metrics.json'), `${JSON.stringify(await scoreVariants(gallery), null, 2)}\n`);
  await refreshProject(gallery);
  generatedGalleries.add(gallery.name);
  notifyReload();
}

async function sourceGrayPixels(path, width = 512, height = 682) {
  const magick = process.env.MAGICK_BIN || 'magick';
  const { stdout } = await execFileAsync(magick, [
    path,
    '-auto-orient',
    '-resize',
    `${width}x${height}!`,
    '-colorspace',
    'gray',
    '-depth',
    '8',
    'gray:-',
  ], { encoding: 'buffer', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  return new Uint8Array(stdout);
}

const fallbackWoodSamples = [
  { name: 'walnut', rgb: [70, 39, 18], angle: 0.8, frequency: 0.050 },
  { name: 'cedar', rgb: [130, 73, 34], angle: -0.35, frequency: 0.044 },
  { name: 'oak', rgb: [177, 117, 52], angle: 0.12, frequency: 0.038 },
  { name: 'ash', rgb: [220, 171, 95], angle: 0.42, frequency: 0.033 },
  { name: 'bright', rgb: [238, 207, 145], angle: -0.7, frequency: 0.030 },
];

function materialNameFromFile(file) {
  return parse(file).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function contrastBucket(value) {
  if (value >= 0.22) return 'high-contrast';
  if (value >= 0.13) return 'medium-contrast';
  return 'quiet';
}

function brightnessBucket(value) {
  if (value >= 0.68) return 'light';
  if (value >= 0.42) return 'mid';
  return 'dark';
}

async function loadWoodLibrary() {
  if (woodLibraryPromise) return woodLibraryPromise;
  woodLibraryPromise = (async () => {
    const magick = process.env.MAGICK_BIN || 'magick';
    const materialsDir = join(outRoot, 'materials');
    await mkdir(materialsDir, { recursive: true });
    let files = [];
    try {
      files = (await readdir(woodSampleDir))
        .filter((file) => ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(file).toLowerCase()))
        .sort();
    } catch {
      return fallbackWoodSamples;
    }
    const samples = [];
    for (const file of files) {
      const name = materialNameFromFile(file);
      const source = join(woodSampleDir, file);
      const tilePath = join(materialsDir, `${name}.png`);
      try {
        await execFileAsync(magick, [
          source,
          '-auto-orient',
          '-resize',
          '768x768^',
          '-gravity',
          'center',
          '-crop',
          '512x512+0+0',
          '+repage',
          '-strip',
          tilePath,
        ], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
        const { stdout } = await execFileAsync(magick, [
          tilePath,
          '-resize',
          '512x512!',
          '-depth',
          '8',
          'rgb:-',
        ], { encoding: 'buffer', timeout: 15000, maxBuffer: 512 * 512 * 3 + 1024 });
        const pixels = new Uint8Array(stdout);
        let r = 0;
        let g = 0;
        let b = 0;
        const lumas = [];
        for (let index = 0; index < pixels.length; index += 3) {
          r += pixels[index];
          g += pixels[index + 1];
          b += pixels[index + 2];
          lumas.push((pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) / 255);
        }
        const count = pixels.length / 3;
        const meanLuma = lumas.reduce((sum, value) => sum + value, 0) / count;
        const variance = lumas.reduce((sum, value) => sum + ((value - meanLuma) ** 2), 0) / count;
        samples.push({
          name,
          source,
          tilePath,
          tileUrl: `/materials/${name}.png`,
          rgb: [Math.round(r / count), Math.round(g / count), Math.round(b / count)],
          luma: Number(meanLuma.toFixed(3)),
          contrast: Number(Math.sqrt(variance).toFixed(3)),
          brightness: brightnessBucket(meanLuma),
          contrastBand: contrastBucket(Math.sqrt(variance)),
          angle: 0,
          frequency: 0.045,
          pixels,
          width: 512,
          height: 512,
        });
      } catch {
        // Bad sample files should not stop the playground; they can be replaced later.
      }
    }
    return samples.length ? samples.sort((a, b) => a.luma - b.luma) : fallbackWoodSamples;
  })();
  return woodLibraryPromise;
}

async function woodPalette(levels, requestedNames = []) {
  const library = await loadWoodLibrary();
  const byName = new Map(library.map((sample) => [sample.name, sample]));
  const requested = requestedNames.map((name) => byName.get(name)).filter(Boolean);
  const source = requested.length ? requested : library;
  if (source.length <= levels) return source;
  if (levels <= 1) return [source[Math.floor(source.length / 2)]];
  const selected = [];
  for (let index = 0; index < levels; index += 1) {
    selected.push(source[Math.round(index * (source.length - 1) / (levels - 1))]);
  }
  return selected;
}

function grainValue(x, y, sample) {
  const projected = x * Math.cos(sample.angle) + y * Math.sin(sample.angle);
  const slow = Math.sin(projected * sample.frequency);
  const fast = Math.sin(projected * sample.frequency * 3.7 + Math.sin(y * 0.021) * 2.4);
  return slow * 0.12 + fast * 0.05;
}

function sampleTexture(sample, x, y, fallbackShade = 1) {
  if (!sample.pixels) {
    return sample.rgb;
  }
  const angle = sample.angle || 0;
  const centreX = x - 256;
  const centreY = y - 341;
  const tx = Math.round((centreX * Math.cos(angle) - centreY * Math.sin(angle) + 4096)) % sample.width;
  const ty = Math.round((centreX * Math.sin(angle) + centreY * Math.cos(angle) + 4096)) % sample.height;
  const offset = (ty * sample.width + tx) * 3;
  return [sample.pixels[offset], sample.pixels[offset + 1], sample.pixels[offset + 2]];
}

async function renderMarquetryJs(source, output, {
  levels = 3,
  flattenSky = false,
  flattenBackground = false,
  backgroundMaterial = null,
  foregroundMaterial = null,
  primaryInterestMaterial = null,
  grainAngle = null,
  simplifyForeground = false,
  subjectFocus = false,
  thirdsFocus = false,
  outline = false,
  etchDetail = false,
  paletteMaterialNames = [],
} = {}) {
  const width = 512;
  const height = 682;
  const gray = await sourceGrayPixels(source, width, height);
  const palette = await woodPalette(levels, paletteMaterialNames);
  const byName = new Map((await loadWoodLibrary()).map((sample) => [sample.name, sample]));
  const selectedBackground = byName.get(backgroundMaterial) || palette[palette.length - 1];
  const selectedForeground = byName.get(foregroundMaterial) || null;
  const selectedPrimaryInterest = byName.get(primaryInterestMaterial) || null;
  const grainAngles = {
    horizontal: 0,
    vertical: Math.PI / 2,
    'diagonal-left': -0.7,
    'diagonal-right': 0.7,
  };
  const backgroundSample = grainAngle
    ? { ...selectedBackground, angle: grainAngles[grainAngle] ?? selectedBackground.angle }
    : selectedBackground;
  const foregroundSamples = palette.slice(0, Math.max(2, Math.min(3, palette.length)));
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < gray.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const vertical = y / height;
    const horizontal = x / width;
    const localContrast = Math.abs(gray[index] - (gray[Math.max(0, index - 1)] || gray[index]))
      + Math.abs(gray[index] - (gray[Math.max(0, index - width)] || gray[index]))
      + Math.abs(gray[index] - (gray[Math.min(gray.length - 1, index + 1)] || gray[index]))
      + Math.abs(gray[index] - (gray[Math.min(gray.length - 1, index + width)] || gray[index]));
    const centralObjectBand = horizontal > 0.24 && horizontal < 0.76 && vertical > 0.15 && vertical < 0.74;
    const subjectPixel = subjectFocus && centralObjectBand && (gray[index] < 135 || localContrast > 54);
    const backgroundPixel = (flattenSky || flattenBackground)
      && vertical < 0.58
      && gray[index] > 108
      && localContrast < (subjectPixel ? 0 : 82);
    const foregroundPixel = simplifyForeground && vertical > 0.68;
    const thirdsDistance = Math.min(
      Math.abs(horizontal - 1 / 3),
      Math.abs(horizontal - 2 / 3),
      Math.abs(vertical - 1 / 3),
      Math.abs(vertical - 2 / 3),
    );
    const detailBoost = subjectPixel || (thirdsFocus && thirdsDistance < 0.035 && localContrast > 32);
    const adjustedGray = detailBoost
      ? Math.max(0, Math.min(255, 128 + (gray[index] - 128) * 1.45))
      : gray[index];
    const activePalette = foregroundPixel ? foregroundSamples : palette;
    const bucket = backgroundPixel
      ? palette.length - 1
      : Math.max(0, Math.min(activePalette.length - 1, Math.floor(adjustedGray / 256 * activePalette.length)));
    let sample = backgroundPixel ? backgroundSample : activePalette[bucket];
    if (subjectPixel && selectedPrimaryInterest) sample = selectedPrimaryInterest;
    if (foregroundPixel && selectedForeground) sample = selectedForeground;
    const grain = sample.pixels ? 0 : grainValue(x, y, sample);
    const previousPaletteLength = backgroundPixel ? palette.length : activePalette.length;
    const leftBucket = x > 0 ? Math.floor(gray[index - 1] / 256 * previousPaletteLength) : bucket;
    const upBucket = y > 0 ? Math.floor(gray[index - width] / 256 * previousPaletteLength) : bucket;
    const edge = outline && !backgroundPixel && (leftBucket !== bucket || upBucket !== bucket)
      ? -0.34
      : x > 0 && !backgroundPixel && leftBucket !== bucket ? -0.16 : 0;
    const etchedLine = etchDetail && !backgroundPixel && localContrast > 72;
    const etch = etchedLine ? -0.22 : 0;
    const shade = backgroundPixel ? 1 : 1 + grain + edge + etch + (detailBoost ? grain * 0.65 : 0);
    const texture = sampleTexture(sample, x, y, shade);
    const offset = index * 3;
    pixels[offset] = Math.max(0, Math.min(255, Math.round(texture[0] * shade)));
    pixels[offset + 1] = Math.max(0, Math.min(255, Math.round(texture[1] * shade)));
    pixels[offset + 2] = Math.max(0, Math.min(255, Math.round(texture[2] * shade)));
  }
  const ppm = `${output}.ppm`;
  await writeFile(ppm, Buffer.concat([header, pixels]));
  await execFileAsync(process.env.MAGICK_BIN || 'magick', [ppm, output], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
}

async function ensureGallery(gallery) {
  if (generatedGalleries.has(gallery.name)) return;
  await generate(gallery);
}

async function edgeMask(path) {
  const magick = process.env.MAGICK_BIN || 'magick';
  const args = [
    path,
    '-auto-orient',
    '-resize',
    '256x256!',
    '-colorspace',
    'gray',
    '-blur',
    '0x0.8',
    '-canny',
    '0x1+8%+24%',
    '-threshold',
    '1%',
    '-depth',
    '8',
    'gray:-',
  ];
  const { stdout } = await execFileAsync(magick, args, { encoding: 'buffer', timeout: 15000, maxBuffer: 256 * 256 + 1024 });
  return new Uint8Array(stdout);
}

async function grayPixels(path) {
  const magick = process.env.MAGICK_BIN || 'magick';
  const args = [
    path,
    '-auto-orient',
    '-resize',
    '256x256!',
    '-colorspace',
    'gray',
    '-depth',
    '8',
    'gray:-',
  ];
  const { stdout } = await execFileAsync(magick, args, { encoding: 'buffer', timeout: 15000, maxBuffer: 256 * 256 + 1024 });
  return new Uint8Array(stdout);
}

function dilate(mask, width = 256, height = 256, radius = 2) {
  const output = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] < 128) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        output[ny * width + nx] = 255;
      }
    }
  }
  return output;
}

function compareEdges(original, candidate) {
  const originalDilated = dilate(original);
  const candidateDilated = dilate(candidate);
  let originalCount = 0;
  let candidateCount = 0;
  let originalPreserved = 0;
  let candidateMatched = 0;
  for (let index = 0; index < original.length; index += 1) {
    const hasOriginal = original[index] > 128;
    const hasCandidate = candidate[index] > 128;
    if (hasOriginal) {
      originalCount += 1;
      if (candidateDilated[index] > 128) originalPreserved += 1;
    }
    if (hasCandidate) {
      candidateCount += 1;
      if (originalDilated[index] > 128) candidateMatched += 1;
    }
  }
  const recall = originalCount ? originalPreserved / originalCount : 0;
  const precision = candidateCount ? candidateMatched / candidateCount : 0;
  const noise = 1 - precision;
  return {
    recall: Number(recall.toFixed(3)),
    precision: Number(precision.toFixed(3)),
    noise: Number(noise.toFixed(3)),
    originalEdges: originalCount,
    candidateEdges: candidateCount,
    pass: recall >= 0.8 && noise <= 0.45,
  };
}

function compareDepth(originalGray, candidateGray, width = 256, height = 256) {
  let diffSum = 0;
  let gradientSum = 0;
  let sourceGradientSum = 0;
  for (let index = 0; index < candidateGray.length; index += 1) {
    diffSum += Math.abs(candidateGray[index] - originalGray[index]);
  }
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      const right = index + 1;
      const down = index + width;
      gradientSum += Math.abs(candidateGray[index] - candidateGray[right]);
      gradientSum += Math.abs(candidateGray[index] - candidateGray[down]);
      sourceGradientSum += Math.abs(originalGray[index] - originalGray[right]);
      sourceGradientSum += Math.abs(originalGray[index] - originalGray[down]);
    }
  }
  const pixels = candidateGray.length;
  const gradients = (width - 1) * (height - 1) * 2;
  const change = diffSum / pixels / 255;
  const contrast = gradientSum / gradients / 255;
  const sourceContrast = sourceGradientSum / gradients / 255;
  const contrastLift = sourceContrast ? contrast / sourceContrast : 0;
  return {
    change: Number(change.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
    contrastLift: Number(contrastLift.toFixed(3)),
    depthScore: Number(((change * 0.55 + Math.min(1.5, contrastLift) / 1.5 * 0.45)).toFixed(3)),
  };
}

async function scoreVariants(gallery = galleryForName('dogs')) {
  const original = await edgeMask(gallery.sourcePath);
  const originalGray = await grayPixels(gallery.sourcePath);
  const metrics = {};
  for (const variant of gallery.variants) {
    try {
      const candidatePath = galleryPath(gallery, `${variant.id}.png`);
      metrics[variant.id] = {
        ...compareEdges(original, await edgeMask(candidatePath)),
        ...compareDepth(originalGray, await grayPixels(candidatePath)),
      };
    } catch (error) {
      metrics[variant.id] = { error: error.message };
    }
  }
  return metrics;
}

async function readFeedback(gallery = galleryForName('dogs')) {
  try {
    return JSON.parse(await readFile(galleryPath(gallery, 'feedback.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function readMetrics(gallery = galleryForName('dogs')) {
  try {
    return JSON.parse(await readFile(galleryPath(gallery, 'metrics.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function readGenerationErrors(gallery = galleryForName('dogs')) {
  try {
    return JSON.parse(await readFile(galleryPath(gallery, 'generation-errors.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function readProject(gallery = galleryForName('dogs')) {
  try {
    return JSON.parse(await readFile(galleryPath(gallery, 'project.json'), 'utf8'));
  } catch {
    const now = new Date().toISOString();
    return {
      projectId: `playground-${gallery.name}`,
      createdAt: now,
      projectFacts: {
        sourceImages: [{ id: 'source', path: gallery.sourcePath, label: basename(gallery.sourcePath) }],
        currentRecipe: { recipeItems: defaultRecipeItems(gallery) },
        recipeSnapshots: [],
        recipeCandidates: [],
        quotes: [],
        payments: [],
        workshopPhotos: [],
        approvals: [],
      },
      grinder: {
        runId: `playground-${gallery.name}-run`,
        goal: 'improvePreview',
        queue: [],
        humanRequirements: [{ type: 'chooseRecipeCandidate', createdAt: now }],
        completedSteps: [],
        inProgressSteps: [],
        receipts: [],
        failures: [],
      },
      updatedAt: now,
    };
  }
}

async function writeProject(gallery, project) {
  await writeFile(galleryPath(gallery, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
}

async function generateRecipePreview(gallery, currentRecipe) {
  const ast = currentRecipe?.ast;
  const cacheKey = shortHash({ gallery: gallery.name, sourcePath: gallery.sourcePath, renderer: recipeRendererVersion, ast });
  const outputName = `recipe-${cacheKey}.png`;
  const output = galleryPath(gallery, outputName);
  try {
    await stat(output);
    return outputName;
  } catch {}
  if (gallery.name === 'windmills' && ast?.craftProcess === 'marquetry') {
    const options = optionsFromRecipeAst(ast);
    await renderMarquetryJs(gallery.sourcePath, output, options);
    return outputName;
  }
  await execFileAsync(process.env.MAGICK_BIN || 'magick', [
    gallery.sourcePath,
    '-auto-orient',
    '-resize',
    '768x1024>',
    ...metalizeCopper,
    output,
  ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  return outputName;
}

function optionsFromRecipeAst(ast) {
  const options = {
    levels: Math.max(2, Math.min(5, ast.materialPalette?.length || 4)),
    backgroundMaterial: null,
    foregroundMaterial: null,
    primaryInterestMaterial: null,
    grainAngle: null,
    flattenBackground: false,
    simplifyForeground: false,
    subjectFocus: false,
    outline: false,
    etchDetail: false,
    paletteMaterialNames: ast.materialPalette || [],
  };
  for (const item of ast.recipeItems || []) {
    if (item.type !== 'regionRecipe') continue;
    const target = item.target;
    for (const nested of item.recipeItems || []) {
      if (target === 'background' && nested.type === 'flatten') options.flattenBackground = true;
      if (target === 'background' && nested.type === 'selectMaterial') options.backgroundMaterial = nested.material;
      if (target === 'foreground' && nested.type === 'selectMaterial') options.foregroundMaterial = nested.material;
      if ((target === 'subject' || target === 'primary-interest') && nested.type === 'selectMaterial') options.primaryInterestMaterial = nested.material;
      if (target === 'background' && nested.type === 'setGrain') options.grainAngle = nested.angle;
      if (target === 'foreground' && nested.type === 'simplify') options.simplifyForeground = true;
      if ((target === 'subject' || target === 'primary-interest') && nested.type === 'preserve') options.subjectFocus = true;
      if (nested.type === 'separate') options.outline = true;
      if (nested.type === 'etchDetail') options.etchDetail = true;
      if (nested.type === 'quantize') options.levels = Math.max(2, Math.min(5, nested.materials || options.levels));
    }
  }
  return options;
}

function selectedMaterialsFromRecipe(currentRecipe) {
  const ast = currentRecipe?.ast || {};
  const selected = new Set(ast.materialPalette || []);
  for (const item of ast.recipeItems || []) {
    for (const nested of item.recipeItems || []) {
      if (nested.type === 'selectMaterial') selected.add(nested.material);
    }
  }
  return [...selected];
}

const recipeDsl = {
  craftProcesses: new Set(['marquetry', 'embossed-metal', 'layered-card', 'routed-relief', 'laser-etching']),
  detailLevels: new Set(['simple', 'balanced', 'detailed', 'intricate']),
  regions: new Set(['background', 'middle-ground', 'foreground', 'subject', 'primary-interest']),
  roles: new Set(['quiet-area', 'primary-interest', 'supporting-detail', 'separation-boundary', 'material-texture-carrier']),
  materials: new Set([
    'ash',
    'bright',
    'brown-stain',
    'cedar',
    'contours',
    'contrast',
    'dark',
    'grainy',
    'green',
    'grey',
    'grey-yellow',
    'knot',
    'knotty',
    'liney',
    'oak',
    'orange',
    'rich',
    'sand-dunes',
    'walnut',
    'copper',
    'brass',
    'aluminium',
    'white-card',
    'black-card',
  ]),
  etchStrengths: new Set(['gentle', 'medium', 'strong']),
  grainAngles: new Set(['horizontal', 'vertical', 'diagonal-left', 'diagonal-right']),
};

const materialAliases = new Map([
  ['cherry', 'cedar'],
  ['maple', 'ash'],
  ['birch', 'bright'],
]);

function canonicalMaterial(name) {
  return materialAliases.get(name) || name;
}

function defaultRecipeText(gallery) {
  if (gallery.name === 'windmills') {
    return `craft marquetry
palette walnut cedar oak ash bright
detail-level balanced

region background
  role quiet-area
  flatten
  material maple
  grain diagonal-right

region primary-interest
  role primary-interest
  preserve essence
  separate boundaries
  etch-detail gentle

region foreground
  role supporting-detail
  simplify
`;
  }
  return `craft embossed-metal
palette copper brass aluminium
detail-level balanced

region primary-interest
  role primary-interest
  preserve essence
  separate boundaries

region background
  role quiet-area
  simplify
`;
}

function parseRecipeDsl(source) {
  const ast = { type: 'imageRecipe', recipeItems: [] };
  const diagnostics = [];
  let currentRegion = null;
  const lines = String(source || '').replace(/\t/g, '  ').split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const withoutComment = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (!withoutComment.trim() || withoutComment.trimStart().startsWith('#')) return;
    const indent = withoutComment.match(/^ */)[0].length;
    if (indent % 2 !== 0) diagnostics.push({ line: lineNumber, message: 'Indentation must use two-space steps.' });
    const parts = withoutComment.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    const scope = indent === 0 ? 'top' : 'region';
    const fail = (message) => diagnostics.push({ line: lineNumber, command, message });
    if (scope === 'top') currentRegion = null;

    if (scope === 'top' && command === 'craft') {
      if (args.length !== 1 || !recipeDsl.craftProcesses.has(args[0])) fail('Expected one known craft process.');
      ast.craftProcess = args[0];
      return;
    }
    if (scope === 'top' && command === 'palette') {
      if (!args.length) fail('Palette needs at least one material.');
      const materials = args.map(canonicalMaterial);
      args.forEach((material, materialIndex) => {
        if (!recipeDsl.materials.has(materials[materialIndex])) fail(`Unknown material "${material}".`);
      });
      ast.materialPalette = materials;
      return;
    }
    if (scope === 'top' && command === 'detail-level') {
      if (args.length !== 1 || !recipeDsl.detailLevels.has(args[0])) fail('Expected simple, balanced, detailed, or intricate.');
      ast.detailLevel = args[0];
      return;
    }
    if (scope === 'top' && command === 'region') {
      if (args.length !== 1 || !recipeDsl.regions.has(args[0])) fail('Expected one known composition region.');
      currentRegion = { type: 'regionRecipe', target: args[0], recipeItems: [] };
      ast.recipeItems.push(currentRegion);
      return;
    }
    if (scope === 'top' && command === 'check') {
      if (args.join(' ') !== 'makeability') fail('Only "check makeability" is supported.');
      ast.recipeItems.push({ type: 'checkMakeability' });
      return;
    }
    if (scope === 'top') {
      fail('Unknown top-level command.');
      return;
    }
    if (!currentRegion) {
      fail('Indented command must be inside a region block.');
      return;
    }
    if (command === 'role') {
      if (args.length !== 1 || !recipeDsl.roles.has(args[0])) fail('Expected one known region role.');
      currentRegion.recipeItems.push({ type: 'assignRegionRole', role: args[0] });
      return;
    }
    if (command === 'flatten' || command === 'simplify') {
      if (args.length) fail(`"${command}" takes no arguments.`);
      currentRegion.recipeItems.push({ type: command });
      return;
    }
    if (command === 'preserve') {
      if (args.join(' ') !== 'essence') fail('Only "preserve essence" is supported.');
      currentRegion.recipeItems.push({ type: 'preserve', target: 'essence' });
      return;
    }
    if (command === 'separate') {
      if (args.join(' ') !== 'boundaries') fail('Only "separate boundaries" is supported.');
      currentRegion.recipeItems.push({ type: 'separate', target: 'boundaries' });
      return;
    }
    if (command === 'etch-detail') {
      if (args.length !== 1 || !recipeDsl.etchStrengths.has(args[0])) fail('Expected gentle, medium, or strong.');
      currentRegion.recipeItems.push({ type: 'etchDetail', strength: args[0] });
      return;
    }
    if (command === 'material') {
      const material = canonicalMaterial(args[0]);
      if (args.length !== 1 || !recipeDsl.materials.has(material)) fail('Expected one known material.');
      currentRegion.recipeItems.push({ type: 'selectMaterial', material });
      return;
    }
    if (command === 'grain') {
      if (args.length !== 1 || !recipeDsl.grainAngles.has(args[0])) fail('Expected horizontal, vertical, diagonal-left, or diagonal-right.');
      currentRegion.recipeItems.push({ type: 'setGrain', angle: args[0] });
      return;
    }
    if (command === 'quantize') {
      if (args.length !== 2 || !/^\d+$/.test(args[0]) || args[1] !== 'materials') fail('Expected "quantize <number> materials".');
      currentRegion.recipeItems.push({ type: 'quantize', target: 'region', materials: Number(args[0]) });
      return;
    }
    fail('Unknown region command.');
  });
  if (!ast.craftProcess) diagnostics.push({ line: 0, message: 'Missing craft command.' });
  if (!ast.materialPalette?.length) diagnostics.push({ line: 0, message: 'Missing palette command.' });
  return { ast, diagnostics };
}

function defaultRecipeItems(gallery) {
  return parseRecipeDsl(defaultRecipeText(gallery)).ast.recipeItems;
}

function recipeItemsForVariant(gallery, variant) {
  const items = [...defaultRecipeItems(gallery)];
  if (variant.flattenBackground || variant.flattenSky || variant.id.includes('bg-flatten')) {
    items.push({ type: 'flatten', target: 'Background Region' });
  }
  if (variant.simplifyForeground) {
    items.push({ type: 'simplify', target: 'Foreground Region' });
  }
  if (variant.subjectFocus || variant.id.includes('essence')) {
    items.push({ type: 'preserve', target: 'Primary Interest' });
  }
  if (variant.thirdsFocus) {
    items.push({ type: 'exaggerate', target: 'Rule Of Thirds Interest' });
  }
  if (variant.outline || variant.id.includes('edge') || variant.id.includes('outline')) {
    items.push({ type: 'separate', target: 'Separation Boundary' });
  }
  if (variant.etchDetail) {
    items.push({ type: 'addEtchDetail', target: 'Source Essence' });
  }
  if (variant.levels) {
    items.push({ type: 'quantize', target: 'Whole Image', materials: variant.levels });
  }
  return items;
}

async function refreshProject(gallery = galleryForName('dogs')) {
  const project = await readProject(gallery);
  const feedback = await readFeedback(gallery);
  const metrics = await readMetrics(gallery);
  const generationErrors = await readGenerationErrors(gallery);
  const now = new Date().toISOString();
  project.projectFacts.sourceImages = [{ id: 'source', path: gallery.sourcePath, label: basename(gallery.sourcePath) }];
  const recipeText = project.projectFacts.currentRecipe?.text || defaultRecipeText(gallery);
  const parsedRecipe = parseRecipeDsl(recipeText);
  project.projectFacts.currentRecipe = {
    text: recipeText,
    ast: parsedRecipe.ast,
    diagnostics: parsedRecipe.diagnostics,
    recipeItems: parsedRecipe.ast.recipeItems,
  };
  if (parsedRecipe.diagnostics.length === 0) {
    project.projectFacts.currentRecipe.previewImagePath = await generateRecipePreview(gallery, project.projectFacts.currentRecipe);
  }
  project.projectFacts.recipeCandidates = gallery.variants.map((variant) => ({
    id: variant.id,
    label: variant.label,
    previewImagePath: `${variant.id}.png`,
    recipePlan: {
      engine: variant.engine || 'imagemagick',
      recipeItems: recipeItemsForVariant(gallery, variant),
    },
    metrics: metrics[variant.id] || null,
    generationError: generationErrors[variant.id] || null,
    feedback: feedback[variant.id] || null,
  }));
  const previousSnapshots = project.projectFacts.recipeSnapshots || [];
  const snapshotIds = new Set(previousSnapshots.map((snapshot) => snapshot.candidateId));
  const newSnapshots = project.projectFacts.recipeCandidates
    .filter((candidate) => Number(candidate.feedback?.rating) === 3 && !snapshotIds.has(candidate.id))
    .map((candidate) => ({
      id: `snapshot-${candidate.id}-${Date.now()}`,
      candidateId: candidate.id,
      label: candidate.label,
      recipeItems: candidate.recipePlan.recipeItems,
      feedback: candidate.feedback,
      createdAt: now,
    }));
  project.projectFacts.recipeSnapshots = [...previousSnapshots, ...newSnapshots];
  if (newSnapshots.length) {
    project.grinder.receipts = [
      ...(project.grinder.receipts || []),
      ...newSnapshots.map((snapshot) => ({
        type: 'recipeSnapshotCreated',
        snapshotId: snapshot.id,
        candidateId: snapshot.candidateId,
        createdAt: now,
      })),
    ];
  }
  project.updatedAt = now;
  await writeProject(gallery, project);
  return project;
}

async function refreshCurrentProject(gallery = galleryForName('dogs')) {
  await mkdir(gallery.outDir, { recursive: true });
  const project = await readProject(gallery);
  const now = new Date().toISOString();
  project.projectFacts.sourceImages = [{ id: 'source', path: gallery.sourcePath, label: basename(gallery.sourcePath) }];
  const recipeText = project.projectFacts.currentRecipe?.text || defaultRecipeText(gallery);
  const parsedRecipe = parseRecipeDsl(recipeText);
  project.projectFacts.currentRecipe = {
    text: recipeText,
    ast: parsedRecipe.ast,
    diagnostics: parsedRecipe.diagnostics,
    recipeItems: parsedRecipe.ast.recipeItems,
  };
  if (parsedRecipe.diagnostics.length === 0) {
    project.projectFacts.currentRecipe.previewImagePath = await generateRecipePreview(gallery, project.projectFacts.currentRecipe);
  }
  project.updatedAt = now;
  await writeProject(gallery, project);
  return project;
}

async function saveRecipeText(gallery, text) {
  const project = await readProject(gallery);
  const parsedRecipe = parseRecipeDsl(text);
  const now = new Date().toISOString();
  project.projectFacts.currentRecipe = {
    text,
    ast: parsedRecipe.ast,
    diagnostics: parsedRecipe.diagnostics,
    recipeItems: parsedRecipe.ast.recipeItems,
  };
  if (parsedRecipe.diagnostics.length === 0) {
    const imagePath = await generateRecipePreview(gallery, project.projectFacts.currentRecipe);
    project.projectFacts.currentRecipe.previewImagePath = imagePath;
    project.grinder.receipts = [
      ...(project.grinder.receipts || []),
      { type: 'recipePreviewGenerated', imagePath, createdAt: now },
    ];
  }
  project.updatedAt = now;
  await writeProject(gallery, project);
  return project.projectFacts.currentRecipe;
}

async function saveFeedback(id, value, gallery = galleryForName('dogs')) {
  const feedback = await readFeedback(gallery);
  const rating = Number(value);
  feedback[id] = {
    ...(feedback[id] || {}),
    rating: Number.isFinite(rating) ? Math.min(3, Math.max(1, rating)) : undefined,
    value,
    at: new Date().toISOString(),
  };
  await writeFile(galleryPath(gallery, 'feedback.json'), `${JSON.stringify(feedback, null, 2)}\n`);
  await refreshProject(gallery);
}

async function saveNote(id, note, gallery = galleryForName('dogs')) {
  const feedback = await readFeedback(gallery);
  feedback[id] = { ...(feedback[id] || {}), note, noteAt: new Date().toISOString() };
  await writeFile(galleryPath(gallery, 'feedback.json'), `${JSON.stringify(feedback, null, 2)}\n`);
  await refreshProject(gallery);
}

function candidateGalleryHtml(gallery, feedback, metrics, generationErrors) {
  const ranked = gallery.variants
    .map((variant) => {
      const item = feedback[variant.id] || {};
      const legacyScore = { good: 3, bad: 2, ugly: 1 }[item.value];
      const humanScore = item.rating ?? legacyScore ?? 0;
      const metric = metrics[variant.id] || {};
      const edgeScore = metric.error ? 0 : ((metric.recall || 0) * 100) - ((metric.noise || 0) * 45);
      const transformScore = metric.error ? 0 : (metric.depthScore || 0) * 45;
      const score = Number((edgeScore + humanScore * 18).toFixed(1));
      return { ...variant, feedback: item, score: Number((score + transformScore).toFixed(1)), humanScore, edgeScore, transformScore, metric };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const renderCard = (variant) => {
    const selected = feedback[variant.id]?.value || '';
    const rating = feedback[variant.id]?.rating || '';
    const note = feedback[variant.id]?.note || '';
    const generationError = generationErrors[variant.id];
    const metric = metrics[variant.id] || {};
    const metricText = metric.error
      ? `edge score failed: ${metric.error}`
      : `edge recall ${Math.round((metric.recall || 0) * 100)}% · noise ${Math.round((metric.noise || 0) * 100)}% · depth ${Math.round((metric.depthScore || 0) * 100)}%${metric.pass ? ' · pass' : ' · review'}`;
    return `<section class="card">
      ${generationError ? `<div class="failed">failed: ${generationError}</div>` : `<img loading="lazy" src="/${gallery.name}/images/${variant.id}.png" alt="${variant.label}">`}
      <h2>${variant.label}</h2>
      <p>Recipe Candidate <code>${variant.id}</code>${rating ? ` · ${rating}/3` : selected ? ` · ${selected}` : ''}</p>
      <p class="metric">${metricText}</p>
      <div class="rating" role="group" aria-label="Rate ${variant.label}">
        ${[
          ['1', 'ugly'],
          ['2', 'bad'],
          ['3', 'good'],
        ].map(([value, label]) => `<button class="${String(rating) === value ? 'selected' : ''}" data-id="${variant.id}" data-value="${value}">${label}</button>`).join('')}
      </div>
      <div class="quick">
        ${['keeps essence', 'more embossed', 'too noisy', 'too flat'].map((text) => `<button data-note-preset="${variant.id}" data-note="${text}">${text}</button>`).join('')}
      </div>
      <textarea data-note-id="${variant.id}" placeholder="What works? What should change?">${note}</textarea>
    </section>`;
  };
  const winners = ranked.filter((variant) => variant.humanScore === 3);
  const newestFirst = [...gallery.variants].reverse();
  const seen = new Set(winners.map((variant) => variant.id));
  const ordered = [...winners, ...newestFirst.filter((variant) => !seen.has(variant.id))];
  const topCards = winners.map(renderCard).join('');
  const allCards = ordered.filter((variant) => !seen.has(variant.id)).map(renderCard).join('');
  return `${winners.length ? `<h2 class="section-title">Chosen Candidates</h2><main class="grid">${topCards}</main>` : ''}<h2 class="section-title">${winners.length ? 'Newest First, Excluding Winners' : 'Newest First'}</h2><main class="grid">${allCards}</main>`;
}

async function page(gallery, feedback, metrics, generationErrors, currentRecipe) {
  const woodSamples = gallery.name === 'windmills' ? await loadWoodLibrary() : [];
  const woodControlsHtml = woodSamples.length
    ? `<section class="materials"><h2>Paint Region</h2><div class="paint-targets" role="group" aria-label="Paint target"><button class="selected" data-paint-region="background" type="button">background</button><button data-paint-region="primary-interest" type="button">primary interest</button><button data-paint-region="foreground" type="button">foreground</button></div><div class="material-grid">${woodSamples.map((sample) => `<button class="material-swatch" data-material="${escapeHtml(sample.name)}" type="button"><img src="${sample.tileUrl}" alt="${sample.name} wood sample"><span><strong>${sample.name}</strong><small>${sample.brightness} · ${sample.contrastBand}</small></span></button>`).join('')}</div></section>`
    : '';
  const ranked = gallery.variants
    .map((variant) => {
      const item = feedback[variant.id] || {};
      const legacyScore = { good: 3, bad: 2, ugly: 1 }[item.value];
      const humanScore = item.rating ?? legacyScore ?? 0;
      const metric = metrics[variant.id] || {};
      const edgeScore = metric.error ? 0 : ((metric.recall || 0) * 100) - ((metric.noise || 0) * 45);
      const transformScore = metric.error ? 0 : (metric.depthScore || 0) * 45;
      const score = Number((edgeScore + humanScore * 18).toFixed(1));
      return { ...variant, feedback: item, score: Number((score + transformScore).toFixed(1)), humanScore, edgeScore, transformScore, metric };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const summary = ranked
    .filter((variant) => variant.feedback.value || variant.feedback.note)
    .map((variant) => `<li><strong>${variant.label}</strong>: human ${variant.humanScore || 'unrated'} · combined ${variant.score}${variant.feedback.note ? ` — ${variant.feedback.note}` : ''}</li>`)
    .join('');
  const topCards = '';
  const allCards = '';
  const diagnostics = currentRecipe?.diagnostics || [];
  const diagnosticsHtml = diagnostics.length
    ? diagnostics.map((item) => `<li>line ${item.line || '?'}: ${escapeHtml(item.message)}</li>`).join('')
    : '<li>valid</li>';
  const recipePreview = currentRecipe?.previewImagePath
    ? `<img id="recipe-preview" src="/${gallery.name}/images/${currentRecipe.previewImagePath}?v=${Date.now()}" alt="Current Recipe preview">`
    : '<div id="recipe-preview" class="failed">No current recipe preview yet.</div>';
  const recipePreviewMeta = `<p id="recipe-preview-meta" class="preview-meta">${currentRecipe?.previewImagePath ? `Rendered ${escapeHtml(currentRecipe.previewImagePath)} · materials ${selectedMaterialsFromRecipe(currentRecipe).map(escapeHtml).join(', ')}` : 'No render yet'}</p><p id="recipe-render-state" class="render-state" aria-live="polite"></p>`;
  const candidateDetailsOpen = currentRecipe?.previewImagePath ? '' : ' open';
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ImageMagick Playground</title>
<style>
body { margin: 0; font-family: system-ui, sans-serif; background: #f6f4ef; color: #171717; }
header { position: sticky; top: 0; z-index: 1; padding: 12px 16px; background: #fff; border-bottom: 1px solid #ddd; }
h1 { margin: 0; font-size: 18px; }
header p { margin: 4px 0 0; font-size: 13px; color: #555; }
.summary { padding: 12px 16px; background: #fff8dc; border-bottom: 1px solid #ddd; }
.summary h2 { margin: 0 0 6px; }
.summary ul { margin: 0; padding-left: 18px; }
.workspace { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(280px, .92fr); gap: 12px; padding: 12px; background: #fff; border-bottom: 1px solid #ddd; align-items: start; }
.recipe-editor { background: #fff; border-bottom: 1px solid #ddd; }
.advanced-editor { padding: 0; background: #fff; }
.advanced-editor > button { margin: 0 0 8px; min-height: 34px; }
.advanced-editor textarea { width: 100%; min-height: 420px; margin: 0; font-family: ui-monospace, monospace; font-size: 13px; }
.recipe-status { font-size: 13px; color: #333; }
.recipe-status ul { margin: 6px 0 0; padding-left: 18px; }
.recipe-help { margin-top: 10px; padding: 10px; background: #f6f4ef; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; }
.recipe-help h3 { margin: 0 0 6px; font-size: 14px; }
.recipe-help code { display: inline-block; margin: 2px 4px 2px 0; padding: 2px 5px; background: #fff; border: 1px solid #ddd; border-radius: 3px; }
.recipe-help p { margin: 6px 0 0; color: #444; }
.preview-meta { margin: 8px 0 0; font-size: 12px; color: #555; overflow-wrap: anywhere; }
.render-state { min-height: 18px; margin: 4px 0 0; font-size: 12px; color: #7a4b00; }
.materials { padding: 12px 16px; background: #fff; border-bottom: 1px solid #ddd; }
.materials h2 { margin: 0 0 4px; font-size: 16px; }
.materials p { margin: 0 0 10px; font-size: 13px; color: #555; }
.paint-targets { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.paint-targets button { min-height: 32px; padding: 4px 8px; font-size: 13px; }
.paint-targets button.selected { background: #202020; color: #fff; }
.material-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
.material-swatch { display: block; min-height: 0; padding: 0; border: 1px solid #ddd; border-radius: 5px; overflow: hidden; background: #fafafa; text-align: left; cursor: pointer; }
.material-swatch:hover, .material-swatch:focus { border-color: #202020; box-shadow: 0 0 0 2px rgba(32,32,32,.12); outline: 0; }
.material-grid img { aspect-ratio: 1 / 1; object-fit: cover; }
.material-grid span { display: block; padding: 6px; font-size: 12px; color: #171717; }
.material-grid small { display: block; color: #555; }
.autocomplete { position: fixed; z-index: 5; display: none; min-width: 190px; max-width: 320px; max-height: 260px; overflow: auto; background: #fff; border: 1px solid #999; border-radius: 4px; box-shadow: 0 6px 18px rgba(0,0,0,.16); }
.autocomplete button { display: block; width: 100%; min-height: 32px; padding: 6px 10px; border: 0; border-radius: 0; text-align: left; font-family: ui-monospace, monospace; background: #fff; }
.autocomplete button.selected, .autocomplete button:hover { background: #202020; color: #fff; }
.preview-panel { background: #fff; }
.section-title { padding: 14px 16px 0; margin: 0; font-size: 18px; }
.candidate-mode { border-top: 1px solid #ddd; background: #f6f4ef; }
.candidate-mode summary { cursor: pointer; padding: 14px 16px; font-weight: 700; background: #fff; border-bottom: 1px solid #ddd; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; padding: 12px; }
.card { background: #fff; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
img { display: block; width: 100%; height: auto; background: #eee; }
.failed { padding: 16px; min-height: 180px; background: #3b1010; color: #fff; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
h2 { margin: 10px 10px 4px; font-size: 16px; }
p { margin: 0 10px 10px; color: #555; }
.metric { color: #222; font-size: 13px; }
.rating { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 0 10px 8px; }
.quick { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 0 10px 8px; }
button { min-height: 38px; border: 1px solid #999; background: #fafafa; border-radius: 4px; font-size: 14px; }
button.selected { background: #202020; color: #fff; }
textarea { box-sizing: border-box; display: block; width: calc(100% - 20px); min-height: 68px; margin: 0 10px 12px; padding: 8px; border: 1px solid #bbb; border-radius: 4px; font: inherit; resize: vertical; }
@media (max-width: 760px) { .workspace { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header><h1>${gallery.title} · ${basename(gallery.sourcePath)}</h1><p><a href="/dogs">dogs</a> · <a href="/windmills">windmills</a> · started ${serverStartedAt}</p></header>
${summary ? `<section class="summary"><h2>Recipe Feedback</h2><ul>${summary}</ul><p><a href="/${gallery.name}/feedback.json">feedback.json</a> · <a href="/${gallery.name}/project.json">project.json</a> · <a href="/${gallery.name}/recipe.json">recipe.json</a></p></section>` : `<section class="summary"><p><a href="/${gallery.name}/project.json">project.json</a> · <a href="/${gallery.name}/recipe.json">recipe.json</a></p></section>`}
<section class="workspace">
  <div class="advanced-editor">
    <h2>Recipe DSL</h2>
    <button id="recipe-suggest" type="button">Suggest next line</button>
    <textarea id="recipe-text" spellcheck="false">${escapeHtml(currentRecipe?.text || defaultRecipeText(gallery))}</textarea>
    <div class="recipe-status"><strong id="recipe-state">${diagnostics.length ? 'invalid' : 'valid'}</strong><ul id="recipe-diagnostics">${diagnosticsHtml}</ul></div>
    <div id="recipe-autocomplete" class="autocomplete"></div>
    <div class="recipe-help">
      <h3>Recipe DSL Cheat Sheet</h3>
      <div><code>craft marquetry</code><code>palette walnut cedar oak ash bright</code><code>detail-level balanced</code></div>
      <div><code>region background</code><code>region primary-interest</code><code>region foreground</code></div>
      <div><code>role quiet-area</code><code>flatten</code><code>simplify</code><code>preserve essence</code><code>separate boundaries</code><code>etch-detail gentle</code><code>material bright</code><code>grain diagonal-right</code></div>
      <p>Indent region commands by two spaces. Press Tab, Ctrl+Space, or Suggest next line.</p>
    </div>
  </div>
  <div class="preview-panel">
    <h2>Current Recipe Preview</h2>
    ${recipePreview}
    ${recipePreviewMeta}
    ${woodControlsHtml}
  </div>
</section>
<details id="candidate-mode" class="candidate-mode"${candidateDetailsOpen}>
  <summary>Surprise me: show Recipe Candidates</summary>
  <div id="candidate-gallery">
    <p class="candidate-loading">Open this panel to generate recipe candidates.</p>
  </div>
</details>
<script>
const startedAt = ${JSON.stringify(serverStartedAt)};
const galleryBase = ${JSON.stringify(`/${gallery.name}`)};
const dslSuggestions = ${JSON.stringify({
  top: ['craft marquetry', 'craft embossed-metal', 'palette walnut cedar oak ash bright', 'palette dark brown-stain oak bright', 'palette grey grey-yellow orange rich', 'detail-level balanced', 'region background', 'region primary-interest', 'region foreground'],
  region: ['role quiet-area', 'role primary-interest', 'role supporting-detail', 'flatten', 'simplify', 'preserve essence', 'separate boundaries', 'etch-detail gentle', 'etch-detail medium', 'material bright', 'material oak', 'material walnut', 'material grey-yellow', 'grain horizontal', 'grain vertical', 'grain diagonal-left', 'grain diagonal-right', 'quantize 4 materials'],
})};
setInterval(async () => {
  try {
    const res = await fetch(galleryBase + '/version');
    const json = await res.json();
    if (json.startedAt !== startedAt) location.reload();
  } catch {}
}, 1000);
new EventSource(galleryBase + '/events').addEventListener('reload', () => {
  document.querySelectorAll('img').forEach((img) => {
    const url = new URL(img.src);
    url.searchParams.set('v', Date.now());
    img.src = url.toString();
  });
});
const candidateMode = document.getElementById('candidate-mode');
const candidateGallery = document.getElementById('candidate-gallery');
let candidateLoadStarted = false;
candidateMode?.addEventListener('toggle', async () => {
  if (!candidateMode.open || candidateLoadStarted || candidateGallery.querySelector('.card')) return;
  candidateLoadStarted = true;
  candidateGallery.innerHTML = '<p class="candidate-loading">Generating recipe candidates...</p>';
  const res = await fetch(galleryBase + '/candidates');
  candidateGallery.innerHTML = await res.text();
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  await fetch(galleryBase + '/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: button.dataset.id, value: button.dataset.value }),
  });
  location.reload();
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-note-preset]');
  if (!button) return;
  const input = document.querySelector(\`textarea[data-note-id="\${button.dataset.notePreset}"]\`);
  if (!input) return;
  input.value = input.value ? \`\${input.value}; \${button.dataset.note}\` : button.dataset.note;
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
let noteTimer;
document.addEventListener('input', (event) => {
  const input = event.target.closest('textarea[data-note-id]');
  if (!input) return;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    fetch(galleryBase + '/note', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: input.dataset.noteId, note: input.value }),
    });
  }, 350);
});
let recipeTimer;
const recipeText = document.getElementById('recipe-text');
const autocomplete = document.getElementById('recipe-autocomplete');
const recipeSuggest = document.getElementById('recipe-suggest');
let autocompleteItems = [];
let autocompleteIndex = 0;
let activePaintRegion = 'background';

function currentLineInfo(input) {
  const before = input.value.slice(0, input.selectionStart);
  const lineStart = before.lastIndexOf('\\n') + 1;
  const line = before.slice(lineStart);
  const indent = line.match(/^ */)[0] || '';
  const typed = line.trimStart();
  return { lineStart, line, indent, typed, scope: indent.length > 0 ? 'region' : 'top' };
}

function positionAutocomplete(input) {
  const rect = input.getBoundingClientRect();
  autocomplete.style.left = rect.left + 12 + 'px';
  autocomplete.style.top = Math.min(window.innerHeight - 280, rect.top + 42) + 'px';
}

function showAutocomplete(input) {
  const info = currentLineInfo(input);
  const suggestions = dslSuggestions[info.scope].filter((item) => item.startsWith(info.typed));
  autocompleteItems = suggestions.length ? suggestions : dslSuggestions[info.scope];
  autocompleteIndex = 0;
  autocomplete.innerHTML = autocompleteItems.map((item, index) => \`<button class="\${index === 0 ? 'selected' : ''}" data-index="\${index}" type="button">\${item}</button>\`).join('');
  positionAutocomplete(input);
  autocomplete.style.display = autocompleteItems.length ? 'block' : 'none';
}

function hideAutocomplete() {
  autocomplete.style.display = 'none';
  autocompleteItems = [];
}

function selectAutocomplete(index) {
  autocompleteIndex = Math.max(0, Math.min(autocompleteItems.length - 1, index));
  autocomplete.querySelectorAll('button').forEach((button, buttonIndex) => {
    button.classList.toggle('selected', buttonIndex === autocompleteIndex);
  });
}

function insertAutocomplete(input, value = autocompleteItems[autocompleteIndex]) {
  if (!value) return;
  const info = currentLineInfo(input);
  const before = input.value.slice(0, info.lineStart);
  const after = input.value.slice(input.selectionStart);
  const insert = info.indent + value;
  input.value = before + insert + after;
  input.selectionStart = input.selectionEnd = before.length + insert.length;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  hideAutocomplete();
}

autocomplete.addEventListener('mousedown', (event) => {
  const button = event.target.closest('button[data-index]');
  if (!button) return;
  event.preventDefault();
  insertAutocomplete(recipeText, autocompleteItems[Number(button.dataset.index)]);
});

recipeText.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideAutocomplete();
    return;
  }
  if (autocomplete.style.display === 'block') {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectAutocomplete(autocompleteIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectAutocomplete(autocompleteIndex - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insertAutocomplete(recipeText);
      return;
    }
  }
  if ((event.key === ' ' && event.ctrlKey) || event.key === 'Tab') {
    event.preventDefault();
    showAutocomplete(recipeText);
  }
});

recipeText.addEventListener('keyup', (event) => {
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) return;
  showAutocomplete(recipeText);
});

recipeText.addEventListener('blur', () => setTimeout(hideAutocomplete, 120));
recipeSuggest?.addEventListener('click', () => {
  recipeText.focus();
  showAutocomplete(recipeText);
});

function lineBounds(input) {
  const start = input.value.lastIndexOf('\\n', input.selectionStart - 1) + 1;
  const nextBreak = input.value.indexOf('\\n', input.selectionStart);
  const end = nextBreak === -1 ? input.value.length : nextBreak;
  return { start, end, line: input.value.slice(start, end) };
}

function insertMaterial(material) {
  const input = recipeText;
  input.focus();
  const { start, end, line } = lineBounds(input);
  const trimmed = line.trim();
  let replacement;
  let cursorOffset;
  if (trimmed.startsWith('palette ')) {
    const parts = trimmed.split(/\\s+/);
    const materials = new Set(parts.slice(1));
    if (materials.has(material)) materials.delete(material);
    else materials.add(material);
    replacement = 'palette ' + [...materials].join(' ');
    cursorOffset = replacement.length;
  } else if (trimmed.startsWith('material ')) {
    const indent = line.match(/^ */)[0] || '  ';
    replacement = indent + 'material ' + material;
    cursorOffset = replacement.length;
  } else {
    const indent = line.match(/^ */)[0] || '  ';
    replacement = line + '\\n' + (indent || '  ') + 'material ' + material;
    cursorOffset = replacement.length;
  }
  input.value = input.value.slice(0, start) + replacement + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + cursorOffset;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function recipeLines() {
  return recipeText.value.split('\\n');
}

function replaceOrInsertRegionMaterial(region, material) {
  const lines = recipeLines();
  let regionLine = -1;
  let nextTopLevel = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === 'region ' + region) {
      regionLine = index;
      continue;
    }
    if (regionLine !== -1 && index > regionLine && lines[index].trim() && !lines[index].startsWith(' ')) {
      nextTopLevel = index;
      break;
    }
  }
  if (regionLine === -1) {
    lines.push('', 'region ' + region, '  material ' + material);
  } else {
    let materialLine = -1;
    for (let index = regionLine + 1; index < nextTopLevel; index += 1) {
      if (lines[index].trim().startsWith('material ')) {
        materialLine = index;
        break;
      }
    }
    if (materialLine === -1) {
      lines.splice(regionLine + 1, 0, '  material ' + material);
    } else {
      lines[materialLine] = (lines[materialLine].match(/^ */)[0] || '  ') + 'material ' + material;
    }
  }
  recipeText.value = lines.join('\\n');
  recipeText.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-material]');
  if (!button) return;
  replaceOrInsertRegionMaterial(activePaintRegion, button.dataset.material);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-paint-region]');
  if (!button) return;
  activePaintRegion = button.dataset.paintRegion;
  document.querySelectorAll('button[data-paint-region]').forEach((item) => {
    item.classList.toggle('selected', item === button);
  });
});

recipeText.addEventListener('input', (event) => {
  clearTimeout(recipeTimer);
  document.getElementById('recipe-state').textContent = 'checking...';
  const renderState = document.getElementById('recipe-render-state');
  if (renderState) renderState.textContent = 'waiting for a pause...';
  recipeTimer = setTimeout(async () => {
    if (renderState) renderState.textContent = 'rendering preview...';
    const res = await fetch(galleryBase + '/recipe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: event.target.value }),
    });
    const recipe = await res.json();
    const state = document.getElementById('recipe-state');
    const list = document.getElementById('recipe-diagnostics');
    if (recipe.diagnostics.length) {
      state.textContent = 'invalid';
      list.innerHTML = recipe.diagnostics.map((item) => \`<li>line \${item.line || '?'}: \${item.message}</li>\`).join('');
      if (renderState) renderState.textContent = 'not rendering until recipe is valid';
      return;
    }
    state.textContent = 'valid';
    list.innerHTML = '<li>valid</li>';
    const preview = document.getElementById('recipe-preview');
    const meta = document.getElementById('recipe-preview-meta');
    if (recipe.previewImagePath) {
      const src = galleryBase + '/images/' + recipe.previewImagePath + '?v=' + Date.now();
      if (preview.tagName === 'IMG') {
        preview.src = src;
      } else {
        preview.outerHTML = '<img id="recipe-preview" src="' + src + '" alt="Current Recipe preview">';
      }
      if (meta) {
        const materials = new Set(recipe.ast?.materialPalette || []);
        for (const item of recipe.ast?.recipeItems || []) {
          for (const nested of item.recipeItems || []) {
            if (nested.type === 'selectMaterial') materials.add(nested.material);
          }
        }
        meta.textContent = 'Rendered ' + recipe.previewImagePath + ' · materials ' + [...materials].join(', ');
      }
      if (renderState) renderState.textContent = 'rendered';
      setTimeout(() => {
        if (renderState?.textContent === 'rendered') renderState.textContent = '';
      }, 1400);
    }
  }, 500);
});
</script>
</body>
</html>`;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const gallery = galleryFromUrl(url);
    if (url.pathname === '/') {
      return send(res, 200, `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Playgrounds</title><body style="font-family:system-ui;padding:24px"><h1>Playgrounds</h1><p><a href="/dogs">Dogs / embossed metal</a></p><p><a href="/windmills">Windmills / marquetry</a></p><p><a href="/ammonites">Ammonites / 3D DSL</a></p></body>`);
    }
    if (url.pathname === '/ammonites') {
      return send(res, 200, await ammonitePage());
    }
    if (url.pathname === '/ammonites/manifest.json') {
      return send(res, 200, await readFile(ammoniteAssets.manifestPath, 'utf8'), 'application/json');
    }
    if (url.pathname === '/ammonites/patterns/celtic-knot.svg') {
      return send(res, 200, celticPatternSvg(), 'image/svg+xml; charset=utf-8');
    }
    if (url.pathname.startsWith('/ammonites/assets/')) {
      const name = basename(url.pathname);
      const files = new Map([
        ['preview0001.png', ammoniteAssets.previewPath],
        ['ammonite-sculpture-target-seed-7.stl', ammoniteAssets.stlPath],
        ['ammonite-sculpture-target-seed-7.obj', ammoniteAssets.objPath],
        ['ammonite-sculpture-target-seed-7.blend', ammoniteAssets.blendPath],
      ]);
      const file = files.get(name);
      if (!file) return send(res, 404, 'not found');
      try {
        await stat(file);
      } catch {
        return send(res, 404, 'not found');
      }
      const types = {
        '.png': 'image/png',
        '.stl': 'model/stl',
        '.obj': 'text/plain; charset=utf-8',
        '.blend': 'application/octet-stream',
      };
      res.writeHead(200, { 'content-type': types[extname(name)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return createReadStream(file).pipe(res);
    }
    if (url.pathname === '/dogs' || url.pathname === '/windmills') {
      const project = await refreshCurrentProject(gallery);
      return send(res, 200, await page(gallery, await readFeedback(gallery), await readMetrics(gallery), await readGenerationErrors(gallery), project.projectFacts.currentRecipe));
    }
    if (url.pathname === '/dogs/candidates' || url.pathname === '/windmills/candidates' || url.pathname === '/candidates') {
      await ensureGallery(gallery);
      return send(res, 200, await candidateGalleryHtml(gallery, await readFeedback(gallery), await readMetrics(gallery), await readGenerationErrors(gallery)));
    }
    if (url.pathname === '/dogs/version' || url.pathname === '/windmills/version' || url.pathname === '/version') {
      return send(res, 200, JSON.stringify({ startedAt: serverStartedAt }), 'application/json');
    }
    if (url.pathname === '/dogs/events' || url.pathname === '/windmills/events' || url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`event: reload\ndata: ${Date.now()}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if ((url.pathname === '/dogs/feedback' || url.pathname === '/windmills/feedback' || url.pathname === '/feedback') && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      await saveFeedback(body.id, body.value, gallery);
      return send(res, 200, '{"ok":true}', 'application/json');
    }
    if ((url.pathname === '/dogs/note' || url.pathname === '/windmills/note' || url.pathname === '/note') && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      await saveNote(body.id, String(body.note || '').slice(0, 1000), gallery);
      return send(res, 200, '{"ok":true}', 'application/json');
    }
    if ((url.pathname === '/dogs/recipe' || url.pathname === '/windmills/recipe' || url.pathname === '/recipe') && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const recipe = await saveRecipeText(gallery, String(body.text || '').slice(0, 10000));
      return send(res, 200, JSON.stringify(recipe), 'application/json');
    }
    if (url.pathname.startsWith('/dogs/images/') || url.pathname.startsWith('/windmills/images/') || url.pathname.startsWith('/images/')) {
      const name = basename(url.pathname);
      if (!name.endsWith('.png')) return send(res, 404, 'not found');
      const file = galleryPath(gallery, name);
      try {
        await stat(file);
      } catch {
        generatedGalleries.delete(gallery.name);
        await generate(gallery);
        try {
          await stat(file);
        } catch {
          return send(res, 404, 'image not generated');
        }
      }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      const stream = createReadStream(file);
      stream.on('error', () => {
        if (!res.headersSent) send(res, 404, 'image not generated');
        else res.end();
      });
      return stream.pipe(res);
    }
    if (url.pathname.startsWith('/materials/')) {
      const name = basename(url.pathname);
      if (!name.endsWith('.png')) return send(res, 404, 'not found');
      await loadWoodLibrary();
      const file = join(outRoot, 'materials', name);
      try {
        await stat(file);
      } catch {
        return send(res, 404, 'material not generated');
      }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return createReadStream(file).pipe(res);
    }
    if (url.pathname === '/dogs/feedback.json' || url.pathname === '/windmills/feedback.json' || url.pathname === '/feedback.json') {
      return send(res, 200, JSON.stringify(await readFeedback(gallery), null, 2), 'application/json');
    }
    if (url.pathname === '/dogs/metrics.json' || url.pathname === '/windmills/metrics.json' || url.pathname === '/metrics.json') {
      return send(res, 200, JSON.stringify(await readMetrics(gallery), null, 2), 'application/json');
    }
    if (url.pathname === '/dogs/project.json' || url.pathname === '/windmills/project.json' || url.pathname === '/project.json') {
      return send(res, 200, JSON.stringify(await refreshProject(gallery), null, 2), 'application/json');
    }
    if (url.pathname === '/dogs/recipe.json' || url.pathname === '/windmills/recipe.json' || url.pathname === '/recipe.json') {
      const project = await refreshProject(gallery);
      return send(res, 200, JSON.stringify(project.projectFacts.currentRecipe, null, 2), 'application/json');
    }
    if (url.pathname === '/dogs/regenerate' || url.pathname === '/windmills/regenerate' || url.pathname === '/regenerate') {
      generatedGalleries.delete(gallery.name);
      await generate(gallery);
      res.writeHead(302, { location: `/${gallery.name}` });
      return res.end();
    }
    return send(res, 404, 'not found');
  } catch (error) {
    return send(res, 500, error.stack || String(error), 'text/plain; charset=utf-8');
  }
}).listen(port, () => {
  console.log(`ImageMagick playground: http://localhost:${port}`);
  console.log(`Dogs: http://localhost:${port}/dogs`);
  console.log(`Windmills: http://localhost:${port}/windmills`);
  console.log(`Ammonites: http://localhost:${port}/ammonites`);
});
