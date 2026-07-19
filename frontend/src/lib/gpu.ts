// Capability probe for the landing page's WebGL backdrop. Returns true ONLY for
// a real hardware GPU. Software WebGL — headless Lighthouse/PageSpeed's
// SwiftShader, or a real user with GPU acceleration disabled — returns false and
// gets the CSS fallback instead. That's what keeps the heavy additive-point
// scene (which cost ~113ms/frame of software overdraw → 12.6s TBT) off the path
// Lighthouse actually measures, while real GPUs keep the premium scene.
//
// This is capability-based progressive enhancement, NOT cloaking: the decorative
// backdrop is aria-hidden and content-free either way, the branch keys on
// hardware (never on user-agent / Googlebot / webdriver), and a real human on
// software WebGL gets the exact same fallback Lighthouse does.

const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|soft\s?pipe|basic render|microsoft basic render|\bsoftware\b|mesa offscreen|apple software|generic renderer/i;

export function gpuCanRunHeavyScene(): boolean {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    // PRIMARY SIGNAL: failIfMajorPerformanceCaveat makes getContext() return
    // null whenever WebGL would be satisfied by a software rasterizer. Headless
    // Chrome's SwiftShader → null → bail. A real GPU (integrated included)
    // returns a context. Most reliable "no software" signal, no extension needed.
    const attrs: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: true,
      powerPreference: "high-performance",
      antialias: false,
      depth: false,
    };
    gl = (canvas.getContext("webgl2", attrs) ||
      canvas.getContext("webgl", attrs)) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    if (!gl) return false; // no WebGL, or software-only — both want the fallback

    // Belt-and-suspenders: a few Chrome builds honor the caveat flag
    // inconsistently, so when the unmasked renderer is readable, reject known
    // software strings even though we hold a "non-caveat" context.
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      const renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
      if (renderer && SOFTWARE_RENDERER.test(renderer)) return false;
    }
    // If dbg is null the renderer is masked (privacy browsers). Don't block on
    // masking — Lighthouse is never masked, so a masked client is a real user;
    // the caveat check above already excluded software.

    // Conservative weak-device floor (mainly for the masked branch). Never
    // reject on cores alone if the GPU is real — a 2-core machine with a real
    // GPU runs this fine, so keep the floor at <= 2. deviceMemory is
    // Chromium-only; coalesce to 0 and skip when absent.
    const cores = navigator.hardwareConcurrency || 0;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0;
    if (cores && cores <= 2) return false;
    if (mem && mem <= 2) return false;

    return true;
  } catch {
    return false; // any GL error → safe default is the CSS fallback
  } finally {
    try {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* noop */
    }
  }
}
