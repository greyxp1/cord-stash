import "./style.css";

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { DeleteIcon } from "@components/Icons";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelStore, Constants, IconUtils, Menu, Popout, React, RestAPI, SelectedChannelStore, Tooltip } from "@webpack/common";

type EmojiList = string[];
type EmojiRule = "users" | "channels";
type Rules = {
    ignored: Record<string, true>;
    users: Record<string, EmojiList>;
    channels: Record<string, EmojiList>;
};

const settings = definePluginSettings({
    ignoreBots: { type: OptionType.BOOLEAN, description: "Ignore bot messages", default: true },
    rules: {
        type: OptionType.CUSTOM,
        description: "Internal storage",
        default: { ignored: {}, users: {}, channels: {} } as Rules,
        hidden: true
    }
});

function cloneRules(): Rules {
    return JSON.parse(JSON.stringify(settings.store.rules));
}

function setEmojis(rule: EmojiRule, id: string, emojis: EmojiList): void {
    const rules = cloneRules();
    const values = rules[rule];
    if (emojis.length) values[id] = emojis;
    else delete values[id];
    settings.store.rules = rules;
}

function setUserIgnored(userId: string, ignored: boolean): void {
    const rules = cloneRules();
    const users = rules.ignored;
    if (ignored) users[userId] = true;
    else delete users[userId];
    settings.store.rules = rules;
}

async function addReactions(channelId: string, messageId: string, emojis: EmojiList): Promise<void> {
    for (const emoji of emojis) {
        try {
            await RestAPI.put({
                url: Constants.Endpoints.REACTION(channelId, messageId, emoji, "@me"),
                retries: 2
            });
        } catch (error) { console.error("[AutoReact] Failed to add reaction", error); }
    }
}

function getReactionEmojis(authorId: string, channelId: string): EmojiList | undefined {
    const { users, channels, ignored } = settings.store.rules;
    const user = users[authorId];
    const channel = ignored[authorId] ? undefined : channels[channelId];
    if (!user?.length) return channel;
    if (!channel?.length) return user;
    return [...new Set([...user, ...channel])];
}

type EmojiPayload = { id?: string | null; name?: string | null; optionallyDiverseSequence?: string; };
type EmojiPickerProps = {
    channel?: Channel | null;
    closePopout(): void;
    onSelectEmoji(selection: { emoji: EmojiPayload | null; willClose: boolean; }): void;
};
type NativeEmojiButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
};

const EmojiPicker = findComponentByCodeLazy<EmojiPickerProps>("showAddEmojiButton:", "pickerIntention:", "messageId:");
const NativeEmojiButton = findComponentByCodeLazy<NativeEmojiButtonProps>("canShowNUXPremiumTooltip", "TRIAL_NUX_EMOJI_BUTTON");

