import {
  activeImageModel, activeVisionModel, backdropModel, claudeConfigured, claudeEffort, claudeModel, cutoutModel,
  deepinfraConfigured, editModel, falConfigured, geminiConfigured, geminiImageModel, geminiTextModel, igSendMode,
  igTokenConfigured, imageProvider, openrouterConfigured, openrouterModels, relayConfigured, visionModel, visionProvider,
} from "@/lib/config";
import { FIDELITY_MIN } from "@/lib/visuals";
import { hasCustomLogo } from "@/lib/brand";
import LogoSettings from "./LogoSettings";

export const dynamic = "force-dynamic";

function Key({ ok }: { ok: boolean }) {
  return ok ? <span className="badge ok">key set</span> : <span className="badge low">no key</span>;
}

const NAMES = {
  claude: "Claude", gemini: "Google Gemini", deepinfra: "DeepInfra (Qwen3-VL)", fal: "fal.ai (Qwen-Image-Edit)",
  openrouter: "OpenRouter (free models)",
} as const;

export default async function Settings() {
  const vision = visionProvider();
  const image = imageProvider();
  const customLogo = await hasCustomLogo();

  return (
    <>
      <h1>Settings</h1>

      <LogoSettings custom={customLogo} />

      <div className="card pad">
        <h2>Active AI</h2>
        <p>
          <b>Reading photos &amp; making decisions:</b> {vision ? `${NAMES[vision]} · ` : "none (demo text)"}
          {vision && <code>{activeVisionModel()}</code>}
        </p>
        <p>
          <b>Making pictures:</b> {image ? `${NAMES[image]} · ` : "none: real photos only, cutouts on backdrops drawn by code"}
          {image && <code>{activeImageModel()}</code>}
        </p>
        <p className="muted">
          Match-score warning below <code>{FIDELITY_MIN}%</code>. Change providers in <code>.env.local</code> with{" "}
          <code>VISION_PROVIDER</code> (claude, gemini, deepinfra, openrouter, demo) and <code>IMAGE_PROVIDER</code> (gemini, fal, demo),
          then restart <code>npm run dev</code>. Claude cannot make pictures.
        </p>
      </div>

      <div className="card pad">
        <h2>Claude (Anthropic API)</h2>
        <p><Key ok={claudeConfigured()} /></p>
        <p className="muted">
          Model <code>{claudeModel()}</code> · effort <code>{claudeEffort()}</code>. Needs an API key from{" "}
          console.anthropic.com. A claude.ai subscription does not include one.
        </p>
      </div>

      <div className="card pad">
        <h2>Google Gemini</h2>
        <p><Key ok={geminiConfigured()} /></p>
        <ul className="muted" style={{ paddingLeft: "1.2rem" }}>
          <li>Reads photos (when chosen): <code>{geminiTextModel()}</code></li>
          <li>Makes scenes, on-model and scale shots: <code>{geminiImageModel()}</code></li>
        </ul>
      </div>

      <div className="card pad">
        <h2>fal.ai (open-weight pictures)</h2>
        <p><Key ok={falConfigured()} /></p>
        <ul className="muted" style={{ paddingLeft: "1.2rem" }}>
          <li>Scenes, on-model, scale: <code>{editModel()}</code></li>
          <li>Safe-mode cutout: <code>{cutoutModel()}</code> · backdrop: <code>{backdropModel()}</code></li>
        </ul>
        <p className="muted">Safe mode (keep my real product pixels) needs this key even when Gemini makes the pictures.</p>
      </div>

      <div className="card pad">
        <h2>DeepInfra (open-weight photo reading)</h2>
        <p><Key ok={deepinfraConfigured()} /></p>
        <p className="muted">Model: <code>{visionModel()}</code></p>
      </div>

      <div className="card pad">
        <h2>OpenRouter (free photo-reading models)</h2>
        <p><Key ok={openrouterConfigured()} /></p>
        <ul className="muted" style={{ paddingLeft: "1.2rem" }}>
          <li>Tried in this order: {openrouterModels().map((m) => <code key={m} style={{ marginRight: ".4rem" }}>{m}</code>)}</li>
          <li>Free models allow 20 requests a minute and 50 a day until credits are bought. Product photos go to the model host, and free
            hosts may keep prompts, so only your own product photos are sent. Customer messages never are.</li>
        </ul>
        <p className="muted">Use it with <code>VISION_PROVIDER=openrouter</code>. Change the list with <code>OPENROUTER_MODELS</code>.</p>
      </div>

      <div className="card pad">
        <h2>Instagram inbox</h2>
        <ul className="muted" style={{ paddingLeft: "1.2rem" }}>
          <li>Relay (receives messages for the Studio): {relayConfigured() ? <span className="badge ok">connected</span> : <span className="badge low">not set up</span>}</li>
          <li>Access token (needed only to send replies from here): <Key ok={igTokenConfigured()} /></li>
          <li>Sending: <code>{igSendMode() === "live" ? "live" : "draft-only"}</code></li>
        </ul>
        <p className="muted">
          Set <code>RELAY_URL</code>, <code>RELAY_PULL_TOKEN</code>, <code>IG_ACCESS_TOKEN</code> and <code>IG_SEND_MODE</code> in{" "}
          <code>.env.local</code>. The inbox works without any of them: paste messages in by hand. See <code>docs/INSTAGRAM.md</code>.
        </p>
      </div>

      <div className="card pad">
        <h2>Brand voice &amp; knowledge base</h2>
        <p className="muted">
          The AI writes using <code>docs/BRAND.md</code>. Edit that file to change tone, banned phrases or hashtags.
          Fill in the <b>[CONFIRM]</b> items in <code>docs/KNOWLEDGE_BASE.md</code> before the Instagram bot goes live.
        </p>
      </div>
    </>
  );
}
