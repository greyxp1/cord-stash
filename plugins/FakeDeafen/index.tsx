import {
  findGroupChildrenByChildId,
  NavContextMenuPatchCallback,
} from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { findByProps } from "@webpack";
import {
  ChannelStore,
  MediaEngineStore,
  Menu,
  SelectedChannelStore,
  UserStore,
} from "@webpack/common";

let socket: any, originalSend: any, originalToggleMute: any;
let active = false;
let fakeDeafened = false;
let MediaEngineActions: any;

const isMuted = () =>
  MediaEngineStore?.isSelfMute?.() ?? MediaEngineStore?.isMute?.() ?? false;

function sendVoiceState(mute: boolean, deaf: boolean) {
  const channelId = SelectedChannelStore?.getVoiceChannelId();
  if (!socket || !channelId) return;
  try {
    socket.voiceStateUpdate({
      guildId: ChannelStore?.getChannel(channelId)?.guild_id ?? null,
      channelId,
      selfMute: mute,
      selfDeaf: deaf,
      selfVideo: MediaEngineStore?.isVideoEnabled?.() ?? false,
    });
  } catch (e) {
    console.error("[FakeDeafen]", e);
  }
}

function setFakeDeafened(enabled: boolean) {
  if (fakeDeafened === enabled) return;
  fakeDeafened = enabled;
  if (!active) return;
  if (enabled !== isMuted()) originalToggleMute?.call(MediaEngineActions);
  else sendVoiceState(enabled, enabled);
}

const userContextPatch: NavContextMenuPatchCallback = (children, { user }) => {
  if (!active || user?.id !== UserStore.getCurrentUser()?.id) return;
  const item = (
    <Menu.MenuCheckboxItem
      id="fake-deafen-toggle"
      label="Fake Deafen"
      checked={fakeDeafened}
      action={() => setFakeDeafened(!fakeDeafened)}
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
  patches: [
    {
      find: "isSelfMutedTemporarily(),selfDeaf:",
      replacement: {
        match:
          /(\i\.sessionId===\i)(?=\?\i\.merge\(\{selfMute:\i,selfDeaf:\i\}\))/,
        replace: "$1&&!$self.isFakeDeafened()",
      },
    },
  ],
  contextMenus: {
    "user-context": userContextPatch,
  },

  isFakeDeafened: () => active && fakeDeafened,

  start() {
    MediaEngineActions = findByProps("toggleSelfMute", "toggleSelfDeaf");
    socket = findByProps("getSocket")?.getSocket();
    if (!socket) return;

    originalSend = socket.send;
    socket.send = function (op: number, data: any, ...args: any[]) {
      if (op === 4 && fakeDeafened && data?.channel_id)
        data.self_mute = data.self_deaf = true;
      return originalSend.apply(this, [op, data, ...args]);
    };

    originalToggleMute = MediaEngineActions.toggleSelfMute;
    MediaEngineActions.toggleSelfMute = function (...args: any[]) {
      if (fakeDeafened && isMuted()) return setFakeDeafened(false);
      return originalToggleMute.apply(this, args);
    };

    active = true;
  },

  stop() {
    setFakeDeafened(false);
    if (socket && originalSend) socket.send = originalSend;
    if (MediaEngineActions && originalToggleMute)
      MediaEngineActions.toggleSelfMute = originalToggleMute;
    active = false;
  },
});