function ContextPickerButton({ onSelect, channelId, targetRef, tooltip }: {
    onSelect(emoji: string): void;
    channelId?: string;
    targetRef: React.RefObject<HTMLElement | null>;
    tooltip: string;
}) {
    const [show, setShow] = React.useState(false);
    const popoutRef = React.useRef<HTMLDivElement>(null);
    const closeRef = React.useRef<(() => void) | null>(null);
    const channel = ChannelStore.getChannel(channelId ?? SelectedChannelStore.getChannelId());

    function dismiss(): void {
        closeRef.current?.();
        setShow(false);
    }

    React.useEffect(() => {
        if (!show) return;

        function onPointerDown(event: PointerEvent): void {
            const target = event.target;
            if (!(target instanceof Element)
                || target.closest(".auto-react-menu-picker")
                || popoutRef.current?.contains(target)) return;
            dismiss();
        }

        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [show]);

    return (
        <Popout
            position="right"
            align="center"
            animation={Popout.Animation.NONE}
            autoInvert
            nudgeAlignIntoViewport
            spacing={0}
            shouldShow={show}
            onRequestOpen={() => setShow(true)}
            onRequestClose={() => setShow(false)}
            targetElementRef={targetRef}
            renderPopout={({ closePopout }) => <div ref={node => {
                popoutRef.current = node;
                closeRef.current = node ? closePopout : null;
            }} className="auto-react-layer-content">
                <EmojiPicker channel={channel} closePopout={dismiss} onSelectEmoji={({ emoji }) => {
                    const value = emoji?.id && emoji.name
                        ? `${emoji.name}:${emoji.id}`
                        : emoji?.optionallyDiverseSequence?.trim() || emoji?.name?.trim() || "";
                    dismiss();
                    if (value) onSelect(value);
                }} />
            </div>}
        >
            {(props, { isShown }) => <Tooltip text={tooltip} position="top" delay={750} hideOnClick tooltipClassName="auto-react-layer-content">
                {tooltipProps => <NativeEmojiButton
                    {...props}
                    {...tooltipProps}
                    active={isShown}
                    aria-label={tooltip}
                    className="auto-react-menu-picker"
                    onClick={() => show ? dismiss() : setShow(true)}
                />}
            </Tooltip>}
        </Popout>
    );
}

function EmojiPreview({ emoji }: { emoji: string; }) {
    const custom = /^(.+):(\d+)$/.exec(emoji);
    return custom
        ? <img src={IconUtils.getEmojiURL({ id: custom[2], animated: false, size: 32 })} alt={custom[1]} />
        : <span>{emoji}</span>;
}

function ContextEmojiRow({ initialEmojis, channelId, onChange, initialIgnored = false, onIgnoreChange }: {
    initialEmojis: EmojiList;
    channelId?: string;
    onChange(emojis: EmojiList): void;
    initialIgnored?: boolean;
    onIgnoreChange?(ignored: boolean): void;
}) {
    const [emojis, setLocalEmojis] = React.useState(initialEmojis);
    const [ignored, setIgnored] = React.useState(initialIgnored);
    const rowRef = React.useRef<HTMLSpanElement>(null);
    const toggleLabel = `${ignored ? "Enable" : "Disable"} channel reactions for this user`;

    function update(emojis: EmojiList): void {
        setLocalEmojis(emojis);
        onChange(emojis);
    }

    return (
        <span ref={rowRef} className="auto-react-menu-row" onClick={event => {
            event.preventDefault();
            event.stopPropagation();
        }}>
            <span>Auto React</span>
            <span className="auto-react-menu-emojis">
                {emojis.map(emoji => (
                    <button key={emoji} type="button" className="auto-react-menu-emoji" aria-label={`Remove ${emoji}`}
                        onClick={() => update(emojis.filter(value => value !== emoji))}>
                        <span className="auto-react-menu-emoji-preview"><EmojiPreview emoji={emoji} /></span>
                        <DeleteIcon className="auto-react-menu-emoji-remove" />
                    </button>
                ))}
                <ContextPickerButton
                    channelId={channelId}
                    targetRef={rowRef}
                    tooltip={`Add ${onIgnoreChange ? "user" : "channel"} reaction`}
                    onSelect={emoji => !emojis.includes(emoji) && update([...emojis, emoji])}
                />
                {onIgnoreChange && <Tooltip text={toggleLabel} position="right" delay={750} hideOnClick tooltipClassName="auto-react-layer-content">
                    {({ onMouseEnter, onMouseLeave }) => <button
                        type="button"
                        className={`auto-react-channel-toggle${ignored ? " auto-react-channel-toggle-ignored" : ""}`}
                        aria-label={toggleLabel}
                        aria-pressed={ignored}
                        onMouseEnter={onMouseEnter}
                        onMouseLeave={onMouseLeave}
                        onClick={() => {
                            const next = !ignored;
                            setIgnored(next);
                            onIgnoreChange(next);
                        }}
                    ><span aria-hidden="true">#</span></button>}
                </Tooltip>}
            </span>
        </span>
    );
}

function makeContextEmojiItem({ id, emojis, channelId, onChange, ignored, onIgnoreChange }: {
    id: string;
    emojis: EmojiList;
    channelId?: string;
    onChange(emojis: EmojiList): void;
    ignored?: boolean;
    onIgnoreChange?(ignored: boolean): void;
}) {
    return <Menu.MenuItem id={id} label={
        <ContextEmojiRow
            initialEmojis={emojis}
            channelId={channelId}
            onChange={onChange}
            initialIgnored={ignored}
            onIgnoreChange={onIgnoreChange}
        />
    } />;
}

const userContextMenu: NavContextMenuPatchCallback = (children, { user }) => {
    const userId = user?.id;
    if (!userId) return;
    const { users, ignored } = settings.store.rules;
    children.push(
        <Menu.MenuGroup>
            {makeContextEmojiItem({
                id: "auto-react-user-emojis",
                emojis: users[userId] ?? [],
                ignored: !!ignored[userId],
                onChange: emojis => setEmojis("users", userId, emojis),
                onIgnoreChange: ignored => setUserIgnored(userId, ignored)
            })}
        </Menu.MenuGroup>
    );
};

const channelContextMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    const channelId = channel?.id;
    if (!channelId) return;
    children.push(
        <Menu.MenuGroup>
            {makeContextEmojiItem({
                id: "auto-react-channel-emojis",
                channelId,
                emojis: settings.store.rules.channels[channelId] ?? [],
                onChange: emojis => setEmojis("channels", channelId, emojis)
            })}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "AutoReact",
    description: "Automatically react to messages using configurable user and channel rules.",
    authors: [{ name: "greyxp1", id: 1233920168196046892n }],
    settings,
    flux: {
        MESSAGE_CREATE({ message, channelId, optimistic }) {
            if (optimistic || !message?.id || settings.store.ignoreBots && message.author?.bot) return;
            const authorId = message.author?.id;
            if (!authorId) return;
            const emojis = getReactionEmojis(authorId, channelId);
            if (emojis?.length) void addReactions(channelId, message.id, emojis);
        }
    },
    contextMenus: {
        "channel-context": channelContextMenu,
        "user-context": userContextMenu
    }
});
