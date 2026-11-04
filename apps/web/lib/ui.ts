"use client";

import { create } from "zustand";

type ModalName = "createServer" | "joinServer" | "invite" | "settings" | "createChannel" | "createCourse" | null;

/** Local UI state (not shared with mobile). */
export const useUi = create<{
  navOpen: boolean;
  membersOpen: boolean;
  modal: ModalName;
  setNav: (v: boolean) => void;
  toggleMembers: () => void;
  openModal: (m: ModalName) => void;
}>((set) => ({
  navOpen: false,
  membersOpen: true,
  modal: null,
  setNav: (navOpen) => set({ navOpen }),
  toggleMembers: () => set((s) => ({ membersOpen: !s.membersOpen })),
  openModal: (modal) => set({ modal }),
}));
