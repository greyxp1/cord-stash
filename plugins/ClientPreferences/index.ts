import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import {
  FluxDispatcher,
  MediaEngineStore,
  NotificationSettingsStore,
} from "@webpack/common";

const logger = new Logger("ClientPreferences");
const unchanged = "unchanged";
let active = false;
let pending = false;
const toggle = (description: string) => ({
  type: OptionType.SELECT as const,
  description,
  options: [
    { label: "Leave unchanged", value: unchanged, default: true },
    { label: "Enabled", value: true },
    { label: "Disabled", value: false },
  ] as const,
  onChange: applyPreferences,
});

const settings = definePluginSettings({
  inputProfile: {
    type: OptionType.SELECT,
    description: "Voice input profile",
    options: [
      { label: "Leave unchanged", value: unchanged, default: true },
      { label: "Studio", value: "STUDIO" },
      { label: "Voice isolation", value: "VOICE_ISOLATION" },
      { label: "Custom", value: "CUSTOM" },
    ],
    onChange: applyPreferences,
  },
  qos: toggle("Quality of Service High Packet Priority"),
  silenceWarning: toggle("Warn when Discord cannot detect microphone input"),
  sidechainCompression: toggle("Lower stream audio while people speak"),
  attenuation: {
    type: OptionType.SLIDER,
    description:
      "Audio attenuation percentage, or a negative value to leave unchanged",
    markers: [-1, 0, 25, 50, 75, 100],
    stickToMarkers: false,
    default: -1,
    isValid: (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= -1 &&
      value <= 100,
    onChange: applyPreferences,
  },
  attenuateWhileSpeakingSelf: toggle("Attenuate audio while you speak"),
  attenuateWhileSpeakingOthers: toggle("Attenuate audio while others speak"),
  channelSwitchWarning: toggle("Confirm switching voice channels"),
  desktopNotifications: toggle("Discord desktop notifications"),
  notificationSounds: toggle("Discord notification sounds"),
});

function applyPreference(
  name: string,
  update: () => Parameters<typeof FluxDispatcher.dispatch>[0] | undefined,
) {
  const report = (error: unknown) =>
    logger.error(`Failed to apply ${name}`, error);
  try {
    const action = update();
    if (action) FluxDispatcher.dispatch(action).catch(report);
  } catch (error) {
    report(error);
  }
}

function applyPreferences() {
  if (!active || pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    if (!active) return;
    const prefs = settings.store;
    applyPreference("input profile", () => {
      if (
        prefs.inputProfile !== unchanged &&
        prefs.inputProfile !== MediaEngineStore.getActiveInputProfile()
      )
        return {
          type: "AUDIO_SET_ACTIVE_INPUT_PROFILE",
          inputProfile: prefs.inputProfile,
        };
    });
    applyPreference("QoS", () => {
      if (
        typeof prefs.qos === "boolean" &&
        prefs.qos !== MediaEngineStore.getQoS()
      )
        return {
          type: "AUDIO_SET_QOS",
          enabled: prefs.qos,
        };
    });
    applyPreference("silence warning", () => {
      if (
        typeof prefs.silenceWarning === "boolean" &&
        prefs.silenceWarning !== MediaEngineStore.getEnableSilenceWarning()
      )
        return {
          type: "AUDIO_SET_DISPLAY_SILENCE_WARNING",
          enabled: prefs.silenceWarning,
        };
    });
    applyPreference("sidechain compression", () => {
      if (
        typeof prefs.sidechainCompression === "boolean" &&
        prefs.sidechainCompression !==
          MediaEngineStore.getSettings().sidechainCompression
      )
        return {
          type: "AUDIO_SET_SIDECHAIN_COMPRESSION",
          enabled: prefs.sidechainCompression,
        };
    });
    applyPreference("attenuation", () => {
      if (
        prefs.attenuation < 0 &&
        typeof prefs.attenuateWhileSpeakingSelf !== "boolean" &&
        typeof prefs.attenuateWhileSpeakingOthers !== "boolean"
      )
        return;
      const attenuation =
        prefs.attenuation >= 0
          ? prefs.attenuation
          : MediaEngineStore.getAttenuation();
      const self =
        typeof prefs.attenuateWhileSpeakingSelf === "boolean"
          ? prefs.attenuateWhileSpeakingSelf
          : MediaEngineStore.getAttenuateWhileSpeakingSelf();
      const others =
        typeof prefs.attenuateWhileSpeakingOthers === "boolean"
          ? prefs.attenuateWhileSpeakingOthers
          : MediaEngineStore.getAttenuateWhileSpeakingOthers();
      if (
        attenuation !== MediaEngineStore.getAttenuation() ||
        self !== MediaEngineStore.getAttenuateWhileSpeakingSelf() ||
        others !== MediaEngineStore.getAttenuateWhileSpeakingOthers()
      )
        return {
          type: "AUDIO_SET_ATTENUATION",
          attenuation,
          attenuateWhileSpeakingSelf: self,
          attenuateWhileSpeakingOthers: others,
        };
    });
    applyPreference("channel switch warning", () => {
      if (typeof prefs.channelSwitchWarning !== "boolean") return;
      return {
        type: "UNSYNCED_USER_SETTINGS_UPDATE",
        settings: {
          disableVoiceChannelChangeAlert: !prefs.channelSwitchWarning,
        },
      };
    });
    applyPreference("desktop notifications", () => {
      if (typeof prefs.desktopNotifications !== "boolean") return;
      const desktopType = prefs.desktopNotifications ? "ALL" : "NEVER";
      if (desktopType === NotificationSettingsStore.getDesktopType()) return;
      return {
        type: "NOTIFICATIONS_SET_DESKTOP_TYPE",
        desktopType,
      };
    });
    applyPreference("notification sounds", () => {
      if (
        typeof prefs.notificationSounds === "boolean" &&
        NotificationSettingsStore.getDisableAllSounds() ===
          prefs.notificationSounds
      )
        return {
          type: "NOTIFICATIONS_TOGGLE_ALL_DISABLED",
        };
    });
  });
}

export default definePlugin({
  name: "ClientPreferences",
  description:
    "Applies configured Discord notification and voice preferences at startup and login.",
  authors: [{ name: "greyxp1", id: 1233920168196046892n }],
  settings,
  start() {
    active = true;
    applyPreferences();
  },
  stop() {
    active = false;
  },
  flux: {
    LOGIN_SUCCESS: applyPreferences,
    CONNECTION_OPEN: applyPreferences,
  },
});
