import * as DataStore from "@api/DataStore";
import { updateMessage } from "@api/MessageUpdater";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { EditMessageStore, FluxDispatcher, Menu, MessageActions, MessageCache, MessageStore, UserStore } from "@webpack/common";

type LocalEdits = Record<string, string>;

const DATASTORE_KEY = "LocalEdit_edits";

let edits: LocalEdits = {};
let editsReady = Promise.resolve();
let active = false;
let pendingLocalEdit: string | null = null;

function loadEdits(value: unknown): LocalEdits {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, content]) => typeof content === "string"));
}

function storeEdit(channelId: string, messageId: string, content?: string) {
    if (content === undefined || content === MessageStore.getMessage(channelId, messageId)?.content) delete edits[messageId];
    else edits[messageId] = content;

    void DataStore.set(DATASTORE_KEY, edits).catch(error => {
        console.error("[LocalEdit] Failed to save local edits", error);
    });

    updateMessage(channelId, messageId);
}

export default definePlugin({
    name: "LocalEdit",
    description: "Locally edit messages sent by others in chat. Edits are only visible to you.",
    authors: [{ name: "greyxp1", id: 1233920168196046892n }],
    dependencies: ["MessageUpdaterAPI"],
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
        active = true;
        editsReady = DataStore.get(DATASTORE_KEY).then(
            value => {
                if (!active) return;
                edits = loadEdits(value);
                for (const channelId in MessageCache._channelMessages) {
                    for (const messageId in edits) updateMessage(channelId, messageId);
                }
            },
            error => { console.error("[LocalEdit] Failed to load local edits", error); }
        );
    },
    stop() {
        active = false;
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

        storeEdit(channelId, messageId, message.content);

        // Let the textarea finish handling the cancelled submit before closing it.
        setTimeout(() => {
            if (EditMessageStore.isEditing(channelId, messageId)) {
                FluxDispatcher.dispatch({ type: "MESSAGE_END_EDIT", channelId });
            }
        });

        return { cancel: true };
    },
    contextMenus: {
        "message": (children, { message }) => {
            if (!message?.id || !message.channel_id) return;
            if (message.author?.id === UserStore.getCurrentUser()?.id) return;

            const isEdited = edits[message.id] !== undefined;
            children.push(
                <Menu.MenuGroup>
                    <Menu.MenuItem
                        id="local-edit"
                        label={isEdited ? "Edit Locally Again" : "Edit Locally"}
                        action={async () => {
                            await editsReady;
                            if (!active) return;
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
                                if (active) storeEdit(message.channel_id, message.id);
                            }}
                        />
                    )}
                </Menu.MenuGroup>
            );
        }
    },
    applyLocalEdit(message: Message): Message {
        const content = message && edits[message.id];
        return content === undefined ? message : message.merge({ content });
    }
});
