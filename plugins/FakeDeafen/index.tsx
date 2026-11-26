import {
  addContextMenuPatch,
  findGroupChildrenByChildId,
  NavContextMenuPatchCallback,
  removeContextMenuPatch,
} from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import {
  ChannelStore,
  MediaEngineStore,
  Menu,
  React,
  SelectedChannelStore,
  UserStore,
} from "@webpack/common";

const settings = definePluginSettings({
  fakeDeafened: {
    type: OptionType.BOOLEAN,
    description: "Fake Deafen Status",
    default: false,
    onChange: syncFakeDeafen,
  },
});

let socket: any, originalSend: any, originalToggleMute: any;
let active = false;
let MediaEngineActions: any;

function sendVoiceState(mute: boolean, deaf: boolean) {
  const channelId = SelectedChannelStore?.getVoiceChannelId();
  if (!socket || !channelId) return;
  const payload = {
    guildId: ChannelStore?.getChannel(channelId)?.guild_id ?? null,
    channelId,
    selfMute: mute,
    selfDeaf: deaf,
    selfVideo: MediaEngineStore?.isVideoEnabled?.() ?? false,
  };
  try {
    if (typeof socket.voiceStateUpdate === "function") {
      socket.voiceStateUpdate(payload);
    } else {
      socket.send(4, {
        guild_id: payload.guildId,
        channel_id: payload.channelId,
        self_mute: payload.selfMute,
        self_deaf: payload.selfDeaf,
        self_video: payload.selfVideo,
        flags: 0,
      });
    }
  } catch (e) {
    console.error("[FakeDeafen]", e);
  }
}

function syncFakeDeafen(enabled: boolean) {
  if (!active) return;
  const muted =
    MediaEngineStore?.isSelfMute?.() ?? MediaEngineStore?.isMute?.() ?? false;
  if (enabled !== muted) originalToggleMute?.call(MediaEngineActions);
  else sendVoiceState(enabled, enabled);
}

const userContextPatch: NavContextMenuPatchCallback = (children, { user }) => {
  if (user?.id !== UserStore.getCurrentUser()?.id) return;
  const item = (
    <Menu.MenuCheckboxItem
      id="fake-deafen-toggle"
      label="Fake Deafen"
      checked={settings.store.fakeDeafened}
      action={() => {
        settings.store.fakeDeafened = !settings.store.fakeDeafened;
      }}
    />
  );
  const group =
    findGroupChildrenByChildId("mute", children) ??
    findGroupChildrenByChildId("deafen", children);
  if (group) group.push(item);
  else children.push(<Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

export default definePlugin({
  name: "FakeDeafen",
  description: "Fake deafen yourself using native framework APIs",
  authors: [{ name: "greyxp1", id: 1233920168196046892n }],
  settings,

  start() {
    settings.store.fakeDeafened = false;
    MediaEngineActions = findByProps("toggleSelfMute", "toggleSelfDeaf");
    socket = findByProps("getSocket")?.getSocket();
    if (!socket) return;

    originalSend = socket.send;
    socket.send = function (op: number, data: any, ...args: any[]) {
      if (op === 4 && settings.store.fakeDeafened && data?.channel_id)
        data.self_mute = data.self_deaf = true;
      return originalSend.apply(this, [op, data, ...args]);
    };

    originalToggleMute = MediaEngineActions.toggleSelfMute;
    MediaEngineActions.toggleSelfMute = function (...args: any[]) {
      const muted =
        MediaEngineStore?.isSelfMute?.() ?? MediaEngineStore?.isMute?.() ?? false;
      if (settings.store.fakeDeafened && muted) {
        settings.store.fakeDeafened = false;
        return;
      }
      return originalToggleMute.apply(this, args);
    };

    addContextMenuPatch("user-context", userContextPatch);
    active = true;
  },

  stop() {
    if (settings.store.fakeDeafened) settings.store.fakeDeafened = false;
    if (socket && originalSend) socket.send = originalSend;
    if (MediaEngineActions && originalToggleMute)
      MediaEngineActions.toggleSelfMute = originalToggleMute;
    removeContextMenuPatch("user-context", userContextPatch);
    active = false;
  },
});
