import { describe, expect, it } from 'vitest';
import { createZoneCanvas } from '../src/data/maps/mapBuilder.ts';
import {
  addSteppedOutcropCluster,
  applyNoiseElevationField,
  carveNoisePath,
  carveVariedRoom,
  domainWarp2D,
  evaluateVariedRoomMask,
  generateNoisePolyline,
  generateNoiseWorldMap,
  type NoiseRoomSpec,
  type RoomShapeArchetype,
} from '../src/data/maps/noiseWorldGen.ts';

describe('noiseWorldGen organic non-linear map primitives', () => {
  it('domainWarp2D produces deterministic non-zero coordinate warping', () => {
    const a1 = domainWarp2D(15, 22, 404, 0.16, 2.0);
    const a2 = domainWarp2D(15, 22, 404, 0.16, 2.0);
    const b = domainWarp2D(15, 22, 909, 0.16, 2.0);

    expect(a1).toEqual(a2);
    expect(Math.hypot(a1.x - 15, a1.y - 22)).toBeGreaterThan(0.01);
    expect(a1).not.toEqual(b);
  });

  it('evaluateVariedRoomMask & carveVariedRoom produce irregular non-rectangular silhouettes for all 5 archetypes', () => {
    const archetypes: RoomShapeArchetype[] = [
      'lobed',
      'crescent',
      'winding_meadow',
      'tiered_amphitheater',
      'craggy_sanctuary',
    ];

    for (let i = 0; i < archetypes.length; i++) {
      const shape = archetypes[i];
      const spec: NoiseRoomSpec = {
        cx: 16,
        cy: 16,
        rx: 7,
        rz: 7,
        height: 2,
        tile: '.',
        shape,
        seed: 100 + i * 17,
        lobes: 5,
        distortion: 0.38,
        innerTile: '*',
        rimTile: ',',
      };

      // Check angular asymmetry around radius 7: distances at 8 cardinal/diagonal angles shouldn't all match
      const ringValues: number[] = [];
      for (let k = 0; k < 8; k++) {
        const theta = (k * Math.PI) / 4;
        ringValues.push(
          evaluateVariedRoomMask(16 + Math.cos(theta) * 6.5, 16 + Math.sin(theta) * 6.5, spec)
        );
      }
      const spread = Math.max(...ringValues) - Math.min(...ringValues);
      expect(spread).toBeGreaterThan(0.12);

      const z = createZoneCanvas(32, 32, '#', 4);
      z.tiles[16][16] = 'B';
      carveVariedRoom(z, { ...spec, preserveProtected: true });

      // Protected bridge tile preserved when requested
      expect(z.tiles[16][16]).toBe('B');

      // Ensure silhouette does not collapse into an axis-aligned rectangle
      let carvedCount = 0;
      let rimTierCount = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (z.tiles[y][x] === '.' || z.tiles[y][x] === '*' || z.tiles[y][x] === ',') {
            carvedCount++;
            if (shape === 'tiered_amphitheater' && z.heights[y][x] === 3) {
              rimTierCount++;
            }
          }
        }
      }
      expect(carvedCount).toBeGreaterThan(45);
      expect(carvedCount).toBeLessThan(260);
      if (shape === 'tiered_amphitheater') {
        expect(rimTierCount).toBeGreaterThan(10);
      }
    }
  });

  it('generateNoisePolyline anchors endpoints strictly while meandering organically in the interior', () => {
    const start = { x: 8, y: 10 };
    const end = { x: 40, y: 38 };
    const pts = generateNoisePolyline([start, { x: 24, y: 24 }, end], 213, {
      meanderAmp: 2.8,
      meanderFreq: 0.16,
    });

    expect(pts.length).toBeGreaterThan(30);
    expect(pts[0].x).toBeCloseTo(start.x, 4);
    expect(pts[0].y).toBeCloseTo(start.y, 4);
    expect(pts[pts.length - 1].x).toBeCloseTo(end.x, 4);
    expect(pts[pts.length - 1].y).toBeCloseTo(end.y, 4);

    // Compute max perpendicular distance from the straight chord connecting start -> end
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const chordLen = Math.hypot(dx, dy);
    let maxPerp = 0;
    for (const p of pts) {
      const cross = Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx) / chordLen;
      if (cross > maxPerp) maxPerp = cross;
    }
    expect(maxPerp).toBeGreaterThan(0.6);

    // Determinism check
    const pts2 = generateNoisePolyline([start, { x: 24, y: 24 }, end], 213, {
      meanderAmp: 2.8,
      meanderFreq: 0.16,
    });
    expect(pts2).toEqual(pts);
  });

  it('carveNoisePath carves meandering variable-width paths and preserves stairs/bridges', () => {
    const z = createZoneCanvas(40, 40, '#', 2);
    z.tiles[20][20] = '^';
    z.tiles[20][21] = 'B';

    carveNoisePath(z, {
      waypoints: [
        { x: 6, y: 20 },
        { x: 20, y: 20 },
        { x: 34, y: 20 },
      ],
      baseWidth: 2.4,
      meanderAmp: 2.4,
      meanderFreq: 0.18,
      widthBreath: 0.4,
      tile: ',',
      height: 2,
      shoulderTile: '.',
      shoulderRadius: 1.5,
      preserveProtected: true,
      seed: 77,
    });

    expect(z.tiles[20][20]).toBe('^');
    expect(z.tiles[20][21]).toBe('B');

    let pathCount = 0;
    let shoulderCount = 0;
    let offAxisYCount = 0;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        if (z.tiles[y][x] === ',') {
          pathCount++;
          if (Math.abs(y - 20) >= 2) offAxisYCount++;
        } else if (z.tiles[y][x] === '.') {
          shoulderCount++;
        }
      }
    }
    expect(pathCount).toBeGreaterThan(40);
    expect(shoulderCount).toBeGreaterThan(10);
    // Meandering path must curve away from y=20 rather than forming a flat line
    expect(offAxisYCount).toBeGreaterThan(4);
  });

  it('applyNoiseElevationField and addSteppedOutcropCluster build multi-height terraces deterministically', () => {
    const z = createZoneCanvas(36, 36, '.', 1);
    applyNoiseElevationField(z, {
      seed: 555,
      baseHeight: 1,
      maxHeight: 4,
      scale: 0.12,
      warpAmp: 2.0,
      ridgeThreshold: 0.48,
      highTile: '.',
      ridgeTile: '#',
      borderMargin: 4,
    });

    const heightsSeen = new Set<number>();
    for (let y = 4; y < 32; y++) {
      for (let x = 4; x < 32; x++) {
        heightsSeen.add(Number(z.heights[y][x]));
      }
    }
    // Outer margin must stay untouched at baseHeight 1
    expect(z.heights[0][0]).toBe(1);
    expect(heightsSeen.size).toBeGreaterThanOrEqual(2);

    addSteppedOutcropCluster(z, {
      cx: 18,
      cy: 18,
      count: 4,
      spread: 3.0,
      baseHeight: 1,
      shelfTile: '.',
      capTile: '#',
      seed: 808,
    });

    let elevatedOutcropTiles = 0;
    for (let y = 12; y <= 24; y++) {
      for (let x = 12; x <= 24; x++) {
        if (Number(z.heights[y][x]) >= 2) elevatedOutcropTiles++;
      }
    }
    expect(elevatedOutcropTiles).toBeGreaterThan(6);
  });

  it('generateNoiseWorldMap composes perimeter, elevation, varied rooms, water, islets, and paths deterministically', () => {
    const spec = {
      width: 36,
      height: 36,
      seed: 314,
      baseTile: '.',
      baseHeight: 2,
      perimeter: { thickness: 2, peakHeight: 4, ridgeTile: '#', shelfTile: '.', amplitude: 1.8 },
      noiseField: { seed: 315, baseHeight: 2, maxHeight: 4, ridgeThreshold: 0.56, ridgeTile: '#' },
      rooms: [
        {
          cx: 12,
          cy: 18,
          rx: 5,
          rz: 5,
          height: 2,
          tile: '.',
          shape: 'lobed' as const,
          seed: 10,
        },
        {
          cx: 24,
          cy: 18,
          rx: 5,
          rz: 5,
          height: 2,
          tile: '*',
          shape: 'crescent' as const,
          seed: 20,
        },
      ],
      waterBodies: [
        {
          kind: 'lake' as const,
          cx: 18,
          cy: 11,
          rx: 4,
          rz: 3,
          waterHeight: 1,
          waterTile: '~',
          shoreTile: 'S',
          shoreHeight: 2,
        },
      ],
      islets: [
        {
          cx: 18,
          cy: 11,
          rx: 1.6,
          rz: 1.4,
          tiers: [
            { scale: 1.0, height: 2, tile: '.' },
            { scale: 0.55, height: 3, tile: '#' },
          ],
        },
      ],
      paths: [
        {
          waypoints: [
            { x: 10, y: 18 },
            { x: 18, y: 22 },
            { x: 26, y: 18 },
          ],
          baseWidth: 2.0,
          meanderAmp: 2.0,
          tile: ',',
          height: 2,
          seed: 33,
        },
      ],
      guaranteedCells: [{ x: 12, y: 18, tile: ',', height: 2 }],
    };

    const a = generateNoiseWorldMap(spec);
    const b = generateNoiseWorldMap(spec);
    expect(a).toEqual(b);
    expect(a.grid).toHaveLength(36);
    expect(a.heights).toHaveLength(36);

    const joined = a.grid.join('');
    expect(joined).toContain('~');
    expect(joined).toContain(',');
    expect(joined).toContain('#');
    expect(joined).toContain('*');
    expect(a.grid[18][12]).toBe(',');
  });
});
