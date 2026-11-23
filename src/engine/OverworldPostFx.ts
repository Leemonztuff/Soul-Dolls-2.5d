import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { FxQualityTier } from '../domain/FxPool.ts';
import type { BattleBiome } from '../domain/types.ts';
import { PALETTE } from '../gfx/Palette.ts';
import {
  DioramaGradeShader,
  getBiomeVisualProfile,
  type BiomeVisualProfile,
  type PostFxOptions,
} from './BiomeGradeShader.ts';
import { PixelSsaoShader } from './PixelSsaoShader.ts';
import { BASE_RENDER_H, BASE_RENDER_W } from './Renderer.ts';

function detectSoftwareWebGl(webgl: THREE.WebGLRenderer): boolean {
  try {
    const gl = webgl.getContext();
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function isForcePostFxQuery(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('postfx');
  } catch {
    return false;
  }
}

export class OverworldPostFx {
  private readonly isSoftwareGl: boolean;
  private composer: EffectComposer | null = null;
  private sceneDepthTarget: THREE.WebGLRenderTarget | null = null;
  private depthTexture: THREE.DepthTexture | null = null;
  private ssaoPass: ShaderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gradePass: ShaderPass | null = null;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  private qualityTier: FxQualityTier = 'high';
  private pixelEffect = false;
  private biome: BattleBiome = 'meadow';
  private postFxOptions: PostFxOptions = {
    bloom: true,
    bloomIntensity: 1.0,
    tiltShift: true,
    colorGrading: true,
    vignette: true,
  };
  private profile: BiomeVisualProfile = getBiomeVisualProfile('meadow');

  private readonly handleContextRestored = (): void => {
    this.disposeComposer();
    if (!this.isSoftwareGl || isForcePostFxQuery()) {
      this.initComposer();
    }
  };

  constructor(
    private readonly webgl: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera
  ) {
    this.isSoftwareGl = detectSoftwareWebGl(webgl);
    if (!this.isSoftwareGl || isForcePostFxQuery()) {
      this.initComposer();
    }
    this.webgl.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private createDepthTarget(w: number, h: number): void {
    this.depthTexture?.dispose();
    this.sceneDepthTarget?.dispose();

    const depthTex = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    depthTex.generateMipmaps = false;

    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: depthTex,
    });

    this.depthTexture = depthTex;
    this.sceneDepthTarget = target;
  }

  private initComposer(): void {
    try {
      const w = Math.max(1, this.webgl.domElement.width);
      const h = Math.max(1, this.webgl.domElement.height);
      this.lastWidth = w;
      this.lastHeight = h;

      this.createDepthTarget(w, h);

      this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

      this.composer = new EffectComposer(this.webgl, this.renderTarget);
      this.composer.setPixelRatio(1);
      this.composer.setSize(w, h);

      // Pass 0: Pixel-Art Depth SSAO reading hardware sceneDepthTarget color + depth directly
      this.ssaoPass = new ShaderPass(PixelSsaoShader, '');
      this.ssaoPass.material.depthTest = false;
      this.ssaoPass.material.depthWrite = false;
      this.ssaoPass.uniforms.tDiffuse.value = this.sceneDepthTarget!.texture;
      this.ssaoPass.uniforms.tDepth.value = this.depthTexture;
      this.ssaoPass.uniforms.uTexelSize.value.set(1 / w, 1 / h);
      this.composer.addPass(this.ssaoPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        0.24, // crisp glow only for HDR lanterns, crystals, and fireflies
        0.30,
        1.04 // > 1.0 keeps SDR terrain, grass, and character sprites crisp
      );
      this.composer.addPass(this.bloomPass);

      this.gradePass = new ShaderPass(DioramaGradeShader);
      this.gradePass.uniforms.uTexelSize.value.set(1 / w, 1 / h);
      this.gradePass.uniforms.uSsaoStrength.value = 0.0;
      this.composer.addPass(this.gradePass);

      const outputPass = new OutputPass();
      this.composer.addPass(outputPass);

      this.applyProfileUniforms();
    } catch {
      this.disposeComposer();
    }
  }

  hasDepthSsao(): boolean {
    return Boolean(this.ssaoPass && this.depthTexture && this.composer);
  }

  getSsaoUniforms(): Record<string, THREE.IUniform> | null {
    return this.ssaoPass ? this.ssaoPass.uniforms : null;
  }

  setBiome(biome: BattleBiome, isInterior = false): void {
    this.biome = biome;
    this.profile = getBiomeVisualProfile(biome, { isInterior, isBattle: false });
    this.applyProfileUniforms();
  }

  setQualityTier(tier: FxQualityTier): void {
    if (this.qualityTier === tier) return;
    this.qualityTier = tier;
    this.applyProfileUniforms();
  }

  setPixelEffect(enabled: boolean): void {
    if (this.pixelEffect === enabled) return;
    this.pixelEffect = enabled;
    this.applyProfileUniforms();
  }

  setPostFxOptions(opts: PostFxOptions): void {
    if (
      this.postFxOptions.bloom === opts.bloom &&
      this.postFxOptions.bloomIntensity === opts.bloomIntensity &&
      this.postFxOptions.tiltShift === opts.tiltShift &&
      this.postFxOptions.colorGrading === opts.colorGrading &&
      this.postFxOptions.vignette === opts.vignette
    ) {
      return;
    }
    this.postFxOptions = { ...opts };
    this.applyProfileUniforms();
  }

  private applyProfileUniforms(): void {
    if (this.ssaoPass) {
      const su = this.ssaoPass.uniforms;
      const perspCam = this.camera as THREE.PerspectiveCamera;
      if (typeof perspCam.near === 'number') su.uCameraNear.value = perspCam.near;
      if (typeof perspCam.far === 'number') su.uCameraFar.value = perspCam.far;

      const w = Math.max(1, this.lastWidth || this.webgl.domElement.width);
      const h = Math.max(1, this.lastHeight || this.webgl.domElement.height);
      const aspect = w / h;
      const gridH = this.pixelEffect ? h : Math.min(h, BASE_RENDER_H);
      const gridW = this.pixelEffect ? w : Math.max(BASE_RENDER_W, Math.round(gridH * aspect));
      su.uPixelGrid.value.set(gridW, gridH);

      su.uSsaoStrength.value =
        this.qualityTier === 'high' ? 0.62 : this.qualityTier === 'medium' ? 0.48 : 0.0;

      const shadowHex =
        this.biome === 'cave'
          ? PALETTE.nightshade
          : this.biome === 'forest'
            ? PALETTE.pitchBlackGreen
            : this.biome === 'snow'
              ? PALETTE.stoneShadow
              : PALETTE.cryptInk;
      (su.uShadowTint.value as THREE.Color).set(shadowHex);
    }

    if (this.bloomPass) {
      const intensity = Math.max(0, Math.min(2, this.postFxOptions.bloomIntensity));
      this.bloomPass.enabled =
        this.qualityTier !== 'low' && this.postFxOptions.bloom && intensity > 0.02;
      const baseStrength = this.pixelEffect ? 0.16 : 0.24;
      this.bloomPass.strength = baseStrength * intensity;
    }
    if (!this.gradePass) return;

    const u = this.gradePass.uniforms;
    const allowTiltShift =
      this.qualityTier === 'high' && !this.pixelEffect && this.postFxOptions.tiltShift;
    u.uTiltStrength.value = allowTiltShift ? this.profile.tiltStrength : 0;
    u.uFocusY.value = this.profile.focusY;
    u.uFocusSpan.value = this.profile.focusSpan;
    u.uTint.value.copy(this.profile.tint);
    u.uLift.value.copy(this.profile.lift);
    u.uContrast.value = this.profile.contrast;
    u.uSaturation.value = this.profile.saturation;
    u.uGradeMix.value = this.postFxOptions.colorGrading ? 1.0 : 0.0;
    u.uVignette.value = this.postFxOptions.vignette ? this.profile.vignette : 0.0;
    u.uSsaoStrength.value = 0.0;
  }

  render(): void {
    try {
      const gl = this.webgl.getContext();
      if (gl?.isContextLost?.()) return;
    } catch {
      return;
    }

    const anyGradeFx =
      this.postFxOptions.bloom ||
      this.postFxOptions.tiltShift ||
      this.postFxOptions.colorGrading ||
      this.postFxOptions.vignette;

    if (
      (this.isSoftwareGl && !isForcePostFxQuery()) ||
      !this.composer ||
      !this.sceneDepthTarget ||
      this.qualityTier === 'low' ||
      !anyGradeFx
    ) {
      this.webgl.render(this.scene, this.camera);
      return;
    }

    const w = Math.max(1, this.webgl.domElement.width);
    const h = Math.max(1, this.webgl.domElement.height);
    if (w !== this.lastWidth || h !== this.lastHeight) {
      this.lastWidth = w;
      this.lastHeight = h;
      this.createDepthTarget(w, h);
      this.composer.setSize(w, h);
      this.bloomPass?.resolution.set(w, h);
      if (this.ssaoPass) {
        this.ssaoPass.uniforms.tDiffuse.value = this.sceneDepthTarget.texture;
        this.ssaoPass.uniforms.tDepth.value = this.depthTexture;
        this.ssaoPass.uniforms.uTexelSize.value.set(1 / w, 1 / h);
      }
      if (this.gradePass) {
        this.gradePass.uniforms.uTexelSize.value.set(1 / w, 1 / h);
      }
      this.applyProfileUniforms();
    }

    if (this.ssaoPass) {
      const perspCam = this.camera as THREE.PerspectiveCamera;
      if (typeof perspCam.near === 'number') {
        this.ssaoPass.uniforms.uCameraNear.value = perspCam.near;
      }
      if (typeof perspCam.far === 'number') {
        this.ssaoPass.uniforms.uCameraFar.value = perspCam.far;
      }
    }

    const prevTarget = this.webgl.getRenderTarget();
    this.webgl.setRenderTarget(this.sceneDepthTarget);
    this.webgl.clear(true, true, true);
    this.webgl.render(this.scene, this.camera);
    this.webgl.setRenderTarget(prevTarget);

    this.composer.render();
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.renderTarget?.dispose();
    this.sceneDepthTarget?.dispose();
    this.depthTexture?.dispose();
    this.composer = null;
    this.ssaoPass = null;
    this.bloomPass = null;
    this.gradePass = null;
    this.renderTarget = null;
    this.sceneDepthTarget = null;
    this.depthTexture = null;
  }

  dispose(): void {
    this.webgl.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.disposeComposer();
  }
}
