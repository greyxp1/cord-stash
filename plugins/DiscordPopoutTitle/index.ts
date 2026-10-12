/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 greyxp1
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { FluxDispatcher, PopoutWindowStore } from "@webpack/common";

const prefix = "Discord Popout: ";
const popouts = new Map<Window, () => void>();
let pending: { key: string; cancelled: boolean; window?: Window; } | undefined;

function cancelPending() {
    if (pending) pending.cancelled = true;
}

function getDocument(win: Window): Document | undefined {
    try {
        return win.closed ? undefined : win.document;
    } catch {
        return undefined;
    }
}

function updatePopouts() {
    const windows = new Set(PopoutWindowStore.getWindowKeys()
        .map(key => PopoutWindowStore.getWindow(key))
        .filter((win): win is Window => win !== undefined && getDocument(win) !== undefined));

    for (const [win, cleanup] of popouts) {
        if (!windows.has(win)) {
            cleanup();
            popouts.delete(win);
        }
    }

    for (const win of windows) {
        if (popouts.has(win)) continue;

        const updateTitle = () => {
            const document = getDocument(win);
            if (document && !document.title.startsWith(prefix)) {
                document.title = prefix + document.title;
            }
        };
        const observer = new MutationObserver(updateTitle);
        const watchTitle = () => {
            observer.disconnect();
            const document = getDocument(win);
            if (!document?.head) return;
            updateTitle();
            observer.observe(document.head, { childList: true, subtree: true, characterData: true });
        };

        win.addEventListener("load", watchTitle);
        watchTitle();
        popouts.set(win, () => {
            observer.disconnect();
            const document = getDocument(win);
            if (!document) return;
            win.removeEventListener("load", watchTitle);
            if (document.title.startsWith(prefix)) {
                document.title = document.title.slice(prefix.length);
            }
        });
    }
}

export default definePlugin({
    name: "DiscordPopoutTitle",
    description: "Marks Discord popout titles for window manager rules.",
    authors: [{ name: "greyxp1", id: 1233920168196046892n }],
    patches: [
        {
            find: 'type:"POPOUT_WINDOW_OPEN",',
            predicate: () => IS_WEB && "documentPictureInPicture" in window,
            replacement: {
                match: /\i\.\i\.dispatch\(\{type:"POPOUT_WINDOW_OPEN",/,
                replace: '$self.openPopout({type:"POPOUT_WINDOW_OPEN",'
            },
        },
        {
            find: "getWindowKeys(){return Object.keys(",
            predicate: () => IS_WEB && "documentPictureInPicture" in window,
            replacement: {
                match: /window\.open\(([^,]+),(\i),(\i)\)/,
                replace: "$self.getPreparedWindow($2)??window.open($1,$2,$3)"
            }
        }
    ],
    flux: {
        POPOUT_WINDOW_CLOSE({ key }: { key: string; }) {
            if (pending?.key === key) cancelPending();
        },
        LOGOUT: cancelPending
    },
    getPreparedWindow(key: string) {
        return pending?.key === key ? pending.window : undefined;
    },
    async openPopout(action: {
        type: "POPOUT_WINDOW_OPEN";
        key: string;
        features: { width?: number; height?: number; defaultWidth?: number; defaultHeight?: number; };
    }) {
        const { key, features } = action;
        if (PopoutWindowStore.getWindowOpen(key)) return FluxDispatcher.dispatch(action);
        if (pending) return;
        if (!navigator.userActivation.isActive) return FluxDispatcher.dispatch(action);
        const request = pending = { key, cancelled: false, window: undefined as Window | undefined };
        const title = document.title;
        const markedTitle = prefix + title;
        document.title = markedTitle;

        try {
            let win: Window | undefined;
            try {
                const state = PopoutWindowStore.getWindowState(key);
                // Chromium supplies the opener's title when it creates a Document PiP window.
                win = request.window = await (window as Window & {
                    documentPictureInPicture: {
                        requestWindow(options: { width: number; height: number; }): Promise<Window>;
                    };
                }).documentPictureInPicture.requestWindow({
                    width: state?.width || features.defaultWidth || features.width || 1024,
                    height: state?.height || features.defaultHeight || features.height || 576
                });
            } catch {
                // Use Discord's normal popup path when PiP creation fails.
            } finally {
                if (document.title === markedTitle) document.title = title;
            }

            if (!win) {
                if (!request.cancelled) FluxDispatcher.dispatch(action);
                return;
            }
            if (request.cancelled || win.closed) return;
            win.name = key;
            const mount = win.document.createElement("div");
            mount.id = "app-mount";
            win.document.body.appendChild(mount);
            const notify = (type: string) => window.dispatchEvent(new MessageEvent("message", {
                data: { discordPopoutEvent: { type, key } }
            }));
            win.addEventListener("pagehide", () => {
                if (PopoutWindowStore.getWindow(key) === win) notify("unloaded");
            }, { once: true });

            FluxDispatcher.dispatch(action);
            if (PopoutWindowStore.getWindow(key) === win && !win.closed) notify("loaded");
        } finally {
            if (request.window && PopoutWindowStore.getWindow(key) !== request.window) request.window.close();
            pending = undefined;
        }
    },
    start() {
        PopoutWindowStore.addChangeListener(updatePopouts);
        updatePopouts();
    },
    stop() {
        cancelPending();
        PopoutWindowStore.removeChangeListener(updatePopouts);
        for (const cleanup of popouts.values()) cleanup();
        popouts.clear();
    },
});
