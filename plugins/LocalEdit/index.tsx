import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { FluxDispatcher, Menu, MessageActions, MessageStore, UserStore } from "@webpack/common";

type LocalEdits = Record<string, string>;

const DATASTORE_KEY = "LocalEdit_edits";

let edits: LocalEdits = {};
let editsReady = Promise.resolve();
let pendingLocalEdit: string | null = null;

function loadEdits(value: unknown): LocalEdits {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, content]) => typeof content === "string"));
}

function storeEdit(channelId: string, messageId: string, content?: string): Message | undefined {
    const original = MessageStore.getMessage(channelId, messageId);
    const isReset = content === undefined || content === original?.content;

    if (isReset) delete edits[messageId];
    else edits[messageId] = content;

    void DataStore.set(DATASTORE_KEY, { ...edits }).catch(error => {
        console.error("[LocalEdit] Failed to save local edits", error);
    });

    return original;
}

export default definePlugin({
    name: "LocalEdit",
    description: "Locally edit messages sent by others in chat. Edits are only visible to you.",
    authors: [{ name: "greyxp1", id: 1233920168196046892n }],
    dependencies: ["MessageEventsAPI"],
    patches: [
        {
            find: '.CUSTOM_GIFT?""',
            replacement: {
                match: /\i\.memo\(function\((\i)\)\{(?=let \i,\i)/,
                replace: "$&$1.message=$self.applyLocalEdit($1.message);"
            }
        }
    ],
    start() {
        editsReady = DataStore.get(DATASTORE_KEY).then(
            value => { edits = loadEdits(value); },
            error => { console.error("[LocalEdit] Failed to load local edits", error); }
        );
    },
    stop() {
        pendingLocalEdit = null;
    },
    flux: {
        MESSAGE_END_EDIT() {
            pendingLocalEdit = null;
        }
    },
    onBeforeMessageEdit(channelId, messageId, message) {
        if (pendingLocalEdit !== messageId) return;
        pendingLocalEdit = null;

        const original = storeEdit(channelId, messageId, message.content);

        setTimeout(() => {
            FluxDispatcher.dispatch({ type: "MESSAGE_END_EDIT", channelId });
            if (original) FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: original });
        }, 0);

        return { cancel: true };
    },
    contextMenus: {
        "message": (children, { message }) => {
            if (!message?.id || !message.channel_id) return;

            const currentUserId = UserStore.getCurrentUser()?.id;
            if (message.author?.id === currentUserId) return;

            const isEdited = edits[message.id] !== undefined;
            children.push(
                <Menu.MenuGroup>
                    <Menu.MenuItem
                        id="local-edit"
                        label={isEdited ? "Edit Locally Again" : "Edit Locally"}
                        action={async () => {
                            await editsReady;
                            pendingLocalEdit = message.id;
                            MessageActions.startEditMessage(
                                message.channel_id,
                                message.id,
                                edits[message.id] ?? message.content ?? ""
                            );
                        }}
                    />
                    {isEdited && (
                        <Menu.MenuItem
                            id="local-edit-reset"
                            label="Reset Local Edit"
                            action={async () => {
                                await editsReady;
                                const original = storeEdit(message.channel_id, message.id);
                                if (original) FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: original });
                            }}
                        />
                    )}
                </Menu.MenuGroup>
            );
        }
    },
    applyLocalEdit(message: Message): Message {
        if (!message || edits[message.id] === undefined) return message;

        return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
            content: edits[message.id]
        });
    }
});
