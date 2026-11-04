"use client";

import { create } from "zustand";

type ModalName = "createServer" | "joinServer" | "invite" | "settings" | "createChannel" | "createCourse" | "channelSettings" | null;

/** Local UI state (not shared with mobile). */
export const useUi = create<{
  navOpen: boolean;
  membersOpen: boolean;
  modal: ModalName;
  /** Extra argument for the open modal (e.g. the channel id for channelSettings). */
  modalArg: string | null;
  setNav: (v: boolean) => void;
  toggleMembers: () => void;
  openModal: (m: ModalName, arg?: string | null) => void;
}>((set) => ({
  navOpen: false,
  membersOpen: true,
  modal: null,
  modalArg: null,
  setNav: (navOpen) => set({ navOpen }),
  toggleMembers: () => set((s) => ({ membersOpen: !s.membersOpen })),
  openModal: (modal, arg = null) => set({ modal, modalArg: arg }),
}));
