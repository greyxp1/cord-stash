import definePlugin from "@utils/types";
import { findByProps } from "@webpack";

let unpatchVoiceConnect: (() => void) | undefined;
export default definePlugin({
  name: "BetterAudioDefaults",
  description:
    "Enables Studio Profile and QoS while disabling audio attenuation and VC-switching/mic silence warnings.",
  authors: [{ name: "greyxp1", id: 1233920168196046892n }],
  tags: ["Voice", "Utility"],

  start() {
    const mediaEngine = findByProps("setActiveInputProfile");
    if (mediaEngine) {
      mediaEngine.setActiveInputProfile("STUDIO");
      mediaEngine.setSilenceWarning(false);
      mediaEngine.setQoS(true);
      mediaEngine.setSidechainCompression(false);
      mediaEngine.setAttenuation(0, false, false);
    }

    const vcModule = findByProps("handleVoiceConnect");
    if (vcModule?.handleVoiceConnect) {
      const originalFn = vcModule.handleVoiceConnect;
      vcModule.handleVoiceConnect = Object.assign(
        (...args: unknown[]) =>
          originalFn.call(
            vcModule,
            {
              ...(args[0] as Record<string, unknown>),
              bypassChangeModal: true,
            },
            ...args.slice(1),
          ),
        originalFn,
      );
      unpatchVoiceConnect = () => {
        vcModule.handleVoiceConnect = originalFn;
      };
    }
  },

  stop() {
    unpatchVoiceConnect?.();
    unpatchVoiceConnect = undefined;
  },
});
