import * as THREE from 'three';
import { PALETTE } from '../gfx/Palette.ts';

export const PixelSsaoShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uPixelGrid: { value: new THREE.Vector2(427, 240) },
    uCameraNear: { value: 0.25 },
    uCameraFar: { value: 120.0 },
    uSsaoStrength: { value: 0.55 },
    uSsaoRadius: { value: 2.6 },
    uSsaoBias: { value: 0.04 },
    uMaxRange: { value: 1.45 },
    uShadowTint: { value: new THREE.Color(PALETTE.deepAmethyst) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uTexelSize;
    uniform vec2 uPixelGrid;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uSsaoStrength;
    uniform float uSsaoRadius;
    uniform float uSsaoBias;
    uniform float uMaxRange;
    uniform vec3 uShadowTint;
    varying vec2 vUv;

    float readEyeDepth(vec2 uv) {
      float rawZ = texture2D(tDepth, clamp(uv, 0.001, 0.999)).x;
      float viewZ = perspectiveDepthToViewZ(rawZ, uCameraNear, uCameraFar);
      return -viewZ;
    }

    void main() {
      vec4 baseCol = texture2D(tDiffuse, vUv);
      if (uSsaoStrength <= 0.001) {
        gl_FragColor = baseCol;
        return;
      }

      // Snap depth sampling UVs onto the HD-2D pixel-art grid for crisp, shimmer-free occlusion
      vec2 grid = max(uPixelGrid, vec2(64.0, 64.0));
      vec2 qUv = (floor(vUv * grid) + 0.5) / grid;
      float rawCenter = texture2D(tDepth, qUv).x;

      // Sky / background plane at far depth receives zero SSAO
      if (rawCenter >= 0.9995) {
        gl_FragColor = baseCol;
        return;
      }

      float dCenter = readEyeDepth(qUv);
      vec2 pixelStep = max(uTexelSize, 1.0 / grid) * uSsaoRadius;

      vec2 dirs[4];
      dirs[0] = vec2(1.0, 0.0);
      dirs[1] = vec2(0.0, 1.0);
      dirs[2] = vec2(0.7071, 0.7071);
      dirs[3] = vec2(-0.7071, 0.7071);

      float occ = 0.0;
      for (int r = 1; r <= 2; r++) {
        float ringScale = (r == 1) ? 0.65 : 1.35;
        vec2 stepUv = pixelStep * ringScale;
        for (int i = 0; i < 4; i++) {
          float dPos = readEyeDepth(qUv + dirs[i] * stepUv);
          float dNeg = readEyeDepth(qUv - dirs[i] * stepUv);

          // Concave corner / cliff-base knee: one or both neighbors are closer within contact range
          float diffPos = dCenter - dPos;
          float diffNeg = dCenter - dNeg;

          float wPos = smoothstep(uSsaoBias, uSsaoBias + 0.22, diffPos) *
                       smoothstep(uMaxRange, uMaxRange * 0.28, diffPos);
          float wNeg = smoothstep(uSsaoBias, uSsaoBias + 0.22, diffNeg) *
                       smoothstep(uMaxRange, uMaxRange * 0.28, diffNeg);

          // Emphasize true concave block corners & cliff bases while suppressing thin foreground halos
          float crease = max(0.0, dCenter - (dPos + dNeg) * 0.5 - uSsaoBias * 0.6);
          float creaseWeight = smoothstep(0.01, 0.16, crease) *
                               smoothstep(uMaxRange, uMaxRange * 0.25, max(diffPos, diffNeg));

          occ += (wPos + wNeg) * 0.35 + creaseWeight * 0.65;
        }
      }

      float rawAo = clamp((occ / 8.0) * uSsaoStrength, 0.0, 0.68);
      // Quantize AO into 5 discrete pixel-art shading steps
      float steppedAo = floor(rawAo * 5.0 + 0.5) / 5.0;

      // Blend toward deep diorama shadow tint instead of flat mud-black
      vec3 shadowed = mix(baseCol.rgb, baseCol.rgb * (0.48 + uShadowTint * 0.35), steppedAo);
      gl_FragColor = vec4(shadowed, baseCol.a);
    }
  `,
};
