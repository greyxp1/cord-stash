/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 greyxp1
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { PopoutWindowStore } from "@webpack/common";

const prefix = "Discord Popout: ";
const popouts = new Map<Window, () => void>();

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
    start() {
        PopoutWindowStore.addChangeListener(updatePopouts);
        updatePopouts();
    },
    stop() {
        PopoutWindowStore.removeChangeListener(updatePopouts);
        for (const cleanup of popouts.values()) cleanup();
        popouts.clear();
    },
});
